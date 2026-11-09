/**
 * `transform` + `transform-origin` -> one affine matrix and its decomposition.
 *
 * Matrices are the CSS/SVG six-tuple `[a, b, c, d, e, f]`, i.e.
 *
 *   | a  c  e |
 *   | b  d  f |
 *   | 0  0  1 |
 *
 * Two conventions that everything downstream depends on:
 *
 *  - `multiply(m1, m2)` is the matrix product, so it composes the way function
 *    application does: `applyToPoint(multiply(m1, m2), x, y)` equals
 *    `applyToPoint(m1, ...applyToPoint(m2, x, y))`. Same as `DOMMatrix.multiply`.
 *  - `transform-origin` is NOT a separate field. CSS applies the transform about
 *    the origin, which is exactly `T(o) · M · T(-o)`, and that product is what
 *    `m` holds. A backend that reads `m` and ignores the origin still lands the
 *    box in the right place, which is the whole point of baking it in here.
 *
 * The decomposition is the QR one (css-transforms-1 §decomposing), because Figma
 * has no matrix input: it wants rotation, size and position separately, and it
 * has no skew at all — a non-zero `skewX` is the caller's cue to outline or
 * raster. Reconstruction order is `translate(tx,ty) rotate(rot) skewX(skewX)
 * scale(sx,sy)`.
 *
 * Pure: no DOM.
 */

const ABS_UNITS = {
  px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 25.4 / 4,
}

const ANGLE_UNITS = { deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 }

const NUMBER = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/i

const IDENTITY = [1, 0, 0, 1, 0, 0]

/**
 * Matrix product. See the header for the composition order — getting it
 * backwards produces geometry that is right for symmetric transforms and subtly
 * wrong for every other one, which is the worst possible failure mode.
 *
 * @param {number[]} m1
 * @param {number[]} m2
 * @returns {number[]} `[a, b, c, d, e, f]`
 */
export function multiply(m1, m2) {
  const [a1, b1, c1, d1, e1, f1] = m1
  const [a2, b2, c2, d2, e2, f2] = m2
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ]
}

/**
 * @param {number[]} m
 * @param {number} x
 * @param {number} y
 * @returns {[number, number]}
 */
export function applyToPoint(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

function toPx(token, base) {
  const m = NUMBER.exec(token)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  const unit = m[2].toLowerCase()
  if (unit === '%') return (n / 100) * base
  if (!unit) return n === 0 ? 0 : null
  const k = ABS_UNITS[unit]
  return k === undefined ? null : n * k
}

function toDeg(token) {
  const m = NUMBER.exec(token)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  const unit = m[2].toLowerCase()
  if (!unit) return n === 0 ? 0 : null
  const k = ANGLE_UNITS[unit]
  return k === undefined ? null : n * k
}

/** Split on `sep` at paren depth 0 — function arguments carry commas of their own. */
function splitTop(str, sep) {
  const out = []
  let depth = 0
  let start = 0
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (ch === '(') depth++
    else if (ch === ')') { if (depth > 0) depth-- }
    else if (depth === 0 && ch === sep) { out.push(str.slice(start, i)); start = i + 1 }
  }
  out.push(str.slice(start))
  return out
}

/** `[{name, args}]`, in source order. Anything malformed simply does not appear. */
function functions(str) {
  const out = []
  const re = /([a-zA-Z][\w-]*)\s*\(/g
  let m
  while ((m = re.exec(str))) {
    let depth = 1
    let i = re.lastIndex
    for (; i < str.length && depth > 0; i++) {
      if (str[i] === '(') depth++
      else if (str[i] === ')') depth--
    }
    if (depth !== 0) break
    out.push({
      name: m[1].toLowerCase(),
      args: splitTop(str.slice(re.lastIndex, i - 1), ',').map(s => s.trim()).filter(Boolean),
    })
    re.lastIndex = i
  }
  return out
}

const HORIZONTAL = { left: 0, center: 50, right: 100 }
const VERTICAL = { top: 0, center: 50, bottom: 100 }

/**
 * `transform-origin` -> `[ox, oy]` in px. The computed value is a px pair, but an
 * authored string can be keywords in either order (`top left` is legal), so the
 * keyword table decides which token is which axis rather than position alone.
 */
function parseOrigin(css, w, h) {
  const def = [w / 2, h / 2]
  if (typeof css !== 'string') return def
  const tokens = css.trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) return def
  // The third component is the z origin: it only bends 3D transforms, which this
  // module flattens anyway.
  if (tokens.length > 2) tokens.length = 2

  let xs = null
  let ys = null
  for (const raw of tokens) {
    const token = raw.toLowerCase()
    if (token in HORIZONTAL && !(token in VERTICAL)) { xs = `${HORIZONTAL[token]}%`; continue }
    if (token in VERTICAL && !(token in HORIZONTAL)) { ys = `${VERTICAL[token]}%`; continue }
    if (token === 'center') { if (xs === null) xs = '50%'; else ys = '50%'; continue }
    if (xs === null) xs = token
    else ys = token
  }

  const ox = xs === null ? def[0] : toPx(xs, w)
  const oy = ys === null ? def[1] : toPx(ys, h)
  return [ox === null ? def[0] : ox, oy === null ? def[1] : oy]
}

