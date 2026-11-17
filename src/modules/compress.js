/**
 * Perceptual image compression. ON by default (`compress: false` is the internal escape hatch,
 * see context.js), so every cost here is paid by every capture that inlines a raster.
 *
 * Each inlined raster (<img> including cloned canvas/video, no-repeat CSS background, SVG
 * <image href>) is downsampled to the resolution its output needs, never upscaled; uncertain
 * geometry keeps extra pixels. PNG stays lossless, JPEG/WebP encode at LOSSY_QUALITY. Originals
 * are kept privately for later exports that need more resolution. An <img> the page has
 * already decoded is drawn from the live element instead of being read again
 * (drawDecodedImages), its original read in the background.
 *
 * @module compress
 */

import { cache } from '../core/cache.js'
import { getStyle } from '../utils/css.js'
import { snapFetch } from './snapFetch.js'
import { readTotalTransformMatrix } from '../utils/transforms.helpers.js'

const ASSET_ATTRIBUTE = 'data-snapdom-asset'
const XLINK_NS = 'http://www.w3.org/1999/xlink'
let assetSequence = 0

/**
 * What one compressCloneAssets call reads and writes besides the clone. `session` receives
 * `compressedAssets` and `compressionDensity` (CaptureSession); `value` is the geometry the
 * three passes resolve once, lazily.
 * @typedef {{session: {compressedAssets?: WeakMap<Node, {token: string, properties: object[]}>|null, compressionDensity?: number}, clip?: {width: number, height: number}|null, rootTransform?: object|null, value?: object}} CompressGeometry
 */

/** Remember only assets that actually shrink. Weak node keys let a differential capture
 * discard removed subtrees; result snapshots below retain bytes, never live DOM nodes.
 * The registry is the run's `compressedAssets` (session.js), created on the first shrink. */
function rememberOriginal(node, kind, name, original, compressed, session) {
  const registry = session.compressedAssets ||= new WeakMap()
  let entry = registry.get(node)
  if (!entry) {
    entry = { token: String(++assetSequence), properties: [] }
    registry.set(node, entry)
    node.setAttribute(ASSET_ATTRIBUTE, entry.token)
  }
  const previous = entry.properties.find(p => p.kind === kind && p.name === name)
  if (previous) {
    // Recompressing the same frozen node must retain its first, full-resolution source.
    if (previous.compressed !== original) previous.original = original
    previous.compressed = compressed
  } else entry.properties.push({ kind, name, original, compressed })
}

const assetValue = (node, property) => property.kind === 'style'
  ? node.style?.getPropertyValue(property.name) : node.getAttribute(property.name)

/** Snapshot the assets still present in the final clone. Later diff captures can mutate
 * their registry without changing the originals held by an already-returned result. */
export function snapshotCompressedAssets(clone, registry) {
  const snapshot = new Map()
  if (!clone || !registry) return snapshot
  const nodes = [clone, ...clone.querySelectorAll(`[${ASSET_ATTRIBUTE}]`)]
  for (const node of nodes) {
    const entry = registry.get(node)
    if (!entry || node.getAttribute(ASSET_ATTRIBUTE) !== entry.token) continue
    const properties = entry.properties.filter(p => assetValue(node, p) === p.compressed)
      .map(p => Object.freeze({ ...p }))
    if (properties.length) snapshot.set(entry.token, Object.freeze(properties))
  }
  return snapshot
}

/** Stable serialization tokens, independent of worker completion order or previous
 * captures. Run on the complete clone immediately before serializing full or diff work. */
export function numberCompressedAssets(clone, registry) {
  if (!clone || !registry) return
  let index = 0
  for (const node of [clone, ...clone.querySelectorAll(`[${ASSET_ATTRIBUTE}]`)]) {
    const entry = registry.get(node)
    if (!entry) continue
    entry.token = String(++index)
    node.setAttribute(ASSET_ATTRIBUTE, entry.token)
  }
}

/** Restore frozen originals only for a later export that needs more resolution. Each
 * value is checked again so an after-render plugin's replacement is never overwritten. */
