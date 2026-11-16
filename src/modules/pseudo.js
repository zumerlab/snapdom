/**
 * Pseudo-elements, materialized into the clone.
 *
 * The svg carries snapdom's class CSS, not the page's sheets, so author pseudos are rebuilt
 * from computed style: `::before`, `::after` and `::first-letter` as a <span>, `::marker` and
 * `::first-line` as a scoped rule on `sessionCache.pseudoCSS` (a span can neither re-fragment
 * a first line nor replace a marker). A cloned `<style>` gets its native pseudos suppressed
 * so they do not paint twice (#359).
 *
 * Cost control, in order: a document preflight, one subtree `querySelector` over the selector
 * gates (canSkipPseudoWalk), one `matches()` per node before any getComputedStyle.
 * Pinned by __tests__/module.pseudo.test.js and the module.pseudo.*.test.js siblings.
 * @module pseudo
 */

import {
  getStyle,
  snapshotComputedStyle,
  extractURL,
  resolveImageSetURL,
  safeEncodeURI,
  inlineSingleBackgroundEntry,
  splitBackgroundImage,
  getStyleKey,
  debugWarn
} from '../utils/index.js'
import { iconToImage } from './iconFonts.js'
import { sessionWarn } from '../utils/debug.js'
import { isIconFont } from '../modules/iconFonts.js'
import {
  buildCounterContext,
  resolveCountersInContent,
  hasCounters,
  counterPairs
} from '../modules/counter.js'
import { snapFetch } from './snapFetch.js'
import { pseudoGatesFor, pseudoUniverseFor } from './authorStyles.js'
import { pseudoSnapshotFor } from './styleShare.js'
import { ONE_LINE_PROP } from './styleFreeze.js'
import { flushStyleInvalidations, invalidateStyleCaches } from '../core/changes.js'

/** Weak memo for per-document preflight results keyed by a cheap style fingerprint */
const __preflightMemo = new WeakMap()

/** Max number of CSS rules to scan across all sheets. 300 was too low for apps with 500+
 *  utility rules (Tailwind, MUI). */
const CSS_RULE_SCAN_BUDGET = 1000

/**
 * Safely returns cssRules for a stylesheet, or null when cross-origin/blocked.
 * @param {CSSStyleSheet} sheet
 * @returns {CSSRuleList | null}
 */
function safeRules(sheet) {
  try {
    return sheet && sheet.cssRules ? sheet.cssRules : null
  } catch {
    return null
  }
}

/**
 * A cheap fingerprint of the document's sheets. Rule counts are in it so a CSSOM insertRule
 * moves it.
 * @param {Document} doc
 * @returns {string}
 */
function styleFingerprint(doc) {
  const nodes = doc.querySelectorAll('style,link[rel~="stylesheet"]')
  let fp = `n:${nodes.length}|`
  let totalRules = 0

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    if (n.tagName === 'STYLE') {
      const len = n.textContent ? n.textContent.length : 0
      fp += `S${len}|`
      // If same-origin, cssRules is readable; include count to reflect insertRule
      const sheet = /** @type {HTMLStyleElement} */(n).sheet
      const rules = sheet ? safeRules(sheet) : null
      if (rules) totalRules += rules.length
    } else {
      const href = n.getAttribute('href') || ''
      const media = n.getAttribute('media') || 'all'
      fp += `L${href}|m:${media}|`
      const sheet = /** @type {HTMLLinkElement} */(n).sheet
      const rules = sheet ? safeRules(sheet) : null
      if (rules) totalRules += rules.length
    }
  }

  // Adopted sheets by rule count, not just by number: `replaceSync()` on a sheet already
  // adopted changes no length and emits no mutation record, and the pass stayed memoized
  // off. Constructed sheets are same-origin by definition, and a page has a handful.
  const ass = /** @type {any} */ (doc).adoptedStyleSheets
  let assRules = 0
  if (Array.isArray(ass)) for (const s of ass) { const r = safeRules(s); if (r) assRules += r.length }
  fp += `ass:${Array.isArray(ass) ? ass.length : 0}/${assRules}|tr:${totalRules}`

  return fp
}

/**
 * Scans a stylesheet's rules for any needle strings within a limited budget.
 * @param {CSSStyleSheet} sheet
 * @param {string[]} needles
 * @param {{budget:number}} state
 * @returns {boolean}
 */
function sheetHasNeedles(sheet, needles, state) {
  const rules = safeRules(sheet)
  if (!rules) return false

  for (let i = 0; i < rules.length; i++) {
    if (state.budget <= 0) return false
    const rule = rules[i]
    // Only read cssText when needed and decrement budget
    const css = rule && rule.cssText ? rule.cssText : ''
    state.budget--
    for (const k of needles) {
      if (css.includes(k)) return true
    }
    // @import: the rule's own cssText is only the url, so the needles live one sheet down.
    // Missing them skips the ENTIRE pseudo pass for any site that keeps its component CSS
    // behind an import.
    if (rule && rule.styleSheet && sheetHasNeedles(rule.styleSheet, needles, state)) return true
    // Nested group rules: @media, @supports, etc.
    // @ts-ignore - CSSGroupingRule may not exist in all envs
    if (rule && rule.cssRules && rule.cssRules.length) {
      for (let j = 0; j < rule.cssRules.length && state.budget > 0; j++) {
        const inner = rule.cssRules[j]
        const innerCss = inner && inner.cssText ? inner.cssText : ''
        state.budget--
        for (const k of needles) {
          if (innerCss.includes(k)) return true
        }
      }
    }
    if (state.budget <= 0) return false
  }
  return false
}

