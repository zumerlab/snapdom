// src/api/preCache.js
import { getStyle, inlineSingleBackgroundEntry, precacheCommonTags, isSafari } from '../utils/index.js'
import { embedCustomFonts, collectUsedFontVariants, collectUsedCodepoints, ensureFontsReady } from '../modules/fonts.js'
import { snapFetch } from '../modules/snapFetch.js'
import { cache, applyCachePolicy } from '../core/cache.js'
import { inlineBackgroundImages } from '../modules/background.js'

/**
 * Preloads images, background images, and (optionally) fonts into cache before DOM capture.
 * @param {Element|Document} [root=document]
 * @param {Object} [options={}]
 * @param {boolean} [options.embedFonts=true]
 * @param {'full'|'soft'|'auto'|'disabled'} [options.cache='full']
 * @param {string}  [options.useProxy=""]
 * @param {{family:string,src:string,weight?:string|number,style?:string,stretchPct?:number}[]} [options.localFonts=[]]
 * @param {{families?:string[], domains?:string[], subsets?:string[]}} [options.excludeFonts]
 * @returns {Promise<void>}
 */
export async function preCache(root = document, options = {}) {
  const {
    embedFonts = true,
    useProxy = '',
  } = options
  // Accept both `cache` (JSDoc) and legacy `cacheOpt`
  const cacheMode = options.cache ?? options.cacheOpt ?? 'full'

  applyCachePolicy(cacheMode)

  // Ensure font metrics are ready (non-throwing)
  try { await document.fonts?.ready } catch {}

  // Warm common tag/style caches (no-op if already done)
  try { precacheCommonTags() } catch {}

  // Ensure session caches
  cache.session = cache.session || {}
  if (!cache.session.styleCache) {
    cache.session.styleCache = new WeakMap()
  }
  cache.image = cache.image || new Map()
  cache.background = cache.background || new Map()

  // Pre-inline background images into cache (best-effort)
  try {
    await inlineBackgroundImages(root, /* mirror */ undefined, cache.session.styleCache, { useProxy })
  } catch {}

  // Collect elements for prefetch
  let imgEls = [], allEls = []
  try {
    // 🔸 Importante: incluir al root si es un Element
    if (root && root.nodeType === 1 /* ELEMENT_NODE */) {
      const descendants = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : []
      allEls = [root, ...descendants]
      // Sólo imágenes dentro del subtree (el root también puede ser <img>)
      imgEls = []
      if (root.tagName === 'IMG' && root.getAttribute('src')) imgEls.push(root)
      imgEls.push(...Array.from(root.querySelectorAll?.('img[src]') || []))
    } else if (root?.querySelectorAll) {
      // Document o DocumentFragment
      imgEls = Array.from(root.querySelectorAll('img[src]'))
      allEls = Array.from(root.querySelectorAll('*'))
    }
  } catch {}

  const promises = []

  // Prefetch <img> sources to dataURL and cache
  for (const img of imgEls) {
    const src = img?.currentSrc || img?.src
    if (!src) continue
    if (!cache.image.has(src)) {
      const p = Promise.resolve()
        .then(async () => {
          const res = await snapFetch(src, { as: 'dataURL', useProxy })
          if (res?.ok && typeof res.data === 'string') {
            cache.image.set(src, res.data)
          }
        })
        .catch(() => {})
      promises.push(p)
    }
  }

  // Prefetch background-image url(...) entries
  for (const el of allEls) {
    let bg = ''
    try {
      // Preferir estilo autor (estable en JSDOM/test); fallback a computado
      bg = el?.style?.backgroundImage || ''
      if (!bg || bg === 'none') {
        bg = getStyle(el).backgroundImage
      }
    } catch {}
    if (bg && bg !== 'none') {
      // Extraer SOLO capas url(...) (robusto ante comas de gradients)
      const urlEntries = bg.match(/url\((?:[^()"']+|"(?:[^"]*)"|'(?:[^']*)')\)/gi) || []
      for (const entry of urlEntries) {
        const p = Promise.resolve()
          .then(() => inlineSingleBackgroundEntry(entry, { ...options, useProxy }))
          .catch(() => {})
        promises.push(p)
      }

      // (quedó como compat opcional por si querés volver a splitBackgroundImage)
      // const parts = splitBackgroundImage(bg)
      // for (const entry of parts) {
      //   if (entry.startsWith('url(')) {
      //     const p = Promise.resolve()
      //       .then(() => inlineSingleBackgroundEntry(entry, { ...options, useProxy }))
      //       .catch(() => {})
      //     promises.push(p)
      //   }
      // }
    }
  }

  // Optional: preload/embed fonts
  if (embedFonts) {
    try {
      const required = collectUsedFontVariants(root)
      const usedCodepoints = collectUsedCodepoints(root)

      // Safari warmup: ensure families are ready before embedding
      const safari = (typeof isSafari === 'function') ? isSafari() : !!isSafari
      if (safari) {
        const families = new Set(
          Array.from(required)
            .map(k => String(k).split('__')[0])
            .filter(Boolean)
        )
        await ensureFontsReady(families, 3)
      }

      await embedCustomFonts({
        required,
        usedCodepoints,
        exclude: options.excludeFonts,
        localFonts: options.localFonts,
        useProxy: options.useProxy ?? useProxy,
      })
    } catch {}
  }

  await Promise.allSettled(promises)
}
