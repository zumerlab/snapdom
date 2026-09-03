/**
 * Stylesheet-driven property universe.
 *
 * A page can only move a computed property away from its UA default through author CSS
 * (rules, inline styles, keyframes) or programmatic animation. Scanning the document's
 * stylesheets once yields the set of properties any rule can touch; the per-node style
 * snapshot then reads ONLY those plus a fixed always-list, instead of enumerating all
 * ~400 computed properties per node — the dominant cost of a capture (measured 8-9x
 * faster reads at 45 props, cross-engine).
 *
 * Correctness: a property outside the universe can't differ from the tag's UA default,
 * so the defaults-diff downstream would have dropped it anyway. Escape hatches:
 * - Any unreadable (cross-origin) stylesheet → null (callers fall back to full reads).
 * - Shadow-root content is snapshotted with full reads (its sheets aren't scanned).
 * - Element inline-style props are unioned in per node at snapshot time.
 * - Web Animations API keyframe props are unioned in (CSS animations come from rules).
 * @module styleScan
 */

/** Properties always read regardless of what the page's CSS mentions: layout and text
 *  essentials, plus everything presentational HTML attributes (width=, bgcolor=, dir=,
 *  align=…) can set without appearing in any stylesheet. Longhands, matching what
 *  computed-style enumeration lists (the defaults cache diffs per longhand). */
export const ALWAYS_PROPS = [
  // box / layout
  'display', 'position', 'top', 'right', 'bottom', 'left', 'float', 'clear', 'z-index',
  'box-sizing', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'overflow-x', 'overflow-y', 'visibility', 'opacity', 'content-visibility', 'vertical-align',
  // border
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
  // flex / grid containers and items
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'order',
  'align-items', 'align-self', 'align-content', 'justify-content', 'justify-items', 'justify-self',
  'row-gap', 'column-gap',
  'grid-template-columns', 'grid-template-rows', 'grid-auto-flow', 'grid-auto-columns', 'grid-auto-rows',
  'grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end',
  // text / font
  'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch',
  'line-height', 'letter-spacing', 'word-spacing', 'white-space', 'text-align',
  'text-transform', 'text-indent', 'text-overflow', 'text-shadow', 'direction', 'unicode-bidi',
  'word-break', 'overflow-wrap', 'tab-size',
  'list-style-type', 'list-style-position', 'list-style-image',
  'counter-reset', 'counter-increment', 'counter-set',
  // visual
  'background-color', 'background-image', 'background-size', 'background-position',
  'background-repeat', 'background-clip', 'background-origin', 'background-attachment',
  'box-shadow', 'outline-width', 'outline-style', 'outline-color', 'outline-offset',
  'transform', 'transform-origin', 'rotate', 'scale', 'translate',
  'filter', 'mix-blend-mode', 'clip-path', 'object-fit', 'object-position',
  // tables
  'border-collapse', 'border-spacing', 'table-layout', 'caption-side', 'empty-cells',
]

// What a pseudo-element's snapshot needs to read. A `::before` has no inline style and no
// presentational attributes, so a NON-inherited property can only leave its UA default
// through a rule whose selector names the pseudo (collected per scan as `pseudoProps`);
// an inherited one only through the element, whose own snapshot already reads the universe.
// The box props are the ones getStyleKey and the pseudo pass read back (softening, the
// min-width floor). Deep tree with a ::before per leaf: ~130 reads per pseudo → ~45.
const INHERITED_PROPS = [
  'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-variant',
  'font-kerning', 'font-feature-settings', 'font-variation-settings', 'line-height', 'letter-spacing',
  'word-spacing', 'white-space', 'text-align', 'text-align-last', 'text-indent', 'text-transform',
  'text-shadow', 'text-rendering', 'direction', 'unicode-bidi', 'word-break', 'overflow-wrap',
  'hyphens', 'tab-size', 'visibility', 'list-style-type', 'list-style-position', 'list-style-image',
  'border-collapse', 'border-spacing', 'caption-side', 'empty-cells', 'quotes',
  'color-scheme', '-webkit-text-fill-color', '-webkit-font-smoothing', 'image-rendering',
]
// Not listed although inherited: caret-color (no caret on a pseudo) and the text-stroke pair.
// A stroke set on the ELEMENT reaches the pseudo span by inheritance inside the foreignObject
// (the span is the element clone's child), and one set on the pseudo is in pseudoProps. Read
// by name they made the pseudo's snapshot depend on whether the DOCUMENT universe happened to
// contain them — snapdom's own injected class CSS in a test page did — and two captures of
// the same pseudo keyed differently.
const PSEUDO_BOX_PROPS = ['display', 'width', 'height', 'min-width', 'min-height']
const PSEUDO_ELEMENT_SEL_RE = /::?(?:before|after|first-letter|first-line|marker)/

