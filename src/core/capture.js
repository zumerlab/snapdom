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

/**
 * Strip shadow-like visuals on the CLONE ROOT ONLY (box/text-shadow, outline, blur()/drop-shadow()).
 * Children remain intact.
 * @param {Element} originalEl
 * @param {HTMLElement} cloneRoot
 */
function stripRootShadows(originalEl, cloneRoot) {
  if (!originalEl || !cloneRoot || !cloneRoot.style) return
  const cs = getComputedStyle(originalEl)
  try { cloneRoot.style.boxShadow = 'none' } catch { }
  try { cloneRoot.style.textShadow = 'none' } catch { }
  try { cloneRoot.style.outline = 'none' } catch { }
  const f = cs.filter || ''
  const cleaned = f
    .replace(/\bblur\([^()]*\)\s*/gi, '')
    .replace(/\bdrop-shadow\([^()]*\)\s*/gi, '')
    .trim()
    .replace(/\s+/g, ' ')
  try { cloneRoot.style.filter = cleaned.length ? cleaned : 'none' } catch { }
}

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
      const w0 = Math.max(1, limitDecimals(state.element.offsetWidth || parseFloat(csEl.width) || rect.width || 1))
      const h0 = Math.max(1, limitDecimals(state.element.offsetHeight || parseFloat(csEl.height) || rect.height || 1))

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

      const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      const svgHeader = `<svg xmlns="${svgNS}" width="${svgOutW}" height="${svgOutH}" viewBox="0 0 ${vbW} ${vbH}" font-size="${rootFontSize}px">`
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
const limitDecimals = (v, n = 3) =>
  Number.isFinite(v) ? Math.round(v * 10 ** n) / 10 ** n : v

function parseFilterDropShadows(cs) {
  const raw = `${cs.filter || ''} ${cs.webkitFilter || ''}`.trim()
  if (!raw || raw === 'none') {
    return { bleed: { top: 0, right: 0, bottom: 0, left: 0 }, has: false }
  }
  const tokens = raw.match(/drop-shadow\((?:[^()]|\([^()]*\))*\)/gi) || []
  let t = 0, r = 0, b = 0, l = 0
  let found = false
  for (const tok of tokens) {
    found = true
    const nums = tok.match(/-?\d+(?:\.\d+)?px/gi)?.map(v => parseFloat(v)) || []
    const [ox = 0, oy = 0, blur = 0] = nums
    const extX = Math.abs(ox) + blur
    const extY = Math.abs(oy) + blur
    r = Math.max(r, extX + Math.max(ox, 0))
    l = Math.max(l, extX + Math.max(-ox, 0))
    b = Math.max(b, extY + Math.max(oy, 0))
    t = Math.max(t, extY + Math.max(-oy, 0))
  }
  return {
    bleed: {
      top: limitDecimals(t),
      right: limitDecimals(r),
      bottom: limitDecimals(b),
      left: limitDecimals(l)
    },
    has: found
  }
}
/**
 * Remove only translate/rotate from CLONE ROOT transform, keeping scale/skew.
 * Also forces transformOrigin to 0 0 to avoid negative offsets.
 * Returns the applied 2D matrix components so the caller can expand the viewBox accordingly.
 *
 * @param {Element} originalEl
 * @param {HTMLElement} cloneRoot
 * @returns {{a:number,b:number,c:number,d:number}|null} The 2D matrix (without translation) or null if not applicable.
 */
