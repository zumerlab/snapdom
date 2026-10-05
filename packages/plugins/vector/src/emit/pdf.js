/**
 * SVD -> PDF. The vector backend.
 *
 * The sibling product, `@zumer/snapdom-pdf`, writes a raster page with an
 * invisible text layer on top. This file writes the other thing: the page is PDF
 * *drawing operators* built from the SVD, so a box is a path, a gradient is a
 * shading, and a line of text is a `Tj` at its measured baseline. Nothing is
 * rasterized here that did not arrive as a raster in `doc.assets`.
 *
 * The byte-level writer under `../writer/` is this product's own source. It was a
 * package shared with the PDF product while both lived in one repository; they are
 * separate repositories now and each owns its copy outright. The two are free to
 * diverge and neither can break the other — which is the point, and also the
 * price: a fix here does not reach the other one.
 *
 * It is the sibling of `svg-flat.js` and it follows the same reading of the SVD
 * invariants:
 *
 *  - Children are emitted sorted by `paint.z` (invariant 3), never re-derived.
 *  - `blur` is the CSS radius, so every Gaussian sigma here is `blur / 2`
 *    (invariant 5), in exactly one helper.
 *  - Gradient geometry is unit square + 2x3 matrix in PX (invariant 6). The
 *    matrix is pushed with `cm` AFTER the clip is set, which is the one thing SVG
 *    could not do (there `transform` establishes the space its own `clip-path` is
 *    resolved in).
 *  - `unit` keys are read verbatim per CONTRACT.md: `linear:{p0,p1}`,
 *    `radial:{center,radius,shape}`, `angular:{center,startAngle}`.
 *
 * What PDF makes hard, and what this file does about it — all of it declared
 * through `ctx.note()`, none of it silent:
 *
 *  - **Alpha.** The basic graphics state has none. Every translucent fill, stroke
 *    and group goes through an `ExtGState` with `/ca` and `/CA`.
 *  - **Gradient stop alpha.** A shading carries colour, never alpha. A ramp whose
 *    stops differ in alpha is emitted with a **luminosity soft mask**: the same
 *    shading geometry, in DeviceGray, whose value IS the alpha, inside a
 *    transparency group referenced from `/SMask`. That is exact, not an
 *    approximation, and it is why `radial-gradient(..., rgba(255,255,255,0))`
 *    does not come out as an opaque white ellipse.
 *  - **Conic gradients.** PDF has no angular shading, so they are composed as a
 *    fan of flat sectors, the same construction `svg-flat.js` uses — laid down
 *    over an opaque disc and two bands wide each, because sectors that only
 *    touch let the backdrop through their shared antialiased edge and turn a
 *    conic into a pinwheel of spokes.
 *  - **Shadows and blur.** PDF has neither. A shadow with no blur is one offset
 *    path. A blurred one is composed as concentric grown/shrunk copies of the
 *    path whose accumulated opacity follows the Gaussian edge profile — the
 *    "layers" option of the two honest ones. **Nothing is rasterized to fake it**,
 *    and every blurred shadow says so in the diagnostics.
 *  - **Text.** One `BT`/`ET` per block, one `Tj` per measured line at
 *    `text.lines[].baseline` — the SVD already broke the lines and PDF is never
 *    allowed to re-break them. `Tc`/`Tw` carry letter/word spacing and `Tz`
 *    stretches the line to the width the browser measured. There are no font
 *    binaries in an SVD today, so the glyphs are base-14 and the diagnostics name
 *    the substitution, family by family. A character WinAnsi cannot address is
 *    drawn from Symbol or ZapfDingbats when either has it — that is what makes
 *    `★★★★☆`, `→` and `Δ` appear at all — with a `/ToUnicode` so the character
 *    on the clipboard is still the page's. What neither font has stays invisible
 *    but selectable, and says so.
 *
 * Pure and DOM-free in Node for everything except one path: a raster asset that
 * is not already a JPEG needs a canvas to re-encode, and that path is taken only
 * when a DOM is present. Without one it degrades, loudly.
 */
// The byte-level writer, from the internal package both paid plugins share. It
// used to be a relative path into `packages/pdf`, which made this product import
// the other product's source: undeclared, unbuildable on its own, and a licence
// question nobody wanted to answer. the vendored writer is bundled into this
// build and into that one separately, so the two plugins ship with no reference
// to each other. Nothing above the object table is shared, and nothing here may
// import from `packages/pdf` again.
import {
  createPdfDoc, pdfString, BASE14, deflate, canDeflate, createUnicodeFont, encodeImage,
  setWarnPrefix,
} from '../writer/index.js'

setWarnPrefix('[snapdom-vector]')

/** CSS px -> PDF points (96dpi -> 72dpi). PDF's own unit, not a shared constant. */
const PT = 0.75

/** Circular arc as a cubic: the classic 4/3·tan(θ/4), θ = 90°. */
const KAPPA = 0.5523

/** How many flat wedges approximate one conic gradient. 2.8° each. */
const CONIC_WEDGES = 128

/** Unit-space radius of the conic fan: a unit square's far corner is at √2. */
const CONIC_REACH = 2

/** Degrees between two points on a sector's outer boundary. See `sectorPath`. */
const CONIC_STEP = 45

/** Painted px of the disc that caps the point 128 sectors cannot resolve. */
const CONIC_APEX_PX = 1.25

/**
 * Concentric copies per blurred shadow.
 *
 * Measured against Chromium's own blur on the `0 12px 28px -8px` card shadow:
 * 10 copies leave a staircase whose steps read 14/255, which is visible on a
 * flat backdrop; 24 bring it to ~5/255, at the price of ~40% more content
 * stream. Anything past 24 buys under 2/255.
 */
const SHADOW_LAYERS = 24

/** A Gaussian edge is dead by 3σ; that is where the outermost copy sits. */
const SHADOW_REACH = 3

const ZERO_RADII = [[0, 0], [0, 0], [0, 0], [0, 0]]

/** CSS `mix-blend-mode` -> PDF `/BM`. `plus-lighter` has no PDF equivalent. */
const BLEND_MODES = {
  normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay',
  darken: 'Darken', lighten: 'Lighten', 'color-dodge': 'ColorDodge',
  'color-burn': 'ColorBurn', 'hard-light': 'HardLight', 'soft-light': 'SoftLight',
  difference: 'Difference', exclusion: 'Exclusion', hue: 'Hue',
  saturation: 'Saturation', color: 'Color', luminosity: 'Luminosity',
}

/** Diagnostic severity per SVD fidelity grade — the orchestrator's own table. */
const SEVERITY_OF = { E: 'info', A: 'info', C: 'info', R: 'warn', RH: 'warn', O: 'warn' }

// ——— primitives ———

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const finite = (v, dflt = 0) => (Number.isFinite(Number(v)) ? Number(v) : dflt)

/**
 * A number for a content stream. PDF has no exponent syntax, so anything that
 * would serialize as `1e-7` has to come out as a decimal or not at all.
 */
function fmt (v, places) {
  const n = Number.isFinite(Number(v)) ? Number(v) : 0
  if (Math.abs(n) < 5e-7) return '0'
  let s = n.toFixed(places)
  if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '')
  return s === '-0' ? '0' : s
}

/** Coordinates: 4 decimals of a CSS px is far below a device pixel. */
const num = (v) => fmt(v, 4)

/** Matrix entries: a scale of 1/1000 still needs to survive rounding. */
const nm = (v) => fmt(v, 6)

const clamp01 = (v) => (isNum(v) ? Math.min(1, Math.max(0, v)) : 1)

/** Uppercase hex of a fixed width, for CMap entries. */
const hex = (n, width) => n.toString(16).toUpperCase().padStart(width, '0')

/** A `/ToUnicode` destination is UTF-16BE, so an astral codepoint is a pair. */
function utf16be (cp) {
  if (cp <= 0xffff) return hex(cp, 4)
  const v = cp - 0x10000
  return hex(0xd800 | (v >> 10), 4) + hex(0xdc00 | (v & 0x3ff), 4)
}

const rectOf = (r) => ({
  x: finite(r && r.x), y: finite(r && r.y),
  w: Math.max(0, finite(r && r.w)), h: Math.max(0, finite(r && r.h)),
})

/** `m1 · m2`: the point is transformed by `m2` first — SVG's reading order. */
function multiply (m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
}

const matrixOp = (m) => `${m.map(nm).join(' ')} cm`

const IDENTITY = [1, 0, 0, 1, 0, 0]

/** `a` then `b`, in PDF's own order: the point goes through `a` first. */
const matMul = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
]

const applyMat = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

/**
 * The axis-aligned box of a rect after a matrix — all four corners, not two,
 * because a rotated run's bounding box is not the transform of its corners.
 */
function transformBox (m, x0, y0, x1, y1) {
  const pts = [applyMat(m, x0, y0), applyMat(m, x1, y0), applyMat(m, x1, y1), applyMat(m, x0, y1)]
  return [
    Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])),
    Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])),
  ]
}

const isMatrix = (m) => Array.isArray(m) && m.length === 6 && m.every((v) => Number.isFinite(Number(v)))

/**
 * The caller's page geometry, validated. A malformed entry is not silently
 * dropped into a default page — it is the difference between a document that
 * prints and one that does not, and the caller cannot see the PDF.
 */
function readPages (pages) {
  if (pages === null || pages === undefined) return null
  if (!Array.isArray(pages) || !pages.length) {
    throw new TypeError('svdToPdf: `pages`, when given, must be a non-empty array of page geometries')
  }
  return pages.map((p, i) => {
    if (!isObject(p)) throw new TypeError(`svdToPdf: pages[${i}] is not an object`)
    const size = p.size
    if (!Array.isArray(size) || size.length !== 2 || !(finite(size[0]) > 0) || !(finite(size[1]) > 0)) {
      throw new TypeError(`svdToPdf: pages[${i}].size must be [w, h] in points, both > 0`)
    }
    if (!isMatrix(p.matrix)) {
      throw new TypeError(`svdToPdf: pages[${i}].matrix must be a 6-number PDF matrix`)
    }
    let clip = null
    if (p.clip !== null && p.clip !== undefined) {
      if (!Array.isArray(p.clip) || p.clip.length !== 4 || !p.clip.every((v) => Number.isFinite(Number(v)))) {
        throw new TypeError(`svdToPdf: pages[${i}].clip must be [x, y, w, h] in page points`)
      }
      clip = p.clip.map(Number)
    }
    return { size: [Number(size[0]), Number(size[1])], matrix: p.matrix.map(Number), clip }
  })
}

const readMatrix = (v) => (Array.isArray(v) && v.length === 6 && v.every(isNum) ? v : null)

// ——— colour ———

const channel = (rgba, i) => Math.min(1, Math.max(0, finite(rgba && rgba[i], i === 3 ? 1 : 0)))

const alphaOf = (rgba) => (Array.isArray(rgba) && isNum(rgba[3]) ? clamp01(rgba[3]) : 1)

/** Non-stroking colour. */
const fillColorOp = (rgba) => `${num(channel(rgba, 0))} ${num(channel(rgba, 1))} ${num(channel(rgba, 2))} rg`

/** Stroking colour. */
const strokeColorOp = (rgba) => `${num(channel(rgba, 0))} ${num(channel(rgba, 1))} ${num(channel(rgba, 2))} RG`

const colorArray = (rgba) => `[${num(channel(rgba, 0))} ${num(channel(rgba, 1))} ${num(channel(rgba, 2))}]`

// ——— geometry ———

function normalizeRadii (radii, w, h) {
  if (!Array.isArray(radii) || radii.length !== 4) return ZERO_RADII
  const out = radii.map((corner) => (Array.isArray(corner)
    ? [Math.max(0, finite(corner[0])), Math.max(0, finite(corner[1]))]
    : [0, 0]))
  // parseRadii already applied CSS Backgrounds §5.5, but a hand-assembled
  // document has not, and overlapping arcs are a self-intersecting path here.
  let f = 1
  const limit = (side, a, b) => {
    const sum = a + b
    if (sum > 0 && side >= 0) f = Math.min(f, side / sum)
  }
  limit(w, out[0][0], out[1][0])
  limit(h, out[1][1], out[2][1])
  limit(w, out[3][0], out[2][0])
  limit(h, out[0][1], out[3][1])
  return f < 1 ? out.map(([rx, ry]) => [rx * f, ry * f]) : out
}

const hasRadius = (radii) => radii.some(([rx, ry]) => rx > 0 && ry > 0)

/** Grow (d < 0) or shrink (d > 0) radii. A square corner stays square growing. */
function offsetRadii (radii, d) {
  if (!d) return radii
  return radii.map(([rx, ry]) => (d > 0
    ? [Math.max(0, rx - d), Math.max(0, ry - d)]
    : [rx > 0 ? rx - d : 0, ry > 0 ? ry - d : 0]))
}

const rectPath = (x, y, w, h) => `${num(x)} ${num(y)} ${num(w)} ${num(h)} re`

/**
 * A rounded rectangle with four independent `[rx, ry]` corners, as cubics.
 *
 * PDF has no arc operator, so each quarter ellipse is one Bézier with control
 * points at KAPPA of the corner's own rx/ry — which is what makes an anisotropic
 * corner (`border-radius: 40px / 12px`) come out as the ellipse CSS asks for and
 * not as a circle of one of the two radii. The corners run tl -> tr -> br -> bl,
 * clockwise in this y-down space, the same direction `svg-flat.js` sweeps.
 */
function boxPath (box, radii) {
  const [tl, tr, br, bl] = radii
  const { x, y } = box
  const x2 = x + box.w
  const y2 = y + box.h
  const ops = [`${num(x + tl[0])} ${num(y)} m`]
  ops.push(`${num(x2 - tr[0])} ${num(y)} l`)
  if (tr[0] > 0 && tr[1] > 0) {
    ops.push(`${num(x2 - tr[0] + KAPPA * tr[0])} ${num(y)} ` +
      `${num(x2)} ${num(y + tr[1] - KAPPA * tr[1])} ${num(x2)} ${num(y + tr[1])} c`)
  }
  ops.push(`${num(x2)} ${num(y2 - br[1])} l`)
  if (br[0] > 0 && br[1] > 0) {
    ops.push(`${num(x2)} ${num(y2 - br[1] + KAPPA * br[1])} ` +
      `${num(x2 - br[0] + KAPPA * br[0])} ${num(y2)} ${num(x2 - br[0])} ${num(y2)} c`)
  }
  ops.push(`${num(x + bl[0])} ${num(y2)} l`)
  if (bl[0] > 0 && bl[1] > 0) {
    ops.push(`${num(x + bl[0] - KAPPA * bl[0])} ${num(y2)} ` +
      `${num(x)} ${num(y2 - bl[1] + KAPPA * bl[1])} ${num(x)} ${num(y2 - bl[1])} c`)
  }
  ops.push(`${num(x)} ${num(y + tl[1])} l`)
  if (tl[0] > 0 && tl[1] > 0) {
    ops.push(`${num(x)} ${num(y + tl[1] - KAPPA * tl[1])} ` +
      `${num(x + tl[0] - KAPPA * tl[0])} ${num(y)} ${num(x + tl[0])} ${num(y)} c`)
  }
  ops.push('h')
  return ops.join('\n')
}

/** The box as a path, choosing `re` when there is no corner to draw. */
function shapePath (box, radii) {
  return hasRadius(radii) ? boxPath(box, radii) : rectPath(box.x, box.y, box.w, box.h)
}

