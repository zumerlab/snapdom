/**
 * Perceptual image compression for captures. Opt-in via `compress: true`; a no-op when off, so the
 * default hot path is untouched.
 *
 * Inlined raster images are embedded at their full natural resolution even when shown in a tiny
 * box — those extra pixels can never be seen in the output, they only bloat the SVG payload and
 * slow rasterization. This pass downsamples each <img> data URL to the resolution actually visible
 * (display box × scale × dpr), preserving aspect ratio and never upscaling. Like dropping inaudible
 * frequencies in an MP3: we discard only what the output can't show.
 *
 * The source codec is preserved (PNG stays lossless), so the win comes from resolution alone —
 * fidelity-neutral.
 *
 * Covers every inlined raster in the capture: <img> (incl. cloned canvas/video), CSS
 * background-image (no-repeat only — tiled backgrounds need their natural tile resolution), and
 * SVG <image href>.
 *
 * @module compress
 */

import { cache } from '../core/cache.js'

// Quality used only when the source codec is lossy (JPEG/WebP); PNG re-encodes losslessly and
// ignores it. High enough that the re-encode is imperceptible on top of the downscale.
const LOSSY_QUALITY = 0.92

// Aggression: oversized images are downsampled to BELOW their visible resolution. Heavily-oversized
// images (the common case — big photos shown small) lose nothing perceptible; the loss only starts
// to show on barely-oversized sharp content. Only applied to images that pass the oversize guard —
// never to images already at/below their visible size. Lower = smaller/faster, more aggressive.
const RES_FACTOR = 0.95

// Prefer decode() over onload: onload can fire before the pixels are decodable, so drawing in the
// same tick may produce a blank/partial canvas for large images. decode() guarantees drawable pixels.
async function loadImage(src) {
  const img = new Image()
  img.decoding = 'sync'
  img.src = src
  if (typeof img.decode === 'function') {
    try { await img.decode(); return img } catch { /* fall back to onload */ }
  }
  await new Promise((resolve, reject) => { img.onload = () => resolve(); img.onerror = reject })
  return img
}

function sourceMime(dataURL) {
  const m = /^data:([^;,]+)/.exec(dataURL)
  return m ? m[1] : ''
}

/**
 * Downsample a raster data URL to the largest resolution the target box can show, preserving the
 * source aspect ratio (so object-fit:cover still has enough pixels) and codec. Never upscales.
 * Returns a new data URL, or null when downsampling wouldn't help (vector, already small, or the
 * re-encode grew the string).
 *
 * @param {string} dataURL
 * @param {number} targetW - visible box width in device pixels (cssW × scale × dpr)
 * @param {number} targetH - visible box height in device pixels
 * @returns {Promise<string|null>}
 */
export async function downsampleDataURL(dataURL, targetW, targetH) {
  if (typeof dataURL !== 'string' || !dataURL.startsWith('data:image')) return null
  // SVG data URLs are vectors — rasterizing them here would *lose* fidelity, not save bytes.
  if (dataURL.startsWith('data:image/svg')) return null

  // Memoize by a cheap fingerprint (length + head/tail) instead of the full string, so the
  // cache doesn't retain multi-MB keys. Negative results (null) are cached too: they cost a
  // full decode to establish, and repeated captures of the same element hit them every time.
  const cacheKey = dataURL.length + ':' + dataURL.slice(0, 64) + dataURL.slice(-64) +
    ':' + Math.round(targetW) + 'x' + Math.round(targetH)
  if (cache.compress.has(cacheKey)) return cache.compress.get(cacheKey)

  const result = await (async () => {
    let img
    try { img = await loadImage(dataURL) } catch { return null }
    const nw = img.naturalWidth || img.width
    const nh = img.naturalHeight || img.height
    if (!nw || !nh) return null

    // Scale factor that still covers the visible box, capped at 1 (no upscaling). The 0.95 guard
    // band avoids re-encoding for a negligible pixel saving — gauged on the visible target, before
    // the aggression trim.
    const raw = Math.min(1, Math.max(targetW / nw, targetH / nh))
    if (!(raw > 0) || raw >= 0.95) return null
    const factor = raw * RES_FACTOR

    const ow = Math.max(1, Math.round(nw * factor))
    const oh = Math.max(1, Math.round(nh * factor))

    const canvas = document.createElement('canvas')
    canvas.width = ow
    canvas.height = oh
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, ow, oh)

    // Preserve the source codec so lossless stays lossless; fall back to PNG for anything exotic.
    const sm = sourceMime(dataURL)
    const mime = sm === 'image/jpeg' ? 'image/jpeg' : sm === 'image/webp' ? 'image/webp' : 'image/png'
    try {
      // PNG ignores the quality arg (lossless); JPEG/WebP honor it.
      const out = canvas.toDataURL(mime, LOSSY_QUALITY)
      // Only adopt the re-encoded form if it's actually smaller (a small icon re-encoded can grow).
      if (typeof out === 'string' && out.startsWith('data:image') && out.length < dataURL.length) return out
    } catch { /* tainted canvas / unsupported mime */ }
    return null
  })()

  cache.compress.set(cacheKey, result)
  return result
}

/**
 * Downsample every inlined <img> data URL in the clone to its visible resolution.
 *
 * @param {Element} clone
 * @param {object} options - normalized capture context (reads scale, dpr, compress)
 * @returns {Promise<{count:number, before:number, after:number}>} bytes before/after (for debug)
 */