function normalizeRootTransforms(originalEl, cloneRoot) {
  if (!originalEl || !cloneRoot || !cloneRoot.style) return null
  const cs = getComputedStyle(originalEl)

  // Always anchor at top-left so scale/skew doesn't push content into negative coords
  try { cloneRoot.style.transformOrigin = '0 0' } catch { }

  // Try individual properties first (no-op safe)
  try {
    if ('translate' in cloneRoot.style) cloneRoot.style.translate = 'none'
    if ('rotate' in cloneRoot.style) cloneRoot.style.rotate = 'none'
    // do NOT touch 'scale'
  } catch { }

  const tr = cs.transform || 'none'
  if (!tr || tr === 'none') {
    // May still have individual scale; let computed matrix capture it
    try {
      const M = matrixFromComputed(originalEl)
      // If identity, nothing to apply
      if ((M.a === 1 && M.b === 0 && M.c === 0 && M.d === 1)) {
        cloneRoot.style.transform = 'none'
        return { a: 1, b: 0, c: 0, d: 1 }
      }
    } catch { }
  }

  // Composite path: decompose 2D; keep scale/skew, drop translate (e,f) and rotation
  const m2d = tr.match(/^matrix\(\s*([^)]+)\)$/i)
  if (m2d) {
    const nums = m2d[1].split(',').map(v => parseFloat(v.trim()))
    if (nums.length === 6 && nums.every(Number.isFinite)) {
      const [a, b, c, d] = nums // ignore e,f
      // Decompose to isolate scale + shear, remove rotation:
      const scaleX = Math.sqrt(a * a + b * b) || 0
      let a1 = 0, b1 = 0, shear = 0, c2 = 0, d2 = 0, scaleY = 0
      if (scaleX > 0) {
        a1 = a / scaleX
        b1 = b / scaleX
        shear = a1 * c + b1 * d
        c2 = c - a1 * shear
        d2 = d - b1 * shear
        scaleY = Math.sqrt(c2 * c2 + d2 * d2) || 0
        if (scaleY > 0) shear = shear / scaleY
        else shear = 0
      }
      const aP = scaleX
      const bP = 0                 // rotation removed
      const cP = shear * scaleY    // 2D shear component
      const dP = scaleY
      try { cloneRoot.style.transform = `matrix(${aP}, ${bP}, ${cP}, ${dP}, 0, 0)` } catch { }
      return { a: aP, b: bP, c: cP, d: dP }
    }
  }

  // 3D or unknown: best-effort — neutralize move/rotate at the end
  try {
    const legacy = String(tr).trim()
    cloneRoot.style.transform = legacy + ' translate(0px, 0px) rotate(0deg)'
    // We cannot reliably derive pure 2D here; return null to skip bbox expansion
    return null
  } catch {
    return null
  }
}

function parseBoxShadow(cs) {
  const v = cs.boxShadow || ''
  if (!v || v === 'none') return { top: 0, right: 0, bottom: 0, left: 0 }
  const parts = v.split(/\),(?=(?:[^()]*\([^()]*\))*[^()]*$)/).map((s) => s.trim())
  let t = 0, r = 0, b2 = 0, l = 0
  for (const part of parts) {
    const nums = part.match(/-?\d+(\.\d+)?px/g)?.map((n) => parseFloat(n)) || []
    if (nums.length < 2) continue
    const [ox2, oy2, blur = 0, spread = 0] = nums
    const extX = Math.abs(ox2) + blur + spread
    const extY = Math.abs(oy2) + blur + spread
    r = Math.max(r, extX + Math.max(ox2, 0))
    l = Math.max(l, extX + Math.max(-ox2, 0))
    b2 = Math.max(b2, extY + Math.max(oy2, 0))
    t = Math.max(t, extY + Math.max(-oy2, 0))
  }
  return { top: Math.ceil(t), right: Math.ceil(r), bottom: Math.ceil(b2), left: Math.ceil(l) }
}
function parseFilterBlur(cs) {
  const m = (cs.filter || '').match(/blur\(\s*([0-9.]+)px\s*\)/)
  const b2 = m ? Math.ceil(parseFloat(m[1]) || 0) : 0
  return { top: b2, right: b2, bottom: b2, left: b2 }
}
function parseOutline(cs) {
  if ((cs.outlineStyle || 'none') === 'none') return { top: 0, right: 0, bottom: 0, left: 0 }
  const w2 = Math.ceil(parseFloat(cs.outlineWidth || '0') || 0)
  return { top: w2, right: w2, bottom: w2, left: w2 }
}
function bboxWithOriginFull(w2, h2, M, ox2, oy2) {
  const a2 = M.a, b2 = M.b, c2 = M.c, d2 = M.d, e2 = M.e || 0, f2 = M.f || 0
  function pt(x, y) {
    let X = x - ox2, Y = y - oy2
    let X2 = a2 * X + c2 * Y, Y2 = b2 * X + d2 * Y
    X2 += ox2 + e2
    Y2 += oy2 + f2
    return [X2, Y2]
  }
  const P = [pt(0, 0), pt(w2, 0), pt(0, h2), pt(w2, h2)]
  let minX2 = Infinity, minY2 = Infinity, maxX2 = -Infinity, maxY2 = -Infinity
  for (const [X, Y] of P) {
    if (X < minX2) minX2 = X
    if (Y < minY2) minY2 = Y
    if (X > maxX2) maxX2 = X
    if (Y > maxY2) maxY2 = Y
  }
  return { minX: minX2, minY: minY2, maxX: maxX2, maxY: maxY2, width: maxX2 - minX2, height: maxY2 - minY2 }
}
function hasTFBBox(el) {
  return hasBBoxAffectingTransform(el)
}