/**
 * Whether the document needs pseudo/counter inlining at all: true when any sheet mentions a
 * pseudo (NEEDLES) or a counter. Checked from cheapest to dearest: <style> text, adopted
 * sheets, a budget of same-origin <style>/<link> rules, then inline `style="counter("`.
 * Memoized by document and style fingerprint.
 * @param {Document} doc
 * @returns {boolean}
 */
export function shouldProcessPseudos(doc = document, fp = styleFingerprint(doc)) {
  const memo = __preflightMemo.get(doc)
  if (memo && memo.fingerprint === fp) return memo.result
  // A `<style>`/`<link>` change bumps the DOM epoch through its mutation record. Only
  // adoptedStyleSheets changes emit no record, so bump by hand ONLY when the adopted part of
  // the fingerprint moved: bumping on every change moved epochs mid-capture and broke three
  // read-count/byte-equality tests.
  const adopted = (s) => (s.match(/\|ass:[^|]*/) || [''])[0]
  if (memo && adopted(fp) !== adopted(memo.fingerprint)) invalidateStyleCaches()

  const NEEDLES = [
    // double-colon. ::marker/::first-line stay listed: this preflight gates their scoped
    // rules too, and a page whose only pseudo is a marker would skip the pass.
    '::before', '::after', '::first-letter', '::marker', '::first-line',
    // single-colon robustness
    ':before', ':after', ':first-letter', ':first-line',
    // counters
    'counter(', 'counters(', 'counter-increment', 'counter-reset'
  ]

  // 1) Inline <style> text scan (O(total style text))
  const styleEls = doc.querySelectorAll('style')
  for (let i = 0; i < styleEls.length; i++) {
    const t = styleEls[i].textContent || ''
    for (const k of NEEDLES) if (t.includes(k)) {
      __preflightMemo.set(doc, { fingerprint: fp, result: true })
      return true
    }
  }

  // 2) adoptedStyleSheets cssRules scan (safe and fast)
  const ass = /** @type {any} */ (doc).adoptedStyleSheets
  if (Array.isArray(ass) && ass.length) {
    const state = { budget: CSS_RULE_SCAN_BUDGET }
    try {
      for (const sheet of ass) {
        if (sheetHasNeedles(sheet, NEEDLES, state)) {
          __preflightMemo.set(doc, { fingerprint: fp, result: true })
          return true
        }
      }
    } catch { /* ignore */ }
  }

  // 3) cssRules scan in <style> / <link rel="stylesheet"> (same-origin only), bounded by budget
  {
    const nodes = doc.querySelectorAll('style,link[rel~="stylesheet"]')
    const state = { budget: CSS_RULE_SCAN_BUDGET }
    for (let i = 0; i < nodes.length && state.budget > 0; i++) {
      const n = nodes[i]
      /** @type {CSSStyleSheet | null} */
      let sheet = null
      if (n.tagName === 'STYLE') {
        sheet = /** @type {HTMLStyleElement} */(n).sheet || null
      } else {
        sheet = /** @type {HTMLLinkElement} */(n).sheet || null
      }
      if (sheet && sheetHasNeedles(sheet, NEEDLES, state)) {
        __preflightMemo.set(doc, { fingerprint: fp, result: true })
        return true
      }
    }
  }

  // 4) Ultra-cheap inline style hint
  if (doc.querySelector('[style*="counter("], [style*="counters("]')) {
    __preflightMemo.set(doc, { fingerprint: fp, result: true })
    return true
  }

  __preflightMemo.set(doc, { fingerprint: fp, result: false })
  return false
}

/**
 * True if any single side paints a border. The `border-width`/`border-style` shorthands
 * can't be parsed with parseFloat: a `border-bottom` resolves to "0px 0px 1px 0px", whose
 * first token (top) is 0, so single-side borders were wrongly read as absent (#419).
 * @param {CSSStyleDeclaration} s
 * @returns {boolean}
 */
function hasPaintedBorder(s) {
  let st
  return !!(
    ((st = s.borderTopStyle) && st !== 'none' && st !== 'hidden' && parseFloat(s.borderTopWidth) > 0) ||
    ((st = s.borderRightStyle) && st !== 'none' && st !== 'hidden' && parseFloat(s.borderRightWidth) > 0) ||
    ((st = s.borderBottomStyle) && st !== 'none' && st !== 'hidden' && parseFloat(s.borderBottomWidth) > 0) ||
    ((st = s.borderLeftStyle) && st !== 'none' && st !== 'hidden' && parseFloat(s.borderLeftWidth) > 0)
  )
}

/**
 * Wraps buildCounterContext(doc), an O(document) walk, behind a memoizing get/getStack pair,
 * so the walk runs on the first real counter query, not on every pseudo check.
 * @param {Document} doc
 * @param {Object} sessionCache
 * @returns {{get:Function, getStack:Function}}
 */
function lazyCounterContext(doc, sessionCache) {
  let built = null
  const ensure = () => {
    if (!built) {
      try { built = buildCounterContext(doc) } catch (e) {
        debugWarn(sessionCache, 'Couldn\'t compute CSS counters; list numbers may be off.', e)
        built = { get: () => 0, getStack: () => [] }
      }
    }
    return built
  }
  return {
    get(node, name) { return ensure().get(node, name) },
    getStack(node, name) { return ensure().getStack(node, name) }
  }
}

/**
 * Strips the CSS content alt-text suffix: `<content-list> / <string-or-counter>+`.
 * The part after a top-level (unquoted) `/` is screen-reader alt text and never paints.
 * Font Awesome 7 emits `content: "\f015" / ""`, whose `/` would otherwise join the glyph.
 * @param {string} raw
 */
function stripContentAltText(raw) {
  let inQuotes = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '"') inQuotes = !inQuotes
    else if (ch === '/' && !inQuotes) return raw.slice(0, i).trim()
  }
  return raw
}

