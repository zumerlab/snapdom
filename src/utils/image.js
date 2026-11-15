/**
 * One background-image layer to a data URL, through the shared cache.background memo.
 * Used by the background pass and the pseudo pass.
 * @module utils/image
 */

import { cache } from '../core/cache'
import { extractURL, safeEncodeURI, resolveURL, resolveImageSetURL } from './helpers'
import { snapFetch } from '../modules/snapFetch'

/**
 * Inline one background-image layer as `url("data:…")`.
 * Gradients and `none` pass through. A fetch that fails (404, CORS, timeout) caches null for
 * that URL and returns `none`, so a missing background never throws and is not fetched again
 * while the cache holds the miss.
 * @param {string} entry - one layer: 'url("...")', 'linear-gradient(...)', 'none'
 * @param {{ useProxy?: string }} [options]
 * @returns {Promise<string>} the inlined layer, the original entry, or "none"
 */
export async function inlineSingleBackgroundEntry(entry, options = {}) {
  // Already embedded: preserve CSSOM's quoted SVG/percent escapes verbatim. Extracting
  // and URI-encoding them can turn CSS backslashes into invalid SVG XML (#503).
  if (/^\s*url\(\s*['"]?data:/i.test(entry)) return entry
  // Quick checks for non-URL values
  const isGradient = /^((repeating-)?(linear|radial|conic)-gradient)\(/i.test(entry)
  if (isGradient || entry.trim() === 'none') {
    return entry // leave as is
  }
  // image-set()/-webkit-image-set(): pick the candidate matching the live device's pixel
  // ratio instead of always grabbing whichever url() the generic regex sees first (which
  // silently discarded resolution — e.g. always inlining the 1x candidate on a 2x display).
  const rawUrl = resolveImageSetURL(entry, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1) ??
    extractURL(entry)
  if (!rawUrl) {
    // Not a URL(...) we recognize → keep original as a safe fallback
    return entry
  }
  // Resolve relative URLs to absolute (fixes #343: background url() missing when relative)
  const absoluteUrl = resolveURL(rawUrl)
  // Normalize / encode the URL string for fetch
  const encodedUrl = safeEncodeURI(absoluteUrl)
  // Keyed per proxy, and successes only. A failure is remembered by snapFetch alone, for its
  // errorTTL: kept here it had no expiry, and a background whose fetch failed once stayed
  // blank for the life of the page. Pinned by __tests__/utils.image.test.js.
  const cacheKey = (options.useProxy || '') + '|' + encodedUrl
  const hit = cache.background.get(cacheKey)
  if (hit) return `url("${hit}")`
  // snapFetch never throws: a failure degrades the layer to "none".
  const dataUrl = await snapFetch(encodedUrl, { as: 'dataURL', useProxy: options.useProxy, debug: options.debug })
  if (!dataUrl.ok) return 'none'
  cache.background.set(cacheKey, dataUrl.data)
  return `url("${dataUrl.data}")`
}
