// src/api/preCache.js
import { getStyle, inlineSingleBackgroundEntry, precacheCommonTags, isSafari } from '../utils'
import { embedCustomFonts, collectFontUsage, ensureFontsReady } from '../modules/fonts.js'
import { snapFetch } from '../modules/snapFetch.js'
import { cache } from '../core/cache.js'
import { URL_PROPS } from '../modules/background.js'

/**
 * Network prefetch: preloads images, background/mask/border-image URLs and (per
 * `embedFonts`, default 'auto' — same semantics as capture) fonts into the persistent
 * caches before DOM capture. Cache policy is not an option here anymore: caching is
 * structural, and preCache's whole point is warming it.
 * @param {Element|Document} [root=document]
 * @param {Object} [options={}]
 * @param {boolean|'auto'} [options.embedFonts='auto']
 * @param {string}  [options.useProxy=""]
 * @param {{family:string,src:string,weight?:string|number,style?:string,stretchPct?:number}[]} [options.localFonts=[]]
 * @param {{families?:string[], domains?:string[], subsets?:string[]}} [options.excludeFonts]
 * @param {string[]} [options.fontStylesheetDomains]  // extra domains to fetch cross-origin CSS from (#309)
 * @returns {Promise<void>}
 */
export async function preCache(root = document, options = {}) {
  const {
    embedFonts = 'auto',
    useProxy = '',
  } = options

  // Ensure font metrics are ready (non-throwing)
  try { await document.fonts?.ready } catch {}

  // Warm common tag/style caches (no-op if already done)
  try { precacheCommonTags() } catch {}

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

  // Fonts: 'auto' mirrors capture's gate — embed only when a used family is actually a
  // document-declared webfont; system-font pages skip the walk and the embed entirely.
  const doc = (root && root.nodeType === 9) ? root : (root?.ownerDocument || document)
  const fontsWanted = embedFonts === 'auto' ? (doc.fonts?.size || 0) > 0 : !!embedFonts
  if (fontsWanted) {
    try {
      const { required, usedCodepoints } = collectFontUsage(root)
      let proceed = true
      if (embedFonts === 'auto') {
        const docFamilies = new Set()
        try { for (const f of doc.fonts) docFamilies.add(String(f.family).replace(/["']/g, '').toLowerCase()) } catch {}
        proceed = docFamilies.size > 0 &&
          Array.from(required).some((k) => docFamilies.has(String(k).split('__')[0].toLowerCase()))
      }
      if (proceed) {
        if (isSafari()) {
          const families = new Set(
            Array.from(required)
              .map(k => String(k).split('__')[0])
              .filter(Boolean)
          )
          await ensureFontsReady(families, 1)
        }
        await embedCustomFonts({
          required,
          usedCodepoints,
          exclude: options.excludeFonts,
          localFonts: options.localFonts,
          useProxy: options.useProxy ?? useProxy,
          fontStylesheetDomains: options.fontStylesheetDomains,
        })
      }
    } catch {}
  }

  await Promise.allSettled(promises)
}
