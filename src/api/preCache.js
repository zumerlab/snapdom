/**
 * `preCache(root, options)`: warm what a capture will read, before the capture.
 *
 * Given a document, images, url() style layers and fonts go over the network now and into
 * the cross-capture caches (core/cache.js), so a later capture reads them locally. Given an
 * element, it seeds: the real pipeline runs once, now, and the result becomes the element's
 * burst memo, so the app's first capture is a memo hit (seedCapture). Everything is
 * best-effort: a failed fetch is dropped, a refused seed falls back to the partial warm.
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
import { attachSessionPlugins, hasImpureRenderPlugins } from '../core/plugins.js'
import { resolveStage, stageReaches } from '../core/stages.js'
import { markSeeded, hasCanvas } from '../core/burst.js'
import { debugWarn } from '../utils/debug.js'

/** The public capture entry, bound by api/snapdom.js at load (see bindCapture). */
let capture = null

/**
 * Give preCache the capture entry. Called once by api/snapdom.js; a seed goes through the
 * same function the app calls, so it runs the same hooks and leaves the same burst state.
 * @param {(element: Element, options?: object) => Promise<object>} fn
 */
export function bindCapture(fn) { capture = fn }

/**
 * Seed the burst memo for `el`: run the real pipeline once, now, with the options the app
 * will capture with, and keep the result as the element's burst state. The next
 * `snapdom(el, sameOptions)` is a memo hit, or a differential / full recapture when the
 * invalidation matrix (core/burst.js) says the element changed. Measured 2026-09-03 over
 * the 79-demo corpus: first capture 20.4 ms median, memo hit 0, the export that remains
 * 4.6; a document-level warm recovered 10% of the first capture, the seed all of it,
 * because fonts are cached by used family and codepoints, compress by image and target
 * size, snapshots by element.
 *
 * Refused, with a debug note, exactly where the memo would refuse to serve: a render plugin
 * that is not `pure` (a memo hit skips its hooks), a stage below render, a canvas-bearing
 * element (pixel draws are invisible to the observers). Options must match the app's call
 * by burst's signature, plugins by identity included.
 * Pinned by __tests__/api.preCache.seed.test.js.
 * @param {Element} el
 * @param {object} options
 * @returns {Promise<boolean>} whether a seed was taken
 */
async function seedCapture(el, options) {
  if (!capture) return false
  const probe = attachSessionPlugins(createContext(options), options.plugins)
  let why = ''
  if (hasImpureRenderPlugins(probe)) why = 'a render plugin is not pure'
  else if (!stageReaches(resolveStage(probe).stage, 'render')) why = 'a plugin lowers the capture below render'
  else if (el.tagName === 'CANVAS' || hasCanvas(el)) why = 'the element carries a canvas'
  if (why) {
    debugWarn(options, `preCache: not seeding the capture, ${why}`)
    return false
  }
  try {
    await capture(el, { ...options, burst: true })
    markSeeded(el)
    return true
  } catch (e) {
    debugWarn(options, 'preCache: seed capture failed', e)
    return false
  }
}

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
    // The seed is the whole warm: the capture it takes inlines the element's assets, embeds
    // its fonts and snapshots its styles into the same caches, keyed the way the app's own
    // capture will ask for them. Only a refused seed falls back to the partial warm below.
    if (await seedCapture(root, options)) return
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
