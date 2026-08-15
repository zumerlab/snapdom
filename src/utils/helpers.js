/**
 * Extracts a URL from a CSS value like background-image.
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

/**
 * Picks the best-matching URL out of a CSS `image-set()`/`-webkit-image-set()` value for a
 * given device pixel ratio — the smallest declared resolution that's >= targetDppx, or the
 * largest available if none reaches it. A candidate with no `Nx`/`Ndpi` descriptor is 1x.
 * Returns null if `value` isn't an image-set() (so callers can fall through to a plain url()).
 * @param {string} value
 * @param {number} [targetDppx=1]
 * @returns {string|null}
 */
/** Raster/vector types every target engine decodes; anything else (jxl, tiff…) the
 *  browser's own type-support step would skip. Shared by image-set() and <source type>. */
export const SUPPORTED_IMAGE_MIME = /^image\/(jpeg|jpg|png|gif|webp|avif|apng|svg\+xml|bmp|x-icon|vnd\.microsoft\.icon)\s*(;|$)/i
const SUPPORTED_IMAGE_SET_TYPE = SUPPORTED_IMAGE_MIME

export function resolveImageSetURL(value, targetDppx = 1) {
  const m = value.match(/^\s*-?(?:webkit-)?image-set\(([\s\S]*)\)\s*$/i)
  if (!m) return null
  const candidates = []
  for (const part of m[1].split(',')) {
    const urlMatch = part.match(/url\((['"]?)(.*?)(\1)\)/)
    if (!urlMatch) continue
    // The browser's own image-set() selection skips candidates whose type() it can't
    // decode — mirror that, or an unsupported format out-ranks what the page painted.
    const typeMatch = part.match(/type\(\s*["']([^"']+)["']\s*\)/i)
    if (typeMatch && !SUPPORTED_IMAGE_SET_TYPE.test(typeMatch[1].trim())) continue
    const resMatch = part.match(/(\d+(?:\.\d+)?)\s*(x|dpi|dppx)/i)
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

/** The ONE input core masks, and it costs no fidelity: the browser already paints a password
 *  field as bullets, so a same-length bullet mask renders IDENTICALLY to the live control
 *  while keeping the typed secret out of the serialized SVG (which is a string callers log,
 *  upload and cache). Everything the browser shows in PLAIN TEXT (email, tel, cc-*,
 *  one-time-code) is captured as-is: redacting it would be a real fidelity loss, and fidelity
 *  is core's job. Redaction is opt-in, via the `redactInputs` plugin. */
export function isPasswordInput(el) {
  return !!el && el.tagName === 'INPUT' && (el.getAttribute('type') || '').toLowerCase() === 'password'
}

/** Same-length bullet mask: rendered width stays plausible, the secret is gone. */
export function maskValue(value) {
  return '\u2022'.repeat(String(value ?? '').length)
}

/* ---------------- realm-safe type tests ----------------
 *
 * `node instanceof HTMLInputElement` asks whether the node was built by THIS window's
 * constructor. A same-origin <iframe> is a second window with its own constructor set, so
 * every one of those tests answered false for nodes inside a frame \u2014 and the answers were
 * load-bearing: the branches they guard are what copy a form control's LIVE value
 * (`.value`, `.checked`) onto the clone. Capturing inside an iframe silently fell through
 * to the plain-element path and serialized the HTML-attribute defaults, so a typed-in form
 * came out empty. Namespace + localName are realm-independent, and being plain string
 * compares they are also cheaper than instanceof in the per-node clone loop. */

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
