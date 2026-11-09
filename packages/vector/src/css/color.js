/**
 * Any CSS color -> `[r, g, b, a]` floats 0..1 in sRGB (svd invariant 4).
 *
 * Two paths, deliberately:
 *
 *  - Everything with a closed-form definition — hex, named, `rgb()`, `hsl()`,
 *    `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`, `color()` — is parsed and
 *    converted right here, in pure JS. That is what keeps this file importable
 *    from Node with no DOM, which the contract requires so the harness can fuzz it.
 *  - Anything else a canvas understands but this file does not — `color-mix()`,
 *    relative color syntax, a `calc()` inside a component — goes to a 1x1 canvas:
 *    set it as `fillStyle`, paint, read the pixel. Cheap and authoritative by
 *    construction. With no DOM there is nothing to ask, so those return `null`
 *    rather than a guess.
 *
 * What the canvas does NOT cover is anything that needs an element to resolve
 * against, because a canvas has none: measured in Chrome, `fillStyle` rejects
 * `light-dark()` and every system color (`AccentColor`, `ButtonFace`). Those return
 * `null`. In practice they do not arrive — `getComputedStyle` has already resolved
 * them to `rgb()` by the time a collector reads a property — and a caller holding
 * an authored string has the element that this module, by contract, does not.
 *
 * When a DOM IS present the modern color functions take BOTH paths, and the split
 * is deliberate. The maths decides whether the color falls outside sRGB, which a
 * pixel read cannot report. If it is INSIDE, the canvas supplies the final channel
 * values, because what the engine paints is what a capture has to match — and the
 * two agree to within 1/255 anyway, measured against Chrome. If it is OUTSIDE, the
 * maths wins, because an sRGB canvas resolves such a color by clipping each channel
 * and that is exactly the answer this module may never give.
 *
 * Gamut mapping is chroma reduction in OKLCh (CSS Color 4 §13), never per-channel
 * clipping. The difference is not academic: clipping turns `oklch(0.7 0.4 30)`
 * from a coral into pure red, and `color(display-p3 0 1 0)` into pure green,
 * discarding the hue and lightness the author chose. Chroma reduction keeps both
 * and gives up only saturation, which is the one dimension sRGB genuinely lacks.
 *
 * Alpha never comes from a pixel — canvas storage is premultiplied, so reading it
 * back costs precision. It is parsed exactly and the string handed to the canvas is
 * built without it.
 *
 * Every approximation lands in `warnings` on the returned object. Nothing here
 * degrades silently.
 */

// ——— cache ———
//
// A capture asks for the same handful of strings thousands of times (one per
// element per color-valued property), and the modern paths cost a matrix chain
// plus a GPU readback. Keyed on the raw string, so `red` and `RED` are two
// entries and both are right.

const CACHE = new Map()
const CACHE_MAX = 4096

/**
 * The 148 CSS named colors, packed. Built into a Map on first named lookup — a
 * document made entirely of hex and `rgb()` never pays for it. `grey` spellings
 * are separate entries because CSS defines them as separate names, not aliases
 * resolved at parse time.
 */
