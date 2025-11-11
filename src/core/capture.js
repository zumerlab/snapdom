/**
 * Core logic for capturing DOM elements as SVG data URLs.
 * @module capture
 */

import { prepareClone } from './prepare.js'
import { inlineImages } from '../modules/images.js'
import { inlineBackgroundImages } from '../modules/background.js'
import { ligatureIconToImage } from '../modules/iconFonts.js'
import { idle, collectUsedTagNames, generateDedupedBaseCSS, isSafari } from '../utils/index.js'
import { embedCustomFonts, collectUsedFontVariants, collectUsedCodepoints, ensureFontsReady } from '../modules/fonts.js'
import { cache, applyCachePolicy } from '../core/cache.js'
import { lineClamp } from '../modules/lineClamp.js'
import { runHook } from './plugins.js'
import {
  stripRootShadows,
  sanitizeCloneForXHTML,
  shrinkAutoSizeBoxes,
  estimateKeptHeight,
  limitDecimals
} from '../utils/capture.helpers.js'
import {
  parseBoxShadow,
  parseFilterBlur,
  parseOutline,
  parseFilterDropShadows,
  normalizeRootTransforms,
  bboxWithOriginFull,
  parseTransformOriginPx,
  readIndividualTransforms,
  readTotalTransformMatrix,
  hasBBoxAffectingTransform,
} from '../utils/transforms.helpers.js'
/**
 * Captures an HTML element as an SVG data URL, inlining styles, images, backgrounds, and optionally fonts.
 *
 * @param {Element} element - DOM element to capture
 * @param {Object} [options={}] - Capture options
 * @param {boolean} [options.embedFonts=false] - Whether to embed custom fonts
 * @param {boolean} [options.fast=true] - Whether to skip idle delay for faster results
 * @param {number} [options.scale=1] - Output scale multiplier
 * @param {string[]} [options.exclude] - CSS selectors for elements to exclude
 * @param {Function} [options.filter] - Custom filter function
 * @param {boolean} [options.outerTransforms=false] - Normalize root by removing translate/rotate (keep scale/skew)
 * @param {boolean} [options.outerShadows=false] - Do not expand bleed for shadows/blur/outline on root (and strip root shadows visually)
 * @returns {Promise<string>} Promise that resolves to an SVG data URL
 */