/** Every number, or `null` if any of them is unreadable — a partial matrix is not a matrix. */
function numbers(args, count) {
  if (args.length !== count) return null
  const out = []
  for (const a of args) {
    const n = parseFloat(a)
    if (!Number.isFinite(n) || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(a.trim())) return null
    out.push(n)
  }
  return out
}

/**
 * One transform function -> matrix. `null` when the function is unknown or its
 * arguments do not parse, so the caller can name it in `notes` instead of
 * quietly composing an identity in its place.
 */
function toMatrix(fn, w, h) {
  const { name, args } = fn
  const px = (i, base, dflt = 0) => (args[i] === undefined ? dflt : toPx(args[i], base))
  const deg = (i, dflt = 0) => (args[i] === undefined ? dflt : toDeg(args[i]))
  const num = (i, dflt) => {
    if (args[i] === undefined) return dflt
    const n = parseFloat(args[i])
    return Number.isFinite(n) ? n : null
  }
  const ok = (...vs) => vs.every(v => v !== null && v !== undefined)

  switch (name) {
    case 'matrix': {
      const v = numbers(args, 6)
      return v
    }
    case 'matrix3d': {
      const v = numbers(args, 16)
      // The 2D projection is the top-left 2x2 plus the translation column. m13,
      // m23 and the perspective row are dropped; the caller warns, per contract.
      return v && [v[0], v[1], v[4], v[5], v[12], v[13]]
    }
    case 'translate': {
      const x = px(0, w)
      const y = px(1, h)
      return ok(x, y) ? [1, 0, 0, 1, x, y] : null
    }
    case 'translatex': {
      const x = px(0, w)
      return ok(x) ? [1, 0, 0, 1, x, 0] : null
    }
    case 'translatey': {
      const y = px(0, h)
      return ok(y) ? [1, 0, 0, 1, 0, y] : null
    }
    case 'translate3d': {
      const x = px(0, w)
      const y = px(1, h)
      return ok(x, y) ? [1, 0, 0, 1, x, y] : null
    }
    case 'translatez': {
      return args.length === 1 ? IDENTITY.slice() : null
    }
    case 'scale': {
      const sx = num(0)
      const sy = num(1, sx)
      return ok(sx, sy) ? [sx, 0, 0, sy, 0, 0] : null
    }
    case 'scalex': {
      const sx = num(0)
      return ok(sx) ? [sx, 0, 0, 1, 0, 0] : null
    }
    case 'scaley': {
      const sy = num(0)
      return ok(sy) ? [1, 0, 0, sy, 0, 0] : null
    }
    case 'scale3d': {
      const sx = num(0)
      const sy = num(1)
      return ok(sx, sy) ? [sx, 0, 0, sy, 0, 0] : null
    }
    case 'scalez': {
      return args.length === 1 ? IDENTITY.slice() : null
    }
    case 'rotate':
    case 'rotatez': {
      const a = deg(0)
      if (!ok(a)) return null
      const r = (a * Math.PI) / 180
      return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]
    }
    // The 3D rotations flatten to their own top-left 2x2 — the same submatrix the
    // browser would hand us as matrix3d, so the authored path and the computed
    // path agree. An X rotation reads as a vertical squash, a Y one as horizontal.
    case 'rotatex': {
      const a = deg(0)
      return ok(a) ? [1, 0, 0, Math.cos((a * Math.PI) / 180), 0, 0] : null
    }
    case 'rotatey': {
      const a = deg(0)
      return ok(a) ? [Math.cos((a * Math.PI) / 180), 0, 0, 1, 0, 0] : null
    }
    case 'rotate3d': {
      const x = num(0)
      const y = num(1)
      const z = num(2)
      const a = deg(3)
      if (!ok(x, y, z, a)) return null
      const len = Math.hypot(x, y, z)
      if (!len) return IDENTITY.slice()
      const ux = x / len
      const uy = y / len
      const uz = z / len
      const r = (a * Math.PI) / 180
      const c = Math.cos(r)
      const s = Math.sin(r)
      const t = 1 - c
      return [c + ux * ux * t, uy * ux * t + uz * s, ux * uy * t - uz * s, c + uy * uy * t, 0, 0]
    }
    // Perspective only fills the 4th row, which the 2D submatrix does not have.
    case 'perspective':
      return args.length === 1 ? IDENTITY.slice() : null
    case 'skew': {
      const ax = deg(0)
      const ay = deg(1)
      return ok(ax, ay)
        ? [1, Math.tan((ay * Math.PI) / 180), Math.tan((ax * Math.PI) / 180), 1, 0, 0]
        : null
    }
    case 'skewx': {
      const ax = deg(0)
      return ok(ax) ? [1, 0, Math.tan((ax * Math.PI) / 180), 1, 0, 0] : null
    }
    case 'skewy': {
      const ay = deg(0)
      return ok(ay) ? [1, Math.tan((ay * Math.PI) / 180), 0, 1, 0, 0] : null
    }
    default:
      return null
  }
}