const NAMED_PACKED =
  'aliceblue f0f8ff,antiquewhite faebd7,aqua 00ffff,aquamarine 7fffd4,azure f0ffff,' +
  'beige f5f5dc,bisque ffe4c4,black 000000,blanchedalmond ffebcd,blue 0000ff,' +
  'blueviolet 8a2be2,brown a52a2a,burlywood deb887,cadetblue 5f9ea0,chartreuse 7fff00,' +
  'chocolate d2691e,coral ff7f50,cornflowerblue 6495ed,cornsilk fff8dc,crimson dc143c,' +
  'cyan 00ffff,darkblue 00008b,darkcyan 008b8b,darkgoldenrod b8860b,darkgray a9a9a9,' +
  'darkgreen 006400,darkgrey a9a9a9,darkkhaki bdb76b,darkmagenta 8b008b,' +
  'darkolivegreen 556b2f,darkorange ff8c00,darkorchid 9932cc,darkred 8b0000,' +
  'darksalmon e9967a,darkseagreen 8fbc8f,darkslateblue 483d8b,darkslategray 2f4f4f,' +
  'darkslategrey 2f4f4f,darkturquoise 00ced1,darkviolet 9400d3,deeppink ff1493,' +
  'deepskyblue 00bfff,dimgray 696969,dimgrey 696969,dodgerblue 1e90ff,firebrick b22222,' +
  'floralwhite fffaf0,forestgreen 228b22,fuchsia ff00ff,gainsboro dcdcdc,ghostwhite f8f8ff,' +
  'gold ffd700,goldenrod daa520,gray 808080,green 008000,greenyellow adff2f,grey 808080,' +
  'honeydew f0fff0,hotpink ff69b4,indianred cd5c5c,indigo 4b0082,ivory fffff0,khaki f0e68c,' +
  'lavender e6e6fa,lavenderblush fff0f5,lawngreen 7cfc00,lemonchiffon fffacd,' +
  'lightblue add8e6,lightcoral f08080,lightcyan e0ffff,lightgoldenrodyellow fafad2,' +
  'lightgray d3d3d3,lightgreen 90ee90,lightgrey d3d3d3,lightpink ffb6c1,lightsalmon ffa07a,' +
  'lightseagreen 20b2aa,lightskyblue 87cefa,lightslategray 778899,lightslategrey 778899,' +
  'lightsteelblue b0c4de,lightyellow ffffe0,lime 00ff00,limegreen 32cd32,linen faf0e6,' +
  'magenta ff00ff,maroon 800000,mediumaquamarine 66cdaa,mediumblue 0000cd,' +
  'mediumorchid ba55d3,mediumpurple 9370db,mediumseagreen 3cb371,mediumslateblue 7b68ee,' +
  'mediumspringgreen 00fa9a,mediumturquoise 48d1cc,mediumvioletred c71585,' +
  'midnightblue 191970,mintcream f5fffa,mistyrose ffe4e1,moccasin ffe4b5,' +
  'navajowhite ffdead,navy 000080,oldlace fdf5e6,olive 808000,olivedrab 6b8e23,' +
  'orange ffa500,orangered ff4500,orchid da70d6,palegoldenrod eee8aa,palegreen 98fb98,' +
  'paleturquoise afeeee,palevioletred db7093,papayawhip ffefd5,peachpuff ffdab9,' +
  'peru cd853f,pink ffc0cb,plum dda0dd,powderblue b0e0e6,purple 800080,' +
  'rebeccapurple 663399,red ff0000,rosybrown bc8f8f,royalblue 4169e1,saddlebrown 8b4513,' +
  'salmon fa8072,sandybrown f4a460,seagreen 2e8b57,seashell fff5ee,sienna a0522d,' +
  'silver c0c0c0,skyblue 87ceeb,slateblue 6a5acd,slategray 708090,slategrey 708090,' +
  'snow fffafa,springgreen 00ff7f,steelblue 4682b4,tan d2b48c,teal 008080,thistle d8bfd8,' +
  'tomato ff6347,turquoise 40e0d0,violet ee82ee,wheat f5deb3,white ffffff,' +
  'whitesmoke f5f5f5,yellow ffff00,yellowgreen 9acd32'

let NAMED = null

function namedColor(name) {
  if (!NAMED) {
    NAMED = new Map()
    for (const entry of NAMED_PACKED.split(',')) {
      const sp = entry.indexOf(' ')
      NAMED.set(entry.slice(0, sp), parseInt(entry.slice(sp + 1), 16))
    }
  }
  return NAMED.get(name)
}

// ——— colorimetry ———
//
// Matrices are CSS Color 4's own, to the precision it publishes them, so a value
// that round-trips through here matches what a browser computes to the last bit
// an 8-bit channel can hold. Flat row-major; `mul` is the only consumer.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

function mul(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ]
}

/**
 * sRGB transfer functions, sign-preserving. An out-of-gamut color reaches these
 * with negative channels, and `Math.pow(-0.3, 1/2.4)` is NaN — mirroring through
 * zero instead keeps the value readable so the gamut mapper can act on it.
 */
function encodeSrgb(c) {
  const a = Math.abs(c)
  return a <= 0.0031308 ? c * 12.92 : Math.sign(c) * (1.055 * Math.pow(a, 1 / 2.4) - 0.055)
}

function decodeSrgb(c) {
  const a = Math.abs(c)
  return a <= 0.04045 ? c / 12.92 : Math.sign(c) * Math.pow((a + 0.055) / 1.055, 2.4)
}

const XYZ_TO_LINEAR_SRGB = [
  3.2409699419045226, -1.537383177570094, -0.4986107602930034,
  -0.9692436362808796, 1.8759675015077202, 0.04155505740717559,
  0.05563007969699366, -0.20397695888897652, 1.0569715142428786,
]

