/**
 * Stylesheet-driven property universe.
 *
 * A property leaves its UA default only through author CSS or animation, so the snapshot
 * reads only what the sheets can touch plus ALWAYS_PROPS, not all ~400 (8-9x faster reads at
 * 45 props, on all three engines). Escape hatches:
 * - An unreadable (cross-origin) sheet makes it null (full reads), unless the caller hands a
 *   parsed copy (styles.js fetches one per href).
 * - Shadow sheets are unioned per capture (scanSheetProps); without a session, full reads.
 * - Inline-style props are unioned per node at snapshot time, WAAPI keyframe props here.
 * @module styleScan
 */

/** Properties an author rule can set on an SVG shape that its presentation attributes also
 *  carry: geometry, transforms and vector-effect. SVG shapes get no style snapshot (see
 *  NO_DEFAULTS_TAGS), so clone.js copies these from computed style, and only the ones some
 *  rule or animation actually declares (`svgGeometry` of the scan). */
export const SVG_GEOMETRY_PROPS = new Set([
  'r', 'cx', 'cy', 'rx', 'ry', 'x', 'y', 'width', 'height', 'd',
  'transform', 'translate', 'rotate', 'scale', 'transform-origin', 'transform-box', 'vector-effect',
])

/** WebKit lists `transform-origin` in a rule's declarations as its -x/-y/-z longhands.
 *  True when `prop` is one of SVG_GEOMETRY_PROPS. */
function addSvgGeometry(set, prop) {
  if (SVG_GEOMETRY_PROPS.has(prop)) set.add(prop)
  else if (prop.startsWith('transform-origin-')) set.add('transform-origin')
  else return false
  return true
}

/** A rule that can start an animation or transition: the selectors of these join the SVG
 *  geometry gate when some @keyframes animates a geometry prop, since the element is reached
 *  through the rule that names the animation, not the keyframe. */
const SVG_ANIM_RE = /^(?:animation|transition)/

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
  // These can be inherited from an inline-styled ancestor outside the capture, without
  // any stylesheet declaration for the scanner to find.
  'writing-mode', 'text-orientation',
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

// What a pseudo's snapshot reads. A `::before` has no inline style or attributes, so a
// NON-inherited property moves only through a rule naming the pseudo (`pseudoProps`), an
// inherited one only through the element. The box props are what getStyleKey and the pseudo
// pass read back. Deep tree with a ::before per leaf: ~130 reads per pseudo down to ~45.
const INHERITED_PROPS = [
  'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-variant',
  'font-kerning', 'font-feature-settings', 'font-variation-settings', 'line-height', 'letter-spacing',
  'word-spacing', 'white-space', 'text-align', 'text-align-last', 'text-indent', 'text-transform',
  'text-shadow', 'text-rendering', 'direction', 'unicode-bidi', 'word-break', 'overflow-wrap',
  'writing-mode', 'text-orientation',
  'hyphens', 'tab-size', 'visibility', 'list-style-type', 'list-style-position', 'list-style-image',
  'border-collapse', 'border-spacing', 'caption-side', 'empty-cells', 'quotes',
  'color-scheme', '-webkit-text-fill-color', '-webkit-font-smoothing', 'image-rendering',
]
// Inherited but not listed: caret-color (no caret on a pseudo) and the text-stroke pair. A
// stroke on the ELEMENT reaches the span by inheritance, one on the pseudo is in pseudoProps.
// Read by name, they keyed the same pseudo differently depending on the DOCUMENT universe.
const PSEUDO_BOX_PROPS = ['display', 'width', 'height', 'min-width', 'min-height']
// Every pseudo regex below refuses a backslash-escaped colon: Tailwind's
// `.md\:after\:h-0\.5::after` would read `\:after` as a pseudo, and the stripped selector was
// invalid and poisoned the joined gate (59k errors, +3.9 s on a 3,094-node diagram,
// math280h/diagrams#146). Pinned by __tests__/module.styleScan.test.js.
// No lookbehind anywhere in src: JavaScriptCore before Safari 16.4 rejects it while PARSING
// the literal, so the import alone blanked the page on iOS 16.0 to 16.3 (#567, 3.7.1 to
// 3.7.5). Pinned by scripts/verify-legacy-bundle.mjs.
const PSEUDO_ELEMENT_SEL_RE = /(?:^|[^\\])::?(?:before|after|first-letter|first-line|marker)/

