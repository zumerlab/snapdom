/**
 * Box paint: everything an element paints that is neither text nor replaced
 * content — backgrounds, borders, outline, shadows, filters, the overflow clip
 * and the two compositing properties.
 *
 * Two conventions govern the whole file:
 *
 *  1. Geometry is element-local CSS px with the origin at the top-left of the
 *     BORDER box, so it composes with the node's `frame` untouched.
 *  2. CSS paints the FIRST background layer on TOP and `fills` runs
 *     back-to-front, so the layer list comes out REVERSED, with
 *     `background-color` — which is behind every layer — at index 0.
 *
 * Everything this module cannot express exactly leaves a `warnings` entry. The
 * two structural ones are addressed to the caller rather than to the user:
 * per-side border colors and mixed `background-clip` boxes both mean "this is
 * more than one node", and only the caller can split it.
 */
import { parseColor, isTransparent } from '../css/color.js'
import { parseGradient } from '../css/gradient.js'
import { parseShadows } from '../css/shadow.js'
import { parseRadii } from '../css/radius.js'

const GRADIENT = /^(?:-webkit-|-moz-|-o-)?(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/i
const IMAGE_SET = /^(?:-webkit-)?image-set\s*\(/i
/** One nesting level is enough: `drop-shadow(0 1px 2px rgb(0 0 0 / .3))`. */
const FN = /([a-zA-Z-]+)\(((?:[^()]|\([^()]*\))*)\)/g
/**
 * The filter functions that resample colour. CSS Filter Effects §8 defines each
 * of them AS a colour matrix (`invert`, `brightness` and `contrast` as component
 * transfers that are affine per channel, which is the same thing), so they are
 * not approximated here: they are composed, exactly, into the matrices
 * `colorMatrixChain` builds — usually one for the whole chain.
 *
 * `opacity` is left out of this set because the `filter` branch folds it into
 * layer opacity, which is exact and cheaper; it is in `COLOR_MATRIX_FILTERS`,
 * which is what the `backdrop-filter` branch uses — there the alpha belongs to
 * the backdrop and folding it into the node's own opacity would fade the node.
 */
const COLOR_FILTERS = new Set([
  'brightness', 'contrast', 'grayscale', 'hue-rotate', 'invert', 'saturate', 'sepia',
])
const COLOR_MATRIX_FILTERS = new Set([...COLOR_FILTERS, 'opacity'])

/**
 * Native controls the UA paints by itself. `<button>` is deliberately absent: its
 * label is a real text node the collectors read, and its box is ordinary CSS.
 */
const CONTROL_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'PROGRESS', 'METER'])

/** `<input>` types whose painted content is the value (or the placeholder) as text. */
const TEXTUAL_INPUTS = new Set([
  'text', 'email', 'search', 'tel', 'url', 'password', 'number',
  'date', 'datetime-local', 'month', 'week', 'time',
])

const BOX_KEYWORD = {
  'border-box': 'border',
  'padding-box': 'padding',
  'content-box': 'content',
  text: 'text',
}

const px = (v) => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1)

/**
 * Split a computed value at top level, on commas (layer lists) or on whitespace
 * (component lists). Depth-aware so `calc(100% - 10px)` and `rgb(0 0 0 / .5)`
 * survive intact.
 */
