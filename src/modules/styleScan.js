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

const MAX_SCAN_RULES = 20000

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
      for (let j = 0; j < style.length; j++) universe.add(style[j])
    }
    let sel = rule.selectorText
    // `:has()` is the one selector whose reach a DOM mutation cannot be walked back from — it
    // restyles ancestors AND, combined with a combinator, their other descendants. A document
    // that uses it keeps document-wide style invalidation (see nodeStamp in styles.js).
    if (sel && sel.includes(':has(')) state.usesHas = true
    if (sel && sel.includes(':')) {
      // CSS nesting: `& .feat::before` is not a matches()-able selector, and matches()
      // RETURNS FALSE for it instead of throwing — so an unresolved & would silently gate
      // every node out and delete the pseudo. Resolve & against the enclosing style rule,
      // walking past grouping rules (@media/@supports have no selectorText).
      for (let p = rule.parentRule; p && sel.includes('&'); p = p.parentRule) {
        if (p.selectorText) sel = sel.replace(/&/g, `:is(${p.selectorText})`)
      }
      for (const kind in PSEUDO_KINDS) {
        if (PSEUDO_KINDS[kind].test(sel)) pseudoSels[kind].push(stripPseudo(sel))
      }
    }
    if (rule.styleSheet) { // @import
      if (!scanSheet(rule.styleSheet, universe, pseudoSels, state)) return false
    } else if (rule.cssRules && rule.cssRules.length) { // @media/@supports/@keyframes/…
      if (!scanRules(rule.cssRules, universe, pseudoSels, state)) return false
    }
  }
  return true
}

function scanSheet(sheet, universe, pseudoSels, state) {
  let rules
  try { rules = sheet.cssRules } catch { return false } // cross-origin
  if (!rules) return false
  return scanRules(rules, universe, pseudoSels, state)
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
    if (!parts.length) { gates[kind] = '' ; continue } // no rules → probe nothing
    // A & that survived resolution (top-level nesting) parses but can never match — that is
    // worse than no gate at all, so fall back to probing every node.
    if (parts.some((p) => p.includes('&'))) { gates[kind] = null; continue }
    const sel = parts.join(',')
    try { probe.matches(sel); gates[kind] = sel } catch { gates[kind] = null }
  }
  return gates
}

/**
 * Scans the document's author styles once, returning:
 * - `universe`: the set of CSS properties any rule can touch, or null when the scan
 *   can't be trusted (cross-origin CSS, rule-budget blown).
 * - `pseudoGates`: per pseudo kind (before/after/firstLetter), a combined selector for
 *   `el.matches()` gating the per-node pseudo probe — `''` = no rules (skip every node),
 *   null = unreliable (probe every node). All null when universe is null.
 * Pure — memoization (per document + style epoch) is the caller's concern.
 * @param {Document} doc
 * @returns {{universe: Set<string>|null, pseudoGates: {before: string|null, after: string|null, firstLetter: string|null}}}
 */
export function scanAuthorStyles(doc) {
  // usesHas true on the unreliable path: a scan that could not read every rule cannot promise
  // the document has no `:has()`, and the narrowing must only run on a promise.
  const unreliable = { universe: null, usesHas: true, pseudoGates: { before: null, after: null, firstLetter: null, marker: null, firstLine: null } }
  try {
    const universe = new Set(ALWAYS_PROPS)
    const pseudoSels = { before: [], after: [], firstLetter: [], marker: [], firstLine: [] }
    const state = { budget: MAX_SCAN_RULES, usesHas: false }
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
    return { universe, pseudoGates: composePseudoGates(doc, pseudoSels), usesHas: state.usesHas }
  } catch {
    return unreliable
  }
}