/** Decodes CSS string escapes: `\A` (a newline), `\2014` with its optional trailing space,
 *  `\"`, `\\`, and a backslash-newline continuation (which produces nothing). Undecoded, a
 *  `content: "\201C"` paints the literal text `\201C`. */
function unescapeCssString(str) {
  return str.replace(/\\(?:([0-9a-fA-F]{1,6})[ \t\n]?|([\s\S]))/g, (_, hex, ch) => {
    if (hex) {
      const cp = parseInt(hex, 16)
      return (cp === 0 || cp > 0x10FFFF) ? '\uFFFD' : String.fromCodePoint(cp)
    }
    return ch === '\n' ? '' : ch
  })
}

/**
 * Join the tokens of a CSS `content` value (strings, and what counter()/counters() resolved
 * to) without the whitespace that separates them in the source. The browser concatenates
 * adjacent tokens with no gap, so `counter(x) ")"` must render `1)` and not `1 )` (#235).
 * @param {string} raw
 * @returns {string}
 */
function collapseCssContent(raw) {
  if (!raw) return ''
  const parts = []
  // A string token runs to its matching UNESCAPED quote: `[^"]*` split `"say \"hi\""`
  // mid-string. Both quote styles, since a stylesheet may use either.
  const rx = /"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)'/g
  let lastIndex = 0, m
  while ((m = rx.exec(raw))) {
    const between = raw.slice(lastIndex, m.index).trim()
    if (between) parts.push(between)
    parts.push(unescapeCssString(m[1] !== undefined ? m[1] : m[2]))
    lastIndex = rx.lastIndex
  }
  const tail = raw.slice(lastIndex).trim()
  if (tail) parts.push(tail)
  return parts.join('')
}

/**
 * Builds a wrapped base context that applies sibling overrides when there are any.
 * @param {Element} node
 * @param {{get:Function, getStack:Function}} base
 */
function withSiblingOverrides(node, base, siblingCounters) {
  const parent = node.parentElement
  const map = parent && siblingCounters ? siblingCounters.get(parent) : null
  if (!map) return base
  return {
    get(n, name) {
      const v = base.get(n, name)
      const ov = map.get(name)
      // take the larger one (or the override when present) to keep the sequence going
      return typeof ov === 'number' ? Math.max(v, ov) : v
    },
    getStack(n, name) {
      const s = base.getStack(n, name)
      if (!s.length) return s
      const ov = map.get(name)
      if (typeof ov === 'number') {
        const out = s.slice()
        out[out.length - 1] = Math.max(out[out.length - 1], ov)
        return out
      }
      return s
    }
  }
}

/**
 * Applies the pseudo's counter-reset / counter-increment for THIS node only, starting
 * from a base context (already wrapped with the sibling overrides).
 * @param {Element} node
 * @param {CSSStyleDeclaration|null} pseudoStyle
 * @param {{get:Function, getStack:Function}} baseCtx
 */
function deriveCounterCtxForPseudo(node, pseudoStyle, baseCtx) {
  const modStacks = new Map()

  // Elements and pseudos use the same whitespace-separated grammar. Keeping a second
  // comma-based parser here silently discarded every counter after the first.
  const pairs = (value, dflt) => counterPairs(value, dflt).map(([name, num]) => ({ name, num }))
  const resets = pairs(pseudoStyle?.counterReset, 0)
  const sets = pairs(pseudoStyle?.counterSet, 0)
  const incs = pairs(pseudoStyle?.counterIncrement, 1)

  function getStackDerived(name) {
    if (modStacks.has(name)) return modStacks.get(name).slice()
    let stack = baseCtx.getStack(node, name)
    stack = stack.length ? stack.slice() : []

    // reset: push when there is a stack, replace otherwise
    const r = resets.find(x => x.name === name)
    if (r) {
      const val = Number.isFinite(r.num) ? r.num : 0
      stack = stack.length ? [...stack, val] : [val]
    }

    // counter-set: sets the top value without creating a scope (CSS order: reset, set, increment)
    const s = sets.find(x => x.name === name)
    if (s) {
      const val = Number.isFinite(s.num) ? s.num : 0
      if (stack.length === 0) stack = [0]
      stack[stack.length - 1] = val
    }

    // increment: on the top entry, creating top=0 when there is none
    const inc = incs.find(x => x.name === name)
    if (inc) {
      const by = Number.isFinite(inc.num) ? inc.num : 1
      if (stack.length === 0) stack = [0]
      stack[stack.length - 1] += by
    }

    modStacks.set(name, stack.slice())
    return stack
  }

  return {
    get(_node, name) {
      const s = getStackDerived(name)
      return s.length ? s[s.length - 1] : 0
    },
    getStack(_node, name) {
      return getStackDerived(name)
    },
    /** The pseudo's own increments, so the caller can carry them to the next sibling. */
    incs
  }
}