function splitTop (value, comma = true) {
  const out = []
  let depth = 0
  let quote = ''
  let buf = ''
  for (const c of String(value)) {
    if (quote) {
      buf += c
      if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") { quote = c; buf += c; continue }
    if (c === '(') depth++
    else if (c === ')') depth--
    if (depth === 0 && (comma ? c === ',' : /\s/.test(c))) {
      if (comma || buf.trim()) out.push(buf.trim())
      buf = ''
      continue
    }
    buf += c
  }
  if (comma || buf.trim()) out.push(buf.trim())
  return out
}

/**
 * Background component lists are shorter than the layer list whenever the author
 * wrote fewer values; CSS repeats them cyclically.
 */
const at = (list, i) => list[i % list.length]

/**
 * A `<length-percentage>` as `{len, pct}`, kept unresolved because a percentage
 * in `background-position` resolves against `area - image`, which is not known
 * until the image is.
 *
 * Chromium serialises the 3- and 4-value position forms as `calc(100% - 10px)`,
 * so the simple calc sums have to be understood here. No `new Function`: the
 * grammar accepted is a whitespace-separated sum of `<number><px|%>` terms,
 * which is exactly what those serialisations contain.
 */
function parseLenPct (value, warnings, what) {
  let expr = String(value).trim()
  const calc = /^(?:-webkit-)?calc\((.*)\)$/is.exec(expr)
  if (calc) expr = calc[1].trim()
  // `a - b` becomes `a + -b`; in calc the operators are always space-delimited,
  // so this cannot touch the sign of a term.
  const terms = expr.replace(/\s+-\s+/g, ' + -').split(/\s+\+\s+/)
  let len = 0
  let pct = 0
  for (const term of terms) {
    const m = /^([+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?)(px|%)?$/i.exec(term.trim())
    if (!m) {
      warnings.push(`${what}: could not read "${value}"; treated as 0.`)
      return { len: 0, pct: 0 }
    }
    const n = parseFloat(m[1])
    if (m[2] === '%') pct += n / 100
    else len += n
  }
  return { len, pct }
}

/** `background-size` for one layer, left unresolved (`auto` needs the intrinsic size). */
function parseBgSize (value, warnings) {
  const v = String(value).trim().toLowerCase()
  if (v === 'cover' || v === 'contain') return { kind: v }
  const parts = splitTop(value, false)
  const axis = (token) => (
    token === undefined || token.toLowerCase() === 'auto'
      ? 'auto'
      : parseLenPct(token, warnings, 'background-size')
  )
  return { kind: 'explicit', x: axis(parts[0]), y: axis(parts[1]) }
}

/** `background-position` for one layer: two `{len, pct}` pairs. */
function parseBgPosition (value, warnings) {
  const parts = splitTop(value, false)
  const named = { left: '0%', top: '0%', center: '50%', right: '100%', bottom: '100%' }
  const axis = (token, fallback) => {
    if (token === undefined) return parseLenPct(fallback, warnings, 'background-position')
    const key = token.toLowerCase()
    return parseLenPct(named[key] !== undefined ? named[key] : token, warnings, 'background-position')
  }
  if (parts.length > 2) {
    // The 3/4-value form only reaches here if the engine did not fold it into
    // calc(); the edge keyword is then lost rather than mis-applied.
    warnings.push(`background-position: the multi-value form "${value}" is approximated by its first two components.`)
  }
  return { x: axis(parts[0], '0%'), y: axis(parts[1], parts.length === 1 ? '50%' : '0%') }
}

/** `background-repeat` for one layer, normalised to per-axis values. */
function parseBgRepeat (value, warnings) {
  const parts = splitTop(value, false).map((s) => s.toLowerCase())
  let x = parts[0] || 'repeat'
  let y = parts[1] || parts[0] || 'repeat'
  if (x === 'repeat-x') { x = 'repeat'; y = 'no-repeat' }
  else if (x === 'repeat-y') { x = 'no-repeat'; y = 'repeat' }
  for (const v of [x, y]) {
    if (v === 'round' || v === 'space') {
      warnings.push(`background-repeat: "${v}" is approximated by "repeat"; the tile is neither rescaled nor gapped.`)
    }
  }
  const norm = (v) => (v === 'round' || v === 'space' ? 'repeat' : v)
  return { x: norm(x), y: norm(y) }
}

/**
 * The functions of a `filter` / `backdrop-filter` chain, in source order, each
 * with the text that produced it.
 *
 * The name alone is not a diagnostic. "filter resamples color (saturate)" does
 * not tell a reader whether the panel lost a 5% tint or a 180% one, and the
 * glassmorphism fixture loses exactly `saturate(1.8)` — the number is the whole
 * message.
 *
 * @param {string} css
 * @returns {Array<{name:string, arg:string, css:string}>}
 */
function readFilterFunctions (css) {
  const out = []
  FN.lastIndex = 0
  let m
  while ((m = FN.exec(css)) !== null) {
    const arg = m[2].trim()
    out.push({ name: m[1].toLowerCase(), arg, css: `${m[1]}(${arg})` })
  }
  return out
}

/** The first of the two spellings that is set, or `'none'`. */
function pickFilter (standard, prefixed) {
  if (standard && standard !== 'none') return standard
  if (prefixed && prefixed !== 'none') return prefixed
  return 'none'
}

const listOf = (fns) => fns.map((f) => f.css).join(', ')

// ——— colour matrices (CSS Filter Effects §8) ———
//
// Each colour filter function has its matrix written out in the spec, so a chain
// of them is a product of matrices and nothing is lost by composing it. The
// arithmetic runs in the 5x5 homogeneous form — four rows of coefficients plus
// the constant column, and a fifth row `[0,0,0,0,1]` that only exists so the
// product is defined — and the last row is dropped on the way out, because
// `feColorMatrix type="matrix"` wants the 4x5.
//
// The matrices act on NON-PREMULTIPLIED sRGB in 0..1, which is what §8 assumes
// and what `feColorMatrix` does with `color-interpolation-filters="sRGB"`. The
// unit matters: the same numbers applied in linearRGB are a different colour.

const IDENTITY5 = [
  [1, 0, 0, 0, 0],
  [0, 1, 0, 0, 0],
  [0, 0, 1, 0, 0],
  [0, 0, 0, 1, 0],
  [0, 0, 0, 0, 1],
]

/** `after` applied to the result of `before`: the product `after · before`. */
function mul5 (after, before) {
  const out = []
  for (let i = 0; i < 5; i++) {
    const row = []
    for (let j = 0; j < 5; j++) {
      let sum = 0
      for (let k = 0; k < 5; k++) sum += after[i][k] * before[k][j]
      row.push(sum)
    }
    out.push(row)
  }
  return out
}

/**
 * Coefficients are quantised to 1e-6 so a composed chain does not ship
 * `0.21299999999999997`. One part in a million of a channel is 1/4000 of an
 * 8-bit level: below anything representable, let alone visible.
 */
const q6 = (n) => Math.round(n * 1e6) / 1e6

/**
 * The `<number-percentage>` argument of a colour filter, clamped to the range
 * §8 gives that function, with the spec's default when the argument is omitted
 * (`grayscale()` means `grayscale(1)`).
 *
 * Null when the argument is not a number at all. A matrix built on a misread
 * argument is worse than no matrix: it would be wrong content, declared exact.
 */
function filterAmount (arg, def, min, max) {
  const s = String(arg).trim()
  if (!s) return def
  const m = /^([+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?)(%?)$/i.exec(s)
  if (!m) return null
  let n = parseFloat(m[1])
  if (m[2]) n /= 100
  if (!Number.isFinite(n)) return null
  return Math.min(max, Math.max(min, n))
}

const ANGLE_TO_DEG = { deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 }

/** The `<angle>` argument of `hue-rotate`, in degrees. Null when unreadable. */
function filterAngle (arg) {
  const s = String(arg).trim()
  if (!s) return 0
  const m = /^([+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?)(deg|grad|rad|turn)?$/i.exec(s)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  // A unitless argument is only legal as zero, and zero is zero in every unit.
  return n * (m[2] ? ANGLE_TO_DEG[m[2].toLowerCase()] : 1)
}

/** `feColorMatrix type="saturate"`, §8.5. `grayscale(a)` is this at `1 - a`. */
function saturateMatrix (s) {
  return [
    [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0, 0],
    [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0, 0],
    [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0, 0],
    [0, 0, 0, 1, 0],
    [0, 0, 0, 0, 1],
  ]
}

/** `feColorMatrix type="hueRotate"`, §8.6. */
function hueRotateMatrix (deg) {
  const c = Math.cos((deg * Math.PI) / 180)
  const s = Math.sin((deg * Math.PI) / 180)
  return [
    [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0, 0],
    [0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283, 0, 0],
    [0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072, 0, 0],
    [0, 0, 0, 1, 0],
    [0, 0, 0, 0, 1],
  ]
}

/** `sepia(amount)`, §8.4. `t` is how much of the original survives. */
function sepiaMatrix (a) {
  const t = 1 - a
  return [
    [0.393 + 0.607 * t, 0.769 - 0.769 * t, 0.189 - 0.189 * t, 0, 0],
    [0.349 - 0.349 * t, 0.686 + 0.314 * t, 0.168 - 0.168 * t, 0, 0],
    [0.272 - 0.272 * t, 0.534 - 0.534 * t, 0.131 + 0.869 * t, 0, 0],
    [0, 0, 0, 1, 0],
    [0, 0, 0, 0, 1],
  ]
}

/**
 * The same affine ramp on each of R, G and B, alpha untouched. This is what the
 * spec's `feComponentTransfer type="linear"` comes to for `invert`, `brightness`
 * and `contrast`, all three of which are `slope * c + intercept`.
 */
function channelMatrix (slope, intercept) {
  return [
    [slope, 0, 0, 0, intercept],
    [0, slope, 0, 0, intercept],
    [0, 0, slope, 0, intercept],
    [0, 0, 0, 1, 0],
    [0, 0, 0, 0, 1],
  ]
}

/** `opacity(amount)`, §8.8: alpha alone, colours untouched. */
function alphaMatrix (o) {
  return [
    [1, 0, 0, 0, 0],
    [0, 1, 0, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 0, o, 0],
    [0, 0, 0, 0, 1],
  ]
}

/**
 * The 5x5 for ONE colour-filter function, plus whether that function can only
 * produce values inside 0..1 when its input is inside 0..1. Null when the
 * argument cannot be read or the function is not one of §8's colour filters.
 *
 * `closed` is what decides how far a chain may be composed, and it is not a
 * detail — see `colorMatrixChain`. `grayscale` and `saturate` at or below 1 have
 * non-negative rows that sum to exactly 1, so they are convex mixes of the
 * channels; `invert`, and `brightness`/`contrast` at or below 1, are monotone
 * affine ramps whose endpoints land inside the range. Everything else can leave
 * it: `saturate(2)` overshoots, `sepia` sums to more than 1, and `hue-rotate`
 * has negative coefficients at every angle that is not a whole turn.
 *
 * @param {{name:string, arg:string}} fn
 * @returns {{m:number[][], closed:boolean}|null}
 */
function colorFilterMatrix (fn) {
  const { name, arg } = fn
  if (name === 'saturate') {
    const s = filterAmount(arg, 1, 0, Infinity)
    return s === null ? null : { m: saturateMatrix(s), closed: s <= 1 }
  }
  if (name === 'grayscale') {
    const a = filterAmount(arg, 1, 0, 1)
    return a === null ? null : { m: saturateMatrix(1 - a), closed: true }
  }
  if (name === 'sepia') {
    // Not range-preserving, though it looks it: the first row of §8.4's matrix
    // sums to 1.351, so white comes out at 1.351 and the primitive clamps it.
    // Only `sepia(0)`, which is the identity, is closed.
    const a = filterAmount(arg, 1, 0, 1)
    return a === null ? null : { m: sepiaMatrix(a), closed: a === 0 }
  }
  if (name === 'hue-rotate') {
    const d = filterAngle(arg)
    return d === null ? null : { m: hueRotateMatrix(d), closed: ((d % 360) + 360) % 360 === 0 }
  }
  if (name === 'invert') {
    // tableValues="a 1-a" is the ramp `c -> a + (1 - 2a)c`.
    const a = filterAmount(arg, 1, 0, 1)
    return a === null ? null : { m: channelMatrix(1 - 2 * a, a), closed: true }
  }
  if (name === 'brightness') {
    const b = filterAmount(arg, 1, 0, Infinity)
    return b === null ? null : { m: channelMatrix(b, 0), closed: b <= 1 }
  }
  if (name === 'contrast') {
    const c = filterAmount(arg, 1, 0, Infinity)
    return c === null ? null : { m: channelMatrix(c, 0.5 - 0.5 * c), closed: c <= 1 }
  }
  if (name === 'opacity') {
    const o = filterAmount(arg, 1, 0, 1)
    return o === null ? null : { m: alphaMatrix(o), closed: true }
  }
  return null
}

const matrixCount = (steps) => (steps.length === 1 ? 'one colour matrix' : `${steps.length} colour matrices`)

/**
 * Why a chain came out as more than one matrix. A reader who sees four
 * primitives where the CSS had four functions should not have to guess whether
 * the engine failed to compose them or refused to.
 */
const matrixSplit = (steps) => (steps.length < 2
  ? ''
  : 'They stay separate because a filter chain clamps to 0..1 between functions, and composing ' +
    'across a function that leaves that range would move colours by up to 29/255 (measured against ' +
    'Chromium); each of these is exact on its own. ')

/**
 * A run of colour-filter functions, composed into as few matrices as can be
 * composed EXACTLY. CSS applies a chain left to right, so the last function is
 * the outermost and each product runs right to left — `Mn · … · M1`.
 *
 * **A chain does not compose into one matrix in general, and this was measured,
 * not reasoned about.** A filter chain clamps to 0..1 between functions — each
 * function is a filter primitive and a primitive's result is clamped — so
 * whenever a function can push a channel out of range, the next one sees the
 * CLAMPED value and the product of the two matrices does not. Rendering the
 * composed matrix as `feColorMatrix` against Chromium's own chain, 141 of 147
 * colour × chain pairs matched to the byte and 6 did not, by up to **29/255**:
 * `hue-rotate(45deg) saturate(2) invert(0.1)` on pure red came out 235,49,0
 * instead of 227,41,26. Those six are exactly the ones with a clamping function
 * in a non-final position.
 *
 * So a run is closed after any function that can leave the range (`closed:
 * false` above), and the next matrix starts from the clamped value the way CSS
 * does. Everything else composes: the common chain — one colour function, or
 * several convex ones — still comes out as a single exact matrix, which is the
 * whole gain. Splitting costs one more effect in the chain and buys back the
 * 29/255.
 *
 * @param {Array<{name:string, arg:string, css:string}>} fns  colour filters only
 * @returns {{steps:Array<{values:number[], srcCss:string, used:Array}>,
 *            used:Array, unreadable:Array}}
 */
function colorMatrixChain (fns) {
  const steps = []
  const used = []
  const unreadable = []
  let m = IDENTITY5
  let run = []
  const close = () => {
    if (!run.length) return
    const values = []
    for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) values.push(q6(m[i][j]))
    steps.push({ values, srcCss: run.map((f) => f.css).join(' '), used: run })
    m = IDENTITY5
    run = []
  }
  for (const fn of fns) {
    const step = colorFilterMatrix(fn)
    if (!step) {
      unreadable.push(fn)
      continue
    }
    m = mul5(step.m, m)
    run.push(fn)
    used.push(fn)
    if (!step.closed) close()
  }
  close()
  return { steps, used, unreadable }
}

/** The single URL inside a `url()` or the first candidate of an `image-set()`. */
function readUrl (layer) {
  const m = /url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)\s]*))\s*\)/.exec(layer)
  if (!m) return null
  const raw = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]
  return raw.replace(/\\(.)/g, '$1')
}

