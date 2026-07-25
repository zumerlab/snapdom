// src/api/preCache.js
import { getStyle, inlineSingleBackgroundEntry, precacheCommonTags, isSafari } from '../utils'
import { embedCustomFonts, collectFontUsage, ensureFontsReady } from '../modules/fonts.js'
import { snapFetch } from '../modules/snapFetch.js'
import { cache, applyCachePolicy, EvictingMap } from '../core/cache.js'
import { URL_PROPS } from '../modules/background.js'

/**
 * Preloads images, background images, and (optionally) fonts into cache before DOM capture.
 * @param {Element|Document} [root=document]
 * @param {Object} [options={}]
 * @param {boolean} [options.embedFonts=true]
 * @param {'full'|'soft'|'auto'|'disabled'} [options.cache='full']
 * @param {string}  [options.useProxy=""]
 * @param {{family:string,src:string,weight?:string|number,style?:string,stretchPct?:number}[]} [options.localFonts=[]]
 * @param {{families?:string[], domains?:string[], subsets?:string[]}} [options.excludeFonts]
 * @param {string[]} [options.fontStylesheetDomains]  // extra domains to fetch cross-origin CSS from (#309)
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
  cache.image = cache.image || new EvictingMap(100)
  cache.background = cache.background || new EvictingMap(100)

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

  // Prefetch every URL-bearing style prop (backgrounds, masks, border-image — the same
  // URL_PROPS list capture inlines) so capture reads them from cache.background instead
  // of the network. inlineSingleBackgroundEntry populates the exact keys capture uses.
  for (const el of allEls) {
    const seen = new Set()
    for (const prop of URL_PROPS) {
      let val = ''
      try {
        // Preferir estilo autor (estable en JSDOM/test); fallback a computado
        val = (prop === 'background-image' && el?.style?.backgroundImage) ||
          getStyle(el).getPropertyValue(prop) || ''
      } catch {}
      if (!val || val === 'none') continue
      // Extraer SOLO capas url(...) (robusto ante comas de gradients)
      const urlEntries = val.match(/url\((?:[^()"']+|"(?:[^"]*)"|'(?:[^']*)')\)/gi) || []
      for (const entry of urlEntries) {
        if (seen.has(entry)) continue
        seen.add(entry)
        const p = Promise.resolve()
          .then(() => inlineSingleBackgroundEntry(entry, { ...options, useProxy }))
          .catch(() => {})
        promises.push(p)
      }
    }
  }

  // Optional: preload/embed fonts
  if (embedFonts) {
    try {
      const { required, usedCodepoints } = collectFontUsage(root)

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
        fontStylesheetDomains: options.fontStylesheetDomains,
      })
    } catch {}
  }

  await Promise.allSettled(promises)
}
