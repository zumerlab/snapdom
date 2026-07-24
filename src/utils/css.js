// -----------------------------------------------------------------------------
// Central single-source-of-truth sets
// -----------------------------------------------------------------------------

/** Tags that Snapdom must never capture (skip node + subtree). */
export const NO_CAPTURE_TAGS = new Set([
  'meta', 'script', 'noscript', 'title', 'link', 'template'
])

/** Tags that must not generate default styles nor auto-classes. */
export const NO_DEFAULTS_TAGS = new Set([
  // non-painting / head stuff
  'meta', 'link', 'style', 'title', 'noscript', 'script', 'template',
  // SVG whole namespace (safe for LeaderLine/presentation attrs)
  'g', 'defs', 'use', 'marker', 'mask', 'clipPath', 'pattern',
  'path', 'polygon', 'polyline', 'line', 'circle', 'ellipse', 'rect',
  'filter', 'lineargradient', 'radialgradient', 'stop'
])

import { cache } from '../core/cache'

const commonTags = [
  'div', 'span', 'p', 'a', 'img', 'ul', 'li', 'button', 'input', 'select', 'textarea', 'label', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'td', 'th'
]

// -----------------------------------------------------------------------------
// 1) precacheCommonTags → salta NO_CAPTURE y NO_DEFAULTS (no calienta basura)
// -----------------------------------------------------------------------------
export function precacheCommonTags() {
  for (let tag of commonTags) {
    const t = String(tag).toLowerCase()
    if (NO_CAPTURE_TAGS.has(t)) continue
    if (NO_DEFAULTS_TAGS.has(t)) continue // evita precache de SVG/body/etc.
    getDefaultStyleForTag(t)
  }
}

// -----------------------------------------------------------------------------
// 2) getDefaultStyleForTag → gate único por NO_DEFAULTS_TAGS + sandbox marcado
// -----------------------------------------------------------------------------
/*
 * Retrieves default CSS property values from a temporary element.
 * @param {string} tagName
 * @returns {Object}
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

  let sandbox = document.getElementById('snapdom-sandbox')
  if (!sandbox) {
    sandbox = document.createElement('div')
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

  const el = document.createElement(tagName)
  el.style.all = 'initial'
  sandbox.appendChild(el)

  const styles = getComputedStyle(el)
  const defaults = {}
  for (let prop of styles) {
    // ⬇️ Nuevo: filtramos ruido que no pinta y props dependientes de layout
    if (shouldIgnoreProp(prop)) continue
    const value = styles.getPropertyValue(prop)
    defaults[prop] = value
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
  // #369: CSS zoom — getComputedStyle() widths/heights already reflect post-zoom layout values.
  // Capturing zoom in the class causes double-zoom inside SVG foreignObject → blank sections.
  // Excluding zoom prevents this; dimensions are already correct as-is.
  'zoom',
  // WebKit-only draft prop (CSS Fill & Stroke on text; distinct from SVG `stroke`).
  // Re-stating its transparent default inside svg-as-image flips WebKit's text paint
  // path and silently drops text-shadow. Authored usage is nil — never capture it.
  'stroke-color',
])

/** Memo of shouldIgnoreProp by property name. The verdict depends only on the name, and the set
 * of CSS property names is small and fixed — but this runs ~350×/node, so caching turns 1M+
 * regex tests per large capture into Map lookups. */
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
  // Cache by the raw name (computed-style iteration already yields canonical lowercase), so hits
  // skip both the regex tests and the toLowerCase — this runs ~350×/node on cold captures.
  let r = _ignorePropCache.get(prop)
  if (r === undefined) {
    const p = String(prop).toLowerCase()
    r = NO_PAINT_EXACT.has(p) || NO_PAINT_PREFIX.test(p) || NO_PAINT_TOKEN.test(p)
    _ignorePropCache.set(prop, r)
  }
  return r
}

// -----------------------------------------------------------------------------
// 3) getStyleKey → si NO_DEFAULTS_TAGS: "", así no hay clase auto
// -----------------------------------------------------------------------------
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
// Min-width longhands: kept verbatim when authored (or set to 0 by #406 on flex/grid items).
const MIN_WIDTH_PROPS = new Set(['min-width', 'min-inline-size'])

/**
 * Whether getStyleKey softens the width for this tag/display (inline-sized text tags, the table
 * box tree, or any real inline box; never replaced elements). Exposed so the caller can skip the
 * per-node content/flex bookkeeping for the vast majority of nodes that aren't affected.
 * @param {string} tagName
 * @param {string} display computed display (lowercase)
 */
export function softensWidth(tagName, display) {
  return !REPLACED_TAGS.has(tagName) &&
    (display === 'inline' || INLINE_SIZED_TAGS.has(tagName) || TABLE_TAGS.has(tagName))
}

/**
 * Builds a style key from a snapshot; returns "" for tags in NO_DEFAULTS_TAGS.
 * @param {Record<string,string>} snapshot
 * @param {string} tagName
 * @param {boolean} [sizedByContent=true] whether the element is sized by its own content
 *   (text / child elements). Empty boxes sized by a CSS class keep their width verbatim.
 * @param {boolean} [isFlexItem=false] whether the element is a flex/grid item — those must keep
 *   their natural ability to shrink (#406), so we never give them a synthesized min-width floor.
 */
