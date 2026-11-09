/**
 * CSS gradient layers -> SVD `Paint`.
 *
 * The whole point of this module is that **nothing downstream ever sees a
 * percentage or a px**. A gradient is a shape in the unit square [0,1]² plus a
 * 2x3 matrix that maps that square onto the painting box. Everything the CSS
 * geometry knows — the angle, the gradient-line length, the ellipse aspect
 * ratio, the `at <position>` offset — is absorbed into the matrix, so a backend
 * only has to compose one affine transform and read stops whose `t` is already
 * in 0..1. That is SVD invariant 6, and it is the documented cure for Figma's
 * "failed to invert transform" on SVG import: every matrix this module emits is
 * non-singular by construction.
 *
 * Unit-space conventions, per gradient type — these are normative for emitters:
 *
 *   linear   `t = x`. The gradient runs from `unit.p0` (0,0) to `unit.p1` (1,0).
 *            The matrix' second basis vector is the perpendicular of the first
 *            and the same length, so the map is a similarity: colours do not
 *            shear.
 *   radial   `t = 2·|p − (0.5,0.5)|`. The ending shape is the circle of radius
 *            0.5 centred at (0.5,0.5); the unit SQUARE maps onto the ellipse's
 *            bounding box, which is where the anisotropy lives. A backend that
 *            wants an SVG `<radialGradient>` emits r=0.5, cx=cy=0.5 and this
 *            matrix as `gradientTransform`, and gets the ellipse for free.
 *   angular  `t = θ / 360`, θ measured **clockwise from `unit.startAngle`**, and
 *            `startAngle` itself is degrees clockwise from straight up — CSS's
 *            own convention for `from <angle>`. The matrix is deliberately a
 *            uniform scale (no aspect, no rotation): a conic gradient's angles
 *            are true screen angles, so squashing the unit square would bend
 *            them. `startAngle` is therefore NOT folded into the matrix; an
 *            emitter that needs it there composes the rotation itself.
 *
 * Approximations are named in `notes`, never silent. The interesting ones:
 * colour-stop hints (`red, 30%, blue`) are a power curve no target primitive has,
 * so they are resampled to 8–16 stops chosen to keep the CIEDE2000 error under
 * 1.0 — below the just-noticeable difference — and reported as `hint-resampled:N`.
 *
 * Pure: no DOM, no `getComputedStyle`, no `eval`/`new Function`. Node can fuzz it.
 */
import { parseColor, toCssString } from './color.js'

const DEG = 180 / Math.PI
const RAD = Math.PI / 180
const EPS = 1e-9

/**
 * Repetitions unrolled for `repeating-*` before we give up and pad, and the stop
 * budget that also bounds them: a 0.5px period carrying a resampled hint is 10
 * stops a copy, and 64 of those is a paint no backend wants to be handed.
 */
const MAX_REPEATS = 64
const MAX_STOPS = 512

/** Stops emitted per hinted segment, endpoints included, and the error they must beat. */
const HINT_MIN = 8
const HINT_MAX = 16
const HINT_DE = 1.0

const GRADIENT_HEAD = /^(-webkit-|-moz-|-o-|-ms-)?(repeating-)?(linear|radial|conic)-gradient\s*\(/i

const SIZE_KEYWORDS = new Set(['closest-side', 'closest-corner', 'farthest-side', 'farthest-corner'])
const SHAPE_KEYWORDS = new Set(['circle', 'ellipse'])
const POS_KEYWORDS = new Set(['left', 'right', 'top', 'bottom', 'center'])

const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v

// ————————————————————————————————————————————————————————————————
// Tokenizing
// ————————————————————————————————————————————————————————————————

/**
 * Split on `sep` (a comma) or on whitespace, ignoring separators nested inside
 * parentheses — `rgb(0, 0, 0)` is one token, not three.
 */
function splitTop (s, sep) {
  const out = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (depth === 0 && (sep === ',' ? c === ',' : c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f')) {
      out.push(s.slice(start, i))
      start = i + 1
    }
  }
  out.push(s.slice(start))
  const trimmed = []
  for (const t of out) {
    const v = t.trim()
    if (v !== '') trimmed.push(v)
  }
  return trimmed
}

/**
 * Recognise `<prefix?><repeating-?><kind>-gradient( … )` and return its inside.
 * The closing paren is found by balancing rather than by regex: a stop colour
 * may contain arbitrarily nested functions.
 */
function matchGradient (css) {
  const s = String(css).trim()
  const head = GRADIENT_HEAD.exec(s)
  if (!head) return null
  const open = head[0].lastIndexOf('(') + head.index
  let depth = 0
  let close = -1
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')' && --depth === 0) { close = i; break }
  }
  if (close === -1 || s.slice(close + 1).trim() !== '') return null
  return {
    prefixed: !!head[1],
    repeating: !!head[2],
    kind: head[3].toLowerCase(),
    args: s.slice(open + 1, close),
  }
}

// ————————————————————————————————————————————————————————————————
// Dimensions — px / % / deg components, resolved against a reference later.
// `n` is the unitless part; it only ever legally survives as zero.
// ————————————————————————————————————————————————————————————————

const UNIT_PX = { px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6 }
const UNIT_DEG = { deg: 1, grad: 0.9, rad: DEG, turn: 360 }

const dim = (px = 0, pct = 0, deg = 0, n = 0) => ({ px, pct, deg, n })

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/