/** Bradford-adapted, per CSS Color 4 — `lab()` and ProPhoto are D50, sRGB is D65. */
const D50_TO_D65 = [
  0.9554734527042182, -0.023098536874261423, 0.0632593086610217,
  -0.028369706963208136, 1.0099954580058226, 0.021041398966943008,
  0.012314001688319899, -0.020507696433477912, 1.3303659366080753,
]

const D50 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585]

const KAPPA = 24389 / 27
const EPSILON = 216 / 24389

/** CIE Lab (D50) -> linear sRGB. */
function labToLinearSrgb(L, a, b) {
  const fy = (L + 16) / 116
  const fx = a / 500 + fy
  const fz = fy - b / 200
  const fx3 = fx * fx * fx
  const fz3 = fz * fz * fz
  const xyz = [
    (fx3 > EPSILON ? fx3 : (116 * fx - 16) / KAPPA) * D50[0],
    (L > KAPPA * EPSILON ? Math.pow(fy, 3) : L / KAPPA) * D50[1],
    (fz3 > EPSILON ? fz3 : (116 * fz - 16) / KAPPA) * D50[2],
  ]
  return mul(XYZ_TO_LINEAR_SRGB, mul(D50_TO_D65, xyz))
}

const OKLAB_TO_LMS = [
  1, 0.3963377773761749, 0.2158037573099136,
  1, -0.1055613458156586, -0.0638541728258133,
  1, -0.0894841775298119, -1.2914855480194092,
]

const LMS_TO_LINEAR_SRGB = [
  4.0767416621, -3.3077115913, 0.2309699292,
  -1.2684380046, 2.6097574011, -0.3413193965,
  -0.0041960863, -0.7034186147, 1.7076147010,
]

const LINEAR_SRGB_TO_LMS = [
  0.4122214708, 0.5363325363, 0.0514459929,
  0.2119034982, 0.6806995451, 0.1073969566,
  0.0883024619, 0.2817188376, 0.6299787005,
]

const LMS_TO_OKLAB = [
  0.2104542553, 0.7936177850, -0.0040720468,
  1.9779984951, -2.4285922050, 0.4505937099,
  0.0259040371, 0.7827717662, -0.8086757660,
]

function oklabToLinearSrgb(L, a, b) {
  const lms = mul(OKLAB_TO_LMS, [L, a, b])
  return mul(LMS_TO_LINEAR_SRGB, [lms[0] ** 3, lms[1] ** 3, lms[2] ** 3])
}

function linearSrgbToOklab(lin) {
  const lms = mul(LINEAR_SRGB_TO_LMS, lin)
  return mul(LMS_TO_OKLAB, [Math.cbrt(lms[0]), Math.cbrt(lms[1]), Math.cbrt(lms[2])])
}

/** Polar -> rectangular, shared by `lch()` and `oklch()`. */
function polarToRect(C, hDeg) {
  const h = (hDeg * Math.PI) / 180
  return [C * Math.cos(h), C * Math.sin(h)]
}

// ——— gamut mapping (CSS Color 4 §13) ———

/**
 * Float noise from a matrix chain lands a few ulps outside 0..1 for colors that
 * are exactly on the gamut boundary — `color(display-p3 0 1 0)`'s green stays put
 * but `lab()` white does not. Below this the value is snapped, not mapped, and no
 * warning is raised: nothing was approximated, the arithmetic just breathed.
 */
const GAMUT_TOL = 1e-5

/** Just-noticeable difference and search precision, both fixed by the spec. */
const JND = 0.02
const MAP_EPS = 0.0001

function inGamut(rgb) {
  return rgb[0] >= -GAMUT_TOL && rgb[0] <= 1 + GAMUT_TOL &&
    rgb[1] >= -GAMUT_TOL && rgb[1] <= 1 + GAMUT_TOL &&
    rgb[2] >= -GAMUT_TOL && rgb[2] <= 1 + GAMUT_TOL
}

const clipRgb = (rgb) => [clamp(rgb[0], 0, 1), clamp(rgb[1], 0, 1), clamp(rgb[2], 0, 1)]

/** Perceptual distance, plain Euclidean in OKLab — that is what OKLab is for. */
function deltaEOK(a, b) {
  const dl = a[0] - b[0]
  const da = a[1] - b[1]
  const db = a[2] - b[2]
  return Math.sqrt(dl * dl + da * da + db * db)
}

/** OKLCh -> gamma-encoded sRGB, unclamped. */
function oklchToSrgb(L, C, H) {
  const [a, b] = polarToRect(C, H)
  const lin = oklabToLinearSrgb(L, a, b)
  return [encodeSrgb(lin[0]), encodeSrgb(lin[1]), encodeSrgb(lin[2])]
}

