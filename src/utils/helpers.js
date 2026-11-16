/**
 * URL and transform string helpers, the password mask, and realm-safe element type tests.
 * @module utils/helpers
 */

/**
 * Extracts a URL from a CSS value like background-image. A `#fragment` reference is not one.
 *
 * @param {string} value - The CSS value
 * @returns {string|null} The extracted URL or null
 */

export function extractURL(value) {
  const match = value.match(/url\((['"]?)(.*?)(\1)\)/)
  if (!match) return null

  const url = match[2].trim()
  if (url.startsWith('#')) return null
  return url
}

/** Raster/vector types every target engine decodes; anything else (jxl, tiff…) the
 *  browser's own type-support step would skip. Shared by image-set() and <source type>. */
export const SUPPORTED_IMAGE_MIME = /^image\/(jpeg|jpg|png|gif|webp|avif|apng|svg\+xml|bmp|x-icon|vnd\.microsoft\.icon)\s*(;|$)/i
const SUPPORTED_IMAGE_SET_TYPE = SUPPORTED_IMAGE_MIME

/** Candidate separators occur outside functions and strings: data URLs and quoted
 * filenames can contain commas that are part of one image source. */
function imageSetCandidates(value) {
  const parts = []
  let start = 0, depth = 0, quote = ''
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    if (char === '\\') { i++; continue }
    if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") quote = char
    else if (char === '(') depth++
    else if (char === ')') depth--
    else if (char === ',' && depth === 0) {
      parts.push(value.slice(start, i))
      start = i + 1
    }
  }
  parts.push(value.slice(start))
  return parts
}

/**
 * Pick the URL of a CSS `image-set()`/`-webkit-image-set()` value for a device pixel ratio:
 * the smallest resolution >= targetDppx, else the largest. No `Nx`/`Ndpi` descriptor means 1x.
 * Returns null when `value` is not an image-set(), so callers fall through to a plain url().
 * @param {string} value
 * @param {number} [targetDppx=1]
 * @returns {string|null}
 */
export function resolveImageSetURL(value, targetDppx = 1) {
  const m = value.match(/^\s*-?(?:webkit-)?image-set\(([\s\S]*)\)\s*$/i)
  if (!m) return null
  const candidates = []
  for (const part of imageSetCandidates(m[1])) {
    const urlMatch = part.match(/url\((['"]?)(.*?)(\1)\)/)
    if (!urlMatch) continue
    // The browser skips a candidate whose type() it cannot decode. Mirror that, or an
    // unsupported format out-ranks what the page painted.
    const typeMatch = part.match(/type\(\s*["']([^"']+)["']\s*\)/i)
    if (typeMatch && !SUPPORTED_IMAGE_SET_TYPE.test(typeMatch[1].trim())) continue
    // Match the descriptor OUTSIDE the url(), or `url("hero-2x.png") 3x` reads as 2x.
    const resMatch = part.replace(/url\((['"]?)[\s\S]*?\1\)/, ' ').match(/(\d+(?:\.\d+)?)\s*(x|dpi|dppx)\b/i)
    let dppx = 1
    if (resMatch) {
      const n = parseFloat(resMatch[1])
      dppx = /dpi/i.test(resMatch[2]) ? n / 96 : n
    }
    candidates.push({ url: urlMatch[2].trim(), dppx })
  }
  if (!candidates.length) return null
  candidates.sort((a, b) => a.dppx - b.dppx)
  const fit = candidates.find(c => c.dppx >= targetDppx)
  return (fit || candidates[candidates.length - 1]).url
}

/**
 * Drop the translation from a transform string: translate()/translateX()/translateY() are
 * removed, matrix() and matrix3d() keep their scale and skew with the offset zeroed.
 * prepareClone runs the root's transform through this, so the svg engine's bbox math never
 * sees a translated root (#56, #24). Pinned by __tests__/utils.helpers.test.js.
 * @param {string} transform - computed `transform`
 * @returns {string} '' for `none` or empty
 */
export function stripTranslate(transform) {
  if (!transform || transform === 'none') return ''

  let cleaned = transform.replace(/translate[XY]?\([^)]*\)/g, '')

  cleaned = cleaned.replace(/matrix\(([^)]+)\)/g, (_, values) => {
    const parts = values.split(',').map(s => s.trim())
    if (parts.length !== 6) return `matrix(${values})`
    parts[4] = '0'
    parts[5] = '0'
    return `matrix(${parts.join(', ')})`
  })

  cleaned = cleaned.replace(/matrix3d\(([^)]+)\)/g, (_, values) => {
    const parts = values.split(',').map(s => s.trim())
    if (parts.length !== 16) return `matrix3d(${values})`
    parts[12] = '0'
    parts[13] = '0'
    return `matrix3d(${parts.join(', ')})`
  })

  return cleaned.trim().replace(/\s{2,}/g, ' ')
}

/**
 * Swap the layout-zoom wrapper of a capture svg for the 1x one recorded in `fileSvg`, for an
 * svg that leaves as a file (#552). Any other shape (no zoom, a plugin rewrote the markup)
 * comes back unchanged. Pinned by __tests__/engine.svg.layoutZoom.test.js.
 * @param {string} svgText - decoded capture svg
 * @param {{ zoomed: string[], flat: string[] } | null | undefined} fileSvg
 * @returns {string}
 */
export function fileSvgText(svgText, fileSvg) {
  if (!fileSvg) return svgText
  const [head, container, foot] = fileSvg.zoomed
  const styleEnd = svgText.indexOf('</style>') + 8
  if (styleEnd < 8 || !svgText.startsWith(head) || !svgText.startsWith(container, styleEnd) || !svgText.endsWith(foot)) {
    return svgText
  }
  const [flatHead, flatContainer, flatFoot] = fileSvg.flat
  return flatHead + svgText.slice(head.length, styleEnd) + flatContainer +
    svgText.slice(styleEnd + container.length, svgText.length - foot.length) + flatFoot
}

/** encodeURI, unless the string already carries a %XX escape: encoding it again doubles it. */
export function safeEncodeURI(uri) {
  if (/%[0-9A-Fa-f]{2}/.test(uri)) return uri // prevent reencode
  try { return encodeURI(uri) } catch { return uri }
}

/**
 * Resolves a possibly relative URL to an absolute URL.
 * @param {string} url - URL (relative or absolute)
 * @param {string} [base] - Base URL (defaults to document.baseURI or location.href)
 * @returns {string} Absolute URL
 */
export function resolveURL(url, base) {
  if (!url || /^(data|blob|about|#)/i.test(url.trim())) return url
  try {
    const b = base || (typeof document !== 'undefined' && (document.baseURI || document.location?.href)) || 'http://localhost/'
    return new URL(url, b).href
  } catch {
    return url
  }
}

/** The ONE input core masks: a password field already paints as bullets, so a same-length
 *  mask looks identical and keeps the secret out of the SVG string callers log and upload.
 *  Plain-text fields (email, tel, cc-*, one-time-code) are captured as-is, since masking them
 *  loses fidelity. Redaction is opt-in, via the `redactInputs` plugin. */
export function isPasswordInput(el) {
  return !!el && el.tagName === 'INPUT' && (el.getAttribute('type') || '').toLowerCase() === 'password'
}

/** Same-length bullet mask: rendered width stays plausible, the secret is gone. */
export function maskValue(value) {
  return '\u2022'.repeat(String(value ?? '').length)
}

/* Realm-safe type tests. `instanceof HTMLInputElement` is false for a node in a same-origin
 * <iframe>, which has its own constructors, so the branches that copy a control's LIVE
 * `.value`/`.checked` were skipped and a typed-in form came out empty. Namespace + localName
 * work in every realm and are cheaper string compares in the per-node clone loop. */

const HTML_NS = 'http://www.w3.org/1999/xhtml'
const SVG_NS = 'http://www.w3.org/2000/svg'

/** Realm-safe `node instanceof HTMLxxxElement` for a known tag (lowercase). */
export function isTag(node, name) {
  return node?.nodeType === 1 && node.localName === name
}

/** Realm-safe `node instanceof HTMLElement`. */
export function isHTMLEl(node) {
  return node?.nodeType === 1 && node.namespaceURI === HTML_NS
}

/** Realm-safe `node instanceof SVGElement`. */
export function isSVGEl(node) {
  return node?.nodeType === 1 && node.namespaceURI === SVG_NS
}

/** Realm-safe `node instanceof ShadowRoot`: a DocumentFragment that has a host. */
export function isShadowRoot(node) {
  return node?.nodeType === 11 && !!node.host
}

/** Shadow boundary parent, without confusing anchor URL hosts with ShadowRoot hosts. */
export function shadowHost(node) {
  const parent = node?.parentNode
  return parent?.nodeType === 11 ? parent.host : null
}

/** Realm-safe `node instanceof Document`. */
export function isDocument(node) {
  return node?.nodeType === 9
}