/** A circle as four cubics — the conic fan's apex cap. */
function circlePath (cx, cy, r) {
  const k = KAPPA * r
  return [
    `${num(cx + r)} ${num(cy)} m`,
    `${num(cx + r)} ${num(cy + k)} ${num(cx + k)} ${num(cy + r)} ${num(cx)} ${num(cy + r)} c`,
    `${num(cx - k)} ${num(cy + r)} ${num(cx - r)} ${num(cy + k)} ${num(cx - r)} ${num(cy)} c`,
    `${num(cx - r)} ${num(cy - k)} ${num(cx - k)} ${num(cy - r)} ${num(cx)} ${num(cy - r)} c`,
    `${num(cx + k)} ${num(cy - r)} ${num(cx + r)} ${num(cy - k)} ${num(cx + r)} ${num(cy)} c`,
    'h',
  ].join('\n')
}

/** Grow a box and its radii by `g` (negative shrinks). */
function grownBox (box, radii, g) {
  return {
    box: { x: box.x - g, y: box.y - g, w: box.w + 2 * g, h: box.h + 2 * g },
    radii: offsetRadii(radii, -g),
  }
}

// ——— resources ———

/**
 * One `/Resources` dictionary shared by the page and every form XObject.
 *
 * It has to be one indirect object because a transparency group that paints a
 * shading needs that shading in scope, and a soft-mask group is reached from an
 * ExtGState that lives in the very dictionary the group points back at. Sharing
 * one object makes that circle legal instead of a duplication problem.
 */
function createResources (doc) {
  const fonts = new Map()
  const symbols = new Map()
  const gstates = new Map()
  const shadings = new Map()
  const xobjects = new Map()
  let unicode = null

  const intern = (map, prefix, key, make) => {
    const hit = map.get(key)
    if (hit) return hit.name
    const name = `${prefix}${map.size}`
    map.set(key, { name, id: make(name) })
    return name
  }

  return {
    /** A base-14 font resource, by BASE14 key. */
    font: (key) => intern(fonts, 'F', key, () => doc.add(
      `<< /Type /Font /Subtype /Type1 /BaseFont /${BASE14[key] || BASE14.sans} ` +
      '/Encoding /WinAnsiEncoding >>'
    )),
    /**
     * Symbol or ZapfDingbats — the two base-14 faces that are not Latin, and the
     * only glyphs this backend can paint for a codepoint WinAnsi cannot address.
     * Both have a BUILT-IN encoding, so no `/Encoding`: naming WinAnsi here is the
     * classic way to get Helvetica's glyphs out of a Dingbats font.
     *
     * @param {'Symbol'|'ZapfDingbats'} base
     * @returns {{name: string, used: Map<number, number>}} `used` is code -> the
     *   real codepoint, and it becomes the font's `/ToUnicode`: the glyph is
     *   Adobe's, but a copy-paste has to give back the character the page had.
     */
    symbolFont (base) {
      let entry = symbols.get(base)
      if (!entry) {
        entry = { name: `FS${symbols.size}`, id: doc.reserve(), used: new Map() }
        symbols.set(base, entry)
      }
      return entry
    },
    /** Writes the symbol font dictionaries. Call once, before `body()`. */
    finalizeSymbols () {
      for (const [base, entry] of symbols) {
        const chars = [...entry.used].map(([code, cp]) => `<${hex(code, 2)}> <${utf16be(cp)}>`)
        const lines = [
          '/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap',
          '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
          '/CMapName /Adobe-Identity-UCS def', '/CMapType 2 def',
          '1 begincodespacerange', '<00> <FF>', 'endcodespacerange',
        ]
        for (let i = 0; i < chars.length; i += 100) {
          const chunk = chars.slice(i, i + 100)
          lines.push(`${chunk.length} beginbfchar`, ...chunk, 'endbfchar')
        }
        lines.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end')
        const toUnicode = doc.addStream('', lines.join('\n'))
        doc.fill(entry.id, `<< /Type /Font /Subtype /Type1 /BaseFont /${base} ` +
          `/ToUnicode ${toUnicode} 0 R >>`)
      }
    },
    /** The document-wide Type0 font, registered on first use. */
    useUnicode (font) { unicode = font },
    /** An ExtGState, content-addressed: `<< ... >>` body without the delimiters. */
    gs: (body) => intern(gstates, 'G', body, () => doc.add(`<< ${body} >>`)),
    shading: (body) => intern(shadings, 'S', body, () => doc.add(`<< ${body} >>`)),
    /** A form or image XObject whose object id already exists. */
    xobject: (id, prefix = 'X') => intern(xobjects, prefix, `${prefix}:${id}`, () => id),
    body () {
      const parts = []
      const fontRefs = [...fonts.values()].map((f) => `/${f.name} ${f.id} 0 R`)
      for (const entry of symbols.values()) fontRefs.push(`/${entry.name} ${entry.id} 0 R`)
      if (unicode && unicode.id !== null) fontRefs.push(`/${unicode.name} ${unicode.id} 0 R`)
      if (fontRefs.length) parts.push(`/Font << ${fontRefs.join(' ')} >>`)
      for (const [label, map] of [['ExtGState', gstates], ['Shading', shadings], ['XObject', xobjects]]) {
        if (!map.size) continue
        parts.push(`/${label} << ${[...map.values()].map((e) => `/${e.name} ${e.id} 0 R`).join(' ')} >>`)
      }
      // ProcSet is obsolete but Acrobat's preflight still asks for it.
      parts.push('/ProcSet [/PDF /Text /ImageB /ImageC /ImageI]')
      return `<< ${parts.join(' ')} >>`
    },
  }
}

/**
 * The graphics-state name for a compositing triple, or null when the default
 * state already says all of it.
 *
 * @param {object} ctx
 * @param {number} ca   non-stroking alpha
 * @param {number} CA   stroking alpha
 * @param {string} [blend]
 * @param {string} [smask]  `<< /S /Luminosity ... >>` body, already assembled
 */
function gsFor (ctx, ca, CA, blend, smask) {
  const parts = []
  if (ca < 1) parts.push(`/ca ${num(ca)}`)
  if (CA < 1) parts.push(`/CA ${num(CA)}`)
  if (blend && blend !== 'Normal') parts.push(`/BM /${blend}`)
  if (smask) parts.push(`/SMask ${smask}`)
  if (!parts.length) return null
  return ctx.res.gs(`/Type /ExtGState ${parts.join(' ')}`)
}

/** CSS blend name -> PDF `/BM`, with a note when PDF has no counterpart. */
function blendName (ctx, nodeId, css) {
  if (typeof css !== 'string' || css === 'normal' || !css) return null
  const name = BLEND_MODES[css]
  if (!name) {
    ctx.note(nodeId, `blend mode "${css}" has no PDF equivalent; it is composited as Normal.`,
      'emit.pdf.blend-unsupported', 'O')
    return null
  }
  return name
}

// ——— gradients ———

function readPoint (v) {
  if (Array.isArray(v) && isNum(Number(v[0])) && isNum(Number(v[1]))) return [Number(v[0]), Number(v[1])]
  if (isObject(v) && Number.isFinite(Number(v.x)) && Number.isFinite(Number(v.y))) return [Number(v.x), Number(v.y)]
  return null
}

/**
 * `unit.radius` is `[rx, ry]` OR a bare number, both by contract: the collector
 * normalizes anisotropy into `transform`, so the isotropic scalar is the honest
 * shape and `[r, r]` is what it means. Not a divergence — see CONTRACT.md.
 */
function readRadius (v) {
  if (Array.isArray(v)) {
    const rx = Number(v[0])
    const ry = Number(v[1])
    return isNum(rx) && isNum(ry) ? { r: [rx, ry], scalar: false } : null
  }
  return isNum(Number(v)) && v !== null && v !== '' ? { r: [Number(v), Number(v)], scalar: true } : null
}

/**
 * `stops` as a monotonic 0..1 list. Null when the paint carries nothing
 * paintable, which the caller turns into a note plus a dropped layer.
 */
function readStops (paint, ctx, nodeId) {
  if (!Array.isArray(paint.stops)) return null
  const out = []
  let prev = 0
  let unplaced = 0
  for (const stop of paint.stops) {
    if (!isObject(stop) || !Array.isArray(stop.color)) continue
    // CONTRACT.md fixes the field as `t`. Documents in `out/vector` currently
    // carry BOTH `t` and a duplicate `p`; `t` is the contract and the one read.
    const t = Number(stop.t)
    if (!Number.isFinite(t)) unplaced++
    const p = Math.min(1, Math.max(prev, Number.isFinite(t) ? t : prev))
    prev = p
    out.push({ p, color: stop.color })
  }
  if (unplaced && ctx) {
    ctx.note(nodeId, `${unplaced} of ${out.length} gradient stops carry no numeric \`t\`; they collapse onto ` +
      'the previous stop, so the ramp is flatter than the source.', 'emit.pdf.gradient-stop-unplaced', 'O')
  }
  return out.length >= 2 ? out : null
}

/** Linear sRGB interpolation between stops — the same one every editor does. */
function sampleStops (stops, p) {
  if (p <= stops[0].p) return stops[0].color
  const last = stops[stops.length - 1]
  if (p >= last.p) return last.color
  for (let i = 1; i < stops.length; i++) {
    const b = stops[i]
    if (p > b.p) continue
    const a = stops[i - 1]
    const span = b.p - a.p
    const t = span > 0 ? (p - a.p) / span : 0
    return [0, 1, 2, 3].map((k) => finite(a.color[k], k === 3 ? 1 : 0) +
      (finite(b.color[k], k === 3 ? 1 : 0) - finite(a.color[k], k === 3 ? 1 : 0)) * t)
  }
  return last.color
}

/**
 * Stops padded to span exactly 0..1 with strictly increasing positions, which is
 * what a Type 3 stitching function's `/Bounds` requires. A hard stop (two stops
 * at the same `t`) keeps a 1e-6 gap: a step that steep is a step.
 */
function functionStops (stops) {
  const out = stops.map((s) => ({ p: Math.min(1, Math.max(0, s.p)), color: s.color }))
  if (out[0].p > 0) out.unshift({ p: 0, color: out[0].color })
  if (out[out.length - 1].p < 1) out.push({ p: 1, color: out[out.length - 1].color })
  const packed = [out[0]]
  for (let i = 1; i < out.length; i++) {
    const prev = packed[packed.length - 1]
    packed.push({ p: Math.max(out[i].p, prev.p + 1e-6), color: out[i].color })
  }
  // The padding above can push the last stop past 1; renormalize onto [0, 1].
  const span = packed[packed.length - 1].p
  if (span > 1) for (const s of packed) s.p /= span
  packed[0].p = 0
  packed[packed.length - 1].p = 1
  return packed
}

/**
 * A colour ramp as a PDF function: one Type 2 exponential per segment, stitched
 * by a Type 3 when there is more than one.
 *
 * @param {(rgba: number[]) => string} out  `colorArray` for colour, a gray
 *   literal for the alpha plane of a soft mask
 * @param {number} n  components of the output space
 */
function rampFunction (pdf, stops, out, n) {
  const packed = functionStops(stops)
  const segment = (a, b) => pdf.add(
    `<< /FunctionType 2 /Domain [0 1] /C0 ${out(a.color)} /C1 ${out(b.color)} /N 1 >>`
  )
  if (packed.length === 2) return segment(packed[0], packed[1])
  const ids = []
  const bounds = []
  for (let i = 1; i < packed.length; i++) {
    ids.push(segment(packed[i - 1], packed[i]))
    if (i < packed.length - 1) bounds.push(num(packed[i].p))
  }
  return pdf.add(
    `<< /FunctionType 3 /Domain [0 1] /Functions [${ids.map((id) => `${id} 0 R`).join(' ')}] ` +
    `/Bounds [${bounds.join(' ')}] /Encode [${ids.map(() => '0 1').join(' ')}] ` +
    `/Range [${new Array(n).fill('0 1').join(' ')}] >>`
  )
}

const grayArray = (rgba) => `[${num(alphaOf(rgba))}]`

/**
 * Shading geometry for a linear or radial paint, in the gradient's own unit
 * space, plus whatever has to be folded into the matrix to get there.
 *
 * @returns {{coords: string, type: number, matrix: number[]}|null}
 */
function shadingGeometry (paint, ctx, nodeId, matrix) {
  const unit = isObject(paint.unit) ? paint.unit : {}
  if (paint.type === 'linear') {
    const from = readPoint(unit.p0)
    const to = readPoint(unit.p1)
    if (!from || !to) {
      ctx.note(nodeId, 'a linear gradient carries no unit.p0/unit.p1; the default top-to-bottom axis is used ' +
        'and the gradient direction is lost.', 'emit.pdf.gradient-no-axis', 'A')
    }
    const [x1, y1] = from || [0, 0]
    const [x2, y2] = to || [0, 1]
    if (Math.abs(x2 - x1) < 1e-9 && Math.abs(y2 - y1) < 1e-9) {
      ctx.note(nodeId, 'a linear gradient has a zero-length axis; it is painted as the flat colour of its last stop.',
        'emit.pdf.gradient-zero-axis', 'A')
      return null
    }
    return { type: 2, coords: `[${num(x1)} ${num(y1)} ${num(x2)} ${num(y2)}]`, matrix }
  }

  const center = readPoint(unit.center)
  if (!center) {
    ctx.note(nodeId, 'a radial gradient carries no unit.center; the unit square centre is used.',
      'emit.pdf.gradient-no-center', 'A')
  }
  const [cx, cy] = center || [0.5, 0.5]
  const radius = readRadius(unit.radius)
  if (!radius) {
    ctx.note(nodeId, 'a radial gradient carries no unit.radius; 0.5 (the inscribed circle) is used.',
      'emit.pdf.gradient-no-radius', 'A')
  }
  const [rx, ry] = radius ? radius.r : [0.5, 0.5]
  if (!(rx > 0) || !(ry > 0)) {
    ctx.note(nodeId, 'a radial gradient has a zero radius; it is painted as the flat colour of its last stop.',
      'emit.pdf.gradient-zero-radius', 'A')
    return null
  }
  // A Type 3 shading has one radius per circle. An anisotropic unit radius is
  // still exact: scaling y about the centre inside the matrix is that ellipse.
  let m = matrix
  if (Math.abs(ry - rx) > 1e-9) {
    const k = ry / rx
    m = multiply(m, [1, 0, 0, k, 0, cy - k * cy])
  }
  return {
    type: 3,
    coords: `[${num(cx)} ${num(cy)} 0 ${num(cx)} ${num(cy)} ${num(rx)}]`,
    matrix: m,
  }
}

/**
 * Paint a linear or radial gradient into the current clip.
 *
 * The soft mask is the whole reason this is not four lines: a PDF shading has a
 * colour function and nothing else, so a ramp whose stops differ in alpha needs a
 * second, DeviceGray shading of the SAME geometry, rendered into a luminosity
 * transparency group and hung off `/SMask`. `/BC [0]` makes everything outside
 * the group's BBox fully transparent, which is why that box is 100 unit-squares
 * wide — the clip, not the BBox, is what bounds the paint.
 *
 * @returns {boolean} false when nothing could be painted
 */