/** atan2 already lands in (-180, 180]; the modulo is for values built by hand. */
function clampDeg(rad) {
  const d = (rad * 180) / Math.PI
  const n = ((d + 180) % 360 + 360) % 360 - 180
  return Object.is(n, -0) ? 0 : n
}

/**
 * QR decomposition of the linear part.
 *
 * Reconstructs as `translate(tx,ty) rotate(rot) skewX(skewX) scale(sx,sy)`, which
 * gives `[a, b] = sx·(cos, sin)` — so the rotation and sx fall straight out of
 * the first column, sy out of the determinant, and `tan(skewX) = (ac+bd)/det`.
 * A negative determinant lands in `sy` as a flip rather than in a second
 * "flip" flag nobody downstream would read.
 */
function decompose(m) {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c
  const out = { tx: e, ty: f, rot: 0, sx: 0, sy: 0, skewX: 0 }

  const r = Math.hypot(a, b)
  if (r > 0) {
    out.rot = clampDeg(Math.atan2(b, a))
    out.sx = r
    out.sy = det / r
    const n = a * c + b * d
    // det === 0 means the matrix collapses the plane onto a line: sy is 0 and the
    // skew is unbounded, so it saturates at the perpendicular rather than NaN.
    out.skewX = det !== 0
      ? clampDeg(Math.atan(n / det))
      : (n === 0 ? 0 : Math.sign(n) * 90)
    return out
  }

  const s = Math.hypot(c, d)
  if (s > 0) {
    // sx is 0, so the first column carries no direction and the decomposition is
    // underdetermined. Pinning skewX at 0 makes it unique: the y axis alone then
    // fixes the rotation, since it maps to (-sin, cos)·sy.
    out.rot = clampDeg(Math.atan2(-c, d))
    out.sy = s
    return out
  }
  return out
}

/**
 * @param {string} cssTransform  a computed `transform` — `matrix(...)`,
 *                               `matrix3d(...)` or `none`. Authored function
 *                               lists are composed too, for callers that have
 *                               not been through `getComputedStyle`.
 * @param {string} cssOrigin     a computed `transform-origin`; defaults to the
 *                               box centre when absent or unreadable
 * @param {number} w             border-box width, for percentage resolution
 * @param {number} h             border-box height
 * @returns {{m:number[], decomposed:{tx:number,ty:number,rot:number,sx:number,
 *            sy:number,skewX:number}, is3d?:boolean, notes?:string[]}|null}
 *   `null` for `none`/empty. `m` already has the origin baked in. `is3d` is set
 *   only when the input was a 3D transform that had to be flattened — the caller
 *   turns that into the diagnostic, per contract. `notes` lists any function that
 *   could not be read, and is present only when non-empty.
 */
export function parseTransform(cssTransform, cssOrigin, w, h) {
  const src = typeof cssTransform === 'string' ? cssTransform.trim() : ''
  if (!src || src === 'none') return null

  const width = Number.isFinite(w) ? w : 0
  const height = Number.isFinite(h) ? h : 0

  const notes = []
  const fns = functions(src)
  if (!fns.length) notes.push(`transform: no transform function found in "${src}" — treated as identity`)

  let is3d = false
  let m = IDENTITY.slice()
  for (const fn of fns) {
    if (/3d$|^perspective$|^rotate[xy]$/.test(fn.name)) is3d = true
    const step = toMatrix(fn, width, height)
    if (!step) {
      notes.push(`transform: could not read "${fn.name}(${fn.args.join(', ')})" — ignored`)
      continue
    }
    m = multiply(m, step)
  }

  const [ox, oy] = parseOrigin(cssOrigin, width, height)
  if (ox || oy) {
    m = multiply(multiply([1, 0, 0, 1, ox, oy], m), [1, 0, 0, 1, -ox, -oy])
  }

  const out = { m, decomposed: decompose(m) }
  if (is3d) out.is3d = true
  if (notes.length) out.notes = notes
  return out
}