export function getStyleKey(snapshot, tagName, sizedByContent = true, isFlexItem = false) {
  tagName = String(tagName || '').toLowerCase()
  if (NO_DEFAULTS_TAGS.has(tagName)) {
    return '' // no key => no class
  }

  const entries = []
  const defaults = getDefaultStyleForTag(tagName)
  const display = (snapshot.display || '').toLowerCase()
  const isInline = display === 'inline'
  const softenTag = softensWidth(tagName, display)
  // Only soften when the box is sized by its content: a frozen used width then wraps the text
  // (#429) / pins the table (#434). An empty box sized by a CSS class (#433 inline-block span,
  // ExtJS button-icon spans) must keep its width.
  const soften = softenTag && sizedByContent

  let keptMinWidth = false
  for (const prop in snapshot) {
    if (shouldIgnoreProp(prop)) continue
    const value = snapshot[prop]
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
      // Blink lays out in 1/64px units but serializes computed lengths rounded to 1/1000 —
      // sometimes DOWN. Freezing a shrink-to-fit box a hair below its true width re-wraps
      // its text. Round frozen widths UP to the next 1/16px (invisible, guarantees fit).
      if ((prop === 'width' || prop === 'inline-size') && value.endsWith('px') && value.includes('.')) {
        const n = parseFloat(value)
        if (Number.isFinite(n)) {
          entries.push(`${prop}:${Math.ceil(n * 16) / 16}px`)
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

// -----------------------------------------------------------------------------
// 5) generateDedupedBaseCSS → salta keys vacías (sin reglas basura)
// -----------------------------------------------------------------------------
/**
 * Generates deduplicated base CSS for the given tag names.
 *
 * @param {string[]} usedTagNames - Array of tag names
 * @returns {string} CSS string
 */
export function generateDedupedBaseCSS(usedTagNames) {
  const groups = new Map()

  for (let tagName of usedTagNames) {
    // Resolve through getDefaultStyleForTag instead of reading cache.defaultStyle directly.
    // That cache is an EvictingMap (MAX_DEFAULT_STYLE), and this runs at the very end of a
    // capture: a document using more distinct tags than the cap has already had its earliest
    // tags evicted. Reading the map raw returned undefined for exactly those tags and the
    // `continue` silently emitted no base reset for them, so inside the foreignObject the UA
    // stylesheet's defaults applied instead (h1..h3/p margins, hr borders, list padding…) and
    // the capture reflowed taller than the source. Re-deriving is memoized and idempotent;
    // NO_DEFAULTS_TAGS still yields {} and is dropped by the empty-key guard below.
    const styles = getDefaultStyleForTag(tagName)
    if (!styles) continue

    // Creamos la "firma" del bloque CSS para comparar
    const key = Object.entries(styles)
      .map(([k, v]) => `${k}:${v};`)
      .sort()
      .join('')

    if (!key) continue // <- evita reglas vacías (NO_DEFAULTS_TAGS produce {})

    // Agrupamos por firma
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key).push(tagName)
  }

  // Ahora generamos el CSS optimizado
  let css = ''
  for (let [styleBlock, tagList] of groups.entries()) {
    css += `${tagList.join(',')} { ${styleBlock} }\n`
  }

  return css
}

// -----------------------------------------------------------------------------
// 4) generateCSSClasses → ignora keys vacías (defensivo)
// -----------------------------------------------------------------------------
/**
 * Generates CSS classes from a style map.
 *
 * @returns {Map} Map of style keys to class names
 */
export function generateCSSClasses(styleMap) {
  const keys = Array.from(new Set(styleMap.values()))
    .filter(Boolean)
    .sort()                 // ← orden estable
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

/**
 * Gets the computed style for an element or pseudo-element, with caching.
 *
 * @param {Element} el - The element
 * @param {string|null} [pseudo=null] - The pseudo-element
 * @returns {CSSStyleDeclaration} The computed style
 */
export function getStyle(el, pseudo = null) {
  /**
   * Minimal safe fallback CSSStyleDeclaration-like object.
   * Ensures callers can read properties and iterate length without crashing.
   */
  const emptyStyle = () => {
    const base = {
      length: 0,
      getPropertyValue: () => '',
      item: () => '',
    }
    // Make it iterable: for (let prop of style) { ... }
    base[Symbol.iterator] = function* () { /* empty */ }
    return /** @type {any} */ (base)
  }

  if (!(el instanceof Element)) {
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
  let map = cache.computedStyle.get(el)
  if (!map) {
    map = new Map()
    cache.computedStyle.set(el, map)
  }

  let style = map.get(pseudo)

  if (!style) {
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

    style = st || emptyStyle()
    map.set(pseudo, style)
  }

  return style
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
 * @export
 * @param {CSSStyleDeclaration} style
 * @return {Record<string,string>}
 */
export function snapshotComputedStyle(style) {
  const snap = {}
  for (let prop of style) {
    snap[prop] = style.getPropertyValue(prop)
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
 * @export
 * @param {string} bg
 * @return {string[]}
 */
export function splitBackgroundImage(bg) {
  const parts = []
  let depth = 0
  let lastIndex = 0
  for (let i = 0; i < bg.length; i++) {
    const char = bg[i]
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