function paintGradient (out, ctx, nodeId, paint, matrix, blend, rect) {
  const stops = readStops(paint, ctx, nodeId)
  if (!stops) {
    ctx.note(nodeId, `a ${paint.type} gradient has fewer than 2 usable stops; the layer is dropped.`,
      'emit.pdf.gradient-no-stops', 'O')
    return false
  }
  const geometry = shadingGeometry(paint, ctx, nodeId, matrix)
  if (!geometry) {
    const color = stops[stops.length - 1].color
    const alpha = alphaOf(color)
    const gs = gsFor(ctx, alpha, alpha, blend)
    if (gs) out.push(`/${gs} gs`)
    out.push(fillColorOp(color))
    out.push(rectPath(rect.x, rect.y, rect.w, rect.h))
    out.push('f')
    return true
  }

  const alphas = stops.map((s) => alphaOf(s.color))
  const flat = alphas.every((a) => Math.abs(a - alphas[0]) < 1e-6)
  let smask = null
  let ca = 1
  if (flat) {
    ca = alphas[0]
  } else {
    const alphaFn = rampFunction(ctx.pdf, stops, grayArray, 1)
    const alphaName = ctx.res.shading(`/ShadingType ${geometry.type} /ColorSpace /DeviceGray ` +
      `/Coords ${geometry.coords} /Function ${alphaFn} 0 R /Extend [true true]`)
    const formId = ctx.pdf.reserve()
    ctx.forms.push({
      id: formId,
      body: `/${alphaName} sh`,
      // The BBox is 100 unit squares wide because /BC [0] makes everything
      // outside it fully transparent, and the CLIP — not this box — is what
      // bounds the paint.
      dict: '/Type /XObject /Subtype /Form /FormType 1 /BBox [-100 -100 101 101] ' +
        `/Matrix [${geometry.matrix.map(nm).join(' ')}] ` +
        '/Group << /Type /Group /S /Transparency /CS /DeviceGray /I true >> ' +
        `/Resources ${ctx.resourcesId} 0 R`,
    })
    smask = `<< /Type /Mask /S /Luminosity /G ${formId} 0 R /BC [0] >>`
    ctx.note(nodeId, `a ${paint.type} gradient has per-stop alpha, which a PDF shading cannot carry; the ramp's ` +
      'alpha is emitted as a luminosity soft mask over the same geometry (exact, not an approximation).',
      'emit.pdf.gradient-soft-mask', 'E')
  }

  const colorFn = rampFunction(ctx.pdf, stops, colorArray, 3)
  const shBody = `/ShadingType ${geometry.type} /ColorSpace /DeviceRGB ` +
    `/Coords ${geometry.coords} /Function ${colorFn} 0 R /Extend [true true]`
  const shName = ctx.res.shading(shBody)
  const gs = gsFor(ctx, ca, ca, blend, smask)
  if (gs) out.push(`/${gs} gs`)
  out.push(matrixOp(geometry.matrix))
  out.push(`/${shName} sh`)
  return true
}

/**
 * One sector of the fan, from `from` degrees to `to`, as a polygon out to
 * `CONIC_REACH`. The boundary is sampled every `CONIC_STEP` degrees so the chord
 * never cuts inside the clip: at reach 2 a 45° chord still stands 1.85 unit
 * squares off the centre, and the farthest corner of a unit square is at 1.415.
 */
function sectorPath (cx, cy, from, to) {
  const steps = Math.max(1, Math.ceil((to - from) / CONIC_STEP))
  // CSS conic angles run clockwise from 12 o'clock; y grows down here, so up is -y.
  const at = (deg) => {
    const rad = (deg * Math.PI) / 180
    return `${num(cx + CONIC_REACH * Math.sin(rad))} ${num(cy - CONIC_REACH * Math.cos(rad))}`
  }
  let path = `${num(cx)} ${num(cy)} m`
  for (let s = 0; s <= steps; s++) path += ` ${at(from + ((to - from) * s) / steps)} l`
  return `${path} h`
}

/**
 * The fan, back to front.
 *
 * Two rules, and both of them are the difference between a conic and a pinwheel:
 *
 *  - The first band is the whole DISC, not a sector. Sectors that merely touch
 *    are antialiased independently and let the backdrop through the seam; 128 of
 *    those drew 128 white spokes on a page rendered at 1x. With an opaque disc
 *    underneath, no seam can ever reach the backdrop, at any radius.
 *  - Every other band is painted TWO bands wide, so the sector after it buries
 *    its trailing edge instead of butting against it. Two bands and no more:
 *    when all 128 ended on the same ray, that one ray stacked 128 antialiased
 *    edges and the accumulated tail dragged colour from a third of the sweep
 *    away into it — a visible hairline at the start angle.
 *
 * @param {(rgba: number[]) => string} colorOp  `rg` for the paint, `g` for its mask
 */
function conicFan (cx, cy, start, stops, colorOp, apex) {
  const ops = []
  const mean = [0, 0, 0, 0]
  for (let i = 0; i < CONIC_WEDGES; i++) {
    const sample = sampleStops(stops, (i + 0.5) / CONIC_WEDGES)
    const alpha = alphaOf(sample)
    for (let k = 0; k < 3; k++) mean[k] += channel(sample, k) * alpha
    mean[3] += alpha
    ops.push(colorOp(sample))
    ops.push(i === 0 ? circlePath(cx, cy, CONIC_REACH)
      : sectorPath(cx, cy, start + (i / CONIC_WEDGES) * 360,
        start + Math.min(1, (i + 2) / CONIC_WEDGES) * 360))
    ops.push('f')
  }
  if (apex > 0 && mean[3] > 1e-6) {
    ops.push(colorOp([mean[0] / mean[3], mean[1] / mean[3], mean[2] / mean[3], mean[3] / CONIC_WEDGES]))
    ops.push(circlePath(cx, cy, apex))
    ops.push('f')
  }
  return ops
}

/**
 * A conic gradient as a fan of flat sectors — PDF has no angular shading and a
 * radial is not an approximation of a pinwheel, it is a different picture. The
 * fan is exact geometry apart from the quantized sweep.
 */
function paintConic (out, ctx, nodeId, paint, matrix, blend) {
  const stops = readStops(paint, ctx, nodeId)
  if (!stops) {
    ctx.note(nodeId, 'an angular gradient has fewer than 2 usable stops; the layer is dropped.',
      'emit.pdf.gradient-no-stops', 'O')
    return false
  }
  const unit = isObject(paint.unit) ? paint.unit : {}
  const center = readPoint(unit.center)
  if (!center) {
    ctx.note(nodeId, 'an angular gradient carries no unit.center; the unit square centre is used.',
      'emit.pdf.gradient-no-center', 'A')
  }
  const hasStart = isNum(Number(unit.startAngle)) && unit.startAngle !== null && unit.startAngle !== ''
  if (!hasStart) {
    ctx.note(nodeId, 'an angular gradient carries no unit.startAngle; the sweep starts at 12 o\'clock and its ' +
      'rotation is lost.', 'emit.pdf.gradient-no-start-angle', 'A')
  }
  ctx.note(nodeId, `conic-gradient has no PDF shading type; it is composed as ${CONIC_WEDGES} flat sectors ` +
    `(the sweep is quantized to ${num(360 / CONIC_WEDGES)} degrees, the colour within each band is its ` +
    'mid-angle sample).', 'emit.pdf.conic-fan', 'A')

  const start = hasStart ? Number(unit.startAngle) : 0
  const [cx, cy] = center || [0.5, 0.5]
  // The apex is asked for in painted px and drawn in unit space.
  const scale = (Math.hypot(matrix[0], matrix[1]) + Math.hypot(matrix[2], matrix[3])) / 2
  const apex = scale > 1e-6 ? CONIC_APEX_PX / scale : 0
  if (apex > 0) {
    ctx.note(nodeId, `the ${CONIC_WEDGES} sectors cannot resolve the point they all meet at, so a ` +
      `${num(CONIC_APEX_PX * 2)}px disc of the sweep's mean colour caps the apex; within that disc the angular ` +
      'ramp is flat.', 'emit.pdf.conic-apex', 'A')
  }

  const alphas = stops.map((s) => alphaOf(s.color))
  const flat = alphas.every((a) => Math.abs(a - alphas[0]) < 1e-6)
  let smask = null
  let ca = 1
  if (flat) {
    ca = alphas[0]
  } else {
    // Same construction the axial and radial ramps use: the alpha becomes a
    // DeviceGray fan of the SAME geometry inside a luminosity group. It has to
    // be a mask rather than per-sector `ca` because the sectors OVERLAP — a
    // translucent one painted over its neighbour would darken the overlap.
    const formId = ctx.pdf.reserve()
    ctx.forms.push({
      id: formId,
      body: conicFan(cx, cy, start, stops, (rgba) => `${num(alphaOf(rgba))} g`, apex).join('\n'),
      dict: '/Type /XObject /Subtype /Form /FormType 1 /BBox [-100 -100 101 101] ' +
        `/Matrix [${matrix.map(nm).join(' ')}] ` +
        '/Group << /Type /Group /S /Transparency /CS /DeviceGray /I true >> ' +
        `/Resources ${ctx.resourcesId} 0 R`,
    })
    smask = `<< /Type /Mask /S /Luminosity /G ${formId} 0 R /BC [0] >>`
    ctx.note(nodeId, 'an angular gradient has per-stop alpha; the fan is painted opaque and its alpha is ' +
      'emitted as a luminosity soft mask over the same sectors, so the overlap that removes the seams ' +
      'cannot accumulate.', 'emit.pdf.gradient-soft-mask', 'E')
  }

  const fan = conicFan(cx, cy, start, stops, fillColorOp, apex)
  const gs = gsFor(ctx, ca, ca, blend, smask)
  if (!gs) {
    out.push(matrixOp(matrix))
    for (const op of fan) out.push(op)
    return true
  }
  // Group alpha or a blend mode applies to the fan AS A WHOLE. Composited sector
  // by sector, every overlap would be composited twice.
  const formId = ctx.pdf.reserve()
  ctx.forms.push({
    id: formId,
    body: fan.join('\n'),
    dict: '/Type /XObject /Subtype /Form /FormType 1 /BBox [-100 -100 101 101] ' +
      `/Matrix [${matrix.map(nm).join(' ')}] ` +
      '/Group << /Type /Group /S /Transparency /CS /DeviceRGB /I true >> ' +
      `/Resources ${ctx.resourcesId} 0 R`,
  })
  out.push(`/${gs} gs`)
  out.push(`/${ctx.res.xobject(formId)} Do`)
  return true
}

// ——— raster assets ———

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Base64 without `atob`, so the module carries its own decoder everywhere. */
function fromBase64 (text) {
  const clean = String(text).replace(/[^A-Za-z0-9+/]/g, '')
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let acc = 0
  let bits = 0
  let at = 0
  for (let i = 0; i < clean.length; i++) {
    acc = (acc << 6) | B64.indexOf(clean[i])
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[at++] = (acc >> bits) & 0xff
    }
  }
  return bytes.subarray(0, at)
}

/**
 * Width, height and component count from a JPEG's own SOF marker.
 *
 * Trusting `asset.w`/`asset.h` and assuming DeviceRGB would put a grayscale or
 * CMYK JPEG into a stream that says it has three components, which is a corrupt
 * file rather than a wrong-looking one.
 */
function jpegInfo (bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue }
    const marker = bytes[i + 1]
    if (marker === 0xff) { i++; continue }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue }
    const len = (bytes[i + 2] << 8) | bytes[i + 3]
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSOF) {
      return { h: (bytes[i + 5] << 8) | bytes[i + 6], w: (bytes[i + 7] << 8) | bytes[i + 8], comps: bytes[i + 9] }
    }
    if (marker === 0xda) break
    if (len < 2) break
    i += 2 + len
  }
  return null
}

const JPEG_SPACES = { 1: 'DeviceGray', 3: 'DeviceRGB', 4: 'DeviceCMYK' }

/**
 * An image XObject for an SVD asset.
 *
 * A JPEG goes in verbatim: `/DCTDecode` is the same codec, so the bytes are
 * copied and nothing is re-encoded. Anything else needs a decoder, and the only
 * one in reach is a canvas — so in a DOM the asset is drawn and handed to
 * `encodeImage` from the shared writer, and in Node it degrades.
 *
 * @returns {Promise<{name: string, w: number, h: number}|null>}
 */
async function imageXObject (ctx, nodeId, key, asset) {
  if (ctx.images.has(key)) return ctx.images.get(key)
  const href = (typeof asset.data === 'string' && asset.data) || (typeof asset.src === 'string' && asset.src) || null
  let result = null

  const data = /^data:([^;,]*)(;base64)?,/i.exec(href || '')
  if (data && /jpe?g/i.test(data[1]) && data[2]) {
    const bytes = fromBase64(href.slice(data[0].length))
    const info = jpegInfo(bytes)
    if (info && info.w > 0 && info.h > 0) {
      const space = JPEG_SPACES[info.comps]
      if (!space) {
        ctx.note(nodeId, `asset "${key}" is a JPEG with ${info.comps} components, which has no PDF colour ` +
          'space; the layer is dropped.', 'emit.pdf.image-jpeg-components', 'O')
      } else {
        const id = ctx.pdf.addStream(
          `/Type /XObject /Subtype /Image /Width ${info.w} /Height ${info.h} /BitsPerComponent 8 ` +
          `/ColorSpace /${space} /Filter /DCTDecode`, bytes)
        result = { name: ctx.res.xobject(id, 'Im'), w: info.w, h: info.h }
      }
    } else {
      ctx.note(nodeId, `asset "${key}" claims to be a JPEG but carries no readable SOF marker; the layer is dropped.`,
        'emit.pdf.image-jpeg-unreadable', 'O')
    }
  } else if (href && typeof document !== 'undefined' && typeof createImageBitmap === 'function') {
    // Everything that is not already a JPEG has to be decoded to be re-encoded,
    // and a canvas is the only decoder here. This is the one path in the file
    // that touches a DOM, and it exists so a browser export is not worse than a
    // Node one.
    try {
      const blob = await (await fetch(href)).blob()
      const bitmap = await createImageBitmap(blob)
      const canvas = typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(bitmap.width, bitmap.height)
        : Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height })
      canvas.getContext('2d').drawImage(bitmap, 0, 0)
      const encoded = await encodeImage(canvas, { quality: ctx.quality })
      const smaskRef = encoded.smask
        ? ` /SMask ${ctx.pdf.addStream(encoded.smask.dict, encoded.smask.bytes)} 0 R`
        : ''
      const id = ctx.pdf.addStream(encoded.dict + smaskRef, encoded.bytes)
      result = { name: ctx.res.xobject(id, 'Im'), w: bitmap.width, h: bitmap.height }
      ctx.note(nodeId, `asset "${key}" is not a JPEG, so it was decoded through a canvas and re-encoded as one ` +
        `at quality ${ctx.quality}; the pixels are resampled, not copied.`, 'emit.pdf.image-recoded', 'R')
    } catch (err) {
      ctx.note(nodeId, `asset "${key}" could not be decoded (${err && err.message}); the layer is dropped.`,
        'emit.pdf.image-decode-failed', 'O')
    }
  } else if (href) {
    ctx.note(nodeId, `asset "${key}" is not a base64 JPEG and there is no canvas in this runtime to decode it; ` +
      'the layer is dropped. PDF carries JPEG and raw samples only — a PNG has to be decoded by somebody.',
      'emit.pdf.image-needs-decoder', 'O')
  } else {
    ctx.note(nodeId, `image fill references asset "${key}", which carries no data or src; the layer is dropped.`,
      'emit.pdf.image-no-data', 'O')
  }

  ctx.images.set(key, result)
  return result
}

// ——— fills ———

/** Where one background layer paints, in node-local px. */
function layerRect (fill, box) {
  if (isObject(fill.rect)) {
    const r = rectOf(fill.rect)
    if (r.w > 0 && r.h > 0) return r
  }
  if (isObject(fill.placement) && isObject(fill.placement.area)) {
    const r = rectOf(fill.placement.area)
    if (r.w > 0 && r.h > 0) return r
  }
  return box
}

/**
 * Tile origins for a repeating layer, in node-local px. PDF has tiling patterns,
 * but a pattern cannot carry the soft mask a translucent gradient needs and would
 * fork every layer type in two; repeating the draw is the same picture.
 *
 * @returns {{offsets: number[][], capped: boolean}}
 */
