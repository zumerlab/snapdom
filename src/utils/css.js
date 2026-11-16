/**
 * The generated CSS a clone carries: tag defaults, per-element style keys, the base reset.
 *
 * A snapshot is diffed against the tag's defaults (`getDefaultStyleForTag`) into a style key
 * (`getStyleKey`); equal keys share one class (`generateCSSClasses`), and the defaults become
 * one factored reset (`generateDedupedBaseCSS`). The delicate part is width: a frozen used
 * width re-wraps text when the raster falls back to a wider font, so content-sized boxes get a
 * min-width floor instead (`softensWidth`, `softenNeedsAutoWidth`, the epsilon in getStyleKey).
 * @module utils/css
 */

// Tag sets, defined here once.

/** Tags that Snapdom must never capture (skip node + subtree). */
export const NO_CAPTURE_TAGS = new Set([
  'meta', 'script', 'noscript', 'title', 'link', 'template'
])

/** Tags that must not generate default styles nor auto-classes. */
export const NO_DEFAULTS_TAGS = new Set([
  // non-painting / head stuff
  'meta', 'link', 'style', 'title', 'noscript', 'script', 'template',
  // SVG whole namespace (safe for LeaderLine/presentation attrs)
  'g', 'defs', 'use', 'marker', 'mask', 'clipPath', 'pattern', 'symbol',
  'path', 'polygon', 'polyline', 'line', 'circle', 'ellipse', 'rect',
  'filter', 'lineargradient', 'radialgradient', 'stop'
])

import { cache } from '../core/cache'
import { ALWAYS_PROPS } from '../modules/styleScan'
import { isInternalNode, markInternalNode } from './ownership.js'

/**
 * A tag's default styles, memoized in cache.defaultStyle.
 *
 * Read from a fresh `all: initial` element in a hidden sandbox, so the map holds INITIAL
 * values, not the UA sheet's: the base reset re-states them inside the foreignObject, where
 * the UA sheet would add its own margins and paddings. getStyleKey keeps only what differs.
 * NO_DEFAULTS_TAGS get `{}`: no reset, no class.
 * @param {string} tagName
 * @returns {Record<string, string>}
 */
export function getDefaultStyleForTag(tagName) {
  tagName = String(tagName).toLowerCase()

  if (NO_DEFAULTS_TAGS.has(tagName)) {
    const empty = {}
    cache.defaultStyle.set(tagName, empty)
    return empty
  }

  if (cache.defaultStyle.has(tagName)) {
    return cache.defaultStyle.get(tagName)
  }

  // Duplicate ids are invalid but possible, and this public legacy id belongs to author DOM
  // unless private provenance says otherwise. Search every match so an author node appearing
  // first never gets reused as our measurement host.
  let sandbox = [...document.querySelectorAll('#snapdom-sandbox')].find(isInternalNode)
  if (!sandbox) {
    sandbox = document.createElement('div')
    markInternalNode(sandbox)
    sandbox.id = 'snapdom-sandbox'
    sandbox.setAttribute('data-snapdom-sandbox', 'true')
    sandbox.setAttribute('aria-hidden', 'true')
    sandbox.style.position = 'absolute'
    sandbox.style.left = '-9999px'
    sandbox.style.top = '-9999px'
    sandbox.style.width = '0px'
    sandbox.style.height = '0px'
    sandbox.style.overflow = 'hidden'
    document.body.appendChild(sandbox)
  }

  // Custom elements can override .style and run page code in their constructors (#505).
  // An unstyled span has the same initial CSS, including unicode-bidi (a div does not).
  const el = document.createElement(tagName.includes('-') ? 'span' : tagName)
  el.style.all = 'initial'
  sandbox.appendChild(el)

  const styles = getComputedStyle(el)
  const defaults = {}
  for (let prop of styles) {
    // Filter out noise that never paints, plus layout-dependent props
    if (shouldIgnoreProp(prop)) continue
    const value = styles.getPropertyValue(prop)
    defaults[prop] = value
  }
  // Chromium's enumeration skips counter-set/-reset/-increment, content-visibility and
  // white-space, which the snapshot reads by name (ALWAYS_PROPS). Without a default here every
  // class carried `counter-set:none;white-space:normal;…` as non-default.
  for (const prop of ALWAYS_PROPS) {
    if (!(prop in defaults) && !shouldIgnoreProp(prop)) defaults[prop] = styles.getPropertyValue(prop)
  }

  sandbox.removeChild(el)
  cache.defaultStyle.set(tagName, defaults)
  return defaults
}