export async function restoreCompressedAssets(url, snapshot) {
  if (!snapshot?.size || typeof url !== 'string' || !url.startsWith('data:image/svg+xml')) return url
  const comma = url.indexOf(',')
  const svg = new DOMParser().parseFromString(decodeURIComponent(url.slice(comma + 1)), 'image/svg+xml')
  if (svg.querySelector('parsererror')) return url
  let changed = false
  for (const node of svg.querySelectorAll(`[${ASSET_ATTRIBUTE}]`)) {
    for (const property of snapshot.get(node.getAttribute(ASSET_ATTRIBUTE)) || []) {
      if (assetValue(node, property) !== property.compressed) continue
      // A string, or the Blob drawDecodedImages asked for: null when that read failed, and the
      // asset then keeps the resolution it has.
      let original = await property.original
      if (original == null) continue
      if (typeof original !== 'string') {
        const blob = original
        original = await new Promise((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result)
          reader.onerror = () => resolve(null)
          reader.readAsDataURL(blob)
        })
        if (original == null) continue
      }
      if (property.kind === 'style') node.style.setProperty(property.name, original, node.style.getPropertyPriority(property.name))
      else if (property.name === 'xlink:href') node.setAttributeNS(XLINK_NS, property.name, original)
      else node.setAttribute(property.name, original)
      changed = true
    }
  }
  return changed ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}` : url
}

/** Largest linear stretch of a 2D matrix. Using a bound on both axes also covers skew
 * and rotated/nonuniform scales without undersampling a raster's diagonal detail. */
function matrixStretch(m) {
  if (m.is2D === false) return Infinity
  const sum = m.a * m.a + m.b * m.b + m.c * m.c + m.d * m.d
  const determinant = m.a * m.d - m.b * m.c
  return Math.sqrt((sum + Math.sqrt(Math.max(0, sum * sum - 4 * determinant * determinant))) / 2)
}

/** Resolve output density before the serializer's final bleed measurement. Root/clip
 * dimensions are a conservative lower bound on its viewBox, so shadows only retain extra
 * pixels. Never guess when an explicit output size has no measurable input basis.
 * Writes the density to `geometry.session.compressionDensity`. */
function compressionGeometry(clone, options, geometry) {
  const root = options.element || clone
  const cs = root.isConnected ? getStyle(root) : root.style
  const basis = geometry.clip
  const svgLength = (node, name) => {
    try { return node[name]?.baseVal?.value || 0 } catch { return 0 } // detached relative SVG lengths
  }
  let rootW = basis?.width || root.offsetWidth || parseFloat(cs?.width) || svgLength(root, 'width')
  let rootH = basis?.height || root.offsetHeight || parseFloat(cs?.height) || svgLength(root, 'height')
  const hasW = Number.isFinite(options.width)
  const hasH = Number.isFinite(options.height)
  if (!basis && (hasW || hasH) && rootW && rootH) {
    // A shrinking/rotated root can have a viewBox smaller than its layout box. Resolve
    // that bbox too; using only offsetWidth would then understate the requested density.
    try {
      const m = options.outerTransforms === false && geometry.rootTransform
        ? geometry.rootTransform
        : readTotalTransformMatrix({ baseTransform: cs?.transform, rotate: cs?.rotate, scale: cs?.scale, width: rootW, height: rootH })
      if (m.is2D === false) { rootW = 0; rootH = 0 }
      else {
        const w = Math.abs(m.a) * rootW + Math.abs(m.c) * rootH
        const h = Math.abs(m.b) * rootW + Math.abs(m.d) * rootH
        rootW = Math.min(rootW, w)
        rootH = Math.min(rootH, h)
      }
    } catch { rootW = 0; rootH = 0 }
  }
  const density = (hasW || hasH
    ? Math.max(hasW ? (rootW ? options.width / rootW : Infinity) : 0,
      hasH ? (rootH ? options.height / rootH : Infinity) : 0)
    : (options.scale || 1)) * (options.dpr || 1)
  geometry.session.compressionDensity = density
  const stretches = new WeakMap()
  const stretch = (node) => {
    if (!node || node.nodeType !== 1) return 1
    if (stretches.has(node)) return stretches.get(node)
    const style = node.isConnected ? getStyle(node) : node.style
    let value = 1
    try {
      if (style?.perspective && style.perspective !== 'none') value = Infinity
      const transform = style?.transform
      if (transform && transform !== 'none') value *= matrixStretch(new DOMMatrix(transform))
      else if (node.transform?.baseVal?.numberOfItems) {
        // WebKit can expose an SVG presentation transform as computed 'none'. Read its
        // list without consolidate(), which would mutate the live transform attribute.
        let matrix = new DOMMatrix()
        for (let i = 0; i < node.transform.baseVal.numberOfItems; i++) {
          const m = node.transform.baseVal.getItem(i).matrix
          matrix = matrix.multiply(new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f]))
        }
        value *= matrixStretch(matrix)
      }
      if (style?.scale && style.scale !== 'none') {
        const factors = style.scale.trim().split(/\s+/).map(v => parseFloat(v) / (v.endsWith('%') ? 100 : 1))
        value *= Math.max(...factors.map(Math.abs))
      }
      // Root zoom is neutralized by the clone pass; descendant zoom remains visible.
      if (node !== root && style?.zoom && style.zoom !== 'normal') value *= parseFloat(style.zoom) || 1
      if (node.localName === 'svg' && node.viewBox?.baseVal?.width > 0 && node.viewBox.baseVal.height > 0) {
        const vb = node.viewBox.baseVal
        const dimension = (name) => /^\d+(?:\.\d+)?px$/.test(style?.[name] || '')
          ? parseFloat(style[name]) : svgLength(node, name)
        const w = dimension('width'), h = dimension('height')
        value *= w > 0 && h > 0 ? Math.max(w / vb.width, h / vb.height) : Infinity
      }
    } catch { value = Infinity }
    if (!Number.isFinite(value)) value = Infinity
    if (node !== root) value *= stretch(node.parentElement || node.getRootNode?.().host)
    stretches.set(node, value)
    return value
  }
  return { density, stretch }
}

// JPEG/WebP encoders honor this quality setting, even for a lossless source WebP. PNG ignores
// it and encodes the resampled pixels losslessly. Re-encoding JPEG/WebP can introduce artifacts.
const LOSSY_QUALITY = 0.92

// Target resolution as a fraction of the visible-resolution estimate. Keep it at 1: under 1
// buys a little size on heavily oversized images but shows on barely oversized sharp content,
// a fidelity cost core should not take for the caller. The win is discarding pixels nobody can
// see. Applied only to images that pass the oversize guard.
const RES_FACTOR = 1

// decode() over onload: onload can fire before the pixels are decodable. Do not catch a
// decode() rejection with listeners: it rejects on images already settled (an empty-data PNG
// on Firefox, a raster past Chromium's ~268 Mpx cap), the events have fired, and the capture
// hung forever. A rejection becomes "no gain, embed verbatim".
async function loadImage(src) {
  const img = new Image()
  img.decoding = 'sync'
  img.src = src
  if (typeof img.decode === 'function') {
    await img.decode()
    return img
  }
  await new Promise((resolve, reject) => { img.onload = () => resolve(); img.onerror = reject })
  return img
}

/** The MIME between `data:` and the first `;` or `,`. Empty when there is none. */
function sourceMime(dataURL) {
  const m = /^data:([^;,]+)/.exec(dataURL)
  return m ? m[1] : ''
}

// Below this the worker loses: the base64 string is cloned in and the result cloned back, and
// the pixel work does not cover the two copies. Small images stay on the main thread, where
// their decode is usually warm in the browser's cache.
const WORKER_MIN_CHARS = 64 * 1024

// The sampled key is only a lookup hint: PNG metadata and fixed-size frames can share
// both ends while their pixels differ. Keep the source for an exact equality check, and
// bound the entries and the source + result characters they retain.
const COMPRESS_CACHE_MAX_CHARS = 32 * 1024 * 1024
const COMPRESS_CACHE_MAX_ENTRIES = 50
const compressInFlight = new Map()
/** `pass` counts compressCloneAssets passes, an entry carries the pass that last used it, and
 *  `stored` counts inserts. The bounds apply when a pass that stored something ends, sparing
 *  what any pass used since it began. Applied on every insert they evicted the entry the next
 *  image needed (d-compress, 19 images, 44M characters: a recapture 287 ms, 99 ms served).
 *  Pinned by __tests__/compress.cachePass.test.js. */
let pass = 0
let stored = 0

/** First `maxBytes` decoded bytes of a base64 data URL (null for percent-encoded or
 *  malformed payloads; callers fall through to the decode path). */
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
 * Natural size from the container header, without decoding: "no gain" is the common case (a
 * gallery shows images near natural size), and 4KB of header answers it without a full decode.
 * Null for an unrecognized container.
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
  // our 4KB window, and the decode path takes over.
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
 *  upscaling). At or above 0.95, the small reduction isn't worth a re-encode. Shared so the
 *  header fast path and the decode path can never drift apart. */
function gainFactor(nw, nh, targetW, targetH) {
  const raw = Math.min(1, Math.max(targetW / nw, targetH / nh))
  return (!(raw > 0) || raw >= 0.95) ? 0 : raw
}

// Worker offload: pixel work off the main thread stops blocking interaction. Any failure flips
// to the sync path. The worker repeats gainFactor's guard on its decoded size, since the header
// fast path parses only some containers.
const WORKER_SRC = `self.onmessage = async (e) => {
  const { id, dataURL, blob: given, srcLength, targetW, targetH, resFactor, quality, mime } = e.data
  try {
    const blob = given || await (await fetch(dataURL)).blob()
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
    self.postMessage({ id, url: (url && url.length < srcLength) ? url : null })
  } catch (err) {
    self.postMessage({ id, error: String(err) })
  }
}`

// A small pool, filled on demand: the jobs are CPU-bound and independent per image (9-photo
// gallery: 219 ms on one worker, 145 on four, 138 on eight, so four is the knee), and a page
// with one photo starts one thread. Failure is pool-wide: a construction that throws (CSP) or
// a worker error fails every pending request over to the sync path and closes the route.
const POOL_SIZE = Math.max(1, Math.min(4, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2) - 1))
let _workers = null // null = not tried, false = unavailable/broken, else lazily filled slots
let _next = 0
let _seq = 0
const _pending = new Map()

/** Fail every pending job over to the sync path and close the worker route for good. */
function disableWorkers() {
  for (const resolve of _pending.values()) resolve(undefined)
  _pending.clear()
  if (Array.isArray(_workers)) for (const w of _workers) { try { w?.terminate() } catch { /* ok */ } }
  _workers = false
}

/** One pool slot from the inline script. Null when the constructor throws (CSP). */
function spawnWorker() {
  let src, w = null
  try {
    src = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }))
    w = new Worker(src)
    w.onmessage = (e) => {
      const resolve = _pending.get(e.data.id)
      if (resolve) {
        _pending.delete(e.data.id)
        resolve(e.data.error ? undefined : (e.data.url ?? null))
      }
    }
    w.onerror = disableWorkers
  } catch {
    w = null
  }
  // The worker took its copy of the script at construction; an unrevoked blob URL would pin
  // the source Blob for the page's lifetime. Also runs when construction threw (CSP).
  if (src) URL.revokeObjectURL(src)
  return w
}

/** The next slot round-robin, spawned on first use. `false` once the route is closed, which
 *  is also the answer where Worker or OffscreenCanvas do not exist.
 *  Pinned by __tests__/compress.syncfallback.test.js. */
function getCompressWorker() {
  if (_workers === false) return false
  if (_workers === null) {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return (_workers = false)
    _workers = []
  }
  const i = _next++ % POOL_SIZE
  if (!_workers[i]) {
    const w = spawnWorker()
    if (!w) { disableWorkers(); return false }
    _workers[i] = w
  }
  return _workers[i]
}

// A job takes tens of milliseconds, well under a second for a multi-megapixel photo on a slow
// device, so past 5s the worker is wedged; without the timeout a job that never posts back hangs
// the capture. Pinned by compress.worker.timeout.test.js.
const WORKER_JOB_TIMEOUT = 5000

/** Runs the downsample in the worker. Resolves null (no gain / skip), a data URL, or
 *  undefined when the worker path failed and the caller must use the sync fallback. */
function workerDownsample(dataURL, targetW, targetH, mime, blob) {
  const w = getCompressWorker()
  if (!w) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    const id = ++_seq
    const timer = setTimeout(() => { _pending.delete(id); resolve(undefined) }, WORKER_JOB_TIMEOUT)
    // Stored settler clears the timer, so a prompt answer leaves nothing pending.
    _pending.set(id, (value) => { clearTimeout(timer); resolve(value) })
    try {
      // With a Blob the string stays home: it is only there for the size comparison.
      w.postMessage({ id, dataURL: blob ? '' : dataURL, blob, srcLength: dataURL.length, targetW, targetH, resFactor: RES_FACTOR, quality: LOSSY_QUALITY, mime })
    } catch {
      clearTimeout(timer)
      _pending.delete(id)
      resolve(undefined)
    }
  })
}

/**
 * Downsample a raster data URL to the largest resolution the target box can show, keeping the
 * aspect ratio (object-fit:cover needs it) and never upscaling. Null when it would not help.
 * The header answers "no gain" without a decode and payloads of 64 KB and up go to the worker
 * pool. Results, null included, are memoized by a sampled key with exact source equality.
 * Pinned by __tests__/compress.test.js.
 * @param {string} dataURL
 * @param {number} targetW - required box width in pixels, including output density and transforms
 * @param {number} targetH - visible box height in device pixels
 * @param {Blob} [blob] the same bytes as `dataURL`, when the inline pass still has them
 * @returns {Promise<string|null>}
 */
export async function downsampleDataURL(dataURL, targetW, targetH, blob) {
  if (typeof dataURL !== 'string' || !dataURL.startsWith('data:image')) return null
  // SVG data URLs are vectors: rasterizing them here would *lose* fidelity, not save bytes.
  if (dataURL.startsWith('data:image/svg')) return null

  // Exact source equality prevents a sampled-key collision from returning another image.
  // Rounded-up targets share work without making any caller's output undersized.
  targetW = Math.ceil(targetW)
  targetH = Math.ceil(targetH)
  const cacheKey = dataURL.length + ':' + dataURL.slice(0, 64) + dataURL.slice(-64) +
    ':' + targetW + 'x' + targetH
  const targetCache = cache.compress
  const cached = targetCache.get(cacheKey)
  if (cached?.source === dataURL) {
    cached.pass = pass
    return cached.result
  }
  const pending = compressInFlight.get(cacheKey)
  if (pending?.source === dataURL && pending.cache === targetCache) return pending.promise

  const promise = (async () => {
    // Keep JPEG/WebP encoding; use lossless PNG encoding for other raster types.
    const sm = sourceMime(dataURL)
    const mime = sm === 'image/jpeg' ? 'image/jpeg' : sm === 'image/webp' ? 'image/webp' : 'image/png'

    // Header fast path: settle "is there anything to gain?" before any decode or thread hop.
    const header = naturalSizeFromDataURL(dataURL)
    if (header && header.w > 0 && header.h > 0 && !gainFactor(header.w, header.h, targetW, targetH)) return null

    // Preferred path for big payloads: pixel work in the worker (decode + scale + encode off
    // the main thread). Small ones skip it, see WORKER_MIN_CHARS.
    if (dataURL.length >= WORKER_MIN_CHARS) {
      const offloaded = await workerDownsample(dataURL, targetW, targetH, mime, blob)
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

  const entry = { source: dataURL, promise, cache: targetCache }
  compressInFlight.set(cacheKey, entry)
  try {
    const result = await promise
    if (dataURL.length + (result?.length || 0) <= COMPRESS_CACHE_MAX_CHARS) {
      targetCache.set(cacheKey, { source: dataURL, result, pass })
      stored++
    }
    return result
  } finally {
    if (compressInFlight.get(cacheKey) === entry) compressInFlight.delete(cacheKey)
  }
}

/**
 * The box an <img> clone shows its picture in, in CSS px: snapdom's own data-snapdom-width/height
 * when the clone pass wrote them, else the inline style, else the width/height attributes. Null
 * when there is none, and under `object-fit: none`, which paints the file at its own size and
 * crops it: downsampled to the box, a 3000px photo in a 300px box showed whole.
 * @param {HTMLImageElement} img - the clone
 * @param {Element|undefined} source - its live element
 * @returns {{w: number, h: number}|null}
 */
function imageBox(img, source) {
  const w = parseFloat(img.dataset.snapdomWidth) || parseFloat(img.style.width) || img.width || 0
  const h = parseFloat(img.dataset.snapdomHeight) || parseFloat(img.style.height) || img.height || 0
  if (!w || !h) return null
  if (source?.isConnected && getStyle(source).objectFit === 'none') return null
  return { w, h }
}

/**
 * The type drawDecodedImages keeps, read from the URL: a `data:` MIME or a file extension. Null
 * says the URL does not tell: a `blob:` URL is asked its response headers, any other is left to the passes,
 * which read the real type from the response. Guessed, an SVG behind a `blob:` URL was
 * rasterized and a JPEG behind one came out as a PNG four times its size.
 * @param {string} src
 * @returns {string|null}
 */
function decodedType(src) {
  const m = /^data:image\/(jpe?g|png|webp)[;,]|\.(jpe?g|png|webp)(?:$|[?#])/i.exec(src)
  if (!m) return null
  const type = (m[1] || m[2]).toLowerCase()
  return `image/${type === 'jpg' ? 'jpeg' : type}`
}

/**
 * Draw every oversized <img> the page has already decoded to its visible size, from the live
 * element, and write that to the clone. Run before the passes that read sources, which then
 * find a small data: URL and leave it: the photo gallery of the real-page bench (9 photos,
 * 16 Mpx shown in 0.6) re-read 24.5 MB of base64, wrote it to the clone (42 ms) and decoded it
 * again on every capture.
 *
 * Taken only for a loaded <img> that compress would shrink, whose pixels a canvas may read:
 * same origin, blob:, data:, or cross-origin with a `crossorigin` attribute, and that is a JPEG,
 * PNG or WebP by its URL (decodedType) or, behind a `blob:` URL, by its response headers. Anything else is
 * left to the passes as before: an SVG, a GIF, a URL with no extension, and every image of a
 * yielding capture.
 *
 * The original is still owed to a later export at a higher density (exportSource, snapdom.js):
 * its Blob is asked for here, unawaited, and the promise stands where the string would.
 * Pinned by __tests__/compress.decodedImages.test.js.
 * @param {Element} clone
 * @param {object} options - normalized capture context
 * @param {Map<Node, Node>} nodeMap - clone to source
 * @param {CompressGeometry} geometry
 */
export async function drawDecodedImages(clone, options, nodeMap, geometry) {
  if (!options.compress || !nodeMap) return
  // The draws below are one task, 140 ms for nine 6 Mpx photos in Chromium: a yielding capture
  // (fast: false | 'auto') leaves the images to the passes, whose pixel work runs in workers.
  if (geometry.session?.slicer) return
  // Sizing under a dropped root transform needs the matrix captureDOM resolves after the clone.
  if (options.outerTransforms === false && (Number.isFinite(options.width) || Number.isFinite(options.height))) return
  const imgs = Array.from(clone.querySelectorAll('img'))
  if (clone.tagName === 'IMG') imgs.unshift(clone)
  const todo = []
  for (const img of imgs) {
    const source = nodeMap.get(img)
    if (!source || source.localName !== 'img' || !source.complete || !(source.naturalWidth > 0)) continue
    const src = source.currentSrc || source.src || ''
    const type = decodedType(src)
    const local = /^blob:/i.test(src)
    if (!type && !local) continue
    const box = imageBox(img, source)
    if (!box) continue
    const { w: cssW, h: cssH } = box
    const resolved = geometry.value ||= compressionGeometry(clone, options, geometry)
    const eff = resolved.density * resolved.stretch(source)
    const raw = gainFactor(source.naturalWidth, source.naturalHeight, Math.ceil(cssW * eff), Math.ceil(cssH * eff))
    if (!raw) continue
    // `content: url()` on the <img> paints another file than its src, and the clone already
    // holds that one (freezeImgSrcset): drawn from the live element, a red src under a blue
    // replacement came out red.
    if (getStyle(source).content.includes('url(')) continue
    // Last of the gates: a page of images at their own size never parses a URL here.
    if (!/^(?:data|blob):/i.test(src) && source.crossOrigin == null) {
      try { if (new URL(src, source.baseURI).origin !== source.ownerDocument.defaultView.location.origin) continue } catch { continue }
    }
    // A `blob:` URL says nothing of its type, the response headers do. Guessed as PNG, nine
    // 4 Mpx JPEG photos behind `blob:` URLs made 1,413 KB of svg, now 108, and the capture went
    // from 116 to 92 ms in Chromium, 211 to 163 in Firefox, 97 to 64 in WebKit. The request ends
    // at the headers: left to run, its body raced the read below.
    const stop = type ? null : new AbortController()
    const head = stop && fetch(src, { signal: stop.signal }).then((r) => { stop.abort(); return r.headers }, () => null)
    const original = /^data:/i.test(src) ? src
      : snapFetch(src, { as: 'blob', useProxy: options.useProxy }).then((r) => r.ok && r.data ? r.data : null)
    // Drawn now, encoded once the type is in: the headers arrive under the draws. Awaited
    // before each draw, the real-page gallery (nine PNG photos behind `blob:` URLs) went from
    // 149 to 161 ms; this way it stays at 151.
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(source.naturalWidth * raw * RES_FACTOR))
    canvas.height = Math.max(1, Math.round(source.naturalHeight * raw * RES_FACTOR))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
    todo.push({ img, canvas, type, head, original, src })
  }
  for (let { img, canvas, type, head, original, src } of todo) {
    // The size of the file, where the browser gives it for nothing: the length of a data: URL,
    // the headers of a `blob:` one, the page's own load of a same-origin one.
    let size = typeof original === 'string' ? original.length * 0.75 : performance.getEntriesByName(src).pop()?.decodedBodySize
    if (head) {
      const headers = await head
      type = decodedType(`data:${headers?.get('content-type')},`)
      if (!type) continue
      size = +headers.get('content-length')
    }
    let out
    // A redirect to another origin tainted the canvas.
    try { out = canvas.toDataURL(type, LOSSY_QUALITY) } catch { continue }
    // Adopted only when smaller, as in the passes: an 800px JPEG saved at a low quality and
    // shown at 600 came back ten times its size. A size that would have to be read (another
    // origin with no Timing-Allow-Origin) is not asked: waiting for the bytes took nine JPEG
    // photos over HTTP from 27 to 65 ms in Firefox, and behind `blob:` from 63 to 76 in WebKit.
    if (size && out.length * 0.75 >= size) continue
    img.setAttribute('src', out)
    // As a Blob, not base64: the megabytes of text are built only if an export asks. The result
    // holds the file's bytes until then. Read as a data URL here, nine photos
    // landed 24.5 MB of string on the next capture (the gallery read 152 or 212 ms by the run).
    rememberOriginal(img, 'attribute', 'src', original, out, geometry.session)
  }
}

/**
 * Downsample every inlined <img> data URL in the clone to its visible resolution.
 *
 * The visible box is snapdom's own data-snapdom-width/height when the clone pass wrote them,
 * else the inline style, else the element's width/height. An <img> with no box is left alone.
 * @param {Element} clone
 * @param {object} options - normalized capture context, including output sizing and compress
 * @param {Map<Node, Node>} [nodeMap] - Session clone-to-source map for live geometry
 * @param {CompressGeometry} [geometry] - the call's holder, shared by the three passes
 * @returns {Promise<{count:number, before:number, after:number}>} bytes before/after (for debug)
 */
export async function compressClonedImages(clone, options, nodeMap = new Map(), geometry = { session: {} }) {
  if (!options.compress) return { count: 0, before: 0, after: 0 }
  // querySelectorAll never matches clone itself, and a root that IS the <img> was never
  // downsampled (#461).
  const imgs = Array.from(clone.querySelectorAll('img'))
  if (clone.tagName === 'IMG') imgs.unshift(clone)
  let count = 0, before = 0, after = 0

  const process = async (img) => {
    const src = img.getAttribute('src') || ''
    if (!src.startsWith('data:image') || src.startsWith('data:image/svg')) return
    const box = imageBox(img, nodeMap.get(img))
    if (!box) return
    const { w: cssW, h: cssH } = box
    const resolved = geometry.value ||= compressionGeometry(clone, options, geometry)
    const eff = resolved.density * resolved.stretch(nodeMap.get(img) || img)
    const out = await downsampleDataURL(src, cssW * eff, cssH * eff, img.__snapdomBlob)
    if (out) {
      count++
      before += src.length
      after += out.length
      img.setAttribute('src', out)
      rememberOriginal(img, 'attribute', 'src', src, out, geometry.session)
    }
  }

  // Batch of 6 mirrors inlineImages: bounded concurrency for the canvas encode work.
  const BATCH = 6
  for (let i = 0; i < imgs.length; i += BATCH) {
    await Promise.allSettled(imgs.slice(i, i + BATCH).map(process))
  }
  return { count, before, after }
}

/** `cover`, `contain` and percentage sizes derive their resolution from the element box.
 *  `auto` and absolute lengths use a different sizing basis and are skipped. */
const BOX_RELATIVE_BG_SIZE = /^(cover|contain|(\d+(\.\d+)?%(\s+\d+(\.\d+)?%)?))$/

// Unscaled border-box size of the original element. Transform stretch is applied separately;
// the rendered-rect fallback can conservatively retain extra pixels when offset* is unavailable.
function originalBox(el) {
  const w = el.offsetWidth || el.getBoundingClientRect().width || 0
  const h = el.offsetHeight || el.getBoundingClientRect().height || 0
  return { w, h }
}

/**
 * Downsample inlined CSS background data URLs, only for non-repeating layers whose
 * `background-size` is BOX-RELATIVE (`cover`, `contain`, a percentage). Under `auto` or a length
 * the box CROPS the layer, so a smaller source is a different picture: a 1000x1000 photo in a
 * 200x200 div showed whole, and a negative-position sprite painted nothing. Tiles need their
 * natural size. Pinned by the background cases in __tests__/compress.test.js.
 * @param {Element} clone
 * @param {object} options
 * @param {Map<Node, Node>} [nodeMap] - Session clone-to-source map; unmapped backgrounds are skipped
 * @param {CompressGeometry} [geometry] - the call's holder, shared by the three passes
 * @returns {Promise<{count:number}>}
 */
export async function compressClonedBackgrounds(clone, options, nodeMap = new Map(), geometry = { session: {} }) {
  if (!options.compress) return { count: 0 }
  const els = []
  // include the root clone itself, then descendants. Inlined background data URLs live in the
  // style attribute, so the selector only skips elements the includes() test would reject.
  const candidates = [clone, ...clone.querySelectorAll('[style*="data:image"]')]
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
    // Any repeating layer bails: the box is not the target.
    const repeat = (cs.backgroundRepeat || 'repeat').toLowerCase()
    if (repeat.split(',').some(r => r.trim() !== 'no-repeat')) return
    // Every layer must scale WITH the box, or the box is not the resolution to target.
    const size = (el.style.backgroundSize || cs.backgroundSize || 'auto').toLowerCase()
    if (size.split(',').some(v => !BOX_RELATIVE_BG_SIZE.test(v.trim()))) return
    const { w: boxW, h: boxH } = originalBox(orig)
    if (!boxW || !boxH) return
    // A 200% layer paints at twice the box resolution. The largest percentage across
    // layers is conservative and keeps multi-layer replacement independent of parsing.
    const percent = Math.max(1, ...(size.match(/\d+(?:\.\d+)?%/g) || []).map(v => parseFloat(v) / 100))
    const resolved = geometry.value ||= compressionGeometry(clone, options, geometry)
    const eff = resolved.density * resolved.stretch(orig) * percent
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
    if (newBg !== bg) {
      el.style.setProperty('background-image', newBg, el.style.getPropertyPriority('background-image'))
      rememberOriginal(el, 'style', 'background-image', bg, el.style.backgroundImage, geometry.session)
    }
  }

  const BATCH = 6
  for (let i = 0; i < els.length; i += BATCH) {
    await Promise.allSettled(els.slice(i, i + BATCH).map(process))
  }
  return { count }
}

/**
 * Downsample inlined SVG <image href="data:..."> using resolved CSS/attribute dimensions,
 * output density, enclosing SVG viewports and transforms.
 * @param {Element} clone
 * @param {object} options
 * @param {Map<Node, Node>} [nodeMap] - Session clone-to-source map for live geometry
 * @param {CompressGeometry} [geometry] - the call's holder, shared by the three passes
 * @returns {Promise<{count:number}>}
 */
export async function compressClonedSvgImages(clone, options, nodeMap = new Map(), geometry = { session: {} }) {
  if (!options.compress) return { count: 0 }
  const imgs = Array.from(clone.querySelectorAll('image'))
  if (clone.localName === 'image') imgs.unshift(clone)
  let count = 0

  const process = async (el) => {
    const href = el.getAttribute('href') ||
      (typeof el.getAttributeNS === 'function' ? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') : null)
    if (!href || !href.startsWith('data:image') || href.startsWith('data:image/svg')) return
    // parseFloat('100%') is 100, so a percentage-sized <image> was downsampled to a 100x100
    // target and a full-width photo came back roughly 10x too small. Percentage attributes
    // remain a conservative skip rather than assuming a cross-engine used-value conversion.
    const wAttr = el.getAttribute('width') || ''
    const hAttr = el.getAttribute('height') || ''
    if (wAttr.includes('%') || hAttr.includes('%')) return
    const original = nodeMap.get(el)
    const style = original ? getStyle(original) : el.style
    const usedLength = (name, attr) => {
      if (/^\d+(?:\.\d+)?px$/.test(style?.[name] || '')) return parseFloat(style[name])
      if (/^\d+(?:\.\d+)?(?:px)?$/.test(attr.trim())) return parseFloat(attr)
      // SVG lengths such as em are not plain user-unit numbers. Resolve on the live
      // source when available; an unlaid-out clone cannot safely supply that resolution.
      try { return original?.[name]?.baseVal?.value || 0 } catch { return 0 }
    }
    const w = usedLength('width', wAttr)
    const h = usedLength('height', hAttr)
    if (!w || !h) return
    const resolved = geometry.value ||= compressionGeometry(clone, options, geometry)
    const eff = resolved.density * resolved.stretch(original || el)
    const out = await downsampleDataURL(href, w * eff, h * eff)
    if (out) {
      el.setAttribute('href', out)
      rememberOriginal(el, 'attribute', 'href', href, out, geometry.session)
      if (el.hasAttribute('xlink:href')) {
        el.setAttributeNS(XLINK_NS, 'xlink:href', out)
        rememberOriginal(el, 'attribute', 'xlink:href', href, out, geometry.session)
      }
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
 * Run all compression passes over the clone (no-op when `compress` is off), after images and
 * backgrounds are inlined: it works on the data URLs those passes wrote.
 * @param {Element} clone
 * @param {object} options
 * @param {Map<Node, Node>} [nodeMap] - the capture's own clone-to-source map, nested ones included
 * @param {CompressGeometry} [geometry] - fresh per call: a diff root never reuses another root's
 * @returns {Promise<void>}
 */
export async function compressCloneAssets(clone, options, nodeMap, geometry = { session: {} }) {
  if (!options.compress) return
  const since = ++pass
  const before = stored
  await compressClonedImages(clone, options, nodeMap, geometry)
  await compressClonedBackgrounds(clone, options, nodeMap, geometry)
  await compressClonedSvgImages(clone, options, nodeMap, geometry)
  if (stored === before) return
  const kept = cache.compress
  let chars = 0
  for (const entry of kept.values()) chars += entry.source.length + (entry.result?.length || 0)
  for (const [key, entry] of kept) {
    if (chars <= COMPRESS_CACHE_MAX_CHARS && kept.size <= COMPRESS_CACHE_MAX_ENTRIES) break
    if (entry.pass >= since) continue
    chars -= entry.source.length + (entry.result?.length || 0)
    kept.delete(key)
  }
}
