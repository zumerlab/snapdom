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

import { cache } from '../core/cache.js'

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
const NO_PAINT_PREFIX = /^(--|view-timeline|scroll-timeline|animation-trigger|offset-|position-try|app-region|interactivity|overlay|view-transition|-webkit-locale|-webkit-user-(?:drag|modify)|-webkit-tap-highlight-color|-webkit-text-security)$/i

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
])

/**
 * Returns true if a CSS property should be ignored because it does not affect
 * the static pixel output of a frame capture.
 * - Matches prefixes (fast path) and tokens (e.g., “...-animation-...”).
 * - Skips a curated set of exact property names.
 * @param {string} prop
 * @returns {boolean}
 */
export function shouldIgnoreProp(prop /*, tag */) {
  const p = String(prop).toLowerCase()
  if (NO_PAINT_EXACT.has(p)) return true
  if (NO_PAINT_PREFIX.test(p)) return true // --*, view/scroll-timeline*, offset-*, position-try*, etc.
  if (NO_PAINT_TOKEN.test(p)) return true  // …-animation…, …-transition… (incluye caret/trigger)
  return false
}

// -----------------------------------------------------------------------------
// 3) getStyleKey → si NO_DEFAULTS_TAGS: "", así no hay clase auto
// -----------------------------------------------------------------------------
/**
 * Builds a style key from a snapshot; returns "" for tags in NO_DEFAULTS_TAGS.
 * @param {Record<string,string>} snapshot
 * @param {string} tagName
 */
export function getStyleKey(snapshot, tagName) {
  tagName = String(tagName || '').toLowerCase()
  if (NO_DEFAULTS_TAGS.has(tagName)) {
    return '' // no key => no class
  }

  const entries = []
  const defaults = getDefaultStyleForTag(tagName)
  for (let [prop, value] of Object.entries(snapshot)) {
    if (shouldIgnoreProp(prop)) continue
    const def = defaults[prop]
    if (value && value !== def) entries.push(`${prop}:${value}`)
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
    const styles = cache.defaultStyle.get(tagName)
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
 * Gets the computed style for an element or pseudo-element, with caching.
 *
 * @param {Element} el - The element
 * @param {string|null} [pseudo=null] - The pseudo-element
 * @returns {CSSStyleDeclaration} The computed style
 */
export function getStyle(el, pseudo = null) {
  if (!(el instanceof Element)) {
    return window.getComputedStyle(el, pseudo)
  }

  let map = cache.computedStyle.get(el)
  if (!map) {
    map = new Map()
    cache.computedStyle.set(el, map)
  }

  if (!map.has(pseudo)) {
    const st = window.getComputedStyle(el, pseudo)
    map.set(pseudo, st)
  }

  return map.get(pseudo)
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
