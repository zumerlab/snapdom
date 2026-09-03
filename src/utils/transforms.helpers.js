/**
 * Bleed and transform math for the bbox the engine draws.
 *
 * Bleed is how far each outer effect (box-shadow, text-shadow, blur, outline, drop-shadow)
 * paints past a box, per side, so the viewBox grows by that much and no more. The transform
 * half reads the root's matrix with translation and rotation removed
 * (`normalizeRootTransforms`), the individual rotate/scale/translate properties as strings,
 * and the bbox of a box under a matrix. Every bleed function takes a computed style and
 * returns px per side.
 * @module utils/transforms.helpers
 */

import { limitDecimals } from './capture.helpers.js'
import { getStyle } from './css.js'

/**
 * Bleed of every outer box-shadow layer, per side. Inset layers add nothing.
 * Pinned by __tests__/utils.transforms.helpers.test.js.
 * @param {CSSStyleDeclaration} cs
 * @returns {{top: number, right: number, bottom: number, left: number}}
 */
export function parseBoxShadow(cs) {
  return shadowListBleed(cs.boxShadow)
}

/**
 * text-shadow bleeds like box-shadow (offsets + blur, no spread/inset).
 * @param {CSSStyleDeclaration} cs
 * @returns {{top: number, right: number, bottom: number, left: number}}
 */
export function parseTextShadow(cs) {
  return shadowListBleed(cs.textShadow)
}

/** Shared by both shadow parsers: per-side reach of a shadow list, outer layers only,
 *  rounded up to whole px. */