/**
 * CSS Images §5.3 default sizing, reduced to the cases a background can be in.
 * `intrinsic` is null for gradients — no intrinsic size and no intrinsic ratio —
 * which collapses every branch to the positioning area, as the spec requires.
 *
 * @param {object} sizing   from `parseBgSize`
 * @param {{w:number,h:number}} area
 * @param {{w:number,h:number}|null} intrinsic
 * @returns {{w:number,h:number}}
 */
function computeSize (sizing, area, intrinsic) {
  const has = !!(intrinsic && intrinsic.w > 0 && intrinsic.h > 0)
  if (sizing.kind === 'cover' || sizing.kind === 'contain') {
    if (!has) return { w: area.w, h: area.h }
    const sx = area.w / intrinsic.w
    const sy = area.h / intrinsic.h
    const s = sizing.kind === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy)
    return { w: intrinsic.w * s, h: intrinsic.h * s }
  }
  const ratio = has ? intrinsic.w / intrinsic.h : 0
  const x = sizing.x === 'auto' ? null : sizing.x.len + sizing.x.pct * area.w
  const y = sizing.y === 'auto' ? null : sizing.y.len + sizing.y.pct * area.h
  if (x !== null && y !== null) return { w: x, h: y }
  if (x !== null) return { w: x, h: ratio ? x / ratio : area.h }
  if (y !== null) return { w: ratio ? y * ratio : area.w, h: y }
  if (has) return { w: intrinsic.w, h: intrinsic.h }
  return { w: area.w, h: area.h }
}

/**
 * Where the first tile of a background layer lands, in element-local px.
 *
 * Exported because a `url()` layer cannot be placed until its asset has loaded:
 * `collectBox` emits the placement with `rect: null` and the orchestrator calls
 * this once it knows the intrinsic size, instead of re-deriving the arithmetic.
 * The percentage rule is the one everybody gets wrong — `position: X%` puts X%
 * of the IMAGE over X% of the AREA, i.e. `(area - image) * X`, not `area * X`.
 *
 * @param {object} placement   the `placement` of an image or gradient fill
 * @param {{w:number,h:number}|null} [intrinsic]
 * @returns {{x:number,y:number,w:number,h:number}}
 */
export function resolveLayerRect (placement, intrinsic = null) {
  const { area, sizing, position } = placement
  const size = computeSize(sizing, area, intrinsic)
  return {
    x: area.x + position.x.len + position.x.pct * (area.w - size.w),
    y: area.y + position.y.len + position.y.pct * (area.h - size.h),
    w: size.w,
    h: size.h,
  }
}

/** The border box in element-local px, preferring measurements a transform cannot skew. */
function borderBoxSize (el, cs, warnings) {
  const bw = px(cs.borderLeftWidth) + px(cs.borderRightWidth)
  const bh = px(cs.borderTopWidth) + px(cs.borderBottomWidth)
  const pw = px(cs.paddingLeft) + px(cs.paddingRight)
  const ph = px(cs.paddingTop) + px(cs.paddingBottom)
  // The resolved value of `width` is fractional and transform-free — the best
  // source there is. It is `auto` only for inline boxes and detached /
  // `display:none` subtrees.
  //
  // What it MEASURES, though, follows `box-sizing`: Chromium (and every engine
  // that resolves `width` against the used box) reports the CONTENT width under
  // `content-box` and the BORDER width under `border-box`. Adding the padding
  // and borders unconditionally inflated every `box-sizing:border-box` element
  // by exactly its own border+padding — and since `*{box-sizing:border-box}` is
  // the modern default, that was most of them. The damage is invisible on a flat
  // fill (the backend paints the node's own frame) and glaring on anything
  // positioned against the box: `.pcard-ring` (96px border-box, 10px border) got
  // a 116px border box, so its conic's padding-box positioning area came out
  // 96×96 at (10,10) instead of 76×76, moving the sweep's centre 10px down-right
  // of where the browser paints it. Percentage radii were scaled by the same
  // error.
  if (/px$/.test(cs.width) && /px$/.test(cs.height)) {
    const content = cs.boxSizing !== 'border-box'
    return {
      w: parseFloat(cs.width) + (content ? pw + bw : 0),
      h: parseFloat(cs.height) + (content ? ph + bh : 0),
    }
  }
  const transformed = cs.transform !== 'none' ||
    (cs.rotate || 'none') !== 'none' || (cs.scale || 'none') !== 'none'
  if (!transformed && typeof el.getBoundingClientRect === 'function') {
    const r = el.getBoundingClientRect()
    if (r.width || r.height) return { w: r.width, h: r.height }
  }
  if (el.offsetWidth || el.offsetHeight) {
    warnings.push('box size read from offsetWidth/offsetHeight; it is rounded to whole px.')
    return { w: el.offsetWidth, h: el.offsetHeight }
  }
  const r = typeof el.getBoundingClientRect === 'function'
    ? el.getBoundingClientRect()
    : { width: 0, height: 0 }
  warnings.push('box size could not be measured without the element transform; the painted box may be scaled.')
  return { w: r.width, h: r.height }
}

/** Radii of a box inset from the border box by `[t, r, b, l]`, per CSS Backgrounds §5.4. */
function insetRadii (radii, [t, r, b, l]) {
  const [tl, tr, br, bl] = radii
  return [
    [Math.max(0, tl[0] - l), Math.max(0, tl[1] - t)],
    [Math.max(0, tr[0] - r), Math.max(0, tr[1] - t)],
    [Math.max(0, br[0] - r), Math.max(0, br[1] - b)],
    [Math.max(0, bl[0] - l), Math.max(0, bl[1] - b)],
  ]
}

/** An outline follows the border radius grown by its offset, but a square corner stays square. */
function expandRadii (radii, d) {
  return radii.map(([rx, ry]) => [rx > 0 ? Math.max(0, rx + d) : 0, ry > 0 ? Math.max(0, ry + d) : 0])
}

/**
 * @typedef {object} CollectCtx  built by `../index.js`; nothing here is required.
 * @property {'design'|'replica'} [mode]
 */

/**
 * @param {Element} el
 * @param {CSSStyleDeclaration} cs   already-computed style for `el`
 * @param {CollectCtx} ctx
 * @returns {{fills:Paint[], strokes:Stroke[], effects:Effect[], textEffects:Effect[],
 *            clip:Clip|null, mask:object|null, radii, opacity:number, blend:string,
 *            warnings:Array<string|{code:string,grade:string,severity:string,message:string}>}}
 *   `textEffects`: `text-shadow` paints the glyphs of this block, so it cannot
 *   ride in `effects` (which filters the box) and the caller must hand it to the
 *   block's text node. `mask`: the collected `mask-image` layers, ready for a
 *   caller to turn into the mask node `node.mask` references. Both are inert
 *   until such a caller exists, and both say so in `warnings`.
 */
