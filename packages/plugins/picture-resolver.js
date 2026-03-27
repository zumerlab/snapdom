/**
 * pictureResolver - Official SnapDOM Plugin
 *
 * Resolves lazy-loaded <picture> elements that use base64/low-quality placeholders
 * in <img src> while the real image lives in <source srcset>.
 *
 * Common pattern in news sites (La Nación, Clarín, NYT, Medium, etc.):
 *   <picture>
 *     <source srcset="https://cdn.example.com/real-image.jpg" media="...">
 *     <img src="data:image/jpeg;base64,/9j/4AAQ..." alt="...">  ← tiny placeholder
 *   </picture>
 *
 * The browser renders the real image visually, but DOM cloning captures the
 * placeholder because cloneNode copies the HTML attribute, not the rendered source.
 *
 * This plugin:
 *   1. Detects <picture> elements with base64/blob placeholder <img src>
 *   2. Resolves the real URL from <source srcset> or img.currentSrc
 *   3. Fetches the real image using the browser's context (correct Referer/cookies)
 *   4. Replaces img src with the fetched data URL (attribute + property)
 *   5. Removes <source> elements to prevent re-resolution during clone
 *   6. Restores original DOM after cloning (zero side effects)
 *
 * Also handles common lazy-loading patterns:
 *   - data-src / data-srcset attributes (lazysizes, vanilla-lazyload, etc.)
 *   - loading="lazy" images that haven't entered viewport yet
 *
 * @param {Object} [options]
 * @param {number}  [options.timeout=5000]        Max ms per image fetch
 * @param {number}  [options.concurrency=4]       Max parallel fetches
 * @param {boolean} [options.resolveLazySrc=true]  Also resolve data-src/data-srcset patterns
 * @param {boolean} [options.silent=false]         Suppress console warnings
 * @param {string}  [options.useProxy='']          CORS proxy for cross-origin images
 * @returns {import('../../src/core/plugins.js').Plugin}
 *
 * @example
 * // Per-capture usage
 * const result = await snapdom(element, {
 *   plugins: [pictureResolver()]
 * });
 *
 * @example
 * // Global registration
 * snapdom.plugins(pictureResolver({ timeout: 3000 }));
 *
 * @example
 * // With proxy for cross-origin images
 * const result = await snapdom(element, {
 *   plugins: [pictureResolver({ useProxy: 'https://corsproxy.io/?' })]
 * });
 */