/** Tokens "animation"/"transition" anywhere in the name (dash-bounded). */
const NO_PAINT_TOKEN = /(?:^|-)(animation|transition)(?:-|$)/i

/** Prefixes that never affect the static pixel of the frame. */
const NO_PAINT_PREFIX = /^(--.+|view-timeline|scroll-timeline|animation-trigger|offset-|position-try|app-region|interactivity|overlay|view-transition|-webkit-locale|-webkit-user-(?:drag|modify)|-webkit-tap-highlight-color|-webkit-text-security)$/i

/** Exact properties that do not render pixels (control/interaction/UA hints). */
const NO_PAINT_EXACT = new Set([
  // Interaction hints
  'cursor',
  'pointer-events',
  'touch-action',
  'user-select',
  // Printing/speech/reading-mode hints
  'print-color-adjust',
  'speak',
  'reading-flow',
  'reading-order',
  // Anchoring/container/timeline scopes (metadata for layout queries)
  'anchor-name',
  'anchor-scope',
  'container-name',
  'container-type',
  'timeline-scope',
  // #369: computed widths and heights already include CSS zoom. Zoom in the class zooms twice
  // inside the foreignObject and leaves blank sections.
  'zoom',
  // WebKit-only draft prop (Fill & Stroke on text, not SVG `stroke`). Re-stating its
  // transparent default in svg-as-image flips WebKit's text paint path and drops text-shadow.
  // Nobody authors it.
  'stroke-color',
])

/** Memo of shouldIgnoreProp by property name, the only input. It runs ~350×/node, so this turns
 * 1M+ regex tests per large capture into Map lookups. */
const _ignorePropCache = new Map()

/**
 * Returns true if a CSS property should be ignored because it does not affect
 * the static pixel output of a frame capture.
 * - Matches prefixes (fast path) and tokens (e.g., “...-animation-...”).
 * - Skips a curated set of exact property names.
 * @param {string} prop
 * @returns {boolean}
 */
export function shouldIgnoreProp(prop /*, tag */) {
  // Keyed on the raw name (computed-style iteration already yields lowercase), so a hit skips
  // the toLowerCase too.
  let r = _ignorePropCache.get(prop)
  if (r === undefined) {
    const p = String(prop).toLowerCase()
    r = NO_PAINT_EXACT.has(p) || NO_PAINT_PREFIX.test(p) || NO_PAINT_TOKEN.test(p)
    _ignorePropCache.set(prop, r)
  }
  return r
}

// Tags that size to text content; grid/flex blockify them, so a frozen used width wraps the
// text when the raster falls back to a wider font (e.g. the "Timestamp demo").
const INLINE_SIZED_TAGS = new Set(['span', 'small', 'em', 'strong', 'b', 'i', 'u', 's', 'code', 'cite', 'mark', 'sub', 'sup'])
// #429: the table box tree gets its used width from the table layout algorithm, not from CSS.
// Freezing that resolved width (e.g. 113.484px) pins the auto table, so when the SVG falls back
// to a wider font the content wraps (e.g. "✅ 2024-09-16" breaks at the space).
const TABLE_TAGS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th'])
// Replaced elements honor an explicit width even when display:inline (#436: an inline <img>
// with object-fit lost its width and rendered empty), so they are never softened.
const REPLACED_TAGS = new Set(['img', 'video', 'canvas', 'svg', 'iframe', 'embed', 'object', 'input', 'textarea', 'select'])
// Width longhands we never freeze as a hard value when softening (physical + logical).
const HARD_WIDTH_PROPS = new Set(['width', 'max-width', 'inline-size', 'max-inline-size'])
// MathML token elements are sized by their glyph. WebKit picks the italic glyph of an <mi>
// while computing the token's preferred width, a pass a frozen width skips: the formula came
// out upright (Playwright WebKit, demos/d-text-layout.html). Pinned by
// __tests__/snapdom.mathmlTokens.test.js.
const MATHML_TOKEN_TAGS = new Set(['mi', 'mn', 'mo', 'ms', 'mtext'])
// Min-width longhands: kept verbatim when authored (or set to 0 by #406 on flex/grid items).
const MIN_WIDTH_PROPS = new Set(['min-width', 'min-inline-size'])