export function collectBox (el, cs, ctx = {}) {
  const warnings = []

  const { w, h } = borderBoxSize(el, cs, warnings)
  const border = [
    px(cs.borderTopWidth), px(cs.borderRightWidth),
    px(cs.borderBottomWidth), px(cs.borderLeftWidth),
  ]
  const padding = [
    px(cs.paddingTop), px(cs.paddingRight),
    px(cs.paddingBottom), px(cs.paddingLeft),
  ]
  const boxes = {
    border: { x: 0, y: 0, w, h },
    padding: {
      x: border[3], y: border[0],
      w: Math.max(0, w - border[1] - border[3]),
      h: Math.max(0, h - border[0] - border[2]),
    },
    content: {
      x: border[3] + padding[3], y: border[0] + padding[0],
      w: Math.max(0, w - border[1] - border[3] - padding[1] - padding[3]),
      h: Math.max(0, h - border[0] - border[2] - padding[0] - padding[2]),
    },
  }
  // `text` has no box of its own; the layer is placed on the border box and the
  // caller is told it still owes a text mask.
  boxes.text = boxes.border

  const radii = parseRadii(cs, w, h)

  if (/^inline($|-)/.test(cs.display) && cs.display !== 'inline-block' &&
      typeof el.getClientRects === 'function' && el.getClientRects().length > 1) {
    warnings.push('inline box spans several line fragments; its paint is collapsed onto one rectangle.')
  }

  // `visibility` is inherited but revocable, so the node has to survive — a
  // `visibility:visible` descendant still paints inside it — while its own paint
  // must not. `collect/text.js` already does this for the glyphs; without the
  // equivalent here a `visibility:hidden` tooltip with a background and an
  // `overflow:hidden` of its own was emitted as a solid bubble painted OVER the
  // page. That is a degradation of inverted polarity: something appears that
  // does not exist, which is worse than losing something that does.
  const painted = (cs.visibility || 'visible') === 'visible'

  const fills = painted ? collectFills(el, cs, boxes, warnings) : []
  const { strokes, strokeWarnings } = painted
    ? collectStrokes(cs, radii, border, el)
    : { strokes: [], strokeWarnings: [] }
  warnings.push(...strokeWarnings)
  const { effects, filterOpacity } = painted
    ? collectEffects(cs, warnings)
    : { effects: [], filterOpacity: 1 }
  const textEffects = painted ? collectTextShadow(el, cs, warnings) : []
  // The clip still applies: `visibility` hides this box, not its descendants.
  const clip = collectClip(cs, radii, border, warnings)

  if (!painted) {
    warnings.push(
      `visibility:${cs.visibility} — the page paints nothing here, so this box carries no ` +
      'background, border, outline or effect; the node stays as the container of descendants ' +
      'that may set visibility:visible.'
    )
  }

  let opacity = clamp01(parseFloat(cs.opacity)) * filterOpacity
  if (!Number.isFinite(opacity)) opacity = 1

  const clipPath = pickFilter(cs.clipPath, cs.webkitClipPath)
  const clipShape = clipPath === 'none' ? null : parseClipPath(clipPath, boxes, radii, warnings)
  if (clipPath !== 'none' && !clipShape) {
    warnings.push({
      code: 'collect.box.clip-path-not-applied',
      grade: 'O',
      severity: 'warn',
      message: `clip-path "${clipPath}" is not a basic shape this collector can resolve (it reads ` +
        'polygon(), inset(), rect(), circle() and ellipse() against the reference box); the box is ' +
        'emitted unclipped, at its full rectangle.',
    })
  }

  // `mask-image` used to leave one line of prose and nothing else, so the box
  // came out rectangular with the same words `clip-path` gets and none of the
  // data. The layers are collected now — they are a background painted into an
  // alpha channel and cost the same to read — and the warning says both that the
  // mask is not applied AND that it is sitting there ready.
  const mask = collectMask(cs, boxes, radii, border, padding, warnings)
  // The layers are returned on `mask` in the shape the schema's mask REFERENCE
  // needs a node for; `index.js` (`wireMasks`) builds that node and files
  // `collect.box.mask-applied` when it does. Only the case this collector cannot
  // hand over is a degradation, and only that case is reported here — a warning
  // that fires when nothing was lost is how a diagnostics table stops being read.
  if (mask && !mask.layers.length) {
    warnings.push({
      code: 'collect.box.mask-not-applied',
      grade: 'O',
      severity: 'warn',
      message: `mask-image "${mask.srcCss}" is not applied and the box is emitted unmasked: none of its ` +
        'layers could be collected, so there is nothing for a caller to apply either.',
    })
  }

  const control = painted ? describeControl(el, cs) : null
  if (control && (control.chrome.length || control.content.length)) {
    // Always, and always with the type. What this box carries is the CSS half of a
    // native control — box, background, border, radii — and nothing the UA drew
    // inside it. The other half now travels as SEMANTICS on `node.control`
    // (`paint.js`, `describeWidget`), so whether the reader sees a widget depends on
    // the backend: `emit/svg-flat.js` reconstructs the chrome from it at Chromium's
    // measured proportions (`emit.svg.control-reconstructed`), Figma and PDF ignore
    // it and the control arrives as an empty box. Saying "this engine has no
    // primitive for that" was true until the widgets landed and is now the kind of
    // stale warning that teaches a reader to ignore warnings.
    warnings.push({
      code: 'collect.box.form-control',
      grade: 'O',
      severity: 'warn',
      message: `${control.label} is a native control: the UA paints ` +
        [...control.content, ...control.chrome].join(' and ') +
        ', and no CSS property in the cascade describes any of it. This box carries only the ' +
        'CSS half — background, border, radii. The state that would let a backend redraw the rest ' +
        '(type, checked/value, accent-color) travels on `node.control`; the SVG backend uses it, ' +
        'the Figma and PDF backends do not, so there the control is an empty box. The text of the ' +
        'control — its value, its placeholder, its chosen option — is not redrawn anywhere.',
    })
  }

  if (painted && cs.borderImageSource && cs.borderImageSource !== 'none') {
    warnings.push('border-image is not represented; only the border color/width fallback is emitted.')
  }
  return {
    fills,
    strokes,
    effects,
    // The glyph shadows of this block, kept apart from `effects` on purpose: an
    // effect on the box node filters the background too. The caller owns the
    // text node and is the only one that can attach them.
    textEffects,
    clip,
    // `clip-path` as resolved geometry in node-local px, or null when the shape
    // is one this collector cannot read (in which case `warnings` says so). It is
    // NOT `clip`: the overflow clip applies to descendants, this one also cuts
    // the element's own background, border and shadow silhouette.
    clipShape,
    // The collected `mask-image`, in the shape a caller needs to build the mask
    // node the SVD references. Inert until one does — like `textEffects`.
    mask,
    radii,
    opacity,
    blend: cs.mixBlendMode || 'normal',
    warnings,
  }
}

/** Whether the element itself carries characters, rather than inheriting a text property. */
function hasOwnText (el) {
  const kids = el && el.childNodes
  if (!kids || !kids.length) return false
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i]
    if (n.nodeType !== 3) continue
    const value = n.nodeValue || ''
    // NBSP is whitespace to `\s` and a painted glyph to the renderer.
    if (/\S/.test(value) || value.indexOf('\u00a0') !== -1) return true
  }
  return false
}

/**
 * `text-shadow`, which nobody was reading at all: `collect/text.js` never looks
 * at it and both calls in this file were `box-shadow` and `filter`, so a shadowed
 * heading exported with `effects: []` and no diagnostic.
 *
 * It is NOT pushed into `effects`: that array is the box's own, and a drop shadow
 * there follows the background silhouette instead of the letters. It travels on
 * `textEffects` for whoever builds the text node, and until that caller exists the
 * warning below is what keeps the loss visible.
 *
 * `text-shadow` is inherited, so only the element that actually holds characters
 * is asked — otherwise every wrapper in the subtree would report its ancestor's
 * shadow. An element whose text became its own `text` node (no box paint at all)
 * never reaches `collectBox`; that half belongs to `collect/text.js`.
 */
function collectTextShadow (el, cs, warnings) {
  const css = cs.textShadow
  if (!css || css === 'none') return []
  if (!hasOwnText(el)) return []

  const { shadows, warnings: shadowWarnings } = parseShadows(css, { inset: false, currentColor: cs.color })
  for (const message of shadowWarnings) warnings.push(`text-shadow: ${message}`)
  if (!shadows.length) {
    warnings.push(`text-shadow "${css}" could not be parsed; it is dropped.`)
    return []
  }
  warnings.push(
    `text-shadow "${css}" paints the glyphs, not this box; it is collected on \`textEffects\` ` +
    'for the text node, and no backend emits it yet.'
  )
  return shadows.map((s) => ({ ...s, source: 'text-shadow' }))
}

/** A user string quoted into a diagnostic, short enough to read in a table. */
function quoteValue (value) {
  const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  return s.length > 48 ? `"${s.slice(0, 47)}…"` : `"${s}"`
}

/**
 * What a native control paints that no CSS declares and no collector here reads.
 *
 * Every branch names the control's TYPE, because "a form control lost its
 * internals" is not actionable and "`<input type="range">` lost its track and
 * thumb at 62 of 0..100" is. The two halves are kept apart on purpose:
 *
 *  - `chrome` is the UA widget — the tick, the dot, the chevron, the track. It
 *    exists only while `appearance` is not `none`; an author who set
 *    `appearance:none` painted the whole thing in CSS and nothing is missing.
 *  - `content` is the value, the placeholder, the selected label. The UA paints
 *    it whatever `appearance` says, and it is lost either way.
 *
 * @param {Element} el
 * @param {CSSStyleDeclaration} cs
 * @returns {{label:string, chrome:string[], content:string[]}|null}
 */
function describeControl (el, cs) {
  const tag = (el.tagName || '').toUpperCase()
  if (!CONTROL_TAGS.has(tag)) return null

  const chrome = []
  const content = []
  const accent = cs.accentColor && cs.accentColor !== 'auto' ? `, accent-color ${cs.accentColor}` : ''
  const value = typeof el.value === 'string' ? el.value : ''
  let label = `<${tag.toLowerCase()}>`

  if (tag === 'INPUT') {
    // `el.type` normalises an unknown or missing attribute to `text`, which is
    // what the UA actually painted; the attribute is only the fallback.
    const type = String(el.type ||
      (typeof el.getAttribute === 'function' && el.getAttribute('type')) || 'text').toLowerCase()
    label = `<input type="${type}">`
    // `type=image` is replaced content; `collect/image.js` owns it and says so.
    if (type === 'image' || type === 'hidden') return null
    if (type === 'checkbox' || type === 'radio') {
      chrome.push(`the ${type === 'radio' ? 'radio dot' : 'checkmark'} and its ` +
        `${el.checked ? 'CHECKED' : 'unchecked'} box${accent}`)
    } else if (type === 'range') {
      chrome.push(`the track and the thumb (value ${quoteValue(value)} of ` +
        `${el.min || 0}..${el.max || 100}${accent})`)
    } else if (type === 'file') {
      chrome.push('the "Choose file" button and the chosen-file label')
    } else if (type === 'color') {
      content.push(`the colour swatch ${quoteValue(value)}`)
    } else if (type === 'submit' || type === 'reset' || type === 'button') {
      content.push(`the button label ${quoteValue(value || type)}`)
    } else if (TEXTUAL_INPUTS.has(type)) {
      if (value) content.push(`the value ${quoteValue(value)}`)
      else if (el.placeholder) content.push(`the placeholder ${quoteValue(el.placeholder)}`)
      if (type === 'number') chrome.push('the spinner arrows')
      if (type.startsWith('date') || type === 'month' || type === 'week' || type === 'time') {
        chrome.push('the date/time segments and the picker button')
      }
    } else if (value) {
      content.push(`the value ${quoteValue(value)}`)
    }
  } else if (tag === 'TEXTAREA') {
    if (value) content.push(`the value ${quoteValue(value)}`)
    else if (el.placeholder) content.push(`the placeholder ${quoteValue(el.placeholder)}`)
    chrome.push('the resize grip')
  } else if (tag === 'SELECT') {
    const options = el.selectedOptions || []
    const chosen = options.length ? [...options].map((o) => o.label || o.text || o.value).join(', ') : value
    content.push(`the selected option ${quoteValue(chosen)}`)
    chrome.push(el.multiple ? 'the option list' : 'the drop-down chevron')
  } else {
    // <progress> and <meter>: the bar IS the control, and it is all UA paint.
    const max = el.max != null ? el.max : 1
    chrome.push(`the track and the filled bar (value ${quoteValue(value || el.value)} of ` +
      `0..${max}${accent})`)
  }

  const styled = (cs.appearance || cs.webkitAppearance || 'auto') === 'none'
  return { label, chrome: styled ? [] : chrome, content }
}

