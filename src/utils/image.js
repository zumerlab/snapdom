import { cache } from '../core/cache'
import { extractURL, safeEncodeURI, resolveURL } from './helpers'
import { snapFetch } from '../modules/snapFetch'

/**
 * Inline a single background-image entry (one layer) robustly.
 * - If it's a URL() and fetching fails, degrade to "none" instead of throwing.
 * - Gradients and "none" are returned untouched.
 * - Uses cache.background to avoid repeated work.
 *
 * @param {string} entry - A single background layer (e.g., 'url("...")', 'linear-gradient(...)', 'none')
 * @param {{ useProxy?: string }} [options]
 * @returns {Promise<string|undefined>} Inlined CSS value for this layer (e.g., `url("data:...")`), original entry, or "none".
 */
export async function inlineSingleBackgroundEntry(entry, options = {}) {
  // Quick checks for non-URL values
  const isGradient = /^((repeating-)?(linear|radial|conic)-gradient)\(/i.test(entry)
  if (isGradient || entry.trim() === 'none') {
    return entry // leave as is
  }
  // Extract raw URL from url("...") (your existing helper)
  const rawUrl = extractURL(entry)
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
