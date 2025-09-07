import { cache } from "../core/cache";
import { extractURL, safeEncodeURI } from "./helpers";
import { snapFetch } from "../modules/snapFetch";

/**
 * Adds a background color to the canvas if specified.
 * @param {HTMLCanvasElement} baseCanvas - Source canvas element.
 * @param {string} backgroundColor - CSS color string for the background.
 * @returns {HTMLCanvasElement} Returns the original canvas if no background needed,
 * or a new canvas with the background applied.
 */
export function createBackground(baseCanvas, backgroundColor) {
  if (!backgroundColor || !baseCanvas.width || !baseCanvas.height) {
    return baseCanvas;
  }

  const temp = document.createElement('canvas');
  temp.width = baseCanvas.width;
  temp.height = baseCanvas.height;
  const ctx = temp.getContext('2d');

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, temp.width, temp.height);
  ctx.drawImage(baseCanvas, 0, 0);

  return temp;
}

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
  const isGradient = /^((repeating-)?(linear|radial|conic)-gradient)\(/i.test(entry);
  if (isGradient || entry.trim() === "none") {
    return entry; // leave as is
  }

  // Extract raw URL from url("...") (your existing helper)
  const rawUrl = extractURL(entry);
  if (!rawUrl) {
    // Not a URL(...) we recognize → keep original as a safe fallback
    return entry;
  }

  // Normalize / encode the URL string for cache key & fetch
  const encodedUrl = safeEncodeURI(rawUrl);

  // Fast path: cached success
  if (cache.background.has(encodedUrl)) {
    const dataUrl = cache.background.get(encodedUrl);
    return dataUrl ? `url("${dataUrl}")` : "none";
  }

  // Try to inline; never throw — degrade to "none" on failure
  try {
    const dataUrl = await snapFetch(encodedUrl, {as:'dataURL', useProxy: options.useProxy});
    // Guard: ensure it actually looks like an image data URL
    if (dataUrl.ok) {
      cache.background.set(encodedUrl, dataUrl.data);
      return `url("${dataUrl.data}")`;
    }
    // Unexpected format → degrade safely
    cache.background.set(encodedUrl, null);
    return "none";
  } catch {
    // On any error (404/CORS/timeout/tainted/etc.), don't break the capture
    cache.background.set(encodedUrl, null); // remember failure to avoid loops
    return "none";
  }
}