/**
 * Logical box properties and the physical property they duplicate. Computed style lists both
 * forms, so about 14 of the 47 declarations of a typical class said the box twice, parsed again
 * by every rasterization. Imported from @frostin/snapdom (element-mirror).
 */
const LOGICAL_TO_PHYSICAL = new Map(Object.entries({
  'block-size': 'height',
  'inline-size': 'width',
  'min-block-size': 'min-height',
  'min-inline-size': 'min-width',
  'max-block-size': 'max-height',
  'max-inline-size': 'max-width',
  'margin-block-start': 'margin-top',
  'margin-block-end': 'margin-bottom',
  'margin-inline-start': 'margin-left',
  'margin-inline-end': 'margin-right',
  'padding-block-start': 'padding-top',
  'padding-block-end': 'padding-bottom',
  'padding-inline-start': 'padding-left',
  'padding-inline-end': 'padding-right',
  'inset-block-start': 'top',
  'inset-block-end': 'bottom',
  'inset-inline-start': 'left',
  'inset-inline-end': 'right',
  'border-block-start-width': 'border-top-width',
  'border-block-start-style': 'border-top-style',
  'border-block-start-color': 'border-top-color',
  'border-block-end-width': 'border-bottom-width',
  'border-block-end-style': 'border-bottom-style',
  'border-block-end-color': 'border-bottom-color',
  'border-inline-start-width': 'border-left-width',
  'border-inline-start-style': 'border-left-style',
  'border-inline-start-color': 'border-left-color',
  'border-inline-end-width': 'border-right-width',
  'border-inline-end-style': 'border-right-style',
  'border-inline-end-color': 'border-right-color',
  'border-start-start-radius': 'border-top-left-radius',
  'border-start-end-radius': 'border-top-right-radius',
  'border-end-start-radius': 'border-bottom-left-radius',
  'border-end-end-radius': 'border-bottom-right-radius',
  'overflow-block': 'overflow-y',
  'overflow-inline': 'overflow-x',
  'overscroll-behavior-block': 'overscroll-behavior-y',
  'overscroll-behavior-inline': 'overscroll-behavior-x',
  'contain-intrinsic-block-size': 'contain-intrinsic-height',
  'contain-intrinsic-inline-size': 'contain-intrinsic-width',
}))

/**
 * Whether `prop` says nothing its physical counterpart does not already say. Only a
 * byte-identical value counts: the engine resolves the two forms differently in places
 * (`min-width` gives `0px` where `min-inline-size` reports `auto`), and there the logical one
 * is load-bearing. Nothing is dropped outside horizontal-tb LTR, where the mapping changes.
 * @param {string} prop
 * @param {Record<string, string>} styles the map the declaration comes from
 * @returns {boolean}
 */
export function isRedundantLogicalProp(prop, styles) {
  const physical = LOGICAL_TO_PHYSICAL.get(prop)
  if (physical === undefined) return false
  if (styles[physical] !== styles[prop]) return false
  const writingMode = styles['writing-mode']
  if (writingMode && writingMode !== 'horizontal-tb') return false
  const direction = styles['direction']
  if (direction && direction !== 'ltr') return false
  return true
}
// Slack added to a frozen width or height to clear the computed-style serialization error
// (≤0.0005px below 1000px, where Blink's 6 significant digits are 3 decimals). Deliberately
// tiny: it is paid once per box and the shrink-to-fit parent holding a row of them is only paid
// once in total (#491).
const SIZE_EPSILON = 0.001

/**
 * Whether getStyleKey softens the width for this tag/display (inline-sized text tags, the table
 * box tree, or any real inline box; never replaced elements). Exposed so the caller can skip the
 * per-node content/flex bookkeeping for the vast majority of nodes that aren't affected.
 * @param {string} tagName
 * @param {string} display computed display (lowercase)
 * @returns {boolean}
 */
export function softensWidth(tagName, display) {
  return !REPLACED_TAGS.has(tagName) &&
    (display === 'inline' || INLINE_SIZED_TAGS.has(tagName) || TABLE_TAGS.has(tagName))
}

// Displays whose `width: auto` is shrink-to-fit: dropping the width and re-adding it as a
// min-width floor reproduces the used width exactly.
const SHRINK_TO_FIT_DISPLAYS = new Set([
  'inline-block', 'inline-flex', 'inline-grid', 'inline-table', 'inline-flow-root', 'table',
])