/**
 * `css-gamut-map` verbatim: binary-search the chroma downward, keeping lightness
 * and hue, until clipping what remains costs less than one JND. The clip inside
 * the loop is not a fallback to per-channel clipping — it is the spec's own
 * "close enough to stop" test, applied to a color already pulled to the boundary.
 *
 * @returns {{rgb: number[], deltaE: number}} gamma-encoded sRGB, in gamut.
 */
function gamutMapOklch(L, C, H) {
  if (L >= 1) return { rgb: [1, 1, 1], deltaE: 0 }
  if (L <= 0) return { rgb: [0, 0, 0], deltaE: 0 }

  /** Distance from a candidate chroma's clipped rendering to the ideal color at that chroma. */
  const cost = (chroma, rgb) => {
    const [ca, cb] = polarToRect(chroma, H)
    return deltaEOK(linearSrgbToOklab(clipRgb(rgb).map(decodeSrgb)), [L, ca, cb])
  }

  let current = oklchToSrgb(L, C, H)
  let delta = cost(C, current)
  if (delta < JND) return { rgb: clipRgb(current), deltaE: delta }

  let min = 0
  let max = C
  let minInGamut = true
  while (max - min > MAP_EPS) {
    const chroma = (min + max) / 2
    current = oklchToSrgb(L, chroma, H)
    if (minInGamut && inGamut(current)) {
      min = chroma
      continue
    }
    delta = cost(chroma, current)
    if (delta < JND) {
      if (JND - delta < MAP_EPS) return { rgb: clipRgb(current), deltaE: delta }
      minInGamut = false
      min = chroma
    } else {
      max = chroma
    }
  }
  current = oklchToSrgb(L, min, H)
  return { rgb: clipRgb(current), deltaE: cost(min, current) }
}

// ——— canvas ———
//
// Created on first use and never at module scope: the contract requires this file
// to import cleanly into Node, where none of these globals exist.

let CTX
let CTX_TRIED = false

function context() {
  if (CTX_TRIED) return CTX
  CTX_TRIED = true
  try {
    let canvas = null
    if (typeof OffscreenCanvas === 'function') {
      canvas = new OffscreenCanvas(1, 1)
    } else if (typeof document !== 'undefined' && document.createElement) {
      canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
    }
    if (canvas) CTX = canvas.getContext('2d', { willReadFrequently: true }) || undefined
  } catch {
    CTX = undefined
  }
  return CTX
}

/**
 * An invalid `fillStyle` assignment is a no-op, so the property keeps whatever it
 * held. Probing from two different values is what tells "the engine rejected it"
 * from "the engine accepted it and it happens to equal the previous value".
 */
function accepted(ctx, css) {
  ctx.fillStyle = '#000000'
  ctx.fillStyle = css
  const first = ctx.fillStyle
  ctx.fillStyle = '#ffffff'
  ctx.fillStyle = css
  return ctx.fillStyle === first
}

/** `copy` rather than the default `source-over`, so the previous pixel cannot blend in. */
function pixel(ctx, css) {
  ctx.globalCompositeOperation = 'copy'
  ctx.fillStyle = css
  ctx.fillRect(0, 0, 1, 1)
  return ctx.getImageData(0, 0, 1, 1).data
}

/** Opaque color string -> `[r, g, b]` 0..1, or `null` with no DOM / on rejection. */
function canvasRgb(css) {
  const ctx = context()
  if (!ctx) return null
  try {
    if (!accepted(ctx, css)) return null
    const d = pixel(ctx, css)
    return [d[0] / 255, d[1] / 255, d[2] / 255]
  } catch {
    return null
  }
}

/**
 * Last resort for syntax this file does not model. Alpha comes back through the
 * canvas's premultiplied store, so a translucent result is approximate in all four
 * channels — hence the warning.
 */
function canvasColor(css, warnings) {
  const ctx = context()
  if (!ctx) return null
  let d
  try {
    if (!accepted(ctx, css)) return null
    d = pixel(ctx, css)
  } catch {
    return null
  }
  const a = d[3] / 255
  if (a > 0 && a < 1) {
    warnings.push(`"${css}" was resolved by painting a canvas pixel; its channels are un-premultiplied from 8-bit storage and are approximate.`)
  }
  return { rgba: [d[0] / 255, d[1] / 255, d[2] / 255, a], warnings }
}

