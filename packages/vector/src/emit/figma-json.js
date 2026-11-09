/**
 * SVD -> the payload the Figma plugin consumes.
 *
 * Pure data, and deliberately so: this module runs in the page and the Figma
 * API lives in the plugin sandbox, so everything the plugin needs has to
 * arrive as JSON — node records keyed by id, the font list for the blocking
 * preflight, and the diagnostics for whatever the translation could not carry.
 * There is no `figma.*` call anywhere in this file and there must never be one.
 *
 * This is the ONLY translator (CONTRACT.md "Module signatures"): the plugin
 * consumes what comes out of here verbatim and never reads an SVD field. So
 * everything the plugin cannot re-derive travels in the payload, including
 * `doc.assets` — image fills still reference them by id, but the bytes now ride
 * along under `document.assets` because the plugin is no longer handed the SVD.
 *
 * Four conversions carry all the risk, and each is stated once, here:
 *
 *  1. GRADIENTS. Figma has no handles and no angle — the geometry IS the
 *     `gradientTransform`. SVD stores the SVG convention: `unit` is the
 *     gradient's geometry in the unit square (keys fixed by CONTRACT.md and
 *     never probed for here), and `transform` maps that unit space forward onto
 *     the painted layer IN PX. Figma's matrix runs the other way AND in another
 *     space: it maps a point of the shape's box **normalized to 0..1** into a
 *     canonical gradient space where the ramp runs from x=0 to x=1. So the
 *     forward chain is `norm · translate(rect) · transform · basis` and the
 *     matrix Figma wants is its inverse. Skipping the `norm` step is not a
 *     rounding error: a 46px translation reads as 46 box widths and the whole
 *     ramp lands outside the shape.
 *     A singular product is precisely the "failed to invert transform" the SVG
 *     importer throws; here it becomes a diagnostic and an identity matrix,
 *     never a crash.
 *  2. PER-SIDE STROKES. `strokeTopWeight` and friends are legal only on
 *     rect-like nodes. Anywhere else — and anywhere the four sides differ in
 *     colour — the border is composed as four filled shapes, and says so.
 *  3. TRANSFORMS. Figma's `relativeTransform` is a rotation plus a
 *     translation; scale lives in `width`/`height` and skew does not exist at
 *     all. A non-zero `skewX` marks the node for outline or raster.
 *  4. TEXT. Figma drops the letter-spacing that follows the last glyph and CSS
 *     does not, so the measured width is compensated and the box is nudged by
 *     the alignment. `characters` keeps U+2028 verbatim: a newline would make a
 *     paragraph and pull in `paragraphSpacing`.
 *
 * **THE TWO ROUTES INTO FIGMA DO NOT LOSE THE SAME THINGS, and the difference is
 * counter-intuitive enough to be worth stating here rather than being rediscovered.**
 * There is this payload (Plugin API) and there is pasting `emit/svg-flat.js`'s
 * markup (Figma's SVG importer). They are not two spellings of one capability:
 *
 *  - `letter-spacing` EXISTS in the plugin model — `TextNode.letterSpacing` and
 *    `setRangeLetterSpacing`, both `{unit:'PIXELS'|'PERCENT', value}` — so this
 *    payload carries it, per node and per run, and the plugin path is exact.
 *    The SVG-paste path loses it OUTRIGHT: FIGMA_FINDINGS.md §5 measured a
 *    22px/700 line arriving 19% wide (376.8px -> 449px), of which +50px is the
 *    ignored `letter-spacing` (41 chars x 1.21px, confirmed as `0` in Figma's own
 *    panel) and +23px the font substitution. Four ways of forcing it through the
 *    SVG — the attribute with a unit, a mirrored `style=`, `textLength` +
 *    `lengthAdjust="spacing"`, an internal `<style>` sheet — were each tried and
 *    each ignored. So the intuition "the SVG is the honest one, the payload is the
 *    lossy convenience" is backwards for text metrics.
 *  - Same shape for `-webkit-text-stroke` (here: a node-level Figma stroke, and
 *    only when every run agrees, because Figma has no per-range stroke) and for
 *    small caps (here: `setRangeTextCase`, which the SVG route spells as a
 *    presentation attribute the importer may or may not honour).
 *  - The other way round for the hyphen at a hyphenation break: the SVG route
 *    paints it (each line is its own positioned piece there, so it cannot move),
 *    and this one deliberately does not, because a TextNode reflows.
 *
 * Effects are the one place where the vocabulary is simply smaller: Figma's
 * effect list is shadows and blurs — `DROP_SHADOW`, `INNER_SHADOW`, `LAYER_BLUR`,
 * `BACKGROUND_BLUR` — and nothing else. There is no colour-matrix effect, so an
 * SVD `colorMatrix` (what `saturate()`, `hue-rotate()`, `grayscale()` and friends
 * in a `filter`/`backdrop-filter` become) cannot be carried by ANY Figma node
 * property. It is declared lost by name, never dropped quietly.
 *
 * Every one of those, and every other approximation, appends to `diagnostics`.
 * The document's own `diagnostics` are NOT merged in — they already travel with
 * the SVD; this list is what *this* translation lost on top of them.
 */
import { multiply } from '../css/matrix.js'

const VERSION = 1

/** CSS `mix-blend-mode` -> Figma `BlendMode`. */
const BLEND = {
  normal: 'NORMAL',
  multiply: 'MULTIPLY',
  screen: 'SCREEN',
  overlay: 'OVERLAY',
  darken: 'DARKEN',
  lighten: 'LIGHTEN',
  'color-dodge': 'COLOR_DODGE',
  'color-burn': 'COLOR_BURN',
  'hard-light': 'HARD_LIGHT',
  'soft-light': 'SOFT_LIGHT',
  difference: 'DIFFERENCE',
  exclusion: 'EXCLUSION',
  hue: 'HUE',
  saturation: 'SATURATION',
  color: 'COLOR',
  luminosity: 'LUMINOSITY',
}

/** Blend modes Figma only approximates. Kept apart so they can be declared. */
const BLEND_APPROX = { 'plus-lighter': 'LINEAR_DODGE' }

const EFFECT = {
  dropShadow: 'DROP_SHADOW',
  innerShadow: 'INNER_SHADOW',
  layerBlur: 'LAYER_BLUR',
  backgroundBlur: 'BACKGROUND_BLUR',
}

const GRADIENT = { linear: 'GRADIENT_LINEAR', radial: 'GRADIENT_RADIAL', angular: 'GRADIENT_ANGULAR' }

const STROKE_ALIGN = { inside: 'INSIDE', center: 'CENTER', outside: 'OUTSIDE' }
const STROKE_CAP = { butt: 'NONE', none: 'NONE', round: 'ROUND', square: 'SQUARE' }
const STROKE_JOIN = { miter: 'MITER', bevel: 'BEVEL', round: 'ROUND' }

/** Figma's style names for the nine CSS weights; the plugin fuzzy-matches from here. */
const WEIGHT_NAMES = {
  100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular', 500: 'Medium',
  600: 'Semi Bold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black',
}

const RECT_LIKE = new Set(['RECTANGLE', 'FRAME'])

/** Corner control-point ratio for a quarter ellipse as one cubic (max error ~0.02%). */
const KAPPA = 0.5522847498307936

/**
 * Above this the two radii of a corner are visibly different ellipse axes and a
 * single Figma corner radius stops being a defensible approximation, so the node
 * is emitted as a path instead. Below it, `min(rx, ry)` is used.
 */
const RADIUS_ANISOTROPY = 0.15

/** Under half a pixel of difference the approximation is not worth declaring. */
const RADIUS_EPS = 0.5

/**
 * Where the CSS conic ramp starts, in degrees clockwise from "up", when the SVD
 * gradient does not say. `conic-gradient` with no `from` starts at 12 o'clock and
 * sweeps clockwise; Figma's canonical angular space has t=0 on the +x axis, so
 * the basis below rotates by (start - 90deg). One constant, one place to correct
 * it if a probe in the plugin ever proves the seam sits elsewhere.
 */
const ANGULAR_START_DEG = 0

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const num = (v, d = 0) => (isNum(v) ? v : d)
const clamp01 = (v) => (isNum(v) ? Math.min(1, Math.max(0, v)) : 0)

/** Rounding belongs to the emitter (SVD invariant 1); `p` digits is plenty for Figma. */
function round (v, p = 4) {
  if (!isNum(v)) return 0
  const k = 10 ** p
  const n = Math.round(v * k) / k
  return Object.is(n, -0) ? 0 : n
}

const color3 = (rgba) => ({
  r: round(clamp01(rgba && rgba[0]), 6),
  g: round(clamp01(rgba && rgba[1]), 6),
  b: round(clamp01(rgba && rgba[2]), 6),
})

const color4 = (rgba) => ({ ...color3(rgba), a: round(clamp01(rgba && rgba[3]), 6) })

/** `[x, y]` or `{x, y}` -> `[x, y]`. Anything else falls back, never throws. */
function vec (v, dx, dy) {
  if (Array.isArray(v) && v.length >= 2) return [num(v[0], dx), num(v[1], dy)]
  if (isObject(v)) return [num(v.x, dx), num(v.y, dy)]
  return [dx, dy]
}

/** Inverse of the 2x3 affine `[a,b,c,d,e,f]`, or null when it is singular. */
function invert (m) {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null
  return [
    d / det, -b / det, -c / det, a / det,
    (c * f - d * e) / det, (b * e - a * f) / det,
  ]
}

/** `[a,b,c,d,e,f]` -> Figma's two-row form `[[a,c,e],[b,d,f]]`. */
const toRows = (m) => [
  [round(m[0], 6), round(m[2], 6), round(m[4], 6)],
  [round(m[1], 6), round(m[3], 6), round(m[5], 6)],
]

/** The back-to-front index (SVD invariant 3). Never re-derived, only read. */
function zOf (src) {
  const z = isObject(src) && isObject(src.paint) ? src.paint.z : undefined
  return Number.isInteger(z) ? z : 0
}

/** `root` is `"n_0"` in one spelling and `{$ref:"n_0"}` in the other; both resolve. */
function readRootId (root) {
  if (typeof root === 'string' && root) return root
  if (isObject(root) && typeof root.$ref === 'string' && root.$ref) return root.$ref
  return null
}

/**
 * @typedef {object} Diag
 * @property {string} code
 * @property {'info'|'warn'|'error'} severity
 * @property {string} [node]
 * @property {string} message
 */

// ——— paint ———

/**
 * The matrix taking Figma's canonical gradient space to the SVD's unit space.
 *
 * Canonical space is the same for all three types once you look at what Figma
 * actually samples: the linear ramp runs (0,0) -> (1,0); the radial one is the
 * circle of radius 0.5 about (0.5,0.5); the angular one sweeps clockwise about
 * (0.5,0.5) starting on +x. Placing that canonical figure onto `unit` is all
 * this function does — the paint box is `transform`'s job, and the caller's.
 */
