/**
 * Core picture / lazy-img resolution for high-fidelity capture.
 * Mirrors the official picture-resolver plugin; runs from captureDOM when enabled.
 *
 * Fast path: {@link quickProbeMayNeedPictureResolver} avoids scanning when no
 * `<picture>` and (if enabled) no lazy `data-*` hints exist in the subtree.
 */
import { snapFetch } from './snapFetch.js'

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

const LAZY_IMG_SELECTOR =
  'img[data-src], img[data-lazy-src], img[data-original], img[data-hi-res-src], img[data-srcset], img[data-lazy-srcset]'

/**
 * Cheap hint: might we need picture/lazy resolution? Avoids full scans when false.
 * querySelector never matches root itself, so a capture root that IS the <picture>/lazy
 * <img> (e.g. snapdom(pictureEl) for a single hero image) was silently skipped.
 * @param {Element|null|undefined} root
 * @param {boolean} resolveLazySrc
 */
export function quickProbeMayNeedPictureResolver(root, resolveLazySrc) {
  if (!root || (root?.nodeType !== 1)) return false
  if (root.matches?.('picture') || root.querySelector('picture')) return true
  if (resolveLazySrc) {
    return !!(root.matches?.(LAZY_IMG_SELECTOR) || root.querySelector(LAZY_IMG_SELECTOR))
  }
  return false
}

/** Raster types every target engine decodes; anything else (jxl, tiff…) the browser's own
 *  <picture> type-support step would skip, so freezing it diverges from what the page shows. */
const SUPPORTED_SOURCE_TYPE = /^image\/(jpeg|jpg|png|gif|webp|avif|apng|svg\+xml|bmp|x-icon|vnd\.microsoft\.icon)\s*(;|$)/i

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

/**
 * @param {object} options - capture options (useProxy, pictureResolver, …)
 */
function mergePictureResolverOpts(options = {}) {
  const pr = options.pictureResolver && typeof options.pictureResolver === 'object'
    ? options.pictureResolver
    : {}
  return {
    timeout: pr.timeout ?? 5000,
    concurrency: pr.concurrency ?? 4,
    resolveLazySrc: pr.resolveLazySrc !== false,
    silent: pr.silent ?? false,
    useProxy: typeof options.useProxy === 'string' ? options.useProxy : '',
  }
}

/**
 * Run resolution on live DOM before clone. Returns an async undo, or null if nothing to do.
 * @param {Element} root
 * @param {object} options
 * @returns {Promise<(() => Promise<void>)|null>}
 */
export async function runPictureResolverBeforeClone(root, options = {}) {
  if (!root || (root?.nodeType !== 1)) return null
  if (options.resolvePicturePlaceholders === false) return null

  const { timeout, concurrency, resolveLazySrc, silent, useProxy } = mergePictureResolverOpts(options)

  if (!quickProbeMayNeedPictureResolver(root, resolveLazySrc)) return null

  /** @type {Array<() => void>} */
  const undoStack = []
  /** @type {Array<() => Promise<void>>} */
  const tasks = []

  async function fetchAsDataUrl(url) {
    const res = await snapFetch(url, { as: 'dataURL', timeout, useProxy, silent: true })
    return res.ok ? /** @type {string} */ (res.data) : null
  }

  async function runBatched(taskFns) {
    for (let i = 0; i < taskFns.length; i += concurrency) {
      const batch = taskFns.slice(i, i + concurrency)
      await Promise.allSettled(batch.map(fn => fn()))
    }
  }

  // querySelectorAll never matches root itself — a capture root that IS the <picture>/lazy
  // <img> was silently skipped (see #461 for the same shape in images.js).
  const pictures = Array.from(root.querySelectorAll('picture'))
  if (root.matches?.('picture')) pictures.unshift(root)
  for (const picture of pictures) {
    const img = picture.querySelector('img')
    if (!img) continue
    const originalSrc = img.getAttribute('src') || ''
    if (!isPlaceholderSrc(originalSrc)) continue
    const realUrl = findRealUrlForPicture(img, picture)
    if (!realUrl) continue

    tasks.push(async () => {
      const dataUrl = await fetchAsDataUrl(realUrl)
      if (!dataUrl) {
        if (!silent) console.warn(`[snapdom:picture-resolver] Failed to fetch: ${realUrl.slice(0, 60)}`)
        return
      }
      const origAttr = img.getAttribute('src')
      const origSrcset = img.getAttribute('srcset')
      const origSizes = img.getAttribute('sizes')
      const removedSources = []
      img.src = dataUrl
      img.setAttribute('src', dataUrl)
      img.removeAttribute('srcset')
      img.removeAttribute('sizes')
      const sources = picture.querySelectorAll('source')
      for (const s of sources) {
        removedSources.push({ el: s, parent: s.parentElement, next: s.nextSibling })
        s.remove()
      }
      undoStack.push(() => {
        if (origAttr !== null) img.setAttribute('src', origAttr)
        else img.removeAttribute('src')
        if (origSrcset !== null) img.setAttribute('srcset', origSrcset)
        if (origSizes !== null) img.setAttribute('sizes', origSizes)
        for (const { el, parent, next } of removedSources) {
          if (parent) parent.insertBefore(el, next)
        }
      })
    })
  }

  if (resolveLazySrc) {
    const imgs = Array.from(root.querySelectorAll('img'))
    if (root.localName === 'img') imgs.unshift(root)
    for (const img of imgs) {
      if (img.closest('picture') && isPlaceholderSrc(img.getAttribute('src') || '')) continue
      const currentSrc = img.getAttribute('src') || ''
      const lazySrc = findLazySrcAttr(img)
      if (lazySrc && isPlaceholderSrc(currentSrc)) {
        tasks.push(async () => {
          const dataUrl = await fetchAsDataUrl(lazySrc)
          if (!dataUrl) return
          const origSrc = img.getAttribute('src')
          img.src = dataUrl
          img.setAttribute('src', dataUrl)
          img.removeAttribute('srcset')
          img.removeAttribute('sizes')
          undoStack.push(() => {
            if (origSrc !== null) img.setAttribute('src', origSrc)
            else img.removeAttribute('src')
          })
        })
      }
    }
  }

  if (tasks.length === 0) return null

  await runBatched(tasks)

  return async function undoPictureResolverMutations() {
    for (const undo of undoStack) {
      try { undo() } catch { /* non-blocking */ }
    }
  }
}

/**
 * Back-compat plugin factory (same API as @zumer/snapdom-plugins/picture-resolver).
 * @param {object} [pluginOptions]
 * @returns {import('../core/plugins.js').Plugin}
 */
export function pictureResolver(pluginOptions = {}) {
  let undo = null
  return {
    name: 'picture-resolver',
    async beforeClone(ctx) {
      const merged = {
        ...ctx.options,
        pictureResolver: { ...pluginOptions, ...(ctx.options.pictureResolver || {}) },
      }
      undo = await runPictureResolverBeforeClone(ctx.element, merged)
    },
    async afterClone() {
      if (undo) await undo()
      undo = null
    },
  }
}