/** Rule budget for one scan. Past it the scan answers unreliable, and every reader falls
 *  back to full reads. */
const MAX_SCAN_RULES = 20000

/** Margin/padding values that can make two identity twins resolve DIFFERENTLY, since
 *  getComputedStyle answers the USED value (a % margin resolves against the parent's width,
 *  the same on chromium/firefox/webkit). One anywhere makes the share re-read that family per
 *  node. Fixed lengths (px/em/rem) compute the same for twins by construction. */
const UNSTABLE_LAYOUT_VALUE_RE = /%|\bauto\b|calc\(|var\(/i

/** The pseudo-elements pseudo.js resolves. The universe walk collects, per kind, the selectors
 *  that can generate it, so one `el.matches()` gates three getComputedStyle reads per node. */
const PSEUDO_KINDS = {
  before: /(?:^|[^\\])::?before\b/, after: /(?:^|[^\\])::?after\b/,
  firstLetter: /(?:^|[^\\])::?first-letter\b/,
  // marker/firstLine are not probed per node: matching elements get a scoped CSS rule
  // (markers re-render natively in the foreignObject; first-line re-fragments there).
  marker: /(?:^|[^\\])::marker\b/, firstLine: /(?:^|[^\\])::?first-line\b/,
}
// The first alternative consumes an escape pair and `$1` writes it back, so an escaped colon
// is never the start of a match and the character before a pseudo is never eaten.
const PSEUDO_STRIP = /(\\.)|::?(?:before|after|first-letter|first-line|marker)\b/g
/** A selector that can restyle a retained sibling: a sibling combinator (An+B's `+` included,
 *  conservatively), `:has()`, or a filtered nth-child. */
const LEAK_SEL_RE = /[+~]|:has\(|:nth-(?:last-)?child\([^)]*\bof\b/i

/** Strips pseudo-element tokens from a selector list so it can feed `el.matches()`.
 *  A part that was ONLY the pseudo (`::before {}`) becomes `*` (pseudo-elements are not
 *  allowed inside :is()/:where(), so top-level empty parts are the only ones possible). */
function stripPseudo(selectorText) {
  const s = selectorText.replace(PSEUDO_STRIP, '$1').trim()
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
    // Read once: Gecko and WebKit serialize the selector on every read.
    const sel0 = rule.selectorText
    let svgGeo = false, svgAnim = false, container = false
    if (style) {
      const pseudoRule = !!sel0 && PSEUDO_ELEMENT_SEL_RE.test(sel0)
      for (let j = 0; j < style.length; j++) {
        const prop = style[j]
        universe.add(prop)
        if (state.svgGeometry) {
          if (addSvgGeometry(state.svgGeometry, prop)) svgGeo = true
          else if (SVG_ANIM_RE.test(prop)) svgAnim = true
        }
        if (pseudoRule) state.pseudoProps.add(prop)
        if (prop === 'container-type' && style.getPropertyValue(prop) !== 'normal') container = true
        if (style.getPropertyPriority(prop)) state.importantProps.add(prop)
        // Counters restyle retained siblings. The counter longhands have no shorthand, so a
        // rule that sets one lists it here. Chromium lists `all` unexpanded.
        if (!state.leaksAcrossSubtrees && (prop === 'all' || (prop[0] === 'c' && (prop.startsWith('counter-') ||
          (prop === 'content' && style.getPropertyValue('content').includes('counter')))))) state.leaksAcrossSubtrees = true
        if (prop.length > 5 && (prop[0] === 'm' || prop[0] === 'p')) {
          const fam = prop.startsWith('margin') ? 'marginUnstable'
            : prop.startsWith('padding') ? 'paddingUnstable' : null
          if (fam && !state[fam] && UNSTABLE_LAYOUT_VALUE_RE.test(style.getPropertyValue(prop))) {
            state[fam] = true
          }
        }
      }
    }
    let sel = sel0
    // A mutation cannot be walked back through `:has()`: it restyles ancestors and, with a
    // combinator, their other descendants. Its documents keep document-wide invalidation
    // (nodeStamp in changes.js).
    if (sel && sel.includes(':has(')) state.usesHas = true
    // A class change can shift filtered nth positions without dirtying the siblings.
    // Keep the existing conservative combinator check (including An+B's '+').
    // This rides the import/cross-origin-aware walk instead of scanning sheets again.
    if (!state.leaksAcrossSubtrees && sel && LEAK_SEL_RE.test(sel)) state.leaksAcrossSubtrees = true
    // CSS nesting: matches() RETURNS FALSE for `& .feat::before` instead of throwing, so an
    // unresolved & gates every node out and deletes the pseudo. Resolve & against the
    // enclosing style rule, past grouping rules (no selectorText). Above the share gate, which
    // feeds querySelector and would go silent the same way.
    if (sel && sel.includes('&')) {
      for (let p = rule.parentRule; p && sel.includes('&'); p = p.parentRule) {
        if (p.selectorText) sel = sel.replace(/&/g, `:is(${p.selectorText})`)
      }
    }
    // Selectors that can split identity twins: position, siblings, UA state, :has(), and every
    // rule inside or making a query container (`10cqw`: a 30px padding painted 10px).
    // Collected, not flagged: styleShareSafe asks the CAPTURED SUBTREE, and a document flag over
    // one `.btn:hover` cost a 500-row capture 536k reads instead of 77k.
    // Pinned by __tests__/module.styles.shareContainerUnits.test.js and sharePseudoGate.test.js.
    if (sel && (container || state.inContainer || SHARE_UNSAFE_RE.test(sel) || sel.includes('+') || sel.includes('~'))) {
      for (const part of splitTopLevel(sel, ',')) {
        const one = part.trim()
        if (one && (container || state.inContainer || SHARE_UNSAFE_RE.test(one) || one.includes('+') || one.includes('~'))) {
          // `x-card:nth-child(2)::part(title)` splits what two hosts hold: gate it by its host.
          // Pseudos are stripped: querySelector never matches `li:nth-child(odd)::before`.
          const bare = one.replace(/::part\([^)]*\)/g, '') || '*'
          state.shareUnsafeSels.add(PSEUDO_ELEMENT_SEL_RE.test(bare) ? stripPseudo(bare) : bare)
        }
      }
    }
    if (svgGeo || svgAnim) addSvgGeometrySel(rule, sel, svgGeo, state)
    if (sel && sel.includes(':')) {
      for (const kind in PSEUDO_KINDS) {
        if (PSEUDO_KINDS[kind].test(sel)) pseudoSels[kind].push(stripPseudo(sel))
      }
    }
    if (rule.styleSheet) { // @import
      if (!scanSheet(rule.styleSheet, universe, pseudoSels, state)) return false
    } else if (rule.cssRules && rule.cssRules.length) { // @media/@supports/@keyframes/…
      // constructor.name instead of instanceof: a rule from an iframe document belongs to
      // that window's CSSContainerRule, so the parent realm's constructor never claims it.
      const containerRule = rule.constructor?.name === 'CSSContainerRule'
      const scope = rule.constructor?.name === 'CSSScopeRule'
      // A container that changes size restyles its descendants with no record on them.
      if (containerRule) { state.inContainer++; state.leaksAcrossSubtrees = true }
      if (scope) state.inScope = (state.inScope || 0) + 1
      const ok = scanRules(rule.cssRules, universe, pseudoSels, state)
      if (containerRule) state.inContainer--
      if (scope) state.inScope--
      if (!ok) return false
    }
  }
  return true
}

/** Record which elements a geometry-declaring rule can reach, as matches()-able selectors.
 *  A keyframe only flags that its animating rules count (svgAnimSels); a declaration block
 *  with no selector of its own, or one inside @scope (relative selectors), gives up the
 *  selector gate and leaves the per-property gate alone. */
function addSvgGeometrySel(rule, sel, geo, state) {
  if (geo && rule.constructor?.name === 'CSSKeyframeRule') { state.svgKeyframes = true; return }
  if (!sel || state.inScope) { if (geo) state.svgGeometryAll = true; return }
  const into = geo ? state.svgGeometrySels : state.svgAnimSels
  for (const part of splitTopLevel(sel, ',')) {
    const one = part.trim()
    if (one) into.add(PSEUDO_ELEMENT_SEL_RE.test(one) ? stripPseudo(one) : one)
  }
}

/** A sheet's rules, or the caller's copy of them when the getter throws (cross-origin). */
function rulesOf(sheet, crossOriginRules) {
  try { return sheet.cssRules } catch { return crossOriginRules?.(sheet) }
}

/** One sheet through scanRules. False on a sheet whose rules cannot be read. */
function scanSheet(sheet, universe, pseudoSels, state) {
  const rules = rulesOf(sheet, state.crossOriginRules)
  if (!rules) return false
  return scanRules(rules, universe, pseudoSels, state)
}

/**
 * Add the properties WAAPI keyframes animate to `universe`. Programmatic animations live in no
 * stylesheet, and `document.getAnimations()` misses the ones inside shadow roots on all three
 * engines, so styles.js also passes each root's own list.
 * @param {Animation[]} animations
 * @param {Set<string>} universe
 */
export function addAnimationProps(animations, universe) {
  for (const anim of animations) {
    const frames = anim.effect?.getKeyframes?.() || []
    for (const frame of frames) {
      for (const key of Object.keys(frame)) {
        if (key === 'offset' || key === 'easing' || key === 'composite' || key === 'computedOffset') continue
        universe.add(key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()))
      }
    }
  }
}

