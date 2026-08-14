/**
 * Perceptual image compression for captures. ON by default (`compress: false` is the internal
 * escape hatch, see context.js) — this IS the default hot path, so every cost here is paid by
 * every capture that inlines a raster.
 *
 * Inlined raster images are embedded at their full natural resolution even when shown in a tiny
 * box — those extra pixels can never be seen in the output, they only bloat the SVG payload and
 * slow rasterization. This pass downsamples each <img> data URL to the resolution actually visible
 * (display box × scale × dpr), preserving aspect ratio and never upscaling. Like dropping barely
 * audible frequencies in an MP3: we discard detail the output can barely show.
 *
 * This is NOT fidelity-neutral, and deliberately so. The source codec is preserved (PNG stays
 * lossless) so most of the win is pure resolution, but two knobs do cost detail: RES_FACTOR aims
 * slightly BELOW the visible resolution, and JPEG/WebP sources are re-encoded at LOSSY_QUALITY.
 * Both are measured wins on payload size and rasterize time, and both cost a small, bounded,
 * deliberate amount of detail. See each constant for its own reasoning.
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

// Below this, the worker LOSES: postMessage structured-clones the whole base64 string in,
// FileReaderSync clones another one back, and the payload isn't big enough for the pixel
// work to cover those two copies. Small images stay on the main thread, where their decode
// is usually already warm in the browser's cache.
const WORKER_MIN_CHARS = 64 * 1024

/** First `maxBytes` decoded bytes of a base64 data URL (null for percent-encoded or
 *  malformed payloads — callers just fall through to the decode path). */
function headerBytes(dataURL, maxBytes) {
  const comma = dataURL.indexOf(',')
  if (comma < 0 || !/;base64/i.test(dataURL.slice(0, comma))) return null
  const want = Math.ceil(maxBytes / 3) * 4
  const avail = dataURL.length - comma - 1
  const take = Math.min(avail, want)
  try {
    const bin = atob(dataURL.slice(comma + 1, comma + 1 + take - (take % 4)))
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/**
 * Natural size straight from the container header, without decoding the image.
 *
 * This exists because the "no gain" verdict is the COMMON case (a gallery shows its images
 * at or near natural size) and it used to cost a full decode — inside the worker, behind two
 * clones of the whole base64 string. Reading 4KB of header answers it for free.
 * Unrecognized container → null → the old decode path decides, as before.
 * @returns {{w:number,h:number}|null}
 */
function naturalSizeFromDataURL(dataURL) {
  const b = headerBytes(dataURL, 4096)
  if (!b || b.length < 16) return null
  const u16 = (o) => (b[o] << 8) | b[o + 1]
  // PNG: IHDR width/height are fixed at offsets 16/20.
  if (b[0] === 0x89 && b[1] === 0x50 && b.length >= 24) {
    return { w: (b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0, h: (b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0 }
  }
  // GIF: logical screen descriptor, little-endian.
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) }
  // WebP: RIFF….WEBP, then one of three chunk layouts.
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b.length >= 30) {
    const kind = b[15]
    if (kind === 0x20 && b[23] === 0x9D) return { w: (b[26] | (b[27] << 8)) & 0x3FFF, h: (b[28] | (b[29] << 8)) & 0x3FFF } // VP8 (lossy)
    if (kind === 0x4C) return { w: (b[21] | ((b[22] & 0x3F) << 8)) + 1, h: (((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0F) << 10)) & 0x3FFF) + 1 } // VP8L
    if (kind === 0x58) return { w: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1, h: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1 } // VP8X
  }
  // JPEG: walk the segment chain to the first SOFn. A large EXIF thumbnail can push it past
  // our 4KB window — that just falls through to the decode path.
  if (b[0] === 0xFF && b[1] === 0xD8) {
    let p = 2
    while (p + 9 < b.length) {
      if (b[p] !== 0xFF) { p++; continue }
      const marker = b[p + 1]
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { p += 2; continue }
      if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        return { h: u16(p + 5), w: u16(p + 7) }
      }
      const len = u16(p + 2)
      if (len < 2) break
      p += 2 + len
    }
  }
  return null
}

/** The oversize guard: the scale factor that still covers the visible box, capped at 1 (no
 *  upscaling). Below the 0.95 guard band the re-encode isn't worth its cost. Shared so the
 *  header fast path and the decode path can never drift apart. */