function shadowListBleed(v) {
  if (!v || v === 'none') return { top: 0, right: 0, bottom: 0, left: 0 }
  // Split into layers on top-level commas only (commas inside rgb()/rgba() must not split).
  // A regex on `),` fails for computed values, which put the color first (color()-last is
  // author syntax) — so a multi-layer shadow would not be separated.
  const parts = []
  let buf = '', depth = 0
  for (let i = 0; i < v.length; i++) {
    const ch = v[i]
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) { parts.push(buf); buf = '' } else buf += ch
  }
  if (buf.trim()) parts.push(buf)
  let t = 0, r = 0, b2 = 0, l = 0
  for (const part of parts) {
    // inset shadows are clipped to the padding box and contribute no outer bleed.
    if (/\binset\b/i.test(part)) continue
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
 * Bleed of the `filter: blur()` chain, the same on every side.
 * @param {CSSStyleDeclaration} cs
 * @returns {{top: number, right: number, bottom: number, left: number}}
 */
export function parseFilterBlur(cs) {
  // Read the standard `filter`, falling back to `-webkit-filter` when filter is unset, so
  // WebKit-only blurs still expand the bleed. Use the standard one alone when present to
  // avoid double-counting (browsers often mirror filter into webkitFilter). Sum every
  // blur() in the chosen list to cover the rare multi-blur case.
  const raw = (cs.filter && cs.filter !== 'none') ? cs.filter : (cs.webkitFilter || '')
  const re = /blur\(\s*([0-9.]+)px\s*\)/gi
  let total = 0, m
  while ((m = re.exec(raw))) total += parseFloat(m[1]) || 0
  // `blur(R)` sets R as the Gaussian STANDARD DEVIATION (Filter Effects §blur), so the ink
  // reaches well past R and bleeding by R alone sliced the halo where it is still clearly
  // opaque — a blurred box rastered with a hard rectangular edge, worse the larger the
  // radius. The factor is MEASURED, not taken from the 3σ rule of thumb: walking outward
  // from the box edge until the pixel is within 2% of the background gives a reach of
  // 8/15/30px for R=4/8/16 on Chromium and 8/16/31px on Firefox — ~1.9-2.0R. 2 covers every
  // one of those; 3 would enlarge every blurred capture by half again for no visible gain,
  // and raster area is capture time. (box-shadow's blur-radius is defined as 2σ instead, so
  // the same extent needs half this factor there — see parseBoxShadow.)
  const b2 = Math.ceil(total * 2)
  return { top: b2, right: b2, bottom: b2, left: b2 }
}

/**
 * Bleed of the outline: its width plus a positive outline-offset, the same on every side.
 * @param {CSSStyleDeclaration} cs
 * @returns {{top: number, right: number, bottom: number, left: number}}
 */
export function parseOutline(cs) {
  if ((cs.outlineStyle || 'none') === 'none') return { top: 0, right: 0, bottom: 0, left: 0 }
  const w = Math.ceil(parseFloat(cs.outlineWidth || '0') || 0)
  // outline-offset > 0 pushes the outline further out, increasing bleed.
  // Negative offset moves it inward — it never reduces bleed below the outline width itself.
  const offset = parseFloat(cs.outlineOffset || '0') || 0
  const total = w + Math.max(0, Math.ceil(offset))
  return { top: total, right: total, bottom: total, left: total }
}

/**
 * Bleed of every `drop-shadow()` in the filter chain, per side, and whether there was one.
 * `has` lets the caller tell "no drop-shadow" from "a drop-shadow with zero reach".
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

/** The four outer effects, summed the way the root's own bleed is. */
function outerInkBleed(cs) {
  const shadow = parseBoxShadow(cs)
  const text = parseTextShadow(cs)
  const blur = parseFilterBlur(cs)
  const outline = parseOutline(cs)
  const drop = parseFilterDropShadows(cs)
  return {
    top: Math.max(shadow.top, text.top) + blur.top + outline.top + drop.bleed.top,
    right: Math.max(shadow.right, text.right) + blur.right + outline.right + drop.bleed.right,
    bottom: Math.max(shadow.bottom, text.bottom) + blur.bottom + outline.bottom + drop.bleed.bottom,
    left: Math.max(shadow.left, text.left) + blur.left + outline.left + drop.bleed.left
  }
}

/**
 * Whether an element carries anything that could paint outside its own box.
 * Four string reads, so that the layout read below is only paid by the handful
 * of elements on a page that actually have an effect on them.
 * @param {CSSStyleDeclaration} cs
 */
function mayPaintOutside(cs) {
  if (cs.boxShadow && cs.boxShadow !== 'none') return true
  if (cs.textShadow && cs.textShadow !== 'none') return true
  if ((cs.outlineStyle || 'none') !== 'none') return true
  if (cs.filter && cs.filter !== 'none') return true
  return !!cs.webkitFilter && cs.webkitFilter !== 'none'
}

/**
 * Which axes an element confines its descendants' paint to.
 * @param {CSSStyleDeclaration} cs
 */
function clipsPaint(cs) {
  const x = cs.overflowX || cs.overflow || 'visible'
  const y = cs.overflowY || cs.overflow || 'visible'
  // contain: paint and clip-path confine both axes at once.
  const both =
    (!!cs.contain && /\b(paint|content|strict)\b/.test(cs.contain)) ||
    (!!cs.clipPath && cs.clipPath !== 'none')
  return { x: both || x !== 'visible', y: both || y !== 'visible' }
}

/**
 * How far the ink of DESCENDANTS reaches past the root's own box.
 *
 * A capture is the root's box, so a ring or a shadow a child draws against the
 * root's edge lands outside it: cloned, then clipped away by the viewBox. This
 * measures that overhang, so a capture can be widened by as much ink as there
 * is rather than padded on the chance that something overhangs.
 *
 * Only elements carrying an outer effect are measured, and their styles were
 * already read by the clone. Ancestors that clip are honoured — a shadow inside
 * `overflow: hidden` never escapes it — which is also what stops a scrolled
 * container's offscreen rows from widening anything.
 *
 * Two spaces meet here. Boxes are measured on the page, so a scale anywhere
 * above the root inflates them; effects are read from computed style, which is
 * always in the element's own pixels. The work is done in page pixels, where
 * clipping ancestors can bound the ink, and `perX`/`perY` — which the caller
 * knows, having built the bbox — convert the result back at the end.
 *
 * Imported from @frostin/snapdom (element-mirror).
 *
 * @param {Element} root
 * @param {Map<Node, Node>} nodeMap clone → source, from the clone pass
 * @param {WeakMap<Element, CSSStyleDeclaration>} styleCache
 * @param {number} [perX] root pixels per page pixel, horizontally
 * @param {number} [perY] root pixels per page pixel, vertically
 * @returns {{top: number, right: number, bottom: number, left: number}}
 */
export function measureSubtreeBleed(root, nodeMap, styleCache, perX = 1, perY = 1) {
  let top = 0, right = 0, bottom = 0, left = 0
  const rootClip = clipsPaint(styleCache.get(root) || getStyle(root))
  if (rootClip.x && rootClip.y) return { top: 0, right: 0, bottom: 0, left: 0 }
  const rootRect = root.getBoundingClientRect()

  for (const source of nodeMap.values()) {
    if (source === root || source.nodeType !== 1) continue
    // An iframe's own capture reassigns the map; its nodes were measured in
    // another document's coordinates and mean nothing here.
    if (source.ownerDocument !== root.ownerDocument) continue
    const cs = styleCache.get(source)
    if (!cs || !mayPaintOutside(cs)) continue
    const pad = outerInkBleed(cs)
    if (!(pad.top || pad.right || pad.bottom || pad.left)) continue

    const box = source.getBoundingClientRect()
    const ink = {
      left: box.left - pad.left / perX,
      top: box.top - pad.top / perY,
      right: box.right + pad.right / perX,
      bottom: box.bottom + pad.bottom / perY
    }
    for (let a = source.parentElement; a; a = a.parentElement) {
      const clip = clipsPaint(styleCache.get(a) || getStyle(a))
      if (clip.x || clip.y) {
        const bounds = a.getBoundingClientRect()
        if (clip.x) {
          ink.left = Math.max(ink.left, bounds.left)
          ink.right = Math.min(ink.right, bounds.right)
        }
        if (clip.y) {
          ink.top = Math.max(ink.top, bounds.top)
          ink.bottom = Math.min(ink.bottom, bounds.bottom)
        }
      }
      if (a === root) break
    }

    if (!rootClip.x) {
      left = Math.max(left, (rootRect.left - ink.left) * perX)
      right = Math.max(right, (ink.right - rootRect.right) * perX)
    }
    if (!rootClip.y) {
      top = Math.max(top, (rootRect.top - ink.top) * perY)
      bottom = Math.max(bottom, (ink.bottom - rootRect.bottom) * perY)
    }
  }

  return {
    top: Math.max(0, Math.ceil(top)),
    right: Math.max(0, Math.ceil(right)),
    bottom: Math.max(0, Math.ceil(bottom)),
    left: Math.max(0, Math.ceil(left))
  }
}

/**
 * Strip translate and rotate from the CLONE ROOT's transform, keeping scale and skew.
 *
 * The `outerTransforms: false` path. The matrix left on the clone is returned so the caller
 * can grow the viewBox by it; transform-origin is pinned to 0 0 so that scale never pushes
 * content into negative coordinates. Reads `matrix()`, `matrix3d()` (#216, the 2D part of
 * the 4x4) and, through DOMMatrix, any other function. Pinned by
 * __tests__/utils.transforms.helpers.test.js.
 * @param {Element} originalEl
 * @param {HTMLElement} cloneRoot
 * @returns {{a:number,b:number,c:number,d:number}|null} the matrix without translation, or null when not applicable
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
    // No `transform`, but the element may still use the individual `scale` property, which
    // composes separately from `transform` (matrixFromComputed only reads `transform`, so it
    // would miss it and leave the viewBox unscaled, clipping the content). translate/rotate
    // were already stripped from the clone above and the clone keeps `scale`, so report the
    // scale matrix for bbox expansion — do NOT write it to transform or scale applies twice.
    let scaleStr = null
    try { scaleStr = readIndividualTransforms(originalEl).scale } catch { }
    try { cloneRoot.style.transform = 'none' } catch { }
    if (!scaleStr) return { a: 1, b: 0, c: 0, d: 1 }
    // `scale` is unitless: "sx" or "sx sy". Parse straight to a diagonal matrix — it does not
    // surface in computed `transform`, so a temp-element round-trip would read back identity.
    const sv = scaleStr.trim().split(/\s+/).map(parseFloat)
    const sx = Number.isFinite(sv[0]) ? sv[0] : 1
    const sy = Number.isFinite(sv[1]) ? sv[1] : sx
    return { a: sx, b: 0, c: 0, d: sy }
  }

  // Helper: decompose 2D matrix components (a,b,c,d) into scale+shear without rotation
  function decomposeScaleShear(a, b, c, d) {
    const scaleX = Math.sqrt(a * a + b * b) || 0
    let shear = 0, scaleY = 0
    if (scaleX > 0) {
      const a1 = a / scaleX
      const b1 = b / scaleX
      shear = a1 * c + b1 * d
      const c2 = c - a1 * shear
      const d2 = d - b1 * shear
      scaleY = Math.sqrt(c2 * c2 + d2 * d2) || 0
      if (scaleY > 0) shear = shear / scaleY
      else shear = 0
    }
    return {
      a: scaleX,
      b: 0,                   // rotation removed
      c: shear * scaleY,      // 2D shear component
      d: scaleY
    }
  }

  // Composite path: decompose 2D; keep scale/skew, drop translate (e,f) and rotation
  const m2d = tr.match(/^matrix\(\s*([^)]+)\)$/i)
  if (m2d) {
    const nums = m2d[1].split(',').map(v => parseFloat(v.trim()))
    if (nums.length === 6 && nums.every(Number.isFinite)) {
      const [a, b, c, d] = nums // ignore e,f
      const dec = decomposeScaleShear(a, b, c, d)
      try { cloneRoot.style.transform = `matrix(${dec.a}, ${dec.b}, ${dec.c}, ${dec.d}, 0, 0)` } catch { }
      return dec
    }
  }

  // #216: matrix3d — extract 2D components from 4x4 matrix, decompose scale/shear, drop translate+rotation
  const m3d = tr.match(/^matrix3d\(\s*([^)]+)\)$/i)
  if (m3d) {
    const nums = m3d[1].split(',').map(v => parseFloat(v.trim()))
    if (nums.length === 16 && nums.every(Number.isFinite)) {
      // 4x4 column-major: [m11,m12,m13,m14, m21,m22,m23,m24, m31,m32,m33,m34, m41,m42,m43,m44]
      // 2D projection: a=m11(0), b=m12(1), c=m21(4), d=m22(5), e=m41(12), f=m42(13)
      const a = nums[0], b = nums[1], c = nums[4], d = nums[5]
      const dec = decomposeScaleShear(a, b, c, d)
      try { cloneRoot.style.transform = `matrix(${dec.a}, ${dec.b}, ${dec.c}, ${dec.d}, 0, 0)` } catch { }
      return dec
    }
  }

  // Unknown transform function: use DOMMatrix to extract 2D components
  try {
    const M = new DOMMatrix(tr)
    const dec = decomposeScaleShear(M.a, M.b, M.c, M.d)
    try { cloneRoot.style.transform = `matrix(${dec.a}, ${dec.b}, ${dec.c}, ${dec.d}, 0, 0)` } catch { }
    return dec
  } catch {
    return null
  }
}

/**
 * Bounding box of a w2 by h2 box under M, transformed about (ox2, oy2), in the box's own
 * coordinates. The viewBox is sized from this.
 * @param {number} w2
 * @param {number} h2
 * @param {DOMMatrix|{a:number,b:number,c:number,d:number,e?:number,f?:number}} M
 * @param {number} ox2 - transform origin x, px
 * @param {number} oy2 - transform origin y, px
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
 * transform-origin in px, keywords (left/center/right, top/center/bottom) and percentages
 * resolved against the box.
 * @param {CSSStyleDeclaration} cs
 * @param {number} w - box width, px
 * @param {number} h - box height, px
 * @returns {{ox: number, oy: number}}
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
 * Read `rotate`, `scale` and `translate` as strings, through the Typed OM when the engine
 * has it and computed style otherwise. Rotation comes back in degrees, scale as "sx sy",
 * translate with its units. Null means the property is unset. Pinned by
 * __tests__/utils.transforms.helpers.test.js.
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

/** The hidden host the transform probe lives in, created on first use and kept for the page's
 *  lifetime, contained so the probe never reaches the page's layout. */
function getMeasureHost() {
  if (__measureHost) return __measureHost
  const n = document.createElement('div')
  n.id = 'snapdom-measure-slot'
  n.setAttribute('aria-hidden', 'true')
  // Marks the host as snapdom-owned BEFORE it is mounted, so neither the mount record nor
  // the append/remove pair readTotalTransformMatrix does inside it reads as an external
  // mutation (styles.js isExternalRecord). Without it every capture of a transformed root
  // bumped the style epoch and re-stamped the whole document, dropping the author-style
  // scan memo and every cached snapshot on the page.
  n.setAttribute('data-snapdom-internal', '')
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
 * Compose `transform` and the individual rotate/scale/translate into one DOMMatrix by giving
 * them to a probe element and reading its computed transform back. `composeResidual2D`
 * (capture.helpers.js) composes the same inputs without the DOM round-trip.
 * @param {{baseTransform?: string, rotate?: string, scale?: string|null, translate?: string|null}} t
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
 * @returns {boolean}
 */
export function hasBBoxAffectingTransform(el) {
  // getStyle is cached (cache.computedStyle); on the root this reuses the csEl already read by
  // captureDOM instead of forcing a fresh resolution per call (twice on Safari defaults).
  const cs = getStyle(el)
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
 * The element's computed `transform` as a DOMMatrix, identity for `none`. Only `transform`:
 * the individual rotate/scale/translate are not part of that value, read them separately.
 * WebKitCSSMatrix is the fallback where DOMMatrix refuses the string.
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