/**
 * Collect the properties one stylesheet can set, for the shadow-root sheets scanAuthorStyles
 * never sees. styles.js memoizes it per sheet and unions the result per capture.
 * Pinned by __tests__/module.styles.shadowUniverse.test.js.
 * @param {CSSStyleSheet} sheet
 * @returns {Set<string>|null} null when the sheet is unreadable or blows the rule budget
 */
export function scanSheetProps(sheet) {
  const props = new Set()
  const pseudoSels = { before: [], after: [], firstLetter: [], marker: [], firstLine: [] }
  const state = { budget: MAX_SCAN_RULES, usesHas: false, leaksAcrossSubtrees: false, shareUnsafeSels: new Set(), inContainer: 0, marginUnstable: false, paddingUnstable: false, importantProps: new Set(), pseudoProps: new Set() }
  return scanSheet(sheet, props, pseudoSels, state) ? props : null
}

/** Sheets with at most this many top-level rules also list each rule's own child count. */
const CENSUS_NESTED_MAX = 64

/**
 * List what a document scan reads, cheap enough to compare instead of scanning again. A short
 * sheet also lists each top-level rule's child count, where libraries insert into `@media` or
 * `@layer` groups. Not seen, left to `invalidate: true`: an in-place edit, a delete plus an
 * insert keeping the count and both ends, an insert deeper or in a longer sheet. Null for an
 * unreadable sheet or one with an @import, whose late load changes nothing listed.
 * Pinned by __tests__/module.styles.ruleEpoch.test.js.
 * @param {Document} doc
 * @param {(sheet: CSSStyleSheet) => CSSRuleList|null} [crossOriginRules] - as scanAuthorStyles
 * @returns {Array<unknown>|null}
 */
