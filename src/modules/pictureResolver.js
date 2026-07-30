/**
 * Pure URL-selection helpers for picture / lazy-img resolution. The live-DOM
 * mutation resolver was dissolved into the clone path (freezeImgSrcset resolves
 * lazy placeholders on the CLONE; inlineImages fetches them like any source).
 */
import { SUPPORTED_IMAGE_MIME as SUPPORTED_SOURCE_TYPE } from '../utils/helpers.js'

/**
 * @param {string} src
 * @returns {boolean}
 */
export function isPlaceholderSrc(src) {
  if (!src) return true
  if (src.startsWith('data:')) return true
  if (src.startsWith('blob:')) return true
  if (/^data:image\/(gif|png|svg)/.test(src) && src.length < 200) return true
  return false
}

/**
 * Picks the srcset candidate the browser itself would select: smallest density
 * >= devicePixelRatio, else the largest. `Nw` width descriptors become densities
 * via the img's layout width (viewport width when unlaid-out — the `sizes`
 * default). Mirrors resolveImageSetURL's image-set() logic.
 * @param {string} srcset
 * @param {HTMLImageElement} [img]
 * @returns {string|null}
 */
export function pickSrcsetCandidate(srcset, img) {
  if (!srcset) return null
  let slot = 0
  try { slot = img ? (img.getBoundingClientRect().width || img.width) : 0 } catch { }
  if (!slot) slot = window.innerWidth || 1000
  const candidates = []
  for (const part of srcset.split(',')) {
    const toks = part.trim().split(/\s+/)
    if (!toks[0]) continue
    const desc = toks[1] || ''
    let d = 1
    if (/^\d*\.?\d+x$/i.test(desc)) d = parseFloat(desc)
    else if (/^\d+w$/i.test(desc)) d = parseInt(desc, 10) / slot
    candidates.push({ url: toks[0], d })
  }
  if (!candidates.length) return null
  candidates.sort((a, b) => a.d - b.d)
  const dpr = window.devicePixelRatio || 1
  return (candidates.find((c) => c.d >= dpr) || candidates[candidates.length - 1]).url
}

/**
 * @param {HTMLImageElement} img
 * @param {HTMLPictureElement} picture
 * @returns {string|null}
 */
export function findRealUrlForPicture(img, picture) {
  const current = img.currentSrc || ''
  if (current && !isPlaceholderSrc(current)) return current

  const sources = picture.querySelectorAll('source[srcset]')
  let fallback = null
  for (const source of sources) {
    const srcset = source.getAttribute('srcset')
    if (!srcset || isPlaceholderSrc(srcset)) continue

    const type = source.getAttribute('type')
    if (type && !SUPPORTED_SOURCE_TYPE.test(type.trim())) continue

    const media = source.getAttribute('media')
    if (media) {
      try {
        if (window.matchMedia(media).matches) {
          return pickSrcsetCandidate(srcset, img)
        }
      } catch { /* invalid media query */ }
    }
    if (!fallback) fallback = pickSrcsetCandidate(srcset, img)
  }
  return fallback
}

/**
 * @param {HTMLImageElement} img
 * @returns {string|null}
 */
export function findLazySrcAttr(img) {
  const candidates = [
    img.getAttribute('data-src'),
    img.getAttribute('data-lazy-src'),
    img.getAttribute('data-original'),
    img.getAttribute('data-hi-res-src'),
  ]
  for (const c of candidates) {
    if (c && !isPlaceholderSrc(c)) return c
  }
  const dataSrcset = img.getAttribute('data-srcset') || img.getAttribute('data-lazy-srcset')
  if (dataSrcset) {
    const first = dataSrcset.split(',')[0].trim().split(/\s+/)[0]
    if (first && !isPlaceholderSrc(first)) return first
  }
  return null
}
