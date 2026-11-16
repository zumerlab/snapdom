/**
 * Core capture: element -> finished, self-contained clone.
 *
 * The pipeline splits at the clone. This module owns `element -> clone` (freeze, style
 * snapshot, image and font inlining); turning that clone into pixels belongs to a render
 * engine, and the default one lives in src/engines/svg.js.
 * @module capture
 */

import { prepareClone } from './prepare.js'
import { inlineImages } from '../modules/images.js'
import { inlineBackgroundImages } from '../modules/background.js'
import { emulateBackdropFilters } from '../modules/backdropFilter.js'
import { ligatureIconToImage, pinIconStruts } from '../modules/iconFonts.js'
import { isSafari } from '../utils/index.js'
import { createSlicer } from '../utils/browser.js'
import { embedCustomFonts, collectFontUsage, ensureFontsReady, fontKeyFamily, documentFontFamilies } from '../modules/fonts.js'
import { cache, applyCachePolicy } from '../core/cache.js'
import { createCaptureSession } from './session.js'
import { sessionWarn, debugWarn } from '../utils/debug.js'
import { lineClampTree } from '../modules/lineClamp.js'
import { runHook, getGlobalPlugins, normalizePlugin } from './plugins.js'
import { invalidateSnapshotsUnder, animatedProps } from '../modules/styles.js'
import { styleShareSafe } from '../modules/styleShare.js'
import { addShadowAnimations } from './changes.js'
import { stageReaches, DEFAULT_STAGE } from './stages.js'
import { compressCloneAssets, numberCompressedAssets, snapshotCompressedAssets } from '../modules/compress.js'
import { applyTextFieldSelectionLayers } from '../modules/selection.js'
import { composeAndSerialize } from '../engines/svg.js'
import {
  assembleCaptureCSS,
  stripRootShadows,
  neutralizeRootMarginCollapse,
  neutralizeRootZoom,
  sanitizeCloneForXHTML,
  shrinkAutoSizeBoxes,
  resolveClipRect
} from '../utils/capture.helpers.js'
import { normalizeRootTransforms } from '../utils/transforms.helpers.js'

/**
 * Collect per-node resolveNode hooks once per capture, so deepClone pays a single falsy
 * check per node when no plugin uses them.
 * @param {object} options
 * @returns {Array<(node: Node, ctx: object) => any>|null}
 */
function collectResolveNodeHooks(options) {
  const defs = Array.isArray(options.plugins) ? options.plugins : getGlobalPlugins()
  const hooks = []
  for (const d of defs) {
    const inst = normalizePlugin(d)
    if (inst && typeof inst.resolveNode === 'function') hooks.push(inst.resolveNode.bind(inst))
  }
  return hooks.length ? hooks : null
}

/**
 * Captures an HTML element as an SVG data URL, inlining styles, images, backgrounds, and optionally fonts.
 *
 * @param {Element} element - DOM element to capture
 * @param {Object} [options={}] - Capture options
 * @param {boolean|'auto'} [options.embedFonts='auto'] - Font embedding ('auto': only document-declared webfonts actually used)
 * @param {number} [options.scale=1] - Output scale multiplier
 * @param {string[]} [options.exclude] - CSS selectors for elements to exclude
 * @param {boolean} [options.outerTransforms=true] - Keep root translate/rotate; false strips them (keeps scale/skew)
 * @param {boolean|'subtree'} [options.outerShadows=false] - When false, outer-shadow effects (box/text-shadow, outline, drop-shadow) are stripped from the root and add no bleed. Root blur() always renders and always bleeds. 'subtree' additionally widens the capture for the outer-shadow ink DESCENDANTS paint past the root's box (a child's ring drawn against the root's edge), measured per side and bounded by any ancestor that clips.
 * @param {boolean|object} [options.compress] - Downsample inlined raster images to their visible resolution
 * @param {boolean} [options.reconcile=false] - Measure the clone against the live DOM and pin diverging boxes (roughly doubles capture time)
 * @param {boolean} [options.burst] - Memoize eligible static captures from the first call. Selection and frame-driven/opaque trees always capture fresh; true overrides only the automatic impure-plugin gate, while false disables memoization.
 * @param {import('./session.js').CaptureSession} [session] - this run's session (burst or snapdom.capture creates it)
 * @returns {Promise<string|null>} SVG data URL, or null when the attached plugins declared
 *   a shallower stage (`needs: 'clone'`) and no render artifact was produced
 */