function matrixFromComputed(el) {
  const tr = getComputedStyle(el).transform
  if (!tr || tr === 'none') return new DOMMatrix()
  try {
    return new DOMMatrix(tr)
  } catch {
    return new WebKitCSSMatrix(tr)
  }
}

/**
 * Returns a robust snapshot of individual transform-like properties.
 * Supports CSS Typed OM (CSSScale/CSSRotate/CSSTranslate) and legacy strings.
 * @param {Element} el
 * @returns {{ rotate:string, scale:string|null, translate:string|null }}
 */
function readIndividualTransforms(el) {
  const out = { rotate: '0deg', scale: null, translate: null }

  const map = (typeof el.computedStyleMap === 'function') ? el.computedStyleMap() : null
  if (map) {
    const safeGet = (prop) => {
      try {
        if (typeof map.has === 'function' && !map.has(prop)) return null
        if (typeof map.get !== 'function') return null
        return map.get(prop)
      } catch { return null }
    }

    // ROTATE
    const rot = safeGet('rotate')
    if (rot) {
      // CSSRotate or CSSUnitValue(angle)
      if (rot.angle) {
        const ang = rot.angle // CSSUnitValue
        out.rotate = (ang.unit === 'rad')
          ? (ang.value * 180 / Math.PI) + 'deg'
          : (ang.value + ang.unit)
      } else if (rot.unit) {
        // CSSUnitValue
        out.rotate = rot.unit === 'rad'
          ? (rot.value * 180 / Math.PI) + 'deg'
          : (rot.value + rot.unit)
      } else {
        out.rotate = String(rot)
      }
    } else {
      // Legacy fallback
      const cs = getComputedStyle(el)
      out.rotate = (cs.rotate && cs.rotate !== 'none') ? cs.rotate : '0deg'
    }

    // SCALE
    const sc = safeGet('scale')
    if (sc) {
      // Chrome: CSSScale { x: CSSUnitValue, y: CSSUnitValue, z? }
      // Safari TP / spec variants can differ; be permissive:
      const sx = ('x' in sc && sc.x?.value != null) ? sc.x.value : (Array.isArray(sc) ? sc[0]?.value : Number(sc) || 1)
      const sy = ('y' in sc && sc.y?.value != null) ? sc.y.value : (Array.isArray(sc) ? sc[1]?.value : sx)
      out.scale = `${sx} ${sy}`
    } else {
      const cs = getComputedStyle(el)
      out.scale = (cs.scale && cs.scale !== 'none') ? cs.scale : null
    }

    // TRANSLATE
    const tr = safeGet('translate')
    if (tr) {
      // CSSTranslate: { x: CSSNumericValue, y: CSSNumericValue }
      const tx = ('x' in tr && 'value' in tr.x) ? tr.x.value : (Array.isArray(tr) ? tr[0]?.value : 0)
      const ty = ('y' in tr && 'value' in tr.y) ? tr.y.value : (Array.isArray(tr) ? tr[1]?.value : 0)
      const ux = ('x' in tr && tr.x?.unit) ? tr.x.unit : 'px'
      const uy = ('y' in tr && tr.y?.unit) ? tr.y.unit : 'px'
      out.translate = `${tx}${ux} ${ty}${uy}`
    } else {
      const cs = getComputedStyle(el)
      out.translate = (cs.translate && cs.translate !== 'none') ? cs.translate : null
    }
    return out
  }

  // Legacy path – no Typed OM
  const cs = getComputedStyle(el)
  out.rotate = (cs.rotate && cs.rotate !== 'none') ? cs.rotate : '0deg'
  out.scale = (cs.scale && cs.scale !== 'none') ? cs.scale : null
  out.translate = (cs.translate && cs.translate !== 'none') ? cs.translate : null
  return out
}