function layerTiles (fill, rect, area) {
  const repeat = isObject(fill.placement) && isObject(fill.placement.repeat) ? fill.placement.repeat : null
  if (!repeat || !(rect.w > 0) || !(rect.h > 0)) return { offsets: [[0, 0]], capped: false }
  const repX = repeat.x === 'repeat' && rect.w < area.w - 1e-6
  const repY = repeat.y === 'repeat' && rect.h < area.h - 1e-6
  if (!repX && !repY) return { offsets: [[0, 0]], capped: false }
  const before = (grow, start, edge, size) => (grow ? Math.ceil((start - edge) / size) : 0)
  const x0 = -before(repX, rect.x, area.x, rect.w)
  const y0 = -before(repY, rect.y, area.y, rect.h)
  const nx = repX ? Math.ceil((area.x + area.w - (rect.x + x0 * rect.w)) / rect.w) : 1
  const ny = repY ? Math.ceil((area.y + area.h - (rect.y + y0 * rect.h)) / rect.h) : 1
  const offsets = []
  let capped = false
  for (let iy = 0; iy < Math.max(1, ny); iy++) {
    for (let ix = 0; ix < Math.max(1, nx); ix++) {
      if (offsets.length >= 4096) { capped = true; break }
      offsets.push([(x0 + ix) * rect.w, (y0 + iy) * rect.h])
    }
    if (capped) break
  }
  return { offsets: offsets.length ? offsets : [[0, 0]], capped }
}

/** One fill layer. Emitted in `fills` order, which is back to front. */
async function emitLayer (out, ctx, nodeId, fill, box, radii) {
  const opacity = isNum(fill.opacity) ? clamp01(fill.opacity) : 1
  if (opacity <= 0) {
    ctx.note(nodeId, 'a fill layer has opacity 0; it is not emitted.', 'emit.pdf.layer-invisible', 'E')
    return
  }
  const blend = blendName(ctx, nodeId, fill.blend)
  const rect = layerRect(fill, box)

  if (fill.clipBox && fill.clipBox !== 'border' && fill.type !== 'image') {
    ctx.note(nodeId, `a fill declares clipBox:"${fill.clipBox}", but the node carries no padding/content inset; ` +
      'the layer is clipped to the border box.', 'emit.pdf.clipbox-inset-unknown', 'A')
  }

  if (fill.type === 'solid') {
    const alpha = alphaOf(fill.color) * opacity
    if (alpha <= 0) return
    out.push('q')
    const gs = gsFor(ctx, alpha, alpha, blend)
    if (gs) out.push(`/${gs} gs`)
    out.push(fillColorOp(fill.color))
    out.push(shapePath(box, radii))
    out.push('f')
    out.push('Q')
    return
  }

  if (fill.type === 'image') {
    const key = typeof fill.asset === 'string' ? fill.asset : null
    const asset = key && isObject(ctx.doc.assets) ? ctx.doc.assets[key] : null
    if (!isObject(asset)) {
      ctx.note(nodeId, `image fill references asset "${String(fill.asset)}", which is not in the document; ` +
        'the layer is dropped.', 'emit.pdf.image-missing', 'O')
      return
    }
    const image = await imageXObject(ctx, nodeId, key, asset)
    if (!image) return
    const placement = readMatrix(fill.transform)
    out.push('q')
    out.push(shapePath(box, radii))
    out.push('W n')
    const gs = gsFor(ctx, opacity, opacity, blend)
    if (gs) out.push(`/${gs} gs`)
    if (placement && isObject(fill.crop)) {
      const crop = rectOf(fill.crop)
      if (crop.w > 0 && crop.h > 0) {
        // `collectImage` resolved object-fit/object-position as: `crop` is the
        // source region in the asset's own pixels, `transform` maps the unit
        // square onto where that region paints. So the unit square is the crop:
        // scale the whole image up by natural/crop and slide the crop origin to 0.
        out.push(matrixOp(placement))
        out.push(rectPath(0, 0, 1, 1))
        out.push('W n')
        out.push(matrixOp([image.w / crop.w, 0, 0, -image.h / crop.h,
          -crop.x / crop.w, 1 + crop.y / crop.h]))
        out.push(`/${image.name} Do`)
        out.push('Q')
        return
      }
    }
    if (placement || isObject(fill.crop)) {
      ctx.note(nodeId, 'image fill carries half an object-fit placement (crop without matrix or the other way ' +
        'round); it is stretched over its box and the fit is lost.', 'emit.pdf.image-fit-partial', 'A')
    }
    if (typeof fill.fit === 'string' && fill.fit !== 'stretch' && fill.fit !== 'fill') {
      ctx.note(nodeId, `image fill asks for fit "${fill.fit}" but carries no crop matrix; it is stretched to ` +
        'its box.', 'emit.pdf.image-fit-unknown', 'A')
    }
    const { offsets, capped } = layerTiles(fill, rect, box)
    if (capped) {
      ctx.note(nodeId, 'a repeating image background needs more than 4096 tiles to cover its area; the rest are ' +
        'not painted.', 'emit.pdf.tile-cap', 'O')
    }
    for (const [dx, dy] of offsets) {
      out.push('q')
      // The flip: an image XObject's unit square has y UP from its own origin,
      // and this whole page is drawn y-down.
      out.push(matrixOp([rect.w, 0, 0, -rect.h, rect.x + dx, rect.y + dy + rect.h]))
      out.push(`/${image.name} Do`)
      out.push('Q')
    }
    out.push('Q')
    return
  }

  if (fill.type === 'linear' || fill.type === 'radial' || fill.type === 'angular') {
    const raw = readMatrix(fill.transform)
    if (!raw) {
      ctx.note(nodeId, `a ${fill.type} gradient has no usable unit->box matrix; the identity is used instead.`,
        'emit.pdf.gradient-no-matrix', 'A')
    }
    const base = raw || [1, 0, 0, 1, 0, 0]
    const { offsets, capped } = layerTiles(fill, rect, box)
    if (capped) {
      ctx.note(nodeId, 'a repeating gradient background needs more than 4096 tiles to cover its area; the rest ' +
        'are not painted.', 'emit.pdf.tile-cap', 'O')
    }
    for (const [dx, dy] of offsets) {
      const matrix = [base[0], base[1], base[2], base[3], base[4] + rect.x + dx, base[5] + rect.y + dy]
      out.push('q')
      out.push(shapePath(box, radii))
      out.push('W n')
      // A gradient never paints outside its own layer rect, and `sh` with
      // /Extend would happily flood the whole clip.
      if (offsets.length > 1 || rect.w < box.w - 1e-6 || rect.h < box.h - 1e-6 ||
        rect.x > box.x + 1e-6 || rect.y > box.y + 1e-6) {
        out.push(rectPath(rect.x + dx, rect.y + dy, rect.w, rect.h))
        out.push('W n')
      }
      if (opacity < 1) {
        const gs = gsFor(ctx, opacity, opacity)
        if (gs) out.push(`/${gs} gs`)
      }
      if (fill.type === 'angular') paintConic(out, ctx, nodeId, fill, matrix, blend)
      else paintGradient(out, ctx, nodeId, fill, matrix, blend, { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h })
      out.push('Q')
    }
    return
  }

  ctx.note(nodeId, `fill type "${String(fill.type)}" is not known to the PDF emitter; the layer is dropped.`,
    'emit.pdf.fill-type-unknown', 'O')
}

// ——— strokes ———

/** `stroke.dash` -> the `d` operator, or nothing. */
function dashOp (stroke) {
  if (!Array.isArray(stroke.dash) || !stroke.dash.length) return null
  if (!stroke.dash.every((n) => Number.isFinite(Number(n)) && Number(n) >= 0)) return null
  if (stroke.dash.every((n) => Number(n) === 0)) return null
  return `[${stroke.dash.map((n) => num(n)).join(' ')}] ${num(finite(stroke.dashOffset))} d`
}

const CAP_CODES = { butt: 0, round: 1, square: 2 }
const JOIN_CODES = { miter: 0, round: 1, bevel: 2 }

/**
 * Per-side weights (or per-side colours) as four mitered quads — the same
 * trapezoids the browser paints, and the only shape a single `w` cannot express.
 */
function emitPerSideStroke (out, ctx, nodeId, stroke, weights, box, radii) {
  const [t, r, b, l] = weights
  const rounded = hasRadius(radii)
  if (rounded) {
    ctx.note(nodeId, 'per-side border weights on a rounded box: the sides are emitted as square-mitered quads ' +
      'clipped to the border radius, so the corner arcs thin out where the miter is cut away.',
      'emit.pdf.stroke-per-side-miter', 'A')
  }
  if (Array.isArray(stroke.dash) && stroke.dash.length) {
    ctx.note(nodeId, 'a dashed border with per-side weights is emitted as four solid quads; the dash pattern is lost.',
      'emit.pdf.stroke-dash-lost', 'O')
  }
  if (isObject(stroke.paint) && stroke.paint.type !== 'solid') {
    ctx.note(nodeId, `a ${stroke.paint.type} border with per-side weights is emitted as four flat quads.`,
      'emit.pdf.stroke-per-side-flat', 'A')
  }
  const { w, h } = box
  const x0 = box.x
  const y0 = box.y
  const quad = (pts) => pts.map(([px, py], i) => `${num(px)} ${num(py)} ${i ? 'l' : 'm'}`).join(' ') + ' h'
  const sides = [
    [t, quad([[x0, y0], [x0 + w, y0], [x0 + w - r, y0 + t], [x0 + l, y0 + t]])],
    [r, quad([[x0 + w, y0], [x0 + w, y0 + h], [x0 + w - r, y0 + h - b], [x0 + w - r, y0 + t]])],
    [b, quad([[x0 + w, y0 + h], [x0, y0 + h], [x0 + l, y0 + h - b], [x0 + w - r, y0 + h - b]])],
    [l, quad([[x0, y0 + h], [x0, y0], [x0 + l, y0 + t], [x0 + l, y0 + h - b]])],
  ]
  const perSide = Array.isArray(stroke.sides) ? stroke.sides : null
  const fallback = isObject(stroke.paint) && stroke.paint.type === 'solid' ? stroke.paint.color : [0, 0, 0, 1]

  out.push('q')
  // A border never paints outside the border box: without this clip a mitered
  // corner spills past a rounded silhouette.
  if (rounded) {
    out.push(shapePath(box, radii))
    out.push('W n')
  }
  sides.forEach(([weight, path], i) => {
    if (!(weight > 0)) return
    const own = perSide && isObject(perSide[i]) && Array.isArray(perSide[i].color) ? perSide[i].color : null
    const color = own || fallback
    const alpha = alphaOf(color)
    if (alpha <= 0) return
    out.push('q')
    const gs = gsFor(ctx, alpha, alpha)
    if (gs) out.push(`/${gs} gs`)
    out.push(fillColorOp(color))
    out.push(path)
    out.push('f')
    out.push('Q')
  })
  out.push('Q')
}

function emitStrokes (out, ctx, nodeId, strokes, box, radii) {
  for (const stroke of strokes) {
    if (!isObject(stroke)) continue
    const raw = stroke.weight !== undefined ? stroke.weight : stroke.weights
    const weights = Array.isArray(raw)
      ? [0, 1, 2, 3].map((i) => Math.max(0, finite(raw[i])))
      : [0, 1, 2, 3].map(() => Math.max(0, finite(raw)))
    if (!weights.some((v) => v > 0)) continue

    if (stroke.sibling && stroke.order === 'last') {
      ctx.note(nodeId, 'an outline declares sibling:true / order:"last" — it should paint after this node\'s ' +
        'siblings, not with it. It is painted with the node, so an overlapping later sibling covers it.',
        'emit.pdf.stroke-sibling-order', 'A')
    }

    const base = normalizeRadii(Array.isArray(stroke.radii) ? stroke.radii : radii, box.w, box.h)
    const uniform = weights.every((v) => v === weights[0])
    const visible = Array.isArray(stroke.sides)
      ? stroke.sides.filter((s, i) => isObject(s) && weights[i] > 0 && Array.isArray(s.color))
      : []
    const sameColor = visible.every((s) => s.color.join() === visible[0].color.join())
    if (!uniform || !sameColor) {
      emitPerSideStroke(out, ctx, nodeId, stroke, weights, box, base)
      continue
    }

    const weight = weights[0]
    const align = typeof stroke.align === 'string' ? stroke.align : 'inside'
    const offset = finite(stroke.offset)
    // PDF strokes are centred on the path and there is no alignment operator, so
    // alignment is the path moving: half the weight inwards for `inside`,
    // outwards for `outside`.
    const inset = align === 'inside' ? weight / 2 : align === 'outside' ? -(offset + weight / 2) : 0
    const shape = { x: box.x + inset, y: box.y + inset, w: box.w - 2 * inset, h: box.h - 2 * inset }
    const paint = isObject(stroke.paint) ? stroke.paint : null

    if (shape.w <= 0 || shape.h <= 0) {
      ctx.note(nodeId, `a ${num(weight)}px ${align} stroke is wider than its box; it is emitted as a filled ` +
        'shape instead.', 'emit.pdf.stroke-overflows-box', 'A')
      const color = paint && paint.type === 'solid' ? paint.color : [0, 0, 0, 1]
      const alpha = alphaOf(color)
      out.push('q')
      const gs = gsFor(ctx, alpha, alpha)
      if (gs) out.push(`/${gs} gs`)
      out.push(fillColorOp(color))
      out.push(shapePath(box, base))
      out.push('f')
      out.push('Q')
      continue
    }

    // When the stroke brought its own radii those are already offset (an
    // outline's radii are expanded by outline-offset upstream), so only the
    // trace itself is left to grow by.
    const radialInset = Array.isArray(stroke.radii)
      ? (align === 'inside' ? weight / 2 : align === 'outside' ? -(weight / 2) : 0)
      : inset
    const shapeRadii = normalizeRadii(offsetRadii(base, radialInset), shape.w, shape.h)

    if (!paint) continue
    if (paint.type === 'linear' || paint.type === 'radial' || paint.type === 'angular') {
      // A stroke is a region like any other: clip to it and flood it with the
      // shading. `W n` after `S`-less path construction needs the stroke turned
      // into a fillable region, which PDF cannot do — so the honest version is a
      // flat sample, declared.
      ctx.note(nodeId, `a ${paint.type} gradient stroke has no PDF form (there is no "clip to the stroke of this ` +
        'path" operator); the stroke is painted as the flat colour of the gradient\'s mid stop.',
        'emit.pdf.stroke-gradient-flat', 'O')
      const stops = readStops(paint, ctx, nodeId)
      const color = stops ? sampleStops(stops, 0.5) : [0, 0, 0, 1]
      strokeOnce(out, ctx, stroke, shape, shapeRadii, weight, color)
      continue
    }
    if (paint.type !== 'solid') {
      ctx.note(nodeId, `a ${String(paint.type)} stroke paint has no PDF equivalent; the stroke is dropped.`,
        'emit.pdf.stroke-paint-unsupported', 'O')
      continue
    }
    strokeOnce(out, ctx, stroke, shape, shapeRadii, weight, paint.color)
  }
}

function strokeOnce (out, ctx, stroke, shape, radii, weight, color) {
  const alpha = alphaOf(color)
  if (alpha <= 0) return
  out.push('q')
  const gs = gsFor(ctx, alpha, alpha)
  if (gs) out.push(`/${gs} gs`)
  out.push(strokeColorOp(color))
  out.push(`${num(weight)} w`)
  const cap = CAP_CODES[stroke.cap]
  if (cap) out.push(`${cap} J`)
  const join = JOIN_CODES[stroke.join]
  if (join) out.push(`${join} j`)
  if (Number.isFinite(Number(stroke.miter))) out.push(`${num(stroke.miter)} M`)
  const dash = dashOp(stroke)
  if (dash) out.push(dash)
  out.push(shapePath(shape, radii))
  out.push('S')
  out.push('Q')
}

// ——— effects ———

/** Invariant 5, in one place: the CSS blur radius is twice the Gaussian sigma. */
const sigma = (blur) => Math.max(0, finite(blur) / 2)