/** Properties valid on the respective pseudo that the scoped-rule emitter diffs. */
// -webkit-text-fill-color PAINTS the glyphs over `color`. A clone with a full style read (the
// unreliable-scan path) carries the element's fill colour, which defeats the pseudo's `color`;
// read from the pseudo it resolves to the pseudo's own colour (initial is currentColor), so
// emitting it makes the first line or marker paint. Written only when it differs.
const MARKER_PROPS = ['color', '-webkit-text-fill-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'line-height']
const FIRST_LINE_PROPS = [
  'color', '-webkit-text-fill-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
  'letter-spacing', 'word-spacing', 'text-transform', 'text-decoration-line',
  'text-decoration-color', 'text-decoration-style', 'line-height', 'background-color', 'vertical-align',
]

/** Emits `[data-sd-pN]::marker{…}` / `…::first-line{…}` for elements an author selector
 *  matches, with only the properties that differ from the element's own computed style
 *  (plus non-normal marker content). Rules accumulate on sessionCache.pseudoCSS;
 *  prepareClone folds them into the class prefix CSS. */
function emitScopedPseudoRule(source, clone, sessionCache, gate, pseudo, props) {
  try {
    if (gate === null) {
      // No selector to ask: only boxes the pseudo can exist on pay the probe, list items for
      // ::marker and block containers for ::first-line. Shadow content is left out: its own
      // scoped rules render there.
      if (source.getRootNode() !== (source.ownerDocument || document)) return
      const d = getStyle(source).display || ''
      if (pseudo === '::marker' ? !d.includes('list-item') : !(d === 'block' || d === 'flow-root' || d === 'list-item' || d === 'inline-block' || d === 'table-cell' || d === 'table-caption')) return
    } else if (!source.matches(gate)) return
    if (pseudo === '::marker' && !(getStyle(source).display || '').includes('list-item')) return
    const ps = getStyle(source, pseudo)
    const base = getStyle(source)
    if (!ps) return
    let decls = ''
    for (const p of props) {
      const v = ps.getPropertyValue(p)
      // background-color and vertical-align are not inherited: the pseudo's initial value
      // differs from the element's without any authored rule. Emitted, it was an inert rule
      // per node, and new scoped rules send diff.js to the full pipeline.
      if (v && v !== base.getPropertyValue(p) &&
          !(p === 'background-color' && v === 'rgba(0, 0, 0, 0)') && !(p === 'vertical-align' && v === 'baseline')) decls += `${p}:${v};`
    }
    if (pseudo === '::marker') {
      const c = ps.getPropertyValue('content')
      if (c && c !== 'normal' && c !== 'none') decls += `content:${c};`
    }
    if (!decls) return
    const n = sessionCache.pseudoRuleSeq = (sessionCache.pseudoRuleSeq || 0) + 1
    const attr = `data-sd-p${n}`
    clone.setAttribute(attr, '')
    sessionCache.pseudoCSS = (sessionCache.pseudoCSS || '') + `[${attr}]${pseudo}{${decls}}`
  } catch { /* fidelity extra, never blocks the capture */ }
}

/** Computed `content` keeps quote KEYWORDS unresolved, so the capture would paint the text
 *  "open-quote". Resolved from the element's computed `quotes` (first pair, a depth-0
 *  approximation), typographic quotes for 'auto' (Chromium), nothing for 'none'. */
function resolveQuoteKeywords(raw, node) {
  if (!/\b(?:no-)?(?:open|close)-quote\b/.test(raw)) return raw
  let openQ = '“', closeQ = '”'
  try {
    const q = getStyle(node).quotes
    if (q === 'none') { openQ = ''; closeQ = '' }
    else if (q && q !== 'auto') {
      const pairs = q.match(/"[^"]*"|'[^']*'/g)
      if (pairs && pairs.length >= 2) {
        openQ = pairs[0].slice(1, -1)
        closeQ = pairs[1].slice(1, -1)
      }
    }
  } catch { }
  // Emit as quoted strings so collapseCssContent treats them as text; embedded double
  // quotes would break its tokenizer, so strip them from the glyphs.
  openQ = openQ.replace(/"/g, '')
  closeQ = closeQ.replace(/"/g, '')
  return raw.replace(/"[^"]*"|\b(no-open-quote|no-close-quote|open-quote|close-quote)\b/g, (tok, kw) => {
    if (!kw) return tok // quoted string, untouched
    if (kw === 'open-quote') return `"${openQ}"`
    if (kw === 'close-quote') return `"${closeQ}"`
    return '""' // no-open-quote / no-close-quote render nothing
  })
}

/**
 * Resolve the pseudo's `content` to the text it paints: alt text stripped, quote keywords
 * resolved, sibling counter overrides (so a sequence continues across siblings), the pseudo's
 * own reset/increment, counter() expansion, then tokens joined with no gap. With no counter()
 * and no counter-increment the counter context is not derived.
 * @param {Element} node
 * @param {CSSStyleDeclaration} ps - the pseudo's computed style
 * @param {{get:Function, getStack:Function}} baseCtx
 * @param {WeakMap<Element, Map<string, number>>} siblingCounters - per-parent overrides, on the session
 * @returns {{ text: string, incs: Array<{name:string,num:number|undefined}>, derived?: {get:Function, getStack:Function} }}
 *   `derived` is set whenever `incs` is non-empty
 */
function resolvePseudoContentAndIncs(node, ps, baseCtx, siblingCounters) {
  let raw = ps.content
  if (!raw || raw === 'none' || raw === 'normal') return { text: '', incs: [] }
  raw = stripContentAltText(raw)
  raw = resolveQuoteKeywords(raw, node)
  const inc = ps.counterIncrement
  if (!hasCounters(raw) && (!inc || inc === 'none')) return { text: collapseCssContent(raw), incs: [] }

  // 1) sibling overrides
  const baseWithSiblings = withSiblingOverrides(node, baseCtx, siblingCounters)

  // 2) derive (applies the pseudo's reset/increment)
  const derived = deriveCounterCtxForPseudo(node, ps, baseWithSiblings)

  // 3) resolve counter()/counters()
  let resolved = hasCounters(raw)
    ? resolveCountersInContent(raw, node, derived)
    : raw

  // 4) collapse tokens ("1" and "." become "1.")
  const text = collapseCssContent(resolved)
  return { text, incs: derived.incs || [], derived }
}

/**
 * Can the whole pseudo walk be skipped for this subtree? Every real page has a pseudo somewhere
 * in the DOCUMENT. 500-row table, one `.zz::before` matching nothing: `toRaw` went from 75 ms
 * to 197 ms with the walk, 66 with this one subtree `querySelector`.
 * Pinned by __tests__/module.pseudo.subtreeGate.test.js, whose descendant-match test goes red
 * without the querySelector half.
 * @returns {boolean}
 */
function canSkipPseudoWalk(source, sessionCache) {
  // Shadow sheets are never scanned. deepClone sets shadowPseudo and always runs first; not
  // `shadowScopes.size`: a WeakMap, always undefined, and the pinned shadow ::after was skipped.
  if (sessionCache.shadowPseudo) return false
  const gates = pseudoGatesFor(source)
  const sels = []
  for (const kind of ['before', 'after', 'firstLetter', 'marker', 'firstLine']) {
    const gate = gates[kind]
    // Unreliable scan (cross-origin CSS): nothing may be ruled out.
    if (gate === null) return false
    if (gate) sels.push(gate)
  }
  if (!sels.length) return true
  const sel = sels.join(',')
  try {
    return !source.matches(sel) && source.querySelector(sel) === null
  } catch {
    return false
  }
}

/**
 * Inline every pseudo-element under `source` into `clone`, recursing through nodeMap.
 *
 * Deep tree with a 2px stripe on each of 1,936 leaves: 150 to 24 µs per `::before` (435 ms to
 * 172), from the root-only preflight, the pseudo universe (~45 props, not ~130), complete
 * per-tag defaults, and twin pseudos sharing one read (pseudoSnapshotFor). Pinned by
 * __tests__/module.pseudo.test.js, module.pseudo.subtreeGate, module.pseudo.twinShare,
 * module.pseudo.unreliableScan and module.pseudo.adoptedReplace.
 * @param {Element} source - live element
 * @param {Element} clone - its clone, from deepClone
 * @param {object} sessionCache - the capture session (styleMap, nodeMap, pseudoCSS, counters)
 * @param {object} options - capture context
 * @param {boolean} [isDescendant=false] - true on the recursive calls; gates the once-per-capture work
 * @returns {Promise<void>}
 */
export async function inlinePseudoElements(source, clone, sessionCache, options, isDescendant = false) {
  if ((source?.nodeType !== 1) || (clone?.nodeType !== 1)) return
  // fast: false | 'auto' (#503): this walk probes every shadow-root node, 65 ms on that table.
  if (sessionCache.slicer?.due()) await sessionCache.slicer.pause()
  // #447: a textarea's value is its *child text content*, so wrapping characters in a
  // <span> (as the ::first-letter path does) drops them from the rendered value.
  // Browsers don't render pseudo-elements on textarea anyway.
  if (source.tagName === 'TEXTAREA') return
  // --- preflight, once per session/doc ---
  const doc = source.ownerDocument || document
  // On the ROOT call only: the fingerprint is a document-wide querySelectorAll plus a walk of
  // every sheet, quadratic per node (deep tree with a ::before per leaf: 64 ms of a 295 ms
  // capture). `shadowPseudo`: a shadow root in the capture declares a pseudo, which the
  // document preflight cannot see.
  if (!isDescendant) {
    // Drain pending observer records first, so the scanned universe and pseudo gates are not
    // read against a stale epoch (a <style> added in the same tick).
    flushStyleInvalidations()
    if (!shouldProcessPseudos(doc) && !sessionCache.shadowPseudo) return
    // Asked once, on the root call only: the recursion below is exactly what this skips.
    if (canSkipPseudoWalk(source, sessionCache)) return
  }

  // Sibling-counter overrides live on the session, not a module global: a concurrent capture
  // wiped the global mid-walk through an epoch bump.
  if (!sessionCache.siblingCounters) sessionCache.siblingCounters = new WeakMap()

  // Lazy: the whole-document counter walk runs only once a pseudo declares a counter.
  if (!sessionCache.counterCtx) {
    sessionCache.counterCtx = lazyCounterContext(source.ownerDocument || document, sessionCache)
  }
  const counterCtx = sessionCache.counterCtx

  // Selector gates from the sheet scan: only nodes a collected selector matches pay the
  // getComputedStyle probe. '' = no author rule for that kind, null = scan unreliable
  // (cross-origin CSS, shadow roots), so probe.
  const gates = pseudoGatesFor(source)

  // ::marker and ::first-line as scoped rules: markers re-render natively in the
  // foreignObject and a first line re-fragments there. A null gate probes too; the emitter
  // writes only what differs from the element, so it cannot over-apply. Shadow content gets
  // these rules through injectScopedStyle.
  if (gates.marker !== '') emitScopedPseudoRule(source, clone, sessionCache, gates.marker, '::marker', MARKER_PROPS)
  if (gates.firstLine !== '') emitScopedPseudoRule(source, clone, sessionCache, gates.firstLine, '::first-line', FIRST_LINE_PROPS)

  for (const pseudo of ['::before', '::after', '::first-letter']) {
    const gate = gates[pseudo === '::before' ? 'before' : pseudo === '::after' ? 'after' : 'firstLetter']
    if (gate !== null) {
      if (gate === '') continue
      try { if (!source.matches(gate)) continue } catch { /* unparsable at match time, so probe */ }
    }
    // The first-letter pass rewrites a non-blank text child of the clone; with none there is
    // nothing to wrap, so the style probe is skipped.
    let textNode = null
    if (pseudo === '::first-letter') {
      for (let n = clone.firstChild; n && !textNode; n = n.nextSibling) if (n.nodeType === 3 && n.data.trim()) textNode = n
      if (!textNode) continue
    }
    try {
      const style = getStyle(source, pseudo)
      if (!style) continue
      const content = style.content, display = style.display
      // Skip default, visually empty pseudo styles before adding suppression markers.
      const isEmptyPseudo =
        content === 'none' &&
        style.backgroundImage === 'none' &&
        (style.backgroundColor === 'transparent' || style.backgroundColor === 'rgba(0, 0, 0, 0)') &&
        !hasPaintedBorder(style) &&
        (!style.transform || style.transform === 'none') &&
        display === 'inline'

      if (isEmptyPseudo) continue

      // ::before and ::after do not generate a box when content is none/normal,
      // and no pseudo-element generates a box when display is none. Paint and
      // layout styles cannot make those non-generated boxes visible.
      const nonGenerated = display === 'none' ||
        (pseudo !== '::first-letter' && (content === 'none' || content === 'normal'))
      if (nonGenerated) {
        // A cloned stylesheet can restart a pseudo animation from a visible
        // keyframe, so suppress the native pseudo even though no replacement
        // node is needed for the currently captured frame.
        if (pseudo === '::before') clone.setAttribute('data-snapdom-has-before', '1')
        if (pseudo === '::after') clone.setAttribute('data-snapdom-has-after', '1')
        continue
      }

      if (pseudo === '::first-letter') {
        const normal = getStyle(source)
        // #406: wrapping the first letter in a <span> inside a flex/grid container
        // creates a new flex item; gap then inserts unwanted space (e.g. "S end Invite").
        const disp = (normal?.display || '').toLowerCase()
        if (disp.includes('flex') || disp.includes('grid')) continue
        // Box props are NOT inherited by ::first-letter: for an unmatched pseudo Chromium
        // resolves them to their initial value while the element keeps its own (#474: KaTeX's
        // italic-correction margin-right made every mathnormal span "meaningful"). A real
        // authored rule must both differ from the element AND be non-initial.
        const boxDiff = (p) => style[p] !== normal[p] && (parseFloat(style[p]) || 0) !== 0
        const isMeaningful =
          style.color !== normal.color ||
          style.fontSize !== normal.fontSize ||
          style.fontWeight !== normal.fontWeight ||
          style.fontFamily !== normal.fontFamily ||
          style.fontStyle !== normal.fontStyle ||
          style.textTransform !== normal.textTransform ||
          (style.float !== normal.float && style.float !== 'none') ||
          boxDiff('paddingTop') || boxDiff('paddingRight') ||
          boxDiff('paddingBottom') || boxDiff('paddingLeft') ||
          boxDiff('marginTop') || boxDiff('marginRight') ||
          boxDiff('marginBottom') || boxDiff('marginLeft')
        if (!isMeaningful) continue

        const text = textNode.textContent
        // Leading white space is not part of ::first-letter and does not stop it (CSS Pseudo
        // §3.2): skip the run, match after it, and put it back in front of the span, or
        // indented markup (`<p>\n  Hello`) loses the pseudo.
        const lead = /^\s*/.exec(text)[0]
        const body = text.slice(lead.length)
        const match = body.match(/^([^\p{L}\p{N}\s]*[\p{L}\p{N}](?:['’])?)/u)
        const first = match?.[0]
        const rest = body.slice(first?.length || 0)
        if (!first || /[\uD800-\uDFFF]/.test(first)) continue

        const span = document.createElement('span')
        span.textContent = first
        span.setAttribute('data-snapdom-pseudo', '::first-letter')
        const snapshot = snapshotComputedStyle(style, pseudoUniverseFor(source, sessionCache))
        const key = getStyleKey(snapshot, 'span')
        sessionCache.styleMap.set(span, key)

        const restNode = document.createTextNode(rest)
        clone.replaceChild(restNode, textNode)
        clone.insertBefore(span, restNode)
        if (lead) clone.insertBefore(document.createTextNode(lead), span)
        continue
      }

      // Content: pseudo-aware counters, collapsed tokens.
      const rawContent = content ?? ''
const isNoExplicitContent =
  rawContent === '' || rawContent === 'none' || rawContent === 'normal'
const { text: cleanContent, incs, derived } =
  resolvePseudoContentAndIncs(source, style, counterCtx, sessionCache.siblingCounters)

      const bg = style.backgroundImage
      const bgColor = style.backgroundColor
      const fontFamily = style.fontFamily
      const fontSize = parseInt(style.fontSize) || 32
      const fontWeight = parseInt(style.fontWeight) || false
      const fontStyle = style.fontStyle || 'normal'
      const color = style.color || '#000'
      const transform = style.transform

      const isIconFont2 = isIconFont(fontFamily, options?.__iconMatchers)

const hasExplicitContent = !isNoExplicitContent && cleanContent !== ''
      const hasBg = bg && bg !== 'none'
      const hasBgColor =
        bgColor && bgColor !== 'transparent' && bgColor !== 'rgba(0, 0, 0, 0)'
      const hasBorder = hasPaintedBorder(style)
      const hasTransform = transform && transform !== 'none'

      // A box-generating pseudo with a real size takes layout space without painting: antd's
      // `::before { content:''; display:inline-block; height:100% }` centers a modal (#418).
      // #498: an atomic inline box takes part in line layout even at 0×0, as a justification
      // opportunity for `text-align-last: justify`. A block-level 0×0 box changes nothing.
      const boxGenerating = rawContent !== 'none' && rawContent !== 'normal'
      const atomicInline = /^inline-/.test(display || '')
      const hasLayoutBox = boxGenerating &&
        ((parseFloat(style.width) || 0) > 0 || (parseFloat(style.height) || 0) > 0 || atomicInline)

      // A box-generating pseudo can paint with box-shadow or outline alone: a zero-size box
      // with a blur shadow renders a glow. With content:none no box exists live.
      const boxShadow = style.boxShadow, outlineStyle = style.outlineStyle
      const hasShadow = boxGenerating && boxShadow && boxShadow !== 'none'
      const hasOutline = boxGenerating && outlineStyle && outlineStyle !== 'none' &&
        (parseFloat(style.outlineWidth) || 0) > 0

      const shouldRender =
        hasExplicitContent || hasBg || hasBgColor || hasBorder || hasTransform || hasLayoutBox ||
        hasShadow || hasOutline

      if (!shouldRender) {
        // Even with no box rendered, a pseudo that had increments must propagate to siblings
        if (incs && incs.length && source.parentElement) {
          const map = sessionCache.siblingCounters.get(source.parentElement) || new Map()
          // For each counter the pseudo incremented, store the final resolved value
          for (const { name } of incs) {
            if (!name) continue
            // Rebuild the final value from `derived` by asking for it again, using
            // withSiblingOverrides + derive so it stays consistent with the read above
            const baseWithSibs = withSiblingOverrides(source, counterCtx, sessionCache.siblingCounters)
            const derived = deriveCounterCtxForPseudo(source, getStyle(source, pseudo), baseWithSibs)
            const finalVal = derived.get(source, name)
            map.set(name, finalVal)
          }
          sessionCache.siblingCounters.set(source.parentElement, map)
        }
        continue
      }

      // SVG-as-<img> gives system-ui other metrics, so pseudo text like ' Pro' can wrap a host
      // that is one line live: host AND span get nowrap. Not off the host's line (#516): a
      // positioned, floated or block pseudo wraps on its own (a 50px tooltip came out on one line).
      const isImageContent = cleanContent.startsWith('url(') || /^-?(?:webkit-)?image-set\(/i.test(cleanContent)
      const onHostLine = display === 'inline' && style.cssFloat === 'none' &&
        style.position !== 'absolute' && style.position !== 'fixed'
      let pinNowrap = false
      if (hasExplicitContent && !isIconFont2 && cleanContent.length > 1 && !isImageContent && onHostLine) {
        const hostStyle = getStyle(source)
        const fs = parseFloat(hostStyle.fontSize) || 16
        let lh = parseFloat(hostStyle.lineHeight)
        if (!Number.isFinite(lh)) lh = fs * 1.5
        const rect = source.getBoundingClientRect()
        if (rect.height < lh * 1.6) {
          clone.style.whiteSpace = 'nowrap'
          pinNowrap = true
        }
      }

      const pseudoEl = document.createElement('span')
      pseudoEl.setAttribute('data-snapdom-pseudo', pseudo)
      // pseudoEl.style.display = 'inline'
      // pseudoEl.style.verticalAlign = 'baseline'
      pseudoEl.style.pointerEvents = 'none'
      if (pinNowrap) pseudoEl.style.whiteSpace = 'nowrap'
      // A host freezeOneLine pinned (styleFreeze.js) carries the pin to the span like to any element
      // under it: the base reset's `span{white-space:normal}` beats what the span inherits.
      else if (clone.style.getPropertyValue(ONE_LINE_PROP) === 'nowrap') pseudoEl.style.setProperty(ONE_LINE_PROP, 'nowrap')
      const snapshot = pseudoSnapshotFor(source, pseudo, style, sessionCache)
      // #452: the styles.js softening flags. An empty pseudo sized by CSS is the #433 empty box
      // and keeps its width, or a flex-item dot collapses to 0 and a block dot stretches to the
      // host. Its parent box is the host, so the host's display makes it a flex item (#406).
      const hostDisplay = (getStyle(source).display || '').toLowerCase()
      const pseudoIsFlexItem = hostDisplay.includes('flex') || hostDisplay.includes('grid')
      if (pseudoIsFlexItem) {
        const mw = snapshot['min-width']
        if (!mw || mw === 'auto' || mw === '0px') snapshot['min-width'] = '0px'
      }
      // #516: a pseudo off the host's line whose text wraps live wraps inside its own width.
      // Softening that width handed the box to shrink-to-fit and unwrapped it (a 50px tooltip
      // came out on one line), and under a host freezeOneLine pinned it inherited nowrap too.
      let sizedByContent = hasExplicitContent
      if (sizedByContent && !onHostLine &&
        parseFloat(style.height) >= 1.5 * (parseFloat(style.lineHeight) || (parseFloat(style.fontSize) || 16) * 1.2)) {
        sizedByContent = false
        pseudoEl.style.whiteSpace = style.whiteSpace
      }
      const key = getStyleKey(snapshot, 'span', sizedByContent, pseudoIsFlexItem)
      sessionCache.styleMap.set(pseudoEl, key)

      // ---- Content handling (icon-font glyphs / url() / text) ----
      // One code point, not one UTF-16 unit: a glyph above U+FFFF (Material Design Icons 5+)
      // is a surrogate pair. Pinned by __tests__/module.pseudo.issue557.test.js.
      if (isIconFont2 && cleanContent && [...cleanContent].length === 1) {
        const { dataUrl, height: h, advance, descent } =
          await iconToImage(cleanContent, fontFamily, fontWeight, fontSize, color, fontStyle)
        const imgEl = document.createElement('img')
        imgEl.src = dataUrl
        // The host keeps its display and vertical-align (pinIconStruts holds the line metrics;
        // #176's forced `inline` + `middle` lifted the text 5px). Width is the exact advance:
        // Font Awesome's <i> frozen at 23.25px wrapped a 24px image. Pinned by
        // __tests__/module.iconStrut.test.js.
        imgEl.style = `height:${fontSize}px;width:${(advance / h) * fontSize}px;object-fit:contain;vertical-align:${-descent}px;`
        pseudoEl.appendChild(imgEl)
      } else if (cleanContent && isImageContent) {
        // content: url(...), image-set(...) or -webkit-image-set(...); in the text branch
        // below an image-set() painted its CSS source.
        const rawUrl = resolveImageSetURL(cleanContent, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1) ??
          extractURL(cleanContent)
        if (rawUrl?.trim()) {
          try {
            const dataUrl = await snapFetch(safeEncodeURI(rawUrl), { as: 'dataURL', useProxy: options.useProxy, debug: options.debug })
            if (dataUrl?.ok && typeof dataUrl.data === 'string') {
              const imgEl = document.createElement('img')
              imgEl.src = dataUrl.data
              imgEl.style = `width:${fontSize}px;height:auto;object-fit:contain;`
              pseudoEl.appendChild(imgEl)
            }
          } catch (e) {
            debugWarn(options, `Couldn't draw the ${pseudo} icon of`, [source, e])
          }
        }
      } else if (!isIconFont2 && hasExplicitContent) {
        pseudoEl.textContent = cleanContent // already collapsed, no stray spaces
      }

      // ---- Backgrounds / colors ----
      pseudoEl.style.backgroundImage = 'none'
      if ('maskImage' in pseudoEl.style) pseudoEl.style.maskImage = 'none'
      if ('webkitMaskImage' in pseudoEl.style) pseudoEl.style.webkitMaskImage = 'none'

      try {
        pseudoEl.style.backgroundClip = style.backgroundClip
        // Without an image layer these longhands act on nothing (#265 is the image case).
        if (hasBg) {
          pseudoEl.style.backgroundRepeat = style.backgroundRepeat
          pseudoEl.style.backgroundSize = style.backgroundSize
          if (style.backgroundPositionX && style.backgroundPositionY) {
            pseudoEl.style.backgroundPositionX = style.backgroundPositionX
            pseudoEl.style.backgroundPositionY = style.backgroundPositionY
          } else {
            pseudoEl.style.backgroundPosition = style.backgroundPosition
          }
          pseudoEl.style.backgroundOrigin = style.backgroundOrigin
          pseudoEl.style.backgroundAttachment = style.backgroundAttachment
          pseudoEl.style.backgroundBlendMode = style.backgroundBlendMode
        }
      } catch { }

      if (hasBg) {
        try {
          const bgSplits = splitBackgroundImage(bg)
          // Arrow form, not a bare reference: map passes (entry, INDEX, array), and the index
          // landed where options belongs, so useProxy never reached a pseudo background.
          const newBgParts = await Promise.all(bgSplits.map((entry) => inlineSingleBackgroundEntry(entry, options)))
          pseudoEl.style.backgroundImage = newBgParts.join(', ')
        } catch (e) {
          debugWarn(options, `Couldn't load the ${pseudo} background image.`, e)
        }
      }
      if (hasBgColor) pseudoEl.style.backgroundColor = bgColor

      // Restore the mask the reset above blanked, or a masked icon pseudo (the usual way to
      // tint an SVG icon) paints a solid rectangle. INLINED like a background: a url() mask
      // points at an asset the SVG cannot reach.
      const maskImage = style.maskImage || style.webkitMaskImage
      if (maskImage && maskImage !== 'none') {
        try {
          const parts = await Promise.all(
            splitBackgroundImage(maskImage).map((entry) => inlineSingleBackgroundEntry(entry, options))
          )
          const value = parts.join(', ')
          pseudoEl.style.maskImage = value
          pseudoEl.style.webkitMaskImage = value
          for (const prop of ['maskSize', 'maskRepeat', 'maskPosition', 'maskMode', 'maskComposite', 'maskOrigin', 'maskClip']) {
            if (style[prop]) pseudoEl.style[prop] = style[prop]
          }
        } catch (e) {
          debugWarn(options, `Couldn't load the ${pseudo} mask image.`, e)
        }
      }

      const hasContent2 =
        pseudoEl.childNodes.length > 0 || (pseudoEl.textContent?.trim() !== '')
      const hasVisibleBox =
        hasContent2 || hasBg || hasBgColor || hasBorder || hasTransform || hasLayoutBox ||
        hasShadow || hasOutline

      // Before inserting: when the pseudo incremented anything, propagate the final value to siblings
      if (incs && incs.length && source.parentElement) {
        const map = sessionCache.siblingCounters.get(source.parentElement) || new Map()
        for (const { name } of incs) {
          if (!name) continue
          const finalVal = derived.get(source, name)
          map.set(name, finalVal)
        }
        sessionCache.siblingCounters.set(source.parentElement, map)
      }

      if (!hasVisibleBox) continue

      // #359: mark parent so we can suppress native ::before/::after in cloned <style> (avoids double render)
      if (pseudo === '::before') {
        clone.setAttribute('data-snapdom-has-before', '1')
        clone.insertBefore(pseudoEl, clone.firstChild)
      } else {
        clone.setAttribute('data-snapdom-has-after', '1')
        clone.appendChild(pseudoEl)
      }
    } catch (e) {
      sessionWarn(sessionCache, 'pseudo-failed', `${pseudo} could not be copied`, source)
      debugWarn(options, `Couldn't copy the ${pseudo} of`, [source, e])
    }
  }

  // Recurse through nodeMap, not by index: deepClone drops NO_CAPTURE_TAGS (script, link),
  // so source.children and clone.children do not line up.
  if (sessionCache.nodeMap) {
    // The pseudo spans inserted above have no nodeMap entry, so the miss skips them. The
    // attribute test keeps out a source element that carries the marker itself (a page that
    // inlined an earlier capture), as the filter below does.
    for (let c = clone.firstElementChild; c; c = c.nextElementSibling) {
      const sChild = sessionCache.nodeMap.get(c)
      if (sChild?.nodeType === 1 && !c.hasAttribute('data-snapdom-pseudo')) await inlinePseudoElements(sChild, c, sessionCache, options, true)
    }
  } else {
    const cChildren = Array.from(clone.children).filter((child) => !child.hasAttribute('data-snapdom-pseudo'))
    const sChildren = Array.from(source.children)
    for (let i = 0; i < Math.min(sChildren.length, cChildren.length); i++) {
      await inlinePseudoElements(sChildren[i], cChildren[i], sessionCache, options, true)
    }
  }
}