export async function captureDOM(element, options, session = createCaptureSession(options)) {
  if (!element) throw new Error('[SnapDOM] The element cannot be null or undefined.')
  applyCachePolicy(options.cache)
  // ALIAS for published readers (session.js); nothing in this module reads it back.
  options.__session = session
  session.resolveNodeHooks = collectResolveNodeHooks(options)
  // ONE context per capture: hooks get the normalized option bag itself, so a "mutate ctx in
  // beforeSnap" lands in what the pipeline reads. Per-stage fields are added as produced.
  // `options` is a NON-enumerable self-reference: `ctx.options` works without putting a cycle
  // in every `{...ctx}` spread.
  const state = options
  state.element = element
  Object.defineProperty(state, 'options', { value: state, configurable: true })

  let clone, classCSS, classPrefixCSS, shadowCSS, styleCache, nodeMap, reconcileRisk, clipWindow, standIns, universe, marginZeroed
  let fontsCSS = ''
  // Root transform (scale/skew), kept when outerTransforms is on
  let rootTransform2D = null
  // How far this capture runs: the maximum `needs` of the attached plugins (stages.js).
  // 'render' is the default and every capture without plugins. Read only by the two checks below.
  const stage = options.needs || DEFAULT_STAGE

  // BEFORESNAP. `format` is canonical, but the deprecated `type` alias remains writable in
  // this hook. Normalize only an actual hook mutation: treating the default PNG as explicit
  // would change toBlob()'s historical default from SVG to PNG.
  const formatBeforeSnap = state.format
  const typeBeforeSnap = state.type
  await runHook('beforeSnap', state)
  const changedFormat = state.format !== formatBeforeSnap && /^(?:png|jpe?g|webp|svg)$/i.test(state.format)
  const changedType = state.type !== typeBeforeSnap && /^(?:png|jpe?g|webp|svg)$/i.test(state.type)
  if (changedFormat || changedType) {
    const requested = String(changedFormat ? state.format : state.type).toLowerCase()
    state.format = requested === 'jpg' ? 'jpeg' : requested
    state.type = state.format
    state.__explicitFormat = state.format
    if (/^(?:jpeg|webp)$/.test(state.format) &&
        (state.backgroundColor == null || state.backgroundColor === 'transparent')) state.backgroundColor = '#ffffff'
  }

  // BEFORECLONE
  await runHook('beforeClone', state)

  // Read AFTER the hooks: beforeSnap is the documented place to set capture defaults, and
  // these three decide the geometry, so reading them earlier ignored the plugin that set them.
  const outerTransforms = state.outerTransforms !== false   // default: true
  // Kept as given rather than coerced: 'subtree' also widens the capture for what descendants
  // paint outside the root's box, and every truthy value means "the root keeps its shadows".
  const outerShadows = state.outerShadows === 'subtree' ? 'subtree' : !!state.outerShadows
  // Region capture (clip: 'viewport' | {x,y,width,height}). The GEOMETRY window is resolved
  // once, inside prepareClone (same instant as culling), and returned as clipWindow in
  // element-local coords. This rect is only a cheap pre-clone PERF filter (lineClamp/fonts).
  const preClipRect = state.clip ? resolveClipRect(state.element, state.clip) : null

  // An animation changes computed styles with no mutation record, so the snapshot cache would
  // serve an earlier capture's frame. Each target's subtree is dropped before the clone reads
  // it and again once nothing reads the cache; the second drop asks the shadow roots again,
  // since the clone has met new ones. A capture that throws in between leaves its reads behind.
  // Pinned by `__tests__/core.capture.animationFrames.test.js`.
  let animations = []
  try {
    if (typeof state.element.getAnimations === 'function') animations = state.element.getAnimations({ subtree: true })
  } catch { animations = null }
  const moving = new Set(animations)
  const dropAnimated = () => {
    addShadowAnimations(state.element, moving)
    for (const a of moving) invalidateSnapshotsUnder(a.effect?.target)
  }
  dropAnimated()
  // inlineAllStyles re-resolves the inline declarations these animate from computed values.
  session.animated = animatedProps(moving)

  // Identity share (styleShare.js), decided ONCE per capture. Both gates err toward full reads:
  // an unscannable sheet or a selector that can split identical identities answers unsafe, and
  // one running animation under the root turns it off. `__styleShare` lets tests pin the slow
  // path; the verdict goes to the session, never to the context.
  let share = options.__styleShare
  if (share === undefined) {
    try {
      share = styleShareSafe(state.element) && animations?.length === 0
    } catch {
      share = false
    }
  }
  session.styleShare = share

  // fast: false | 'auto' (#503): lets the clone walks yield to the page (createSlicer).
  let slicer = createSlicer(options.fast)
  for (;;) {
    session.slicer = slicer
    const undoClamp = lineClampTree(state.element, preClipRect)
    try {
      // Every later pass uses this capture's own clone-to-source map: there is no shared
      // session global.
      ({ clone, classCSS, classPrefixCSS, shadowCSS, styleCache, nodeMap, reconcileRisk, clipWindow, standIns, universe } = await prepareClone(state.element, state.options, session))

      if (reconcileRisk > 0 && !options.reconcile) {
        sessionWarn(session, 'reconcile-risk', 'text in inline/table-cell elements kept natural width and may re-wrap; pass { reconcile: true } for pixel-exact layout')
        if (options.debug && !cache.warnedReconcile) {
          cache.warnedReconcile = true
          debugWarn(options, 'Some text may wrap differently in the capture. Pass { reconcile: true } to fix it (about 2x slower).')
        }
      }

      if (!outerTransforms && clone) {
        rootTransform2D = normalizeRootTransforms(state.element, clone) // {a,b,c,d} or null
      }
      if (!outerShadows && clone) {
        stripRootShadows(state.element, clone, state.options)
      }
      // #426: zero margins that collapse through the root edge so the clone's
      // content sits flush like the captured border box (no clipping / no offset).
      if (clone) {
        // The list of zeroed elements goes to the retained artifacts below (diff.js).
        marginZeroed = neutralizeRootMarginCollapse(state.element, clone, nodeMap, standIns)
        // #483: the raster is sized in the root's pre-zoom coordinate space, so an inline
        // `zoom` carried over by cloneNode() would shrink the content and leave blank bands.
        neutralizeRootZoom(state.element, clone)
      }
    } finally {
      undoClamp()
    }
    // A yielding clone read the page across several tasks. Burst watches the element for
    // every change a frame can show (burst.js, mid-capture edits and events), and when one
    // landed the clone may mix two states: run the stage again, in one task. Without burst
    // there is no watcher, and the yielding clone stands.
    if (!slicer?.yielded || !session.tornSinceStart?.()) break
    slicer = null
    // Renewed in place: burst, the alias and buildResult hold this session object.
    applyCachePolicy(options.cache)
    session.styleMap = new Map()
    session.styleCache = new WeakMap()
    session.nodeMap = new Map()
    session.warnings = []
  }
  session.slicer = null

  // AFTERCLONE
  state.clone = clone
  state.classCSS = classCSS
  state.styleCache = styleCache
  state.nodeMap = nodeMap
  await runHook('afterClone', state)

  // needs: 'clone': the plugins want the frozen tree, not pixels, and everything below only
  // feeds a renderer. Nothing is retained: burst is off below 'render' (src/api/snapdom.js).
  if (!stageReaches(stage, 'render')) {
    dropAnimated()
    return null
  }

  if (slicer?.due()) await slicer.pause()
  sanitizeCloneForXHTML(state.clone)
  // Either omission policy can remove children and collapse their former layout slots.
  if (state.options?.excludeMode === 'remove' ||
      (typeof state.options?.filter === 'function' && state.options.filterMode === 'remove')) {
    try {
      shrinkAutoSizeBoxes(state.element, state.clone, state.styleCache, state.nodeMap)
    } catch (e) {
      sessionWarn(session, 'shrink-failed', 'shrink pass failed', e)
      debugWarn(options, 'Couldn\'t close the gaps left by removed elements.', e)
    }
  }
  try {
    await ligatureIconToImage(state.clone, state.element, state.nodeMap)
  } catch { /* non-blocking */ }
  try {
    const styleMap = session.styleMap
    pinIconStruts(styleMap.keys(), styleMap, state.nodeMap, state.options.__iconMatchers)
  } catch { /* non-blocking */ }

  // Images, backgrounds and fonts are independent and network-bound, so they run
  // concurrently. Compress needs the inlined data URLs and waits for images and backgrounds.
  // A microtask boundary only, so Promise.all keeps them concurrent.
  const runIdle = (fn) => Promise.resolve().then(fn)
  // Whether author CSS travels with the clone, read after the afterClone hooks. With no
  // shadow sheet, no `<style>` kept or added by a hook and the class CSS as generated,
  // nothing can outrank a node's class (inlineBackgroundImages).
  const plainBg = !shadowCSS && state.classCSS === classCSS && !state.clone?.querySelector('style')

  const assetsPhase = (async () => {
    await Promise.all([
      runIdle(() => inlineImages(state.clone, state.options, session)),
      runIdle(() => inlineBackgroundImages(state.element, state.clone, state.styleCache, state.options, state.nodeMap, plainBg)),
    ])
    // The svg rasterizer misrenders backdrop-filter (#457): pre-compose it from the inlined
    // clone. A failure loses the effect, nothing more.
    try {
      emulateBackdropFilters(state.element, state.clone, state.nodeMap)
    } catch (e) {
      sessionWarn(session, 'backdrop-filter-failed', 'backdrop-filter emulation failed', e)
      debugWarn(options, 'Couldn\'t reproduce a backdrop-filter; captured without it.', e)
    }
    // Perceptual image downsampling (on by default via `compress`). No-op when off.
    if (options.compress) {
      const geometry = { session, clip: clipWindow, rootTransform: rootTransform2D }
      await runIdle(() => compressCloneAssets(state.clone, state.options, state.nodeMap, geometry))
    }
    // Field-selection highlights compose last: the background pass above rewrites a field's
    // background longhands, and an inlined url() background has to end up under the highlight.
    if (options.captureSelection) {
      try {
        applyTextFieldSelectionLayers(state.nodeMap)
      } catch (e) {
        sessionWarn(session, 'selection-compose-failed', 'field selection compose failed', e)
      }
    }
  })()

  let fontsPhase = Promise.resolve()
  // 'auto' pre-gate: no FontFace registered in the element's document → no webfonts to
  // embed, skip even the usage walk. Explicit true keeps the full pass unconditionally.
  const fontsWanted = options.embedFonts === 'auto'
    ? ((state.element.ownerDocument || document).fonts?.size || 0) > 0
    : !!options.embedFonts
  if (fontsWanted) {
    fontsPhase = runIdle(async () => {
      // #441: read fonts from the element's own document (same-origin iframe support)
      const ownerDoc = state.element.ownerDocument || document
      // Clip mode: culled content embeds no text, so collect fonts and codepoints only near
      // the window.
      const clipKeep = preClipRect ? (el) => {
        try {
          const r = el.getBoundingClientRect()
          return r.right >= preClipRect.left - 200 && r.left <= preClipRect.right + 200 &&
                 r.bottom >= preClipRect.top - 200 && r.top <= preClipRect.bottom + 200
        } catch { return true }
      } : null
      // Reuse the usage Safari's pre-step collected, except in clip mode, which needs the
      // clipKeep-scoped walk.
      const { required, usedCodepoints } = (!preClipRect && session.fontUsage) || collectFontUsage(state.element, clipKeep)
      // 'auto': embed only when a used family is a webfont the document has drawn with, and
      // leave out declared families it never drew (a later family in a stack whose earlier
      // one covered the text). Warm only drawn webfonts, as the pre-step does: a system
      // family's span fetches nothing, and an undrawn family's would load it for nothing.
      let warm = required, embed = required
      if (options.embedFonts === 'auto') {
        const { declared, drawn } = documentFontFamilies(ownerDoc)
        const family = (k) => fontKeyFamily(k).toLowerCase()
        warm = new Set(Array.from(required).filter((k) => drawn.has(family(k))))
        if (!warm.size) return
        embed = new Set(Array.from(required).filter((k) => drawn.has(family(k)) || !declared.has(family(k))))
      }
      if (isSafari()) await ensureFontsReady(warm, usedCodepoints, ownerDoc)
      fontsCSS = await embedCustomFonts({
        required: embed,
        usedCodepoints,
        exclude: state.options.excludeFonts,
        localFonts: state.options.localFonts,
        useProxy: state.options.useProxy,
        fontStylesheetDomains: state.options.fontStylesheetDomains,
        iconMatchers: state.options.__iconMatchers,
        doc: ownerDoc,
        debug: state.options.debug
      })
    })
  }

  await Promise.all([assetsPhase, fontsPhase])
  // The background pass above was the last reader of the snapshot cache (needsBackgroundInline,
  // snapshotFor). Dropping the animated reads earlier sends every node under them down the
  // live-read path there.
  dropAnimated()

  // Render engine. Both engines take the same finished clone. The canvas one is opt-in
  // (`engine: 'html-in-canvas'`) behind a lazy import; on ANY doubt (no drawElementImage,
  // geometry it does not do, a tainted or blank paint) it returns null and the SVG engine runs
  // on the same clone. beforeRender/afterRender hooks force SVG: the native bitmap cannot be
  // handed to them without making a different artifact.
  const hasRenderBoundaryHooks = (state.options.plugins || []).some((plugin) => plugin &&
    (typeof plugin.beforeRender === 'function' || typeof plugin.afterRender === 'function'))
  if (state.options.engine === 'html-in-canvas' && !hasRenderBoundaryHooks) {
    const { tryCanvasEngine } = await import('../engines/htmlInCanvas.js')
    assembleCaptureCSS(state, fontsCSS, universe)
    const canvas = await tryCanvasEngine(state, state.options, session)
    // Return the bitmap, not a data URL: toDataURL plus decode cost 62 ms on a card against 4 ms
    // for a direct draw, which made the engine slower than svg. buildResult draws the canvas
    // for pixel exports and mints the PNG data URL lazily for url, toRaw and toImg.
    if (canvas) return canvas
  }

  if (slicer?.due()) await slicer.pause()
  const renderedClone = state.clone
  numberCompressedAssets(renderedClone, session.compressedAssets)
  const url = await composeAndSerialize(state, {
    clipWindow, outerTransforms, outerShadows, rootTransform2D, fontsCSS, universe, session, signatures: session.styleMap
  })
  session.compressedSnapshot = snapshotCompressedAssets(renderedClone, session.compressedAssets)
  // Hand this capture's artifacts to whoever wants to retain them (burst's differential
  // recapture keeps the clone + maps alive and re-enters composeAndSerialize on dirty
  // subtrees). Internal-only; burst sets it on the session, absent for plain captures.
  if (session.retain) {
    try {
      session.retain({
        clone, nodeMap, styleCache, styleMap: session.styleMap,
        classPrefixCSS, plainBg, fontsCSS, clipWindow, outerTransforms, outerShadows, rootTransform2D,
        marginZeroed,
        compressedAssets: session.compressedAssets,
        compressionDensity: session.compressionDensity,
      })
    } catch { /* retention is best-effort */ }
  }
  return url
}