function canonicalBasis (paint, warn) {
  const unit = isObject(paint.unit) ? paint.unit : {}
  // CONTRACT.md fixes these keys per type. They are read, never guessed: the
  // probe lists this file used to carry (`unit.from || unit.p0`) are exactly
  // what let the plugin flatten every linear gradient to top-to-bottom.
  const missing = (key, fallback) => {
    warn('figma.gradient-unit-missing', 'warn',
      `a ${paint.type} gradient has no \`unit.${key}\`, which CONTRACT.md makes mandatory; ` +
      `${fallback} is assumed and the ramp's direction or extent is wrong, not merely imprecise.`)
  }

  if (paint.type === 'linear') {
    if (!Array.isArray(unit.p0)) missing('p0', 'the box corner (0,0)')
    if (!Array.isArray(unit.p1)) missing('p1', 'the point (1,0)')
    const [fx, fy] = vec(unit.p0, 0, 0)
    const [tx, ty] = vec(unit.p1, 1, 0)
    const dx = tx - fx
    const dy = ty - fy
    // The second column is the perpendicular of the axis, which is what makes
    // the inverse's x-component the orthogonal projection onto it — i.e. what
    // makes the iso-colour lines square to the ramp.
    return [dx, dy, -dy, dx, fx, fy]
  }

  if (!Array.isArray(unit.center)) missing('center', 'the box centre (0.5, 0.5)')
  const [cx, cy] = vec(unit.center, 0.5, 0.5)

  if (paint.type === 'radial') {
    // `[rx, ry]` per the contract; a bare number is the isotropic spelling of the
    // same thing, which is unambiguous and so is taken rather than warned about.
    let rx = 0.5
    let ry = 0.5
    if (Array.isArray(unit.radius) && unit.radius.length >= 2) {
      rx = num(unit.radius[0], 0.5)
      ry = num(unit.radius[1], 0.5)
    } else if (isNum(unit.radius)) {
      rx = unit.radius
      ry = unit.radius
    } else {
      missing('radius', 'half the box (0.5)')
    }
    // 2r because the canonical circle has radius 0.5, not 1.
    return [2 * rx, 0, 0, 2 * ry, cx - rx, cy - ry]
  }

  if (!isNum(unit.startAngle)) missing('startAngle', `${ANGULAR_START_DEG}deg`)
  const start = num(unit.startAngle, ANGULAR_START_DEG)
  // CSS measures the conic ramp from "up", clockwise; Figma from +x. The extra
  // -90deg is that difference and nothing else. The contract keeps the conic's
  // rotation out of `transform` precisely so it can be composed here.
  const rad = ((start - 90) * Math.PI) / 180
  const a = Math.cos(rad)
  const b = Math.sin(rad)
  warn('figma.gradient-angular', 'info',
    `conic gradient: Figma's angular ramp is seamed at ${round(start, 2)}deg from vertical by convention; ` +
    'it has no hard stops, so a hard-stopped conic is interpolated across the seam.')
  // Unit similarity: the canonical sweep is about (0.5, 0.5) with radius 0.5, so
  // mapping it onto `unit.center` needs the rotation and the centre, nothing else.
  return [a, b, -b, a, cx - (a - b) * 0.5, cy - (b + a) * 0.5]
}

/**
 * SVD gradient geometry -> `gradientTransform`, the only handle Figma exposes.
 *
 * `box` is the shape's own width/height in px and `rect` the painted layer's
 * offset inside it (background-position/size); the whole point of this function
 * is that Figma reads the result in the shape's 0..1 space, so the px chain has
 * to be divided by the box before it is inverted. `box.ox`/`box.oy` shift the
 * shape's origin inside the element, which is how a composed border side gets
 * the part of the gradient that actually runs across it.
 */
function gradientTransform (paint, box, warn) {
  const t = Array.isArray(paint.transform) && paint.transform.length === 6
    ? paint.transform.map((n) => num(n, 0))
    : [1, 0, 0, 1, 0, 0]
  const w = num(box && box.w, 0)
  const h = num(box && box.h, 0)
  const ox = num(box && box.ox, 0)
  const oy = num(box && box.oy, 0)
  if (!(w > 0) || !(h > 0)) {
    warn('figma.gradient-boxless', 'warn',
      'a gradient sits on a node with no measurable box, so its geometry cannot be normalised into ' +
      'Figma\'s 0..1 space; the identity matrix is used and the ramp runs left to right.')
    return [[1, 0, 0], [0, 1, 0]]
  }

  const rect = layerRect(paint, w, h)
  // px -> the shape's normalized box, with the layer's own origin folded in.
  const norm = [1 / w, 0, 0, 1 / h, (rect.x - ox) / w, (rect.y - oy) / h]
  const m = multiply(norm, multiply(t, canonicalBasis(paint, warn)))

  if (paint.type === 'angular') {
    const k = w > h ? w / h : h / w
    if (k > 1.01) {
      // atan((k-1)/(2*sqrt(k))) is the peak of |theta - atan(tan(theta)/k)|.
      const peak = (Math.atan((k - 1) / (2 * Math.sqrt(k))) * 180) / Math.PI
      warn('figma.gradient-angular-anisotropic', 'warn',
        `a conic gradient sits on a ${round(w, 1)}x${round(h, 1)} box and Figma sweeps its angle in the ` +
        `shape's normalized space, so the ramp is sheared: colours land up to ${round(peak, 1)}deg away ` +
        'from where CSS puts them. Only a square box is exact.')
    }
  }

  const inv = invert(m)
  if (inv) return toRows(inv)
  warn('figma.gradient-singular', 'warn',
    'gradient geometry collapses to a line or a point and cannot be inverted into a ' +
    'gradientTransform; the identity matrix is used and the ramp will run left to right.')
  return [[1, 0, 0], [0, 1, 0]]
}

/**
 * Where a background layer is painted inside the node's box, in px. `rect` is
 * what `collectBox` measures; `placement.area` is the same box before the
 * background-size step, and is the honest fallback.
 */
function layerRect (paint, w, h) {
  const r = isObject(paint.rect) ? paint.rect
    : (isObject(paint.placement) && isObject(paint.placement.area) ? paint.placement.area : null)
  if (!r) return { x: 0, y: 0, w, h }
  return {
    x: num(r.x, 0),
    y: num(r.y, 0),
    w: num(r.w, w) > 0 ? num(r.w, w) : w,
    h: num(r.h, h) > 0 ? num(r.h, h) : h,
  }
}

/**
 * Figma's CROP transform maps the shape's normalized box onto the region of the
 * image that shows. Everything needed for that is already in the SVD: the
 * layer's rect in element-local px and the element's own box.
 */
function cropTransform (rect, w, h) {
  if (!isObject(rect) || !(rect.w > 0) || !(rect.h > 0) || !(w > 0) || !(h > 0)) return null
  return [
    [round(w / rect.w, 6), 0, round(-rect.x / rect.w, 6)],
    [0, round(h / rect.h, 6), round(-rect.y / rect.h, 6)],
  ]
}

/**
 * A replaced element's image layer, as `collectImage` hands it over.
 *
 * `crop` is the visible region of the asset in its OWN source pixels and
 * `transform` maps the unit square of that crop onto the node's border box in
 * px — between them that is every `object-fit` and `object-position` exactly.
 * Reading `p.rect` instead (which a replaced element does not have) is what
 * turned every `object-fit: contain` into a centred crop.
 *
 * @returns {{dst:{x,y,w,h}, imageTransform:number[][], covers:boolean, notes:string[]}|null}
 */
function objectPlacement (p, box, assets, warn) {
  const crop = p.crop
  if (!isObject(crop) || !Array.isArray(p.transform) || p.transform.length !== 6) return null
  const t = p.transform.map((n) => num(n, 0))
  if (!(crop.w > 0) || !(crop.h > 0) || !(t[0] > 0) || !(t[3] > 0)) {
    warn('figma.image-not-painted', 'warn',
      'object-position places the whole image outside its content box, so nothing of it is painted; ' +
      'the layer is dropped rather than shown in the wrong place.')
    return null
  }
  if (Math.abs(t[1]) > 1e-6 || Math.abs(t[2]) > 1e-6) {
    warn('figma.image-rotated', 'warn',
      'the image placement matrix is rotated or skewed and a Figma image fill is axis-aligned; ' +
      'only its bounding placement is kept.')
  }

  const asset = isObject(assets) ? assets[p.asset] : null
  let nw = isObject(asset) ? num(asset.w, 0) : 0
  let nh = isObject(asset) ? num(asset.h, 0) : 0
  if (!(nw > 0) || !(nh > 0)) {
    // Without the intrinsic size the crop cannot be normalised. Assuming it
    // reaches the far edge is exact whenever nothing was cropped off that edge,
    // which is the common case; when it is not, the placement is wrong and says so.
    nw = num(crop.x, 0) + crop.w
    nh = num(crop.y, 0) + crop.h
    if (num(crop.x, 0) > 0.01 || num(crop.y, 0) > 0.01) {
      warn('figma.image-crop-unnormalized', 'warn',
        `asset "${p.asset}" carries no intrinsic size, so the crop could not be expressed as a fraction ` +
        'of the image; the visible region is off by however much was cropped from the right and bottom.')
    }
  }

  const dst = { x: t[4], y: t[5], w: t[0], h: t[3] }
  const covers = dst.x <= 0.5 && dst.y <= 0.5 &&
    dst.x + dst.w >= num(box.w, 0) - 0.5 && dst.y + dst.h >= num(box.h, 0) - 0.5
  return {
    dst,
    covers,
    // shape-normalized -> image-normalized, which is what CROP samples through.
    imageTransform: [
      [round(crop.w / nw, 6), 0, round(num(crop.x, 0) / nw, 6)],
      [0, round(crop.h / nh, 6), round(num(crop.y, 0) / nh, 6)],
    ],
  }
}

function blendOf (css, warn, what) {
  const key = String(css || 'normal').toLowerCase()
  if (BLEND[key]) return BLEND[key]
  if (BLEND_APPROX[key]) {
    warn('figma.blend-approx', 'warn',
      `${what}: mix-blend-mode "${key}" has no exact Figma equivalent; ${BLEND_APPROX[key]} is used.`)
    return BLEND_APPROX[key]
  }
  warn('figma.blend-unsupported', 'warn',
    `${what}: mix-blend-mode "${key}" is not a Figma blend mode; NORMAL is used.`)
  return 'NORMAL'
}

/**
 * One SVD paint -> one Figma paint. `null` when nothing can be emitted, which
 * only happens for an image whose asset never resolved.
 *
 * An image layer may come back as `{paint, place}`: `place` is the sub-rectangle
 * of the node the bitmap actually occupies, which Figma cannot express with a
 * fill and the caller composes as its own shape.
 */