/** Abramowitz & Stegun 7.1.26 — 1.5e-7 absolute, which is far past visible. */
function erf (x) {
  const sign = x < 0 ? -1 : 1
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
    t * Math.exp(-x * x)
  return sign * y
}

const gaussCdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2))

/**
 * A blurred shadow edge as concentric copies of the path.
 *
 * PDF has no blur. Of the two honest answers — rasterize the effect, or compose
 * it from geometry — this file takes the second, so the page stays resolution
 * independent and a reader can still select the text under it. A Gaussian-blurred
 * straight edge has opacity `Φ(d/σ)` at signed depth `d`, so copy `i` is grown to
 * where that profile reads `T_i`, and its own alpha is whatever brings the
 * accumulated coverage there from `T_{i-1}` to `T_i`. Curvature is the error: on
 * a corner tighter than σ the true blur is a little softer than this stack.
 *
 * @returns {{grow: number, alpha: number}[]} outermost first
 */
function shadowRamp (blur, spread, alpha, layers) {
  const s = sigma(blur)
  if (!(s > 0) || layers < 2) return [{ grow: spread, alpha }]
  const out = []
  let acc = 0
  for (let i = 0; i < layers; i++) {
    const grow = spread + SHADOW_REACH * s * (1 - (2 * i) / (layers - 1))
    const target = alpha * (1 - gaussCdf((grow - spread) / s))
    const step = acc >= 1 ? 0 : (target - acc) / (1 - acc)
    acc = acc + step * (1 - acc)
    if (step > 1e-4) out.push({ grow, alpha: Math.min(1, step) })
  }
  return out
}

/** How far a shadow reaches outside its box, in px. */
function shadowBleed (effects) {
  let bleed = 0
  for (const e of effects) {
    const offset = Array.isArray(e.offset) ? e.offset : [0, 0]
    const reach = SHADOW_REACH * sigma(e.blur) + Math.abs(finite(e.spread))
    bleed = Math.max(bleed, Math.abs(finite(offset[0])) + reach, Math.abs(finite(offset[1])) + reach)
  }
  return Math.ceil(bleed) + 2
}

/**
 * Outer box-shadows. CSS paints them behind the box and clips them OUT of the
 * border box, which here is an even-odd clip of a big rectangle against the box
 * path — the only reason a translucent card does not show its own shadow through
 * its own background.
 */
function emitDropShadows (out, ctx, nodeId, effects, box, radii) {
  for (const e of effects) {
    const alpha = alphaOf(e.color)
    if (alpha <= 0) continue
    const offset = Array.isArray(e.offset) ? e.offset : [0, 0]
    const dx = finite(offset[0])
    const dy = finite(offset[1])
    const spread = finite(e.spread)
    const ramp = shadowRamp(e.blur, spread, alpha, ctx.shadowLayers)
    if (finite(e.blur) > 0) {
      ctx.note(nodeId, `a ${num(e.blur)}px drop shadow is composed as ${ramp.length} concentric copies of the ` +
        'box with a Gaussian opacity ramp — PDF has no blur, and this file does not rasterize to fake one. ' +
        'Corners tighter than the blur radius come out slightly harder than the browser paints them.',
        'emit.pdf.shadow-layered', 'A')
    }
    const bleed = shadowBleed([e])
    out.push('q')
    if (!e.behind) {
      out.push(rectPath(box.x - bleed - 1, box.y - bleed - 1, box.w + 2 * bleed + 2, box.h + 2 * bleed + 2))
      out.push(shapePath(box, radii))
      out.push('W* n')
    }
    out.push(fillColorOp(e.color))
    for (const layer of ramp) {
      const grown = grownBox({ x: box.x + dx, y: box.y + dy, w: box.w, h: box.h }, radii, layer.grow)
      if (grown.box.w <= 0 || grown.box.h <= 0) continue
      const gs = gsFor(ctx, layer.alpha, layer.alpha)
      out.push(gs ? `/${gs} gs` : `/${ctx.res.gs('/Type /ExtGState /ca 1 /CA 1')} gs`)
      out.push(shapePath(grown.box, normalizeRadii(grown.radii, grown.box.w, grown.box.h)))
      out.push('f')
    }
    out.push('Q')
  }
}

/**
 * Inner shadows. The shape is the complement of the offset, shrunk box, clipped
 * to the box — which is exactly the crescent CSS paints, and the same concentric
 * ramp softens its edge.
 */
function emitInnerShadows (out, ctx, nodeId, effects, box, radii) {
  for (const e of effects) {
    const alpha = alphaOf(e.color)
    if (alpha <= 0) continue
    const offset = Array.isArray(e.offset) ? e.offset : [0, 0]
    const dx = finite(offset[0])
    const dy = finite(offset[1])
    const spread = finite(e.spread)
    const ramp = shadowRamp(e.blur, spread, alpha, ctx.shadowLayers)
    if (finite(e.blur) > 0) {
      ctx.note(nodeId, `a ${num(e.blur)}px inner shadow is composed as ${ramp.length} concentric copies of the ` +
        'box with a Gaussian opacity ramp; PDF has no blur.', 'emit.pdf.shadow-layered', 'A')
    }
    ctx.note(nodeId, 'an inner shadow is clipped to the border box; CSS clips it to the padding box, and the ' +
      'node carries no padding inset.', 'emit.pdf.inner-shadow-box', 'A')
    const bleed = shadowBleed([e]) + Math.max(box.w, box.h)
    out.push('q')
    out.push(shapePath(box, radii))
    out.push('W n')
    out.push(fillColorOp(e.color))
    for (const layer of ramp) {
      const hole = grownBox({ x: box.x + dx, y: box.y + dy, w: box.w, h: box.h }, radii, -layer.grow)
      const gs = gsFor(ctx, layer.alpha, layer.alpha)
      out.push(gs ? `/${gs} gs` : `/${ctx.res.gs('/Type /ExtGState /ca 1 /CA 1')} gs`)
      out.push(rectPath(box.x - bleed, box.y - bleed, box.w + 2 * bleed, box.h + 2 * bleed))
      if (hole.box.w > 0 && hole.box.h > 0) {
        out.push(shapePath(hole.box, normalizeRadii(hole.radii, hole.box.w, hole.box.h)))
      }
      out.push('f*')
    }
    out.push('Q')
  }
}

// ——— fonts ———

/**
 * Advance widths, 1/1000 em, for the base-14 faces this file can reach. They are
 * the AFM widths of the standard fonts, and they exist for exactly one number:
 * the natural width of a line, which divided into the browser's measured width
 * gives `Tz`. Without them a substituted face would set the line to its own
 * width and every measured line box in the document would be a lie.
 *
 * Codes 32..126, then the WinAnsi punctuation real copy is full of.
 */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]

const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
]

const TIMES = [
  250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278,
  500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444,
  921, 722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722,
  556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500,
  333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500,
  500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541,
]

const TIMES_BOLD = [
  250, 333, 555, 500, 500, 1000, 833, 278, 333, 333, 500, 570, 250, 333, 250, 278,
  500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 333, 333, 570, 570, 570, 500,
  930, 722, 667, 722, 722, 667, 611, 778, 778, 389, 500, 778, 667, 944, 722, 778,
  611, 778, 722, 556, 667, 722, 722, 1000, 722, 722, 667, 333, 278, 333, 581, 500,
  333, 500, 556, 444, 556, 444, 333, 500, 556, 278, 333, 556, 278, 833, 556, 500,
  556, 556, 444, 389, 333, 556, 500, 722, 500, 500, 444, 394, 220, 394, 520,
]

/** The punctuation above U+00FF that WinAnsi can still address. */
const EXTRA_WIDTHS = {
  sans: { 8211: 556, 8212: 1000, 8216: 222, 8217: 222, 8220: 333, 8221: 333, 8226: 350, 8230: 1000, 8364: 556, 8482: 1000 },
  serif: { 8211: 500, 8212: 1000, 8216: 333, 8217: 333, 8220: 444, 8221: 444, 8226: 350, 8230: 1000, 8364: 500, 8482: 980 },
  mono: {},
}

const WIDTH_TABLES = {
  sans: HELVETICA, 'sans-bold': HELVETICA_BOLD, 'sans-italic': HELVETICA, 'sans-bolditalic': HELVETICA_BOLD,
  serif: TIMES, 'serif-bold': TIMES_BOLD, 'serif-italic': TIMES, 'serif-bolditalic': TIMES_BOLD,
}

/**
 * The two base-14 faces that are not Latin, as `codepoint:code:width` triples —
 * hex codepoint, byte in the font's BUILT-IN encoding, advance in em/1000. The
 * values are Adobe's own (the AFM tables pdf.js ships, `SymbolSetEncoding` and
 * `ZapfDingbatsEncoding` resolved through the Adobe glyph list), not a guess.
 *
 * This is what stands between `★★★★☆ 4,2` and a rating that renders as ` 4,2`.
 * Every viewer has these two fonts, so a star, an arrow, a check mark or a Greek
 * letter can be PAINTED instead of going out as invisible text. The glyph is
 * Adobe's drawing rather than the page's font — a substitution like the Helvetica
 * one, declared per family, and `/ToUnicode` keeps the character itself intact
 * for search and copy-paste.
 *
 * Codepoints below U+0100 are absent on purpose: WinAnsi already addresses them,
 * and Symbol's `!` is not the page's `!`.
 */
const SYMBOL_GLYPHS =
  '391:65:722 392:66:667 393:71:603 394:68:612 395:69:611 396:90:611 397:72:722 398:81:741 ' +
  '399:73:333 39a:75:722 39b:76:686 39c:77:889 39d:78:722 39e:88:645 39f:79:722 3a0:80:768 ' +
  '3a1:82:556 3a3:83:592 3a4:84:611 3a5:85:690 3a6:70:763 3a7:67:722 3a8:89:795 3a9:87:768 ' +
  '3b1:97:631 3b2:98:549 3b3:103:411 3b4:100:494 3b5:101:439 3b6:122:494 3b7:104:603 3b8:113:521 ' +
  '3b9:105:329 3ba:107:549 3bb:108:549 3bc:109:576 3bd:110:521 3be:120:493 3bf:111:549 3c0:112:549 ' +
  '3c1:114:549 3c2:86:439 3c3:115:603 3c4:116:439 3c5:117:576 3c6:102:521 3c7:99:549 3c8:121:686 ' +
  '3c9:119:686 3d1:74:631 3d2:161:620 3d5:106:603 3d6:118:713 2022:183:460 2026:188:1000 ' +
  '2032:162:247 2033:178:411 2044:164:167 20ac:160:750 2111:193:686 2118:195:987 211c:194:795 ' +
  '2126:87:768 2135:192:823 2190:172:987 2191:173:603 2192:174:987 2193:175:603 2194:171:1042 ' +
  '21b5:191:658 21d0:220:987 21d1:221:603 21d2:222:987 21d3:223:603 21d4:219:1042 2200:34:713 ' +
  '2202:182:494 2203:36:549 2205:198:823 2206:68:612 2207:209:713 2208:206:713 2209:207:713 ' +
  '220b:39:439 220f:213:823 2211:229:713 2212:45:549 2217:42:500 221a:214:549 221d:181:713 ' +
  '221e:165:713 2220:208:768 2227:217:603 2228:218:603 2229:199:768 222a:200:768 222b:242:274 ' +
  '2234:92:863 223c:126:549 2245:64:549 2248:187:549 2260:185:549 2261:186:549 2264:163:549 ' +
  '2265:179:549 2282:204:713 2283:201:713 2284:203:713 2286:205:713 2287:202:713 2295:197:768 ' +
  '2297:196:768 22a5:94:658 22c5:215:250 2320:243:686 2321:245:686 2329:225:329 232a:241:329 ' +
  '25ca:224:494 2660:170:753 2663:167:753 2665:169:753 2666:168:753'

const DINGBAT_GLYPHS =
  '2192:213:838 2194:214:1016 2195:215:458 2460:172:788 2461:173:788 2462:174:788 2463:175:788 ' +
  '2464:176:788 2465:177:788 2466:178:788 2467:179:788 2468:180:788 2469:181:788 25a0:110:761 ' +
  '25b2:115:892 25bc:116:892 25c6:117:788 25cf:108:791 25d7:119:438 2605:72:816 260e:37:719 ' +
  '261b:42:960 261e:43:939 2660:171:626 2663:168:776 2665:170:694 2666:169:595 2701:33:974 ' +
  '2702:34:961 2703:35:974 2704:36:980 2706:38:789 2707:39:790 2708:40:791 2709:41:690 270c:44:549 ' +
  '270d:45:855 270e:46:911 270f:47:933 2710:48:911 2711:49:945 2712:50:974 2713:51:755 2714:52:846 ' +
  '2715:53:762 2716:54:761 2717:55:571 2718:56:677 2719:57:763 271a:58:760 271b:59:759 271c:60:754 ' +
  '271d:61:494 271e:62:552 271f:63:537 2720:64:577 2721:65:692 2722:66:786 2723:67:788 2724:68:788 ' +
  '2725:69:790 2726:70:793 2727:71:794 2729:73:823 272a:74:789 272b:75:841 272c:76:823 272d:77:833 ' +
  '272e:78:816 272f:79:831 2730:80:923 2731:81:744 2732:82:723 2733:83:749 2734:84:790 2735:85:792 ' +
  '2736:86:695 2737:87:776 2738:88:768 2739:89:792 273a:90:759 273b:91:707 273c:92:708 273d:93:682 ' +
  '273e:94:701 273f:95:826 2740:96:815 2741:97:789 2742:98:789 2743:99:707 2744:100:687 ' +
  '2745:101:696 2746:102:689 2747:103:786 2748:104:787 2749:105:713 274a:106:791 274b:107:785 ' +
  '274d:109:873 274f:111:762 2750:112:762 2751:113:759 2752:114:759 2756:118:784 2758:120:138 ' +
  '2759:121:277 275a:122:415 275b:123:392 275c:124:392 275d:125:668 275e:126:668 2761:161:732 ' +
  '2762:162:544 2763:163:544 2764:164:910 2765:165:667 2766:166:760 2767:167:760 2768:128:390 ' +
  '2769:129:390 276a:130:317 276b:131:317 276c:132:276 276d:133:276 276e:134:509 276f:135:509 ' +
  '2770:136:410 2771:137:410 2772:138:234 2773:139:234 2774:140:334 2775:141:334 2776:182:788 ' +
  '2777:183:788 2778:184:788 2779:185:788 277a:186:788 277b:187:788 277c:188:788 277d:189:788 ' +
  '277e:190:788 277f:191:788 2780:192:788 2781:193:788 2782:194:788 2783:195:788 2784:196:788 ' +
  '2785:197:788 2786:198:788 2787:199:788 2788:200:788 2789:201:788 278a:202:788 278b:203:788 ' +
  '278c:204:788 278d:205:788 278e:206:788 278f:207:788 2790:208:788 2791:209:788 2792:210:788 ' +
  '2793:211:788 2794:212:894 2798:216:748 2799:217:924 279a:218:748 279b:219:918 279c:220:927 ' +
  '279d:221:928 279e:222:928 279f:223:834 27a0:224:873 27a1:225:828 27a2:226:924 27a3:227:924 ' +
  '27a4:228:917 27a5:229:930 27a6:230:931 27a7:231:463 27a8:232:883 27a9:233:836 27aa:234:836 ' +
  '27ab:235:867 27ac:236:867 27ad:237:696 27ae:238:696 27af:239:874 27b1:241:874 27b2:242:760 ' +
  '27b3:243:946 27b4:244:771 27b5:245:865 27b6:246:771 27b7:247:888 27b8:248:967 27b9:249:888 ' +
  '27ba:250:831 27bb:251:873 27bc:252:927 27bd:253:970 27be:254:918'

