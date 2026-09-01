/**
 * Utilities for inlining ::before and ::after pseudo-elements.
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
import { iconToImage } from '../modules/fonts.js'
import { isIconFont } from '../modules/iconFonts.js'
import {
  buildCounterContext,
  resolveCountersInContent,
  hasCounters
} from '../modules/counter.js'
import { snapFetch } from './snapFetch.js'
import { pseudoGatesFor, flushStyleInvalidations } from './styles.js'

/** Weak memo for per-document preflight results keyed by a cheap style fingerprint */
const __preflightMemo = new WeakMap()

/** Max number of CSS rules to scan across all sheets (keeps it fast).
 *  300 was too low for large apps (Tailwind, MUI) with 500+ utility rules — raised to 1000. */
const CSS_RULE_SCAN_BUDGET = 1000

/**
 * Returns whether to process pseudos, but also memoizes the last fingerprint
 * seen in the provided sessionCache to avoid stale results between tests/runs.
 * @param {Document} doc
 * @param {Map|Object} sessionCache
 * @returns {boolean}
 */
function preflightWithFp(doc, sessionCache) {
  const fp = styleFingerprint(doc)
  if (!sessionCache) {
    flushStyleInvalidations()
    return shouldProcessPseudos(doc, fp)
  }
  // Recompute when the fingerprint changes
  if (sessionCache.__pseudoPreflightFp !== fp) {
    // Styles changed (or first visit this capture): drain pending observer records so the
    // scanned universe/pseudo-gates can't be read against a stale epoch (same-tick <style>).
    flushStyleInvalidations()
    sessionCache.__pseudoPreflight = shouldProcessPseudos(doc, fp)
    sessionCache.__pseudoPreflightFp = fp
  }
  return !!sessionCache.__pseudoPreflight
}
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
 * Builds a cheap fingerprint of the document's stylesheet landscape.
 * Includes:
 *  - count and basic hash of <style> and <link rel="stylesheet">
 *  - adoptedStyleSheets length
 *  - total rules count (safe, no cssText) to reflect CSSOM insertRule changes
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

  const ass = /** @type {any} */ (doc).adoptedStyleSheets
  fp += `ass:${Array.isArray(ass) ? ass.length : 0}|tr:${totalRules}`

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
 * Fast preflight to decide whether pseudo/counter inlining is needed at all.
 * Triggers true if detects any:
 *  - ::before / ::after / ::first-letter (and single-colon variants)
 *  - counter( / counters( / counter-increment / counter-reset
 *
 * Strategy (fast → slower):
 *  1) Scan inline <style> textContent
 *  2) Scan adoptedStyleSheets (cssRules) if available
 *  3) Scan a small budget of cssRules in <style>/<link> same-origin
 *  4) Cheap DOM hint for inline styles with counter(
 *
 * Memoized by document + style fingerprint.
 *
 * @param {Document} doc
 * @returns {boolean}
 */
export function shouldProcessPseudos(doc = document, fp = styleFingerprint(doc)) {
  const memo = __preflightMemo.get(doc)
  if (memo && memo.fingerprint === fp) return memo.result

  const NEEDLES = [
    // double-colon — ::marker/::first-line ship as scoped rules (emitScopedPseudoRule),
    // and this preflight is what gates that code: omitting them made a page whose only
    // author pseudo is a marker skip the pass entirely.
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
 * @param {CSSStyleDeclaration} style
 * @returns {boolean}
 */
function hasPaintedBorder(style) {
  for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
    const w = parseFloat(style[`border${side}Width`]) || 0
    const s = style[`border${side}Style`]
    if (w > 0 && s && s !== 'none' && s !== 'hidden') return true
  }
  return false
}

/**
 * Wraps buildCounterContext(doc) — an O(document) walk — behind a memoizing
 * get/getStack pair so the walk only runs on the first actual counter query,
 * not on every element's pseudo-element check.
 * @param {Document} doc
 * @param {Object} sessionCache
 * @returns {{get:Function, getStack:Function}}
 */
function lazyCounterContext(doc, sessionCache) {
  let built = null
  const ensure = () => {
    if (!built) {
      try { built = buildCounterContext(doc) } catch (e) {
        debugWarn(sessionCache, 'buildCounterContext failed', e)
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
 * The part after a top-level (unquoted) `/` is screen-reader-only alt text, never
 * painted — e.g. Font Awesome 7 emits `content: "\f015" / ""` for its icons, and
 * without this the trailing `/` would be folded into the visible glyph string.
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

/**
 * Concatena tokens de CSS `content` (cadenas y resultados de counter()/counters())
 * without the whitespace that separates them in the source: the browser concatenates
 * adjacent tokens with no gap, so `counter(x) ")"` must render `1)` and not `1 )`.
 * @param {string} raw
 */
/** Decodes CSS string escapes: `\A` (a newline), `\2014` with its optional trailing space,
 *  `\"`, `\\`, and a backslash-newline line continuation (which produces nothing). Without
 *  this the escape sequences were carried through verbatim and PAINTED — a `content: "\201C"`
 *  quotation mark rendered as the literal text `\201C`. */
function unescapeCssString(str) {
  return str.replace(/\\(?:([0-9a-fA-F]{1,6})[ \t\n]?|([\s\S]))/g, (_, hex, ch) => {
    if (hex) {
      const cp = parseInt(hex, 16)
      return (cp === 0 || cp > 0x10FFFF) ? '\uFFFD' : String.fromCodePoint(cp)
    }
    return ch === '\n' ? '' : ch
  })
}

function collapseCssContent(raw) {
  if (!raw) return ''
  const parts = []
  // A string token runs to its matching unescaped quote. `[^"]*` ended the token at the
  // first `\"`, so `content: "say \"hi\""` was split mid-string and the tail leaked out as
  // an unquoted token. Both quote styles, since a stylesheet may use either.
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

  function parseListDecl(value) {
    const out = []
    if (!value || value === 'none') return out
    for (const part of String(value).split(',')) {
      const toks = part.trim().split(/\s+/)
      const name = toks[0]
      const num = Number.isFinite(Number(toks[1])) ? Number(toks[1]) : undefined
      if (name) out.push({ name, num })
    }
    return out
  }

  const resets = parseListDecl(pseudoStyle?.counterReset)
  const sets = parseListDecl(pseudoStyle?.counterSet)
  const incs = parseListDecl(pseudoStyle?.counterIncrement)

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

    // counter-set: sets the top value without creating a scope (CSS order: reset -> set -> increment)
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
    /** expone increments del pseudo para que el caller pueda propagar a hermanos */
    __incs: incs
  }
}

/**
 * Resolves the pseudo's `content` by applying:
 * 1) sibling overrides (so counters stay continuous across siblings),
 * 2) the pseudo's own reset/increment,
 * 3) token collapsing, so `"..."` pieces join with no gap.
 *
 * @param {Element} node
 * @param {'::before'|'::after'} pseudo
 * @param {{get:Function, getStack:Function}} baseCtx
 * @returns {{ text: string, incs: Array<{name:string,num:number|undefined}> }}
 */
/** Properties valid on the respective pseudo that the scoped-rule emitter diffs. */
const MARKER_PROPS = ['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'line-height']
const FIRST_LINE_PROPS = [
  'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
  'letter-spacing', 'word-spacing', 'text-transform', 'text-decoration-line',
  'text-decoration-color', 'text-decoration-style', 'line-height', 'background-color', 'vertical-align',
]

/** Emits `[data-sd-pN]::marker{…}` / `…::first-line{…}` for elements an author selector
 *  matches, with only the properties that differ from the element's own computed style
 *  (plus non-normal marker content). Rules accumulate on sessionCache.__pseudoCSS;
 *  prepareClone folds them into the class prefix CSS. */
function emitScopedPseudoRule(source, clone, sessionCache, gate, pseudo, props) {
  try {
    if (!source.matches(gate)) return
    if (pseudo === '::marker' && !(getStyle(source).display || '').includes('list-item')) return
    const ps = getStyle(source, pseudo)
    const base = getStyle(source)
    if (!ps) return
    let decls = ''
    for (const p of props) {
      const v = ps.getPropertyValue(p)
      if (v && v !== base.getPropertyValue(p)) decls += `${p}:${v};`
    }
    if (pseudo === '::marker') {
      const c = ps.getPropertyValue('content')
      if (c && c !== 'normal' && c !== 'none') decls += `content:${c};`
    }
    if (!decls) return
    const n = sessionCache.__pseudoRuleSeq = (sessionCache.__pseudoRuleSeq || 0) + 1
    const attr = `data-sd-p${n}`
    clone.setAttribute(attr, '')
    sessionCache.__pseudoCSS = (sessionCache.__pseudoCSS || '') + `[${attr}]${pseudo}{${decls}}`
  } catch { /* fidelity extra — never blocks the capture */ }
}

/** Computed `content` returns quote KEYWORDS un-resolved (open-quote stays the literal
 *  token), so without this the capture paints the text "open-quote". Resolve from the
 *  element's computed `quotes` (first pair — depth-0 approximation), falling back to
 *  typographic quotes when it computes 'auto' (Chromium) and nothing for 'none'. */
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
    if (!kw) return tok // quoted string — untouched
    if (kw === 'open-quote') return `"${openQ}"`
    if (kw === 'close-quote') return `"${closeQ}"`
    return '""' // no-open-quote / no-close-quote render nothing
  })
}

function resolvePseudoContentAndIncs(node, pseudo, baseCtx, siblingCounters) {
  let ps
  try { ps = getStyle(node, pseudo) } catch { }
  let raw = ps?.content
  if (!raw || raw === 'none' || raw === 'normal') return { text: '', incs: [] }
  raw = stripContentAltText(raw)
  raw = resolveQuoteKeywords(raw, node)

  // 1) aplicar overrides de hermanos
  const baseWithSiblings = withSiblingOverrides(node, baseCtx, siblingCounters)

  // 2) derive (applies the pseudo's reset/increment)
  const derived = deriveCounterCtxForPseudo(node, ps, baseWithSiblings)

  // 3) resolver counter()/counters()
  let resolved = hasCounters(raw)
    ? resolveCountersInContent(raw, node, derived)
    : raw

  // 4) collapse tokens (drops the gap between "1" and "." -> "1.")
  const text = collapseCssContent(resolved)
  return { text, incs: derived.__incs || [] }
}

/**
 * Creates elements to represent ::before, ::after, and ::first-letter pseudo-elements, inlining their styles and content.
 *
 * @param {Element} source - Original element
 * @param {Element} clone - Cloned element
 * @param {Map} sessionCache - styleMap cache etc.
 * @param {Object} options - capture options
 * @returns {Promise<void>}
 */
/**
 * Can the whole pseudo walk be skipped for this subtree?
 *
 * `shouldProcessPseudos` answers a DOCUMENT-level question — "does any stylesheet here
 * mention a pseudo?" — and every real page answers yes, so the pass then recurses over every
 * node of the capture to discover, usually, that nothing matches. Measured on a 500-row table:
 * one `.zz::before` rule matching zero nodes took `toRaw` from 75 ms to 197 ms, and the
 * instrumented counters showed 0 gate passes and 0 getComputedStyle probes. The walk itself
 * was the whole cost.
 *
 * The subtree-level question is the one worth asking, and one `querySelector` answers it.
 * Two cases must still walk:
 *  - a `null` gate — the scan could not be trusted (cross-origin CSS), so nothing may be ruled out;
 *  - any shadow root in the capture — its own sheets are never scanned, so `pseudoGatesFor`
 *    deliberately returns null gates per node there. `sessionCache.shadowScopes` is filled by
 *    deepClone, which always runs first (prepare.js), and diff.js bails on shadow content
 *    before it reaches this pass.
 * @returns {boolean}
 */
function canSkipPseudoWalk(source, sessionCache) {
  if (sessionCache.shadowScopes?.size) return false
  const gates = pseudoGatesFor(source)
  const sels = []
  for (const kind of ['before', 'after', 'firstLetter', 'marker', 'firstLine']) {
    const gate = gates[kind]
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

export async function inlinePseudoElements(source, clone, sessionCache, options, isDescendant = false) {
  if ((source?.nodeType !== 1) || (clone?.nodeType !== 1)) return
  // #447: a textarea's value is its *child text content*, so wrapping characters in a
  // <span> (as the ::first-letter path does) drops them from the rendered value.
  // Browsers don't render pseudo-elements on textarea anyway.
  if (source.tagName === 'TEXTAREA') return
  // --- preflight, once per session/doc ---
  const doc = source.ownerDocument || document
  if (!preflightWithFp(doc, sessionCache)) {
    return
  }
  // Asked once, on the root call only: the recursion below is exactly what this skips.
  if (!isDescendant && canSkipPseudoWalk(source, sessionCache)) return

  // Sibling-counter overrides are per-capture state: they live on sessionCache (whose
  // lifetime is exactly one capture), not on a module global — a concurrently starting
  // capture used to wipe the shared global mid-traversal via an epoch bump.
  if (!sessionCache.__siblingCounters) sessionCache.__siblingCounters = new WeakMap()

  // buildCounterContext walks the whole document once — defer it behind a lazy
  // wrapper so that cost is only paid the first time a pseudo actually declares
  // counter-reset/-increment or a counter()/counters() content value (every real
  // call site below is already gated that way), not on every element's pseudo check.
  if (!sessionCache.__counterCtx) {
    sessionCache.__counterCtx = lazyCounterContext(source.ownerDocument || document, sessionCache)
  }
  const counterCtx = sessionCache.__counterCtx

  // Selector gate from the stylesheet scan: only nodes a collected selector matches pay
  // the 3-pseudo getComputedStyle probe. '' = no author rules for that kind, null =
  // scan unreliable (cross-origin CSS, shadow roots) → probe like before.
  const gates = pseudoGatesFor(source)

  // Authored ::marker / ::first-line: a scoped CSS rule (not a span) is the faithful
  // mechanism — markers re-render natively in the foreignObject and first-line
  // re-fragments there. Gated strictly on collected author selectors: null (unreliable
  // scan) keeps today's behavior, and shadow content already carries these rules through
  // injectScopedStyle.
  if (gates.marker) emitScopedPseudoRule(source, clone, sessionCache, gates.marker, '::marker', MARKER_PROPS)
  if (gates.firstLine) emitScopedPseudoRule(source, clone, sessionCache, gates.firstLine, '::first-line', FIRST_LINE_PROPS)

  for (const pseudo of ['::before', '::after', '::first-letter']) {
    const gate = gates[pseudo === '::before' ? 'before' : pseudo === '::after' ? 'after' : 'firstLetter']
    if (gate !== null) {
      if (gate === '') continue
      try { if (!source.matches(gate)) continue } catch { /* unparsable at match time → probe */ }
    }
    try {
      const style = getStyle(source, pseudo)
      if (!style) continue
      // Skip visually empty pseudo-elements early
      const isEmptyPseudo =
        style.content === 'none' &&
        style.backgroundImage === 'none' &&
        style.backgroundColor === 'transparent' &&
        !hasPaintedBorder(style) &&
        (!style.transform || style.transform === 'none') &&
        style.display === 'inline'

      if (isEmptyPseudo) continue

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

        const textNode = Array.from(clone.childNodes).find(
          (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim().length > 0
        )
        if (!textNode) continue

        const text = textNode.textContent
        // Leading white space is not part of ::first-letter and does not stop it (CSS Pseudo
        // §3.2). The pattern was anchored at index 0 with \s excluded from both halves, so
        // any indented markup — `<p>\n  Hello` — matched nothing and the whole pseudo was
        // dropped. Skip the run, match after it, and put it back in front of the span.
        const lead = /^\s*/.exec(text)[0]
        const body = text.slice(lead.length)
        const match = body.match(/^([^\p{L}\p{N}\s]*[\p{L}\p{N}](?:['’])?)/u)
        const first = match?.[0]
        const rest = body.slice(first?.length || 0)
        if (!first || /[\uD800-\uDFFF]/.test(first)) continue

        const span = document.createElement('span')
        span.textContent = first
        span.dataset.snapdomPseudo = '::first-letter'
        const snapshot = snapshotComputedStyle(style)
        const key = getStyleKey(snapshot, 'span')
        sessionCache.styleMap.set(span, key)

        const restNode = document.createTextNode(rest)
        clone.replaceChild(restNode, textNode)
        clone.insertBefore(span, restNode)
        if (lead) clone.insertBefore(document.createTextNode(lead), span)
        continue
      }

      // ---------- CONTENT (pseudo-aware counters + collapse tokens) ----------
      const rawContent = style.content ?? ''
const isNoExplicitContent =
  rawContent === '' || rawContent === 'none' || rawContent === 'normal'
const { text: cleanContent, incs } =
  resolvePseudoContentAndIncs(source, pseudo, counterCtx, sessionCache.__siblingCounters)

      const bg = style.backgroundImage
      const bgColor = style.backgroundColor
      const fontFamily = style.fontFamily
      const fontSize = parseInt(style.fontSize) || 32
      const fontWeight = parseInt(style.fontWeight) || false
      const color = style.color || '#000'
      const transform = style.transform

      const isIconFont2 = isIconFont(fontFamily, options?.__iconMatchers)

const hasExplicitContent = !isNoExplicitContent && cleanContent !== ''
      const hasBg = bg && bg !== 'none'
      const hasBgColor =
        bgColor && bgColor !== 'transparent' && bgColor !== 'rgba(0, 0, 0, 0)'
      const hasBorder = hasPaintedBorder(style)
      const hasTransform = transform && transform !== 'none'

      // A box-generating pseudo (content not none/normal) with real width/height occupies
      // layout space even with no visible paint — e.g. antd's `::before { content:'';
      // display:inline-block; height:100%; vertical-align:middle }` that vertically centers a
      // modal. Dropping it collapses the layout it controls (#418).
      const boxGenerating = rawContent !== 'none' && rawContent !== 'normal'
      const hasLayoutBox = boxGenerating &&
        ((parseFloat(style.width) || 0) > 0 || (parseFloat(style.height) || 0) > 0)

      // A box-generating pseudo can paint with box-shadow/outline alone (no bg, border,
      // text or size — a zero-size box with a blur/spread shadow still renders a glow).
      // Gated on boxGenerating: with content:none no box exists and nothing paints live.
      const hasShadow = boxGenerating && style.boxShadow && style.boxShadow !== 'none'
      const hasOutline = boxGenerating && style.outlineStyle && style.outlineStyle !== 'none' &&
        (parseFloat(style.outlineWidth) || 0) > 0

      const shouldRender =
        hasExplicitContent || hasBg || hasBgColor || hasBorder || hasTransform || hasLayoutBox ||
        hasShadow || hasOutline

      if (!shouldRender) {
        // Even with no box rendered, a pseudo that had increments must propagate to siblings
        if (incs && incs.length && source.parentElement) {
          const map = sessionCache.__siblingCounters.get(source.parentElement) || new Map()
          // For each counter the pseudo incremented, store the final resolved value
          for (const { name } of incs) {
            if (!name) continue
            // Rebuild the final value from `derived` by asking for it again, using
            // withSiblingOverrides + derive so it stays consistent with the read above
            const baseWithSibs = withSiblingOverrides(source, counterCtx, sessionCache.__siblingCounters)
            const derived = deriveCounterCtxForPseudo(source, getStyle(source, pseudo), baseWithSibs)
            const finalVal = derived.get(source, name)
            map.set(name, finalVal)
          }
          sessionCache.__siblingCounters.set(source.parentElement, map)
        }
        continue
      }

      // SVG-as-<img> resolves system fonts (ui-sans-serif, system-ui) with
      // metrics that differ from the live document; multi-char inline pseudo
      // text (e.g. ' Pro', ' (sale!)') can push the host past its wrap point
      // in the rasterized PNG even when the live DOM shows a single line.
      // Pin white-space:nowrap on the host AND on the pseudo span itself when
      // live is one line — the span carries an explicit `white-space: normal`
      // from its style snapshot, which would otherwise break inheritance.
      // Gate: skip single-char (icon) and url()/image-set() pseudos — wrap impossible there.
      const isImageContent = cleanContent.startsWith('url(') || /^-?(?:webkit-)?image-set\(/i.test(cleanContent)
      let pinNowrap = false
      if (hasExplicitContent && !isIconFont2 && cleanContent.length > 1 && !isImageContent) {
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
      pseudoEl.dataset.snapdomPseudo = pseudo
      // pseudoEl.style.display = 'inline'
      // pseudoEl.style.verticalAlign = 'baseline'
      pseudoEl.style.pointerEvents = 'none'
      if (pinNowrap) pseudoEl.style.whiteSpace = 'nowrap'
      const snapshot = snapshotComputedStyle(style)
      // #452: mirror the styles.js width-softening flags. An empty pseudo box sized by
      // CSS (width/height, content:'') is the #433 "empty box" case — its width must be
      // kept verbatim, otherwise a blockified flex-item dot collapses to 0 and a
      // display:block dot stretches to the host width. The pseudo's parent box is the
      // host itself, so flex-item-ness comes from the host's display (#406: no floor).
      const hostDisplay = (getStyle(source).display || '').toLowerCase()
      const pseudoIsFlexItem = hostDisplay.includes('flex') || hostDisplay.includes('grid')
      if (pseudoIsFlexItem) {
        const mw = snapshot['min-width']
        if (!mw || mw === 'auto' || mw === '0px') snapshot['min-width'] = '0px'
      }
      const key = getStyleKey(snapshot, 'span', hasExplicitContent, pseudoIsFlexItem)
      sessionCache.styleMap.set(pseudoEl, key)

      // ---- Content handling (icon-font glyphs / url() / text) ----
      if (isIconFont2 && cleanContent && cleanContent.length === 1) {
        const { dataUrl, width: w, height: h } =
          await iconToImage(cleanContent, fontFamily, fontWeight, fontSize, color)
        const imgEl = document.createElement('img')
        imgEl.src = dataUrl
        imgEl.style = `height:${fontSize}px;width:${(w / h) * fontSize}px;object-fit:contain;`
        pseudoEl.appendChild(imgEl)
        clone.dataset.snapdomHasIcon = 'true'
      } else if (cleanContent && isImageContent) {
        // content: url(...) / image-set(...) / -webkit-image-set(...) — image-set() used to
        // fall through to the plain-text branch below, rendering the raw CSS source as
        // visible text instead of an image.
        const rawUrl = resolveImageSetURL(cleanContent, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1) ??
          extractURL(cleanContent)
        if (rawUrl?.trim()) {
          try {
            const dataUrl = await snapFetch(safeEncodeURI(rawUrl), { as: 'dataURL', useProxy: options.useProxy })
            if (dataUrl?.ok && typeof dataUrl.data === 'string') {
              const imgEl = document.createElement('img')
              imgEl.src = dataUrl.data
              imgEl.style = `width:${fontSize}px;height:auto;object-fit:contain;`
              pseudoEl.appendChild(imgEl)
            }
          } catch (e) {
            console.error(`[snapdom] Error in pseudo ${pseudo} for`, source, e)
          }
        }
      } else if (!isIconFont2 && hasExplicitContent) {
        pseudoEl.textContent = cleanContent // <- ya sin espacios extra
      }

      // ---- Backgrounds / colors ----
      pseudoEl.style.backgroundImage = 'none'
      if ('maskImage' in pseudoEl.style) pseudoEl.style.maskImage = 'none'
      if ('webkitMaskImage' in pseudoEl.style) pseudoEl.style.webkitMaskImage = 'none'

      try {
        pseudoEl.style.backgroundRepeat = style.backgroundRepeat
        pseudoEl.style.backgroundSize = style.backgroundSize
        if (style.backgroundPositionX && style.backgroundPositionY) {
          pseudoEl.style.backgroundPositionX = style.backgroundPositionX
          pseudoEl.style.backgroundPositionY = style.backgroundPositionY
        } else {
          pseudoEl.style.backgroundPosition = style.backgroundPosition
        }
        pseudoEl.style.backgroundOrigin = style.backgroundOrigin
        pseudoEl.style.backgroundClip = style.backgroundClip
        pseudoEl.style.backgroundAttachment = style.backgroundAttachment
        pseudoEl.style.backgroundBlendMode = style.backgroundBlendMode
      } catch { }

      if (hasBg) {
        try {
          const bgSplits = splitBackgroundImage(bg)
          // Arrow form, not a bare reference: map passes (entry, INDEX, array), so the
          // layer index landed where options belongs and useProxy/CORS settings never
          // reached a pseudo-element background. background.js:119 has it right.
          const newBgParts = await Promise.all(bgSplits.map((entry) => inlineSingleBackgroundEntry(entry, options)))
          pseudoEl.style.backgroundImage = newBgParts.join(', ')
        } catch (e) {
          console.warn(`[snapdom] Failed to inline background-image for ${pseudo}`, e)
        }
      }
      if (hasBgColor) pseudoEl.style.backgroundColor = bgColor

      // The reset above blanks maskImage so a stale mask can't leak in; restoring it was
      // missing entirely, so every masked icon pseudo (the standard way to tint an SVG
      // icon) captured as a solid rectangle. The mask must be INLINED like a background —
      // a url() mask would otherwise point at an asset the SVG cannot reach.
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
          console.warn(`[snapdom] Failed to inline mask-image for ${pseudo}`, e)
        }
      }

      const hasContent2 =
        pseudoEl.childNodes.length > 0 || (pseudoEl.textContent?.trim() !== '')
      const hasVisibleBox =
        hasContent2 || hasBg || hasBgColor || hasBorder || hasTransform || hasLayoutBox ||
        hasShadow || hasOutline

      // Before inserting: when the pseudo incremented anything, propagate the final value to siblings
      if (incs && incs.length && source.parentElement) {
        const map = sessionCache.__siblingCounters.get(source.parentElement) || new Map()
        const baseWithSibs = withSiblingOverrides(source, counterCtx, sessionCache.__siblingCounters)
        const derived = deriveCounterCtxForPseudo(source, getStyle(source, pseudo), baseWithSibs)
        for (const { name } of incs) {
          if (!name) continue
          const finalVal = derived.get(source, name)
          map.set(name, finalVal)
        }
        sessionCache.__siblingCounters.set(source.parentElement, map)
      }

      if (!hasVisibleBox) continue

      // #359: mark parent so we can suppress native ::before/::after in cloned <style> (avoids double render)
      if (pseudo === '::before') {
        clone.dataset.snapdomHasBefore = '1'
        clone.insertBefore(pseudoEl, clone.firstChild)
      } else {
        clone.dataset.snapdomHasAfter = '1'
        clone.appendChild(pseudoEl)
      }
    } catch (e) {
      console.warn(`[snapdom] Failed to capture ${pseudo} for`, source, e)
    }
  }

  // Recurse – use nodeMap (clone→source) for alignment instead of index,
  // because deepClone filters out NO_CAPTURE_TAGS (script, link, etc.),
  // which causes index mismatch between source.children and clone.children.
  const cChildren = Array.from(clone.children).filter((child) => !child.dataset.snapdomPseudo)
  if (sessionCache.nodeMap) {
    for (const cChild of cChildren) {
      const sChild = sessionCache.nodeMap.get(cChild)
      if (sChild?.nodeType === 1) {
        await inlinePseudoElements(sChild, cChild, sessionCache, options, true)
      }
    }
  } else {
    const sChildren = Array.from(source.children)
    for (let i = 0; i < Math.min(sChildren.length, cChildren.length); i++) {
      await inlinePseudoElements(sChildren[i], cChildren[i], sessionCache, options, true)
    }
  }
}