export function pictureResolver(options = {}) {
  const {
    timeout = 5000,
    concurrency = 4,
    resolveLazySrc = true,
    silent = false,
    useProxy = '',
  } = options

  /** @type {Array<() => void>} */
  let undoStack = []

  /**
   * Check if a src string is a placeholder (base64, blob, empty, tiny SVG placeholder, etc.)
   * @param {string} src
   * @returns {boolean}
   */
  function isPlaceholder(src) {
    if (!src) return true
    if (src.startsWith('data:')) return true
    if (src.startsWith('blob:')) return true
    // Common 1x1 transparent pixel patterns
    if (/^data:image\/(gif|png|svg)/.test(src) && src.length < 200) return true
    return false
  }

  /**
   * Find the best real URL for an image inside a <picture>.
   * Priority: img.currentSrc > <source srcset> matching viewport > first <source srcset>
   * @param {HTMLImageElement} img
   * @param {HTMLPictureElement} picture
   * @returns {string|null}
   */
  function findRealUrl(img, picture) {
    // 1) currentSrc is the browser's resolved choice (best match for viewport)
    const current = img.currentSrc || ''
    if (current && !isPlaceholder(current)) return current

    // 2) Walk <source> elements; prefer one whose media query matches
    const sources = picture.querySelectorAll('source[srcset]')
    let fallback = null
    for (const source of sources) {
      const srcset = source.getAttribute('srcset')
      if (!srcset || isPlaceholder(srcset)) continue

      const media = source.getAttribute('media')
      if (media) {
        try {
          if (window.matchMedia(media).matches) {
            // Best candidate: matches current viewport
            return srcset.split(',')[0].trim().split(/\s+/)[0]
          }
        } catch { /* invalid media query, skip */ }
      }
      // Keep first valid source as fallback
      if (!fallback) fallback = srcset.split(',')[0].trim().split(/\s+/)[0]
    }

    return fallback
  }

  /**
   * Find lazy-load URLs from data-* attributes.
   * Supports: data-src, data-srcset, data-lazy-src, data-original
   * @param {HTMLImageElement} img
   * @returns {string|null}
   */
  function findLazySrc(img) {
    const candidates = [
      img.getAttribute('data-src'),
      img.getAttribute('data-lazy-src'),
      img.getAttribute('data-original'),
      img.getAttribute('data-hi-res-src'),
    ]
    for (const c of candidates) {
      if (c && !isPlaceholder(c)) return c
    }
    // data-srcset: take first candidate
    const dataSrcset = img.getAttribute('data-srcset') || img.getAttribute('data-lazy-srcset')
    if (dataSrcset) {
      const first = dataSrcset.split(',')[0].trim().split(/\s+/)[0]
      if (first && !isPlaceholder(first)) return first
    }
    return null
  }

  /**
   * Fetch an image URL using the browser's context (sends correct Referer/cookies).
   * Falls back to proxy if direct fetch fails.
   * @param {string} url
   * @returns {Promise<string|null>} data URL or null on failure
   */
  async function fetchAsDataUrl(url) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    try {
      // Try direct fetch first (browser sends Referer/cookies)
      let resp = await fetch(url, {
        credentials: 'include',
        signal: controller.signal,
      })

      // If blocked, try proxy
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

  /**
   * Process a batch of tasks with limited concurrency.
   * @param {Array<() => Promise<void>>} tasks
   */
  async function runBatched(tasks) {
    for (let i = 0; i < tasks.length; i += concurrency) {
      const batch = tasks.slice(i, i + concurrency)
      await Promise.allSettled(batch.map(fn => fn()))
    }
  }

  return {
    name: 'picture-resolver',

    /**
     * Before cloning: resolve placeholders to real images in the live DOM.
     * Stores undo functions to restore original state after clone.
     */
    async beforeClone(ctx) {
      const root = ctx.element
      if (!root || !(root instanceof Element)) return

      undoStack = []
      const tasks = []

      // ── 1) <picture> with placeholder <img src> ──
      const pictures = root.querySelectorAll('picture')
      for (const picture of pictures) {
        const img = picture.querySelector('img')
        if (!img) continue

        const originalSrc = img.getAttribute('src') || ''
        if (!isPlaceholder(originalSrc)) continue

        const realUrl = findRealUrl(img, picture)
        if (!realUrl) continue

        tasks.push(async () => {
          const dataUrl = await fetchAsDataUrl(realUrl)
          if (!dataUrl) {
            if (!silent) console.warn(`[snapdom:picture-resolver] Failed to fetch: ${realUrl.slice(0, 60)}`)
            return
          }

          // Save original state for undo
          const origAttr = img.getAttribute('src')
          const origSrcset = img.getAttribute('srcset')
          const origSizes = img.getAttribute('sizes')
          const removedSources = []

          // Swap to real image
          img.src = dataUrl
          img.setAttribute('src', dataUrl)
          img.removeAttribute('srcset')
          img.removeAttribute('sizes')

          // Remove <source> elements to prevent clone re-resolution
          const sources = picture.querySelectorAll('source')
          for (const s of sources) {
            removedSources.push({ el: s, parent: s.parentElement, next: s.nextSibling })
            s.remove()
          }

          // Register undo
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

      // ── 2) Lazy-loaded <img> with data-src / data-srcset ──
      if (resolveLazySrc) {
        const imgs = root.querySelectorAll('img')
        for (const img of imgs) {
          // Skip images already handled by <picture> pass
          if (img.closest('picture') && isPlaceholder(img.getAttribute('src') || '')) continue

          const currentSrc = img.getAttribute('src') || ''
          const lazySrc = findLazySrc(img)

          // Case A: has data-src but current src is placeholder
          if (lazySrc && isPlaceholder(currentSrc)) {
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

      // Run all fetches with concurrency limit
      if (tasks.length > 0) {
        await runBatched(tasks)
      }
    },

    /**
     * After cloning: restore original DOM (undo all mutations).
     */
    async afterClone(ctx) {
      for (const undo of undoStack) {
        try { undo() } catch { /* non-blocking */ }
      }
      undoStack = []
    },
  }
}

export default pictureResolver
