/**
 * Helper utilities for transform and geometry calculations
 * @module utils/transforms.helpers
 */

import { limitDecimals } from './capture.helpers.js'

/**
 * Parse box-shadow and calculate bleed dimensions
 * @param {CSSStyleDeclaration} cs
 * @returns {{top: number, right: number, bottom: number, left: number}}
 */
export function parseBoxShadow(cs) {
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

/**
 * Parse filter blur and calculate bleed
 * @param {CSSStyleDeclaration} cs
 * @returns {{top: number, right: number, bottom: number, left: number}}
 */
export function parseFilterBlur(cs) {
  const m = (cs.filter || '').match(/blur\(\s*([0-9.]+)px\s*\)/)
  const b2 = m ? Math.ceil(parseFloat(m[1]) || 0) : 0
  return { top: b2, right: b2, bottom: b2, left: b2 }
}

/**
 * Parse outline and calculate bleed
 * @param {CSSStyleDeclaration} cs
 * @returns {{top: number, right: number, bottom: number, left: number}}
 */
export function parseOutline(cs) {
  if ((cs.outlineStyle || 'none') === 'none') return { top: 0, right: 0, bottom: 0, left: 0 }
  const w2 = Math.ceil(parseFloat(cs.outlineWidth || '0') || 0)
  return { top: w2, right: w2, bottom: w2, left: w2 }
}

/**
 * Parse filter drop-shadow and calculate bleed
 * @param {CSSStyleDeclaration} cs
 * @returns {{bleed: {top: number, right: number, bottom: number, left: number}, has: boolean}}
 */
export function parseFilterDropShadows(cs) {
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
export function normalizeRootTransforms(originalEl, cloneRoot) {
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

/**
 * Calculate bounding box with transform origin
 * @param {number} w2
 * @param {number} h2
 * @param {DOMMatrix} M
 * @param {number} ox2
 * @param {number} oy2
 * @returns {{minX: number, minY: number, maxX: number, maxY: number, width: number, height: number}}
 */
export function bboxWithOriginFull(w2, h2, M, ox2, oy2) {
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

/**
 * Parses transform-origin supporting keywords (left/center/right, top/center/bottom).
 * Returns pixel offsets.
 * @param {CSSStyleDeclaration} cs
 * @param {number} w
 * @param {number} h
 */
export function parseTransformOriginPx(cs, w, h) {
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

/**
 * Returns a robust snapshot of individual transform-like properties.
 * Supports CSS Typed OM (CSSScale/CSSRotate/CSSTranslate) and legacy strings.
 * @param {Element} el
 * @returns {{ rotate:string, scale:string|null, translate:string|null }}
 */
export function readIndividualTransforms(el) {
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

/**
 * Read total transform matrix from combined transform properties
 * @param {object} t - Transform properties
 * @returns {DOMMatrix}
 */
export function readTotalTransformMatrix(t) {
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

/**
 * True if any transform (matrix or individual) can affect layout/bbox.
 * @param {Element} el
 */
export function hasBBoxAffectingTransform(el) {
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
 * Get matrix from computed style
 * @param {Element} el
 * @returns {DOMMatrix}
 */
export function matrixFromComputed(el) {
  const tr = getComputedStyle(el).transform
  if (!tr || tr === 'none') return new DOMMatrix()
  try {
    return new DOMMatrix(tr)
  } catch {
    return new WebKitCSSMatrix(tr)
  }
}