/** A single `<number><unit>` token. `null` when the unit is not resolvable here (em, vw, ch…). */
function parseNumeric (tok) {
  const m = NUMBER.exec(tok)
  if (!m || m[0].length === 0) return null
  const n = parseFloat(m[0])
  if (!Number.isFinite(n)) return null
  const unit = tok.slice(m[0].length).toLowerCase()
  if (unit === '') return dim(0, 0, 0, n)
  if (unit === '%') return dim(0, n)
  if (UNIT_PX[unit] !== undefined) return dim(n * UNIT_PX[unit])
  if (UNIT_DEG[unit] !== undefined) return dim(0, 0, n * UNIT_DEG[unit])
  return null
}

const isPureNumber = (d) => d.px === 0 && d.pct === 0 && d.deg === 0

/**
 * `calc()` without an evaluator: the expression is tokenized, then walked by
 * recursive descent over dimension vectors. `*` and `/` demand a dimensionless
 * operand, which is exactly the CSS restriction, so a malformed expression
 * returns `null` instead of a plausible-looking number.
 */
function calcTokens (s) {
  const out = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f') { i++; continue }
    if (c === '(' || c === ')' || c === '*' || c === '/') { out.push(c); i++; continue }
    if (c === '+' || c === '-') {
      const prev = out[out.length - 1]
      const opens = prev === undefined || prev === '(' || (typeof prev === 'string' && '+-*/'.indexOf(prev) >= 0)
      const next = s[i + 1] || ''
      if (!(opens && (next >= '0' && next <= '9' || next === '.'))) { out.push(c); i++; continue }
    }
    const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[a-z%]*/i.exec(s.slice(i))
    if (!m) return null
    const v = parseNumeric(m[0])
    if (!v) return null
    out.push(v)
    i += m[0].length
  }
  return out
}

function calcParse (tokens) {
  let i = 0

  const primary = () => {
    const t = tokens[i]
    if (t === '(') {
      i++
      const v = sum()
      if (tokens[i] !== ')') return null
      i++
      return v
    }
    if (t === '-' || t === '+') {
      i++
      const v = primary()
      if (!v) return null
      return t === '-' ? dim(-v.px, -v.pct, -v.deg, -v.n) : v
    }
    if (t && typeof t === 'object') { i++; return t }
    return null
  }

  const product = () => {
    let left = primary()
    if (!left) return null
    while (tokens[i] === '*' || tokens[i] === '/') {
      const op = tokens[i++]
      const right = primary()
      if (!right) return null
      if (op === '*') {
        const k = isPureNumber(right) ? right.n : isPureNumber(left) ? left.n : null
        if (k === null) return null
        const other = isPureNumber(right) ? left : right
        left = dim(other.px * k, other.pct * k, other.deg * k, other.n * k)
      } else {
        if (!isPureNumber(right) || right.n === 0) return null
        const k = 1 / right.n
        left = dim(left.px * k, left.pct * k, left.deg * k, left.n * k)
      }
    }
    return left
  }

  const sum = () => {
    let left = product()
    if (!left) return null
    while (tokens[i] === '+' || tokens[i] === '-') {
      const op = tokens[i++]
      const right = product()
      if (!right) return null
      const s = op === '+' ? 1 : -1
      left = dim(left.px + s * right.px, left.pct + s * right.pct, left.deg + s * right.deg, left.n + s * right.n)
    }
    return left
  }

  const v = sum()
  return v && i === tokens.length ? v : null
}

/** `<length-percentage>` / `<angle>` / `calc(…)` -> dimension vector, or `null`. */
function parseDim (tok) {
  const s = tok.trim()
  const lower = s.toLowerCase()
  if (lower.startsWith('calc(') && s.endsWith(')')) {
    const tokens = calcTokens(s.slice(5, -1))
    return tokens ? calcParse(tokens) : null
  }
  return parseNumeric(s)
}

/** True for tokens worth handing to `parseDim` — keeps `red` out of the numeric path. */
function looksNumeric (tok) {
  if (!tok) return false
  const c = tok[0]
  return (c >= '0' && c <= '9') || c === '.' || c === '+' || c === '-' || /^calc\(/i.test(tok)
}

const resolveLength = (d, ref) => (d && d.n === 0 && d.deg === 0) ? d.px + d.pct / 100 * ref : null
const resolveAngle = (d) => (d && d.n === 0 && d.px === 0) ? d.deg + d.pct / 100 * 360 : null

// ————————————————————————————————————————————————————————————————
// Colour maths
// ————————————————————————————————————————————————————————————————

/**
 * Interpolate in **premultiplied** sRGB, which is what CSS, SVG and Figma all
 * do. Doing it unpremultiplied is where the grey halo around a fade-to-
 * transparent comes from.
 */
function lerpColor (c0, c1, t) {
  const a0 = c0[3]
  const a1 = c1[3]
  const a = a0 + (a1 - a0) * t
  if (a <= EPS) return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t, 0]
  const out = [0, 0, 0, a]
  for (let i = 0; i < 3; i++) {
    const p = c0[i] * a0 + (c1[i] * a1 - c0[i] * a0) * t
    out[i] = clamp(p / a, 0, 1)
  }
  return out
}

const srgbToLinear = (c) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)