/**
 * Whether softening this box relies on its width being `auto`.
 *
 * The `min-width` floor reproduces a box only when `width: auto` is shrink-to-fit. Two shapes
 * break that (#484), and for them the caller keeps an author-specified width:
 *   - a blockified box in normal flow (`span { display: block; width: 16px }`): `auto`
 *     stretches it to the container and the box renders full width;
 *   - a flex/grid item, which gets no floor at all (#406) and collapses to its content.
 * Real inline boxes ignore `width` and the table box tree is sized by the table algorithm
 * (#429), so neither carries an author width worth keeping.
 * @param {string} tagName
 * @param {Record<string,string>} snapshot computed-style snapshot
 * @param {boolean} isFlexItem whether the element is a flex/grid item
 * @returns {boolean}
 */
export function softenNeedsAutoWidth(tagName, snapshot, isFlexItem) {
  const display = (snapshot.display || '').toLowerCase()
  if (display === 'inline') return false
  if (TABLE_TAGS.has(tagName)) return false
  if (isFlexItem) return true
  const float = (snapshot.float || 'none').toLowerCase()
  if (float !== 'none') return false
  const position = (snapshot.position || 'static').toLowerCase()
  if (position === 'absolute' || position === 'fixed') return false
  return !SHRINK_TO_FIT_DISPLAYS.has(display)
}

/**
 * Build an element's style key: the sorted `prop:value` pairs that differ from the tag's
 * defaults, joined by `;`. Equal keys share one generated class. "" for NO_DEFAULTS_TAGS.
 * The width softening and the epsilon are pinned by __tests__/snapdom.widthSoftening.test.js
 * and __tests__/snapdom.issue491.test.js.
 * @param {Record<string,string>} snapshot
 * @param {string} tagName
 * @param {boolean} [sizedByContent=true] whether the element is sized by its own content
 *   (text / child elements). Empty boxes sized by a CSS class keep their width verbatim.
 * @param {boolean} [isFlexItem=false] whether the element is a flex/grid item; those must stay
 *   shrinkable (#406), so they never get a synthesized min-width floor.
 * @param {string} [floor=''] the min-width the key carries in place of the snapshot's (the
 *   flex floor of inlineAllStyles); an argument, since copying the snapshot to hold it cost the
 *   first capture of 240 grid items 3%
 * @returns {string}
 */
