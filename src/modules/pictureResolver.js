/**
 * Which URL an <img> is really showing: <picture> sources, srcset candidates, lazy-load
 * attributes.
 *
 * Four pure helpers, no DOM writes. freezeImgSrcset (utils/clone.helpers.js) calls them
 * while building the clone, so a lazy placeholder or a srcset-only image reaches
 * inlineImages with a concrete src. The old live-DOM resolver that swapped the page's own
 * src and undid it later is gone; the clone path replaced it.
 * Pinned by __tests__/module.pictureResolver.test.js.
 * @module pictureResolver
 */
import { SUPPORTED_IMAGE_MIME as SUPPORTED_SOURCE_TYPE } from '../utils/helpers.js'

/**
 * Whether a src is a lazy-loader stand-in rather than the picture: empty, blob:, or any
 * data: URL. A tiny inline gif/png/svg is the usual shape, but a data: src of any length is
 * treated the same, since a real inline image needs no resolving either way.
 * @param {string} src
 * @returns {boolean}
 */
export function isPlaceholderSrc(src) {
  if (!src) return true
  if (src.startsWith('data:')) return true
  if (src.startsWith('blob:')) return true
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
 * The URL a <picture> resolves to for this <img>.
 *
 * `currentSrc` wins when it is not a placeholder. Otherwise the first <source> whose media
 * query matches decides, skipping types the browser cannot decode; with no matching media
 * query, the first usable source is the fallback, which is the order the browser itself
 * walks them in.
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
 * The real URL a lazy loader parked on the element: data-src, data-lazy-src, data-original,
 * data-hi-res-src, then the first candidate of data-srcset / data-lazy-srcset.
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