/** Background color plus the image layers, back-to-front. */
function collectFills (el, cs, boxes, warnings) {
  const fills = []

  const layers = cs.backgroundImage && cs.backgroundImage !== 'none'
    ? splitTop(cs.backgroundImage)
    : []
  const sizes = splitTop(cs.backgroundSize || 'auto')
  const positions = splitTop(cs.backgroundPosition || '0% 0%')
  const repeats = splitTop(cs.backgroundRepeat || 'repeat')
  const origins = splitTop(cs.backgroundOrigin || 'padding-box')
  const clips = splitTop(cs.backgroundClip || cs.webkitBackgroundClip || 'border-box')
  const attachments = splitTop(cs.backgroundAttachment || 'scroll')
  const blends = splitTop(cs.backgroundBlendMode || 'normal')

  // The background color is painted inside the clip of the LAST layer.
  const colorClip = BOX_KEYWORD[String(at(clips, layers.length ? layers.length - 1 : 0)).toLowerCase()] || 'border'
  const bg = parseColor(cs.backgroundColor)
  if (bg && !isTransparent(bg.rgba)) {
    // `parseColor` measures what it approximated (canvas round-trip, sRGB gamut
    // mapping with its ΔEOK); read here or the number is thrown away.
    for (const message of bg.warnings || []) warnings.push(`background-color: ${message}`)
    fills.push({
      type: 'solid',
      color: bg.rgba,
      srcCss: bg.srcCss,
      blend: 'normal',
      clipBox: colorClip,
    })
  } else if (!bg && cs.backgroundColor && cs.backgroundColor !== 'transparent') {
    warnings.push(`background-color "${cs.backgroundColor}" could not be parsed; the fill is dropped.`)
  }

  const used = new Set(fills.length ? [colorClip] : [])

  // Reversed: CSS paints layer 0 on top, `fills` runs back-to-front.
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    if (!layer || layer.toLowerCase() === 'none') continue

    const clipBox = BOX_KEYWORD[String(at(clips, i)).toLowerCase()] || 'border'
    const originBox = BOX_KEYWORD[String(at(origins, i)).toLowerCase()] || 'padding'
    if (clipBox === 'text') {
      // The old wording — "the layer is emitted clipped to the border box" — described
      // the SVD, not what anyone sees. MEASURED 2026-08-07 by pasting this fixture into
      // a generic SVG editor (mediamodifier): a renderer without `<mask>` support paints
      // the gradient rect UNMASKED and the glyphs never appear at all, so the headline
      // arrives as a coloured bar with no text in it. That is not a degraded layer, it
      // is the content gone, and the previous message would have let someone read the
      // panel and still be surprised. Figma does apply the mask, and `textGradientMask:
      // false` trades it for an editable text layer painted in a solid colour.
      warnings.push('background-clip:text needs a glyph mask over the background layer. A target ' +
        'that supports <mask> (Figma does) shows the gradient in the glyph shapes; one that does ' +
        'NOT paints the rectangle unmasked and the text DISAPPEARS — measured in a generic SVG ' +
        'editor. Use `textGradientMask: false` to emit a real text layer in a solid colour instead.')
    }
    used.add(clipBox)

    const attachment = String(at(attachments, i)).toLowerCase()
    if (attachment === 'fixed') {
      warnings.push('background-attachment:fixed positions the layer against the viewport; it is placed against the element box instead.')
    } else if (attachment === 'local' && (cs.overflowX !== 'visible' || cs.overflowY !== 'visible')) {
      warnings.push('background-attachment:local scrolls with the content; it is placed at the unscrolled origin.')
    }

    const area = boxes[originBox === 'text' ? 'border' : originBox]
    const placement = {
      area: { ...area },
      sizing: parseBgSize(at(sizes, i), warnings),
      position: parseBgPosition(at(positions, i), warnings),
      repeat: parseBgRepeat(at(repeats, i), warnings),
    }
    const blend = String(at(blends, i)).toLowerCase()

    if (GRADIENT.test(layer)) {
      // A gradient has neither intrinsic size nor intrinsic ratio, so its tile is
      // fully determined here and `parseGradient` can be given a real box.
      const rect = resolveLayerRect(placement, null)
      if (rect.w <= 0 || rect.h <= 0) continue
      const paint = parseGradient(layer, { w: rect.w, h: rect.h })
      if (!paint) {
        warnings.push(`background-image layer "${layer}" looks like a gradient but could not be parsed; it is dropped.`)
        continue
      }
      for (const note of paint.notes || []) warnings.push(`gradient: ${note}`)
      fills.push({ ...paint, srcCss: layer, blend, clipBox, originBox, placement, rect })
      continue
    }

    const isSet = IMAGE_SET.test(layer)
    const url = readUrl(layer)
    if (url) {
      if (isSet) {
        warnings.push(`image-set() in "${layer}" is reduced to its first candidate.`)
      }
      // The intrinsic size is unknown until the asset loads, so the rect is only
      // resolvable here when both axes are given explicitly.
      const resolvable = placement.sizing.kind === 'explicit' &&
        placement.sizing.x !== 'auto' && placement.sizing.y !== 'auto'
      fills.push({
        type: 'image',
        asset: { pending: true, kind: 'url', url, srcCss: layer },
        srcCss: layer,
        blend,
        clipBox,
        originBox,
        placement,
        rect: resolvable ? resolveLayerRect(placement, null) : null,
      })
      continue
    }

    warnings.push(`background-image layer "${layer}" is not a gradient or a URL; it is dropped.`)
  }

  if (used.size > 1) {
    warnings.push(
      `background layers use more than one clip box (${[...used].join(', ')}); ` +
      'they cannot share one node and must be split by the caller.'
    )
  }

  return fills
}

/**
 * `mask-image`, collected the same way a background is.
 *
 * A mask is a background painted into an alpha channel: the same layer list, the
 * same `-size` / `-position` / `-repeat` / `-origin` / `-clip` grammar, resolved
 * against the same boxes. So the layers come back in `fills` shape and a caller
 * has everything it needs to synthesize the mask NODE the SVD asks for —
 * `node.mask = {node, type}` (see `emit/svg-flat.js:emitMask`, which already
 * reads it and paints the referenced node into a `<mask>`).
 *
 * What it does NOT do is create that node: `collectBox` collects the paint of one
 * element and the orchestrator owns node ids. Until that caller exists the mask
 * is collected and unused, which is why the warning is graded `O` — the box is
 * emitted unmasked, exactly as `clip-path` is, and now says so in the same shape.
 *
 * @returns {{type:'alpha'|'luminance', mode:string, composite:string, clipBox:string,
 *            box:{x,y,w,h}, radii, layers:Paint[], srcCss:string}|null}
 */