/** Rule budget for one scan. Past it the scan answers unreliable, and every reader falls
 *  back to full reads. */
const MAX_SCAN_RULES = 20000

/** Margin/padding values that can make two identity twins resolve DIFFERENTLY: their
 *  getComputedStyle value is the USED value (per-cent margins resolve against the parent's
 *  used width — verified identical behavior on chromium/firefox/webkit), so a %-, auto-,
 *  calc()- or var()-valued declaration anywhere in the document forces the identity-share
 *  hit path to keep re-reading that family per node. Fixed lengths (px/em/rem) compute
 *  identically for twins by construction — same matched rules, same inherited inputs. */
const UNSTABLE_LAYOUT_VALUE_RE = /%|\bauto\b|calc\(|var\(/i

/** The pseudo-elements the per-node probe in pseudo.js resolves. The same rule walk that
 *  builds the property universe collects, per kind, the selectors able to generate that
 *  pseudo — so the probe can be gated by one `el.matches()` instead of three
 *  getComputedStyle resolutions per node. */
const PSEUDO_KINDS = {
  before: /::?before\b/, after: /::?after\b/, firstLetter: /::?first-letter\b/,
  // marker/firstLine aren't probed per node — matching elements get a scoped CSS rule
  // (markers re-render natively in the foreignObject; first-line re-fragments there).
  marker: /::marker\b/, firstLine: /::?first-line\b/,
}
const PSEUDO_STRIP = /::?(?:before|after|first-letter|first-line|marker)\b/g

/** Strips pseudo-element tokens from a selector list so it can feed `el.matches()`.
 *  A part that was ONLY the pseudo (`::before {}`) becomes `*` (pseudo-elements are not
 *  allowed inside :is()/:where(), so top-level empty parts are the only ones possible). */
function stripPseudo(selectorText) {
  const s = selectorText.replace(PSEUDO_STRIP, '').trim()
  if (!s) return '*'
  return s.replace(/(^|,)(\s*)(?=,|$)/g, '$1$2*')
}

/** Walks a CSSRuleList adding every set property name to `universe` and every
 *  pseudo-generating selector to `pseudoSels`.
 *  Returns false when an unreadable sheet or the rule budget makes the scan unreliable. */
function scanRules(rules, universe, pseudoSels, state) {
  for (let i = 0; i < rules.length; i++) {
    if (--state.budget < 0) return false
    const rule = rules[i]
    const style = rule.style
    if (style) {
      const pseudoRule = !!rule.selectorText && PSEUDO_ELEMENT_SEL_RE.test(rule.selectorText)
      for (let j = 0; j < style.length; j++) {
        const prop = style[j]
        universe.add(prop)
        if (pseudoRule) state.pseudoProps.add(prop)
        if (style.getPropertyPriority(prop)) state.importantProps.add(prop)
        if (prop.length > 5 && (prop[0] === 'm' || prop[0] === 'p')) {
          const fam = prop.startsWith('margin') ? 'marginUnstable'
            : prop.startsWith('padding') ? 'paddingUnstable' : null
          if (fam && !state[fam] && UNSTABLE_LAYOUT_VALUE_RE.test(style.getPropertyValue(prop))) {
            state[fam] = true
          }
        }
      }
    }
    let sel = rule.selectorText
    // `:has()` is the one selector whose reach a DOM mutation cannot be walked back from — it
    // restyles ancestors AND, combined with a combinator, their other descendants. A document
    // that uses it keeps document-wide style invalidation (see nodeStamp in styles.js).
    if (sel && sel.includes(':has(')) state.usesHas = true
    // CSS nesting: `& .feat::before` is not a matches()-able selector, and matches()
    // RETURNS FALSE for it instead of throwing — so an unresolved & would silently gate
    // every node out and delete the pseudo. Resolve & against the enclosing style rule,
    // walking past grouping rules (@media/@supports have no selectorText). Hoisted above
    // the share gate, which feeds querySelector and would be silenced the same way.
    if (sel && sel.includes('&')) {
      for (let p = rule.parentRule; p && sel.includes('&'); p = p.parentRule) {
        if (p.selectorText) sel = sel.replace(/&/g, `:is(${p.selectorText})`)
      }
    }
    // Selectors that can style two elements with IDENTICAL tag + attributes + ancestor chain
    // DIFFERENTLY: structural position, sibling relationships, interaction/UA state, and
    // :has() (content-dependent). Collected, not flagged: whether one of them can split a
    // pair of twins is a question about the CAPTURED SUBTREE at capture time
    // (styleShareSafe in styles.js asks it with one querySelector), not about the document.
    // A document-wide flag turned the fast path off on every real page — `.btn:hover` or
    // `.faq p + p` in the host CSS, matching nothing inside the captured table, cost a 500-row
    // capture 536k computed-style reads instead of 77k. A substring test, deliberately
    // conservative: a false positive only adds a selector to the gate.
    // A rule inside @container styles by the CONTAINER's size, which twins under
    // different-width parents do not share (measured: the narrow twin's colour painted onto
    // the wide one), so every selector in there joins the gate too.
    if (sel && (state.inContainer || SHARE_UNSAFE_RE.test(sel) || sel.includes('+') || sel.includes('~'))) {
      for (const part of splitTopLevel(sel, ',')) {
        const one = part.trim()
        if (one && (state.inContainer || SHARE_UNSAFE_RE.test(one) || one.includes('+') || one.includes('~'))) state.shareUnsafeSels.add(one)
      }
    }
    if (sel && sel.includes(':')) {
      for (const kind in PSEUDO_KINDS) {
        if (PSEUDO_KINDS[kind].test(sel)) pseudoSels[kind].push(stripPseudo(sel))
      }
    }
    if (rule.styleSheet) { // @import
      if (!scanSheet(rule.styleSheet, universe, pseudoSels, state)) return false
    } else if (rule.cssRules && rule.cssRules.length) { // @media/@supports/@keyframes/…
      const container = typeof CSSContainerRule !== 'undefined' && rule instanceof CSSContainerRule
      if (container) state.inContainer++
      const ok = scanRules(rule.cssRules, universe, pseudoSels, state)
      if (container) state.inContainer--
      if (!ok) return false
    }
  }
  return true
}

/** One sheet through scanRules. False on a cross-origin sheet, whose cssRules getter throws. */
function scanSheet(sheet, universe, pseudoSels, state) {
  let rules
  try { rules = sheet.cssRules } catch { return false } // cross-origin
  if (!rules) return false
  return scanRules(rules, universe, pseudoSels, state)
}

/** Splits `sel` on `sep` outside parentheses, brackets and quotes. */
function splitTopLevel(sel, sep) {
  const out = []
  let depth = 0, quote = null, start = 0
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i]
    if (quote) { if (c === quote && sel[i - 1] !== '\\') quote = null; continue }
    if (c === '"' || c === '\'') quote = c
    else if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (depth === 0 && c === sep) { out.push(sel.slice(start, i)); start = i + 1 }
  }
  out.push(sel.slice(start))
  return out
}