// ——— syntax ———

const NUMBER = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%?)$/i
const ANGLE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|grad|rad|turn)?$/i

/**
 * A component value. `pctBase` is what `100%` means in this slot, which differs
 * per function and per channel — 255 in `rgb()`, 125 in `lab()`'s a/b, 0.4 in
 * `oklch()`'s chroma. `none` is 0: for an absolute color the spec's "missing"
 * component behaves as zero, and nothing downstream of svd carries missingness.
 */
function number(token, pctBase) {
  if (token === 'none') return 0
  const m = NUMBER.exec(token)
  if (!m) return NaN
  const v = parseFloat(m[1])
  if (!Number.isFinite(v)) return NaN
  return m[2] ? (v / 100) * pctBase : v
}

function angle(token) {
  if (token === 'none') return 0
  const m = ANGLE.exec(token)
  if (!m) return NaN
  const v = parseFloat(m[1])
  if (!Number.isFinite(v)) return NaN
  switch (m[2] || 'deg') {
    case 'grad': return v * 0.9
    case 'rad': return (v * 180) / Math.PI
    case 'turn': return v * 360
    default: return v
  }
}

function alphaOf(token) {
  if (token === null) return 1
  const v = number(token, 1)
  return Number.isNaN(v) ? NaN : clamp(v, 0, 1)
}

/**
 * Split a function's argument list into components plus alpha, covering both
 * grammars at once: legacy `rgb(1, 2, 3, .5)` and modern `rgb(1 2 3 / .5)`.
 * Nested parens survive whole, so a `calc()` in a slot arrives as one unparseable
 * token and falls through to the canvas rather than being sliced into nonsense.
 *
 * @returns {{comps: string[], alpha: string|null}|null}
 */
function splitComponents(raw) {
  const tokens = []
  let depth = 0
  let cur = ''
  let sawComma = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '(') depth++
    else if (ch === ')') { if (depth > 0) depth-- }
    if (depth === 0 && (ch === ',' || ch === '/' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f')) {
      if (cur) { tokens.push(cur); cur = '' }
      if (ch === ',') { tokens.push(','); sawComma = true } else if (ch === '/') tokens.push('/')
      continue
    }
    cur += ch
  }
  if (cur) tokens.push(cur)

  const comps = []
  let alpha = null
  let slash = false
  for (const t of tokens) {
    if (t === ',') continue
    if (t === '/') {
      if (slash) return null
      slash = true
      continue
    }
    if (slash) {
      if (alpha !== null) return null
      alpha = t
      continue
    }
    comps.push(t)
  }
  if (slash && alpha === null) return null
  // `rgba(r, g, b, a)`: in the comma grammar the alpha is just the fourth value.
  if (!slash && sawComma && comps.length === 4) alpha = comps.pop()
  return { comps, alpha }
}

// ——— per-function conversion ———

function hslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360
  const a = s * Math.min(l, 1 - l)
  const f = (n) => {
    const k = (n + hue / 30) % 12
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [f(0), f(8), f(4)]
}

function hwbToRgb(h, w, b) {
  if (w + b >= 1) {
    const g = w / (w + b)
    return [g, g, g]
  }
  return hslToRgb(h, 1, 0.5).map((v) => v * (1 - w - b) + w)
}

/**
 * `color()` predefined spaces. `to` is the space's linear-light -> XYZ matrix, or
 * `null` for the two that are already linear sRGB and would only pick up float
 * noise from a round trip through XYZ.
 */
const COLOR_SPACES = {
  srgb: { to: null, decode: decodeSrgb, d50: false },
  'srgb-linear': { to: null, decode: (c) => c, d50: false },
  'display-p3': {
    to: [
      0.4865709486482162, 0.26566769316909306, 0.1982172852343625,
      0.2289745640697488, 0.6917385218365064, 0.079286914093745,
      0, 0.04511338185890264, 1.043944368900976,
    ],
    decode: decodeSrgb,
    d50: false,
  },
  'a98-rgb': {
    to: [
      0.5766690429101305, 0.1855582379065463, 0.1882286462349947,
      0.29734497525053605, 0.6273635662554661, 0.07529145849399788,
      0.02703136138641234, 0.07068885253582723, 0.9913375368376388,
    ],
    // A98 is a pure power curve, exponent 563/256.
    decode: (c) => Math.sign(c) * Math.pow(Math.abs(c), 563 / 256),
    d50: false,
  },
  'prophoto-rgb': {
    to: [
      0.7977604896723027, 0.13518583717574031, 0.0313493495815248,
      0.2880711282292934, 0.7118432178101014, 0.00008565396060525902,
      0, 0, 0.8251046025104601,
    ],
    decode: (c) => (Math.abs(c) <= 16 / 512 ? c / 16 : Math.sign(c) * Math.pow(Math.abs(c), 1.8)),
    d50: true,
  },
  rec2020: {
    to: [
      0.6369580483012914, 0.14461690358620832, 0.1688809751641721,
      0.2627002120112671, 0.6779980715188708, 0.05930171646986196,
      0, 0.028072693049087428, 1.060985057710791,
    ],
    decode: (c) => {
      const a = 1.09929682680944
      const b = 0.018053968510807
      const abs = Math.abs(c)
      return abs < b * 4.5 ? c / 4.5 : Math.sign(c) * Math.pow((abs + a - 1) / a, 1 / 0.45)
    },
    d50: false,
  },
}

