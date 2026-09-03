/**
 * `preCache(root, options)`: warm what a capture will read, before the capture.
 *
 * Images, url() style layers and fonts go over the network now and into the cross-capture
 * caches (core/cache.js), so the capture reads them locally. Given an element, it also runs
 * a throwaway prepareClone to warm that element's style snapshots, where a cold capture's
 * time lives. Everything is best-effort: a failed fetch is dropped, never thrown.
 * @module api/preCache
 */
import { getStyle, inlineSingleBackgroundEntry, precacheCommonTags, isSafari } from '../utils'
import { embedCustomFonts, collectFontUsage, ensureFontsReady } from '../modules/fonts.js'
import { snapFetch } from '../modules/snapFetch.js'
import { prepareClone } from '../core/prepare.js'
import { createContext } from '../core/context.js'
import { createCaptureSession } from '../core/session.js'
import { cache } from '../core/cache.js'
import { URL_PROPS } from '../modules/background.js'
import { compileIconFontMatchers } from '../modules/iconFonts.js'

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

  // Warm the per-ELEMENT style snapshots for a known capture target. This is where a cold
  // capture's time actually lives — measured: ~200 getPropertyValue reads per node, 136ms of
  // a 190ms first capture on a 3000-node table — and it is per-element work, so the
  // document-level warming above cannot reach it (measured: cache:'disabled' costs ~4ms more
  // than warm caches on a FRESH element). A throwaway prepareClone pays that walk NOW: the
  // snapshots persist in the stamp-guarded per-element cache, so the user's real capture
  // starts from steady state (~74ms on the same table) instead of paying the walk on click.
  // Same idea as domlens's prewarm({element}), scoped to what dominates OUR pipeline.
  // Best-effort and side-effect-free: the clone is discarded, nothing is mounted.
  if (root && root.nodeType === 1 && root !== document.documentElement && root !== document.body) {
    try {
      // Defaults on purpose: the snapshot cache keys on the embedFonts flag, so warming with
      // a non-default value produced snapshots a default capture could never hit (measured:
      // warm == cold, read for read, until this matched).
      const warmCtx = createContext({})
      warmCtx.__warmOnly = true
      warmCtx.__session = createCaptureSession('soft')
      await prepareClone(root, warmCtx)
    } catch { /* warming must never break preCache */ }
  }

  // Collect elements for prefetch
  let imgEls = [], allEls = []
  try {
    // The root itself counts when it is an element.
    if (root && root.nodeType === 1 /* ELEMENT_NODE */) {
      const descendants = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : []
      allEls = [root, ...descendants]
      // Images inside the subtree only (the root itself can be an <img> too)
      imgEls = []
      if (root.tagName === 'IMG' && root.getAttribute('src')) imgEls.push(root)
      imgEls.push(...Array.from(root.querySelectorAll?.('img[src]') || []))
    } else if (root?.querySelectorAll) {
      // Document or DocumentFragment
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
        // Prefer the author style (stable under test); fall back to the computed one
        val = (prop === 'background-image' && el?.style?.backgroundImage) ||
          getStyle(el).getPropertyValue(prop) || ''
      } catch {}
      if (!val || val === 'none') continue
      // Only the url(...) layers. The regex survives the commas inside a gradient.
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
          iconMatchers: compileIconFontMatchers(options.iconFonts),
        })
      }
    } catch {}
  }

  await Promise.allSettled(promises)
}