/** sRGB 0..1 -> CIE Lab (D65), the space CIEDE2000 is defined in. */
function srgbToLab (rgb) {
  const r = srgbToLinear(clamp(rgb[0], 0, 1))
  const g = srgbToLinear(clamp(rgb[1], 0, 1))
  const b = srgbToLinear(clamp(rgb[2], 0, 1))
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
  const y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b) / 1.0
  const z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883
  const f = (t) => t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29
  const fx = f(x)
  const fy = f(y)
  const fz = f(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** CIEDE2000. Verbatim from Sharma et al. 2005; kL = kC = kH = 1. */
function deltaE00 (lab1, lab2) {
  const [L1, a1, b1] = lab1
  const [L2, a2, b2] = lab2
  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const Cb = (C1 + C2) / 2
  const Cb7 = Math.pow(Cb, 7)
  const G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + 6103515625)))
  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)
  const hue = (b, ap) => (b === 0 && ap === 0) ? 0 : (Math.atan2(b, ap) * DEG + 360) % 360
  const h1p = hue(b1, a1p)
  const h2p = hue(b2, a2p)
  const dLp = L2 - L1
  const dCp = C2p - C1p
  let dhp = 0
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p
    if (dhp > 180) dhp -= 360
    else if (dhp < -180) dhp += 360
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp / 2 * RAD)
  const Lbp = (L1 + L2) / 2
  const Cbp = (C1p + C2p) / 2
  let hbp
  if (C1p * C2p === 0) hbp = h1p + h2p
  else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2
  else hbp = (h1p + h2p + (h1p + h2p < 360 ? 360 : -360)) / 2
  const T = 1 - 0.17 * Math.cos((hbp - 30) * RAD) + 0.24 * Math.cos(2 * hbp * RAD) +
    0.32 * Math.cos((3 * hbp + 6) * RAD) - 0.20 * Math.cos((4 * hbp - 63) * RAD)
  const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2))
  const Cbp7 = Math.pow(Cbp, 7)
  const Rc = 2 * Math.sqrt(Cbp7 / (Cbp7 + 6103515625))
  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2))
  const Sc = 1 + 0.045 * Cbp
  const Sh = 1 + 0.015 * Cbp * T
  const Rt = -Math.sin(2 * dTheta * RAD) * Rc
  const tL = dLp / Sl
  const tC = dCp / Sc
  const tH = dHp / Sh
  return Math.sqrt(tL * tL + tC * tC + tH * tH + Rt * tC * tH)
}

/**
 * Perceptual distance between two possibly-translucent colours: the worst case
 * of compositing both over black and over white. A plain ΔE on the unmultiplied
 * channels would call two colours identical when only their alpha differs.
 */
function colorError (c0, c1) {
  const over = (c, bg) => srgbToLab([
    c[0] * c[3] + bg * (1 - c[3]),
    c[1] * c[3] + bg * (1 - c[3]),
    c[2] * c[3] + bg * (1 - c[3]),
  ])
  return Math.max(deltaE00(over(c0, 0), over(c1, 0)), deltaE00(over(c0, 1), over(c1, 1)))
}

const sameColor = (a, b) =>
  Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4 &&
  Math.abs(a[2] - b[2]) < 1e-4 && Math.abs(a[3] - b[3]) < 1e-4

const stop = (t, color, srcCss) => ({ t, color, srcCss: srcCss || toCssString(color) })

// ————————————————————————————————————————————————————————————————
// Position (`at <position>` / legacy leading position)
// ————————————————————————————————————————————————————————————————

const H_KEY = { left: 0, center: 0.5, right: 1 }
const V_KEY = { top: 0, center: 0.5, bottom: 1 }

/**
 * `<position>` in all four of its arities, resolved to px in the painting box.
 * `null` when the tokens are not a position at all — which is how the radial
 * prelude sniffer tells `at 10px 20px` from a colour stop.
 */
function parsePosition (tokens, w, h) {
  if (tokens.length === 0 || tokens.length > 4) return null
  let x = null
  let y = null

  if (tokens.length >= 3) {
    // Edge-offset form: `left 10px top 20px`, `right 5% bottom`.
    let i = 0
    while (i < tokens.length) {
      const k = tokens[i++].toLowerCase()
      if (!POS_KEYWORDS.has(k)) return null
      let off = null
      if (i < tokens.length && !POS_KEYWORDS.has(tokens[i].toLowerCase())) {
        if (!looksNumeric(tokens[i])) return null
        off = parseDim(tokens[i++])
        if (!off) return null
      }
      if (k === 'center') {
        if (off) return null
        if (x === null) x = w / 2
        else if (y === null) y = h / 2
        else return null
        continue
      }
      const vertical = k === 'top' || k === 'bottom'
      const ref = vertical ? h : w
      const d = off ? resolveLength(off, ref) : 0
      if (d === null) return null
      const v = (k === 'right' || k === 'bottom') ? ref - d : d
      if (vertical) { if (y !== null) return null; y = v } else { if (x !== null) return null; x = v }
    }
  } else {
    const a = tokens[0]
    const b = tokens[1]
    const ka = a.toLowerCase()
    const kb = b === undefined ? undefined : b.toLowerCase()
    // `top left` is legal, so a leading vertical keyword swaps the pair.
    const swap = tokens.length === 2 &&
      ((ka === 'top' || ka === 'bottom') || (kb === 'left' || kb === 'right'))
    const first = swap ? b : a
    const second = swap ? a : b
    const axis = (tok, keys, ref) => {
      if (tok === undefined) return ref / 2
      const k = tok.toLowerCase()
      if (keys[k] !== undefined) return keys[k] * ref
      if (!looksNumeric(tok)) return null
      return resolveLength(parseDim(tok), ref)
    }
    if (tokens.length === 1 && (ka === 'top' || ka === 'bottom')) {
      x = w / 2
      y = V_KEY[ka] * h
    } else {
      x = axis(first, H_KEY, w)
      y = axis(second, V_KEY, h)
    }
    if (x === null || y === null) return null
  }

  return { x: x === null ? w / 2 : x, y: y === null ? h / 2 : y }
}

// ————————————————————————————————————————————————————————————————
// Geometry
// ————————————————————————————————————————————————————————————————

/**
 * The corner formula from CSS Images 3: for `to top right` the gradient line is
 * angled so that the perpendicular through the centre passes through the two
 * NEIGHBOURING corners (top-left and bottom-right) — it does not point at the
 * corner itself. Perpendicular to (w, h) is (h, −w), and CSS measures clockwise
 * from straight up, hence atan2(h, w). On a 200x100 box that is 26.57deg, not
 * the naive 63.43deg of the diagonal.
 */