/** A necessary condition for `sel` to match an element, as a cheap subtree-presence key:
 *  the first class, else the id, else the tag of its RIGHTMOST compound (the compound the
 *  subject itself must satisfy). null = no usable key, always a candidate. Tailwind-shaped
 *  sheets carry thousands of `.hover\:x:hover` rules; querying them all against a 3000-node
 *  subtree cost 55 ms, and 276 ms at 15k — the index makes the gate O(nodes + rules). */
function subjectKeyOf(sel) {
  let depth = 0, quote = null, cut = 0
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i]
    if (quote) { if (c === quote && sel[i - 1] !== '\\') quote = null; continue }
    if (c === '"' || c === '\'') quote = c
    else if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (depth === 0 && (c === ' ' || c === '>' || c === '+' || c === '~')) cut = i + 1
  }
  // Drop functional/attribute arguments: a class inside :not()/[…] is not a condition on the subject.
  let compound = '', d = 0
  for (const c of sel.slice(cut)) {
    if (c === '(' || c === '[') d++
    else if (c === ')' || c === ']') d--
    else if (d === 0) compound += c
  }
  const ident = (m) => {
    if (!m) return null
    if (/\\[0-9a-fA-F]/.test(m)) return null // hex escape: not worth decoding, stay a candidate
    return m.replace(/\\(.)/g, '$1')
  }
  const cls = ident((compound.match(/\.((?:\\.|[\w-])+)/) || [])[1])
  if (cls) return 'c' + cls
  const id = ident((compound.match(/#((?:\\.|[\w-])+)/) || [])[1])
  if (id) return 'i' + id
  const tag = (compound.match(/^([a-zA-Z][\w-]*)/) || [])[1]
  return tag ? 't' + tag.toLowerCase() : null
}

/** One matches()/querySelector-ready selector list from collected parts: '' when there are
 *  none, null when the joined result cannot be trusted. A & that survived resolution
 *  (top-level nesting) parses but can never match — worse than no gate, so null. */
function joinGate(probe, parts) {
  if (!parts.length) return ''
  if (parts.some((p) => p.includes('&'))) return null
  const sel = parts.join(',')
  try { probe.matches(sel); return sel } catch { return null }
}

/** Joins collected per-kind selectors into one matches()-ready string, validating the
 *  combined result once (an unparsable selector → null → callers probe every node).
 *  `q` is always included for before/after: UA open/close-quote pseudos have no author rule. */
function composePseudoGates(doc, pseudoSels) {
  const probe = doc.createElement('div')
  const gates = {}
  for (const kind in pseudoSels) {
    const parts = pseudoSels[kind]
    if (kind === 'before' || kind === 'after') parts.push('q')
    gates[kind] = joinGate(probe, parts)
  }
  return gates
}

/** See the share-gate note at the selector visitor. Pseudo-ELEMENTS are absent on purpose:
 *  ::before/::after do not change the HOST element's computed style. `:link` is included
 *  (href-less anchors differ) but `:visited` need not be — getComputedStyle deliberately
 *  answers with unvisited values for privacy, so it cannot split identical elements. */
const SHARE_UNSAFE_RE = /:(nth-|first-child|last-child|only-|first-of-type|last-of-type|empty|hover|focus|active|target|checked|indeterminate|disabled|enabled|read-only|read-write|placeholder-shown|autofill|valid|invalid|user-valid|user-invalid|in-range|out-of-range|required|optional|default|link|any-link|scope|defined|modal|fullscreen|picture-in-picture|playing|paused|dir\(|lang\(|has\()/

/**
 * Scans the document's author styles once: every sheet, the adopted sheets, WAAPI keyframes.
 * Pure; styles.js memoizes it per document and style epoch (scanFor).
 *
 * Everything in the result rides the same rule walk, so none of it costs a second pass:
 * - `universe`: the properties any rule can touch, plus ALWAYS_PROPS. Null when the scan
 *   cannot be trusted (a cross-origin sheet, the rule budget blown), and then every other
 *   field takes its unreliable value as well.
 * - `pseudoUniverse`: what a pseudo-element's snapshot reads (PSEUDO_BOX_PROPS, the inherited
 *   props the universe holds, the props pseudo rules declare).
 * - `pseudoGates`: per kind, one selector for `el.matches()`. '' means no rule, skip every
 *   node; null means unreliable, probe every node.
 * - `usesHas`: some rule uses `:has()`, which turns per-node stamp narrowing off. True when
 *   unreliable.
 * - `shareGate`: the selectors that can split identity twins, each with its subject key for
 *   styleShareSafe's presence index. Null when one cannot be matched (share off).
 * - `marginUnstable` / `paddingUnstable`: a %, auto, calc() or var() value in that family
 *   anywhere, so twins re-read it.
 * - `importantProps`: every property some rule declares `!important`.
 * Pinned by __tests__/module.styleScan.test.js.
 * @param {Document} doc
 * @returns {{universe: Set<string>|null, pseudoUniverse: Set<string>|null, pseudoGates: {before: string|null, after: string|null, firstLetter: string|null, marker: string|null, firstLine: string|null}, usesHas: boolean, shareGate: Array<{sel: string, key: string|null}>|null, marginUnstable: boolean, paddingUnstable: boolean, importantProps: Set<string>|null}}
 */
export function scanAuthorStyles(doc) {
  // usesHas true on the unreliable path: a scan that could not read every rule cannot promise
  // the document has no `:has()`, and the narrowing must only run on a promise.
  const unreliable = { universe: null, pseudoUniverse: null, usesHas: true, shareGate: null, marginUnstable: true, paddingUnstable: true, importantProps: null, pseudoGates: { before: null, after: null, firstLetter: null, marker: null, firstLine: null } }
  try {
    const universe = new Set(ALWAYS_PROPS)
    const pseudoSels = { before: [], after: [], firstLetter: [], marker: [], firstLine: [] }
    const state = { budget: MAX_SCAN_RULES, usesHas: false, shareUnsafeSels: new Set(), inContainer: 0, marginUnstable: false, paddingUnstable: false, importantProps: new Set(), pseudoProps: new Set() }
    for (const sheet of doc.styleSheets) {
      if (!scanSheet(sheet, universe, pseudoSels, state)) return unreliable
    }
    const adopted = /** @type {any} */ (doc).adoptedStyleSheets
    if (Array.isArray(adopted)) {
      for (const sheet of adopted) {
        if (!scanSheet(sheet, universe, pseudoSels, state)) return unreliable
      }
    }
    // Programmatic (WAAPI) animations don't live in stylesheets — union their keyframe props.
    if (typeof doc.getAnimations === 'function') {
      for (const anim of doc.getAnimations()) {
        const frames = anim.effect?.getKeyframes?.() || []
        for (const frame of frames) {
          for (const key of Object.keys(frame)) {
            if (key === 'offset' || key === 'easing' || key === 'composite' || key === 'computedOffset') continue
            universe.add(key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()))
          }
        }
      }
    }
    // shareGate: null = a splitting selector the engine cannot match against (share off),
    // else the indexed list styleShareSafe filters by subtree presence and queries with.
    const shareSels = Array.from(state.shareUnsafeSels)
    const shareGate = joinGate(doc.createElement('div'), shareSels) === null
      ? null
      : shareSels.map((sel) => ({ sel, key: subjectKeyOf(sel) }))
    const pseudoUniverse = new Set(PSEUDO_BOX_PROPS)
    for (const p of INHERITED_PROPS) if (universe.has(p)) pseudoUniverse.add(p)
    for (const p of state.pseudoProps) pseudoUniverse.add(p)
    return { universe, pseudoUniverse, pseudoGates: composePseudoGates(doc, pseudoSels), usesHas: state.usesHas, shareGate, marginUnstable: state.marginUnstable, paddingUnstable: state.paddingUnstable, importantProps: state.importantProps }
  } catch {
    return unreliable
  }
}