const XYZ_SPACES = new Set(['xyz', 'xyz-d65', 'xyz-d50'])

/**
 * Finish a wide-gamut color: gamut-map if needed, then let the engine overrule the
 * channel values. Both halves matter — the maths knows the color left sRGB, the
 * engine knows what it will actually paint, and disagreeing with the engine on a
 * capture is worse than a few ulps of drift.
 *
 * @param {number[]} lin       linear-light sRGB, possibly out of gamut
 * @param {string} canonical   the same color as an alpha-free CSS string
 * @param {number} alpha
 * @param {string} src         the caller's original string, for the warning text
 */
function wideGamut(lin, canonical, alpha, src) {
  const warnings = []
  const rgb = [encodeSrgb(lin[0]), encodeSrgb(lin[1]), encodeSrgb(lin[2])]

  if (inGamut(rgb)) {
    // Inside the gamut the two agree to within 1/255 — measured against Chrome
    // across `lab()`, `lch()`, `oklab()`, `oklch()` and all eight `color()`
    // spaces — so deferring costs nothing and buys exactness against the render.
    const painted = canvasRgb(canonical)
    return { rgba: [...(painted || clipRgb(rgb)), alpha], warnings }
  }

  const [L, a, b] = linearSrgbToOklab(lin)
  const mapped = gamutMapOklch(L, Math.hypot(a, b), (Math.atan2(b, a) * 180) / Math.PI)
  warnings.push(`"${src}" is outside the sRGB gamut; mapped by chroma reduction in OKLCh (ΔEOK ${mapped.deltaE.toFixed(4)}).`)
  // The canvas is deliberately NOT consulted on this branch. Its backing store is
  // sRGB and it resolves an out-of-gamut colour by clipping each channel, which is
  // the one answer this module may never return: measured, Chrome turns
  // `oklch(0.7 0.4 30)` into pure red and `color(display-p3 0 1 0)` into pure
  // green, hue and lightness gone. Chroma reduction keeps both, so here the maths
  // outranks the engine.
  return { rgba: [...mapped.rgb, alpha], warnings }
}

/** Trim trailing zeros so the string handed to the canvas stays short and exact. */
const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(6))))