function cornerAngle (w, h) {
  return Math.atan2(h, w) * DEG
}

const SIDE_ANGLE = { top: 0, right: 90, bottom: 180, left: 270 }

function sideOrCornerAngle (words, w, h) {
  const set = new Set(words.map((s) => s.toLowerCase()))
  if (set.size !== words.length) return null
  const horiz = set.has('left') ? 'left' : set.has('right') ? 'right' : null
  const vert = set.has('top') ? 'top' : set.has('bottom') ? 'bottom' : null
  if (set.size === 1) {
    const only = words[0].toLowerCase()
    return SIDE_ANGLE[only] === undefined ? null : SIDE_ANGLE[only]
  }
  if (set.size !== 2 || !horiz || !vert) return null
  const a = cornerAngle(w, h)
  if (vert === 'top') return horiz === 'right' ? a : 360 - a
  return horiz === 'right' ? 180 - a : 180 + a
}

/**
 * Gradient line for an angle, per spec: it passes through the centre, and its
 * length is `|w·sinθ| + |h·cosθ|` — the projection of the whole box onto it. So
 * t=0 and t=1 land exactly on the corner projections, and the painted domain is
 * exactly [0,1]. That is what lets the stop list be clamped to [0,1] with no loss.
 */
function linearLine (angle, w, h) {
  const r = angle * RAD
  const sin = Math.sin(r)
  const cos = Math.cos(r)
  const L = Math.abs(w * sin) + Math.abs(h * cos)
  const dx = sin
  const dy = -cos
  const cx = w / 2
  const cy = h / 2
  return {
    L,
    p0: [cx - dx * L / 2, cy - dy * L / 2],
    p1: [cx + dx * L / 2, cy + dy * L / 2],
  }
}

/** Ending-shape size for every keyword, both shapes. Returns px radii. */
function radialSize (keyword, shape, cx, cy, w, h) {
  const left = Math.abs(cx)
  const right = Math.abs(w - cx)
  const top = Math.abs(cy)
  const bottom = Math.abs(h - cy)
  if (shape === 'circle') {
    let r
    if (keyword === 'closest-side') r = Math.min(left, right, top, bottom)
    else if (keyword === 'farthest-side') r = Math.max(left, right, top, bottom)
    else {
      const dx = keyword === 'closest-corner' ? Math.min(left, right) : Math.max(left, right)
      const dy = keyword === 'closest-corner' ? Math.min(top, bottom) : Math.max(top, bottom)
      r = Math.hypot(dx, dy)
    }
    return { rx: r, ry: r }
  }
  const near = keyword === 'closest-side' || keyword === 'closest-corner'
  const rx = near ? Math.min(left, right) : Math.max(left, right)
  const ry = near ? Math.min(top, bottom) : Math.max(top, bottom)
  // A corner ellipse keeps the side ellipse's aspect ratio and passes through the
  // corner; solving (dx/rx)²+(dy/ry)²=1 under that constraint collapses to √2.
  const k = (keyword === 'closest-corner' || keyword === 'farthest-corner') ? Math.SQRT2 : 1
  return { rx: rx * k, ry: ry * k }
}

/** Largest `t` any pixel of the box reaches, in ending-shape units. */
function radialCornerT (cx, cy, rx, ry, w, h) {
  let m = 0
  for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) {
    m = Math.max(m, Math.hypot((x - cx) / rx, (y - cy) / ry))
  }
  return m
}

// ————————————————————————————————————————————————————————————————
// Stop list
// ————————————————————————————————————————————————————————————————

/**
 * One comma-separated argument -> zero or more entries. A bare position is a
 * colour hint; a colour with two positions is the shorthand for two stops at the
 * same colour, which is how hard-edged stripes are written.
 */
function parseStopPart (part, notes) {
  const tokens = splitTop(part, ' ')
  if (tokens.length === 0) return []
  if (tokens.length === 1 && looksNumeric(tokens[0])) {
    const d = parseDim(tokens[0])
    if (!d) { notes.push(`unsupported-value:${tokens[0]}`); return [] }
    return [{ hint: true, d, t: null }]
  }
  const parsed = parseColor(tokens[0])
  if (!parsed) {
    notes.push(`unparsed-color:${tokens[0]}`)
    return []
  }
  const positions = []
  for (let i = 1; i < tokens.length && i < 3; i++) {
    const d = parseDim(tokens[i])
    if (!d) { notes.push(`unsupported-value:${tokens[i]}`); continue }
    positions.push(d)
  }
  if (tokens.length > 3) notes.push(`extra-stop-tokens:${tokens.length - 3}`)
  if (positions.length === 0) return [{ color: parsed.rgba, srcCss: parsed.srcCss, d: null, t: null }]
  return positions.map((d) => ({ color: parsed.rgba, srcCss: parsed.srcCss, d, t: null }))
}

/**
 * CSS Images 3 §3.4.3 colour-stop fixup: default the ends, force the sequence
 * non-decreasing, then spread unpositioned runs evenly. Hints participate as
 * fixed anchors — they always carry a position.
 */
function fixupPositions (entries) {
  const first = entries[0]
  const last = entries[entries.length - 1]
  if (first.t === null) first.t = 0
  if (last.t === null) last.t = 1

  let high = -Infinity
  for (const e of entries) {
    if (e.t === null) continue
    if (e.t < high) e.t = high
    else high = e.t
  }

  for (let i = 0; i < entries.length; i++) {
    if (entries[i].t !== null) continue
    let j = i
    while (j < entries.length && entries[j].t === null) j++
    const before = entries[i - 1].t
    const after = j < entries.length ? entries[j].t : 1
    const n = j - i + 1
    for (let k = i; k < j; k++) entries[k].t = before + (after - before) * (k - i + 1) / n
    i = j - 1
  }
  return entries
}