export function getStyleKey(snapshot, tagName, sizedByContent = true, isFlexItem = false, floor = '') {
  tagName = String(tagName || '').toLowerCase()
  if (NO_DEFAULTS_TAGS.has(tagName)) {
    return '' // no key => no class
  }

  const entries = []
  const defaults = getDefaultStyleForTag(tagName)
  const display = (snapshot.display || '').toLowerCase()
  const isInline = display === 'inline'
  const softenTag = softensWidth(tagName, display)
  // Soften only a box sized by its content, where a frozen width wraps the text (#429) or pins
  // the table (#434). An empty box sized by a class (#433 inline-block span, ExtJS button-icon
  // spans) keeps its width. A box whose text cannot wrap (nowrap/pre) stays frozen (#474):
  // softened, it GROWS under raster metric drift, and in a min-content layout like KaTeX that
  // line-wraps its siblings, far worse than a sub-pixel overflow. Real inline boxes ignore
  // `width`, so dropping it there costs nothing.
  const noWrapMode = (snapshot['text-wrap-mode'] || snapshot['white-space'] || '')
  // A box whose own text cannot break can only clip sub-pixel, so it skips the width epsilon
  // below, whatever its tag or display (#491). The softening gate does depend on them.
  const noWrapBox = noWrapMode === 'nowrap' || noWrapMode === 'pre'
  const frozenNoWrap = softenTag && sizedByContent && !isInline && noWrapBox
  const soften = softenTag && sizedByContent && !frozenNoWrap

  let keptMinWidth = false
  for (const prop in snapshot) {
    if (shouldIgnoreProp(prop)) continue
    if (isRedundantLogicalProp(prop, snapshot)) continue
    const value = floor && prop === 'min-width' ? floor : snapshot[prop]
    if (HARD_WIDTH_PROPS.has(prop) && MATHML_TOKEN_TAGS.has(tagName)) continue
    if (soften) {
      if (HARD_WIDTH_PROPS.has(prop)) continue // never freeze a content/algorithm width
      if (MIN_WIDTH_PROPS.has(prop)) {         // keep an authored min-width verbatim
        if (value && value !== defaults[prop]) {
          entries.push(`${prop}:${value}`)
          // Only a real length is an author floor that should suppress the synthesized one;
          // `auto` is just the (logical) default and must not block the floor on table cells.
          if (value !== 'auto') keptMinWidth = true
        }
        continue
      }
    }
    if (value && value !== defaults[prop]) {
      // Blink serializes a computed length to 6 significant digits, sometimes DOWN, and a box
      // frozen a hair under its true width re-wraps its text. So a frozen size is nudged up by
      // SIZE_EPSILON (1/1000px). Keep it that small: every box in a row carries its own nudge
      // and the shrink-to-fit parent only one, so the old 1/16px ceil wrapped two buttons (#491).
      // Not applied to a width whose text cannot break (#474). Heights take it too: a
      // 38.390625px paragraph read back as "38.3906px" put the lower lines of a 4136px page one
      // pixel high. Do not snap to 1/64 instead: the zoomed ancestor of d508 is not on that
      // grid. Pinned by __tests__/snapdom.frozenHeightPrecision.test.js.
      const sized = prop === 'height' || prop === 'block-size' ||
        (!noWrapBox && (prop === 'width' || prop === 'inline-size'))
      if (sized && value.endsWith('px') && value.includes('.')) {
        const n = parseFloat(value)
        if (Number.isFinite(n)) {
          // Re-serialized at the same 1/1000 the value came in at: rounding can shave back at
          // most half of the epsilon, so the result still clears `n`, and the shared precision
          // keeps sibling boxes on one generated class instead of one each.
          entries.push(`${prop}:${(n + SIZE_EPSILON).toFixed(3)}px`)
          continue
        }
      }
      entries.push(`${prop}:${value}`)
    }
  }
  // Re-add the captured width as a min-width floor so the softened box keeps its size but can
  // still grow to fit a wider raster font (no wrap #429, no collapse #434). Skipped for flex/grid
  // items (they must stay shrinkable, #406), for an authored min-width, and for real inline.
  if (soften && !isInline && !isFlexItem && !keptMinWidth) {
    const w = snapshot.width
    if (w && w !== 'auto' && w !== defaults.width) entries.push(`min-width:${w}`)
  }
  if (floor && !('min-width' in snapshot) && floor !== defaults['min-width']) entries.push(`min-width:${floor}`)
  entries.sort()
  return entries.join(';')
}

/**
 * Collects all unique tag names used in the DOM tree rooted at the given node.
 *
 * @param {Node} root - The root node to search
 * @returns {string[]} Array of unique tag names
 */
export function collectUsedTagNames(root) {
  const tagSet = new Set()
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    return []
  }
  if (root.tagName) {
    tagSet.add(root.tagName.toLowerCase())
  }
  if (typeof root.querySelectorAll === 'function') {
    root.querySelectorAll('*').forEach(el => tagSet.add(el.tagName.toLowerCase()))
  }
  return Array.from(tagSet)
}

/**
 * Emit the base reset for the used tags: one shared rule with what every tag's defaults have
 * in common, then one rule per group of tags whose leftovers are identical.
 * Pinned by __tests__/utils.css.baseResetFactoring.test.js (the factoring) and
 * __tests__/utils.css.base-reset-eviction.test.js (tags evicted from the memo still get one).
 * @param {string[]} usedTagNames
 * @param {Set<string>|null} [universe] - the property set author CSS can touch (styleScan);
 *   when given, the reset stays inside it
 * @returns {string} CSS
 */