function toPaint (p, box, warn, assets) {
  const blendMode = blendOf(p.blend, warn, 'fill')
  // A layer opacity of its own (background-image never has one; a replaced
  // element's does) is Figma's paint opacity, not the node's.
  const layerOpacity = isNum(p.opacity) ? round(clamp01(p.opacity), 6) : 1

  if (p.type === 'solid') {
    return {
      type: 'SOLID',
      color: color3(p.color),
      opacity: round(clamp01(p.color && p.color[3]) * layerOpacity, 6),
      blendMode,
      visible: true,
    }
  }

  if (p.type === 'linear' || p.type === 'radial' || p.type === 'angular') {
    const fill = {
      type: GRADIENT[p.type],
      gradientTransform: gradientTransform(p, box, warn),
      // The contract's stop offset is `t`. This read used to be `s.p` — a private
      // dialect that `index.js` no longer emits — so every stop landed at
      // position 0 and every gradient came out flat. A stop that reaches here
      // without a numeric `t` is unplaceable, and saying so beats stacking it at 0.
      gradientStops: (Array.isArray(p.stops) ? p.stops : []).map((s, i, all) => {
        if (!isNum(s && s.t)) {
          warn('figma.gradient-stop-unplaced', 'warn',
            `gradient stop ${i + 1} of ${all.length} carries no numeric \`t\`; it is placed by its ` +
            'index in the list, which is not where the browser painted it.')
          return {
            position: all.length > 1 ? round(i / (all.length - 1), 6) : 0,
            color: color4(s && s.color),
          }
        }
        return { position: round(clamp01(s.t), 6), color: color4(s.color) }
      }),
      blendMode,
      visible: true,
    }
    if (layerOpacity !== 1) fill.opacity = layerOpacity
    return fill
  }

  if (p.type === 'image') {
    if (typeof p.asset !== 'string' || !p.asset) {
      warn('figma.image-asset-unresolved', 'error',
        'an image fill still carries an unresolved asset; the layer is dropped.')
      return null
    }
    const fit = String(p.fit || 'stretch').toLowerCase()
    const repeat = isObject(p.placement) && isObject(p.placement.repeat) ? p.placement.repeat : null
    const tiled = repeat && (repeat.x === 'repeat' || repeat.y === 'repeat')

    // `imageHash` is the plugin's to fill in: only the sandbox can call
    // `figma.createImage`. `asset` is the id it resolves against `document.assets`.
    const fill = { type: 'IMAGE', imageHash: null, asset: p.asset, blendMode, visible: true }
    if (layerOpacity !== 1) fill.opacity = layerOpacity

    // A replaced element: `crop` + `transform` say exactly where the bitmap goes.
    const placed = objectPlacement(p, box, assets, warn)
    if (placed) {
      fill.scaleMode = 'CROP'
      fill.imageTransform = placed.imageTransform
      return placed.covers ? fill : { paint: fill, place: placed.dst }
    }
    if (isObject(p.crop)) return null // objectPlacement already said why

    if (tiled) {
      fill.scaleMode = 'TILE'
      // Figma's scalingFactor is the tile size relative to the image's own size;
      // without an intrinsic size there is nothing to take the ratio against.
      const asset = isObject(assets) ? assets[p.asset] : null
      const natural = num(p.assetWidth, isObject(asset) ? num(asset.w, 0) : 0)
      const rect = isObject(p.rect) ? p.rect : (isObject(p.placement) ? p.placement.area : null)
      fill.scalingFactor = isObject(rect) && rect.w > 0 && natural > 0
        ? round(rect.w / natural, 6)
        : 1
      if (fill.scalingFactor === 1 && !(natural > 0)) {
        warn('figma.image-repeat-approx', 'warn',
          'a repeating background is tiled at 1:1 because the image\'s intrinsic size is not in the document.')
      }
      if (repeat.x !== repeat.y) {
        warn('figma.image-repeat-approx', 'warn',
          `background-repeat differs per axis (x:${repeat.x}, y:${repeat.y}); Figma tiles both.`)
      }
      return fill
    }

    if (fit === 'cover') { fill.scaleMode = 'FILL'; return fill }
    if (fit === 'contain') { fill.scaleMode = 'FIT'; return fill }

    const crop = cropTransform(p.rect, box.w, box.h)
    if (crop) {
      fill.scaleMode = 'CROP'
      fill.imageTransform = crop
      const r = p.rect
      const covers = r.x <= 1e-6 && r.y <= 1e-6 && r.x + r.w >= box.w - 1e-6 && r.y + r.h >= box.h - 1e-6
      if (!covers) {
        warn('figma.image-fit-approx', 'warn',
          'the image does not cover its box; Figma clamps the edge pixels outside the crop instead of ' +
          'leaving it transparent.')
      }
      return fill
    }

    fill.scaleMode = 'FILL'
    warn('figma.image-fit-approx', 'warn',
      `object-fit "${fit}" could not be placed exactly (no resolved layer rect); the image is emitted as FILL.`)
    return fill
  }

  warn('figma.paint-unsupported', 'warn', `paint type "${p.type}" has no Figma equivalent; it is dropped.`)
  return null
}

/**
 * `toPaint` for the call sites that have nowhere to put a composed shape — a
 * border side, a text run. The sub-rectangle is lost there, so it is declared.
 */
function toPaintFlat (p, box, warn, assets) {
  const res = toPaint(p, box, warn, assets)
  if (isObject(res) && isObject(res.paint)) {
    warn('figma.image-placement-flattened', 'warn',
      'an image only covers part of this layer and this layer cannot host a shape of its own, ' +
      'so the bitmap is stretched across the whole of it.')
    return res.paint
  }
  return res
}

/**
 * Figma only accepts a shadow `spread` on rectangles and ellipses, and on
 * frames that both have a visible fill and clip their content. Everywhere else
 * it is rejected, so it is dropped here — loudly — rather than at runtime.
 */
function spreadAllowed (node) {
  if (node.type === 'RECTANGLE' || node.type === 'ELLIPSE') return true
  return node.type === 'FRAME' && node.clipsContent === true &&
    node.fills.some((f) => f.visible !== false)
}

/**
 * The CSS function an effect came from, in the spelling the page wrote, or null.
 *
 * A colour effect is only worth declaring if the message can NAME it — "a colour
 * filter was dropped" sends the reader back to the stylesheet, "saturate(180%)
 * was dropped" does not. `srcCss` is where `collect/box.js` puts it and the
 * schema REQUIRES it on a `colorMatrix` (`svd/src/schema.js`, `checkColorMatrix`),
 * so it is read first; the other spellings are tried for a document that reached
 * here without validating, and the caller says so when none of them is there.
 */