/**
 * Give every fully transparent stop the RGB of its neighbour. Under
 * premultiplied interpolation the RGB behind a zero alpha is unobservable, so
 * this is lossless — but every backend that interpolates unpremultiplied (and
 * most raster paths do, somewhere) otherwise fades through the black of
 * `rgba(0,0,0,0)`, which is the classic grey halo. When the two neighbours
 * disagree the stop is SPLIT into two coincident ones, one carrying each
 * neighbour's RGB: still invisible, and now correct on both sides.
 */
function fixTransparentStops (entries, notes) {
  const out = []
  let fixed = 0
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e.hint || e.color[3] > EPS) { out.push(e); continue }
    let prev = null
    let next = null
    for (let j = i - 1; j >= 0; j--) if (!entries[j].hint && entries[j].color[3] > EPS) { prev = entries[j].color; break }
    for (let j = i + 1; j < entries.length; j++) if (!entries[j].hint && entries[j].color[3] > EPS) { next = entries[j].color; break }
    if (!prev && !next) { out.push(e); continue }
    fixed++
    const mk = (c) => ({ t: e.t, color: [c[0], c[1], c[2], 0], srcCss: toCssString([c[0], c[1], c[2], 0]) })
    if (prev && next && !sameColor([prev[0], prev[1], prev[2], 0], [next[0], next[1], next[2], 0])) {
      out.push(mk(prev), mk(next))
    } else {
      out.push(mk(prev || next))
    }
  }
  if (fixed) notes.push(`transparent-neighbour-rgb:${fixed}`)
  return out
}

const SEG_SAMPLES = [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]

/**
 * A colour hint places the 50% point of a transition at an arbitrary position,
 * which is a power curve — `mix(c0, c1, u^k)` with `k = log(.5)/log(ratio)`.
 * No target primitive has that, so it is sampled.
 *
 * Nodes are placed by greedy refinement rather than on a fixed grid: split the
 * segment with the worst error, measure again, repeat. A fixed grid — uniform in
 * position, or uniform in colour — is badly wrong at one end or the other
 * whenever the hint is far from the middle, because the curvature of `u^k` is
 * concentrated there. Refinement finds those places on its own, and stops as
 * soon as the whole segment is under a just-noticeable ΔE00.
 */
function resampleHint (a, hint, b, notes) {
  const span = b.t - a.t
  if (span <= EPS) { notes.push('hint-degenerate'); return [] }
  const ratio = (hint.t - a.t) / span
  if (sameColor(a.color, b.color)) return []
  if (ratio <= EPS) {
    // Midpoint at the very start: the transition is instantaneous there.
    notes.push('hint-degenerate')
    return [stop(a.t, b.color)]
  }
  if (ratio >= 1 - EPS) {
    notes.push('hint-degenerate')
    return [stop(b.t, a.color)]
  }
  if (Math.abs(ratio - 0.5) < 1e-6) return []           // already linear

  const k = Math.log(0.5) / Math.log(ratio)
  const curve = (u) => lerpColor(a.color, b.color, Math.pow(clamp(u, 0, 1), k))
  const segError = (u0, u1) => {
    const c0 = curve(u0)
    const c1 = curve(u1)
    let e = 0
    for (const f of SEG_SAMPLES) e = Math.max(e, colorError(curve(u0 + (u1 - u0) * f), lerpColor(c0, c1, f)))
    return e
  }

  const nodes = [0, 1]
  const errs = [segError(0, 1)]
  while (nodes.length < HINT_MAX) {
    let worst = 0
    for (let i = 1; i < errs.length; i++) if (errs[i] > errs[worst]) worst = i
    if (nodes.length >= HINT_MIN && errs[worst] < HINT_DE) break
    const u0 = nodes[worst]
    const u1 = nodes[worst + 1]
    // Split where the curve is halfway in COLOUR, not in position: on a power
    // curve that is where the remaining error actually divides evenly.
    let um = Math.pow((Math.pow(u0, k) + Math.pow(u1, k)) / 2, 1 / k)
    if (!(um > u0 + EPS && um < u1 - EPS)) um = (u0 + u1) / 2
    nodes.splice(worst + 1, 0, um)
    errs.splice(worst, 1, segError(u0, um), segError(um, u1))
  }

  notes.push(`hint-resampled:${nodes.length}`)
  const err = Math.max(...errs)
  if (err >= HINT_DE) notes.push(`hint-residual-de:${err.toFixed(2)}`)
  // The two endpoints are the neighbouring stops, already in the list.
  const out = []
  for (let i = 1; i < nodes.length - 1; i++) out.push(stop(a.t + nodes[i] * span, curve(nodes[i])))
  return out
}

function applyHints (entries, notes) {
  const out = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (!e.hint) { out.push(stop(e.t, e.color, e.srcCss)); continue }
    const a = entries[i - 1]
    const b = entries[i + 1]
    if (!a || !b || a.hint || b.hint) { notes.push('hint-orphan'); continue }
    for (const s of resampleHint(a, e, b, notes)) out.push(s)
  }
  return out
}

/** Colour anywhere on the ramp, with the CSS pad behaviour outside it. */
function colorAt (stops, t) {
  if (t <= stops[0].t) return stops[0].color
  const last = stops[stops.length - 1]
  if (t >= last.t) return last.color
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]
    const b = stops[i]
    if (t <= b.t) {
      const span = b.t - a.t
      return span <= EPS ? b.color : lerpColor(a.color, b.color, (t - a.t) / span)
    }
  }
  return last.color
}