function readGlyphTable (packed, base) {
  const map = new Map()
  for (const entry of packed.split(' ')) {
    const [cp, code, width] = entry.split(':')
    map.set(parseInt(cp, 16), { base, code: Number(code), width: Number(width) })
  }
  return map
}

const SYMBOL_MAP = readGlyphTable(SYMBOL_GLYPHS, 'Symbol')
const DINGBAT_MAP = readGlyphTable(DINGBAT_GLYPHS, 'ZapfDingbats')

/**
 * The base-14 glyph for a character WinAnsi cannot address, or null.
 *
 * Symbol wins a tie: its arrows and card suits are drawn as text, the Dingbats
 * ones as ornaments, and a page that writes `→` in a sentence means the former.
 *
 * @param {string} ch  one character (not a codepoint — surrogate pairs included)
 * @returns {{base: string, code: number, width: number}|null}
 */
function symbolGlyph (ch) {
  const cp = ch.codePointAt(0)
  return SYMBOL_MAP.get(cp) || DINGBAT_MAP.get(cp) || null
}

const GENERIC_OF = (key) => key.split('-')[0]

/** Combining marks, so `Í` can borrow `I`'s advance — which is what AFM gives it. */
const COMBINING = new RegExp('[\\u0300-\\u036f]', 'g')

/**
 * The advance of one string in a base-14 face, in em/1000.
 *
 * The per-character order mirrors `chunkByEncodability` exactly, because these
 * two decide the same thing twice — where the glyph comes from — and a line whose
 * width is measured against one font and painted in another drifts.
 *
 * Anything no table can address falls back to the base letter of its
 * decomposition (an accented Latin letter has its base letter's advance in every
 * one of these fonts) and then to the face's average.
 */
function naturalWidth (key, text) {
  const table = WIDTH_TABLES[key]
  const generic = GENERIC_OF(key)
  let total = 0
  // Courier is 600 per glyph — but a star drawn from ZapfDingbats inside a
  // monospaced run still advances by the star's own width.
  if (generic === 'mono') {
    for (const ch of text) {
      const glyph = pdfString(ch) === null ? symbolGlyph(ch) : null
      total += glyph ? glyph.width : 600
    }
    return total
  }
  const extra = EXTRA_WIDTHS[generic] || {}
  for (const ch of text) {
    const cp = ch.codePointAt(0)
    if (cp >= 32 && cp <= 126) { total += table[cp - 32]; continue }
    if (extra[cp] !== undefined) { total += extra[cp]; continue }
    if (pdfString(ch) === null) {
      const glyph = symbolGlyph(ch)
      // Symbol and ZapfDingbats are drawn at the run's own size, so their advance
      // is theirs — not the Latin face's.
      if (glyph) { total += glyph.width; continue }
    }
    const base = ch.normalize('NFD').replace(COMBINING, '')
    const bp = base ? base.codePointAt(0) : 0
    total += (bp >= 32 && bp <= 126) ? table[bp - 32] : table[('n'.codePointAt(0)) - 32]
  }
  return total
}

/**
 * The base-14 key for a text style. The SVD carries the family the page asked
 * for, never a binary, so this is a substitution every time and the document
 * says so once per family.
 */
function fontKeyFor (ctx, style) {
  const stack = `${style.family || ''} ${style.stack || ''}`.toLowerCase()
  let generic = 'sans'
  if (/mono|courier|consolas|menlo|sfmono|source code|fira code/.test(stack)) generic = 'mono'
  else if (/sans-serif|system-ui|-apple-system|helvetica|arial|segoe|roboto|inter|noto sans|verdana|tahoma/.test(stack)) generic = 'sans'
  else if (/serif|georgia|times|garamond|cambria|palatino|book antiqua/.test(stack)) generic = 'serif'
  const bold = finite(style.weight, 400) >= 600
  const italic = !!style.italic || style.fontStyle === 'italic' || style.fontStyle === 'oblique'
  const key = `${generic}${bold && italic ? '-bolditalic' : bold ? '-bold' : italic ? '-italic' : ''}`

  const family = (typeof style.family === 'string' && style.family.trim()) ||
    (typeof style.stack === 'string' ? style.stack.split(',')[0].trim() : '') || 'sans-serif'
  if (!ctx.fontNotes.has(family)) {
    ctx.fontNotes.add(family)
    ctx.note(null, `text asks for "${family}"; the SVD carries no font binary, so it is drawn in ` +
      `${BASE14[key]} and each line is stretched with Tz to the width the browser measured. The glyph shapes ` +
      'are not the page\'s.', 'emit.pdf.font-substituted', 'A')
  }
  return key
}

// ——— text ———

/**
 * Characters that have a faithful WinAnsi counterpart. Without this the U+2212
 * MINUS SIGN in `−62%` is unrepresentable, and the whole cell goes invisible for
 * the sake of one dash the base-14 fonts spell `-`.
 *
 * Only substitutions that are the same character in another codepoint, or the
 * space a zero-width/thin space already is. Nothing that changes what the text
 * says.
 */
const TRANSLITERATE = {
  0x2212: '-', 0x2010: '-', 0x2011: '-', 0x2043: '-',
  0x2044: '/', 0x2027: '·',
  0x2002: ' ', 0x2003: ' ', 0x2007: ' ', 0x2008: ' ', 0x2009: ' ', 0x200a: ' ', 0x202f: ' ',
  // U+2028 separates VISUAL LINES in `characters`. A run can span one; inside a
  // line it would tell a consumer to break where the measurement says it must not.
  0x2028: ' ', 0x2029: ' ',
  0x00ad: '', 0x200b: '', 0x200c: '', 0x200d: '', 0xfeff: '',
}

/** Replace what WinAnsi can spell another way; leave the rest for the caller. */
function transliterate (text, ctx, nodeId) {
  let out = ''
  let changed = null
  for (const ch of text) {
    const swap = TRANSLITERATE[ch.codePointAt(0)]
    if (swap === undefined) { out += ch; continue }
    changed = changed || ch
    out += swap
  }
  if (changed !== null) {
    ctx.note(nodeId, `text carries characters the base-14 fonts spell differently (first: U+${
      changed.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}); they are substituted with their ` +
      'WinAnsi equivalents so the line still reads.', 'emit.pdf.text-transliterated', 'A')
  }
  return out
}

/** Advance of one string in a base-14 face, in px, spacing included. */
function advanceOf (key, text, size, ls, ws) {
  const spaces = (text.match(/ /g) || []).length
  return (naturalWidth(key, text) / 1000) * size + ls * [...text].length + ws * spaces
}

/**
 * A run split into maximal stretches by where their glyphs come from: the Latin
 * base-14 face, Symbol, ZapfDingbats, or nowhere.
 *
 * Splitting matters: one U+2605 in `★★★★ 4.8` used to take the whole run into
 * the invisible Unicode font. Now the stars come out of ZapfDingbats and `4.8`
 * out of Helvetica, and only what neither font has stays invisible.
 *
 * @returns {{font: string, text: string}[]} `font` is the base-14 BaseFont name,
 *   `''` when no base-14 face can draw it, `'*'` for the run's Latin face.
 */
function chunkByEncodability (text) {
  const chunks = []
  for (const ch of text) {
    const latin = pdfString(ch) !== null
    const glyph = latin ? null : symbolGlyph(ch)
    const font = latin ? '*' : glyph ? glyph.base : ''
    const last = chunks[chunks.length - 1]
    if (last && last.font === font) last.text += ch
    else chunks.push({ font, text: ch })
  }
  return chunks
}

/**
 * `text-decoration` PROPAGATES rather than inherits, so a run can carry several.
 * PDF has no decoration at all — they are drawn as rectangles, all of them, which
 * is one thing this backend does better than the SVG one.
 */
/**
 * The cap height a synthesized small cap is drawn at, as a fraction of the em.
 *
 * A real small-caps face has designed glyphs; base-14 has none, so the only
 * honest approximation is the uppercase letter at roughly cap height. 0.8 is
 * where Chromium's own synthesis lands for the fonts these fixtures use, and it
 * is a ratio rather than a metric because the SVD carries no cap-height.
 */
const SMALL_CAPS_RATIO = 0.8

/**
 * Split a run into stretches that are drawn full size and stretches that are
 * drawn uppercase at cap height, per `font-variant-caps`.
 *
 * `all-small-caps` / `all-petite-caps` shrink every letter; `small-caps` /
 * `petite-caps` shrink only the ones that were lowercase. Anything else is one
 * stretch at full size, which is the no-op every other value wants.
 *
 * @returns {{text: string, small: boolean}[]}
 */
function splitSmallCaps (text, variant) {
  const v = typeof variant === 'string' ? variant.toLowerCase() : ''
  const all = v.includes('all-small-caps') || v.includes('all-petite-caps')
  const some = !all && (v.includes('small-caps') || v.includes('petite-caps'))
  if (!all && !some) return [{ text, small: false }]
  const out = []
  for (const ch of text) {
    // "Lowercase" is `toUpperCase` changing it — which is also what makes ß, ﬁ
    // and every non-cased script fall out on the correct side without a table.
    const small = all ? ch.toUpperCase() !== ch.toLowerCase() : ch.toUpperCase() !== ch
    const piece = small ? ch.toUpperCase() : ch
    if (out.length && out[out.length - 1].small === small) out[out.length - 1].text += piece
    else out.push({ text: piece, small })
  }
  return out.length ? out : [{ text, small: false }]
}

function readDecorations (style) {
  const raw = Array.isArray(style.decorations) ? style.decorations
    : Array.isArray(style.decoration) ? style.decoration
      : style.decoration === null || style.decoration === undefined ? []
        : [style.decoration]
  return raw
    .map((d) => (typeof d === 'string' ? { line: d } : d))
    .filter((d) => isObject(d) && typeof d.line === 'string' && d.line && d.line !== 'none')
}

/**
 * One `BT`/`ET` per block, one `Tj` per measured line.
 *
 * The SVD already broke the lines, so nothing here may let the PDF re-break them:
 * every line is placed absolutely with its own `Tm` at `line.baseline`, and the
 * only thing that touches its width is `Tz`, which stretches the substituted face
 * onto the width the browser measured. `Tc`/`Tw` carry letter and word spacing
 * before that scaling (PDF multiplies both by Th, so the ratio stays honest).
 */