function collectMask (cs, boxes, radii, border, padding, warnings) {
  const image = pickFilter(cs.maskImage, cs.webkitMaskImage)
  if (image === 'none') return null

  const layers = splitTop(image)
  const sizes = splitTop(cs.maskSize || cs.webkitMaskSize || 'auto')
  const positions = splitTop(cs.maskPosition || cs.webkitMaskPosition || '0% 0%')
  const repeats = splitTop(cs.maskRepeat || cs.webkitMaskRepeat || 'repeat')
  const origins = splitTop(cs.maskOrigin || cs.webkitMaskOrigin || 'border-box')
  const clips = splitTop(cs.maskClip || cs.webkitMaskClip || 'border-box')
  const composite = String(cs.maskComposite || cs.webkitMaskComposite || 'add').toLowerCase()

  const clipKeyword = String(at(clips, layers.length ? layers.length - 1 : 0)).toLowerCase()
  const clipBox = BOX_KEYWORD[clipKeyword] || 'border'
  if (!BOX_KEYWORD[clipKeyword]) {
    warnings.push(`mask-clip:${clipKeyword} has no box in this model; the mask is clipped to the border box.`)
  }

  const out = []
  let svgReference = false
  // Reversed for the same reason `fills` is: layer 0 paints on top.
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    if (!layer || layer.toLowerCase() === 'none') continue

    const originBox = BOX_KEYWORD[String(at(origins, i)).toLowerCase()] || 'padding'
    const area = boxes[originBox === 'text' ? 'border' : originBox]
    const placement = {
      area: { ...area },
      sizing: parseBgSize(at(sizes, i), warnings),
      position: parseBgPosition(at(positions, i), warnings),
      repeat: parseBgRepeat(at(repeats, i), warnings),
    }

    if (GRADIENT.test(layer)) {
      const rect = resolveLayerRect(placement, null)
      if (rect.w <= 0 || rect.h <= 0) continue
      const paint = parseGradient(layer, { w: rect.w, h: rect.h })
      if (!paint) {
        warnings.push(`mask-image layer "${layer}" looks like a gradient but could not be parsed; it is dropped.`)
        continue
      }
      for (const note of paint.notes || []) warnings.push(`mask gradient: ${note}`)
      out.push({ ...paint, srcCss: layer, blend: 'normal', clipBox, originBox, placement, rect })
      continue
    }

    const url = readUrl(layer)
    // `url(#id)` is an SVG <mask> element, not an image: its content is a
    // subtree of the document, and reading it is `collect/image.js`'s job, not
    // this one's.
    if (url && url.startsWith('#')) {
      svgReference = true
      warnings.push(`mask-image layer "${layer}" references an SVG <mask> element; its geometry is not read.`)
      continue
    }
    if (url) {
      const resolvable = placement.sizing.kind === 'explicit' &&
        placement.sizing.x !== 'auto' && placement.sizing.y !== 'auto'
      out.push({
        type: 'image',
        asset: { pending: true, kind: 'url', url, srcCss: layer },
        srcCss: layer,
        blend: 'normal',
        clipBox,
        originBox,
        placement,
        rect: resolvable ? resolveLayerRect(placement, null) : null,
      })
      continue
    }
    warnings.push(`mask-image layer "${layer}" is not a gradient or a URL; it is dropped.`)
  }

  // `match-source` is luminance only for an SVG <mask> element; for an image or a
  // gradient — which is every layer that gets this far — it is alpha.
  const mode = String(cs.maskMode || 'match-source').toLowerCase()
  const type = mode === 'luminance' || (mode === 'match-source' && svgReference) ? 'luminance' : 'alpha'
  if (out.length > 1 && composite !== 'add') {
    warnings.push(`mask-composite:${composite} is not modelled; the collected layers stack as "add".`)
  }

  const inset = clipBox === 'padding'
    ? border
    : (clipBox === 'content' ? border.map((v, i) => v + padding[i]) : null)
  return {
    type,
    mode,
    composite,
    clipBox,
    box: { ...boxes[clipBox === 'text' ? 'border' : clipBox] },
    radii: inset ? insetRadii(radii, inset) : radii,
    layers: out,
    srcCss: image,
  }
}

/**
 * `clip-path` as geometry, in the same node-local px every other field here is in.
 *
 * Only the basic shapes, and only resolved — a backend cannot be handed
 * `polygon(50% 0%, …)` and be expected to know what box the percentages are
 * against. Chromium serialises the computed value with the reference box spelled
 * out when it is not the default, which is the one thing that makes this
 * readable without re-implementing the cascade.
 *
 * `url(#id)` is a `<clipPath>` ELEMENT: its content is a subtree of the document
 * and reading it is `collect/image.js`'s job, not this one's — so it answers null
 * and the caller reports it, exactly like an `url(#…)` mask layer.
 *
 * @returns {{kind:string, box:string, ...}|null} null when the value is not a
 *   basic shape, or is one whose grammar could not be resolved.
 */