export function sheetCensus(doc, crossOriginRules) {
  const out = []
  const adopted = /** @type {any} */ (doc).adoptedStyleSheets
  for (const sheets of [doc.styleSheets, Array.isArray(adopted) ? adopted : []]) {
    for (const sheet of sheets) {
      const rules = rulesOf(sheet, crossOriginRules)
      if (!rules) return null
      const n = rules.length
      // @import can only follow @charset and @layer statements, which report type 0.
      for (let i = 0; i < n; i++) {
        const type = rules[i].type
        if (type === 3) return null
        if (type !== 0) break
      }
      out.push(rules, n, rules[0], rules[n - 1])
      if (n <= CENSUS_NESTED_MAX) for (let i = 0; i < n; i++) out.push(rules[i].cssRules?.length)
    }
  }
  if (typeof doc.getAnimations === 'function') {
    const animated = new Set()
    addAnimationProps(doc.getAnimations(), animated)
    out.push(Array.from(animated).sort().join())
  }
  return out
}

/** Splits `sel` on `sep` outside parentheses, brackets and quotes. */
export function splitTopLevel(sel, sep) {
  if (!sel.includes(sep)) return [sel]
  const out = []
  let depth = 0, quote = null, start = 0
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i]
    if (c === '\\') { i++; continue }
    if (quote) { if (c === quote) quote = null; continue }
    if (c === '"' || c === '\'') quote = c
    else if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (depth === 0 && c === sep) { out.push(sel.slice(start, i)); start = i + 1 }
  }
  out.push(sel.slice(start))
  return out
}