function emitText (out, ctx, nodeId, node) {
  const t = node.text
  if (!isObject(t) || typeof t.characters !== 'string' || !Array.isArray(t.lines) || !t.lines.length) {
    ctx.note(nodeId, 'a text node carries no measured lines; nothing is emitted for it.',
      'emit.pdf.text-no-lines', 'O')
    return
  }
  if (t.direction === 'rtl') {
    ctx.note(nodeId, 'a right-to-left text block is emitted in logical order with no bidi reordering; the ' +
      'glyphs come out left-to-right.', 'emit.pdf.text-rtl', 'O')
  }
  const chars = t.characters
  const styles = isObject(ctx.doc.styles) && isObject(ctx.doc.styles.text) ? ctx.doc.styles.text : {}
  const runs = (Array.isArray(t.runs) ? t.runs : []).filter(isObject)
  if (!ctx.wantLinks && runs.some((r) => typeof r.href === 'string' && r.href)) {
    ctx.note(nodeId, 'text runs carry links and `links: false` was asked for; no link annotations are emitted.',
      'emit.pdf.text-links-dropped', 'O')
  }

  const body = []
  const decorations = []
  // Text state is sticky inside BT/ET, so every operator is only re-emitted when
  // it actually changes — a 43-node table is otherwise mostly Tf and Tz.
  const state = { font: null, color: null, tc: null, tw: null, tz: null, mode: null, alpha: null }

  for (const line of t.lines) {
    if (!isObject(line)) continue
    const start = Math.max(0, Number.isInteger(line.start) ? line.start : 0)
    const end = Math.min(chars.length, Number.isInteger(line.end) ? line.end : 0)
    if (end <= start) continue
    const measured = Math.max(0, finite(line.w))
    const baseline = finite(line.baseline)

    const segments = []
    for (const run of runs) {
      const from = Math.max(start, Number.isInteger(run.start) ? run.start : 0)
      const to = Math.min(end, Number.isInteger(run.end) ? run.end : 0)
      if (to > from) {
        segments.push({ from, to, style: styles[run.style],
          href: typeof run.href === 'string' && run.href ? run.href : null })
      }
    }
    if (!segments.length) segments.push({ from: start, to: end, style: null, href: null })
    segments.sort((a, b) => a.from - b.from)

    // Measure the whole line first: `Tz` is a property of the LINE, because the
    // SVD measures line widths and not run widths, and a per-run guess would
    // accumulate drift across a styled line.
    let natural = 0
    const pieces = []
    for (const segment of segments) {
      let style = segment.style
      if (!isObject(style)) {
        ctx.note(nodeId, 'a text run has no resolvable style; it is emitted at 16px sans-serif black.',
          'emit.pdf.text-style-missing', 'O')
        style = { size: 16, stack: 'sans-serif' }
      }
      const raw = transliterate(chars.slice(segment.from, segment.to), ctx, nodeId)
      const key = fontKeyFor(ctx, style)
      const size = finite(style.size, 16)
      const ls = finite(style.letterSpacing)
      const ws = finite(style.wordSpacing)
      // Small caps are synthesized here, BEFORE the advance is measured, so the
      // width the line's `Tz` is computed from is the width that gets painted.
      // Measuring the lowercase and drawing the caps is how a line ends up
      // stretched to hide its own substitution.
      const caps = splitSmallCaps(raw, style.variant)
      if (caps.length > 1 || caps[0].small) {
        ctx.note(nodeId, `a run is set in ${style.variant}; base-14 has no small-cap glyphs, so it is drawn as ` +
          `capitals at ${SMALL_CAPS_RATIO} of the em. The shapes are right and the proportions are close, but a ` +
          'designed small cap is wider and heavier than a shrunk capital.',
        'emit.pdf.text-small-caps', 'A')
      }
      for (const cap of caps) {
        const capSize = cap.small ? size * SMALL_CAPS_RATIO : size
        const width = advanceOf(key, cap.text, capSize, ls, ws)
        pieces.push({ style, text: cap.text, key, size: capSize, ls, ws, width, href: segment.href })
        natural += width
      }
    }
    if (!measured) {
      ctx.note(nodeId, 'a text line has no measured width; it is drawn at the substituted font\'s own width.',
        'emit.pdf.text-no-width', 'A')
    }
    const tz = measured > 0 && natural > 0
      ? Math.max(1, Math.min(1000, (measured / natural) * 100))
      : 100

    let cursor = finite(line.x)
    for (const piece of pieces) {
      const { style, text, key, size, ls, ws } = piece
      const fill = Array.isArray(style.fills) ? style.fills.find(isObject) : null
      let color = [0, 0, 0, 1]
      if (!fill || fill.type === 'solid') {
        color = fill ? fill.color : [0, 0, 0, 1]
      } else {
        const stops = readStops(fill, ctx, nodeId)
        color = stops ? sampleStops(stops, 0.5) : [0, 0, 0, 1]
        ctx.note(nodeId, `a ${String(fill.type)} text fill cannot paint glyphs in PDF without a text-clip pass; ` +
          'the run is painted as the flat colour of the gradient\'s mid stop.',
          'emit.pdf.text-fill-gradient-flat', 'O')
      }
      const alpha = alphaOf(color)
      const stroked = finite(style.strokeWidth) > 0

      const painted = (piece.width * tz) / 100
      const at = cursor
      for (const chunk of chunkByEncodability(text)) {
        const advance = (advanceOf(key, chunk.text, size, ls, ws) * tz) / 100
        let str
        let fontName
        let mode = stroked ? 2 : 0
        if (chunk.font === '*') {
          str = pdfString(chunk.text)
          fontName = ctx.res.font(key)
        } else if (chunk.font) {
          // Painted, not hidden: the character has a real glyph in a font every
          // viewer carries. Its /ToUnicode puts the original codepoint back on
          // the clipboard, so this costs shape and nothing else.
          const font = ctx.res.symbolFont(chunk.font)
          let literal = '('
          for (const ch of chunk.text) {
            const glyph = symbolGlyph(ch)
            font.used.set(glyph.code, ch.codePointAt(0))
            const byte = String.fromCharCode(glyph.code)
            literal += (byte === '(' || byte === ')' || byte === '\\' ? '\\' : '') + byte
          }
          str = `${literal})`
          fontName = font.name
          ctx.note(nodeId, `"${chunk.text}" has no glyph in a Latin base-14 font, so it is painted from ` +
            `${chunk.font}, which every PDF viewer carries. The shape is Adobe's, not the page's font's, and ` +
            'the advance is that face\'s own; /ToUnicode keeps the character itself for search and copy-paste.',
          'emit.pdf.text-symbol-font', 'A')
        } else {
          // No base-14 glyph, and the SVD carries no font binary to embed — so
          // there is no glyph to draw at all. It still goes in, invisible, so
          // the page stays searchable and copy-pasteable, and it says so.
          str = ctx.unicodeFont.encode(chunk.text)
          if (!str) {
            ctx.note(nodeId, 'a text run exceeded the 65,534 distinct codepoints one Identity-H font can carry; ' +
              'it is dropped.', 'emit.pdf.text-cid-overflow', 'O')
            cursor += advance
            continue
          }
          ctx.res.useUnicode(ctx.unicodeFont)
          fontName = ctx.unicodeFont.name
          mode = 3
          ctx.note(nodeId, `"${chunk.text}" uses characters neither WinAnsi nor Symbol nor ZapfDingbats can ` +
            'address, and the SVD carries no ' +
            'font binary to embed; that stretch is emitted as selectable-but-invisible text (Tr 3) rather than ' +
            'as wrong glyphs. The rest of the run is painted normally.',
            'emit.pdf.text-unicode-invisible', 'O')
        }

        if (state.alpha !== alpha) {
          const gs = gsFor(ctx, alpha, alpha)
          body.push(gs ? `/${gs} gs` : `/${ctx.res.gs('/Type /ExtGState /ca 1 /CA 1')} gs`)
          state.alpha = alpha
        }
        const fontLine = `/${fontName} ${num(size)} Tf`
        if (state.font !== fontLine) { body.push(fontLine); state.font = fontLine }
        const colorLine = fillColorOp(color)
        if (state.color !== colorLine) { body.push(colorLine); state.color = colorLine }
        if (state.tc !== ls) { body.push(`${num(ls)} Tc`); state.tc = ls }
        if (state.tw !== ws) { body.push(`${num(ws)} Tw`); state.tw = ws }
        if (state.tz !== tz) { body.push(`${num(tz)} Tz`); state.tz = tz }
        if (state.mode !== mode) { body.push(`${mode} Tr`); state.mode = mode }
        if (mode === 2) {
          body.push(`${num(finite(style.strokeWidth))} w`)
          body.push(strokeColorOp(Array.isArray(style.strokeColor) ? style.strokeColor : color))
        }
        // The counter-flip: the page CTM is y-down, and glyphs are not.
        body.push(`1 0 0 -1 ${num(cursor)} ${num(baseline)} Tm`)
        body.push(`${str} Tj`)
        cursor += advance
      }
      cursor = at
      if (piece.href && ctx.wantLinks && painted > 0) {
        // The run's own measured box, taken to SVD user space through the CTM
        // this node was reached under. `asc`/`desc` are the line's, which is
        // what a hit target should be — the em box, not the ink.
        const asc = finite(line.asc, size * 0.8)
        const desc = finite(line.desc, size * 0.2)
        ctx.links.push({
          href: piece.href,
          rect: transformBox(ctx.ctm, at, baseline - asc, at + painted, baseline + desc),
        })
      }
      for (const decoration of readDecorations(style)) {
        decorations.push({ line: decoration.line, color: decoration.color || color, style: decoration.style,
          thickness: Number.isFinite(Number(decoration.thickness)) && decoration.thickness !== null
            ? Number(decoration.thickness) : Math.max(0.5, size / 16),
          x: cursor, w: painted, baseline, size, asc: finite(line.asc, size * 0.8) })
      }
      cursor += painted
    }
  }

  if (!body.length) return
  // q/Q, because `gs` is sticky and a translucent run would otherwise fade
  // whatever the node paints after it.
  out.push('q')
  out.push('BT')
  for (const op of body) out.push(op)
  out.push('ET')
  out.push('Q')

  for (const d of decorations) {
    if (!(d.w > 0) || !(d.thickness > 0)) continue
    // CSS has no exposed metric for these positions in the SVD, and PDF has no
    // decoration primitive, so they are drawn from the size: the usual 0.1em
    // under the baseline, and a strike at the middle of the x-height.
    const y = d.line === 'overline' ? d.baseline - d.asc
      : d.line === 'line-through' ? d.baseline - d.size * 0.28
        : d.baseline + Math.max(1, d.size * 0.1)
    if (d.style && d.style !== 'solid' && d.style !== 'initial') {
      ctx.note(nodeId, `a text-decoration is "${d.style}"; it is drawn solid.`,
        'emit.pdf.text-decoration-style', 'A')
    }
    ctx.note(nodeId, `a ${d.line} is drawn as a rectangle positioned from the font size; the SVD carries no ` +
      'underline offset or thickness metric from the font.', 'emit.pdf.text-decoration-metrics', 'A')
    const alpha = alphaOf(d.color)
    if (alpha <= 0) continue
    out.push('q')
    const gs = gsFor(ctx, alpha, alpha)
    if (gs) out.push(`/${gs} gs`)
    out.push(fillColorOp(d.color))
    out.push(rectPath(d.x, y - d.thickness / 2, d.w, d.thickness))
    out.push('f')
    out.push('Q')
  }
}

// ——— nodes ———

const frameOf = (node) => rectOf(isObject(node.frame) ? node.frame : node.abs)