export async function captureDOM(element, options) {
  if (!element) throw new Error('Element cannot be null or undefined')
  applyCachePolicy(options.cache)
  const fast = options.fast
  const outerTransforms = options.outerTransforms !== false   // default: true

  const outerShadows = !!options.outerShadows
  let state = { element, options, plugins: options.plugins }

  let clone, classCSS, styleCache
  let fontsCSS = ''
  let baseCSS = ''
  let dataURL
  let svgString
  // NEW: store root transform (scale/skew) when outerTransforms is on
  let rootTransform2D = null
  // BEFORESNAP
  await runHook('beforeSnap', state)
  // BEFORECLONE
  await runHook('beforeClone', state)
  const undoClamp = lineClamp(state.element)
  try {
    ({ clone, classCSS, styleCache } = await prepareClone(state.element, state.options))

    // state = {clone, classCSS, styleCache, ...state}

    if (!outerTransforms && clone) {
      rootTransform2D = normalizeRootTransforms(state.element, clone) // {a,b,c,d} or null
    }
    if (!outerShadows && clone) {
      stripRootShadows(state.element, clone)
    }
  } finally {
    undoClamp()
  }

  // AFTERCLONE
  state = { clone, classCSS, styleCache, ...state }
  await runHook('afterClone', state)
  sanitizeCloneForXHTML(state.clone)
  // Shrink pass ONLY when excludeMode === 'remove'
  if (state.options?.excludeMode === 'remove') {
    try {
      shrinkAutoSizeBoxes(state.element, state.clone, state.styleCache)
    } catch (e) {
      console.warn('[snapdom] shrink pass failed:', e)
    }
  }
  try {
    await ligatureIconToImage(state.clone, state.element)
  } catch { /* non-blocking */ }

  await new Promise((resolve) => {
    idle(async () => {
      await inlineImages(state.clone, state.options)
      resolve()
    }, { fast })
  })

  await new Promise((resolve) => {
    idle(async () => {
      await inlineBackgroundImages(state.element, state.clone, state.styleCache, state.options)
      resolve()
    }, { fast })
  })

  if (options.embedFonts) {
    await new Promise((resolve) => {
      idle(async () => {
        const required = collectUsedFontVariants(state.element)
        const usedCodepoints = collectUsedCodepoints(state.element)
        if (isSafari()) {
          const families = new Set(
            Array.from(required).map((k) => String(k).split('__')[0]).filter(Boolean)
          )
          await ensureFontsReady(families, 1)
        }
        fontsCSS = await embedCustomFonts({
          required,
          usedCodepoints,
          preCached: false,
          exclude: state.options.excludeFonts,
          useProxy: state.options.useProxy
        })
        resolve()
      }, { fast })
    })
  }

  const usedTags = collectUsedTagNames(state.clone).sort()
  const tagKey = usedTags.join(',')
  if (cache.baseStyle.has(tagKey)) {
    baseCSS = cache.baseStyle.get(tagKey)
  } else {
    await new Promise((resolve) => {
      idle(() => {
        baseCSS = generateDedupedBaseCSS(usedTags)
        cache.baseStyle.set(tagKey, baseCSS)
        resolve()
      }, { fast })
    })
  }
  // beforeRender(context)
  state = { fontsCSS, baseCSS, ...state }
  await runHook('beforeRender', state)

  await new Promise((resolve) => {
    idle(() => {
      const csEl = getComputedStyle(state.element)

      const rect = state.element.getBoundingClientRect()
      let w0 = Math.max(1, limitDecimals(state.element.offsetWidth || parseFloat(csEl.width) || rect.width || 1))
      let h0 = Math.max(1, limitDecimals(state.element.offsetHeight || parseFloat(csEl.height) || rect.height || 1))
      // === NEW: recompute height using the kept-children span (no offscreen) ===
      if (state.options?.excludeMode === 'remove') {
        const hEst = estimateKeptHeight(state.element, state.options) // border+padding+contentSpan
        // Safety: nunca mayor al original, y con un epsilon para evitar recortes por redondeo
        const EPS = 1 // px
        if (Number.isFinite(hEst) && hEst > 0) {
          h0 = Math.max(1, Math.min(h0, limitDecimals(hEst + EPS)))
        }
        // En ancho casi nunca conviene ajustar; si lo necesitás, podés hacer análogo con estimateKeptWidth(...)
      }
      const coerceNum = (v, def = NaN) => {
        const n = typeof v === 'string' ? parseFloat(v) : v
        return Number.isFinite(n) ? n : def
      }

      const optW = coerceNum(state.options.width)
      const optH = coerceNum(state.options.height)
      let w = w0, h = h0

      const hasW = Number.isFinite(optW)
      const hasH = Number.isFinite(optH)
      const aspect0 = h0 > 0 ? w0 / h0 : 1

      if (hasW && hasH) {
        w = Math.max(1, limitDecimals(optW))
        h = Math.max(1, limitDecimals(optH))
      } else if (hasW) {
        w = Math.max(1, limitDecimals(optW))
        h = Math.max(1, limitDecimals(w / (aspect0 || 1)))
      } else if (hasH) {
        h = Math.max(1, limitDecimals(optH))
        w = Math.max(1, limitDecimals(h * (aspect0 || 1)))
      } else {
        w = w0
        h = h0
      }

      // ——— BBOX ———
      let minX = 0, minY = 0, maxX = w0, maxY = h0

      // NEW: if outerTransforms => expand bbox using the post-normalization 2D matrix
      if (!outerTransforms && rootTransform2D && Number.isFinite(rootTransform2D.a)) {
        const M2 = {
          a: rootTransform2D.a,
          b: rootTransform2D.b || 0,
          c: rootTransform2D.c || 0,
          d: rootTransform2D.d || 1,
          e: 0,
          f: 0
        }
        const bb2 = bboxWithOriginFull(w0, h0, M2, 0, 0)
        minX = limitDecimals(bb2.minX)
        minY = limitDecimals(bb2.minY)
        maxX = limitDecimals(bb2.maxX)
        maxY = limitDecimals(bb2.maxY)
      } else {
        const useTFBBox = outerTransforms && hasTFBBox(state.element)
        if (useTFBBox) {
          const baseTransform2 = csEl.transform && csEl.transform !== 'none' ? csEl.transform : ''
          const ind2 = readIndividualTransforms(state.element)
          const TOTAL = readTotalTransformMatrix({
            baseTransform: baseTransform2,
            rotate: ind2.rotate || '0deg',
            scale: ind2.scale,
            translate: ind2.translate
          })
          const { ox: ox2, oy: oy2 } = parseTransformOriginPx(csEl, w0, h0)
          const M = TOTAL.is2D ? TOTAL : new DOMMatrix(TOTAL.toString())
          const bb = bboxWithOriginFull(w0, h0, M, ox2, oy2)
          minX = limitDecimals(bb.minX)
          minY = limitDecimals(bb.minY)
          maxX = limitDecimals(bb.maxX)
          maxY = limitDecimals(bb.maxY)
        }
      }

      // ——— BLEED ———
      const bleedShadow = parseBoxShadow(csEl)
      const bleedBlur = parseFilterBlur(csEl)
      const bleedOutline = parseOutline(csEl)
      const drop = parseFilterDropShadows(csEl)

      const bleed = (!outerShadows)
        ? { top: 0, right: 0, bottom: 0, left: 0 }
        : {
          top: limitDecimals(bleedShadow.top + bleedBlur.top + bleedOutline.top + drop.bleed.top),
          right: limitDecimals(bleedShadow.right + bleedBlur.right + bleedOutline.right + drop.bleed.right),
          bottom: limitDecimals(bleedShadow.bottom + bleedBlur.bottom + bleedOutline.bottom + drop.bleed.bottom),
          left: limitDecimals(bleedShadow.left + bleedBlur.left + bleedOutline.left + drop.bleed.left)
        }

      minX = limitDecimals(minX - bleed.left)
      minY = limitDecimals(minY - bleed.top)
      maxX = limitDecimals(maxX + bleed.right)
      maxY = limitDecimals(maxY + bleed.bottom)

      const vbW0 = Math.max(1, limitDecimals(maxX - minX))
      const vbH0 = Math.max(1, limitDecimals(maxY - minY))
      const scaleW = (hasW || hasH) ? limitDecimals(w / w0) : 1
      const scaleH = (hasH || hasW) ? limitDecimals(h / h0) : 1
      const outW = Math.max(1, limitDecimals(vbW0 * scaleW))
      const outH = Math.max(1, limitDecimals(vbH0 * scaleH))

      const svgNS = 'http://www.w3.org/2000/svg'
      const basePad = isSafari() ? 1 : 0
      const extraPad = !outerTransforms ? 1 : 0
      const pad = limitDecimals(basePad + extraPad)

      const fo = document.createElementNS(svgNS, 'foreignObject')
      const vbMinX = limitDecimals(minX)
      const vbMinY = limitDecimals(minY)
      fo.setAttribute('x', String(limitDecimals(-(vbMinX - pad))))
      fo.setAttribute('y', String(limitDecimals(-(vbMinY - pad))))
      fo.setAttribute('width', String(limitDecimals(w0 + pad * 2)))
      fo.setAttribute('height', String(limitDecimals(h0 + pad * 2)))
      fo.style.overflow = 'visible'

      const styleTag = document.createElement('style')
      styleTag.textContent =
        state.baseCSS + state.fontsCSS + 'svg{overflow:visible;} foreignObject{overflow:visible;}' + state.classCSS
      fo.appendChild(styleTag)

      const container = document.createElement('div')
      container.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
      container.style.width = `${limitDecimals(w0)}px`
      container.style.height = `${limitDecimals(h0)}px`
      container.style.overflow = 'visible'

      state.clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
      container.appendChild(state.clone)
      fo.appendChild(container)

      const serializer = new XMLSerializer()
      const foString = serializer.serializeToString(fo)
      const vbW = limitDecimals(vbW0 + pad * 2)
      const vbH = limitDecimals(vbH0 + pad * 2)
      const wantsSize = hasW || hasH

      options.meta = { w0, h0, vbW, vbH, targetW: w, targetH: h }

      const svgOutW = (isSafari() && wantsSize)
        ? vbW
        : limitDecimals(outW + pad * 2)
      const svgOutH = (isSafari() && wantsSize)
        ? vbH
        : limitDecimals(outH + pad * 2)

      const svgHeader = `<svg xmlns="${svgNS}" width="${svgOutW}" height="${svgOutH}" viewBox="0 0 ${vbW} ${vbH}">`
      const svgFooter = '</svg>'
      svgString = svgHeader + foString + svgFooter
      dataURL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`
      state = { svgString, dataURL, ...state }
      resolve()
    }, { fast })
  })
  // afterRender(context)
  await runHook('afterRender', state)

  const sandbox = document.getElementById('snapdom-sandbox')
  if (sandbox && sandbox.style.position === 'absolute') sandbox.remove()
  return state.dataURL
}

function hasTFBBox(el) {
  return hasBBoxAffectingTransform(el)
}