export async function compressClonedImages(clone, options) {
  if (!options.compress) return { count: 0, before: 0, after: 0 }
  const eff = (options.scale || 1) * (options.dpr || 1)
  const imgs = Array.from(clone.querySelectorAll('img'))
  let count = 0, before = 0, after = 0

  const process = async (img) => {
    const src = img.getAttribute('src') || ''
    if (!src.startsWith('data:image') || src.startsWith('data:image/svg')) return
    const cssW = parseFloat(img.dataset.snapdomWidth) || parseFloat(img.style.width) || img.width || 0
    const cssH = parseFloat(img.dataset.snapdomHeight) || parseFloat(img.style.height) || img.height || 0
    if (!cssW || !cssH) return
    const out = await downsampleDataURL(src, cssW * eff, cssH * eff)
    if (out) {
      count++
      before += src.length
      after += out.length
      img.setAttribute('src', out)
    }
  }

  // Batch of 6 mirrors inlineImages — bounded concurrency for the canvas encode work.
  const BATCH = 6
  for (let i = 0; i < imgs.length; i += BATCH) {
    await Promise.allSettled(imgs.slice(i, i + BATCH).map(process))
  }
  return { count, before, after }
}

// Unscaled border-box size of the original element (offset* ignores CSS transforms, matching the
// resolution snapdom captures at). Falls back to the rendered rect.
function originalBox(el) {
  const w = el.offsetWidth || el.getBoundingClientRect().width || 0
  const h = el.offsetHeight || el.getBoundingClientRect().height || 0
  return { w, h }
}

/**
 * Downsample inlined CSS background-image data URLs to the element's visible box. Only for
 * non-repeating backgrounds: a background clips to the element box, so the box bounds what's
 * visible regardless of background-size (cover/contain/auto/explicit). Tiled backgrounds (`repeat`,
 * `space`, `round`) are skipped — a small tile repeated needs its natural resolution.
 *
 * @param {Element} clone
 * @param {object} options
 * @param {Map<Node, Node>} [nodeMap] - Session clone→source map (falls back to the global)
 * @returns {Promise<{count:number}>}
 */
export async function compressClonedBackgrounds(clone, options, nodeMap = cache.session.nodeMap) {
  if (!options.compress) return { count: 0 }
  const eff = (options.scale || 1) * (options.dpr || 1)
  const els = []
  // include the root clone itself, then descendants
  const candidates = [clone, ...clone.querySelectorAll('*')]
  for (const el of candidates) {
    const bg = el.style && el.style.backgroundImage
    if (bg && bg.includes('data:image')) els.push(el)
  }
  let count = 0

  const process = async (el) => {
    const orig = nodeMap.get(el)
    if (!orig || !orig.isConnected) return
    let cs
    try { cs = getComputedStyle(orig) } catch { return }
    // Any repeating layer → bail (can't treat the box as the target).
    const repeat = (cs.backgroundRepeat || 'repeat').toLowerCase()
    if (repeat.split(',').some(r => r.trim() !== 'no-repeat')) return
    const { w: boxW, h: boxH } = originalBox(orig)
    if (!boxW || !boxH) return
    const tw = boxW * eff, th = boxH * eff

    const bg = el.style.backgroundImage
    const matches = [...bg.matchAll(/url\((['"]?)(data:image\/[^)'"]+)\1\)/gi)]
    let newBg = bg
    for (const m of matches) {
      const dataURL = m[2]
      if (dataURL.startsWith('data:image/svg')) continue
      const out = await downsampleDataURL(dataURL, tw, th)
      if (out) { newBg = newBg.split(dataURL).join(out); count++ }
    }
    if (newBg !== bg) el.style.backgroundImage = newBg
  }

  const BATCH = 6
  for (let i = 0; i < els.length; i += BATCH) {
    await Promise.allSettled(els.slice(i, i + BATCH).map(process))
  }
  return { count }
}

/**
 * Downsample inlined SVG <image href="data:..."> to its rendered size (width/height attrs × eff).
 * @param {Element} clone
 * @param {object} options
 * @returns {Promise<{count:number}>}
 */
export async function compressClonedSvgImages(clone, options) {
  if (!options.compress) return { count: 0 }
  const eff = (options.scale || 1) * (options.dpr || 1)
  const imgs = Array.from(clone.querySelectorAll('image'))
  let count = 0

  const process = async (el) => {
    const href = el.getAttribute('href') ||
      (typeof el.getAttributeNS === 'function' ? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') : null)
    if (!href || !href.startsWith('data:image') || href.startsWith('data:image/svg')) return
    const w = parseFloat(el.getAttribute('width')) || 0
    const h = parseFloat(el.getAttribute('height')) || 0
    if (!w || !h) return
    const out = await downsampleDataURL(href, w * eff, h * eff)
    if (out) {
      el.setAttribute('href', out)
      if (el.hasAttribute('xlink:href')) el.setAttribute('xlink:href', out)
      count++
    }
  }

  const BATCH = 6
  for (let i = 0; i < imgs.length; i += BATCH) {
    await Promise.allSettled(imgs.slice(i, i + BATCH).map(process))
  }
  return { count }
}

/**
 * Run all compression passes over the clone (no-op when `compress` is off).
 * @param {Element} clone
 * @param {object} options
 * @param {Map<Node, Node>} [nodeMap] - Session clone→source map; pass the capture's own
 *   reference — the global fallback can be stale after nested iframe captures.
 * @returns {Promise<void>}
 */
export async function compressCloneAssets(clone, options, nodeMap) {
  if (!options.compress) return
  await compressClonedImages(clone, options)
  await compressClonedBackgrounds(clone, options, nodeMap)
  await compressClonedSvgImages(clone, options)
}