/** A necessary condition for `sel` to match an element, as a cheap subtree-presence key:
 *  the first class, else id, else tag of its RIGHTMOST compound; null = always a candidate.
 *  Querying Tailwind's thousands of `.hover\:x:hover` rules against a 3000-node subtree cost
 *  55 ms (276 ms at 15k); the index makes the gate O(nodes + rules). */
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
 *  none, null when the joined result cannot be trusted. A & left after resolution (top-level
 *  nesting) parses but never matches, which is worse than no gate, so null. */
function joinGate(probe, parts) {
  if (!parts.length) return ''
  if (parts.some((p) => p.includes('&'))) return null
  const sel = parts.join(',')
  try { probe.matches(sel); return sel } catch { return null }
}

/** Joins collected per-kind selectors into one matches()-ready string, validated once (an
 *  unparsable one gives null, and callers probe every node). `q` is always included for
 *  before/after: UA open/close-quote pseudos have no author rule. */
function composePseudoGates(probe, pseudoSels) {
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
 *  (href-less anchors differ) but `:visited` is not: getComputedStyle answers unvisited
 *  values for privacy, so it cannot split identical elements. */
const SHARE_UNSAFE_RE = /:(nth-|first-child|last-child|only-|first-of-type|last-of-type|empty|hover|focus|active|target|checked|indeterminate|disabled|enabled|read-only|read-write|placeholder-shown|autofill|valid|invalid|user-valid|user-invalid|in-range|out-of-range|required|optional|default|link|any-link|scope|defined|modal|fullscreen|picture-in-picture|playing|paused|muted|seeking|buffering|stalled|volume-locked|open|popover-open|state\(|dir\(|lang\(|has\()/

/** What in a shadow root's own CSS text can split two nodes of one identity. Hover, focus and
 *  active are left out: styleShare asks the host, which matches them whenever something in
 *  its tree does. A false positive costs the share, nothing else. */
export const SHADOW_SPLIT_RE = new RegExp(SHARE_UNSAFE_RE.source.replace('hover|focus|active|', '') +
  '|[+~]|@container|container-|\\dcq[whibm]|:host(?:-context)?\\(|::slotted\\(|sibling-|random\\(')

/**
 * Scan the document's author styles once: sheets, adopted sheets, WAAPI keyframes. Pure;
 * changes.js memoizes it per epoch and keeps it while sheetCensus reads the same (scanFor).
 * When the scan cannot be trusted (cross-origin sheet, budget blown) every field is unreliable.
 * - `universe`: the properties any rule can touch, plus ALWAYS_PROPS; null if unreliable.
 * - `pseudoUniverse`: what a pseudo's snapshot reads.
 * - `pseudoGates`: one `el.matches()` selector per kind; '' skips every node, null probes all.
 * - `usesHas`: a `:has()` rule turns per-node stamp narrowing off.
 * - `leaksAcrossSubtrees`: a rule can restyle retained nodes, so diff takes the full pipeline.
 * - `shareGate`: selectors that can split identity twins, with subject keys; null = share off.
 * - `marginUnstable` / `paddingUnstable`: a %, auto, calc() or var() value; twins re-read it.
 * - `importantProps`: every property some rule declares `!important`.
 * Pinned by __tests__/module.styleScan.test.js.
 * @param {Document} doc
 * @param {(sheet: CSSStyleSheet) => CSSRuleList|null} [crossOriginRules] - the rules of a sheet
 *   whose cssRules throw, read from a copy; null keeps the scan unreliable
 * @returns {{universe: Set<string>|null, pseudoUniverse: Set<string>|null, svgGeometry: Set<string>|null, svgGeometrySel: string|null, pseudoGates: {before: string|null, after: string|null, firstLetter: string|null, marker: string|null, firstLine: string|null}, usesHas: boolean, leaksAcrossSubtrees: boolean, shareGate: Array<{sel: string, key: string|null}>|null, marginUnstable: boolean, paddingUnstable: boolean, importantProps: Set<string>|null}}
 */
export function scanAuthorStyles(doc, crossOriginRules) {
  // usesHas true on the unreliable path: a scan that could not read every rule cannot promise
  // the document has no `:has()`, and the narrowing must only run on a promise.
  const unreliable = { universe: null, pseudoUniverse: null, svgGeometry: null, svgGeometrySel: null, usesHas: true, leaksAcrossSubtrees: true, shareGate: null, marginUnstable: true, paddingUnstable: true, importantProps: null, pseudoGates: { before: null, after: null, firstLetter: null, marker: null, firstLine: null } }
  try {
    const universe = new Set(ALWAYS_PROPS)
    const pseudoSels = { before: [], after: [], firstLetter: [], marker: [], firstLine: [] }
    const state = { budget: MAX_SCAN_RULES, usesHas: false, leaksAcrossSubtrees: false, shareUnsafeSels: new Set(), inContainer: 0, marginUnstable: false, paddingUnstable: false, importantProps: new Set(), pseudoProps: new Set(), svgGeometry: new Set(), svgGeometrySels: new Set(), svgAnimSels: new Set(), svgKeyframes: false, svgGeometryAll: false, inScope: 0, crossOriginRules }
    const adopted = /** @type {any} */ (doc).adoptedStyleSheets
    const sheets = Array.isArray(adopted) ? [...doc.styleSheets, ...adopted] : Array.from(doc.styleSheets)
    // Every top-level rule spends one unit of the budget, so a document whose top-level rules
    // alone exceed it, or with a sheet nobody can read, is unreliable before the walk.
    let top = 0
    for (const sheet of sheets) {
      const rules = rulesOf(sheet, crossOriginRules)
      if (!rules) return unreliable
      top += rules.length
    }
    if (top > MAX_SCAN_RULES) return unreliable
    for (const sheet of sheets) {
      if (!scanSheet(sheet, universe, pseudoSels, state)) return unreliable
    }
    // Programmatic (WAAPI) animations live in no stylesheet: union their keyframe props.
    if (typeof doc.getAnimations === 'function') {
      const animated = new Set()
      addAnimationProps(doc.getAnimations(), animated)
      for (const p of animated) {
        universe.add(p)
        // A WAAPI animation targets elements, not selectors: no selector gate then.
        if (addSvgGeometry(state.svgGeometry, p)) state.svgGeometryAll = true
      }
    }
    if (state.svgKeyframes) for (const one of state.svgAnimSels) state.svgGeometrySels.add(one)
    const probe = doc.createElement('div')
    // Validated once here: a raw join handed svgGeometryReaches one SyntaxError per SVG
    // element when a single part could not parse, and its catch answered true for all of them.
    const svgGeometrySel = state.svgGeometryAll ? null : joinGate(probe, Array.from(state.svgGeometrySels))
    // shareGate: null = a splitting selector the engine cannot match against (share off),
    // else the indexed list styleShareSafe filters by subtree presence and queries with.
    const shareSels = Array.from(state.shareUnsafeSels)
    const shareGate = joinGate(probe, shareSels) === null
      ? null
      : shareSels.map((sel) => ({ sel, key: subjectKeyOf(sel) }))
    const pseudoUniverse = new Set(PSEUDO_BOX_PROPS)
    for (const p of INHERITED_PROPS) if (universe.has(p)) pseudoUniverse.add(p)
    for (const p of state.pseudoProps) pseudoUniverse.add(p)
    // The origins read as used px against the pseudo's own box (`7px 7px`), never as their
    // UA default, so a transformed pseudo needs its origin read though no rule names it.
    // Without it the pseudo took the base `0px 0px` and scaled toward its corner (#509).
    if (state.pseudoProps.has('transform') || state.pseudoProps.has('rotate') || state.pseudoProps.has('scale')) pseudoUniverse.add('transform-origin')
    if (state.pseudoProps.has('perspective')) pseudoUniverse.add('perspective-origin')
    return { universe, pseudoUniverse, svgGeometry: state.svgGeometry, svgGeometrySel, pseudoGates: composePseudoGates(probe, pseudoSels), usesHas: state.usesHas, leaksAcrossSubtrees: state.leaksAcrossSubtrees, shareGate, marginUnstable: state.marginUnstable, paddingUnstable: state.paddingUnstable, importantProps: state.importantProps }
  } catch {
    return unreliable
  }
}