/**
 * Restrict the ramp to the domain that is actually painted, inserting the
 * interpolated boundary colours. Lossless: outside [lo,hi] nothing is drawn, and
 * inside it the colours are unchanged.
 */
function clampDomain (stops, lo, hi) {
  const out = []
  if (stops[0].t < lo - EPS) out.push(stop(lo, colorAt(stops, lo)))
  for (const s of stops) {
    if (s.t < lo - EPS || s.t > hi + EPS) continue
    out.push(stop(clamp(s.t, lo, hi), s.color, s.srcCss))
  }
  if (stops[stops.length - 1].t > hi + EPS) out.push(stop(hi, colorAt(stops, hi)))
  return out.length ? out : [stop(lo, colorAt(stops, lo)), stop(hi, colorAt(stops, hi))]
}

/** Premultiplied average of every stop — what a zero-period repeating gradient renders as. */
function averageColor (stops) {
  let r = 0
  let g = 0
  let b = 0
  let a = 0
  for (const s of stops) {
    r += s.color[0] * s.color[3]
    g += s.color[1] * s.color[3]
    b += s.color[2] * s.color[3]
    a += s.color[3]
  }
  const n = stops.length
  if (a <= EPS) return [0, 0, 0, 0]
  return [clamp(r / a, 0, 1), clamp(g / a, 0, 1), clamp(b / a, 0, 1), a / n]
}

/**
 * Unroll `repeating-*` across the painted domain. The period is the distance
 * between the first and last stop; copies are laid down until [lo,hi] is covered
 * or the budget is spent, after which the last colour pads and the truncation is
 * reported — `emitted/needed` — rather than left to be discovered visually.
 */
function unrollRepeat (stops, lo, hi, notes) {
  const period = stops[stops.length - 1].t - stops[0].t
  if (!(period > EPS)) {
    notes.push('repeating-zero-period-averaged')
    const avg = averageColor(stops)
    return [stop(lo, avg), stop(hi, avg)]
  }
  const kMin = Math.floor((lo - stops[stops.length - 1].t) / period)
  const kMax = Math.ceil((hi - stops[0].t) / period)
  const needed = kMax - kMin + 1
  const cap = Math.min(MAX_REPEATS, Math.max(1, Math.floor(MAX_STOPS / stops.length)))
  let copies = needed
  if (copies > cap) {
    notes.push(`repeating-truncated:${cap}/${needed}`)
    copies = cap
  }
  const out = []
  for (let i = 0; i < copies; i++) {
    const shift = (kMin + i) * period
    for (const s of stops) out.push(stop(s.t + shift, s.color, s.srcCss))
  }
  return out
}

/**
 * Drop stops that carry no information: exact duplicates, and third-and-beyond
 * ties at one position. Two DIFFERENT colours at one position are kept — that
 * is a hard edge, the whole basis of CSS stripes, and also what `red 60%,
 * blue 20%` collapses to after the monotonic fixup.
 */
function dedupe (stops) {
  const out = []
  for (const s of stops) {
    const n = out.length
    if (n && Math.abs(out[n - 1].t - s.t) < 1e-7) {
      if (sameColor(out[n - 1].color, s.color)) continue
      if (n > 1 && Math.abs(out[n - 2].t - s.t) < 1e-7) { out[n - 1] = s; continue }
    }
    out.push(s)
  }
  // A lone stop is a constant colour; spanning it is the only form every backend reads.
  if (out.length === 1) return [stop(0, out[0].color, out[0].srcCss), stop(1, out[0].color, out[0].srcCss)]
  return out
}

// ————————————————————————————————————————————————————————————————
// Preludes
// ————————————————————————————————————————————————————————————————

/** Legacy `-webkit-` gradients name the START side and measure angles CCW from east. */
function legacyLinearAngle (tokens, w, h) {
  if (tokens.length === 1 && looksNumeric(tokens[0])) {
    const a = resolveAngle(parseDim(tokens[0]))
    return a === null ? null : ((90 - a) % 360 + 360) % 360
  }
  const flip = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }
  const flipped = tokens.map((t) => flip[t.toLowerCase()])
  if (flipped.some((t) => t === undefined)) return null
  return sideOrCornerAngle(flipped, w, h)
}

function radialPrelude (tokens, w, h, notes) {
  let shape = null
  let sizeKeyword = null
  const dims = []
  let at = null

  const atIndex = tokens.findIndex((t) => t.toLowerCase() === 'at')
  const head = atIndex === -1 ? tokens : tokens.slice(0, atIndex)
  if (atIndex !== -1) {
    at = parsePosition(tokens.slice(atIndex + 1), w, h)
    if (!at) { notes.push('unparsed-position'); at = { x: w / 2, y: h / 2 } }
  }

  for (const tok of head) {
    const k = tok.toLowerCase()
    if (SHAPE_KEYWORDS.has(k)) { shape = k; continue }
    if (SIZE_KEYWORDS.has(k)) { sizeKeyword = k; continue }
    if (looksNumeric(tok)) {
      const d = parseDim(tok)
      if (d) dims.push(d)
      else notes.push(`unsupported-value:${tok}`)
      continue
    }
    notes.push(`unknown-radial-token:${tok}`)
  }
  return { shape, sizeKeyword, dims, at }
}

const HUE_METHODS = new Set(['shorter', 'longer', 'increasing', 'decreasing'])

/**
 * Remove `in <colorspace> [<hue> hue]` from a prelude. The gradient is still
 * interpolated in sRGB — matching a non-sRGB ramp would need the whole stop list
 * resampled through that space, which is a different job — but the DIRECTION has
 * to survive: dropping the prelude wholesale would turn `45deg in oklab` into the
 * default `to bottom`, a geometry error on top of a colour one.
 */