function parseFunction(fn, raw, src) {
  const split = splitComponents(raw)
  if (!split) return null
  const { comps, alpha: alphaToken } = split
  const alpha = alphaOf(alphaToken)
  if (Number.isNaN(alpha)) return null

  switch (fn) {
    case 'rgb':
    case 'rgba': {
      if (comps.length !== 3) return null
      const c = []
      for (const t of comps) {
        const v = number(t, 255)
        if (Number.isNaN(v)) return null
        c.push(clamp(v, 0, 255) / 255)
      }
      return { rgba: [c[0], c[1], c[2], alpha], warnings: [] }
    }

    case 'hsl':
    case 'hsla': {
      if (comps.length !== 3) return null
      const h = angle(comps[0])
      // Bare numbers are legal in the modern grammar and mean percent, so the
      // base is 100 either way and `50` and `50%` land in the same place.
      const s = number(comps[1], 100)
      const l = number(comps[2], 100)
      if (Number.isNaN(h + s + l)) return null
      const rgb = hslToRgb(h, clamp(s, 0, 100) / 100, clamp(l, 0, 100) / 100)
      return { rgba: [rgb[0], rgb[1], rgb[2], alpha], warnings: [] }
    }

    case 'hwb': {
      if (comps.length !== 3) return null
      const h = angle(comps[0])
      const w = number(comps[1], 100)
      const b = number(comps[2], 100)
      if (Number.isNaN(h + w + b)) return null
      const rgb = hwbToRgb(h, clamp(w, 0, 100) / 100, clamp(b, 0, 100) / 100)
      return { rgba: [rgb[0], rgb[1], rgb[2], alpha], warnings: [] }
    }

    case 'lab': {
      if (comps.length !== 3) return null
      const L = number(comps[0], 100)
      const a = number(comps[1], 125)
      const b = number(comps[2], 125)
      if (Number.isNaN(L + a + b)) return null
      const l = Math.max(0, L)
      return wideGamut(labToLinearSrgb(l, a, b), `lab(${fmt(l)} ${fmt(a)} ${fmt(b)})`, alpha, src)
    }

    case 'lch': {
      if (comps.length !== 3) return null
      const L = number(comps[0], 100)
      const C = number(comps[1], 150)
      const H = angle(comps[2])
      if (Number.isNaN(L + C + H)) return null
      const l = Math.max(0, L)
      const c = Math.max(0, C)
      const [a, b] = polarToRect(c, H)
      return wideGamut(labToLinearSrgb(l, a, b), `lch(${fmt(l)} ${fmt(c)} ${fmt(H)})`, alpha, src)
    }

    case 'oklab': {
      if (comps.length !== 3) return null
      const L = number(comps[0], 1)
      const a = number(comps[1], 0.4)
      const b = number(comps[2], 0.4)
      if (Number.isNaN(L + a + b)) return null
      const l = Math.max(0, L)
      return wideGamut(oklabToLinearSrgb(l, a, b), `oklab(${fmt(l)} ${fmt(a)} ${fmt(b)})`, alpha, src)
    }

    case 'oklch': {
      if (comps.length !== 3) return null
      const L = number(comps[0], 1)
      const C = number(comps[1], 0.4)
      const H = angle(comps[2])
      if (Number.isNaN(L + C + H)) return null
      const l = Math.max(0, L)
      const c = Math.max(0, C)
      const [a, b] = polarToRect(c, H)
      return wideGamut(oklabToLinearSrgb(l, a, b), `oklch(${fmt(l)} ${fmt(c)} ${fmt(H)})`, alpha, src)
    }

    case 'color': {
      if (comps.length !== 4) return null
      const space = comps[0]
      const v = []
      for (let i = 1; i < 4; i++) {
        const n = number(comps[i], 1)
        if (Number.isNaN(n)) return null
        v.push(n)
      }
      const canonical = `color(${space} ${fmt(v[0])} ${fmt(v[1])} ${fmt(v[2])})`

      if (XYZ_SPACES.has(space)) {
        const xyz = space === 'xyz-d50' ? mul(D50_TO_D65, v) : v
        return wideGamut(mul(XYZ_TO_LINEAR_SRGB, xyz), canonical, alpha, src)
      }
      const def = COLOR_SPACES[space]
      // A custom `@color-profile` space, or one newer than this table. The engine
      // may still know it, so hand the whole thing over rather than guessing.
      if (!def) return null

      const linear = v.map(def.decode)
      if (!def.to) return wideGamut(linear, canonical, alpha, src)
      let xyz = mul(def.to, linear)
      if (def.d50) xyz = mul(D50_TO_D65, xyz)
      return wideGamut(mul(XYZ_TO_LINEAR_SRGB, xyz), canonical, alpha, src)
    }

    default:
      return null
  }
}

/** Expand one hex digit to a byte: `f` -> `0xff`, the way `#fff` means `#ffffff`. */
const expand = (c) => {
  const v = parseInt(c, 16)
  return v * 16 + v
}

function parseHex(s) {
  const h = s.slice(1)
  if (!/^[0-9a-f]+$/i.test(h)) return null
  let r, g, b
  let a = 255
  if (h.length === 3 || h.length === 4) {
    r = expand(h[0]); g = expand(h[1]); b = expand(h[2])
    if (h.length === 4) a = expand(h[3])
  } else if (h.length === 6 || h.length === 8) {
    r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16)
    if (h.length === 8) a = parseInt(h.slice(6, 8), 16)
  } else {
    return null
  }
  return { rgba: [r / 255, g / 255, b / 255, a / 255], warnings: [] }
}