function gainFactor(nw, nh, targetW, targetH) {
  const raw = Math.min(1, Math.max(targetW / nw, targetH / nh))
  return (!(raw > 0) || raw >= 0.95) ? 0 : raw
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

// ——— Worker offload (E) ———
// decode + downscale + re-encode are pure pixel work: off the main thread they stop
// blocking interaction during image-heavy captures and run in parallel with the rest of
// the pipeline. Inline worker (no build infra); any failure flips to the sync path.
const WORKER_SRC = `self.onmessage = async (e) => {
  const { id, dataURL, targetW, targetH, resFactor, quality, mime } = e.data
  try {
    const blob = await (await fetch(dataURL)).blob()
    const bmp = await createImageBitmap(blob)
    const nw = bmp.width, nh = bmp.height
    if (!nw || !nh) { bmp.close(); self.postMessage({ id, url: null }); return }
    const raw = Math.min(1, Math.max(targetW / nw, targetH / nh))
    if (!(raw > 0) || raw >= 0.95) { bmp.close(); self.postMessage({ id, url: null }); return }
    const factor = raw * resFactor
    const ow = Math.max(1, Math.round(nw * factor))
    const oh = Math.max(1, Math.round(nh * factor))
    const canvas = new OffscreenCanvas(ow, oh)
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bmp, 0, 0, ow, oh)
    bmp.close()
    const out = await canvas.convertToBlob({ type: mime, quality })
    const url = new FileReaderSync().readAsDataURL(out)
    self.postMessage({ id, url: (url && url.length < dataURL.length) ? url : null })
  } catch (err) {
    self.postMessage({ id, error: String(err) })
  }
}`

let _worker = null // null = not tried, false = unavailable/broken
let _seq = 0
const _pending = new Map()
function getCompressWorker() {
  if (_worker !== null) return _worker
  let src
  try {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      _worker = false
      return false
    }
    src = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }))
    const w = new Worker(src)
    w.onmessage = (e) => {
      const resolve = _pending.get(e.data.id)
      if (resolve) {
        _pending.delete(e.data.id)
        resolve(e.data.error ? undefined : (e.data.url ?? null))
      }
    }
    w.onerror = () => {
      // Broken worker (CSP, engine gap): fail every pending request over to the sync path
      // and stop using it.
      for (const resolve of _pending.values()) resolve(undefined)
      _pending.clear()
      try { w.terminate() } catch { /* ok */ }
      _worker = false
    }
    _worker = w
  } catch {
    _worker = false
  }
  // The worker took its copy of the script at construction; an unrevoked blob URL would pin
  // the source Blob for the page's lifetime. Also runs when construction threw (CSP).
  if (src) URL.revokeObjectURL(src)
  return _worker
}

// A job is one createImageBitmap + one drawImage + one convertToBlob: tens of milliseconds for
// a typical photo, and still well under a second for a multi-megapixel source on a slow device.
// Past 5s the worker is wedged, not busy — only `onerror` ever drained `_pending`, so a job that
// simply never posts back used to hang the capture forever. Falling back costs one redundant
// main-thread encode and produces the same pixels.
const WORKER_JOB_TIMEOUT = 5000

/** Runs the downsample in the worker. Resolves null (no gain / skip), a data URL, or
 *  undefined when the worker path failed and the caller must use the sync fallback. */
function workerDownsample(dataURL, targetW, targetH, mime) {
  const w = getCompressWorker()
  if (!w) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    const id = ++_seq
    const timer = setTimeout(() => { _pending.delete(id); resolve(undefined) }, WORKER_JOB_TIMEOUT)
    // Stored settler clears the timer, so a prompt answer leaves nothing pending.
    _pending.set(id, (value) => { clearTimeout(timer); resolve(value) })
    try {
      w.postMessage({ id, dataURL, targetW, targetH, resFactor: RES_FACTOR, quality: LOSSY_QUALITY, mime })
    } catch {
      clearTimeout(timer)
      _pending.delete(id)
      resolve(undefined)
    }
  })
}

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
    // Preserve the source codec so lossless stays lossless; fall back to PNG for anything exotic.
    const sm = sourceMime(dataURL)
    const mime = sm === 'image/jpeg' ? 'image/jpeg' : sm === 'image/webp' ? 'image/webp' : 'image/png'

    // Header fast path: settle "is there anything to gain?" before any decode or thread hop.
    const header = naturalSizeFromDataURL(dataURL)
    if (header && header.w > 0 && header.h > 0 && !gainFactor(header.w, header.h, targetW, targetH)) return null

    // Preferred path for big payloads: pixel work in the worker (decode + scale + encode off
    // the main thread). Small ones skip it — see WORKER_MIN_CHARS.
    if (dataURL.length >= WORKER_MIN_CHARS) {
      const offloaded = await workerDownsample(dataURL, targetW, targetH, mime)
      if (offloaded !== undefined) return offloaded
    }

    // Main-thread path: small payloads, and the fallback when the worker is unavailable
    // (no Worker/OffscreenCanvas, CSP-blocked blob workers, worker error).
    let img
    try { img = await loadImage(dataURL) } catch { return null }
    const nw = img.naturalWidth || img.width
    const nh = img.naturalHeight || img.height
    if (!nw || !nh) return null

    const raw = gainFactor(nw, nh, targetW, targetH)
    if (!raw) return null
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
  // querySelectorAll never matches clone itself — a capture root that IS the <img> (#461)
  // was inlined but never downsampled, so compress:true silently did nothing for it.
  const imgs = Array.from(clone.querySelectorAll('img'))
  if (clone.tagName === 'IMG') imgs.unshift(clone)
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
export async function compressClonedBackgrounds(clone, options, nodeMap = new Map()) {
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
  if (clone.localName === 'image') imgs.unshift(clone)
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