function stripInterpolationMethod (tokens, notes) {
  const at = tokens.findIndex((t) => t.toLowerCase() === 'in')
  if (at === -1) return null
  let end = at + 1
  const space = tokens[end] || ''
  if (space) end++
  if (HUE_METHODS.has((tokens[end] || '').toLowerCase())) {
    end++
    if ((tokens[end] || '').toLowerCase() === 'hue') end++
  }
  notes.push(`interpolation-space-ignored:${space || '?'}`)
  return tokens.slice(0, at).concat(tokens.slice(end))
}

/** A first argument is a prelude only when it cannot be a colour stop. */
function isRadialPrelude (part) {
  const tokens = splitTop(part, ' ')
  if (tokens.length === 0) return false
  for (const t of tokens) {
    const k = t.toLowerCase()
    if (k === 'at' || SHAPE_KEYWORDS.has(k) || SIZE_KEYWORDS.has(k)) return true
  }
  return tokens.length <= 2 && tokens.every(looksNumeric)
}

// ————————————————————————————————————————————————————————————————
// Entry point
// ————————————————————————————————————————————————————————————————

/**
 * @typedef {Object} GradientStop
 * @property {number} t       0..1 along the gradient's own parameter
 * @property {number[]} color [r,g,b,a] floats 0..1, sRGB
 * @property {string} srcCss  round-trip form
 */

/**
 * @typedef {Object} Paint
 * @property {'linear'|'radial'|'angular'} type
 * @property {Object} unit    canonical geometry in the unit square (see file header)
 * @property {number[]} transform [a,b,c,d,e,f] mapping unit space -> painting box px
 * @property {GradientStop[]} stops  non-decreasing in `t`, all within 0..1
 * @property {string[]} notes every approximation, named
 */

/**
 * Parse one `background-image` layer into an SVD gradient paint.
 *
 * @param {string} css   one background-image layer, e.g. "linear-gradient(...)"
 * @param {{w:number,h:number}} box  the painting box in px
 * @returns {Paint|null}  null when the layer is not a gradient
 */