/**
 * True if any transform (matrix or individual) can affect layout/bbox.
 * @param {Element} el
 */
function hasBBoxAffectingTransform(el) {
  const cs = getComputedStyle(el)
  const t = cs.transform || 'none'

  // Matrix identity or none => might still have individual transforms
  const hasMatrix =
    t !== 'none' &&
    !/^matrix\(\s*1\s*,\s*0\s*,\s*0\s*,\s*1\s*,\s*0\s*,\s*0\s*\)$/i.test(t)

  if (hasMatrix) return true

  // Check individual transform-like properties
  const r = cs.rotate && cs.rotate !== 'none' && cs.rotate !== '0deg'
  const s = cs.scale && cs.scale !== 'none' && cs.scale !== '1'
  const tr = cs.translate && cs.translate !== 'none' && cs.translate !== '0px 0px'

  return Boolean(r || s || tr)
}

/**
 * Parses transform-origin supporting keywords (left/center/right, top/center/bottom).
 * Returns pixel offsets.
 * @param {CSSStyleDeclaration} cs
 * @param {number} w
 * @param {number} h
 */
function parseTransformOriginPx(cs, w, h) {
  const raw = (cs.transformOrigin || '0 0').trim().split(/\s+/)
  const [oxRaw, oyRaw] = [raw[0] || '0', raw[1] || '0']

  const toPx = (token, size) => {
    const t = token.toLowerCase()
    if (t === 'left' || t === 'top') return 0
    if (t === 'center') return size / 2
    if (t === 'right') return size
    if (t === 'bottom') return size
    if (t.endsWith('px')) return parseFloat(t) || 0
    if (t.endsWith('%')) return (parseFloat(t) || 0) * size / 100
    // number without unit => px
    if (/^-?\d+(\.\d+)?$/.test(t)) return parseFloat(t) || 0
    return 0
  }

  return {
    ox: toPx(oxRaw, w),
    oy: toPx(oyRaw, h),
  }
}

var __measureHost = null
function getMeasureHost() {
  if (__measureHost) return __measureHost
  const n = document.createElement('div')
  n.id = 'snapdom-measure-slot'
  n.setAttribute('aria-hidden', 'true')
  Object.assign(n.style, {
    position: 'absolute',
    left: '-99999px',
    top: '0px',
    width: '0px',
    height: '0px',
    overflow: 'hidden',
    opacity: '0',
    pointerEvents: 'none',
    contain: 'size layout style'
  })
  document.documentElement.appendChild(n)
  __measureHost = n
  return n
}
function readTotalTransformMatrix(t) {
  const host = getMeasureHost()
  const tmp = document.createElement('div')
  tmp.style.transformOrigin = '0 0'
  if (t.baseTransform) tmp.style.transform = t.baseTransform
  if (t.rotate) tmp.style.rotate = t.rotate
  if (t.scale) tmp.style.scale = t.scale
  if (t.translate) tmp.style.translate = t.translate
  host.appendChild(tmp)
  const M = matrixFromComputed(tmp)
  host.removeChild(tmp)
  return M
}
