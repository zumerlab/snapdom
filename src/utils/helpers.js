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
const SUPPORTED_IMAGE_SET_TYPE = /^image\/(jpeg|jpg|png|gif|webp|avif|apng|svg\+xml|bmp|x-icon|vnd\.microsoft\.icon)\s*(;|$)/i

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

/**
 * Determines if a font family or URL is an icon font.
 *
 * @param {string} familyOrUrl - The font family or URL
 * @returns {boolean} True if it is an icon font
 */
export function isIconFont(familyOrUrl) {
  const iconFontPatterns = [
    /font\s*awesome/i,
    /material\s*icons/i,
    /ionicons/i,
    /glyphicons/i,
    /feather/i,
    /bootstrap\s*icons/i,
    /remix\s*icons/i,
    /heroicons/i,
    /layui/i,
    /lucide/i
  ]
  return iconFontPatterns.some(rx => rx.test(familyOrUrl))
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
