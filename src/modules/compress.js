/**
 * Perceptual image compression for captures. Opt-in via the `compress` option; a no-op when off,
 * so the default hot path is untouched.
 *
 * Inlined raster images are embedded at their full natural resolution even when shown in a tiny
 * box — those extra pixels can never be seen in the output, they only bloat the SVG payload and
 * slow rasterization. This pass downsamples each <img> data URL to the resolution actually visible
 * (display box × scale × dpr), preserving aspect ratio and never upscaling. Like dropping inaudible
 * frequencies in an MP3: we discard only what the output can't show.
 *
 * Default `format: 'auto'` keeps the source codec (PNG stays lossless), so the win comes from
 * resolution alone — fidelity-neutral. `format: 'webp'|'jpeg'` trades a little fidelity for smaller
 * payloads.
 *
 * @module compress
 */

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function sourceMime(dataURL) {
  const m = /^data:([^;,]+)/.exec(dataURL)
  return m ? m[1] : ''
}

/**
 * Downsample a raster data URL to the largest resolution the target box can show, preserving the
 * source aspect ratio (so object-fit:cover still has enough pixels). Never upscales. Returns a new
 * data URL, or null when downsampling wouldn't help (vector, already small, or the re-encode grew
 * the string).
 *
 * @param {string} dataURL
 * @param {number} targetW - visible box width in device pixels (cssW × scale × dpr)
 * @param {number} targetH - visible box height in device pixels
 * @param {{format?:string, quality?:number}} [opts]
 * @returns {Promise<string|null>}
 */
export async function downsampleDataURL(dataURL, targetW, targetH, opts = {}) {
  if (typeof dataURL !== 'string' || !dataURL.startsWith('data:image')) return null
  // SVG data URLs are vectors — rasterizing them here would *lose* fidelity, not save bytes.
  if (dataURL.startsWith('data:image/svg')) return null

  let img
  try { img = await loadImage(dataURL) } catch { return null }
  const nw = img.naturalWidth || img.width
  const nh = img.naturalHeight || img.height
  if (!nw || !nh) return null

  // Scale factor that still covers the visible box, capped at 1 (no upscaling). The 0.95 guard
  // band avoids re-encoding for a negligible pixel saving.
  const factor = Math.min(1, Math.max(targetW / nw, targetH / nh))
  if (!(factor > 0) || factor >= 0.95) return null

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

  let format = opts.format || 'auto'
  if (format === 'auto') {
    const sm = sourceMime(dataURL)
    // Keep the source codec so lossless stays lossless; fall back to PNG for anything exotic.
    format = sm === 'image/jpeg' ? 'jpeg' : sm === 'image/webp' ? 'webp' : 'png'
  }
  const quality = typeof opts.quality === 'number' ? opts.quality : 0.85
  const mime = format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp'
  try {
    // PNG ignores the quality arg (lossless); JPEG/WebP honor it.
    const out = canvas.toDataURL(mime, quality)
    // Only adopt the re-encoded form if it's actually smaller (a small icon re-encoded can grow).
    if (typeof out === 'string' && out.startsWith('data:image') && out.length < dataURL.length) return out
  } catch { /* tainted canvas / unsupported mime */ }
  return null
}

/**
 * Downsample every inlined <img> data URL in the clone to its visible resolution.
 *
 * @param {Element} clone
 * @param {object} options - normalized capture context (reads scale, dpr, compress)
 * @returns {Promise<{count:number, before:number, after:number}>} bytes before/after (for debug)
 */
export async function compressClonedImages(clone, options) {
  const cfg = options.compress
  if (!cfg) return { count: 0, before: 0, after: 0 }
  const eff = (options.scale || 1) * (options.dpr || 1)
  const imgs = Array.from(clone.querySelectorAll('img'))
  let count = 0, before = 0, after = 0

  const process = async (img) => {
    const src = img.getAttribute('src') || ''
    if (!src.startsWith('data:image') || src.startsWith('data:image/svg')) return
    const cssW = parseFloat(img.dataset.snapdomWidth) || parseFloat(img.style.width) || img.width || 0
    const cssH = parseFloat(img.dataset.snapdomHeight) || parseFloat(img.style.height) || img.height || 0
    if (!cssW || !cssH) return
    const out = await downsampleDataURL(src, cssW * eff, cssH * eff, {
      format: cfg.format,
      quality: cfg.quality
    })
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