function filterSourceCss (e) {
  for (const key of ['srcCss', 'css', 'fn', 'function']) {
    const v = e[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  if (Array.isArray(e.functions) && e.functions.length) {
    const list = e.functions.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim())
    if (list.length) return list.join(' ')
  }
  return null
}

function toEffect (e, node, warn) {
  // Not in `EFFECT` and never will be: Figma's effect vocabulary is shadows and
  // blurs, and a colour matrix is neither. `feColorMatrix` has no counterpart in
  // any Figma node property — not an effect, not a paint, not a blend mode — so
  // there is nothing to approximate it WITH, and an approximation nobody can
  // build is a loss to declare, by name, not a type to fall through the generic
  // "unsupported" arm that names only the SVD word `colorMatrix`.
  if (e.type === 'colorMatrix') {
    const css = filterSourceCss(e)
    const prop = e.backdrop === true ? 'backdrop-filter' : 'filter'
    warn('figma.effect-colormatrix-dropped', 'warn',
      `${prop}: ${css || '(a colour matrix whose `srcCss` is missing, so it cannot be named)'} recolours ` +
      `${e.backdrop === true ? 'everything behind this node' : 'this node and its contents'}. ` +
      'Figma has four effect types — DROP_SHADOW, INNER_SHADOW, LAYER_BLUR, BACKGROUND_BLUR — and no ' +
      'colour-matrix effect anywhere in the Plugin API: not as an effect, not as a paint, not as a blend ' +
      'mode. There is nothing to approximate it with, so it is dropped and the colours arrive unfiltered ' +
      '— a saturate() or hue-rotate() backdrop lands as the plain backdrop.')
    return null
  }
  const type = EFFECT[e.type]
  if (!type) {
    warn('figma.effect-unsupported', 'warn', `effect "${e.type}" has no Figma equivalent; it is dropped.`)
    return null
  }
  // Figma's blur radius is the CSS radius (SVD invariant 5 halves it for SVG
  // sigma and only for SVG) — nothing is converted here.
  if (type === 'LAYER_BLUR' || type === 'BACKGROUND_BLUR') {
    return { type, blurType: 'NORMAL', radius: round(Math.max(0, num(e.blur, 0))), visible: true }
  }
  const effect = {
    type,
    color: color4(e.color),
    offset: { x: round(num(e.offset && e.offset[0], 0)), y: round(num(e.offset && e.offset[1], 0)) },
    radius: round(Math.max(0, num(e.blur, 0))),
    visible: true,
    blendMode: 'NORMAL',
  }
  const spread = num(e.spread, 0)
  if (spread !== 0) {
    if (spreadAllowed(node)) effect.spread = round(spread)
    else {
      warn('figma.effect-spread-dropped', 'warn',
        `a shadow spread of ${round(spread)}px is dropped: Figma accepts spread only on rectangles, ` +
        `ellipses and clipping frames with a fill, and this node is a ${node.type}.`)
    }
  }
  if (type === 'DROP_SHADOW') effect.showShadowBehindNode = e.behind === true
  return effect
}

// ——— geometry ———

/**
 * Radii -> what Figma can hold.
 *
 * `corners` are the four isotropic radii when one number per corner is still
 * honest; `path` is set instead when a corner's two axes differ by more than
 * RADIUS_ANISOTROPY and the node has to become a VECTOR to keep its shape.
 */
function readRadii (radii, w, h, warn) {
  if (!Array.isArray(radii) || radii.length !== 4) return { corners: null, path: false }
  let anisotropic = false
  let approximated = 0
  const corners = radii.map((corner) => {
    const rx = Math.max(0, num(corner && corner[0], 0))
    const ry = Math.max(0, num(corner && corner[1], 0))
    const max = Math.max(rx, ry)
    if (max > 0) {
      const delta = Math.abs(rx - ry)
      if (delta / max > RADIUS_ANISOTROPY) anisotropic = true
      else if (delta > RADIUS_EPS) approximated++
    }
    return Math.min(rx, ry)
  })
  if (anisotropic) {
    warn('figma.radii-anisotropic', 'info',
      'a corner radius is elliptical beyond 15%; the node is emitted as a VECTOR path instead of a ' +
      'rectangle, because Figma corner radii are circular.')
    return { corners, path: true, w, h }
  }
  if (approximated) {
    warn('figma.radii-approx', 'info',
      `${approximated} corner radius/radii are slightly elliptical; min(rx, ry) is used.`)
  }
  return { corners, path: false }
}

/** A rounded rectangle with elliptical corners as absolute M/L/C/Z — Figma's path subset. */
function roundedRectPath (w, h, radii) {
  const c = (radii || []).map((corner) => {
    const rx = Math.min(Math.max(0, num(corner && corner[0], 0)), w / 2)
    const ry = Math.min(Math.max(0, num(corner && corner[1], 0)), h / 2)
    return [rx, ry]
  })
  const [tl, tr, br, bl] = c.length === 4 ? c : [[0, 0], [0, 0], [0, 0], [0, 0]]
  const n = (v) => round(v, 3)
  const k = KAPPA
  const out = [`M ${n(tl[0])} 0`]
  out.push(`L ${n(w - tr[0])} 0`)
  if (tr[0] || tr[1]) {
    out.push(`C ${n(w - tr[0] + tr[0] * k)} 0 ${n(w)} ${n(tr[1] - tr[1] * k)} ${n(w)} ${n(tr[1])}`)
  }
  out.push(`L ${n(w)} ${n(h - br[1])}`)
  if (br[0] || br[1]) {
    out.push(`C ${n(w)} ${n(h - br[1] + br[1] * k)} ${n(w - br[0] + br[0] * k)} ${n(h)} ${n(w - br[0])} ${n(h)}`)
  }
  out.push(`L ${n(bl[0])} ${n(h)}`)
  if (bl[0] || bl[1]) {
    out.push(`C ${n(bl[0] - bl[0] * k)} ${n(h)} 0 ${n(h - bl[1] + bl[1] * k)} 0 ${n(h - bl[1])}`)
  }
  out.push(`L 0 ${n(tl[1])}`)
  if (tl[0] || tl[1]) {
    out.push(`C 0 ${n(tl[1] - tl[1] * k)} ${n(tl[0] - tl[0] * k)} 0 ${n(tl[0])} 0`)
  }
  out.push('Z')
  return out.join(' ')
}

/**
 * SVD transform -> Figma placement.
 *
 * Figma cannot hold scale in `relativeTransform` (it renormalizes it) and has no
 * skew at all, so the scale is folded into width/height and a non-zero skew is
 * escalated to the caller as a degradation.
 */
function placement (src, warn) {
  const frame = isObject(src.frame) ? src.frame : { x: 0, y: 0, w: 0, h: 0 }
  const base = {
    x: round(num(frame.x)),
    y: round(num(frame.y)),
    width: round(Math.max(0, num(frame.w))),
    height: round(Math.max(0, num(frame.h))),
    place: null,
  }
  const t = src.transform
  if (!isObject(t) || !Array.isArray(t.m) || t.m.length !== 6) return base

  const m = t.m.map((n) => num(n, 0))
  const d = isObject(t.decomposed) ? t.decomposed : {}
  const rot = num(d.rot, 0)
  const sx = num(d.sx, 1)
  const sy = num(d.sy, 1)

  if (Math.abs(num(d.skewX, 0)) > 1e-6) {
    warn('figma.skew', 'warn',
      `transform carries skewX ${round(d.skewX, 3)}deg and Figma has no skew; the node must be ` +
      'outlined or rasterized to keep its shape.')
    base.degrade = { action: src.type === 'text' ? 'OUTLINE' : 'RASTER', reason: 'skewX' }
  }
  if (sx < 0 || sy < 0) {
    warn('figma.flip', 'warn',
      'transform mirrors the node and Figma\'s relativeTransform cannot hold a reflection; ' +
      'the absolute scale is used and the flip is lost.')
  }

  const rad = (rot * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  // `m` already has transform-origin baked in, so the element's own (0,0) lands
  // at (m[4], m[5]) inside its frame.
  const x = num(frame.x) + m[4]
  const y = num(frame.y) + m[5]

  return {
    x: round(x),
    y: round(y),
    width: round(Math.max(0, num(frame.w) * Math.abs(sx))),
    height: round(Math.max(0, num(frame.h) * Math.abs(sy))),
    // Figma's rotation is counter-clockwise; the SVD's is CSS clockwise.
    rotation: round(-rot, 4),
    relativeTransform: toRows([cos, sin, -sin, cos, x, y]),
    degrade: base.degrade,
    place: { cos, sin, x, y, sx: Math.abs(sx), sy: Math.abs(sy) },
  }
}

/**
 * Position a composed sibling given in the owner's local px, in the owner's
 * parent's space. Without a transform it is a translation; with one it inherits
 * the owner's rotation and scale so the four border shapes stay on the border.
 */
function placeLocal (box, x, y, w, h) {
  const p = box.place
  if (!p) {
    return { x: round(box.x + x), y: round(box.y + y), width: round(w), height: round(h) }
  }
  const lx = x * p.sx
  const ly = y * p.sy
  const ox = p.x + p.cos * lx - p.sin * ly
  const oy = p.y + p.sin * lx + p.cos * ly
  return {
    x: round(ox),
    y: round(oy),
    width: round(w * p.sx),
    height: round(h * p.sy),
    rotation: round(-Math.atan2(p.sin, p.cos) * 180 / Math.PI, 4),
    relativeTransform: toRows([p.cos, p.sin, -p.sin, p.cos, ox, oy]),
  }
}

// ——— strokes ———

/** SVD carries `weight` (schema) and `weights` (collectBox); both mean the same thing. */
function sideWeights (stroke) {
  const w = stroke.weight !== undefined ? stroke.weight : stroke.weights
  if (isNum(w)) return [w, w, w, w]
  if (Array.isArray(w) && w.length === 4) return w.map((n) => Math.max(0, num(n, 0)))
  return [0, 0, 0, 0]
}

const sameWeights = (w) => w[0] === w[1] && w[1] === w[2] && w[2] === w[3]

/** Per-side colours, when the collector could not fold them into one paint. */
function sidePaints (stroke) {
  if (!Array.isArray(stroke.sides) || stroke.sides.length !== 4) return null
  return stroke.sides.map((s) => (
    isObject(s) && Array.isArray(s.color) ? { type: 'solid', color: s.color } : null
  ))
}

/**
 * The four filled shapes a border becomes when Figma cannot express it: a
 * non-rect-like node with differing weights, or four differing colours. The
 * mitre is what this loses — the corners overlap instead of meeting on the
 * diagonal — and that is why it is a diagnostic and not a silent rewrite.
 */
function composeSides (stroke, box, name, warn, reason) {
  const weights = sideWeights(stroke)
  const paints = sidePaints(stroke)
  const w = box.width
  const h = box.height
  const geom = [
    [0, 0, w, weights[0]],
    [w - weights[1], 0, weights[1], h],
    [0, h - weights[2], w, weights[2]],
    [0, 0, weights[3], h],
  ]
  const labels = ['top', 'right', 'bottom', 'left']
  warn('figma.stroke-per-side-composed', 'info',
    `${reason}; the border is composed as four filled shapes and the mitred corners overlap instead.`)
  const out = []
  for (let i = 0; i < 4; i++) {
    const [x, y, sw, sh] = geom[i]
    if (!(sw > 0) || !(sh > 0)) continue
    const paint = paints && paints[i] ? paints[i] : stroke.paint
    if (!isObject(paint)) continue
    // `ox`/`oy`: the side is a window onto the element's own box, so a gradient
    // border keeps running across the element instead of restarting per side.
    const fill = toPaintFlat(paint, { w: sw, h: sh, ox: x, oy: y }, warn)
    if (!fill) continue
    out.push({
      type: 'RECTANGLE',
      name: `${name} / border ${labels[i]}`,
      ...placeLocal(box, x, y, sw, sh),
      fills: [fill],
      strokes: [],
      effects: [],
      children: [],
      composed: 'border-side',
    })
  }
  return out
}

// ——— text ———

/** `"Inter var", system-ui, sans-serif` -> `Inter var`. */
function firstFamily (stack) {
  if (typeof stack !== 'string') return null
  let depth = 0
  let quote = ''
  let buf = ''
  for (const ch of stack) {
    if (quote) {
      if (ch === quote) quote = ''
      else buf += ch
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) break
    buf += ch
  }
  const name = buf.trim()
  return name || null
}

function weightStyleName (weight, italic) {
  const w = Math.min(900, Math.max(100, Math.round(num(weight, 400) / 100) * 100))
  const name = WEIGHT_NAMES[w] || 'Regular'
  if (!italic) return name
  return name === 'Regular' ? 'Italic' : `${name} Italic`
}

/**
 * The `{family, style}` Figma will be asked to load.
 *
 * The `name` table beats the CSS stack every time: the page says "Inter var",
 * the binary says Inter / Semi Bold, and only the second one exists in Figma.
 */
function fontOf (style, assets, warn) {
  const asset = typeof style.font === 'string' ? assets[style.font] : null
  const table = isObject(asset) && isObject(asset.nameTable) ? asset.nameTable : {}
  const pick = (a, b) => {
    const v = table[a] !== undefined ? table[a] : table[b]
    return typeof v === 'string' && v.trim() ? v.trim() : null
  }
  const family = pick('16', '1') || firstFamily(style.stack) || 'Inter'
  const sub = pick('17', '2') || weightStyleName(style.weight, style.italic === true)
  if (isObject(asset) && asset.synthetic === true) {
    warn('figma.font-synthetic', 'warn',
      `"${family} ${sub}" is a synthesised bold/italic; no editor has that face, so the run must be outlined.`)
  }
  return { family, style: sub }
}

/** Figma holds three decoration styles; everything else collapses onto SOLID. */
const DECORATION_STYLE = { solid: 'SOLID', dotted: 'DOTTED', wavy: 'WAVY' }

/**
 * `text-decoration` -> the three `setRange*` values Figma has for it.
 *
 * The SVD carries `style.decoration` as the ARRAY of every decoration that
 * propagated onto the run (an `<a>` and a `<span>` can each contribute one), so
 * an array is the shape to expect; the scalar spellings are accepted because a
 * single decoration is not worth a wrapper. Reading only `decoration.line` — the
 * old behaviour — silently returned NONE for every underline in the document.
 */
function decorationOf (decoration, warn) {
  const none = { textDecoration: 'NONE' }
  if (!decoration) return none

  const list = (Array.isArray(decoration) ? decoration : [decoration])
    .map((d) => (typeof d === 'string' ? { line: d } : d))
    .filter((d) => isObject(d) && typeof d.line === 'string' && d.line && d.line !== 'none')
  if (!list.length) return none

  const lines = list.map((d) => d.line.toLowerCase()).join(' ')
  const under = lines.includes('underline')
  const strike = lines.includes('line-through') || lines.includes('strikethrough')
  // The first entry that actually draws is the one whose style and colour win.
  const src = list.find((d) => /underline|line-through|strikethrough/.test(d.line.toLowerCase())) || list[0]

  if (lines.includes('overline') && !under && !strike) {
    warn('figma.text-decoration-dropped', 'warn',
      'text-decoration:overline has no Figma equivalent; the run is emitted undecorated.')
    return none
  }
  if (under && strike) {
    warn('figma.text-decoration-approx', 'warn',
      'a run is both underlined and struck through; Figma holds one decoration per range, so the ' +
      'underline is kept and the strikethrough is lost.')
  }

  const out = { textDecoration: under ? 'UNDERLINE' : 'STRIKETHROUGH' }
  const styleName = String(src.style || 'solid').toLowerCase()
  if (DECORATION_STYLE[styleName]) {
    if (styleName !== 'solid') out.textDecorationStyle = DECORATION_STYLE[styleName]
  } else {
    warn('figma.text-decoration-approx', 'info',
      `text-decoration-style "${styleName}" is not one of Figma's (solid, dotted, wavy); solid is used.`)
  }
  // Figma's own shapes for these two: `{value: SolidPaint}` and `{unit, value}`.
  // They are newer than the rest of the text API, so the plugin applies them
  // defensively — but it never has to invent them.
  if (Array.isArray(src.color)) {
    out.textDecorationColor = {
      value: { type: 'SOLID', color: color3(src.color), opacity: round(clamp01(src.color[3]), 6) },
    }
  }
  if (isNum(src.thickness) && src.thickness > 0) {
    out.textDecorationThickness = { unit: 'PIXELS', value: round(src.thickness, 3) }
  }
  return out
}

const ALIGN = { left: 'LEFT', right: 'RIGHT', center: 'CENTER', justify: 'JUSTIFIED' }

/**
 * `font-variant-caps` values Figma's `textCase` holds exactly.
 *
 * This is the one half of `font-variant` that Figma can carry, and it carries it
 * per RANGE (`setRangeTextCase`), which is why it belongs on the setRange entry
 * and not on the node. It repaints letters, so losing it is visible: a run set in
 * small caps arrives in full lowercase.
 */
const CAPS_CASE = { 'small-caps': 'SMALL_CAPS', 'all-small-caps': 'SMALL_CAPS_FORCED' }

/** Caps values Figma has no separate setting for; they collapse onto small caps. */
const CAPS_APPROX = new Set(['petite-caps', 'all-petite-caps', 'unicase', 'titling-caps'])

/**
 * The SVD's `variant` — the whole `font-variant` shorthand, with
 * `font-variant-caps` merged in by `collect/text.js` — split into the part Figma
 * holds and the part it does not.
 *
 * The numeric half (`tabular-nums`, `lining-nums`, `oldstyle-nums`, `slashed-zero`,
 * ligature and position keywords) is OpenType feature selection, and the Plugin
 * API exposes no feature control at all — same wall as `font-feature-settings`.
 * It is returned so the caller can declare it once per block instead of once per
 * run.
 *
 * @returns {{textCase: string|null, approx: string|null, dropped: string[]}}
 */
function variantOf (variant) {
  const out = { textCase: null, approx: null, dropped: [] }
  if (typeof variant !== 'string') return out
  for (const token of variant.trim().toLowerCase().split(/\s+/)) {
    if (!token || token === 'normal' || token === 'none') continue
    if (CAPS_CASE[token]) { out.textCase = CAPS_CASE[token]; continue }
    if (CAPS_APPROX.has(token)) {
      out.textCase = out.textCase || 'SMALL_CAPS'
      out.approx = token
      continue
    }
    out.dropped.push(token)
  }
  return out
}

/**
 * `-webkit-text-stroke` as a Figma stroke, or null when there is none.
 *
 * CSS centres the text stroke on the glyph outline and paints it over the fill;
 * so does Figma with `strokeAlign: 'CENTER'`, and the weight is the same number
 * in both. That makes this exact — the only reason it needs a function is that
 * Figma holds the stroke on the NODE and CSS holds it on the run.
 */
function textStrokeOf (style) {
  const width = num(style.strokeWidth, 0)
  if (!(width > 0) || !Array.isArray(style.strokeColor)) return null
  return {
    key: `${round(width, 4)}|${style.strokeColor.map((c) => round(num(c, 0), 6)).join(',')}`,
    strokes: [{
      type: 'SOLID',
      color: color3(style.strokeColor),
      opacity: round(clamp01(style.strokeColor[3]), 6),
      blendMode: 'NORMAL',
      visible: true,
    }],
    strokeWeight: round(width, 4),
    strokeAlign: 'CENTER',
  }
}

/**
 * How much wider the widest line of this block would arrive if it went through
 * the SVG-paste route instead of this payload: the letter-spacing of every run,
 * times the characters it covers on that line.
 *
 * Figma's SVG importer ignores `letter-spacing` entirely (FIGMA_FINDINGS.md §5,
 * measured by pasting, four ways of forcing it tried and rejected), and the
 * Plugin API does not. This number is the size of that difference, and it is the
 * only reason a consumer can be told which route to take before it pastes.
 */
function svgPasteWidthDelta (lines, runs, styles) {
  let worst = 0
  for (const line of lines) {
    if (!isObject(line) || !isNum(line.start) || !isNum(line.end)) continue
    let delta = 0
    for (const run of runs) {
      if (!isObject(run)) continue
      const from = Math.max(num(run.start, 0), line.start)
      const to = Math.min(num(run.end, 0), line.end)
      if (to <= from) continue
      const style = isObject(styles[run.style]) ? styles[run.style] : {}
      delta += Math.abs(num(style.letterSpacing, 0)) * (to - from)
    }
    if (delta > worst) worst = delta
  }
  return worst
}

/**
 * Everything a TEXT node needs, including the `setRange*` instruction list.
 *
 * The width is where the two engines disagree: CSS counts the letter-spacing
 * that follows the last glyph inside the line box and Figma does not, so a box
 * measured in CSS is `ls` too wide — and a box that is even 0.3px too NARROW
 * reflows the whole line. Hence: compensate the trailing spacing, add a pixel of
 * slack, and shift the box by both wherever the alignment pins the other edge.
 */
function buildText (src, id, doc, ctx, warn) {
  const t = src.text
  if (!isObject(t) || typeof t.characters !== 'string' || !t.characters) {
    warn('figma.text-missing', 'error', 'a text node carries no characters; it is emitted as an empty frame.')
    return null
  }
  const styles = isObject(doc.styles) && isObject(doc.styles.text) ? doc.styles.text : {}
  const assets = isObject(doc.assets) ? doc.assets : {}
  const runs = Array.isArray(t.runs) ? t.runs : []
  const emit = isObject(t.emit) ? t.emit : {}
  const frame = isObject(src.frame) ? src.frame : { x: 0, y: 0, w: 0, h: 0 }
  // A gradient glyph fill is normalised against the text block's own box, which
  // is the closest thing Figma has to `background-clip: text`.
  const glyphBox = { w: num(frame.w, 0), h: num(frame.h, 0) }

  const setRange = []
  let base = null
  let lsMismatch = 0
  let dyRuns = 0
  const openType = new Set()
  const variantDropped = new Set()
  const variantApprox = new Set()
  // `-webkit-text-stroke` is a Figma stroke on the NODE, so the runs have to
  // agree before one can be emitted: contouring the glyphs of a run that carries
  // no stroke is wrong output, and wrong output is worse than plain output.
  const strokeKeys = new Set()
  let strokeSpec = null
  let strokedRuns = 0
  let plainRuns = 0
  const ls = num(t.letterSpacing, 0)

  for (const run of runs) {
    if (!isObject(run)) continue
    const style = isObject(styles[run.style]) ? styles[run.style] : {}
    const fontName = fontOf(style, assets, warn)
    const start = Math.max(0, Math.round(num(run.start, 0)))
    const end = Math.max(0, Math.round(num(run.end, 0)))
    // The preflight is only useful if it says how much of the document each font
    // carries, so the counts are accumulated here, at run level, where they exist.
    ctx.fonts.record(fontName, style, id, Math.max(0, end - start), emit)
    const fills = (Array.isArray(style.fills) ? style.fills : [])
      .map((p) => toPaintFlat(p, glyphBox, warn, assets))
      .filter(Boolean)
    const entry = {
      start,
      end,
      fontName,
      fontSize: round(Math.max(1, num(style.size, 16)), 3),
      fills,
      hyperlink: typeof run.href === 'string' && run.href ? { type: 'URL', value: run.href } : null,
      ...decorationOf(style.decoration, warn),
    }
    // The measured baseline offset of a raised/lowered run. Figma's Plugin API
    // has no per-range baseline shift, so this rides along for a consumer that
    // wants to nudge the glyphs itself and is declared below as a loss.
    if (isNum(run.dy) && run.dy !== 0) {
      entry.baselineShift = round(run.dy, 3)
      dyRuns++
    }
    // Letter-spacing IS in the plugin model, per range, so it travels per range —
    // unconditionally, so the plugin calls `setRangeLetterSpacing` for every run
    // instead of inferring which ones inherit the node's value. This is where the
    // two routes into Figma diverge; see the header. `PIXELS` because the SVD
    // resolved `letter-spacing` to px in the browser.
    if (isNum(style.letterSpacing)) {
      entry.letterSpacing = { unit: 'PIXELS', value: round(style.letterSpacing, 4) }
    }
    // Small caps repaint the letters and Figma sets them per range. The node's
    // own `textCase` stays ORIGINAL: `characters` is already text-transformed.
    const variant = variantOf(style.variant)
    if (variant.textCase) entry.textCase = variant.textCase
    if (variant.approx) variantApprox.add(variant.approx)
    for (const token of variant.dropped) variantDropped.add(token)

    const stroke = textStrokeOf(style)
    if (stroke) {
      strokedRuns++
      strokeKeys.add(stroke.key)
      if (!strokeSpec) strokeSpec = stroke
    } else if (end > start) {
      plainRuns++
    }
    // OpenType features and variable-font axes are computed CSS strings. The
    // Plugin API exposes neither, so they can only be declared — silently
    // dropping them is exactly the failure the audit names.
    const otf = typeof style.features === 'string' ? style.features.trim() : ''
    const vf = typeof style.variations === 'string' ? style.variations.trim() : ''
    if (otf && otf !== 'normal') openType.add(otf)
    if (vf && vf !== 'normal') openType.add(vf)
    if (isNum(style.letterSpacing) && Math.abs(style.letterSpacing - ls) > 1e-6) lsMismatch++
    setRange.push(entry)
    if (!base) base = entry
  }

  if (!base) {
    warn('figma.text-missing', 'error', 'a text node has no styled runs; its font cannot be preloaded.')
    return null
  }
  if (lsMismatch) {
    warn('figma.text-letterspacing-run', 'info',
      `${lsMismatch} run(s) have a letter-spacing of their own, different from the block's ${round(ls, 4)}px. ` +
      'It is NOT lost here: each carries its own `setRange[].letterSpacing` and the plugin applies it with ' +
      'setRangeLetterSpacing, which the Plugin API does expose. (Pasting the SVG instead loses every one of ' +
      'them — see FIGMA_FINDINGS.md §5.)')
  }
  if (openType.size) {
    warn('figma.text-opentype-dropped', 'warn',
      `the block asks for ${[...openType].map((v) => JSON.stringify(v)).join(', ')} ` +
      '(font-feature-settings / font-variation-settings); the Plugin API exposes neither, so the ' +
      'run is set with the face defaults.')
  }
  if (variantApprox.size) {
    warn('figma.text-variant-approx', 'info',
      `font-variant-caps: ${[...variantApprox].join(', ')} has no Figma setting of its own; the range is set ` +
      'to SMALL_CAPS, which is the nearest thing Figma draws.')
  }
  if (variantDropped.size) {
    warn('figma.text-variant-dropped', 'warn',
      `the block asks for font-variant ${[...variantDropped].join(' ')}; those are OpenType feature ` +
      'selections (figures, ligatures, positions) and the Plugin API exposes no feature control, so the ' +
      'runs are set with the face defaults — proportional, lining figures where the page asked otherwise. ' +
      'Only the caps half of font-variant survives, as textCase.')
  }
  if (strokedRuns && (plainRuns || strokeKeys.size > 1)) {
    warn('figma.text-stroke-dropped', 'warn',
      `${strokedRuns} run(s) carry -webkit-text-stroke and ` +
      (strokeKeys.size > 1
        ? `they do not agree (${strokeKeys.size} different width/colour pairs)`
        : `${plainRuns} run(s) in the same block carry none`) +
      '. A Figma stroke belongs to the whole text node and there is no per-range stroke, so applying it ' +
      'would contour glyphs the page does not contour: it is dropped instead, and the outlined glyphs ' +
      'arrive solid. (`emit/svg-flat.js` keeps it — SVG has per-tspan stroke.)')
  }
  if (dyRuns) {
    warn('figma.text-baseline-shift', 'warn',
      `${dyRuns} run(s) sit off the line baseline (superscript, subscript, vertical-align); the Plugin ` +
      'API has no per-range baseline shift, so the measured offset rides on `setRange[].baselineShift` ' +
      'and Figma paints those glyphs on the baseline.')
  }
  if (t.direction === 'rtl') {
    warn('figma.text-direction', 'warn',
      'the block is right-to-left; the Plugin API exposes no direction, so the logical string is emitted ' +
      'and Figma re-orders it with its own bidi.')
  }

  const lines = Array.isArray(t.lines) ? t.lines : []

  // The break hyphen is measured (`collect.text-hyphen`) and the flat-SVG backend
  // paints it back on, because there each line is its own positioned piece and the
  // hyphen lands exactly where the browser drew it. Here it is DECLARED LOST, and
  // deliberately: a Figma TextNode reflows its own `characters` to its own box with
  // its own substituted font, so the break falls somewhere else and a hyphen written
  // into the string would end up in the middle of a word. A missing hyphen reads as
  // a break Figma made; a stray one reads as a spelling mistake.
  const hyphenAt = []
  lines.forEach((l, i) => {
    if (isObject(l) && typeof l.hyphen === 'string' && l.hyphen) hyphenAt.push(i)
  })
  const hyphenLines = hyphenAt.length
  if (hyphenLines) {
    warn('figma.text-hyphen-dropped', 'warn',
      `${hyphenLines} line(s) end in a hyphen the browser painted at a hyphenation break (on \`line.hyphen\`; ` +
      'it is not in `characters`). It is NOT written into the string: Figma reflows the TextNode with its own ' +
      'box and its own font, so the break moves and the hyphen would land inside a word. The words arrive ' +
      'whole and the hyphenation is Figma\'s to redo.')
  }

  // Counted for the document-level entry in `svdToFigma`: what this block keeps
  // that the other route into Figma would drop.
  const pasteDelta = svgPasteWidthDelta(lines, runs, styles)
  if (pasteDelta > 0.5) {
    ctx.letterSpacingBlocks++
    if (pasteDelta > ctx.letterSpacingWorstPx) ctx.letterSpacingWorstPx = pasteDelta
  }

  const comp = num(t.trailingSpacingComp, ls)
  const slack = num(t.widthSlackPx, 1)
  const pitch = Math.max(0.01, num(t.pitch, base.fontSize))

  const align = ALIGN[String(t.align || 'left').toLowerCase()] ||
    (String(t.align).toLowerCase() === 'end'
      ? (t.direction === 'rtl' ? 'LEFT' : 'RIGHT')
      : String(t.align).toLowerCase() === 'start'
        ? (t.direction === 'rtl' ? 'RIGHT' : 'LEFT')
        : 'LEFT')
  if (align === 'JUSTIFIED') {
    warn('figma.text-justified', 'info',
      'the block is justified; Figma justifies to its own box width, so the inter-word spacing is ' +
      'recomputed even though the line breaks are preserved.')
  }

  // The text box is the INK, not the element: `frame` is the block's border box,
  // so using it puts every padded block's first glyph a padding-left too far
  // left and a padding-top too high. `lines[].x` and `lines[].baseline` are
  // measured and are what the box has to be pinned to.
  const placed = lines.length > 0 && lines.every((l) => isObject(l) && isNum(l.x) && isNum(l.w))
  const originX = placed ? Math.min(...lines.map((l) => l.x)) : 0
  const rightEdge = placed
    ? Math.max(...lines.map((l) => l.x + l.w))
    : Math.max(num(frame.w), 0)
  const contentW = Math.max(0, rightEdge - originX)
  if (!placed && lines.length) {
    warn('figma.text-unmeasured-lines', 'warn',
      'a text block has lines with no measured x/width, so its box falls back to the element box; ' +
      'any padding on that element shifts the text by exactly that padding.')
  }

  // Figma's line is `comp` narrower than the CSS one (CSS keeps the spacing that
  // follows the last glyph, Figma drops it) and 0.3px too narrow reflows the
  // whole line, so `slack` is added and the pinned edge is compensated back.
  const width = Math.max(0, contentW - comp) + slack
  const dx = originX + (align === 'RIGHT' ? -slack : align === 'CENTER' ? -slack / 2 : 0)

  // Figma exposes no way to set a baseline: it stacks lines from the box top by
  // `lineHeight`, putting the first baseline at halfLeading + ascent. Solving
  // that for the top is what turns a measured baseline into a y.
  const first = lines.length && isObject(lines[0]) ? lines[0] : null
  const asc = first && isNum(first.asc) ? first.asc : null
  const desc = first && isNum(first.desc) ? num(first.desc, 0) : 0
  // Half-leading is NOT clamped at zero: a `line-height` tighter than the font's
  // own ink box gives negative leading, and both engines distribute it the same
  // way. Clamping would push every tight-leading block a pixel or two up.
  const firstBaselineFromTop = asc === null ? 0 : asc + (pitch - (asc + desc)) / 2
  let dy = 0
  if (first && isNum(first.baseline) && asc !== null) {
    dy = first.baseline - firstBaselineFromTop
  } else {
    warn('figma.text-baseline-unmeasured', 'warn',
      'a text block carries no measured first baseline, so its box is placed on the element box; ' +
      'the first line can sit a whole padding-top away from where CSS put it.')
  }

  return {
    characters: t.characters,
    fontName: base.fontName,
    fontSize: base.fontSize,
    fills: base.fills,
    lineHeight: { unit: 'PIXELS', value: round(pitch, 3) },
    letterSpacing: { unit: 'PIXELS', value: round(ls, 4) },
    paragraphSpacing: round(num(t.paragraphSpacing, 0), 3),
    // The rendered string is already text-transformed (SVD keeps the original in
    // `sourceText`), so asking Figma to transform it again would double it.
    textCase: 'ORIGINAL',
    textAutoResize: 'NONE',
    textAlignHorizontal: align,
    textAlignVertical: 'TOP',
    setRange,
    // Applied by the caller, not spread onto the node: `strokes` is also where a
    // box border lands, and the two must not overwrite each other silently.
    stroke: strokeSpec && !plainRuns && strokeKeys.size === 1 ? strokeSpec : null,
    width: round(Math.max(0.01, width)),
    height: round(Math.max(0.01, pitch * Math.max(1, lines.length))),
    dx: round(dx),
    dy: round(dy),
    // Not consumed by any setter: this is the measured layout the plugin can
    // check its result against, and the only record of what the browser saw.
    layout: {
      pitch: round(pitch, 4),
      lineCount: lines.length,
      baselines: lines.map((l) => round(num(l && l.baseline, 0), 4)),
      lineWidths: lines.map((l) => round(num(l && l.w, 0), 4)),
      lineX: lines.map((l) => round(num(l && l.x, 0), 4)),
      firstBaselineFromTop: round(firstBaselineFromTop, 4),
      trailingSpacingComp: round(comp, 4),
      widthSlackPx: round(slack, 4),
      // The lines the browser hyphenated, so a consumer can SEE where the glyph
      // it will not find in `characters` was painted, and check Figma's own
      // re-hyphenation against it. The glyph itself is declared dropped above.
      hyphenLines: hyphenAt,
      // What the SVG-paste route would cost this block, in px on its widest
      // line. Zero for a block with no letter-spacing.
      svgPasteWidthDelta: round(pasteDelta, 3),
    },
  }
}

// ——— nodes ———

/** Figma node type for an SVD node, plus whether it can host children. */
function typeOf (src, radii, warn) {
  switch (src.type) {
    case 'frame':
      return 'FRAME'
    case 'group':
      return 'GROUP'
    case 'text':
      return 'TEXT'
    case 'image':
      return 'RECTANGLE'
    case 'vector':
      return 'VECTOR'
    case 'shape': {
      if (typeof src.path === 'string' || Array.isArray(src.paths)) return 'VECTOR'
      if (src.shape === 'ellipse') return 'ELLIPSE'
      return radii && radii.path ? 'VECTOR' : 'RECTANGLE'
    }
    default:
      warn('figma.node-unknown-type', 'error',
        `node type "${src.type}" is not in the SVD vocabulary; it is emitted as a FRAME.`)
      return 'FRAME'
  }
}

function vectorPathsOf (src, box, radii) {
  if (Array.isArray(src.paths)) {
    return src.paths
      .filter((p) => p && typeof p.data === 'string')
      .map((p) => ({ windingRule: p.windingRule === 'EVENODD' ? 'EVENODD' : 'NONZERO', data: p.data }))
  }
  if (typeof src.path === 'string' && src.path) {
    return [{ windingRule: src.windingRule === 'evenodd' ? 'EVENODD' : 'NONZERO', data: src.path }]
  }
  if (radii && radii.path) {
    return [{ windingRule: 'NONZERO', data: roundedRectPath(box.width, box.height, src.radii) }]
  }
  return null
}

/**
 * @param {object} src        the SVD node
 * @param {string} id
 * @param {object} ctx
 * @returns {{node:object, inner:object[], outer:object[]}}
 *   `inner` are composed shapes that belong to the node's own box and may live
 *   inside it; `outer` must be siblings of it — an outline is painted outside
 *   the border box and a clipping frame would eat it.
 */
function emitNode (src, id, ctx) {
  const warn = (code, severity, message) => {
    ctx.diagnostics.push({ code, severity, node: id, message })
  }
  const inner = []
  const outer = []
  const name = typeof src.name === 'string' && src.name
    ? src.name
    : (typeof src.type === 'string' && src.type ? src.type : 'node')

  const box = placement(src, warn)
  const radii = readRadii(src.radii, box.width, box.height, warn)
  let type = typeOf(src, radii, warn)

  const fills = []
  const placedImages = []
  const clipBoxes = new Set()
  for (const p of Array.isArray(src.fills) ? src.fills : []) {
    if (!isObject(p)) continue
    if (p.clipBox) clipBoxes.add(p.clipBox)
    if (p.clipBox === 'text') {
      warn('figma.fill-clip-text', 'warn',
        'background-clip:text needs a glyph mask Figma cannot build from a paint; the layer is painted ' +
        'over the whole box.')
    }
    const fill = toPaint(p, { w: box.width, h: box.height }, warn, ctx.assets)
    if (!fill) continue
    // An image that covers only part of the box (`object-fit: contain`, a small
    // `object-fit: none`) is a shape of its own: a Figma fill always spans the
    // whole node, and FIT would silently re-centre it.
    if (isObject(fill.paint) && isObject(fill.place)) placedImages.push(fill)
    else fills.push(fill)
  }
  if (clipBoxes.size > 1) {
    warn('figma.fill-clipbox', 'warn',
      `fills use ${clipBoxes.size} different clip boxes (${[...clipBoxes].join(', ')}) and one Figma node ` +
      'paints them all over its own box; they should have been split into separate nodes upstream.')
  }

  // A GROUP has no paint of its own in Figma, and a group with no children is
  // not a legal node at all.
  const kids = Array.isArray(src.children) ? src.children.filter((k) => ctx.src[k]) : []
  if (type === 'GROUP' && (fills.length || (Array.isArray(src.strokes) && src.strokes.length) || src.clip)) {
    warn('figma.group-promoted', 'info',
      'a group carries paint or a clip, which Figma groups cannot hold; it is emitted as a FRAME.')
    type = 'FRAME'
  }
  if (type === 'GROUP' && !kids.length) {
    warn('figma.group-empty', 'info', 'a group has no children; Figma cannot hold an empty group, so it is a FRAME.')
    type = 'FRAME'
  }

  const node = {
    id,
    type,
    name,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    z: zOf(src),
    opacity: round(clamp01(num(src.opacity, 1)), 6),
    // Figma frames and groups default to PASS_THROUGH, and NORMAL on a group is
    // a real visual change: it isolates the children.
    blendMode: src.blend && src.blend !== 'normal'
      ? blendOf(src.blend, warn, 'node')
      : (type === 'FRAME' || type === 'GROUP' ? 'PASS_THROUGH' : 'NORMAL'),
    visible: true,
    fills,
    strokes: [],
    effects: [],
    children: [],
  }
  if (box.rotation !== undefined) {
    node.rotation = box.rotation
    node.relativeTransform = box.relativeTransform
  }
  if (box.degrade) node.degrade = box.degrade
  if (type === 'GROUP') node.sizedByChildren = true

  // Provenance, so a designer can ask a layer where it came from. The plugin
  // writes it to `setPluginData` verbatim and never opens an SVD field itself.
  const source = isObject(src.source) ? src.source : {}
  const fidelity = isObject(src.fidelity) ? src.fidelity : {}
  node.provenance = {
    selector: typeof source.path === 'string' ? source.path : null,
    tag: typeof source.tag === 'string' ? source.tag : null,
    grade: typeof fidelity.grade === 'string' ? fidelity.grade : 'E',
    notes: Array.isArray(fidelity.notes) ? fidelity.notes : [],
    css: isObject(source.css) ? source.css : undefined,
  }

  // ——— images that do not fill their box ———
  for (const { paint, place } of placedImages) {
    inner.push({
      type: 'RECTANGLE',
      name: `${name} / image`,
      ...placeLocal(box, place.x, place.y, place.w, place.h),
      fills: [paint],
      strokes: [],
      effects: [],
      children: [],
      composed: 'image',
    })
    warn('figma.image-composed', 'info',
      `object-fit leaves ${round(place.w)}x${round(place.h)}px of image inside a ` +
      `${round(box.width)}x${round(box.height)}px box; a Figma fill always spans the whole node, so the ` +
      'bitmap is emitted as its own rectangle at the measured position instead of being stretched.')
  }

  // ——— radii / paths ———
  const paths = vectorPathsOf(src, box, radii)
  if (paths && type === 'VECTOR') node.vectorPaths = paths
  else if (paths && radii.path) { node.type = 'VECTOR'; node.vectorPaths = paths }
  if (typeof src.svg === 'string' && src.svg && !node.vectorPaths) {
    // `createNodeFromSvg` is the plugin's job; all this side can do is carry the
    // already-namespaced markup across.
    node.svg = src.svg
    warn('figma.vector-svg', 'info',
      'the node is passthrough SVG; the plugin must build it with createNodeFromSvg, which returns a FRAME.')
  }
  if (radii.corners && !node.vectorPaths && (node.type === 'RECTANGLE' || node.type === 'FRAME')) {
    const [tl, tr, br, bl] = radii.corners
    if (tl || tr || br || bl) {
      node.topLeftRadius = round(tl, 3)
      node.topRightRadius = round(tr, 3)
      node.bottomRightRadius = round(br, 3)
      node.bottomLeftRadius = round(bl, 3)
    }
  }

  // ——— clip ———
  if (isObject(src.clip)) {
    if (node.type === 'FRAME') {
      node.clipsContent = true
      if (src.clip.box && src.clip.box !== 'border') {
        warn('figma.clip-box', 'info',
          `the overflow clip is the ${src.clip.box} box; Figma clips a frame to its own bounds, so the ` +
          'clip is one border width wider than the CSS one.')
      }
    } else {
      warn('figma.clip-unsupported', 'warn',
        `only frames clip their content and this node is a ${node.type}; the clip is dropped.`)
    }
  }

  // ——— strokes ———
  const strokes = (Array.isArray(src.strokes) ? src.strokes : []).filter(isObject)
  strokes.forEach((stroke, i) => {
    const weights = sideWeights(stroke)
    const uniformWeight = sameWeights(weights)
    const uniformColor = stroke.uniform !== false
    const rectLike = RECT_LIKE.has(node.type)

    const asSibling = stroke.sibling === true || i > 0
    if (!uniformColor || (!uniformWeight && !rectLike)) {
      const reason = !uniformColor
        ? 'the four border sides have different colours and one Figma stroke carries one paint'
        : `per-side stroke weights are legal only on rect-like nodes and this one is a ${node.type}`
      const sides = composeSides(stroke, box, name, warn, reason)
      // A border sits ON the box's edge, so a clipping frame keeps it; an
      // outline sits outside it and has to leave.
      ;(stroke.sibling === true ? outer : inner).push(...sides)
      return
    }

    // An outline is painted on a box grown by its offset, so a gradient stroke
    // has to be normalised against that grown box, not the element's.
    const grow = asSibling ? num(stroke.offset, 0) : 0
    const paint = isObject(stroke.paint)
      ? toPaintFlat(stroke.paint, {
        w: box.width + 2 * grow,
        h: box.height + 2 * grow,
        ox: -grow,
        oy: -grow,
      }, warn, ctx.assets)
      : null
    if (!paint) return

    const target = asSibling
      ? {
          type: 'RECTANGLE',
          name: `${name} / ${stroke.kind || 'stroke'}`,
          ...placeLocal(box, -num(stroke.offset, 0), -num(stroke.offset, 0),
            box.width + 2 * num(stroke.offset, 0), box.height + 2 * num(stroke.offset, 0)),
          fills: [],
          strokes: [],
          effects: [],
          children: [],
          composed: stroke.kind || 'stroke',
        }
      : node

    target.strokes = [paint]
    target.strokeAlign = STROKE_ALIGN[String(stroke.align || 'inside').toLowerCase()] || 'INSIDE'
    if (uniformWeight) {
      target.strokeWeight = round(weights[0], 4)
    } else {
      // No scalar alongside these: `strokeWeight` overwrites all four sides, so
      // emitting both would make the result depend on the order the plugin
      // happens to assign them in.
      target.strokeTopWeight = round(weights[0], 4)
      target.strokeRightWeight = round(weights[1], 4)
      target.strokeBottomWeight = round(weights[2], 4)
      target.strokeLeftWeight = round(weights[3], 4)
    }
    if (Array.isArray(stroke.dash) && stroke.dash.length) {
      target.dashPattern = stroke.dash.map((n) => round(Math.max(0, num(n, 0)), 3))
    }
    if (stroke.cap) target.strokeCap = STROKE_CAP[String(stroke.cap).toLowerCase()] || 'NONE'
    if (stroke.join) target.strokeJoin = STROKE_JOIN[String(stroke.join).toLowerCase()] || 'MITER'
    if (isNum(stroke.miter)) target.strokeMiterLimit = round(stroke.miter, 3)

    if (asSibling) {
      const sideRadii = Array.isArray(stroke.radii) ? stroke.radii : null
      const corners = sideRadii ? readRadii(sideRadii, box.width, box.height, warn) : null
      if (corners && corners.corners && !corners.path) {
        const [tl, tr, br, bl] = corners.corners
        target.topLeftRadius = round(tl, 3)
        target.topRightRadius = round(tr, 3)
        target.bottomRightRadius = round(br, 3)
        target.bottomLeftRadius = round(bl, 3)
      }
      ;(stroke.sibling === true ? outer : inner).push(target)
      warn('figma.stroke-sibling', 'info',
        `"${stroke.kind || 'stroke'}" cannot share a node with the box's own border (Figma holds one ` +
        'stroke weight per node); it is emitted as a sibling shape painted last.')
    }
  })

  // ——— effects ———
  for (const e of Array.isArray(src.effects) ? src.effects : []) {
    if (!isObject(e)) continue
    const effect = toEffect(e, node, warn)
    if (effect) node.effects.push(effect)
  }

  // ——— mask ———
  if (isObject(src.mask) && typeof src.mask.node === 'string') {
    node.mask = { node: src.mask.node, type: src.mask.type === 'luminance' ? 'LUMINANCE' : 'ALPHA' }
    warn('figma.mask-unsupported', 'warn',
      'Figma masks by flagging the bottom sibling of a group, not by reference; the plugin must set ' +
      `isMask on "${src.mask.node}" and place it below this node, and luminance masks need a group wrapper.`)
  }

  // ——— text ———
  if (node.type === 'TEXT') {
    const text = buildText(src, id, ctx.doc, ctx, warn)
    if (!text) {
      node.type = 'FRAME'
    } else {
      if (node.fills.length) {
        warn('figma.text-background', 'warn',
          'a text node also carries background fills; Figma text fills are the glyph colour, so the ' +
          'background is dropped and should have been its own node.')
      }
      const { width, height, dx, dy, layout, setRange, stroke, ...props } = text
      Object.assign(node, props)
      // `-webkit-text-stroke`, which Figma holds on the node. The border loop ran
      // first, so a text node that somehow also has a box border keeps it and the
      // glyph contour is declared lost rather than overwriting it.
      if (stroke) {
        if (node.strokes.length) {
          warn('figma.text-stroke-dropped', 'warn',
            'this text node carries both a box border and -webkit-text-stroke, and Figma has one stroke ' +
            'list per node; the border is kept and the glyph contour is dropped.')
        } else {
          node.strokes = stroke.strokes
          node.strokeWeight = stroke.strokeWeight
          node.strokeAlign = stroke.strokeAlign
          warn('figma.text-stroke', 'info',
            `-webkit-text-stroke ${stroke.strokeWeight}px is emitted as the text node's own stroke with ` +
            'strokeAlign CENTER: CSS centres it on the glyph outline and paints it over the fill, and so ' +
            'does Figma, so the weight carries across unchanged. Every run in the block shares it — Figma ' +
            'has no per-range stroke, and a block whose runs disagreed would have had it dropped instead.')
        }
      }
      node.width = width
      node.height = height
      node.x = round(node.x + dx)
      node.y = round(node.y + dy)
      if (node.relativeTransform) {
        node.relativeTransform[0][2] = node.x
        node.relativeTransform[1][2] = node.y
      }
      node.setRange = setRange
      node.textLayout = layout
      // The two pre-baked escape hatches, so the plugin never has to look for
      // them inside an SVD `text.emit` it no longer receives.
      const emit = isObject(src.text.emit) ? src.text.emit : {}
      if (typeof emit.outlineAsset === 'string' && emit.outlineAsset) node.outlineAsset = emit.outlineAsset
      if (typeof emit.rasterAsset === 'string' && emit.rasterAsset) node.rasterAsset = emit.rasterAsset
      if (emit.mode && emit.mode !== 'block') {
        node.degrade = {
          action: emit.mode === 'raster' ? 'RASTER' : 'OUTLINE',
          reason: `text.emit.mode=${emit.mode}`,
          asset: (emit.mode === 'raster' ? emit.rasterAsset : emit.outlineAsset) || null,
        }
      }
      ctx.textNodes++
      if (layout.lineCount > 1) ctx.multilineText++
    }
  }

  return { node, inner, outer }
}

/**
 * Walk the containment tree, emitting back to front.
 *
 * `children` is DOM containment order and `paint.z` is the paint order (SVD
 * invariant 3), and Figma's `children[0]` is the BOTTOM layer — so sorting by
 * `z` here is the whole of the translation. Composed siblings follow the node
 * they belong to, which puts them on top of it.
 */
function walk (id, ctx) {
  if (ctx.seen.has(id)) return null
  ctx.seen.add(id)
  const src = ctx.src[id]
  if (!isObject(src)) return null

  const { node, inner, outer } = emitNode(src, id, ctx)
  ctx.out[id] = node

  const kids = (Array.isArray(src.children) ? src.children : [])
    .filter((k) => typeof k === 'string' && ctx.src[k])
    .map((k, i) => ({ k, i, z: zOf(ctx.src[k]) }))
    .sort((a, b) => a.z - b.z || a.i - b.i)

  const childIds = []
  for (const { k } of kids) {
    const res = walk(k, ctx)
    if (!res) continue
    childIds.push(res.id)
    // A child's outer shapes belong right after it, which paints them on top.
    for (const extra of res.outer) childIds.push(extra.id)
  }

  const register = (list) => {
    for (const extra of list) {
      extra.id = `${id}__c${ctx.seq++}`
      extra.z = node.z
      ctx.out[extra.id] = extra
    }
    return list
  }
  register(inner)
  register(outer)

  // Only a frame or a group can hold children; anything else hands its own
  // composed shapes up to be its siblings instead.
  const hosts = node.type === 'FRAME' || node.type === 'GROUP'
  const up = hosts ? [] : [...inner]
  if (hosts) for (const extra of inner) childIds.push(extra.id)
  up.push(...outer)

  node.children = childIds
  return { id, outer: up }
}

/**
 * The preflight's font ledger.
 *
 * `{family, style}` alone cannot answer the only question the preflight exists
 * to ask — "how much of this document breaks if I substitute?" — so the block
 * and character counts are accumulated per face while the runs go by, along with
 * whether every block using it has a pre-baked outline or bitmap to fall back on.
 */
function makeFontLedger () {
  const byKey = new Map()
  return {
    // U+0000 cannot occur in a font name, so "Inter Semi"+"Bold" and
    // "Inter"+"SemiBold" cannot collapse into one row the way a space would.
    key: (family, style) => `${family}\u0000${style}`,
    record (fontName, style, nodeId, chars, emit) {
      const key = this.key(fontName.family, fontName.style)
      let entry = byKey.get(key)
      if (!entry) {
        entry = {
          key,
          family: fontName.family,
          style: fontName.style,
          weight: num(style && style.weight, 400),
          italic: (style && style.italic) === true,
          stack: typeof (style && style.stack) === 'string' ? style.stack : '',
          nodes: 0,
          chars: 0,
          nodeIds: [],
          canOutline: true,
          canRaster: true,
        }
        byKey.set(key, entry)
      }
      entry.chars += Math.max(0, num(chars, 0))
      if (entry.nodeIds.indexOf(nodeId) === -1) {
        entry.nodeIds.push(nodeId)
        entry.nodes++
        if (typeof (emit && emit.outlineAsset) !== 'string') entry.canOutline = false
        if (typeof (emit && emit.rasterAsset) !== 'string') entry.canRaster = false
      }
    },
    list () {
      return [...byKey.values()].sort((a, b) => (
        a.family < b.family ? -1 : a.family > b.family ? 1
          : a.style < b.style ? -1 : a.style > b.style ? 1 : 0
      ))
    },
  }
}

/**
 * A Figma GROUP has no box: its bounds are its children's, so a child placed
 * relative to the group's frame lands `frame.x/y` short. Folding that origin into
 * the children here — top-down, so a nested group inherits its parent's fold
 * before it passes its own down — is geometry, and geometry belongs on this side
 * of the wire, not in the sandbox.
 */
function foldGroupOrigins (out, rootId) {
  const queue = [rootId]
  const seen = new Set()
  while (queue.length) {
    const id = queue.shift()
    if (seen.has(id)) continue
    seen.add(id)
    const node = out[id]
    if (!isObject(node)) continue
    const kids = Array.isArray(node.children) ? node.children : []
    if (node.type === 'GROUP' && (node.x !== 0 || node.y !== 0)) {
      const dx = node.x
      const dy = node.y
      for (const k of kids) {
        const child = out[k]
        if (!isObject(child)) continue
        child.x = round(child.x + dx)
        child.y = round(child.y + dy)
        if (Array.isArray(child.relativeTransform)) {
          child.relativeTransform[0][2] = child.x
          child.relativeTransform[1][2] = child.y
        }
      }
      node.x = 0
      node.y = 0
    }
    for (const k of kids) queue.push(k)
    for (const k of Array.isArray(node.siblings) ? node.siblings : []) queue.push(k)
  }
}

/**
 * Translate an SVD document into the payload the Figma plugin consumes.
 *
 * Pure: no DOM, no measurement, and no Figma API — the result is JSON the
 * plugin sandbox can act on directly, and the ONLY thing it is given, so the
 * assets, the capture header and the engine's own diagnostics travel with it
 * under `document`.
 *
 * @param {object} doc  a valid SVD document
 * @returns {{version:1, root:string, nodes:Record<string,object>,
 *            fonts:Array<{family:string, style:string, nodes:number, chars:number}>,
 *            diagnostics:Diag[], document:object}}
 *   `nodes` is keyed by id; each `children` array is already in Figma's
 *   back-to-front order (`children[0]` is the bottom layer). The root record may
 *   carry `siblings`, ids the plugin must append *beside* the root rather than
 *   inside it. `fonts` is the unique set every `setRange` entry names, with the
 *   block and character counts the preflight puts in front of the user.
 *   `diagnostics` is what THIS translation lost; the document's own are under
 *   `document.diagnostics`, unmerged, so neither list double-counts the other.
 */
export function svdToFigma (doc) {
  if (!isObject(doc)) throw new TypeError('svdToFigma: doc must be an SVD document object')
  if (!isObject(doc.nodes)) throw new TypeError('svdToFigma: doc.nodes must be an object keyed by node id')
  const rootId = readRootId(doc.root)
  if (!rootId || !isObject(doc.nodes[rootId])) {
    throw new TypeError(`svdToFigma: doc.root does not resolve to a node (got ${JSON.stringify(doc.root)})`)
  }

  const ctx = {
    doc,
    src: doc.nodes,
    assets: isObject(doc.assets) ? doc.assets : {},
    out: {},
    fonts: makeFontLedger(),
    diagnostics: [],
    seen: new Set(),
    seq: 0,
    multilineText: 0,
    textNodes: 0,
    letterSpacingBlocks: 0,
    letterSpacingWorstPx: 0,
  }

  const res = walk(rootId, ctx)
  // The root has no parent to be a sibling of. A frame or group can adopt what
  // is left; anything else cannot, and the plugin has to place those shapes
  // beside the root in whatever container it imports into.
  if (res && res.outer.length) {
    const ids = res.outer.map((extra) => extra.id)
    const canAdopt = (ctx.out[rootId].type === 'FRAME' && ctx.out[rootId].clipsContent !== true) ||
      ctx.out[rootId].type === 'GROUP'
    if (canAdopt) {
      ctx.out[rootId].children.push(...ids)
    } else {
      ctx.out[rootId].siblings = ids
      ctx.diagnostics.push({
        code: 'figma.root-siblings',
        severity: 'warn',
        node: rootId,
        message:
          `the capture root cannot hold the ${ids.length} shape(s) its own border or outline had to be ` +
          `composed into — it is a ${ctx.out[rootId].type}${ctx.out[rootId].clipsContent ? ' that clips its content' : ''}. ` +
          'They are listed in `siblings`, and the plugin must append them next to the root, in order, after it.',
      })
    }
  }

  for (const id of Object.keys(doc.nodes)) {
    if (!ctx.seen.has(id)) {
      ctx.diagnostics.push({
        code: 'figma.unreachable',
        severity: 'error',
        node: id,
        message: 'the node is not reachable from the root and is not emitted.',
      })
    }
  }

  if (ctx.textNodes) {
    ctx.diagnostics.push({
      code: 'figma.text-vertical-calibration',
      severity: 'info',
      message:
        `${ctx.textNodes} text block(s) (${ctx.multilineText} of them multi-line) are positioned by ` +
        'solving Figma\'s own stacking for the measured first baseline: y = baseline - (ascent + ' +
        'half-leading). Figma exposes no way to set a baseline directly, so the residual error is the ' +
        'difference between Chromium\'s and Figma\'s ascent for the face that ends up loaded — sub-pixel ' +
        'for the same face, and up to a whole leading step for a substituted one. The measured ' +
        'baselines are in `textLayout` for anything that wants to check.',
    })
  }

  if (ctx.letterSpacingBlocks) {
    // Not a loss — the opposite, and it is here because a consumer choosing
    // between the two routes has no other way to find out. Pasting the SVG drops
    // letter-spacing outright (FIGMA_FINDINGS.md §5: measured, and four ways of
    // forcing it through the importer tried and rejected); this payload keeps it.
    ctx.diagnostics.push({
      code: 'figma.text-letterspacing-kept',
      severity: 'info',
      message:
        `${ctx.letterSpacingBlocks} text block(s) carry a non-zero letter-spacing, and this payload keeps ` +
        'every one of them: `letterSpacing` on the node and on each `setRange` entry, which the Plugin API ' +
        'applies with setRangeLetterSpacing. The OTHER route into Figma — pasting the SVG from ' +
        'emit/svg-flat.js — discards it entirely, which would make the worst line here arrive up to ' +
        `${round(ctx.letterSpacingWorstPx, 1)}px wider than the browser painted it (plus whatever the font ` +
        'substitution adds). Per block, the number is in `textLayout.svgPasteWidthDelta`.',
    })
  }

  foldGroupOrigins(ctx.out, rootId)

  return {
    version: VERSION,
    root: rootId,
    nodes: ctx.out,
    fonts: ctx.fonts.list(),
    diagnostics: ctx.diagnostics,
    // The plugin is handed this payload and nothing else, so everything it
    // cannot re-derive from the nodes rides along here. `assets` is a reference
    // to the document's own map: image fills name them by id, exactly as before.
    document: {
      assets: ctx.assets,
      capture: isObject(doc.capture) ? doc.capture : {},
      report: isObject(doc.report) ? doc.report : {},
      diagnostics: Array.isArray(doc.diagnostics) ? doc.diagnostics : [],
    },
  }
}

export default svdToFigma