/** The node box plus every descendant's, in node-local px. */
function subtreeExtent (node, ctx) {
  const frame = frameOf(node)
  const origin = isObject(node.abs) ? rectOf(node.abs) : { x: 0, y: 0 }
  let minX = 0
  let minY = 0
  let maxX = frame.w
  let maxY = frame.h
  const stack = Array.isArray(node.children) ? node.children.slice() : []
  const seen = new Set()
  while (stack.length) {
    const id = stack.pop()
    if (seen.has(id)) continue
    seen.add(id)
    const child = ctx.nodes[id]
    if (!isObject(child)) continue
    if (isObject(child.abs)) {
      const abs = rectOf(child.abs)
      minX = Math.min(minX, abs.x - origin.x)
      minY = Math.min(minY, abs.y - origin.y)
      maxX = Math.max(maxX, abs.x - origin.x + abs.w)
      maxY = Math.max(maxY, abs.y - origin.y + abs.h)
    }
    if (Array.isArray(child.children)) stack.push(...child.children)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** Invariant 3: sort by `paint.z`, break ties with DOM order, never re-derive. */
function sortedChildren (node, ctx) {
  const ids = (Array.isArray(node.children) ? node.children : []).filter((id) => isObject(ctx.nodes[id]))
  return ids
    .map((id, i) => ({ id, i, z: Number.isInteger(ctx.nodes[id].paint && ctx.nodes[id].paint.z) ? ctx.nodes[id].paint.z : 0 }))
    .sort((a, b) => (a.z - b.z) || (a.i - b.i))
    .map((entry) => entry.id)
}

/**
 * One node: its own paint, then its children.
 *
 * `opacity < 1` and a blend mode both go through a transparency group form
 * XObject rather than a bare `/ca`. That distinction is not pedantry: `/ca` on a
 * subtree applies to every object in it separately, so two overlapping children
 * of a 50%-opacity group would show their own seam through each other. The group
 * composites the subtree first and fades the result, which is what CSS `opacity`
 * means.
 */
async function emitNode (out, ctx, nodeId, node) {
  if (ctx.visited.has(nodeId)) {
    ctx.note(nodeId, 'the node is reachable twice; the second visit is skipped to keep the emit finite.',
      'emit.pdf.node-revisited', 'O')
    return
  }
  ctx.visited.add(nodeId)

  const frame = frameOf(node)
  const box = { x: 0, y: 0, w: frame.w, h: frame.h }

  // The placement is decided here rather than at the bottom (where it is
  // WRITTEN) because everything emitted into `inner` below is emitted under it,
  // and a link annotation has to know that before the fact — it lives in the
  // page dictionary, which no `cm` reaches.
  const placement = []
  let localM = IDENTITY
  if (frame.x || frame.y) {
    const m = [1, 0, 0, 1, frame.x, frame.y]
    placement.push(matrixOp(m))
    localM = matMul(localM, m)
  }
  if (isObject(node.transform) && Array.isArray(node.transform.m) && node.transform.m.length === 6) {
    placement.push(matrixOp(node.transform.m))
    localM = matMul(localM, node.transform.m)
  } else if (node.transform !== null && node.transform !== undefined && !isObject(node.transform)) {
    ctx.note(nodeId, 'the node carries an unreadable transform; it is emitted untransformed.',
      'emit.pdf.transform-unreadable', 'O')
  }
  const parentCtm = ctx.ctm
  ctx.ctm = matMul(localM, parentCtm)

  const radii = normalizeRadii(node.radii, box.w, box.h)
  const effects = (Array.isArray(node.effects) ? node.effects : []).filter(isObject)
  const drops = effects.filter((e) => e.type === 'dropShadow' && e.source !== 'filter')
  const inners = effects.filter((e) => e.type === 'innerShadow' && e.source !== 'filter')
  for (const e of effects) {
    if (e.type === 'layerBlur' || e.type === 'backgroundBlur') {
      ctx.note(nodeId, `a CSS filter "${e.type}" applies to the node AND its descendants; PDF has no filter that ` +
        'reads back what is already painted, so it is dropped. Rasterizing the subtree is the only alternative ' +
        'and this backend does not rasterize.', 'emit.pdf.filter-dropped', 'O')
    } else if (e.type === 'colorMatrix') {
      // Named separately from `filter-dropped` because the loss is a different one and
      // the fix is a different one: a colour matrix is not a blur, it is `saturate()`,
      // `hue-rotate()`, `grayscale()` or `sepia()` applied to everything already painted
      // under this node. PDF's transfer functions (`/TR`) are per-channel curves and
      // cannot express a matrix that mixes channels, which every one of those does, so
      // the subtree paints in its ORIGINAL colours — a silent, plausible-looking picture,
      // which is why it must say so. The SVG backend paints it (`feColorMatrix`).
      ctx.note(nodeId, `${e.backdrop ? 'backdrop-filter' : 'filter'}: ${e.srcCss || 'a colour matrix'} recolours ` +
        'this node and everything inside it. PDF has no colour-matrix operator — `/TR` transfer functions are ' +
        'per-channel and these mix channels — so the subtree keeps its original colours and the recolouring is ' +
        'dropped. Nothing in the page looks missing, which is the danger: compare against the SVG backend, ' +
        'which paints it exactly.', 'emit.pdf.color-matrix-dropped', 'O')
    } else if ((e.type === 'dropShadow' || e.type === 'innerShadow') && e.source === 'filter') {
      ctx.note(nodeId, 'filter: drop-shadow() follows the alpha silhouette of the whole subtree; it is emitted ' +
        'from the node\'s own box instead.', 'emit.pdf.filter-shadow-box', 'A')
      if (e.type === 'dropShadow') drops.push(e)
      else inners.push(e)
    }
  }
  const fills = (Array.isArray(node.fills) ? node.fills : []).filter(isObject)
  const strokes = (Array.isArray(node.strokes) ? node.strokes : []).filter(isObject)

  const opacity = isNum(node.opacity) ? clamp01(node.opacity) : 1
  const blend = blendName(ctx, nodeId, node.blend)
  const grouped = opacity < 1 || !!blend
  // The node's own ops always go to a buffer, so the wrapper — a `q`/`Q` pair or
  // a transparency group — can be decided after the subtree is known.
  const inner = []

  if (drops.length && !fills.length && !strokes.length) {
    ctx.note(nodeId, 'the node has a box-shadow but no fill or stroke to cast it from; the shadow follows ' +
      'whatever silhouette its own paint has, which is empty.', 'emit.pdf.shadow-no-silhouette', 'A')
  }

  if (drops.length) emitDropShadows(inner, ctx, nodeId, drops, box, radii)
  for (const fill of fills) await emitLayer(inner, ctx, nodeId, fill, box, radii)
  if (inners.length) emitInnerShadows(inner, ctx, nodeId, inners, box, radii)
  if (strokes.length) emitStrokes(inner, ctx, nodeId, strokes, box, radii)
  if (node.type === 'text') emitText(inner, ctx, nodeId, node)
  if (node.type === 'vector') {
    ctx.note(nodeId, 'a vector node carries passthrough SVG markup, which this backend has no parser for; ' +
      'nothing is painted for it.', 'emit.pdf.vector-passthrough', 'O')
  }
  if (node.type === 'image' && !fills.length) {
    ctx.note(nodeId, 'an image node carries no image fill; nothing is painted for it.',
      'emit.pdf.image-node-empty', 'O')
  }
  if (node.mask) {
    ctx.note(nodeId, 'the node declares a mask; this backend does not emit masks yet, so it is painted unmasked.',
      'emit.pdf.mask-unsupported', 'O')
  }

  const children = sortedChildren(node, ctx)
  if (children.length) {
    const clip = isObject(node.clip) ? node.clip : null
    if (clip) {
      if (clip.mode !== 'rect') {
        ctx.note(nodeId, `clip mode "${String(clip.mode)}" is not a rectangle; it is emitted as the box outline.`,
          'emit.pdf.clip-not-rect', 'A')
      }
      if (!isObject(clip.rect) && clip.box && clip.box !== 'border') {
        ctx.note(nodeId, `the overflow clip is declared on the ${clip.box} box, but the node carries no padding ` +
          'inset; it is applied to the border box.', 'emit.pdf.clip-inset-unknown', 'A')
      }
      inner.push('q')
      inner.push(shapePath(isObject(clip.rect) ? rectOf(clip.rect) : box,
        normalizeRadii(clip.radii || node.radii, box.w, box.h)))
      inner.push('W n')
    }
    for (const id of children) await emitNode(inner, ctx, id, ctx.nodes[id])
    if (clip) inner.push('Q')
  }

  // Placement (computed at the top) is written outside the group, so the form's
  // BBox is in the node's own coordinates and the transform is applied once
  // either way.
  ctx.ctm = parentCtm

  if (!inner.length) return

  out.push('q')
  for (const op of placement) out.push(op)

  if (grouped) {
    // A transparency group, not a bare `/ca`: `/ca` applies to every object in
    // the subtree SEPARATELY, so two overlapping children of a 50% group would
    // show their own seam through each other. The group composites the subtree
    // first and fades the result, which is what CSS `opacity` means.
    const extent = subtreeExtent(node, ctx)
    const bleed = shadowBleed([...drops, ...inners])
    const formId = ctx.pdf.reserve()
    ctx.forms.push({
      id: formId,
      body: inner.join('\n'),
      dict: '/Type /XObject /Subtype /Form /FormType 1 ' +
        `/BBox [${num(extent.x - bleed)} ${num(extent.y - bleed)} ` +
        `${num(extent.x + extent.w + bleed)} ${num(extent.y + extent.h + bleed)}] ` +
        '/Group << /Type /Group /S /Transparency /CS /DeviceRGB /I false /K false >> ' +
        `/Resources ${ctx.resourcesId} 0 R`,
    })
    const gs = gsFor(ctx, opacity, opacity, blend)
    if (gs) out.push(`/${gs} gs`)
    out.push(`/${ctx.res.xobject(formId, 'Fm')} Do`)
  } else {
    for (const op of inner) out.push(op)
  }
  out.push('Q')
}

// ——— entry point ———

function readRootId (root) {
  if (typeof root === 'string' && root) return root
  if (isObject(root) && typeof root.$ref === 'string' && root.$ref) return root.$ref
  return null
}

/**
 * Render an SVD document as a vector PDF.
 *
 * Every box is a path, every gradient a shading, every line of text a `Tj` at the
 * baseline the browser measured. The only rasters in the output are the ones that
 * arrived as rasters in `doc.assets`.
 *
 * @param {object} doc  an SVD document (`svd/1.0`)
 * @param {object} [options]
 * @param {boolean} [options.compress=true]  Deflate the content streams. Turn it
 *   off to read the operators with `strings`.
 * @param {number[]|null} [options.background=null]  `[r, g, b]` (or `[r,g,b,a]`)
 *   floats 0..1 painted under the page. The capture root usually has its own
 *   background; this is for the ones that do not.
 * @param {number} [options.shadowLayers=24]  Concentric copies per blurred
 *   shadow. PDF has no blur; this is the knob on the approximation that replaces
 *   it. 1 collapses every shadow to a hard offset shape.
 * @param {number} [options.quality=0.92]  JPEG quality for raster assets that
 *   have to be re-encoded (a non-JPEG asset, in a runtime with a canvas).
 * @param {(d: object) => void} [options.onDiagnostic]  Called per approximation
 *   as it happens.
 * @param {(msg: string) => void} [options.onWarn]  Called with a one-line string
 *   per approximation. `onDiagnostic` gets the structured record; this is the
 *   channel a host that only owns a `console.warn` can read, and the raster plugin
 *   uses it.
 * @param {Array<{size:[number,number], clip?:[number,number,number,number],
 *   matrix:[number,number,number,number,number,number]}>} [options.pages]  Finished
 *   page geometry, one entry per page, from a caller that owns the pagination.
 *   `size` is the MediaBox in points; `clip` is the printable area in PAGE space
 *   (y UP) and nothing paints outside it; `matrix` is a PDF `cm` taking SVD user
 *   space (css px, y DOWN, origin at the capture root's border-box top-left) onto
 *   that page. The drawing is emitted ONCE as a form XObject and re-placed per
 *   page, so N pages cost one content stream plus N tiny ones.
 *   Omitted (the default) — one page at the capture's natural size, `PT` scale,
 *   no margins: the emitter paginates nothing on its own.
 * @param {boolean} [options.links=true]  Emit `/Link` annotations for text runs
 *   that carry an `href`. Rects come from the run's own measured box mapped
 *   through the node's accumulated CTM.
 * @returns {Promise<Uint8Array>} the PDF bytes. The array also carries a
 *   non-enumerable `diagnostics` array — `{code, severity, message, grade, node?}`,
 *   the shape `doc.diagnostics` holds — because an approximation that only
 *   reaches a stream nobody opens is a silent degradation. The same list is
 *   written into the file as an uncompressed object off the catalog, so
 *   `strings out.pdf` finds it too.
 */
export async function svdToPdf (doc, options = {}) {
  if (!isObject(doc)) throw new TypeError('svdToPdf: doc must be an SVD document object')
  const {
    compress = true,
    background = null,
    shadowLayers = SHADOW_LAYERS,
    quality = 0.92,
    onDiagnostic = null,
    onWarn = null,
    pages = null,
    links = true,
  } = options
  const pageList = readPages(pages)

  const nodes = isObject(doc.nodes) ? doc.nodes : {}
  const seen = new Set()
  const diagnostics = []
  const pdf = createPdfDoc()
  const catalogId = pdf.reserve()
  const pagesId = pdf.reserve()
  const resourcesId = pdf.reserve()
  const res = createResources(pdf)

  const ctx = {
    /** The SVD document. */
    doc,
    /** The PDF writer. Two different things, two different names. */
    pdf,
    nodes,
    res,
    resourcesId,
    forms: [],
    images: new Map(),
    visited: new Set(),
    fontNotes: new Set(),
    unicodeFont: createUnicodeFont(pdf),
    shadowLayers: Math.max(1, Math.round(finite(shadowLayers, SHADOW_LAYERS))),
    quality,
    /**
     * The transform from the node currently being emitted to SVD user space.
     * Maintained by `emitNode` alongside the `cm` it writes, because an
     * annotation rect is not in the content stream — it is in the page
     * dictionary, where no CTM reaches it, so the only way to place one is to
     * have carried the matrix here.
     */
    ctm: IDENTITY,
    /** `{rect: [x0,y0,x1,y1] in SVD user space, href}` — see `links`. */
    links: [],
    wantLinks: links !== false,
    /**
     * One approximation, in every channel it has: the returned `diagnostics`,
     * the object embedded in the file, and the caller's own hook.
     *
     * @param {string|null} nodeId  the node it happened on, null for the document
     * @param {string} message      prose, for a human reading the file
     * @param {string} [code]       stable id, so nobody has to regex the prose
     * @param {string} [grade]      the SVD fidelity grade this implies
     */
    note (nodeId, message, code = 'emit.pdf.approximation', grade = 'A') {
      const key = `${nodeId || ''}::${message}`
      if (seen.has(key)) return
      seen.add(key)
      const entry = { code, severity: SEVERITY_OF[grade] || 'warn', message, grade }
      if (nodeId) entry.node = nodeId
      diagnostics.push(entry)
      if (onDiagnostic) onDiagnostic(entry)
      // Two channels, one event. A host that has a console and no place to put a
      // structured record still hears it — that is the whole point of onWarn.
      if (onWarn) onWarn(`[emit/pdf] ${grade} ${code}${nodeId ? ` [${nodeId}]` : ''}: ${message}`)
    },
  }
  const rootId = readRootId(doc.root)
  const root = rootId !== null ? nodes[rootId] : null

  const capture = isObject(doc.capture) ? doc.capture : {}
  const captureRoot = isObject(capture.root) ? capture.root : null
  const rootFrame = isObject(root) ? frameOf(root) : { x: 0, y: 0, w: 0, h: 0 }
  const width = captureRoot && finite(captureRoot.w) > 0 ? finite(captureRoot.w) : rootFrame.w
  const height = captureRoot && finite(captureRoot.h) > 0 ? finite(captureRoot.h) : rootFrame.h
  if (!(width > 0) || !(height > 0)) {
    ctx.note(null, 'the capture has no width or height; a 1x1 point page is emitted.',
      'emit.pdf.empty-page', 'O')
  }
  const pageW = Math.max(1, width * PT)
  const pageH = Math.max(1, height * PT)

  // The drawing, once, in SVD user space (css px, y DOWN, origin at the capture
  // root's top-left). It is deliberately NOT wrapped in the page flip here: a
  // caller that supplies `pages` places this same body on every page under its
  // own matrix, and the emitter must not have baked one page's geometry into it.
  const drawing = []
  if (!isObject(root)) {
    ctx.note(null, `root ${rootId === null ? 'is missing' : `"${rootId}" does not resolve to a node`}; the ` +
      'document is emitted empty.', 'emit.pdf.root-missing', 'O')
  } else {
    await emitNode(drawing, ctx, rootId, root)
    const orphans = Object.keys(nodes).filter((id) => !ctx.visited.has(id))
    if (orphans.length) {
      ctx.note(null, `${orphans.length} node(s) are not reachable from the root and are not emitted: ` +
        `${orphans.slice(0, 8).join(', ')}${orphans.length > 8 ? ', …' : ''}.`,
      'emit.pdf.orphan-nodes', 'O')
    }
  }

  /**
   * The page geometry actually used. Without `pages` this is the single page at
   * the capture's natural size and the classic y-flip — the behaviour every
   * caller had before the option existed, reproduced operator for operator.
   */
  const sheets = pageList || [{
    size: [pageW, pageH],
    matrix: [PT, 0, 0, -PT, 0, pageH],
    clip: null,
  }]
  if (pageList) {
    ctx.note(null, `the caller supplied ${pageList.length} page geometr${pageList.length === 1 ? 'y' : 'ies'}; ` +
      'the drawing is emitted once and placed under each page\'s own matrix, so the capture\'s natural size and ' +
      'this backend\'s own y-flip are not used.', 'emit.pdf.caller-pagination', 'A')
    if (pageList.length > 1) {
      // Measured, not assumed: pdf.js's getTextContent returns only the slice
      // that lands on each page, and every renderer clips to the MediaBox — but
      // the OPERATORS for the whole document are on every page, off-media, and a
      // search index that reads the stream rather than the geometry will find
      // each word once per page. Fixing it means walking the tree once per page
      // with a y-window, which this backend does not do.
      ctx.note(null, `the drawing is one form XObject shared by all ${pageList.length} pages, so each page's ` +
        'content stream references the whole document and only the matrix decides which slice lands on the ' +
        'paper. Rendering, clipping and text extraction are correct; a raw-stream text scraper will see every ' +
        'word once per page.', 'emit.pdf.pagination-shared-drawing', 'O')
    }
  }

  ctx.unicodeFont.finalize()

  const deflated = compress && canDeflate
  const streamDict = deflated ? '/Filter /FlateDecode' : ''
  if (compress && !canDeflate) {
    ctx.note(null, 'this runtime has no CompressionStream, so the content streams are written uncompressed.',
      'emit.pdf.no-deflate', 'E')
  }

  /**
   * The painted background, in the space the sheet is drawn in.
   *
   * One page gets it in SVD space over the capture rect (where the drawing is);
   * a paginated run gets it in PAGE space over the printable area, because that
   * is what "the paper is this colour" means once there is paper.
   */
  const backgroundOps = (x, y, w, h) => {
    if (!Array.isArray(background) || background.length < 3) return []
    const alpha = alphaOf(background)
    const gs = gsFor(ctx, alpha, alpha)
    return [...(gs ? [`/${gs} gs`] : []), fillColorOp(background), rectPath(x, y, w, h), 'f']
  }

  // The drawing goes into a form XObject only when there is more than one place
  // to put it. For the single-page default it is inlined, so the content stream
  // is exactly what it has always been.
  let drawingRef = null
  if (pageList) {
    // A shadow, an outline or a negative-offset child paints outside the capture
    // rect; the BBox must not be the thing that clips it — the page's own `clip`
    // is. One capture-size ring of bleed is past any shadow this backend draws.
    const bleed = Math.max(width, height, 1)
    const formId = pdf.reserve()
    ctx.forms.push({
      id: formId,
      body: drawing.join('\n'),
      dict: '/Type /XObject /Subtype /Form /FormType 1 ' +
        `/BBox [${num(-bleed)} ${num(-bleed)} ${num(width + bleed)} ${num(height + bleed)}] ` +
        '/Group << /Type /Group /S /Transparency /CS /DeviceRGB >> ' +
        `/Resources ${resourcesId} 0 R`,
    })
    drawingRef = ctx.res.xobject(formId, 'Fm')
  }

  const contentIds = sheets.map((sheet) => {
    const ops = ['q']
    if (sheet.clip) {
      ops.push(rectPath(sheet.clip[0], sheet.clip[1], sheet.clip[2], sheet.clip[3]))
      ops.push('W n')
      ops.push(...backgroundOps(sheet.clip[0], sheet.clip[1], sheet.clip[2], sheet.clip[3]))
    } else if (pageList) {
      ops.push(...backgroundOps(0, 0, sheet.size[0], sheet.size[1]))
    }
    // The natural-size default takes neither branch: it has no printable area,
    // the sheet IS the capture box, and its background is painted in SVD space
    // below so the operators stay what they have always been.
    // After this `cm` every coordinate is a CSS px in the SVD's own y-down space
    // with the origin at the capture root's top-left. Nothing below ever thinks
    // about PDF's y again — except text, which counter-flips its own matrix so
    // the glyphs stand up.
    ops.push(matrixOp(sheet.matrix))
    if (drawingRef) {
      ops.push(`/${drawingRef} Do`)
    } else {
      ops.push(...backgroundOps(0, 0, width, height))
      ops.push(...drawing)
    }
    ops.push('Q')
    const bodyText = ops.join('\n')
    return { id: null, bodyText }
  })

  // Awaited outside the map: deflate is async and `map` would hand back promises.
  for (const entry of contentIds) {
    entry.id = pdf.addStream(streamDict, deflated ? await deflate(entry.bodyText) : entry.bodyText)
  }

  // Forms are filled last: their ids were reserved while the tree was walked.
  for (const form of ctx.forms) {
    pdf.fillStream(form.id, `${form.dict}${deflated ? ' /Filter /FlateDecode' : ''}`,
      deflated ? await deflate(form.body) : form.body)
  }

  res.finalizeSymbols()
  pdf.fill(resourcesId, res.body())

  const pageIds = sheets.map((sheet, i) => {
    const annots = []
    for (const link of ctx.links) {
      const [x0, y0, x1, y1] = transformBox(sheet.matrix,
        link.rect[0], link.rect[1], link.rect[2], link.rect[3])
      const box = sheet.clip
        ? [Math.max(x0, sheet.clip[0]), Math.max(y0, sheet.clip[1]),
          Math.min(x1, sheet.clip[0] + sheet.clip[2]), Math.min(y1, sheet.clip[1] + sheet.clip[3])]
        : [x0, y0, x1, y1]
      // A run that this page's slice does not contain is not this page's link.
      if (!(box[2] > box[0]) || !(box[3] > box[1])) continue
      const uri = pdf.add(`<< /Type /Annot /Subtype /Link /Rect [${box.map(num).join(' ')}] ` +
        `/Border [0 0 0] /A << /Type /Action /S /URI /URI ${pdfString(link.href)} >> >>`)
      annots.push(`${uri} 0 R`)
    }
    if (annots.length) {
      ctx.note(null, `${annots.length} link annotation(s) on page ${i + 1}, from text runs carrying an href. A ` +
        'link wrapped around an image or a whole box has no text run to carry it and gets none.',
      'emit.pdf.text-links', 'A')
    }
    return pdf.add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(sheet.size[0])} ${num(sheet.size[1])}] ` +
      `/Resources ${resourcesId} 0 R /Contents ${contentIds[i].id} 0 R ` +
      (annots.length ? `/Annots [${annots.join(' ')}] ` : '') +
      '/Group << /Type /Group /S /Transparency /CS /DeviceRGB >> >>'
    )
  })
  pdf.fill(pagesId, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] ` +
    `/Count ${pageIds.length} >>`)

  // Left uncompressed on purpose: `strings out.pdf` has to find them. The
  // trailer `createPdfDoc` writes carries /Size and /Root only, so there is no
  // /Info dictionary to hang provenance off — it rides in this stream's header
  // instead. (A /Info would need a change in `../writer/`.)
  const generator = isObject(doc.generator) ? doc.generator : {}
  const header = [
    `${generator.name || '@zumer/snapdom-vector'} ${generator.version || ''} · emit/pdf · ` +
      `${doc.schema || 'svd'}`,
    `${capture.selector || ''} ${capture.url || ''} ${capture.capturedAt || ''}`.trim(),
    `${diagnostics.length} approximation(s) — nothing here is silent.`,
  ]
  const notesId = pdf.addStream('/Type /SnapdomDiagnostics',
    header.concat(diagnostics.map((d) =>
      `· ${d.severity} ${d.grade} ${d.code}${d.node ? ` [${d.node}]` : ''}: ${d.message}`)).join('\n'))

  pdf.fill(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R /SnapdomDiagnostics ${notesId} 0 R >>`)

  const bytes = pdf.build(catalogId)
  Object.defineProperty(bytes, 'diagnostics', { value: diagnostics, enumerable: false })
  return bytes
}

export default svdToPdf
