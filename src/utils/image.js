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
  // Cache key includes the proxy: a CORS failure under one proxy setting must not poison
  // a later capture of the same URL with a working proxy (a `null` would mask a recoverable
  // image). Successes are also keyed per proxy, which is constant in practice.
  const cacheKey = (options.useProxy || '') + '|' + encodedUrl
  // Fast path: cached success
  if (cache.background.has(cacheKey)) {
    const dataUrl = cache.background.get(cacheKey)
    return dataUrl ? `url("${dataUrl}")` : 'none'
  }
  // Try to inline; never throw — degrade to "none" on failure
  try {
    const dataUrl = await snapFetch(encodedUrl, { as: 'dataURL', useProxy: options.useProxy })
    // Guard: ensure it actually looks like an image data URL
    if (dataUrl.ok) {
      cache.background.set(cacheKey, dataUrl.data)
      return `url("${dataUrl.data}")`
    }
    // Unexpected format → degrade safely
    cache.background.set(cacheKey, null)
    return 'none'
  } catch {
    // On any error (404/CORS/timeout/tainted/etc.), don't break the capture
    cache.background.set(cacheKey, null) // remember failure to avoid loops
    return 'none'
  }
}