function parseClipPath (value, boxes, radii, warnings) {
  const parts = splitTop(value, false)
  let boxKey = 'border'
  let shape = ''
  for (const part of parts) {
    const lower = part.toLowerCase()
    if (BOX_KEYWORD[lower]) { boxKey = BOX_KEYWORD[lower] === 'text' ? 'border' : BOX_KEYWORD[lower]; continue }
    if (lower === 'fill-box' || lower === 'stroke-box' || lower === 'view-box') { boxKey = 'border'; continue }
    if (/^[a-z-]+\(/i.test(part)) shape = part
  }
  const area = boxes[boxKey] || boxes.border
  // A bare `<geometry-box>` with no shape IS a valid clip-path: the box itself.
  if (!shape) {
    return parts.length ? { kind: 'rect', box: boxKey, rect: { ...area }, radii: boxKey === 'border' ? radii : null } : null
  }
  const m = /^([a-z-]+)\((.*)\)$/is.exec(shape)
  if (!m) return null
  const fn = m[1].toLowerCase()
  const args = m[2].trim()
  // A percentage resolves against the reference box on its own axis; the
  // "reference distance" a circle radius uses is the CSS diagonal formula.
  const onX = (t) => { const v = parseLenPct(t, warnings, `clip-path ${fn}`); return area.x + v.len + v.pct * area.w }
  const onY = (t) => { const v = parseLenPct(t, warnings, `clip-path ${fn}`); return area.y + v.len + v.pct * area.h }
  const sizeX = (t) => { const v = parseLenPct(t, warnings, `clip-path ${fn}`); return v.len + v.pct * area.w }
  const sizeY = (t) => { const v = parseLenPct(t, warnings, `clip-path ${fn}`); return v.len + v.pct * area.h }
  const diagonal = Math.sqrt((area.w * area.w + area.h * area.h) / 2)

  if (fn === 'polygon') {
    let body = args
    let rule = 'nonzero'
    const first = splitTop(body)[0] || ''
    if (/^(nonzero|evenodd)$/i.test(first.trim())) {
      rule = first.trim().toLowerCase()
      body = splitTop(body).slice(1).join(',')
    }
    const points = []
    for (const pair of splitTop(body)) {
      const xy = splitTop(pair, false)
      if (xy.length < 2) return null
      points.push([onX(xy[0]), onY(xy[1])])
    }
    if (points.length < 3) return null
    return { kind: 'polygon', box: boxKey, rule, points }
  }
  if (fn === 'inset' || fn === 'rect' || fn === 'xywh') {
    // `inset()` is the only one of the three CSS serialises for `clip-path`
    // today, but all three share a shape once resolved.
    const [geom, roundRaw] = args.split(/\bround\b/i)
    const t = splitTop(geom.trim(), false)
    if (!t.length) return null
    let rect
    if (fn === 'inset') {
      const top = sizeY(t[0])
      const right = sizeX(t[1] !== undefined ? t[1] : t[0])
      const bottom = sizeY(t[2] !== undefined ? t[2] : t[0])
      const left = sizeX(t[3] !== undefined ? t[3] : (t[1] !== undefined ? t[1] : t[0]))
      rect = { x: area.x + left, y: area.y + top, w: Math.max(0, area.w - left - right), h: Math.max(0, area.h - top - bottom) }
    } else if (fn === 'xywh') {
      rect = { x: area.x + sizeX(t[0]), y: area.y + sizeY(t[1]), w: Math.max(0, sizeX(t[2])), h: Math.max(0, sizeY(t[3])) }
    } else {
      const top = onY(t[0]); const right = onX(t[1]); const bottom = onY(t[2]); const left = onX(t[3])
      rect = { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) }
    }
    let round = null
    if (roundRaw && roundRaw.trim()) {
      const r = splitTop(roundRaw.trim(), false).map((v) => Math.max(0, sizeX(v)))
      round = [r[0] || 0, r[1] !== undefined ? r[1] : r[0] || 0,
        r[2] !== undefined ? r[2] : r[0] || 0, r[3] !== undefined ? r[3] : (r[1] !== undefined ? r[1] : r[0] || 0)]
    }
    return { kind: 'inset', box: boxKey, rect, round }
  }
  if (fn === 'circle' || fn === 'ellipse') {
    const [radiiRaw, posRaw] = args.split(/\bat\b/i)
    const rs = splitTop((radiiRaw || '').trim(), false).filter(Boolean)
    const pos = parseBgPosition((posRaw || '50% 50%').trim(), warnings)
    const cx = area.x + pos.x.len + pos.x.pct * area.w
    const cy = area.y + pos.y.len + pos.y.pct * area.h
    const side = (token, axis, extent) => {
      const v = String(token || 'closest-side').trim().toLowerCase()
      if (v === 'closest-side') return Math.min(Math.abs(axis - area[extent === 'w' ? 'x' : 'y']), Math.abs(area[extent === 'w' ? 'x' : 'y'] + area[extent] - axis))
      if (v === 'farthest-side') return Math.max(Math.abs(axis - area[extent === 'w' ? 'x' : 'y']), Math.abs(area[extent === 'w' ? 'x' : 'y'] + area[extent] - axis))
      return null
    }
    if (fn === 'circle') {
      const token = rs[0]
      let r = side(token, cx, 'w')
      if (r !== null && String(token || '').trim().toLowerCase().startsWith('closest')) {
        r = Math.min(r, side(token, cy, 'h'))
      } else if (r !== null) {
        r = Math.max(r, side(token, cy, 'h'))
      } else {
        const v = parseLenPct(token, warnings, 'clip-path circle')
        r = v.len + v.pct * diagonal
      }
      return { kind: 'ellipse', box: boxKey, cx, cy, rx: r, ry: r }
    }
    const rx = side(rs[0], cx, 'w') ?? sizeX(rs[0])
    const ry = side(rs[1] !== undefined ? rs[1] : rs[0], cy, 'h') ?? sizeY(rs[1] !== undefined ? rs[1] : rs[0])
    return { kind: 'ellipse', box: boxKey, cx, cy, rx, ry }
  }
  if (fn === 'path') {
    const q = /^(?:(nonzero|evenodd)\s*,\s*)?["'](.*)["']$/is.exec(args)
    if (!q) return null
    return { kind: 'path', box: boxKey, rule: (q[1] || 'nonzero').toLowerCase(), d: q[2] }
  }
  return null
}

/**
 * A collapsed table border does not travel with a `position: sticky` cell.
 *
 * Under `border-collapse: collapse` the border stops belonging to the cell and
 * becomes the TABLE's, painted on the grid line. When the cell is then stuck
 * somewhere else, Chromium paints nothing at the stuck position — the border stays
 * behind on the static grid line, where the scrolled-away row is.
 *
 * Measured on `demo/challenges.html` -> fx-table (2026-08-07). Its `tfoot td` is
 * `position: sticky; bottom: 0` with `border-top: 5px double`, stuck at y=335 while
 * its static position is y~487. Reading the live pixels at x=60: rows 335..340 are
 * (251,253,255) and (255,255,255) — no ink at all. This engine read
 * `border-top-width` off the computed style, saw 5px, and painted a solid
 * `#64748b` band there. Those four rows were the hottest lines in the entire
 * corpus: ~124 mean channel difference across the full 500px width.
 *
 * The control page settles that it is the displacement and not the sticky: with
 * `scrollTop: 0` (the cell at its static position) Chromium DOES paint it, and the
 * dark rows appear.
 */
function stickyCollapsedBorderIsElsewhere (el, cs) {
  if ((cs.position || 'static') !== 'sticky') return false
  const tag = el.tagName
  if (tag !== 'TD' && tag !== 'TH') return false
  const table = el.closest && el.closest('table')
  if (!table) return false
  const view = el.ownerDocument && el.ownerDocument.defaultView
  let collapse = ''
  try { collapse = view ? view.getComputedStyle(table).borderCollapse : '' } catch { return false }
  if (collapse !== 'collapse') return false
  // Stuck, or merely sticky and sitting where it always was? Only the first one
  // leaves the border behind; dropping it in the second case would lose a border
  // the page really paints.
  const row = el.parentElement
  if (!row) return false
  try {
    return Math.abs(el.getBoundingClientRect().top - row.getBoundingClientRect().top) > 0.5
  } catch { return false }
}

/** Borders as one inside stroke with per-side weights, plus the outline as a sibling. */
function collectStrokes (cs, radii, border, el) {
  const strokeWarnings = []
  const strokes = []

  if (el && stickyCollapsedBorderIsElsewhere(el, cs)) {
    strokeWarnings.push('this cell is stuck away from its static position and its table collapses borders, ' +
      'so the border belongs to the table and Chromium paints it on the static grid line, not here. It is ' +
      'not emitted. Measured on fx-table: the live pixels under the stuck footer carry no ink at all, and ' +
      'painting it there was the hottest error in the corpus (~124 mean channel difference over 500px).')
    return { strokes, strokeWarnings }
  }

  const SIDES = ['Top', 'Right', 'Bottom', 'Left']
  const sides = SIDES.map((name, i) => {
    const style = cs[`border${name}Style`] || 'none'
    const hidden = style === 'none' || style === 'hidden'
    const parsed = parseColor(cs[`border${name}Color`])
    return {
      side: name.toLowerCase(),
      width: hidden ? 0 : border[i],
      style,
      color: parsed ? parsed.rgba : null,
      srcCss: parsed ? parsed.srcCss : cs[`border${name}Color`],
      colorWarnings: (parsed && parsed.warnings) || [],
    }
  })

  const visible = sides.filter((s) => s.width > 0 && s.color && !isTransparent(s.color))
  for (const s of visible) {
    for (const message of s.colorWarnings) strokeWarnings.push(`border-${s.side}-color: ${message}`)
  }
  if (visible.length) {
    const key = (s) => `${s.style}|${s.color.join(',')}`
    const uniform = visible.every((s) => key(s) === key(visible[0]))
    const model = visible[0]
    const weights = sides.map((s) => s.width)
    const maxWeight = Math.max(...visible.map((s) => s.width))

    const stroke = {
      kind: 'border',
      align: 'inside',
      weights,
      radii,
      paint: { type: 'solid', color: model.color, srcCss: model.srcCss },
      style: model.style,
      uniform,
      // `colorWarnings` is a collection channel, not part of the stroke shape.
      sides: sides.map(({ colorWarnings, ...rest }) => rest),
    }

    if (model.style === 'dashed' || model.style === 'dotted') {
      // A 3w/3w period. Chromium's dotted run is nearer w/w with round caps; the
      // cap is carried, the period is not, and that is the approximation.
      stroke.dash = [3 * maxWeight, 3 * maxWeight]
      stroke.cap = model.style === 'dotted' ? 'round' : 'butt'
      if (model.style === 'dotted') {
        strokeWarnings.push('border-style:dotted is emitted as a round-capped 3w/3w dash; the rendered period is tighter.')
      }
    } else if (model.style === 'double') {
      // Not "shading". Chromium splits the width into line / gap / line — measured
      // 2/1/2 for the 5px border on fx-table — and the middle third is BACKGROUND,
      // not a lighter shade of the colour. Emitted solid, that third arrives as ink.
      // The corpus has exactly one `double` border and the sticky-cell rule above
      // already drops it, so no fixture would measure a split implementation today:
      // it is declared rather than written blind.
      strokeWarnings.push(`border-style:double is emitted as one solid band ${maxWeight}px wide. Chromium ` +
        'splits that width into line / gap / line — 2/1/2 for a 5px border, measured — and the middle third ' +
        'is background showing through, not a lighter shade. Emitted this way it arrives as solid ink.')
    } else if (!['solid', 'none', 'hidden'].includes(model.style)) {
      strokeWarnings.push(`border-style:${model.style} is emitted as a solid stroke; its shading is lost.`)
    }

    if (!uniform) {
      const detail = visible
        .map((s) => `${s.side}: ${s.style} ${s.srcCss}`)
        .join('; ')
      strokeWarnings.push(
        `border sides differ (${detail}); one stroke cannot carry them and the caller ` +
        'must compose one shape per side.'
      )
    }
    strokes.push(stroke)
  } else {
    for (const s of sides) {
      if (s.width > 0 && !s.color) {
        strokeWarnings.push(`border-${s.side}-color "${s.srcCss}" could not be parsed; the side is dropped.`)
      }
    }
  }

  const outlineWidth = px(cs.outlineWidth)
  const outlineStyle = cs.outlineStyle || 'none'
  const outlineColor = parseColor(cs.outlineColor)
  if (outlineWidth > 0 && outlineStyle !== 'none' && outlineColor && !isTransparent(outlineColor.rgba)) {
    const offset = px(cs.outlineOffset)
    for (const message of outlineColor.warnings || []) strokeWarnings.push(`outline-color: ${message}`)
    strokes.push({
      kind: 'outline',
      // The outline is painted over everything, is not clipped by the box and
      // does not participate in its layout, so it can only be a sibling emitted
      // last in the parent's z-order.
      sibling: true,
      order: 'last',
      align: 'outside',
      offset,
      weights: [outlineWidth, outlineWidth, outlineWidth, outlineWidth],
      radii: expandRadii(radii, offset),
      paint: { type: 'solid', color: outlineColor.rgba, srcCss: outlineColor.srcCss },
      style: outlineStyle === 'auto' ? 'solid' : outlineStyle,
    })
    if (outlineStyle === 'auto') {
      strokeWarnings.push('outline-style:auto is the UA focus ring; it is emitted as a solid stroke.')
    } else if (outlineStyle === 'dashed' || outlineStyle === 'dotted') {
      strokes[strokes.length - 1].dash = [3 * outlineWidth, 3 * outlineWidth]
      strokes[strokes.length - 1].cap = outlineStyle === 'dotted' ? 'round' : 'butt'
    }
    strokeWarnings.push('outline is emitted as a sibling stroke at the end of the z-order, not as part of this node.')
  }

  return { strokes, strokeWarnings }
}

/** box-shadow and the filter chain. */
function collectEffects (cs, warnings) {
  const effects = []
  let filterOpacity = 1

  if (cs.boxShadow && cs.boxShadow !== 'none') {
    const { shadows, warnings: shadowWarnings } = parseShadows(cs.boxShadow, { inset: true, currentColor: cs.color })
    // Every assumption `parseShadows` made — a dropped shadow in a list of three,
    // a colour that fell back to opaque black — is only visible here.
    for (const message of shadowWarnings) warnings.push(`box-shadow: ${message}`)
    if (!shadows.length) {
      warnings.push(`box-shadow "${cs.boxShadow}" could not be parsed; it is dropped.`)
    }
    effects.push(...shadows)
  }

  const filter = pickFilter(cs.filter, cs.webkitFilter)

  if (filter !== 'none') {
    const fns = readFilterFunctions(filter)
    const kept = []
    const droppedColor = []
    const droppedOther = []
    const pendingOpacity = []
    const matrices = []
    // A colour run is flushed the moment something that is NOT a colour filter
    // reaches the chain, so the effects come out in source order and the emitter
    // can build its chain by walking the array. `opacity()` does not break a run:
    // it is taken out of the chain entirely (see below) and it commutes with a
    // colour matrix, so what is left either side of it really is adjacent.
    let colorRun = []
    const flushColor = () => {
      if (!colorRun.length) return
      const chain = colorMatrixChain(colorRun)
      colorRun = []
      for (const fn of chain.unreadable) droppedColor.push(fn)
      for (const fn of chain.used) kept.push(fn)
      for (const step of chain.steps) {
        effects.push({ type: 'colorMatrix', values: step.values, srcCss: step.srcCss, backdrop: false })
        matrices.push(step)
      }
    }
    for (const fn of fns) {
      const { name, arg } = fn
      if (COLOR_FILTERS.has(name)) {
        colorRun.push(fn)
        continue
      }
      if (name !== 'opacity') flushColor()
      if (name === 'blur') {
        // The CSS radius verbatim — SVD invariant 5 says sigma = blur / 2 and
        // that division belongs to the emitter.
        effects.push({ type: 'layerBlur', blur: px(arg), srcCss: fn.css })
        kept.push(fn)
      } else if (name === 'drop-shadow') {
        const { shadows, warnings: shadowWarnings } = parseShadows(arg, { inset: false, currentColor: cs.color })
        // Chromium serialises `drop-shadow(0 1px 2px)` without a colour — the
        // initial value is `currentColor`, which this module cannot resolve — so
        // an indigo shadow silently became black until this line existed.
        for (const message of shadowWarnings) warnings.push(`filter: ${fn.css}: ${message}`)
        if (!shadows.length) {
          warnings.push(`filter: ${fn.css} could not be parsed; it is dropped.`)
        }
        for (const s of shadows) effects.push({ ...s, source: 'filter' })
        warnings.push('filter: drop-shadow follows the alpha silhouette; it is emitted as a box drop shadow.')
        kept.push(fn)
      } else if (name === 'opacity') {
        pendingOpacity.push(arg.endsWith('%') ? parseFloat(arg) / 100 : parseFloat(arg))
        kept.push(fn)
      } else {
        droppedOther.push(fn)
      }
    }
    flushColor()

    // What "dropped" means here is worth being exact about, because the old
    // message was not. It said the node "must be rasterized to keep it", which
    // `index.js` reads as grade `R` — a node the document then CLAIMS to have
    // rasterized. Nothing in this engine rasterizes a box filter (`emit/pdf.js`
    // says so in as many words at its own filter branch), so the output was
    // vector, unfiltered, and graded raster. The function is gone: grade `O`.
    const partial = kept.length
      ? `The rest of the chain is still applied (${listOf(kept)}), so this node is painted with a ` +
        'PARTIAL filter — neither the filtered nor the unfiltered image.'
      : 'The node is painted unfiltered.'
    if (matrices.length) {
      warnings.push({
        code: 'collect.box.filter-color-matrix',
        grade: 'E',
        severity: 'info',
        message: `filter: ${matrices.map((m) => m.srcCss).join(' ')} is carried as ` +
          `${matrixCount(matrices)}, which is exactly what CSS Filter Effects §8 defines those ` +
          'functions to be, so nothing is approximated here; the matrices act on non-premultiplied ' +
          `sRGB. ${matrixSplit(matrices)}Whether they survive is the backend's to declare (SVG has ` +
          'feColorMatrix; Figma has no colour effect).',
      })
    }
    if (droppedColor.length) {
      warnings.push({
        code: 'collect.box.filter-color-dropped',
        grade: 'O',
        severity: 'warn',
        message: `filter: ${listOf(droppedColor)} resamples colour and its argument could not be ` +
          `read, so no colour matrix can be built for it and it is dropped. ${partial}`,
      })
    }
    for (const fn of droppedOther) {
      warnings.push({
        code: fn.name === 'url' ? 'collect.box.filter-svg-reference' : 'collect.box.filter-unsupported',
        grade: 'O',
        severity: 'warn',
        message: fn.name === 'url'
          ? `filter references the SVG filter ${fn.arg}; its definition is not read and the ` +
            `reference is dropped. ${partial}`
          : `filter function ${fn.css} is not represented and is dropped. ${partial}`,
      })
    }
    if (pendingOpacity.length) {
      // Alone among blurs and drop-shadows, opacity() commutes with the rest of
      // the chain, so folding it into layer opacity is exact. It used to be
      // withheld "for the raster" whenever a colour function shared the chain,
      // which — there being no raster — lost it outright on top of the colour.
      for (const o of pendingOpacity) filterOpacity *= clamp01(o)
    }
    if (!fns.length) {
      warnings.push(`filter "${filter}" could not be parsed; it is dropped.`)
    }
  }

  // snapdom pre-composes `backdrop-filter` in the clone (a copy of what paints
  // below, carrying the functions as a plain `filter`), so this branch is what is
  // left for the cases it cannot: a 0×0 source box, or the filtered element being
  // the capture root, whose backdrop lies outside the capture.
  const backdrop = pickFilter(cs.backdropFilter, cs.webkitBackdropFilter)
  if (backdrop !== 'none') {
    const fns = readFilterFunctions(backdrop)
    const dropped = []
    const matrices = []
    let blur = null
    // Same flush discipline as the `filter` branch, with one difference:
    // `opacity()` belongs to the MATRIX here. On `backdrop-filter` it fades what
    // shows through the node, not the node, so folding it into layer opacity —
    // which is what the other branch does — would fade the wrong pixels.
    let colorRun = []
    const flushColor = () => {
      if (!colorRun.length) return
      const chain = colorMatrixChain(colorRun)
      colorRun = []
      for (const fn of chain.unreadable) dropped.push(fn)
      for (const step of chain.steps) {
        effects.push({ type: 'colorMatrix', values: step.values, srcCss: step.srcCss, backdrop: true })
        matrices.push(step)
      }
    }
    for (const fn of fns) {
      if (COLOR_MATRIX_FILTERS.has(fn.name)) {
        colorRun.push(fn)
        continue
      }
      flushColor()
      if (fn.name === 'blur' && !blur) {
        blur = fn
        effects.push({ type: 'backgroundBlur', blur: px(fn.arg), srcCss: fn.css })
      } else {
        dropped.push(fn)
      }
    }
    flushColor()
    const carried = [
      blur ? `${blur.css} as a backgroundBlur effect` : null,
      matrices.length ? `${matrices.map((m) => m.srcCss).join(' ')} as ${matrixCount(matrices)}` : null,
    ].filter(Boolean).join(' and ')
    if (!dropped.length && carried) {
      warnings.push({
        code: blur ? 'collect.box.backdrop-blur' : 'collect.box.backdrop-color-matrix',
        grade: 'E',
        severity: 'info',
        message: `backdrop-filter: ${carried} — exactly what those functions mean, so nothing is ` +
          'approximated here; a colour matrix acts on non-premultiplied sRGB. ' +
          `${matrixSplit(matrices)}Whether they survive is the backend's to declare (Figma has the ` +
          'blur and no colour effect; SVG has feColorMatrix and no readback of the backdrop).',
      })
    } else if (dropped.length) {
      warnings.push({
        code: 'collect.box.backdrop-filter-dropped',
        grade: 'O',
        severity: 'warn',
        message: `backdrop-filter: ${listOf(dropped)} has no vector primitive and is dropped; ` +
          (carried
            ? `what is carried is ${carried}, and nothing more.`
            : 'the node is emitted with no backdrop effect at all.'),
      })
    }
    if (!fns.length) {
      warnings.push({
        code: 'collect.box.backdrop-filter-dropped',
        grade: 'O',
        severity: 'warn',
        message: `backdrop-filter "${backdrop}" could not be read; the node is emitted without it.`,
      })
    }
  }

  return { effects, filterOpacity }
}

/**
 * The paint clip: the padding box with the inner radii.
 *
 * `overflow` is not the only property that clips. `contain: paint|strict|content`
 * and `content-visibility: auto|hidden` clip to the padding box too, and they do
 * NOT change the computed `overflow` — so reading `overflowX/Y` alone said "no
 * clip" for a box the page was clipping. `paint.js:clipsContent()` already knows
 * all three (it is why the element gets its own layer at all); the knowledge
 * simply never crossed into the collector, and an absolutely-positioned child
 * that the page cut at the padding box was emitted whole, over its neighbours.
 */
const CONTAIN_CLIP = /\b(paint|strict|content)\b/

function collectClip (cs, radii, border, warnings) {
  const ox = cs.overflowX || 'visible'
  const oy = cs.overflowY || 'visible'
  const byOverflow = ox !== 'visible' || oy !== 'visible'
  const contain = CONTAIN_CLIP.test(cs.contain || '') ? cs.contain : ''
  const cv = cs.contentVisibility === 'auto' || cs.contentVisibility === 'hidden'
    ? cs.contentVisibility
    : ''
  if (!byOverflow && !contain && !cv) return null

  if (byOverflow && ox !== oy && (ox === 'visible' || oy === 'visible')) {
    warnings.push(`overflow is clipped on one axis only (x:${ox}, y:${oy}); the clip is applied to both.`)
  }
  // No warning for the clip itself: it is the same padding-box rect with the same
  // inner radii the page uses, so nothing is approximated and a diagnostic here
  // would only degrade a node that is exact.
  if (cv === 'hidden') {
    // The box itself still paints; its contents are skipped entirely, and the
    // walk in `paint.js` does not know that, so it collects them from layout.
    warnings.push('content-visibility:hidden — the page renders none of this subtree; descendants collected from layout are painted here although the page omitted them.')
  }
  return { mode: 'rect', box: 'padding', radii: insetRadii(radii, border) }
}

export default collectBox
