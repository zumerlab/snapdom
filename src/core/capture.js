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
import { ligatureIconToImage } from '../modules/iconFonts.js'
import { isSafari } from '../utils/index.js'
import { createSlicer } from '../utils/browser.js'
import { embedCustomFonts, collectFontUsage, ensureFontsReady } from '../modules/fonts.js'
import { cache } from '../core/cache.js'
import { createCaptureSession } from './session.js'
import { sessionWarn } from '../utils/debug.js'
import { lineClampTree } from '../modules/lineClamp.js'
import { runHook, getGlobalPlugins, normalizePlugin } from './plugins.js'
import { styleShareSafe } from '../modules/styles.js'
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
 * @returns {Promise<string|null>} SVG data URL, or null when the attached plugins declared
 *   a shallower stage (`needs: 'clone'`) and no render artifact was produced
 */
export async function captureDOM(element, options) {
  if (!element) throw new Error('Element cannot be null or undefined')
  options.__session = createCaptureSession(options.cache)
  delete options.__compressedAssets
  delete options.__compressedSnapshot
  delete options.__compressionDensity
  options.__resolveNodeHooks = collectResolveNodeHooks(options)
  // ONE context for the whole capture: hooks receive the normalized option bag itself, so
  // `ctx.scale` / `ctx.backgroundColor` / … are the very values the pipeline reads and the
  // documented "mutate ctx in beforeSnap" actually lands. Per-stage fields are written onto
  // it as they are produced. `options` is a NON-enumerable self-reference: plugins reading
  // `ctx.options` keep working, without adding a cycle to every `{...ctx}` spread.
  const state = options
  state.element = element
  Object.defineProperty(state, 'options', { value: state, configurable: true })

  let clone, classCSS, classPrefixCSS, styleCache, nodeMap, reconcileRisk, clipWindow
  let fontsCSS = ''
  // Root transform (scale/skew), kept when outerTransforms is on
  let rootTransform2D = null
  // How far this capture has to run: the maximum `needs` of the attached plugins
  // (see stages.js). 'render' — the default, and every capture without plugins — is the
  // historical pipeline; the checks below are the only two places that read it.
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

  // Identity-share fast path (see styles.js): decided ONCE per capture, before any clone
  // work. Both gates are cheap and both err toward full reads: an unscannable stylesheet or
  // any selector that can split identical identities answers unsafe, and one running
  // animation/transition anywhere under the root (computed styles differ per frame) turns
  // it off wholesale. Respect an explicit override so tests can pin the slow path.
  if (options.__styleShare === undefined) {
    try {
      options.__styleShare = styleShareSafe(state.element) &&
        (typeof state.element.getAnimations !== 'function' ||
          state.element.getAnimations({ subtree: true }).length === 0)
    } catch {
      options.__styleShare = false
    }
  }

  // fast: false | 'auto' (#503): lets the clone walks yield to the page (createSlicer).
  let slicer = createSlicer(options.fast)
  for (;;) {
    options.__slicer = slicer
    const undoClamp = lineClampTree(state.element, preClipRect)
    try {
      // Keep this capture's own clone→source map — every later pass must use this
      // reference (sessions are per-capture; there is no shared session global).
      ({ clone, classCSS, classPrefixCSS, styleCache, nodeMap, reconcileRisk, clipWindow } = await prepareClone(state.element, state.options))

      if (reconcileRisk > 0 && !options.reconcile) {
        sessionWarn(options.__session, 'reconcile-risk', 'text in inline/table-cell elements kept natural width and may re-wrap; pass { reconcile: true } for pixel-exact layout')
        if (!cache.warnedReconcile) {
          cache.warnedReconcile = true
          console.warn('[snapdom] Text in inline/table-cell elements kept its natural width and may re-wrap under font-fallback rasterization. Pass { reconcile: true } for pixel-exact layout (roughly doubles capture time).')
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
        neutralizeRootMarginCollapse(state.element, clone, nodeMap)
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
    if (!slicer?.yielded || !options.__tornSinceStart?.()) break
    slicer = null
    options.__session = createCaptureSession(options.cache)
  }
  options.__slicer = null

  // AFTERCLONE
  state.clone = clone
  state.classCSS = classCSS
  state.styleCache = styleCache
  state.nodeMap = nodeMap
  await runHook('afterClone', state)

  // needs: 'clone' — the plugins wanted the frozen tree, not pixels. Everything from here
  // (XHTML sanitizing, asset inlining, fonts, foreignObject, serialization) exists only
  // to feed a renderer, so it is skipped whole. Nothing is retained for burst: it is off
  // below 'render' (src/api/snapdom.js), so there is no memo to feed.
  if (!stageReaches(stage, 'render')) return null

  if (slicer?.due()) await slicer.pause()
  sanitizeCloneForXHTML(state.clone)
  // Either omission policy can remove children and collapse their former layout slots.
  if (state.options?.excludeMode === 'remove' ||
      (typeof state.options?.filter === 'function' && state.options.filterMode === 'remove')) {
    try {
      shrinkAutoSizeBoxes(state.element, state.clone, state.styleCache, state.nodeMap)
    } catch (e) {
      sessionWarn(options.__session, 'shrink-failed', 'shrink pass failed', e)
      console.warn('[snapdom] shrink pass failed:', e)
    }
  }
  try {
    await ligatureIconToImage(state.clone, state.element, state.nodeMap)
  } catch { /* non-blocking */ }

  // Asset phases are network/decode-bound and independent: images ∥ backgrounds ∥ fonts run
  // concurrently (they were serialized before, stacking their network latencies). Compress
  // depends on the inlined data URLs, so it waits for images+backgrounds only.
  // Microtask boundary only — keeps the parallel asset phases' Promise.all concurrency.
  const runIdle = (fn) => Promise.resolve().then(fn)

  const assetsPhase = (async () => {
    await Promise.all([
      runIdle(() => inlineImages(state.clone, state.options)),
      runIdle(() => inlineBackgroundImages(state.element, state.clone, state.styleCache, state.options, state.nodeMap)),
    ])
    // backdrop-filter can't be trusted to the svg rasterizer (#457): pre-compose it
    // from the already-inlined clone. Non-blocking — a failure just loses the effect.
    try {
      emulateBackdropFilters(state.element, state.clone, state.nodeMap)
    } catch (e) {
      sessionWarn(options.__session, 'backdrop-filter-failed', 'backdrop-filter emulation failed', e)
      console.warn('[snapdom] backdrop-filter emulation failed:', e)
    }
    // Perceptual image downsampling (on by default via `compress`). No-op when off.
    if (options.compress) {
      options.__compressionClip = clipWindow
      options.__compressionRootTransform = rootTransform2D
      await runIdle(() => compressCloneAssets(state.clone, state.options, state.nodeMap))
    }
    // Field-selection highlights compose last: the background pass above rewrites a field's
    // background longhands, and an inlined url() background has to end up under the highlight.
    if (options.captureSelection) {
      try {
        applyTextFieldSelectionLayers(state.nodeMap)
      } catch (e) {
        sessionWarn(options.__session, 'selection-compose-failed', 'field selection compose failed', e)
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
      // Clip mode: culled content embeds no text, so only collect fonts/codepoints from
      // elements near the window — skips the per-element style work for offscreen content.
      const clipKeep = preClipRect ? (el) => {
        try {
          const r = el.getBoundingClientRect()
          return r.right >= preClipRect.left - 200 && r.left <= preClipRect.right + 200 &&
                 r.bottom >= preClipRect.top - 200 && r.top <= preClipRect.bottom + 200
        } catch { return true }
      } : null
      // Safari's pre-step already walked this subtree — reuse its usage (threaded only
      // for non-clip captures; clip needs the clipKeep-scoped walk).
      const { required, usedCodepoints } = (!preClipRect && options.__fontUsage) || collectFontUsage(state.element, clipKeep)
      // 'auto': embed only when a used family is actually a document-declared webfont.
      if (options.embedFonts === 'auto') {
        const docFamilies = new Set()
        try {
          for (const f of ownerDoc.fonts) docFamilies.add(String(f.family).replace(/["']/g, '').toLowerCase())
        } catch { /* no Font Loading API — treat as no webfonts */ }
        const usesWebfont = docFamilies.size > 0 &&
          Array.from(required).some((k) => docFamilies.has(String(k).split('__')[0].toLowerCase()))
        if (!usesWebfont) return
      }
      if (isSafari()) {
        const families = new Set(
          Array.from(required).map((k) => String(k).split('__')[0]).filter(Boolean)
        )
        await ensureFontsReady(families, 1, ownerDoc)
      }
      fontsCSS = await embedCustomFonts({
        required,
        usedCodepoints,
        exclude: state.options.excludeFonts,
        localFonts: state.options.localFonts,
        useProxy: state.options.useProxy,
        fontStylesheetDomains: state.options.fontStylesheetDomains,
        iconMatchers: state.options.__iconMatchers,
        doc: ownerDoc
      })
    })
  }

  await Promise.all([assetsPhase, fontsPhase])

  // ——— Render engine ———
  // The clone is finished. Which engine turns it into pixels is the only choice left, and
  // both take the SAME input. The experimental one is opt-in and quarantined behind a lazy
  // import; the `typeof` guard is the build switch (esbuild defines __SNAPDOM_CANVAS_ENGINE__
  // as false for shipped bundles, folding the branch and the module away, while src
  // consumers — the test suite — leave it undefined and keep it live). On ANY doubt it
  // returns null and the SVG engine runs on the same clone.
  // The experimental painter cannot expose its bitmap to render-boundary hooks without
  // creating a different artifact; those hooks make this capture use the exact SVG path.
  const hasRenderBoundaryHooks = (state.options.plugins || []).some((plugin) => plugin &&
    (typeof plugin.beforeRender === 'function' || typeof plugin.afterRender === 'function'))
  if (state.options.engine === 'html-in-canvas' && !hasRenderBoundaryHooks &&
      (typeof __SNAPDOM_CANVAS_ENGINE__ === 'undefined' || __SNAPDOM_CANVAS_ENGINE__)) {
    const { tryCanvasEngine } = await import('../engines/htmlInCanvas.js')
    assembleCaptureCSS(state, fontsCSS)
    const canvas = await tryCanvasEngine(state, state.options)
    // The painted bitmap itself, not a data URL: encoding it eagerly costs 15-22x what the
    // pixel exports need (toDataURL+decode vs direct draw: 62 vs 4 ms on a card, 4.2 s vs
    // 210 ms at 29 Mpx, measured 2026-09-03) — without this handoff the engine is SLOWER
    // than the svg path it replaces. buildResult routes pixel exports straight at the
    // canvas and mints the PNG data URL lazily for the string surfaces (url, toRaw, toImg).
    if (canvas) return canvas
  }

  if (slicer?.due()) await slicer.pause()
  const renderedClone = state.clone
  numberCompressedAssets(renderedClone, options.__compressedAssets)
  const url = await composeAndSerialize(state, { clipWindow, outerTransforms, outerShadows, rootTransform2D, fontsCSS })
  options.__compressedSnapshot = snapshotCompressedAssets(renderedClone, options.__compressedAssets)
  // Hand this capture's artifacts to whoever wants to retain them (burst's differential
  // recapture keeps the clone + maps alive and re-enters composeAndSerialize on dirty
  // subtrees). Internal-only; absent for plain captures.
  if (typeof options.__retain === 'function') {
    try {
      options.__retain({
        clone, nodeMap, styleCache, styleMap: options.__session.styleMap,
        classPrefixCSS, fontsCSS, clipWindow, outerTransforms, outerShadows, rootTransform2D,
        __compressedAssets: options.__compressedAssets,
        __compressionDensity: options.__compressionDensity,
      })
    } catch { /* retention is best-effort */ }
  }
  return url
}