function resolve(css) {
  const s = css.trim()
  if (!s) return null
  const lower = s.toLowerCase()

  if (lower === 'transparent') return { rgba: [0, 0, 0, 0], warnings: [] }
  // Per the contract the caller resolves `currentColor` before getting here; a
  // computed style never carries it. Returning null rather than guessing black is
  // what makes a caller that forgot fail loudly.
  if (lower === 'currentcolor') return null

  if (s[0] === '#') return parseHex(s)

  const open = s.indexOf('(')
  if (open > 0 && s.endsWith(')')) {
    // Lowercased for the function name, the `none` keyword and the `color()` space
    // ident. Numbers and units are unaffected, and a custom dashed-ident space is
    // not modelled here anyway.
    const out = parseFunction(lower.slice(0, open).trim(), lower.slice(open + 1, -1), s)
    if (out) return out
    return canvasColor(s, [])
  }

  const packed = namedColor(lower)
  if (packed !== undefined) {
    return { rgba: [(packed >> 16) / 255, ((packed >> 8) & 255) / 255, (packed & 255) / 255, 1], warnings: [] }
  }

  // A bare keyword this table does not hold — a system color, or something newer
  // than CSS Color 4's list. Worth one canvas probe for the latter, though a
  // system color will not survive it: it needs an element to resolve against and a
  // canvas has none, so this returns null. See the header.
  return canvasColor(s, [])
}

/**
 * Parse any CSS color into sRGB.
 *
 * @param {string} css
 * @returns {{rgba: number[], srcCss: string, warnings: string[]}|null}
 *   `rgba` is `[r, g, b, a]`, floats 0..1, sRGB. `srcCss` is the caller's string
 *   verbatim, so an emitter can round-trip the authored value instead of
 *   re-serialising it. `warnings` lists every approximation made — gamut mapping,
 *   canvas resolution — and is empty for the exact paths, which is most of them.
 *   `null` when the string is not a color, or is one only the engine can resolve
 *   (`color-mix()`, relative syntax) and there is no DOM to ask. `currentColor` is
 *   `null` by design: only the caller can resolve it.
 *
 *   The returned object and both arrays are freshly allocated, so a caller may
 *   keep or mutate `rgba` without corrupting the shared cache behind it.
 */
export function parseColor(css) {
  if (typeof css !== 'string') return null
  let hit = CACHE.get(css)
  if (hit === undefined) {
    hit = resolve(css)
    // Flat reset rather than an LRU: the working set of a capture is a few hundred
    // strings, so this only ever fires on pathological input, where paying to
    // rebuild beats paying to track recency on every hit.
    if (CACHE.size >= CACHE_MAX) CACHE.clear()
    CACHE.set(css, hit)
  }
  if (!hit) return null
  return { rgba: hit.rgba.slice(), srcCss: css, warnings: hit.warnings.slice() }
}

const hex2 = (v) => clamp(Math.round(v * 255), 0, 255).toString(16).padStart(2, '0')

/**
 * `[r, g, b, a]` -> a CSS string for SVG output.
 *
 * Opaque colors become `#rrggbb`, everything else `rgba(r, g, b, a)`: SVG 1.1
 * consumers (Figma's importer among them) read both, but only `#rrggbb` survives
 * `fill=` in every one of them. Alpha keeps four decimals — enough that 8-bit
 * source alpha round-trips exactly, short enough not to bloat the markup.
 *
 * @param {number[]} rgba  floats 0..1; a missing alpha is treated as opaque
 * @returns {string}
 */
export function toCssString(rgba) {
  if (!rgba || typeof rgba.length !== 'number' || rgba.length < 3) {
    throw new TypeError('toCssString: expected [r, g, b, a]')
  }
  const r = Number(rgba[0]) || 0
  const g = Number(rgba[1]) || 0
  const b = Number(rgba[2]) || 0
  const a = rgba.length > 3 && Number.isFinite(Number(rgba[3])) ? clamp(Number(rgba[3]), 0, 1) : 1
  if (a >= 1) return `#${hex2(r)}${hex2(g)}${hex2(b)}`
  const alpha = Number(a.toFixed(4))
  return `rgba(${clamp(Math.round(r * 255), 0, 255)}, ${clamp(Math.round(g * 255), 0, 255)}, ${clamp(Math.round(b * 255), 0, 255)}, ${alpha})`
}

/**
 * Fully transparent — nothing to paint, so the caller can drop the fill entirely.
 *
 * @param {number[]} rgba
 * @returns {boolean}
 *   `true` for a missing or non-finite alpha too: a color nobody can make sense of
 *   is not one to paint, and the alternative is emitting a NaN into the document.
 */
export function isTransparent(rgba) {
  return !rgba || !(Number(rgba[3]) > 0)
}