export function parseGradient (css, box) {
  if (typeof css !== 'string') return null
  const g = matchGradient(css)
  if (!g) return null

  const notes = []
  if (g.prefixed) notes.push('legacy-prefixed-syntax')

  let w = box && Number.isFinite(box.w) ? box.w : 0
  let h = box && Number.isFinite(box.h) ? box.h : 0
  if (!(w > EPS) || !(h > EPS)) {
    notes.push('degenerate-box')
    w = Math.max(w, 1)
    h = Math.max(h, 1)
  }

  const parts = splitTop(g.args, ',')
  if (parts.length === 0) return null
  if (parts.length > 1) {
    const stripped = stripInterpolationMethod(splitTop(parts[0], ' '), notes)
    if (stripped) {
      if (stripped.length === 0) parts.shift()
      else parts[0] = stripped.join(' ')
    }
  }

  // ——— geometry ———
  let type
  let unit
  let transform
  let resolvePos                    // dimension -> t
  let domainHi = 1
  let radial = null
  let consumed = 0

  if (g.kind === 'linear') {
    const tokens = splitTop(parts[0], ' ')
    let angle = null
    if (tokens.length && tokens[0].toLowerCase() === 'to') {
      angle = sideOrCornerAngle(tokens.slice(1), w, h)
      consumed = 1
    } else if (g.prefixed && tokens.length <= 2 &&
      (looksNumeric(tokens[0]) || POS_KEYWORDS.has(tokens[0].toLowerCase()))) {
      angle = legacyLinearAngle(tokens, w, h)
      consumed = 1
    } else if (tokens.length === 1 && looksNumeric(tokens[0])) {
      angle = resolveAngle(parseDim(tokens[0]))
      consumed = 1
    }
    if (consumed && angle === null) {
      notes.push(`unparsed-direction:${parts[0]}`)
      angle = 180
    }
    if (angle === null) angle = 180                                  // `to bottom`
    angle = ((angle % 360) + 360) % 360

    const line = linearLine(angle, w, h)
    type = 'linear'
    unit = { p0: [0, 0], p1: [1, 0], angle }
    const ax = line.p1[0] - line.p0[0]
    const ay = line.p1[1] - line.p0[1]
    // Second basis vector = perpendicular of the first, same length: determinant
    // L² > 0, so the matrix always inverts.
    transform = [ax, ay, -ay, ax, line.p0[0], line.p0[1]]
    resolvePos = (d) => {
      const px = resolveLength(d, line.L)
      return px === null ? null : (line.L > EPS ? px / line.L : 0)
    }
  } else if (g.kind === 'radial') {
    let prelude = { shape: null, sizeKeyword: null, dims: [], at: null }
    if (isRadialPrelude(parts[0])) {
      prelude = radialPrelude(splitTop(parts[0], ' '), w, h, notes)
      consumed = 1
      // `-webkit-radial-gradient(<position>, <shape size>, …)` puts the position
      // first, in its own argument, with no `at`.
      if (g.prefixed && !prelude.at && prelude.dims.length && !prelude.shape && !prelude.sizeKeyword) {
        const pos = parsePosition(splitTop(parts[0], ' '), w, h)
        if (pos && parts.length > 2 && isRadialPrelude(parts[1])) {
          const second = radialPrelude(splitTop(parts[1], ' '), w, h, notes)
          prelude = { ...second, at: pos }
          consumed = 2
        }
      }
    }
    const at = prelude.at || { x: w / 2, y: h / 2 }
    let shape = prelude.shape
    if (!shape) shape = prelude.dims.length === 1 ? 'circle' : 'ellipse'

    let rx
    let ry
    if (prelude.dims.length >= 1) {
      if (prelude.sizeKeyword) notes.push('radial-size-keyword-and-length')
      const dx = resolveLength(prelude.dims[0], w)
      const dy = prelude.dims.length > 1 ? resolveLength(prelude.dims[1], h) : dx
      if (dx === null || dy === null) {
        notes.push('unresolvable-radial-size')
        const s = radialSize('farthest-corner', shape, at.x, at.y, w, h)
        rx = s.rx
        ry = s.ry
      } else {
        rx = Math.abs(dx)
        ry = shape === 'circle' ? Math.abs(dx) : Math.abs(dy)
      }
    } else {
      const s = radialSize(prelude.sizeKeyword || 'farthest-corner', shape, at.x, at.y, w, h)
      rx = s.rx
      ry = s.ry
    }

    if (!(rx > EPS) || !(ry > EPS)) {
      // A zero-size ending shape paints the last stop's colour everywhere. Doing
      // that by shrinking the matrix would hand the backend a singular transform,
      // so the shape is inflated instead and the ramp collapsed further down.
      notes.push('degenerate-shape-solid')
      radial = { at, rx: Math.max(w, h), ry: Math.max(w, h), solid: true }
    } else {
      radial = { at, rx, ry, solid: false }
    }
    type = 'radial'
    unit = { center: [0.5, 0.5], radius: 0.5, shape }
    domainHi = radial.solid ? 1 : radialCornerT(at.x, at.y, radial.rx, radial.ry, w, h)
    resolvePos = (d) => {
      const px = resolveLength(d, radial.rx)
      return px === null ? null : (radial.rx > EPS ? px / radial.rx : 0)
    }
    transform = null                                                 // built after scaling
  } else {
    let from = 0
    let at = null
    if (parts.length > 1) {
      const tokens = splitTop(parts[0], ' ')
      const k0 = tokens[0] ? tokens[0].toLowerCase() : ''
      if (k0 === 'from' || k0 === 'at') {
        consumed = 1
        let i = 0
        if (tokens[0].toLowerCase() === 'from') {
          const a = resolveAngle(parseDim(tokens[1] || ''))
          if (a === null) notes.push(`unparsed-angle:${tokens[1] || ''}`)
          else from = a
          i = 2
        }
        if (tokens[i] && tokens[i].toLowerCase() === 'at') {
          at = parsePosition(tokens.slice(i + 1), w, h)
          if (!at) notes.push('unparsed-position')
        }
      }
    }
    const c = at || { x: w / 2, y: h / 2 }
    // Uniform scale only: a conic gradient's angles are true screen angles, so
    // any anisotropy in the matrix would bend them. The square is sized to cover
    // the box from wherever the centre sits.
    const reach = Math.max(
      Math.hypot(c.x, c.y), Math.hypot(w - c.x, c.y),
      Math.hypot(c.x, h - c.y), Math.hypot(w - c.x, h - c.y)) || Math.max(w, h)
    const d = 2 * reach
    type = 'angular'
    unit = { center: [0.5, 0.5], startAngle: ((from % 360) + 360) % 360 }
    transform = [d, 0, 0, d, c.x - d / 2, c.y - d / 2]
    resolvePos = (dm) => {
      const a = resolveAngle(dm)
      return a === null ? null : a / 360
    }
  }

  // ——— stops ———
  const raw = []
  for (let i = consumed; i < parts.length; i++) {
    for (const e of parseStopPart(parts[i], notes)) raw.push(e)
  }
  for (const e of raw) {
    if (e.d) {
      const t = resolvePos(e.d)
      if (t === null) notes.push('unresolvable-stop-position')
      else e.t = t
    }
  }
  while (raw.length && raw[0].hint) { raw.shift(); notes.push('hint-orphan') }
  while (raw.length && raw[raw.length - 1].hint) { raw.pop(); notes.push('hint-orphan') }
  if (raw.length === 0) {
    notes.push('no-parsable-stops')
    raw.push({ color: [0, 0, 0, 0], srcCss: 'rgba(0, 0, 0, 0)', d: null, t: 0 })
  }

  fixupPositions(raw)
  const fixed = fixTransparentStops(raw, notes)
  let stops = applyHints(fixed, notes)
  if (stops.length === 0) stops = [stop(0, [0, 0, 0, 0])]

  if (g.repeating && stops.length > 1) stops = unrollRepeat(stops, 0, domainHi, notes)
  stops = clampDomain(stops, 0, domainHi)

  // ——— radial: absorb any overshoot into the shape so every `t` lands in 0..1 ———
  if (type === 'radial') {
    if (radial.solid) {
      const c = stops[stops.length - 1].color
      stops = [stop(0, c), stop(1, c)]
    }
    const maxT = stops[stops.length - 1].t
    const s = maxT > 1 + EPS ? maxT : 1
    if (s !== 1) for (const st of stops) st.t /= s
    const rx = radial.rx * s
    const ry = radial.ry * s
    transform = [2 * rx, 0, 0, 2 * ry, radial.at.x - rx, radial.at.y - ry]
  }

  // Unrolling adds `k * period` to every position and the radial overshoot divides
  // them all by `s`; both accumulate float error, so two stops emitted in order can
  // come back 1e-16 apart the WRONG way and fail the schema's monotonicity check.
  // The order is real, the epsilon is not — so the order is what is kept. This runs
  // before `dedupe` so stops that become equal here still collapse.
  let prev = 0
  for (const st of stops) {
    st.t = clamp(st.t, 0, 1)
    if (st.t < prev) st.t = prev
    prev = st.t
  }
  stops = dedupe(stops)

  return { type, unit, transform, stops, notes }
}
