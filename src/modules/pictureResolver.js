/**
 * Core picture / lazy-img resolution for high-fidelity capture.
 * Mirrors the official picture-resolver plugin; runs from captureDOM when enabled.
 *
 * Fast path: {@link quickProbeMayNeedPictureResolver} avoids scanning when no
 * `<picture>` and (if enabled) no lazy `data-*` hints exist in the subtree.
 */

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

/**
 * Cheap hint: might we need picture/lazy resolution? Avoids full scans when false.
 * @param {Element|null|undefined} root
 * @param {boolean} resolveLazySrc
 */
export function quickProbeMayNeedPictureResolver(root, resolveLazySrc) {
  if (!root || !(root instanceof Element)) return false
  if (root.querySelector('picture')) return true
  if (resolveLazySrc) {
    return !!root.querySelector(
      'img[data-src], img[data-lazy-src], img[data-original], img[data-hi-res-src], img[data-srcset], img[data-lazy-srcset]'
    )
  }
  return false
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

    const media = source.getAttribute('media')
    if (media) {
      try {
        if (window.matchMedia(media).matches) {
          return srcset.split(',')[0].trim().split(/\s+/)[0]
        }
      } catch { /* invalid media query */ }
    }
    if (!fallback) fallback = srcset.split(',')[0].trim().split(/\s+/)[0]
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
  if (!root || !(root instanceof Element)) return null
  if (options.resolvePicturePlaceholders === false) return null

  const { timeout, concurrency, resolveLazySrc, silent, useProxy } = mergePictureResolverOpts(options)

  if (!quickProbeMayNeedPictureResolver(root, resolveLazySrc)) return null

  /** @type {Array<() => void>} */
  const undoStack = []
  /** @type {Array<() => Promise<void>>} */
  const tasks = []

  async function fetchAsDataUrl(url) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      let resp = await fetch(url, {
        credentials: 'include',
        signal: controller.signal,
      })
      if (!resp.ok && useProxy) {
        const proxyUrl = useProxy.includes('{url}')
          ? useProxy.replace('{url}', encodeURIComponent(url))
          : useProxy.endsWith('?')
            ? `${useProxy}${encodeURIComponent(url)}`
            : `${useProxy}${useProxy.includes('?') ? '&' : '?'}url=${encodeURIComponent(url)}`
        resp = await fetch(proxyUrl, { signal: controller.signal })
      }
      if (!resp.ok) return null
      const blob = await resp.blob()
      return await new Promise((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(/** @type {string} */ (fr.result))
        fr.onerror = reject
        fr.readAsDataURL(blob)
      })
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  async function runBatched(taskFns) {
    for (let i = 0; i < taskFns.length; i += concurrency) {
      const batch = taskFns.slice(i, i + concurrency)
      await Promise.allSettled(batch.map(fn => fn()))
    }
  }

  const pictures = root.querySelectorAll('picture')
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
    const imgs = root.querySelectorAll('img')
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