export function generateDedupedBaseCSS(usedTagNames, universe = null) {
  const groups = new Map()

  for (let tagName of usedTagNames) {
    // Not a raw read of cache.defaultStyle: it is an EvictingMap (MAX_DEFAULT_STYLE), and on a
    // page with more tags than the cap the earliest ones are gone by now. They got no reset,
    // so the UA margins and paddings applied and the capture reflowed taller.
    const styles = getDefaultStyleForTag(tagName)
    if (!styles) continue

    // Pruned snapshots diff only the universe props, so the reset stays inside it too: a
    // reset-only prop (like -webkit-text-fill-color) would override the class value with no
    // diff entry to win it back. Outside the universe the UA default applies anyway.
    const entries = universe
      ? Object.entries(styles).filter(([k]) => universe.has(k))
      : Object.entries(styles)
    // The same logical-alias trim the class snapshots get: a default that restates its
    // physical twin is as redundant here as it is there.
    const kept = entries.filter(([k]) => !isRedundantLogicalProp(k, styles))
    // Build the CSS block "signature" used for comparison
    const declarations = kept.map(([k, v]) => `${k}:${v};`).sort()
    const key = declarations.join('')

    if (!key) continue // avoids empty rules (NO_DEFAULTS_TAGS yields {})

    // Group by signature
    if (!groups.has(key)) {
      groups.set(key, { tagList: [], declarations })
    }
    groups.get(key).tagList.push(tagName)
  }

  // Factor out what every group declares identically: tag defaults are ~300 near-identical
  // properties, and in full they were the largest CSS in the SVG (32.8kb for 24 tags). Group
  // rules come after the shared one, so source order still gives them the last word.
  // Imported from @frostin/snapdom (element-mirror).
  const parsedGroups = [...groups.values()]
  let shared = null
  for (const { declarations } of parsedGroups) {
    const own = new Set(declarations)
    if (!shared) { shared = own; continue }
    for (const declaration of shared) if (!own.has(declaration)) shared.delete(declaration)
  }
  shared ??= new Set()

  let css = ''
  if (shared.size && parsedGroups.length > 1) {
    const allTags = parsedGroups.flatMap((group) => group.tagList)
    css += `${allTags.join(',')} { ${[...shared].join('')} }\n`
  }
  for (const { tagList, declarations } of parsedGroups) {
    const own = parsedGroups.length > 1
      ? declarations.filter((declaration) => !shared.has(declaration))
      : declarations
    if (!own.length) continue
    const styleBlock = own.join('')
    css += `${tagList.join(',')} { ${styleBlock} }\n`
  }

  return css
}

/**
 * Name the distinct style keys `c1`, `c2`, … in sorted order, so the same keys always get the
 * same names.
 * @param {Map<Element, string>} styleMap - each element's style key
 * @returns {Map<string, string>} each style key's class name
 */
export function generateCSSClasses(styleMap) {
  const keys = Array.from(new Set(styleMap.values()))
    .filter(Boolean)
    .sort()                 // stable order
  const classMap = new Map()
  let i = 1
  for (const k of keys) classMap.set(k, `c${i++}`)
  return classMap
}

/**
 * Gets the Window to use for getComputedStyle. Uses the element's document when
 * the element is from an iframe, so computed styles reflect the iframe's cascade.
 * Fixes #371 (pseudos in iframe body not rendering when capturing body only).
 *
 * @param {Element} el
 * @returns {Window|null}
 */
function getWindowForElement(el) {
  try {
    const doc = el?.ownerDocument
    if (!doc) return typeof window !== 'undefined' ? window : null
    let win = doc.defaultView
    if (win && typeof win.getComputedStyle === 'function') return win
    // In some environments (e.g. srcdoc iframe before fully ready) defaultView can be null.
    // Find the frame whose document is this document so we use the iframe's window.
    if (typeof window !== 'undefined' && window.frames) {
      for (let i = 0; i < window.frames.length; i++) {
        try {
          if (window.frames[i]?.document === doc) return window.frames[i]
        } catch { /* cross-origin */ }
      }
    }
  } catch { /* cross-origin etc */ }
  return typeof window !== 'undefined' ? window : null
}

/** A CSSStyleDeclaration-like stand-in that reads empty and iterates nothing. */
function emptyStyle() {
  const base = {
    length: 0,
    getPropertyValue: () => '',
    item: () => '',
  }
  // Make it iterable: for (let prop of style) { ... }
  base[Symbol.iterator] = function* () { /* empty */ }
  return /** @type {any} */ (base)
}

/** getComputedStyle from the element's own window, the global one for a same-document
 *  element as a fallback, else emptyStyle(). */
function computeStyle(el, pseudo) {
  const win = getWindowForElement(el)
  let st = null
  try {
    st = win && typeof win.getComputedStyle === 'function'
      ? win.getComputedStyle(el, pseudo)
      : null
  } catch { /* ignore */ }

  if (!st && typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    try {
      // Only use global window when the element belongs to the same document (e.g. avoid iframe cross-document call).
      if (el.ownerDocument === document) {
        st = window.getComputedStyle(el, pseudo)
      }
    } catch {
      // ignore; handled below
    }
  }
  return st || emptyStyle()
}

/**
 * Gets the computed style for an element or pseudo-element, with caching.
 *
 * cache.computedStyle maps an element to its declaration, and that declaration to a Map of
 * pseudo declarations made on the first pseudo request, so a pseudo-free element gets no Map
 * and one reset drops both levels. The declaration is live: a later read sees the element's
 * state then, not at the first call. Non-elements bypass the memo.
 * @param {Element} el - The element
 * @param {string|null} [pseudo=null] - The pseudo-element
 * @returns {CSSStyleDeclaration} The computed style
 */
export function getStyle(el, pseudo = null) {
  if ((el?.nodeType !== 1)) {
    const win = typeof window !== 'undefined' ? window : null
    if (win && typeof win.getComputedStyle === 'function') {
      try {
        return win.getComputedStyle(/** @type {any} */ (el), pseudo) || emptyStyle()
      } catch {
        return emptyStyle()
      }
    }
    return emptyStyle()
  }
  let style = cache.computedStyle.get(el)
  if (!style) cache.computedStyle.set(el, style = computeStyle(el, null))
  if (pseudo === null) return style
  // Keyed on the element's own declaration, so the pseudo Maps share cache.computedStyle's
  // reset (cache.js) without a WeakMap of their own.
  let map = cache.computedStyle.get(style)
  if (!map) cache.computedStyle.set(style, map = new Map())
  let ps = map.get(pseudo)
  if (!ps) map.set(pseudo, ps = computeStyle(el, pseudo))
  return ps
}

/**
 * Parses the CSS content property value, handling unicode escapes.
 *
 * @param {string} content - The CSS content value
 * @returns {string} The parsed content
 */
export function parseContent(content) {
  let clean = content.replace(/^['"]|['"]$/g, '')
  if (clean.startsWith('\\')) {
    try {
      return String.fromCharCode(parseInt(clean.replace('\\', ''), 16))
    } catch {
      return clean
    }
  }
  return clean
}

const BORDER_SIDES = ['top', 'right', 'bottom', 'left']

/**
 * Read a computed style into a plain map. With `universe` (the properties author CSS can
 * touch, from styleScan) only those are read: the rest sit at their UA default, which
 * getStyleKey drops anyway. This is the pseudo-element path: deep-tree scene with a `::before`
 * on every leaf, 1,936 pseudos, 435 ms reading all ~400 properties against 125 without the
 * rule. Null (unreliable scan, shadow content) reads everything.
 * @export
 * @param {CSSStyleDeclaration} style
 * @param {Set<string>|null} [universe]
 * @return {Record<string,string>}
 */
export function snapshotComputedStyle(style, universe = null) {
  const snap = {}
  for (const prop of universe || style) {
    const v = style.getPropertyValue(prop)
    if (v) snap[prop] = v
  }
  // #390: drop border props on sides that don't paint (style:none/hidden or width:0).
  // Serializing "0px none rgb(0,0,0)" in the foreignObject triggers faint borders on
  // some engines (seen on <canvas> at high scale). Dropping them is safe because
  // defaults (all:initial) already resolve border-style to none.
  for (const side of BORDER_SIDES) {
    const sty = snap[`border-${side}-style`]
    const wid = snap[`border-${side}-width`]
    if (sty === 'none' || sty === 'hidden' || wid === '0px') {
      delete snap[`border-${side}-style`]
      delete snap[`border-${side}-width`]
      delete snap[`border-${side}-color`]
    }
  }
  return snap
}

/**
 * Split a multi-layer `background-image` on its top-level commas, so a gradient's own commas
 * stay inside their layer. Parentheses inside a quoted url() are part of the URL: an SVG data
 * URL with `:)` in its text used to end the layer early and merge the next layer into it.
 * @param {string} bg
 * @returns {string[]}
 */
export function splitBackgroundImage(bg) {
  const parts = []
  let depth = 0
  let lastIndex = 0
  let quote = ''
  for (let i = 0; i < bg.length; i++) {
    const char = bg[i]
    if (char === '\\') { i++; continue }
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") quote = char
    if (char === '(') depth++
    if (char === ')') depth--
    if (char === ',' && depth === 0) {
      parts.push(bg.slice(lastIndex, i).trim())
      lastIndex = i + 1
    }
  }
  parts.push(bg.slice(lastIndex).trim())
  return parts
}
