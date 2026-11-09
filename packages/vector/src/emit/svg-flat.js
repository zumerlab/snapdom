/**
 * SVD -> flat SVG. The oracle backend.
 *
 * `SVD -> SVG -> raster -> Δ2` is what validates the paint engine without Figma
 * in the middle, so this file is held to one rule above all others: **no
 * `foreignObject`**. Nothing here may hand the layout back to a browser. Every
 * box, every stop, every baseline is written out as geometry that a dumb SVG
 * consumer (usvg, Illustrator, Inkscape, Penpot's `createShapeFromSvg`) can
 * rasterize identically.
 *
 * Pure and DOM-free: it runs in Node, which is the only reason the harness can
 * fuzz it.
 *
 * Conventions, all of them consequences of the SVD invariants:
 *
 *  - Children are emitted sorted by `paint.z` (invariant 3). The order is never
 *    re-derived from the DOM, only broken ties fall back to `children` order.
 *  - `blur` is the CSS radius, so every `stdDeviation` here is `blur / 2`
 *    (invariant 5). That division happens in exactly one helper.
 *  - Gradient geometry is unit-square + matrix (invariant 6). The matrix is in
 *    PX, so it is emitted `gradientUnits="userSpaceOnUse"` with the painting
 *    box's origin folded in; `objectBoundingBox` reads one unit as one bbox
 *    width and threw every gradient off the shape. The `unit` keys are fixed by
 *    CONTRACT.md per type (`p0/p1`, `center/radius/shape`, `center/startAngle`)
 *    and are read verbatim here — the old `from||start||p0` probe list is gone,
 *    it was right by accident and the Figma plugin's copy of it was wrong.
 *  - Within a node: fills, then strokes, then children. That is CSS 2.1
 *    Appendix E order for a block box — its border paints under its
 *    descendants, and an overflowing child paints over the border.
 *
 * Three of the conventions are not consequences of the SVD at all: they are what
 * FIGMA_FINDINGS.md measured by pasting into Figma, each isolated by changing one
 * thing and pasting again. They are defaults here because pasting is what this
 * SVG is FOR, and every one of them is also cheaper — fewer nodes, shorter
 * markup. The exact-but-unimportable form of each stays reachable by option.
 *
 *  - **One `<text>` per visual line** (`textPerLine`). Figma discards the `x`/`y`
 *    of an interior `<tspan>` and reflows with its own leading, so a paragraph
 *    arrives with its lines on top of each other. A block that fits on ONE line
 *    still travels as one `<text>` — it is the more editable shape and nothing
 *    reflows.
 *  - **`textLength` only when the font travels** (see `fontFaceRules`). Locking a
 *    line to a width measured with the page's font, in a viewer that substituted
 *    the family, squeezes the glyphs into it. Without a binary the width is the
 *    viewer's to decide, and that is declared rather than forced.
 *  - **`feDropShadow` over the exact chain** (`exactShadows`). Figma keeps the
 *    `feFlood` and drops the `feComposite` that cuts the colour to the silhouette,
 *    so the exact chain lands as a black rectangle. The primitive is exact for a
 *    shadow with no spread and approximate with one — never silent.
 *
 * Three more are about TEXT, and each is a place where the CSS shape has no SVG
 * attribute at all — so the choice is between geometry and a wrong picture:
 *
 *  - **`background-clip: text` moves the paint onto the glyphs** (`applyTextClip`),
 *    never onto the border box — a gradient BAR where the words are is not a
 *    degraded heading, it is a different picture. A flat colour becomes the
 *    `<text>`'s own fill and the block stays one editable text object. A GRADIENT
 *    goes through a `<mask>` of the same text (`emitTextElements`,
 *    `textGradientMask`): measured, Figma does not resolve `fill="url(#…)"` on a
 *    `<text>` and the heading arrives black, while the mask arrives in colour and
 *    stops being a text layer there. Colour by default, the editable layer by
 *    option, and the trade is in the diagnostics either way.
 *  - **`-webkit-text-stroke` becomes `stroke`/`stroke-width`** (`textStrokeAttrs`).
 *    Both are centred on the outline and SVG's default paint order is WebKit's,
 *    so this one is exact — it was simply not being read.
 *  - **`text-decoration-style: wavy` becomes a `<path>`** (`wavyUnderline`), at
 *    the wavelength and amplitude Chromium paints, measured off its raster
 *    (`WAVY_*`), ending exactly where its run does — no `<clipPath>` to trim the
 *    overshoot, because a `userSpaceOnUse` clip inside a transformed group is
 *    one more coordinate space for an importer to resolve differently from the
 *    text beside it. Only where the run's extent was measured: a `Run` carries
 *    no `x`, so a decoration whose characters `line.spans` does not tile keeps
 *    the straight attribute rather than guess one.
 *  - **a run raised or lowered off the baseline becomes its own positioned
 *    piece** (`pushRange`), never a relative `dy` inside its line. `dy` is
 *    cumulative and Figma does not carry the whole chain, so the raised glyph
 *    and everything after it drifted.
 *  - **the hyphen at a hyphenation break is painted** (`buildPiece`, `hyphen`).
 *    `hyphens: auto` makes the browser draw a glyph the document does not
 *    contain, so it is not in `characters` and rides on `line.hyphen` instead
 *    (`collect.text-hyphen`); the piece that ends the line appends it inside its
 *    last tspan. Its advance was already inside the measured line width, so
 *    nothing else moves — and without it a justified paragraph reads as a run of
 *    misspelt words. `emit/figma-json.js` deliberately does NOT: that backend's
 *    text reflows, and a hyphen that outlives its break lands inside a word.
 *
 * And one is about text that was measured through a matrix (`unbbox`): a client
 * rect taken through a rotation is the bounding box of a quad, `collect/text.js`
 * says so and cannot undo it, and this backend re-applies the same matrix — so
 * the error compounded until the glyphs sat 30 device px off their box. The
 * inverse is exact and is applied here, where both the matrix and the box are.
 *
 * The next is `layerTiles`: a repeating background layer is UNROLLED — the tile
 * emitted once per position, inside the fills' own box clip — instead of being
 * declared as a `<pattern>`. Figma does not resolve `fill="url(#pattern)"` and
 * drops the whole node — it does not degrade, it disappears — so the exact
 * construction was costing the node its existence in the one destination that is
 * the product. Unrolling is bounded: `TILE_BUDGET` copies, and a byte budget for
 * the tiles that carry their own payload. Above it a gradient layer is
 * rasterized to a PNG `<image>` (the one degraded form the paste probe proves
 * Figma draws), and only what can be neither unrolled nor rasterized keeps the
 * `<pattern>` — and says so.
 *
 * The last one is the newest measurement and the one with no exact form to fall
 * back to: **Figma does not execute SVG filters.** It maps `feDropShadow` and
 * `feGaussianBlur` onto effects of its own and ignores any filter it cannot map —
 * a lone `feColorMatrix`, with nothing composite around it, arrived with its node
 * and no colour change at all (six-shape paste probe, 2026-08-06). That covers
 * the colour half of every `filter`/`backdrop-filter` (`saturate`, `brightness`,
 * `contrast`, `grayscale`, `sepia`, `hue-rotate`, `invert`) and every inner
 * shadow, which has no primitive and stays a chain. Two things follow and both
 * are load-bearing:
 *
 *  - it is DECLARED, once per filter, by `declareUnimported`, which reads the
 *    primitives off the body about to be written so it cannot drift from what is
 *    emitted. The wording separates the two failures that have been measured and
 *    are not the same thing to whoever is pasting: a filter that is not run costs
 *    the node its EFFECT (it arrives whole and lands unfiltered), a `<pattern>`
 *    fill costs the node its EXISTENCE. And it says the SVG is exact in a
 *    browser, because it is;
 *  - `rasterFilters` (opt-in, off by default) resolves exactly those nodes to a
 *    PNG `<image>` — the one degraded form the probe proves Figma draws — and
 *    touches no node whose filter arrives intact. This backend cannot rasterize:
 *    it is synchronous and DOM-free. `rasterFilterPlan` (exported) is what it
 *    knows — which nodes and over what box — and the export that still holds the
 *    mounted clone does the painting and leaves the asset on the node. Here, the
 *    presence of that asset is the whole instruction.
 *
 * Every approximation goes through `ctx.note()`, which writes it to TWO places:
 * the comment block under the `<svg>` open tag (so the file is self-describing)
 * and the `diagnostics` array this module now RETURNS alongside the markup. The
 * return is how the orchestrator folds them into `doc.diagnostics` — while they
 * only reached the comment, the panel showed "0 diagnostics" over an SVG that
 * had declared four approximations in a comment nobody opens.
 */
import { toCssString } from '../css/color.js'

/** How many flat wedges approximate one conic gradient. 2.8° each. */
const CONIC_WEDGES = 128

/** Unit-space radius of the conic fan: a unit square's far corner is at √2. */
const CONIC_REACH = 2

/** Degrees each wedge overlaps the next, to close the antialiasing seam between them. */
const CONIC_SEAM = 0.4

/**
 * Radius, in PAINTED px, of the disc that caps the fan's apex. 128 triangles
 * meeting at one point never cover it: each one is sub-pixel wide there, so the
 * antialiasing coverage sums to less than 1 and the backdrop shows through as a
 * pale ~6px blot (visible in `fx-card`'s ring). The disc is the fan's own mean
 * colour, which is what the limit of a conic gradient at its centre actually is.
 */
const CONIC_APEX_PX = 3.5

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }

/** Everything XML 1.0 forbids in text: the C0 controls bar tab/LF/CR, and the two noncharacters. */
const ILLEGAL_XML = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]', 'g')

/** A surrogate with no partner is not a character at all; no encoding can carry it. */
const LONE_SURROGATE = new RegExp('[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]', 'g')

/** U+2028 joins visual lines in `characters`; inside one line it must not survive. */
const LINE_SEPARATOR = new RegExp('\\u2028', 'g')

const FONT_FORMATS = {
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'truetype',
  'font/otf': 'opentype',
  'application/font-woff2': 'woff2',
  'application/font-woff': 'woff',
  'application/x-font-ttf': 'truetype',
  'application/x-font-opentype': 'opentype',
}

const FIT_ASPECT = {
  stretch: 'none',
  fill: 'none',
  none: 'xMidYMid meet',
  cover: 'xMidYMid slice',
  contain: 'xMidYMid meet',
  'scale-down': 'xMidYMid meet',
}

const ZERO_RADII = [[0, 0], [0, 0], [0, 0], [0, 0]]

/**
 * How much shorter than its box a background tile may be and still count as
 * covering it, in CSS px. A twentieth of a px is a fifth of a device pixel at 4x:
 * no repeat seam can paint there, so a gap that small is the two measurements
 * disagreeing, not a repetition. It is deliberately far below the 1px a real
 * border-box/padding-box inset produces, which DOES tile and keeps its wrapper.
 */
const TILE_COVER_EPS = 0.05

/**
 * How much of a partial edge tile has to fall inside the painted box before it
 * is worth an element of its own, in CSS px.
 *
 * Half a pixel is not a taste: it is the geometry's OWN declared error. A node
 * under a transform is measured off the integer-rounded layout offset chain
 * (`B4.geometry-from-layout`, which says "up to 0.5px off per axis"), so a box
 * can arrive up to half a px WIDER than the background positioning area inside
 * it — `challenges/fx-grid`'s rotated badge is 89.7969 px of gradient in a box
 * rounded to 90 — and the leftover strip is that rounding, not a repetition.
 * Unrolling it would paint the tile's LEADING colour in a sliver where the live
 * element paints its trailing one: a bright hairline the source does not have.
 */
const TILE_SLIVER_PX = 0.5

/**
 * How far each unrolled tile reaches past its own right and bottom edge, in CSS
 * px, to close the seam against the next one.
 *
 * Two rectangles that share an edge at a fractional coordinate do NOT sum to
 * full coverage: each is antialiased against the backdrop separately, so 0.4
 * from one and 0.6 from the other composite to 0.96 of the colour and 0.04 of
 * whatever was behind. Measured on a tiling whose gradient is a single colour —
 * which must render as a flat field — the unrolled version came out with a
 * visible grid of pale lines on every tile boundary, the whole grid legible in
 * the amplified diff. It is the same defect `CONIC_SEAM` exists for.
 *
 * One px is chosen against the SMALLEST device pixel this can be viewed at: at
 * dpr 1 it is one whole pixel of overlap, which is what it takes for the tile
 * underneath to cover the seam pixel completely rather than nearly. Tiles are
 * written in row-major order, so the overlap is always painted OVER by the
 * neighbour that owns it, and the last row and column are cut by the fills'
 * box clip.
 */
const TILE_SEAM_PX = 1

/**
 * Tiles one unrolled background layer may paint before the layer is rasterized
 * instead.
 *
 * Measured, not picked: a tiling gradient injected at each size onto
 * `challenges/fx-grid`'s own card (486x339.5, and the fixture emits that node 2x
 * because a descendant's `backdrop-filter` needs its own copy of the backdrop),
 * captured through `window.__challenges` — the fixture's real path, real
 * geometry, real neighbours. The document is 28.9 kB and 211 elements empty.
 *
 * | tile  | tiles | elements |    bytes | rasterized instead |
 * |-------|-------|----------|----------|--------------------|
 * | 240px |     6 |      230 |  30.7 kB |                    |
 * | 128px |    12 |      242 |  31.9 kB |                    |
 * |  96px |    24 |      266 |  34.4 kB |                    |
 * |  64px |    48 |      314 |  39.4 kB |                    |
 * |  48px |    88 |      394 |  47.7 kB |                    |
 * |  32px |   176 |      570 |  66.1 kB |                    |
 * |  24px |   315 |      848 |  95.1 kB | 219 el, 202 kB     |
 * |  16px |   682 |     1582 | 171.8 kB | 219 el, 156 kB     |
 * |   8px |  2623 |     5464 | 566.6 kB | 219 el, 122 kB     |
 *
 * 256 is where the curve turns. Up to it the layer is at worst a doubling of a
 * small file and every tile is still a shape a designer can select; past it the
 * background stops being a layer and becomes the document — 2623 rectangles and
 * half a megabyte for one 8px texture, of which nobody will ever edit one tile.
 *
 * The right-hand column is why the budget is on the COUNT and not on the bytes.
 * At the edge of it rasterizing is not cheaper in bytes — 202 kB against 95 kB
 * at 24px — and it is still the right trade, because what it buys is 630 fewer
 * nodes in a document a person has to work in. Two tile sizes further out it
 * wins on both, by 25x and by 4.6x.
 *
 * The same shape as `css/gradient.js`'s `MAX_REPEATS`: unroll to a budget, and
 * say out loud what happened at the edge of it.
 */
const TILE_BUDGET = 256

/**
 * Added bytes an unrolled layer may cost, on top of the count.
 *
 * The count alone is the wrong unit for a tile that carries its own payload: 200
 * copies of a `<rect>` is 16 kB, 200 copies of an `<image>` whose href is a 40 kB
 * data URI is 8 MB. A budget that cannot see that is not a budget.
 */
const TILE_BYTES_BUDGET = 256 * 1024

/**
 * Device px per CSS px a rasterized tiling is drawn at, the largest canvas it
 * may ask for, and the encoded size above which it settles for 1x instead.
 *
 * `TILE_RASTER_BYTES` is half `TILE_BYTES_BUDGET` on purpose: the raster exists
 * because the unrolling was too expensive, so it may not cost more than the
 * unrolling would have. Measured on the fixture, a 24px plaid over the 486x340
 * card is 233 kB at 2x and 58 kB at 1x — the first is four times the 66 kB the
 * whole unrolled document cost at 32px tiles, which would make the escape hatch
 * the worse door.
 */
const TILE_RASTER_SCALE = 2
const TILE_RASTER_MAX_PX = 2048
const TILE_RASTER_BYTES = 128 * 1024

/**
 * Families every viewer resolves by definition: the CSS generics plus the
 * system-stack keywords, which are *defined* as "whatever this machine uses".
 * Anything outside this set is a name that only resolves if the machine happens
 * to have the file — and v0 embeds no font binaries, so it has to say so.
 */
const RESOLVABLE_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'math',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'fangsong',
  '-apple-system', 'blinkmacsystemfont', 'inherit', 'initial', 'unset',
])

/** Accepted `textPerLine` values; anything else is declared and falls back to 'auto'. */
const TEXT_PER_LINE = new Set(['auto', 'always', 'never'])

/** `text-decoration-style` values SVG 1.1 renderers cannot draw. */
const PLAIN_DECORATION_STYLES = new Set(['solid', 'initial', ''])

/**
 * Chromium's `text-decoration-style: wavy`, MEASURED, not derived from the spec —
 * CSS says nothing about the shape and every engine draws its own.
 *
 * Probe: `-apple-system` at 12/16/22/30/48px × `text-decoration-thickness`
 * auto/1/2/3/4px, rasterised at deviceScaleFactor 8, the decoration painted in a
 * hue no glyph uses so the columns can be separated from the text, then read back
 * as a per-column ink extent and weighted centroid.
 *
 *   thickness   1px      2px      3px      4px
 *   wavelength  7.000    11.000   15.000   19.000     -> 4t + 3, exactly, all four
 *   ink height  3.750    6.250    9.000    11.750     -> peak-to-peak + t (the stroke)
 *   peak-peak   2.750    4.250    6.000    7.750      -> 1.75t + 0.75, ±0.25 at t=1
 *   ink top     1.625    1.375    2.000    1.625      -> below the baseline
 *
 * Both are functions of the RESOLVED THICKNESS and of nothing else: the same
 * `2px` produced the same 11px wavelength at 12px and at 48px type. The ink top
 * moves 1:1 with `text-underline-offset` (measured: `0px` -> 0.375, `auto` ->
 * 1.375, `4px` -> 4.375 at t=2), which is the one number the SVD does not carry —
 * see `wavyUnderline`.
 */
const WAVY_WAVELENGTH = (t) => 4 * t + 3
const WAVY_PEAK_TO_PEAK = (t) => 1.75 * t + 0.75
/** Where the wave's ink starts, below the baseline, at `text-underline-offset: auto`. */
const WAVY_INK_TOP = 1.4

/** The `font-variant-caps` values, which are the only ones SVG's attribute takes. */
const CAPS_VARIANTS = new Set([
  'small-caps', 'all-small-caps', 'petite-caps', 'all-petite-caps', 'unicase', 'titling-caps',
])

const IDENTITY_LINEAR = [1, 0, 0, 1]

/**
 * Below this, a matrix entry is zero: `chainScale` in `collect/text.js` uses the
 * same test to decide whether a measurement could be divided out, and the two
 * have to agree or this file un-does a correction that was never made.
 */
const AXIS_EPS = 1e-6

// ——— primitives ———

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const finite = (v, dflt = 0) => (Number.isFinite(Number(v)) ? Number(v) : dflt)

/** 4 decimals of a CSS px is well below a device pixel and keeps the markup readable. */
function num(v, dflt = 0) {
  const n = Number.isFinite(Number(v)) ? Number(v) : dflt
  const r = Math.round(n * 1e4) / 1e4
  return Object.is(r, -0) ? '0' : String(r)
}

function escText(value) {
  return String(value).replace(/[&<>]/g, (c) => XML_ESCAPES[c])
}

function escAttr(value) {
  return String(value).replace(/[&<>"']/g, (c) => XML_ESCAPES[c])
}

/**
 * `--` cannot appear inside an XML comment and a comment cannot end with `-`.
 * The notes block is the only place authored text reaches a comment.
 */
function escComment(value) {
  return String(value).replace(/-{2,}/g, '-').replace(/-$/, '- ').replace(/\r?\n/g, ' ')
}

/** An id has to be an XML NCName; SVD ids are usually fine, but never assume. */
function safeId(value, fallback) {
  const s = String(value == null ? '' : value).replace(/[^\w.:-]/g, '_')
  return /^[A-Za-z_]/.test(s) ? s : `${fallback}${s}`
}

const ATTR_NAME = /^([A-Za-z_:][\w.:-]*)="/

/** The name of an already-rendered `name="value"` attribute. */
function attrName(attr) {
  const m = ATTR_NAME.exec(attr)
  return m ? m[1] : attr
}

/** Its value, still escaped — the only safe way to take one apart and re-glue it. */
function attrValue(attr) {
  const name = attrName(attr)
  return attr.slice(name.length + 2, -1)
}

/**
 * Several attribute lists into one element's attributes, later lists winning per
 * NAME and first-seen order kept.
 *
 * This exists because of one afternoon: splitting a text block into one `<text>`
 * per line means the element carries both the block's inherited typography and
 * the line's own, and CONCATENATING those two lists writes `font-size` twice.
 * XML forbids a repeated attribute — a strict parser rejects the whole document,
 * not the tag — and the symptom in Figma was that a paste did nothing at all.
 * Merging is not a nicety here; it is the difference between a document and a
 * parse error.
 *
 * `style` is the one attribute that MERGES rather than replaces: it is a
 * declaration list, and later declarations already win inside it.
 *
 * @param {...string[]} lists  rendered `name="value"` attributes, least specific first
 * @returns {string[]} one attribute per name
 */
function mergeAttrs(...lists) {
  const order = []
  const byName = new Map()
  for (const list of lists) {
    for (const attr of list) {
      if (!attr) continue
      const name = attrName(attr)
      if (!byName.has(name)) order.push(name)
      byName.set(name, name === 'style' && byName.has(name)
        ? `style="${attrValue(byName.get(name))};${attrValue(attr)}"`
        : attr)
    }
  }
  return order.map((name) => byName.get(name))
}

function createWriter(base = 0) {
  const rows = []
  return {
    rows,
    push(depth, text) { rows.push('  '.repeat(base + depth) + text) },
    /** Raw lines from a nested builder, re-indented to sit at `depth`. */
    merge(depth, lines) { for (const line of lines) rows.push('  '.repeat(base + depth) + line) },
  }
}

/**
 * `<defs>` with content-addressed ids: two nodes with the same gradient share
 * one paint server, which is what keeps a 200-node document readable.
 */
function createDefs() {
  const byKey = new Map()
  const chunks = []
  let seq = 0
  return {
    chunks,
    /**
     * @param {string} prefix  id prefix, also the kind of def
     * @param {string} key     content key; equal keys share one def
     * @param {(id: string) => string[]} make
     * @returns {string} the id to reference
     */
    add(prefix, key, make) {
      const cacheKey = `${prefix}::${key}`
      const hit = byKey.get(cacheKey)
      if (hit !== undefined) return hit
      const id = `${prefix}${++seq}`
      byKey.set(cacheKey, id)
      chunks.push(make(id))
      return id
    },
  }
}

// ——— geometry ———

function normalizeRadii(radii, w, h) {
  if (!Array.isArray(radii) || radii.length !== 4) return ZERO_RADII
  const out = radii.map((corner) => {
    if (!Array.isArray(corner)) return [0, 0]
    return [Math.max(0, finite(corner[0])), Math.max(0, finite(corner[1]))]
  })
  // parseRadii already applied the §5.5 overlap factor, but a document assembled
  // by hand has not, and an over-long arc is invalid path data rather than a
  // rounder corner.
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

/** All four corners identical — `<rect rx ry>` reproduces that exactly, arcs and all. */
function uniformRadii(radii) {
  const [tl, tr, br, bl] = radii
  return tl[0] === tr[0] && tr[0] === br[0] && br[0] === bl[0] &&
    tl[1] === tr[1] && tr[1] === br[1] && br[1] === bl[1]
}

/**
 * Grow (d < 0) or shrink (d > 0) a set of radii by `d`. A square corner stays
 * square when the shape grows: CSS never invents a curve that was not declared.
 */
function offsetRadii(radii, d) {
  if (!d) return radii
  return radii.map(([rx, ry]) => (d > 0
    ? [Math.max(0, rx - d), Math.max(0, ry - d)]
    : [rx > 0 ? rx - d : 0, ry > 0 ? ry - d : 0]))
}

/**
 * A rounded rectangle with four independent `[rx, ry]` corners, as elliptical
 * arcs. Sweep 1 is clockwise in SVG's y-down space, which is the direction the
 * corners are listed in (tl -> tr -> br -> bl).
 */
function roundRectPath(x, y, w, h, radii) {
  const [tl, tr, br, bl] = radii
  const x2 = x + w
  const y2 = y + h
  const d = [`M${num(x + tl[0])} ${num(y)}`]
  d.push(`H${num(x2 - tr[0])}`)
  if (tr[0] > 0 && tr[1] > 0) d.push(`A${num(tr[0])} ${num(tr[1])} 0 0 1 ${num(x2)} ${num(y + tr[1])}`)
  d.push(`V${num(y2 - br[1])}`)
  if (br[0] > 0 && br[1] > 0) d.push(`A${num(br[0])} ${num(br[1])} 0 0 1 ${num(x2 - br[0])} ${num(y2)}`)
  d.push(`H${num(x + bl[0])}`)
  if (bl[0] > 0 && bl[1] > 0) d.push(`A${num(bl[0])} ${num(bl[1])} 0 0 1 ${num(x)} ${num(y2 - bl[1])}`)
  d.push(`V${num(y + tl[1])}`)
  if (tl[0] > 0 && tl[1] > 0) d.push(`A${num(tl[0])} ${num(tl[1])} 0 0 1 ${num(x + tl[0])} ${num(y)}`)
  d.push('Z')
  return d.join(' ')
}

/**
 * The box as one element: `<rect>` when the four corners agree (rx/ry carry an
 * anisotropic corner exactly), a `<path>` of elliptical arcs otherwise.
 */
function shapeElement(box, radii, attrs) {
  const tail = attrs ? ` ${attrs}` : ''
  if (!hasRadius(radii)) {
    return `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}"${tail}/>`
  }
  if (uniformRadii(radii)) {
    const [rx, ry] = radii[0]
    return `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" ` +
      `rx="${num(rx)}" ry="${num(ry)}"${tail}/>`
  }
  return `<path d="${roundRectPath(box.x, box.y, box.w, box.h, radii)}"${tail}/>`
}

const rectOf = (r) => ({ x: finite(r && r.x), y: finite(r && r.y), w: Math.max(0, finite(r && r.w)), h: Math.max(0, finite(r && r.h)) })

const insideBox = (r, box) => r.x >= box.x - 1e-6 && r.y >= box.y - 1e-6 &&
  r.x + r.w <= box.x + box.w + 1e-6 && r.y + r.h <= box.y + box.h + 1e-6

function matrixAttr(m) {
  return `matrix(${m.map((v) => num(v)).join(' ')})`
}

/** The 2x2 linear part of an SVG 2x3, which is all a client rect was distorted by. */
function linearOf(node) {
  const m = isObject(node) && isObject(node.transform) ? node.transform.m : null
  return Array.isArray(m) && m.length === 6 && m.every(isNum) ? [m[0], m[1], m[2], m[3]] : null
}

/** `A · B` for 2x2s in SVG's `[a, b, c, d]` column order. */
function mul2(A, B) {
  return [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
  ]
}

/**
 * Does this matrix leave a client rect meaning what it says? A positive scale
 * does — the rect is the box, just bigger — and `collect/text.js` divides that
 * one out before it reports a line. A rotation, a skew or a mirror does not: the
 * rect is then the axis-aligned bounding box of a quad, and `rect.left` is a
 * corner of the bbox rather than the start of the line. This is `chainScale`'s
 * test (`collect/text.js`), restated, and the two must not drift apart.
 */
function axisAligned(m) {
  return Math.abs(m[1]) <= AXIS_EPS && Math.abs(m[2]) <= AXIS_EPS && m[0] > AXIS_EPS && m[3] > AXIS_EPS
}

/**
 * Undo a rotation/skew that a text measurement was taken THROUGH.
 *
 * `collect/text.js` measures every line with `Range.getClientRects()`, which
 * reports boxes in the space the glyphs are PAINTED in. It divides a pure scale
 * back out; a rotation or a skew it cannot, and says so (`collect.text`, "every
 * client rect is an axis-aligned bounding box"). What it hands over is therefore
 * the bbox of the rotated line, measured from the bbox of the rotated block —
 * and this backend then re-applies the same matrix on the enclosing `<g>`, so
 * the error is applied twice. Measured on `demo/challenges.html` fixture 4: the
 * glyphs of a `rotate(18deg); transform-origin: 0 100%` tile landed 15.5px
 * (~31 device px at 2x) down-right of where the browser paints them.
 *
 * It is recoverable exactly, because an affine map sends the centre of a box to
 * the centre of the box's image:
 *
 *   - the line's bbox centre, in the block's post-matrix space, is
 *     `bboxMin(M · box) + (x + w/2, baseline + (desc - asc)/2)` — the collector
 *     subtracted the block's own bbox origin, so adding it back is exact;
 *   - `M⁻¹` of that point is the line's centre in the block's OWN space;
 *   - the local extent falls out of the two bbox-size identities
 *     `W = |a|·lw + |c|·lh` and `H = |b|·lw + |d|·lh`, two equations in two
 *     unknowns, singular only where `|a||d| = |b||c|` (a 45° rotation).
 *
 * The one thing that stays an assumption is the split of the local height into
 * ascent and descent: `asc` is the font's ascent, unaffected by the matrix, so
 * it is used as-is and clamped to the recovered height.
 *
 * @param {number[]} m       the 2x2 the measurement was taken through
 * @param {{w:number,h:number}} box  the block's own box
 * @param {{x:number,w:number,baseline:number,asc:number,desc:number}} piece
 * @returns {{x:number,w:number,baseline:number}|null} null when `m` is singular
 *   for this inversion, which the caller declares
 */
function unbbox(m, box, piece) {
  const [a, b, c, d] = m
  const det = a * d - b * c
  const size = Math.abs(a) * Math.abs(d) - Math.abs(c) * Math.abs(b)
  if (!(Math.abs(det) > 1e-9) || !(Math.abs(size) > 1e-6)) return null

  const xs = [0, a * box.w, c * box.h, a * box.w + c * box.h]
  const ys = [0, b * box.w, d * box.h, b * box.w + d * box.h]
  const cx = Math.min(...xs) + piece.x + piece.w / 2
  const cy = Math.min(...ys) + piece.baseline + (piece.desc - piece.asc) / 2

  const lx = (d * cx - c * cy) / det
  const ly = (-b * cx + a * cy) / det
  const lw = (Math.abs(d) * piece.w - Math.abs(c) * (piece.asc + piece.desc)) / size
  const lh = (Math.abs(a) * (piece.asc + piece.desc) - Math.abs(b) * piece.w) / size
  if (!(lw >= 0) || !(lh > 0)) return null

  return { x: lx - lw / 2, w: lw, baseline: ly - lh / 2 + Math.min(piece.asc, lh) }
}

// ——— color ———

/**
 * SVG 1.1 has no `rgba()` in `fill=`, and the consumers that matter disagree on
 * whether they accept it — so the channel and the alpha travel separately, in
 * `fill`/`fill-opacity`, which every one of them reads.
 *
 * @param {number[]} rgba
 * @returns {{color: string, alpha: number}}
 */
function splitColor(rgba) {
  const list = Array.isArray(rgba) ? rgba : [0, 0, 0, 1]
  const alpha = isNum(list[3]) ? Math.min(1, Math.max(0, list[3])) : 1
  return { color: toCssString([finite(list[0]), finite(list[1]), finite(list[2]), 1]), alpha }
}

function paintAttrs(rgba, property = 'fill') {
  const { color, alpha } = splitColor(rgba)
  return alpha >= 1
    ? `${property}="${color}"`
    : `${property}="${color}" ${property}-opacity="${num(alpha)}"`
}

/** Debug tints: one hue per stacking-context depth, stable across runs. */
function debugColor(depth) {
  const h = ((depth * 47) % 360) / 360
  const s = 0.62
  const l = 0.55
  const q = l + s * Math.min(l, 1 - l)
  const p = q === 0 ? 0 : 2 * (1 - l / q)
  const channel = (t) => {
    const k = ((t % 1) + 1) % 1
    const v = k < 1 / 6 ? p + (1 - p) * 6 * k
      : k < 1 / 2 ? 1
        : k < 2 / 3 ? p + (1 - p) * (2 / 3 - k) * 6
          : p
    return q * v
  }
  return toCssString([channel(h + 1 / 3), channel(h), channel(h - 1 / 3), 1])
}

// ——— gradients ———

function readPoint(v) {
  if (Array.isArray(v) && isNum(Number(v[0])) && isNum(Number(v[1]))) return [Number(v[0]), Number(v[1])]
  if (isObject(v) && Number.isFinite(Number(v.x)) && Number.isFinite(Number(v.y))) return [Number(v.x), Number(v.y)]
  return null
}

/**
 * `unit.radius` is `[rx, ry]` per the contract. A bare number is the isotropic
 * case written short and means exactly `[r, r]`, so it is accepted without a
 * note; anything else is not geometry.
 */
function readRadius(v) {
  if (Array.isArray(v)) {
    const rx = Number(v[0])
    const ry = Number(v[1])
    if (isNum(rx) && isNum(ry)) return [rx, ry]
    return null
  }
  return isNum(Number(v)) && v !== null && v !== '' ? [Number(v), Number(v)] : null
}

/** `m1 · m2`: the point is transformed by `m2` first, SVG's own reading order. */
function multiply(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
}

/**
 * `stops` normalized to a monotonic 0..1 list. `null` when the paint carries
 * nothing paintable, which the caller turns into a note plus a dropped layer.
 */
function readStops(paint, ctx, nodeId) {
  if (!Array.isArray(paint.stops)) return null
  const out = []
  let prev = 0
  let unplaced = 0
  for (const stop of paint.stops) {
    if (!isObject(stop) || !Array.isArray(stop.color)) continue
    // CONTRACT.md: a stop is `{t, color, srcCss}`. `p` was a rename the
    // orchestrator used to perform and no longer does — and a stop with no
    // readable position collapses onto its predecessor, which turns a ramp into
    // a flat colour. That is exactly the kind of thing this file must not do
    // quietly, so it is counted and declared.
    const t = Number(stop.t)
    if (!Number.isFinite(t)) unplaced++
    const p = Math.min(1, Math.max(prev, Number.isFinite(t) ? t : prev))
    prev = p
    out.push({ p, color: stop.color })
  }
  if (unplaced && ctx) {
    ctx.note(nodeId, `${unplaced} of ${out.length} gradient stops carry no numeric \`t\`; they collapse onto ` +
      'the previous stop, so the ramp is flatter than the source.', 'emit.svg.gradient-stop-unplaced', 'O')
  }
  return out.length >= 2 ? out : null
}

/** Linear sRGB interpolation between stops — the same one every editor does. */
function sampleStops(stops, p) {
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

function stopRows(stops) {
  return stops.map((stop) => {
    const { color, alpha } = splitColor(stop.color)
    const opacity = alpha >= 1 ? '' : ` stop-opacity="${num(alpha)}"`
    return `  <stop offset="${num(stop.p)}" stop-color="${color}"${opacity}/>`
  })
}

/**
 * A linear or radial paint server.
 *
 * The SVD matrix maps the unit square onto the layer's PAINTING BOX, in px. That
 * is a user-space matrix, so the gradient is emitted `userSpaceOnUse` with the
 * box's own origin folded into it. `objectBoundingBox` cannot carry it:
 * in that space one unit is one bbox width, so a translation of 46px reads as 46
 * box-widths and every gradient lands off the shape — which is what it did, and
 * why every gradient came out as the flat colour of whichever stop the clamp
 * reached.
 *
 * @param {{x:number,y:number}} origin  where the painting box sits in the user
 *   space the painted element is in
 * @returns {string|null} `url(#id)`, or null when the paint is not usable
 */
function gradientRef(paint, defs, ctx, nodeId, origin) {
  const stops = readStops(paint, ctx, nodeId)
  if (!stops) {
    ctx.note(nodeId, `a ${paint.type} gradient has fewer than 2 usable stops; the layer is dropped.`,
      'emit.svg.gradient-no-stops', 'O')
    return null
  }
  const raw = Array.isArray(paint.transform) && paint.transform.length === 6 && paint.transform.every(isNum)
    ? paint.transform
    : null
  if (!raw) {
    ctx.note(nodeId, `a ${paint.type} gradient has no usable unit->box matrix; the identity is used instead.`,
      'emit.svg.gradient-no-matrix', 'A')
  }
  const ox = isObject(origin) && isNum(origin.x) ? origin.x : 0
  const oy = isObject(origin) && isNum(origin.y) ? origin.y : 0
  let m = raw
    ? [raw[0], raw[1], raw[2], raw[3], raw[4] + ox, raw[5] + oy]
    : (ox || oy ? [1, 0, 0, 1, ox, oy] : null)
  const unit = isObject(paint.unit) ? paint.unit : {}

  if (paint.type === 'linear') {
    // CONTRACT.md fixes these two keys. Reading anything else back would be the
    // probe list that silently flattened every gradient in the Figma plugin.
    const from = readPoint(unit.p0)
    const to = readPoint(unit.p1)
    if (!from || !to) {
      ctx.note(nodeId, 'a linear gradient carries no unit.p0/unit.p1; the default top-to-bottom axis is used ' +
        'and the gradient direction is lost.', 'emit.svg.gradient-no-axis', 'A')
    }
    const [x1, y1] = from || [0, 0]
    const [x2, y2] = to || [0, 1]
    const key = JSON.stringify([x1, y1, x2, y2, m, stops])
    const id = defs.add('lg', key, (gid) => [
      `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${num(x1)}" y1="${num(y1)}" ` +
      `x2="${num(x2)}" y2="${num(y2)}"${m ? ` gradientTransform="${matrixAttr(m)}"` : ''}>`,
      ...stopRows(stops),
      '</linearGradient>',
    ])
    return `url(#${id})`
  }

  const center = readPoint(unit.center)
  if (!center) {
    ctx.note(nodeId, 'a radial gradient carries no unit.center; the unit square centre is used.',
      'emit.svg.gradient-no-center', 'A')
  }
  const [cx, cy] = center || [0.5, 0.5]
  const radii = readRadius(unit.radius)
  if (!radii) {
    ctx.note(nodeId, 'a radial gradient carries no unit.radius; 0.5 (the inscribed circle) is used.',
      'emit.svg.gradient-no-radius', 'A')
  }
  const [rx, ry] = radii || [0.5, 0.5]
  if (!(rx > 0) || !(ry > 0)) {
    ctx.note(nodeId, 'a radial gradient has a zero radius; it is emitted as the flat colour of its last stop.',
      'emit.svg.gradient-zero-radius', 'A')
    return null
  }
  // `<radialGradient>` has one `r`. An anisotropic unit radius is exact all the
  // same: scaling y about the centre inside the matrix is the same ellipse.
  if (Math.abs(ry - rx) > 1e-9) {
    const k = ry / rx
    const squash = [1, 0, 0, k, 0, cy - k * cy]
    m = m ? multiply(m, squash) : squash
  }
  const key = JSON.stringify([cx, cy, rx, m, stops])
  const id = defs.add('rg', key, (gid) => [
    `<radialGradient id="${gid}" gradientUnits="userSpaceOnUse" cx="${num(cx)}" cy="${num(cy)}" ` +
    `r="${num(rx)}"${m ? ` gradientTransform="${matrixAttr(m)}"` : ''}>`,
    ...stopRows(stops),
    '</radialGradient>',
  ])
  return `url(#${id})`
}

/**
 * A conic gradient as a fan of flat wedges.
 *
 * SVG has no angular paint server and no way to fake one with a radial: a radial
 * paints rings, a conic paints a pinwheel, and calling one an approximation of
 * the other would be a lie in the notes. The fan is geometry, so it is exact
 * except for the quantization of the sweep — 2.8° per wedge, which is below the
 * banding threshold of the source gradient's own resampled stops.
 *
 * The wedges are built in the gradient's own unit space and mapped by the SVD
 * matrix, which already maps that unit square onto the painting box IN PX — so
 * the only thing to compose with it is the box's origin. Scaling by `rect.w/h`
 * first applied the box size twice and blew the fan up by two orders of
 * magnitude; the clip then hid everything but a sliver.
 */
function conicFan(paint, rect, defs, ctx, nodeId) {
  const stops = readStops(paint, ctx, nodeId)
  if (!stops) {
    ctx.note(nodeId, 'an angular gradient has fewer than 2 usable stops; the layer is dropped.',
      'emit.svg.gradient-no-stops', 'O')
    return null
  }
  const unit = isObject(paint.unit) ? paint.unit : {}
  // CONTRACT.md: angular carries `center` and `startAngle` (CW from 12 o'clock),
  // and the rotation lives HERE, never in the matrix — so there is nothing else
  // to look for.
  const center = readPoint(unit.center)
  if (!center) {
    ctx.note(nodeId, 'an angular gradient carries no unit.center; the unit square centre is used.',
      'emit.svg.gradient-no-center', 'A')
  }
  const hasStart = isNum(Number(unit.startAngle)) && unit.startAngle !== null && unit.startAngle !== ''
  if (!hasStart) {
    ctx.note(nodeId, 'an angular gradient carries no unit.startAngle; the sweep starts at 12 o\'clock and ' +
      'its rotation is lost.', 'emit.svg.gradient-no-start-angle', 'A')
  }
  const start = hasStart ? Number(unit.startAngle) : 0
  const m = Array.isArray(paint.transform) && paint.transform.length === 6 && paint.transform.every(isNum)
    ? paint.transform
    : [1, 0, 0, 1, 0, 0]

  ctx.note(nodeId, `conic-gradient has no SVG paint server; it is composed as ${CONIC_WEDGES} flat wedges ` +
    '(the sweep is quantized to 2.8 degrees, the colour within each wedge is its mid-angle sample).',
    'emit.svg.conic-fan', 'A')

  const [cx, cy] = center || [0.5, 0.5]
  const point = (deg) => {
    const rad = (deg * Math.PI) / 180
    // CSS conic angles run clockwise from 12 o'clock; y grows down here, so up is -y.
    return `${num(cx + CONIC_REACH * Math.sin(rad))} ${num(cy - CONIC_REACH * Math.cos(rad))}`
  }
  const wedges = []
  const mean = [0, 0, 0, 0]
  for (let i = 0; i < CONIC_WEDGES; i++) {
    const a = i / CONIC_WEDGES
    const b = (i + 1) / CONIC_WEDGES
    const sample = sampleStops(stops, (a + b) / 2)
    const { color, alpha } = splitColor(sample)
    // Premultiplied, so a transparent stop cannot drag the apex colour toward
    // whatever channel values it happens to carry behind its own zero alpha.
    for (let k = 0; k < 3; k++) mean[k] += finite(sample[k]) * alpha
    mean[3] += alpha
    const opacity = alpha >= 1 ? '' : ` fill-opacity="${num(alpha)}"`
    // Wedges that merely touch leave an antialiasing seam — a white hairline per
    // boundary, 128 of them. Overlapping the next wedge by a fraction of a degree
    // costs nothing (the neighbour's colour is one sample away) and removes them.
    // Every wedge is under 90°, so the large-arc flag is always 0.
    wedges.push(`<path d="M${num(cx)} ${num(cy)} L${point(start + a * 360)} ` +
      `A${CONIC_REACH} ${CONIC_REACH} 0 0 1 ${point(start + b * 360 + CONIC_SEAM)} Z" fill="${color}"${opacity}/>`)
  }

  // The apex cap. Its radius is asked for in painted px and converted to unit
  // space through the matrix's own scale, so it stays ~7px across whatever the
  // box size is; a degenerate matrix simply gets no cap.
  const scale = (Math.hypot(m[0], m[1]) + Math.hypot(m[2], m[3])) / 2
  if (scale > 1e-6) {
    const apex = CONIC_APEX_PX / scale
    const alpha = mean[3] / CONIC_WEDGES
    const rgba = alpha > 1e-6
      ? [mean[0] / mean[3], mean[1] / mean[3], mean[2] / mean[3], alpha]
      : [0, 0, 0, 0]
    if (alpha > 1e-6) {
      const { color, alpha: a } = splitColor(rgba)
      wedges.push(`<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(apex)}" fill="${color}"` +
        `${a >= 1 ? '' : ` fill-opacity="${num(a)}"`}/>`)
      ctx.note(nodeId, `the ${CONIC_WEDGES} wedges cannot cover the point they meet at, so a ` +
        `${num(CONIC_APEX_PX * 2)}px disc of the sweep's mean colour caps the apex; within that disc the ` +
        'angular ramp is flat.', 'emit.svg.conic-apex', 'A')
    }
  }

  const transform = matrixAttr([m[0], m[1], m[2], m[3], m[4] + rect.x, m[5] + rect.y])
  const clipId = defs.add('cp', JSON.stringify(['rect', rect]), (id) => [
    `<clipPath id="${id}" clipPathUnits="userSpaceOnUse">`,
    `  <rect x="${num(rect.x)}" y="${num(rect.y)}" width="${num(rect.w)}" height="${num(rect.h)}"/>`,
    '</clipPath>',
  ])
  return { clipId, transform, wedges }
}

// ——— fills ———

/** Where one background layer paints, in node-local px. */
function layerRect(fill, box) {
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
 * Where a repeating layer's tile lands, one entry per copy, as offsets from the
 * tile's own rect — the tiling UNROLLED instead of declared.
 *
 * SVG's own answer is `<pattern>`, and it is the wrong answer for this product.
 * Figma does not resolve `fill="url(#pattern)"` and drops the node WHOLE — it
 * does not degrade, it disappears (FIGMA_FINDINGS.md §3, measured: a button
 * vanished). Emitting the tile once per position costs nothing but elements,
 * every one of them a shape any importer already understands, and the node
 * survives. That trade only stops being right when the elements themselves are
 * the damage, which is what `TILE_BUDGET` is for; the caller checks `needed`
 * against it and rasterizes instead.
 *
 * Two boundaries are deliberate:
 *  - `TILE_COVER_EPS` — a tile that already covers its box does not repeat at
 *    all (finding §3: the tile and the box come from different code paths and
 *    disagree in the fourth decimal).
 *  - `TILE_SLIVER_PX` — an edge tile with less than half a px inside the box is
 *    dropped, because half a px is the rounding the geometry itself declares.
 *    Without it every rotated node in `fx-grid` unrolls into four copies, three
 *    of them 0.2px hairlines of the wrong end of the gradient.
 *
 * @returns {{offsets: number[][], needed: number, repX: boolean, repY: boolean}|null}
 *   null when the layer does not tile and its content can be painted once, which
 *   includes the case where every repetition but one is a sliver.
 */
function layerTiles(fill, rect, area) {
  const repeat = isObject(fill.placement) && isObject(fill.placement.repeat)
    ? fill.placement.repeat
    : null
  if (!repeat) return null
  const repX = repeat.x === 'repeat' && rect.w > 0 && rect.w < area.w - TILE_COVER_EPS
  const repY = repeat.y === 'repeat' && rect.h > 0 && rect.h < area.h - TILE_COVER_EPS
  if (!repX && !repY) return null

  // Indices of the copies that put any of themselves inside the area. The tile
  // grid is anchored on the rect the layer was placed at and runs BOTH ways:
  // `background-position` can start it past the box's leading edge, and the copy
  // before it is the one that paints there.
  const axis = (grow, start, size, lo, hi) => {
    if (!grow) return [0]
    const first = Math.floor((lo - start) / size)
    const last = Math.ceil((hi - start) / size) - 1
    const keep = []
    const sliver = Math.min(TILE_SLIVER_PX, size / 2)
    for (let i = first; i <= last; i++) {
      const a = start + i * size
      const covered = Math.min(hi, a + size) - Math.max(lo, a)
      if (covered >= sliver) keep.push(i)
    }
    return keep.length ? keep : [Math.floor((lo - start) / size)]
  }
  const cols = axis(repX, rect.x, rect.w, area.x, area.x + area.w)
  const rows = axis(repY, rect.y, rect.h, area.y, area.y + area.h)
  // One copy AT THE RECT is not a tiling — the caller paints its content once
  // and nothing is lost. One copy somewhere ELSE is: a `background-position`
  // that pushes the first tile off the box leaves a single repetition standing
  // in for it, and dropping to the caller would paint it back at the wrong place.
  if (cols.length === 1 && rows.length === 1 && cols[0] === 0 && rows[0] === 0) return null

  const offsets = []
  for (const iy of rows) for (const ix of cols) offsets.push([ix * rect.w, iy * rect.h])
  return { offsets, needed: offsets.length, repX, repY }
}

/** Prose for a diagnostic: which axes a layer repeats on. */
function tileAxes(tiles) {
  return tiles.repX && tiles.repY ? 'in both axes' : tiles.repX ? 'horizontally' : 'vertically'
}

/**
 * The unrolled layer. `content(rect, dx, dy)` builds one copy — placed, or the
 * base copy plus the offset for a caller that would rather translate it than
 * re-place it; `blend` rides on the group, never on the copies.
 *
 * That is not a detail. Inside a `<pattern>` a tile had no backdrop, so the
 * `mix-blend-mode` went on the shape that filled itself WITH the pattern —
 * i.e. on the layer. Unrolled, every copy has a backdrop of its own, and
 * blending each one separately composites the layer against itself a hundred
 * times over. One group, one blend, same picture.
 */
function emitTiled(out, depth, tiles, rect, blend, content) {
  let inner = depth
  if (blend) {
    out.push(depth, `<g${blend}>`)
    inner = depth + 1
  }
  for (const [dx, dy] of tiles.offsets) {
    const lines = content({ x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h }, dx, dy)
    if (lines && lines.length) out.merge(inner, lines)
  }
  if (blend) out.push(depth, '</g>')
}

/**
 * A tiling gradient layer as ONE `<image>` of PNG bytes.
 *
 * The escape hatch above `TILE_BUDGET`, and the only degradation Figma is known
 * to draw: of the five forms in the paste probe (FIGMA_FINDINGS §6) a PNG data
 * URI inside an `<image>` is the one that arrives — the SVG one does not, which
 * is why this encodes pixels and not markup.
 *
 * The canvas is painted tile by tile with the same unit->box matrix
 * `gradientRef` hands the paint server, so the colours are the source's and not
 * a resampling of them. Only the grid stops being editable.
 *
 * The tile is the CLIP, never the filled rectangle. That matrix does not map the
 * unit square onto the tile — for `fx-grid`'s badge it is a 90° rotation, and
 * `linear-gradient(135deg, …)` is a rotation of its own — so filling the unit
 * square paints a rotated square that leaves the tile's corners bare: measured,
 * the first version of this came out as diagonal stripes with a sawtooth top
 * edge. Clipping to the tile and flooding the gradient's own space covers it
 * whatever the matrix does, and flooding is exactly right because both SVG's and
 * canvas's default spread is `pad`.
 *
 * @returns {{lines: string[], scale: number, bytes: number}|null} null when this
 *   document has no canvas to paint on (Node), which the caller declares.
 */
function rasterTiles(fill, rect, area, tiles, ctx, nodeId) {
  if (typeof document === 'undefined' || !document.createElement) return null
  if (!(area.w > 0) || !(area.h > 0)) return null
  if (!readStops(fill, ctx, nodeId)) return null
  // Density is chosen against the file, not assumed. 2x is what a design tool's
  // canvas wants; a dense plaid at 2x is also 4x the PNG, and measured on this
  // fixture that is 233 kB for ONE background layer against 58 kB at 1x — more
  // than the whole unrolling it was meant to be cheaper than. So 2x is attempted
  // and kept only while it fits `TILE_RASTER_BYTES`.
  const dense = paintTiling(fill, rect, area, tiles, TILE_RASTER_SCALE, ctx, nodeId)
  if (!dense) return null
  if (dense.bytes <= TILE_RASTER_BYTES || dense.scale <= 1) return dense
  return paintTiling(fill, rect, area, tiles, 1, ctx, nodeId) || dense
}

/**
 * One pass of `rasterTiles` at one density. Separate because the density is
 * decided by what the pass COSTS, which is not knowable until it has run.
 */
function paintTiling(fill, rect, area, tiles, want, ctx, nodeId) {
  const stops = readStops(fill, ctx, nodeId)
  if (!stops) return null
  const unit = isObject(fill.unit) ? fill.unit : {}
  const raw = Array.isArray(fill.transform) && fill.transform.length === 6 && fill.transform.every(isNum)
    ? fill.transform
    : [1, 0, 0, 1, 0, 0]

  const scale = Math.min(want, TILE_RASTER_MAX_PX / Math.max(area.w, area.h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(area.w * scale))
  canvas.height = Math.max(1, Math.round(area.h * scale))
  const c2d = canvas.getContext('2d')
  if (!c2d) return null

  const ramp = (g) => {
    for (const s of stops) {
      const list = Array.isArray(s.color) ? s.color : [0, 0, 0, 1]
      g.addColorStop(Math.min(1, Math.max(0, s.p)),
        toCssString([finite(list[0]), finite(list[1]), finite(list[2]), isNum(list[3]) ? list[3] : 1]))
    }
    return g
  }

  let painted = 0
  for (const [dx, dy] of tiles.offsets) {
    c2d.save()
    // area px -> canvas px, and the tile is the CLIP in that space.
    c2d.setTransform(scale, 0, 0, scale, -area.x * scale, -area.y * scale)
    c2d.beginPath()
    c2d.rect(rect.x + dx, rect.y + dy, rect.w, rect.h)
    c2d.clip()
    // …then the SVD's unit -> painting-box matrix, the space in which the
    // gradient's own numbers mean what `gradientRef` writes into the paint server.
    c2d.transform(raw[0], raw[1], raw[2], raw[3], raw[4] + rect.x + dx, raw[5] + rect.y + dy)
    if (fill.type === 'radial') {
      const [cx, cy] = readPoint(unit.center) || [0.5, 0.5]
      const [rx, ry] = readRadius(unit.radius) || [0.5, 0.5]
      if (!(rx > 0) || !(ry > 0)) { c2d.restore(); continue }
      // One `r` and an anisotropic radius: squashing y about the centre is the
      // same ellipse, exactly as `gradientRef` folds it into the matrix.
      if (Math.abs(ry - rx) > 1e-9) c2d.transform(1, 0, 0, ry / rx, 0, cy - (ry / rx) * cy)
      c2d.fillStyle = ramp(c2d.createRadialGradient(cx, cy, 0, cx, cy, rx))
    } else {
      const [x1, y1] = readPoint(unit.p0) || [0, 0]
      const [x2, y2] = readPoint(unit.p1) || [0, 1]
      c2d.fillStyle = ramp(c2d.createLinearGradient(x1, y1, x2, y2))
    }
    // The flood, in unit space: the unit square IS the layer's painting box, so
    // 1024 of them past the edge is more than any clip can ask for and still one
    // rectangle the rasterizer trims before it shades a pixel.
    c2d.fillRect(-1024, -1024, 2048, 2048)
    c2d.restore()
    painted++
  }
  if (!painted) return null

  let href = null
  try {
    href = canvas.toDataURL('image/png')
  } catch {
    return null
  }
  if (typeof href !== 'string' || !href.startsWith('data:image/png')) return null
  const lines = [
    `<image x="${num(area.x)}" y="${num(area.y)}" width="${num(area.w)}" height="${num(area.h)}" ` +
    `preserveAspectRatio="none" href="${escAttr(href)}" xlink:href="${escAttr(href)}"/>`,
  ]
  // What it costs the FILE, not what the encoder returned: this emitter writes
  // every href twice (`href` and `xlink:href`, for consumers that only read one),
  // so a 112 kB PNG is 224 kB of document and a budget that measured the encoder
  // would have been wrong by exactly a factor of two.
  return { scale, bytes: lines[0].length, lines }
}

/**
 * The last resort for a tiling layer that is over budget and cannot be
 * rasterized: SVG's own `<pattern>`.
 *
 * It is exact in a browser and it is the one construction that costs a node its
 * EXISTENCE rather than its accuracy in Figma, so nothing reaches it that could
 * have been unrolled or rasterized, and what does reach it says so.
 */
function patternRef(fill, rect, area, defs, content, tiles, ctx, nodeId, why) {
  ctx.note(nodeId, `a background layer tiles ${tileAxes(tiles)} inside its painted box and ${why}, so it stays ` +
    'an SVG <pattern>. The tiling is exact, but an importer that does not resolve fill="url(#pattern)" ' +
    '(Figma) drops the whole node instead of degrading it.',
  'emit.svg.pattern-tiles', 'E')

  // A non-repeating axis gets a tile as tall/wide as the area, with the content
  // placed inside it — the pattern's own overflow clip then does what the
  // background's clip box would have done anyway.
  const tile = {
    x: tiles.repX ? rect.x : area.x,
    y: tiles.repY ? rect.y : area.y,
    w: tiles.repX ? rect.w : area.w,
    h: tiles.repY ? rect.h : area.h,
  }
  const inner = { x: rect.x - tile.x, y: rect.y - tile.y, w: rect.w, h: rect.h }
  const body = content(inner)
  const id = defs.add('pt', JSON.stringify([tile, body]), (pid) => [
    `<pattern id="${pid}" patternUnits="userSpaceOnUse" x="${num(tile.x)}" y="${num(tile.y)}" ` +
    `width="${num(tile.w)}" height="${num(tile.h)}">`,
    ...body.map((line) => `  ${line}`),
    '</pattern>',
  ])
  return `url(#${id})`
}

function assetHref(asset) {
  if (!isObject(asset)) return null
  if (typeof asset.data === 'string' && asset.data) return asset.data
  if (typeof asset.src === 'string' && asset.src) return asset.src
  return null
}

/** An href that hands an SVG to an `<image>` — the one form Figma draws as nothing. */
function isSvgHref(href, asset) {
  if (isObject(asset) && typeof asset.mime === 'string' && /^image\/svg\+xml\b/i.test(asset.mime)) return true
  return /^data:image\/svg\+xml[;,]/i.test(String(href || '')) || /\.svgz?(?:$|[?#])/i.test(String(href || ''))
}

/** The markup an asset carries, in either spelling the format skeleton implies. */
function assetMarkup(asset) {
  if (!isObject(asset)) return null
  if (typeof asset.markup === 'string' && asset.markup.trim()) return asset.markup
  if (isObject(asset.vector) && typeof asset.vector.markup === 'string' && asset.vector.markup.trim()) {
    return asset.vector.markup
  }
  return null
}

/**
 * Passthrough markup, renamespaced for THIS splice of it into the document.
 *
 * The collector namespaces a file's ids once, per asset (`a_bg__t`, `a_bg__g1`):
 * that is what stops two different SVGs from fighting over `#t` and stops either
 * of them from stealing an id the host document declares. It cannot do more,
 * because it runs once per FILE while the emitter may paint that file more than
 * once — `fx-glass` paints the same texture in the card and again inside the
 * copy its own backdrop-filter needs, and image assets are cached by URL, so one
 * icon used twice is one asset used twice. Two copies of one markup in one
 * document means two `id="a_bg__t"`: a browser resolves both references to the
 * first, which is harmless only for as long as the two copies stay identical,
 * and nothing anywhere reports it.
 *
 * The rename is a token substitution because the prefix IS a token: the
 * collector put it in front of every id and, in the same pass, in front of every
 * reference to one — attributes, `url(#…)`, and `<style>` selectors alike. So
 * replacing the token renames the whole instance, with no parser and no regex
 * over markup we did not write.
 *
 * @param {string} markup
 * @param {string} key     what counts as "the same markup": the asset id
 * @param {string|null} prefix  the namespace the collector minted
 */
function markupInstance(markup, key, prefix, ctx, nodeId) {
  const n = (ctx.markupInstances.get(key) || 0) + 1
  ctx.markupInstances.set(key, n)
  if (n === 1) return markup
  if (prefix && markup.includes(prefix)) return markup.split(prefix).join(`${prefix}i${n}_`)
  if (/\sid\s*=\s*["']/.test(markup)) {
    ctx.note(nodeId, `the same passthrough SVG is painted ${n} times in this document and carries no id ` +
      'namespace, so every copy after the first repeats the ids of the first; a reference inside any of them ' +
      'resolves to the first copy.', 'emit.svg.markup-ids-repeated', 'A')
  }
  return markup
}

/**
 * The `preserveAspectRatio` the file's own root asks for, as written — the SVG
 * default when it asks for nothing, since that default is what the browser
 * honoured when it painted the page.
 */
function rootAspectRatio(markup) {
  const tag = /<svg\b[^>]*>/i.exec(markup)
  if (!tag) return 'xMidYMid meet'
  const par = /\bpreserveAspectRatio\s*=\s*(["'])([^"']*)\1/i.exec(tag[0])
  const value = par ? par[2].trim().replace(/\s+/g, ' ') : ''
  if (!value) return 'xMidYMid meet'
  return /^none\b/i.test(value) ? 'none' : value
}

/**
 * A vector layer: the asset's own markup, placed. Never an `<image>`.
 *
 * Measured by pasting into Figma (FIGMA_FINDINGS §6, probe
 * `out/vector/_p-matrix.svg`): an `<image>` whose `href` is an SVG data URI
 * draws NOTHING — no diagnostic, no fallback, a blank node. The same drawing as
 * inline markup lands correctly, both as a nested `<svg>` with its own viewBox
 * (variant C) and scaled by a matrix (variant E). Both are used here, and which
 * one is not a style choice: see the aspect-ratio note in the body.
 *
 * **In the matrix form the offset goes in the MATRIX, never on the markup
 * root.** A background layer routinely paints outside its own node —
 * `background-size: cover` overflows on purpose, and the fixture's header tile
 * starts 99.87px above the box — which is why the `<image>` it replaces carried
 * `y="-99.8667"`. Copying that `y` onto a nested `<svg>` would not move the
 * drawing, it would CUT it: a nested `<svg>` establishes a viewport and clips
 * against it. `emitFills` already wraps a layer that leaves the box in the
 * border-box clip, which is the clip that was meant.
 *
 * @param {object} asset   the vector asset: `w`/`h` are its natural size and the
 *   units its markup's viewport is in
 * @param {string} markup  already renamespaced for this instance
 * @param {{x,y,w,h}} rect where the layer paints, in node-local px
 * @param {string} blend   the `mix-blend-mode` attribute fragment, or empty
 * @returns {string[]|null} the lines to write, or null when the asset cannot be
 *   placed (the caller then falls back and says so)
 */
function vectorTile(asset, markup, rect, blend) {
  const viewBox = Array.isArray(asset.viewBox) && asset.viewBox.length === 4 ? asset.viewBox.map(finite) : null
  const nw = finite(asset.w) > 0 ? finite(asset.w) : (viewBox && viewBox[2] > 0 ? viewBox[2] : 0)
  const nh = finite(asset.h) > 0 ? finite(asset.h) : (viewBox && viewBox[3] > 0 ? viewBox[3] : 0)
  if (!(nw > 0) || !(nh > 0) || !(rect.w > 0) || !(rect.h > 0)) return null

  const sx = rect.w / nw
  const sy = rect.h / nh
  const lines = markup.split(/\r?\n/)

  // A tile whose two axes scale differently is `background-size` stretching the
  // layer — and a stretch is NOT what the browser does to an SVG that kept its
  // own `preserveAspectRatio`: it fits the drawing inside the stretched viewport
  // and leaves the rest empty. Measured, not assumed
  // (`out/vector/_bgsvg-probe.html`): a 900x600 file at `background-size: 100%
  // 100%` in a 300x120 box paints 180x120, centred.
  //
  // So the placement becomes a nested viewport instead of a matrix, and the
  // file's own `preserveAspectRatio` does the fit — which is the construction
  // the paste probe calls C, and the same one `<img>` already lands with. A
  // matrix cannot express this: it has no notion of fitting.
  if (viewBox && Math.abs(sx - sy) > 1e-4 * Math.max(sx, sy)) {
    const par = rootAspectRatio(markup)
    if (par !== 'none') {
      return [
        `<svg x="${num(rect.x)}" y="${num(rect.y)}" width="${num(rect.w)}" height="${num(rect.h)}" ` +
        `viewBox="0 0 ${num(nw)} ${num(nh)}" preserveAspectRatio="${escAttr(par)}" overflow="hidden"${blend}>`,
        ...lines.map((line) => `  ${line}`),
        '</svg>',
      ]
    }
  }

  const identity = Math.abs(sx - 1) < 1e-6 && Math.abs(sy - 1) < 1e-6 &&
    Math.abs(rect.x) < 1e-6 && Math.abs(rect.y) < 1e-6
  if (identity && !blend) return lines
  const transform = identity ? '' : ` transform="matrix(${num(sx)} 0 0 ${num(sy)} ${num(rect.x)} ${num(rect.y)})"`
  return [`<g${transform}${blend}>`, ...lines.map((line) => `  ${line}`), '</g>']
}

/**
 * `object-fit`/`object-position`, as `collectImage` resolved them: `crop` is the
 * source region in the asset's OWN pixels and `transform` maps the unit square
 * onto where that region paints, in node-local px (the content-box inset is
 * already folded in). Both or neither — half of the pair is not a placement.
 *
 * @returns {{m:number[], crop:{x,y,w,h}}|null}
 */
function objectPlacement(fill) {
  const m = Array.isArray(fill.transform) && fill.transform.length === 6 && fill.transform.every(isNum)
    ? fill.transform
    : null
  if (!m || !isObject(fill.crop)) return null
  const crop = rectOf(fill.crop)
  if (!(crop.w > 0) || !(crop.h > 0)) return null
  return { m, crop }
}

/**
 * One fill layer -> one element (or one `<g>`, for a conic fan). Emitted in
 * `fills` order, which is back to front.
 */
function emitLayer(out, depth, fill, box, radii, defs, ctx, nodeId) {
  // A layer alpha is not the node's: `background-color: rgba()` is in the colour,
  // but a replaced element's `opacity` on the fill is its own multiplier and was
  // being dropped on the floor.
  const opacity = isNum(fill.opacity) ? Math.min(1, Math.max(0, fill.opacity)) : 1
  if (opacity >= 1) {
    emitLayerBody(out, depth, fill, box, radii, defs, ctx, nodeId)
    return
  }
  if (opacity <= 0) {
    ctx.note(nodeId, 'a fill layer has opacity 0; it is not emitted.', 'emit.svg.layer-invisible', 'E')
    return
  }
  out.push(depth, `<g opacity="${num(opacity)}">`)
  emitLayerBody(out, depth + 1, fill, box, radii, defs, ctx, nodeId)
  out.push(depth, '</g>')
}

function emitLayerBody(out, depth, fill, box, radii, defs, ctx, nodeId) {
  const blend = typeof fill.blend === 'string' && fill.blend !== 'normal'
    ? ` style="mix-blend-mode:${escAttr(fill.blend)}"`
    : ''
  const rect = layerRect(fill, box)
  const placement = fill.type === 'image' ? objectPlacement(fill) : null

  // A placed image needs no clip box: `collectImage` already intersected the
  // painted region with the content box when it built the crop.
  if (fill.clipBox && fill.clipBox !== 'border' && !placement) {
    // The node carries `radii` and a clip box name, but not the border/padding
    // insets those names refer to — see the contract note in this file's report.
    ctx.note(nodeId, `a fill declares clipBox:"${fill.clipBox}", but the node carries no padding/content ` +
      'inset; the layer is clipped to the border box.', 'emit.svg.clipbox-inset-unknown', 'A')
  }

  if (fill.type === 'solid') {
    out.push(depth, shapeElement(box, radii, `${paintAttrs(fill.color)}${blend}`))
    return
  }

  if (fill.type === 'image') {
    const asset = typeof fill.asset === 'string' && isObject(ctx.doc.assets) ? ctx.doc.assets[fill.asset] : null
    const markup = assetMarkup(asset)

    // An SVG layer is markup, and takes the markup road whether it repeats or
    // not: the same callback builds one copy, and `background-repeat` unrolls it.
    if (markup) {
      const key = String(fill.asset)
      const prefix = asset.idPrefix || null
      const instance = markupInstance(markup, key, prefix, ctx, nodeId)
      const tile = (r) => vectorTile(asset, instance, r, '')
      if (!tile(rect)) {
        ctx.note(nodeId, `vector fill for asset "${String(fill.asset)}" declares no natural size and no viewBox, ` +
          'or lands in an empty rect; the layer is dropped rather than drawn at a size nobody measured.',
        'emit.svg.vector-fill-unplaceable', 'O')
        return
      }
      const tiles = layerTiles(fill, rect, box)
      if (tiles) {
        // Bytes, not just copies: one copy of the markup is the whole file, and
        // 200 of them is 200 files. The budget is checked against what it
        // actually costs before a single one is written.
        const bytes = tiles.needed * markup.length
        if (tiles.needed > TILE_BUDGET || bytes > TILE_BYTES_BUDGET) {
          const why = tiles.needed > TILE_BUDGET
            ? `needs ${tiles.needed} copies of an SVG asset (over ${TILE_BUDGET})`
            : `would repeat ${Math.round(bytes / 1024)} kB of SVG markup (over ${TILE_BYTES_BUDGET / 1024} kB)`
          const pattern = patternRef(fill, rect, box, defs, tile, tiles, ctx, nodeId, why)
          out.push(depth, shapeElement(box, radii, `fill="${pattern}"${blend}`))
          return
        }
        // Every copy needs its OWN id namespace: `markupInstance` renames after
        // the first, and two copies sharing `id="a_bg__t"` means every reference
        // in the second resolves into the first.
        let n = 0
        emitTiled(out, depth, tiles, rect, blend, (r) =>
          vectorTile(asset, n++ === 0 ? instance : markupInstance(markup, key, prefix, ctx, nodeId), r, ''))
        return
      }
      out.merge(depth, vectorTile(asset, instance, rect, blend))
      return
    }

    const href = assetHref(asset)
    if (!href) {
      ctx.note(nodeId, `image fill references asset "${String(fill.asset)}", which carries no data or src; the layer is dropped.`,
        'emit.svg.image-no-data', 'O')
      return
    }
    if (typeof asset.data !== 'string' || !asset.data) {
      ctx.note(nodeId, `image fill for asset "${fill.asset}" points at an external URL; the SVG is not standalone.`,
        'emit.svg.image-external', 'A')
    }
    // Reaching here with an SVG means the collector could not turn it into
    // markup — unreachable bytes, or bytes that did not parse. The `<image>` is
    // the only thing left to emit and it is a known blank in Figma, so it is
    // declared: this used to be the one failure with no diagnostic at all, which
    // is what made it cost a week to find.
    if (isSvgHref(href, asset)) {
      ctx.note(nodeId, `asset "${String(fill.asset)}" is an SVG that could not be inlined as markup, so it stays ` +
        'inside an <image>. Browsers draw it; Figma draws nothing at all for an <image> whose href is an SVG ' +
        '(measured, FIGMA_FINDINGS §6) — the layer will be missing there, not approximated.',
      'emit.svg.image-svg-href', 'A')
    }

    if (placement) {
      // `object-fit`/`object-position` as geometry: a nested viewport whose
      // viewBox IS the crop maps the source region onto the unit square (and
      // clips the rest), and the matrix maps that unit square onto the painted
      // rect. Without this the image was stretched over the whole border box —
      // and `fit:'stretch'` is a KNOWN key, so not one note was emitted.
      const natural = { w: finite(asset.w), h: finite(asset.h) }
      if (natural.w > 0 && natural.h > 0) {
        const { m, crop } = placement
        // A rounded box rounds its replaced content too. The nested viewport
        // below clips the CROP and nothing else, so without this an `<img>` with
        // a border-radius came out with four square corners.
        const rounded = Array.isArray(radii) &&
          radii.some((r) => (Array.isArray(r) ? r.some((v) => v > 0.01) : r > 0.01))
        let inner = depth
        if (rounded) {
          const clipId = defs.add('cp', JSON.stringify(['imgbox', box, radii]), (id) => [
            `<clipPath id="${id}" clipPathUnits="userSpaceOnUse">`,
            `  ${shapeElement(box, radii, '')}`,
            '</clipPath>',
          ])
          out.push(inner, `<g clip-path="url(#${clipId})">`)
          inner += 1
        }
        out.push(inner, `<g transform="${matrixAttr(m)}"${blend}>`)
        out.push(inner + 1, `<svg x="0" y="0" width="1" height="1" overflow="hidden" ` +
          `viewBox="${num(crop.x)} ${num(crop.y)} ${num(crop.w)} ${num(crop.h)}" preserveAspectRatio="none">`)
        out.push(inner + 2, `<image x="0" y="0" width="${num(natural.w)}" height="${num(natural.h)}" ` +
          `preserveAspectRatio="none" href="${escAttr(href)}" xlink:href="${escAttr(href)}"/>`)
        out.push(inner + 1, '</svg>')
        out.push(inner, '</g>')
        if (rounded) out.push(depth, '</g>')
        return
      }
      ctx.note(nodeId, `image fill carries an object-fit crop but asset "${String(fill.asset)}" declares no ` +
        'natural size; the image is stretched over its box instead and the fit is lost.',
        'emit.svg.image-fit-unknown-size', 'A')
    } else if (isObject(fill.crop) || Array.isArray(fill.transform)) {
      ctx.note(nodeId, 'image fill carries half an object-fit placement (crop without matrix or the other way ' +
        'round); it is stretched over its box and the fit is lost.', 'emit.svg.image-fit-partial', 'A')
    }

    const fit = typeof fill.fit === 'string' ? fill.fit : 'stretch'
    const aspect = FIT_ASPECT[fit] || 'none'
    if (!FIT_ASPECT[fit]) {
      ctx.note(nodeId, `image fill has an unknown fit "${fit}"; it is stretched to its box.`,
        'emit.svg.image-fit-unknown', 'A')
    }
    const image = (r) => [
      `<image x="${num(r.x)}" y="${num(r.y)}" width="${num(r.w)}" height="${num(r.h)}" ` +
      `preserveAspectRatio="${aspect}" href="${escAttr(href)}" xlink:href="${escAttr(href)}"/>`,
    ]
    const tiles = layerTiles(fill, rect, box)
    if (tiles) {
      // The href travels with every copy — a data URI is the bytes themselves,
      // and this emitter writes each one twice — so the byte budget bites long
      // before the element budget does here.
      const bytes = tiles.needed * image(rect)[0].length
      if (tiles.needed > TILE_BUDGET || bytes > TILE_BYTES_BUDGET) {
        const why = tiles.needed > TILE_BUDGET
          ? `needs ${tiles.needed} copies of the image (over ${TILE_BUDGET})`
          : `would repeat ${Math.round(bytes / 1024)} kB of image data (over ${TILE_BYTES_BUDGET / 1024} kB)`
        const pattern = patternRef(fill, rect, box, defs, image, tiles, ctx, nodeId, why)
        out.push(depth, shapeElement(box, radii, `fill="${pattern}"${blend}`))
        return
      }
      emitTiled(out, depth, tiles, rect, blend, image)
      return
    }
    out.merge(depth, image(rect).map((line) => (blend ? line.replace('/>', `${blend}/>`) : line)))
    return
  }

  if (fill.type === 'angular') {
    const fan = conicFan(fill, rect, defs, ctx, nodeId)
    if (!fan) return
    // The clip and the transform CANNOT share an element: `transform` establishes
    // the user space its own `clip-path` is then resolved in, so a userSpaceOnUse
    // clip on the same `<g>` gets scaled by the fan matrix (135x here) and lands
    // far outside the shape — the fan disappeared entirely. Outer g clips, inner
    // g transforms.
    out.push(depth, `<g clip-path="url(#${fan.clipId})"${blend}>`)
    out.push(depth + 1, `<g transform="${fan.transform}">`)
    for (const wedge of fan.wedges) out.push(depth + 2, wedge)
    out.push(depth + 1, '</g>')
    out.push(depth, '</g>')
    return
  }

  if (fill.type === 'linear' || fill.type === 'radial') {
    // The paint server is built per PLACEMENT: the matrix carries the origin of
    // the box it paints, so a gradient placed on one rect is wrong on another.
    const tile = (r) => {
      const ref = gradientRef(fill, defs, ctx, nodeId, r)
      return ref
        ? [`<rect x="${num(r.x)}" y="${num(r.y)}" width="${num(r.w)}" height="${num(r.h)}" fill="${ref}"/>`]
        : []
    }
    const tiles = layerTiles(fill, rect, box)
    if (tiles) {
      if (tiles.needed > TILE_BUDGET) {
        // Over budget the picture is worth more than the grid. A gradient can be
        // painted into a canvas from the same numbers the paint server gets, so
        // the layer becomes PNG pixels — the one degraded form Figma draws.
        const raster = rasterTiles(fill, rect, box, tiles, ctx, nodeId)
        if (raster) {
          ctx.note(nodeId, `a gradient background tiles ${tileAxes(tiles)} inside its painted box and needs ` +
            `${tiles.needed} tiles (over ${TILE_BUDGET}); the layer is rasterized to one PNG <image> at ` +
            `${num(raster.scale)}x (${Math.round(raster.bytes / 1024)} kB) instead of unrolled. The colours ` +
            "are the source's; the tiles stop being editable shapes and the layer no longer scales without " +
            'resampling.',
          'emit.svg.tile-raster', 'R')
          out.merge(depth, raster.lines.map((line) => (blend ? line.replace('/>', `${blend}/>`) : line)))
          return
        }
        const pattern = patternRef(fill, rect, box, defs, tile, tiles, ctx, nodeId,
          `needs ${tiles.needed} tiles (over ${TILE_BUDGET}) and could not be rasterized (no canvas here)`)
        out.push(depth, shapeElement(box, radii, `fill="${pattern}"${blend}`))
        return
      }
      // ONE paint server for the whole tiling, and a `translate` per copy.
      // `userSpaceOnUse` resolves in the user space of the element that
      // references it, which a transform on that element establishes — so the
      // shifted rect samples the same ramp shifted with it. Building a gradient
      // per copy is also correct and costs a `<linearGradient>` per tile: at 176
      // tiles that was 72 kB of defs for one background, more than the whole
      // rest of the document.
      const ref = gradientRef(fill, defs, ctx, nodeId, rect)
      if (ref) {
        // The seam overlap is only safe where the tile paints opaquely: it works
        // by letting the neighbour cover it, and a translucent tile does not
        // cover, it composites — the cure would be a darker line in place of the
        // pale one. A ramp with any transparent stop keeps its exact edges.
        const stops = readStops(fill, ctx, nodeId)
        const opaque = !!stops && stops.every((s) => !isNum(s.color && s.color[3]) || s.color[3] >= 1)
        const seam = opaque ? Math.min(TILE_SEAM_PX, rect.w / 2, rect.h / 2) : 0
        const base = `<rect x="${num(rect.x)}" y="${num(rect.y)}" ` +
          `width="${num(rect.w + seam)}" height="${num(rect.h + seam)}" fill="${ref}"`
        emitTiled(out, depth, tiles, rect, blend, (r, dx, dy) =>
          [`${base}${dx || dy ? ` transform="translate(${num(dx)} ${num(dy)})"` : ''}/>`])
        return
      }
    }
    const body = tile(rect)
    if (!body.length) {
      const stops = readStops(fill, ctx, nodeId)
      if (stops) out.push(depth, shapeElement(rect, ZERO_RADII, `${paintAttrs(stops[stops.length - 1].color)}${blend}`))
      return
    }
    out.push(depth, blend ? body[0].replace('/>', `${blend}/>`) : body[0])
    return
  }

  ctx.note(nodeId, `fill type "${String(fill.type)}" is not known to svg-flat; the layer is dropped.`,
    'emit.svg.fill-type-unknown', 'O')
}

function emitFills(out, depth, fills, box, radii, defs, ctx, nodeId) {
  const usable = fills.filter(isObject)
  if (!usable.length) return
  const rounded = hasRadius(radii)
  const nonSolid = usable.some((f) => f.type !== 'solid')
  // A tiling layer is INSIDE its box by definition — its `layerRect` is one tile
  // — and stops being so the moment it is unrolled: the last column and the last
  // row hang over the edge, where the `<pattern>`'s own overflow clip used to cut
  // them. This clip is that clip, and it carries the radii the pattern-filled
  // shape used to carry.
  const overflows = usable.some((f) => !insideBox(layerRect(f, box), box) || layerTiles(f, layerRect(f, box), box))
  const needsClip = (rounded && nonSolid) || overflows
  const isolate = usable.some((f) => typeof f.blend === 'string' && f.blend !== 'normal')

  let inner = depth
  if (needsClip) {
    const clipId = defs.add('cp', JSON.stringify(['box', box, radii]), (id) => [
      `<clipPath id="${id}" clipPathUnits="userSpaceOnUse">`,
      `  ${shapeElement(box, radii, '')}`,
      '</clipPath>',
    ])
    // `isolation:isolate` keeps background-blend-mode inside the layer stack,
    // where CSS puts it — without it the layers blend with the page.
    out.push(depth, `<g clip-path="url(#${clipId})"${isolate ? ' style="isolation:isolate"' : ''}>`)
    inner = depth + 1
  } else if (isolate) {
    out.push(depth, '<g style="isolation:isolate">')
    inner = depth + 1
  }
  for (const fill of usable) emitLayer(out, inner, fill, box, radii, defs, ctx, nodeId)
  if (inner !== depth) out.push(depth, '</g>')
}

// ——— strokes ———

function strokePaintAttrs(stroke, defs, ctx, nodeId) {
  const paint = isObject(stroke.paint) ? stroke.paint : null
  if (!paint) return { attrs: 'stroke="#000000"', ok: false }
  if (paint.type === 'solid') return { attrs: paintAttrs(paint.color, 'stroke'), ok: true }
  if (paint.type === 'linear' || paint.type === 'radial') {
    const ref = gradientRef(paint, defs, ctx, nodeId)
    if (!ref) return { attrs: 'stroke="none"', ok: false }
    // The paint server is in the node's own user space with the box origin at
    // (0,0) — the same space the stroke path is built in — so the gradient covers
    // the border box rather than the inset stroke path.
    ctx.note(nodeId, 'a gradient stroke is mapped onto the node box in user space, not onto the stroke ' +
      'path; a stroke that runs outside that box samples the gradient\'s end stops.',
      'emit.svg.stroke-gradient-box', 'A')
    return { attrs: `stroke="${ref}"`, ok: true }
  }
  if (paint.type === 'angular') {
    const stops = readStops(paint, ctx, nodeId)
    ctx.note(nodeId, 'an angular gradient cannot paint a stroke in SVG; the stroke is emitted as the flat ' +
      'colour of the gradient\'s mid stop.',
      'emit.svg.stroke-angular-flat', 'O')
    return { attrs: paintAttrs(stops ? sampleStops(stops, 0.5) : [0, 0, 0, 1], 'stroke'), ok: !!stops }
  }
  if (paint.type === 'image') {
    ctx.note(nodeId, 'an image stroke has no SVG equivalent; the stroke is dropped.',
      'emit.svg.stroke-image', 'O')
    return { attrs: 'stroke="none"', ok: false }
  }
  return { attrs: 'stroke="none"', ok: false }
}

function dashAttrs(stroke) {
  const out = []
  if (Array.isArray(stroke.dash) && stroke.dash.length && stroke.dash.every((n) => Number.isFinite(Number(n)))) {
    out.push(`stroke-dasharray="${stroke.dash.map((n) => num(n)).join(' ')}"`)
  }
  if (typeof stroke.cap === 'string' && stroke.cap !== 'butt') out.push(`stroke-linecap="${escAttr(stroke.cap)}"`)
  if (typeof stroke.join === 'string' && stroke.join !== 'miter') out.push(`stroke-linejoin="${escAttr(stroke.join)}"`)
  if (Number.isFinite(Number(stroke.miter))) out.push(`stroke-miterlimit="${num(stroke.miter)}"`)
  return out.length ? ` ${out.join(' ')}` : ''
}

/**
 * Per-side weights as four mitered quads. This is exact for square corners —
 * it is the same trapezoid the browser paints — and it is the only way to carry
 * four different weights or four different colours, neither of which a single
 * `stroke-width` can express.
 */
function emitPerSideStroke(out, depth, stroke, weights, box, radii, defs, ctx, nodeId) {
  const [t, r, b, l] = weights
  const rounded = hasRadius(radii)
  if (rounded) {
    ctx.note(nodeId, 'per-side border weights on a rounded box: the sides are emitted as square-mitered quads ' +
      'clipped to the border radius, so the corner arcs thin out where the miter is cut away.',
      'emit.svg.stroke-per-side-miter', 'A')
  }
  const { w, h } = box
  const x0 = box.x
  const y0 = box.y
  const sides = [
    ['top', t, `M${num(x0)} ${num(y0)} L${num(x0 + w)} ${num(y0)} L${num(x0 + w - r)} ${num(y0 + t)} L${num(x0 + l)} ${num(y0 + t)} Z`],
    ['right', r, `M${num(x0 + w)} ${num(y0)} L${num(x0 + w)} ${num(y0 + h)} L${num(x0 + w - r)} ${num(y0 + h - b)} L${num(x0 + w - r)} ${num(y0 + t)} Z`],
    ['bottom', b, `M${num(x0 + w)} ${num(y0 + h)} L${num(x0)} ${num(y0 + h)} L${num(x0 + l)} ${num(y0 + h - b)} L${num(x0 + w - r)} ${num(y0 + h - b)} Z`],
    ['left', l, `M${num(x0)} ${num(y0 + h)} L${num(x0)} ${num(y0)} L${num(x0 + l)} ${num(y0 + t)} L${num(x0 + l)} ${num(y0 + h - b)} Z`],
  ]
  const perSide = Array.isArray(stroke.sides) ? stroke.sides : null
  const fallback = isObject(stroke.paint) && stroke.paint.type === 'solid' ? stroke.paint.color : [0, 0, 0, 1]
  if (Array.isArray(stroke.dash) && stroke.dash.length) {
    ctx.note(nodeId, 'a dashed border with per-side weights is emitted as four solid quads; the dash pattern is lost.',
      'emit.svg.stroke-dash-lost', 'O')
  }
  if (isObject(stroke.paint) && stroke.paint.type !== 'solid') {
    ctx.note(nodeId, `a ${stroke.paint.type} border with per-side weights is emitted as four flat quads.`,
      'emit.svg.stroke-per-side-flat', 'A')
  }
  // A border never paints outside the border box, so the quads are clipped to it
  // — without that, a mitered corner spills past a rounded silhouette.
  let inner = depth
  if (rounded) {
    const clipId = defs.add('cp', JSON.stringify(['box', box, radii]), (id) => [
      `<clipPath id="${id}" clipPathUnits="userSpaceOnUse">`,
      `  ${shapeElement(box, radii, '')}`,
      '</clipPath>',
    ])
    out.push(depth, `<g clip-path="url(#${clipId})">`)
    inner = depth + 1
  }
  sides.forEach(([name, weight, d], i) => {
    if (!(weight > 0)) return
    const own = perSide && isObject(perSide[i]) && Array.isArray(perSide[i].color) ? perSide[i].color : null
    if (own && !(Number(own[3]) > 0)) return
    out.push(inner, `<path d="${d}" ${paintAttrs(own || fallback)} data-side="${name}"/>`)
  })
  if (inner !== depth) out.push(depth, '</g>')
}

function emitStrokes(out, depth, strokes, box, radii, defs, ctx, nodeId) {
  for (const stroke of strokes) {
    if (!isObject(stroke)) continue
    const raw = stroke.weight !== undefined ? stroke.weight : stroke.weights
    const weights = Array.isArray(raw)
      ? [0, 1, 2, 3].map((i) => Math.max(0, finite(raw[i])))
      : [0, 1, 2, 3].map(() => Math.max(0, finite(raw)))
    if (!weights.some((w) => w > 0)) continue

    const base = normalizeRadii(Array.isArray(stroke.radii) ? stroke.radii : radii, box.w, box.h)
    const uniform = weights.every((w) => w === weights[0])
    // Only the sides that actually paint decide whether one stroke can carry them:
    // a hidden side has no colour, and letting it vote turns every partial border
    // into four paths for nothing.
    const visible = Array.isArray(stroke.sides)
      ? stroke.sides.filter((s, i) => isObject(s) && weights[i] > 0 && Array.isArray(s.color))
      : []
    const sameColor = visible.every((s) => s.color.join() === visible[0].color.join())
    if (!uniform || !sameColor) {
      emitPerSideStroke(out, depth, stroke, weights, box, base, defs, ctx, nodeId)
      continue
    }

    const weight = weights[0]
    const align = typeof stroke.align === 'string' ? stroke.align : 'inside'
    const offset = finite(stroke.offset)
    // SVG strokes are always centred, so alignment is emulated by moving the
    // path: half the weight inwards for `inside`, outwards for `outside`.
    const inset = align === 'inside' ? weight / 2 : align === 'outside' ? -(offset + weight / 2) : 0
    const shape = { x: box.x + inset, y: box.y + inset, w: box.w - 2 * inset, h: box.h - 2 * inset }
    if (shape.w <= 0 || shape.h <= 0) {
      ctx.note(nodeId, `a ${num(weight)}px ${align} stroke is wider than its box; it is emitted as a filled shape instead.`,
        'emit.svg.stroke-overflows-box', 'A')
      const { attrs } = strokePaintAttrs(stroke, defs, ctx, nodeId)
      out.push(depth, shapeElement(box, base, attrs.replace(/stroke/g, 'fill')))
      continue
    }
    const { attrs, ok } = strokePaintAttrs(stroke, defs, ctx, nodeId)
    if (!ok) continue
    // `inset` moves the PATH by `offset + weight/2`, but when the stroke brought
    // its own `radii` those are already the offset ones (`collect/box.js` expands
    // an outline's radii by `outline-offset` before handing them over), so growing
    // them by the full inset counted the offset a second time — `fx-ui`'s focus
    // ring came out with rx 14.5 where the browser paints 12.5. Only the trace
    // itself is left to grow by.
    const radialInset = Array.isArray(stroke.radii)
      ? (align === 'inside' ? weight / 2 : align === 'outside' ? -(weight / 2) : 0)
      : inset
    const shapeRadii = normalizeRadii(offsetRadii(base, radialInset), shape.w, shape.h)
    out.push(depth, shapeElement(shape, shapeRadii,
      `fill="none" ${attrs} stroke-width="${num(weight)}"${dashAttrs(stroke)}`))
  }
}

// ——— effects ———

/**
 * Invariant 5, in one place: a shadow's CSS blur RADIUS is twice the Gaussian sigma.
 *
 * This holds for `box-shadow` and `text-shadow`, whose blur-radius CSS defines as
 * twice the standard deviation. It does NOT hold for the other blur in CSS — see
 * `filterSigma`.
 */
const sigma = (blur) => Math.max(0, finite(blur) / 2)

/**
 * The sigma of `filter: blur(L)` / `backdrop-filter: blur(L)`, which is L itself.
 *
 * Filter Effects defines the argument of `blur()` as the standard deviation
 * directly, not as a radius — the opposite of the shadow rule above. This engine
 * used `sigma()` for both and every filter blur came out at HALF its width.
 *
 * Measured in Chromium (2026-08-07), a 100x100 #22d3ee square with `filter:
 * blur(26px)` against the same square under `<feGaussianBlur>`, sampled every 10px
 * along a scanline through the centre:
 *
 *   stdDeviation 13 -> mean |difference| 17.67/255
 *   stdDeviation 26 -> mean |difference|  0.00/255, sample for sample
 *
 * Two independent passes reached the same number from different fixtures.
 */
const filterSigma = (blur) => Math.max(0, finite(blur))

/**
 * How far the filter's output can reach outside its input, in px.
 *
 * `3 * (sigma + |spread|)` bounds BOTH compositions and does not care which one
 * ran: the exact chain reaches `|spread| + 3 sigma` (a dilated shape, then
 * blurred) and a `spreadSigma` radius reaches `3 sigma + 2 spread`. Sizing the
 * region for one of them clips the tail of the other, which is the kind of bug
 * that stays invisible until a shadow ends in a straight line.
 */
function filterBleed(effects) {
  let bleed = 0
  for (const effect of effects) {
    // A layer blur's sigma is its full length, so its tail reaches twice as far as
    // the same number would on a shadow. Sizing the region with the shadow rule
    // clipped every filter blur in a straight line at its old half-width.
    const s = effect.type === 'layerBlur' || effect.type === 'backgroundBlur'
      ? filterSigma(effect.blur)
      : sigma(effect.blur)
    const reach = 3 * (s + Math.abs(finite(effect.spread)))
    const offset = Array.isArray(effect.offset) ? effect.offset : [0, 0]
    bleed = Math.max(bleed,
      Math.abs(finite(offset[0])) + reach,
      Math.abs(finite(offset[1])) + reach)
  }
  return Math.ceil(bleed) + 2
}

function floodAttrs(color) {
  const { color: hex, alpha } = splitColor(color)
  return `flood-color="${hex}" flood-opacity="${num(alpha)}"`
}

/**
 * The blur radius that carries a spread `feDropShadow` cannot.
 *
 * A CSS spread grows (or shrinks) the SHAPE and only then blurs it. No Gaussian
 * reproduces that: blurring leaves the 50% alpha edge exactly on the outline it
 * was handed, wherever sigma goes. What sigma does control is where the shadow
 * stops being VISIBLE — the falloff is spent about 1.5 sigma out, well before
 * the 3 sigma where it is mathematically over — and that visible boundary is
 * what the spread moves. Moving it by `spread` therefore costs `spread / 1.5`
 * of radius: `sigma + 2 * spread / 3`, floored at 0.
 *
 * Measured, not reasoned into place. Mean channel error against the live element
 * (test/verify-vector.mjs, fx-card / fx-ui / fx-z, the three fixtures that carry
 * a negative spread):
 *
 *     exact feMorphology chain   1.616 / 2.713 / 3.483   ← the floor, `exactShadows`
 *     sigma + 2*spread/3         2.399 / 2.912 / 4.740   ← this
 *     sigma + spread             2.554 / 2.959 / 4.880
 *     sigma + spread/3           2.713 / 2.980 / 5.051   ← preserving the 3-sigma tail
 *
 * Looking at them says it more plainly than the numbers do: giving back only a
 * third of the spread leaves a grey halo around every card where the page has a
 * barely visible edge.
 *
 * **This is no longer the default path (2026-08-07).** That table always said the
 * exact chain was the floor, and the gap was accepted to keep the output importable
 * by Figma. Figma has its own channel now, so `exactShadows` defaults ON and this
 * function is what `target: 'figma'` falls back to. Measured over the whole suite,
 * the flip moved 14 of 19 cases down and none up — the largest 4.740 -> 1.670. It
 * costs about 15% more bytes and the `emit.svg.filter-not-imported` declaration.
 *
 * @param {number} blur    the CSS blur radius (invariant 5: sigma is half of it)
 * @param {number} spread  the CSS spread radius, signed
 * @returns {number} stdDeviation for a single `feDropShadow`
 */
function spreadSigma(blur, spread) {
  return Math.max(0, sigma(blur) + spread * 2 / 3)
}

/**
 * The inner-shadow half of a box-shadow filter, which has no primitive in either
 * mode: SVG's answer to "the shape minus its own offset blurred alpha" is a
 * composite chain and there is nothing shorter.
 *
 * @returns {string[]} the `result` name of each inner shadow, in CSS order
 */
function innerShadowChain(body, inners, ctx, nodeId) {
  const results = []
  inners.forEach((e, i) => {
    const offset = Array.isArray(e.offset) ? e.offset : [0, 0]
    const spread = finite(e.spread)
    body.push(`<feOffset in="SourceAlpha" dx="${num(offset[0])}" dy="${num(offset[1])}" result="io${i}"/>`)
    let input = `io${i}`
    if (spread) {
      ctx.note(nodeId, `an inner shadow with ${num(spread)}px spread is emitted with feMorphology; ` +
        'the spread corners are approximated by a rectangular kernel.',
        'emit.svg.shadow-spread-morphology', 'A')
      body.push(`<feMorphology in="io${i}" operator="${spread > 0 ? 'erode' : 'dilate'}" ` +
        `radius="${num(Math.abs(spread))}" result="im${i}"/>`)
      input = `im${i}`
    }
    body.push(`<feGaussianBlur in="${input}" stdDeviation="${num(sigma(e.blur))}" result="ib${i}"/>`)
    // "out" is the whole recipe: the shape MINUS its own offset, blurred alpha
    // is exactly the crescent an inner shadow paints.
    body.push(`<feComposite in="SourceAlpha" in2="ib${i}" operator="out" result="ir${i}"/>`)
    body.push(`<feFlood ${floodAttrs(e.color)} result="ic${i}"/>`)
    body.push(`<feComposite in="ic${i}" in2="ir${i}" operator="in" result="is${i}"/>`)
    results.push(`is${i}`)
  })
  return results
}

/**
 * The filter primitives an importer of Figma's class actually EXECUTES.
 *
 * Measured by pasting, 2026-08-06 (FIGMA_FINDINGS §7, six shapes, one paste, the
 * same drawing in all six). Figma does not run SVG filters: it recognises a
 * filter it can map onto an effect of its own and ignores every other one. A
 * `feDropShadow` maps (§4, measured); a `feGaussianBlur` is its layer blur. A
 * lone `feColorMatrix` — nothing composite around it, one primitive — arrived
 * WITH ITS NODE and with no colour change at all, so the rule is not "no chains":
 * it is this allow-list, and everything outside it is dropped.
 *
 * The unit of that decision is the `<filter>` ELEMENT, not the primitive. A chain
 * that mixes a blur with a colour matrix loses the blur too, which is why every
 * declaration below names the whole filter and not the offending primitive.
 */
const IMPORTED_PRIMITIVES = new Set(['feDropShadow', 'feGaussianBlur'])

/**
 * The half of the story that a reader about to paste needs and that a bare
 * "unsupported" would hide. Two failures have been measured against Figma and
 * they are NOT the same failure:
 *
 *  - a `fill="url(#pattern)"` costs the node its EXISTENCE — nothing arrives, no
 *    rectangle, no placeholder (`emit.svg.pattern-tiles`);
 *  - a filter it cannot map costs the node its EFFECT — the node arrives whole,
 *    with every fill, stroke, glyph and child, and simply lands unfiltered.
 *
 * The second is a degradation and the first is a disappearance. Anyone deciding
 * whether to paste is deciding between "check this panel's colour" and "this
 * element will not be there", so the two never share wording.
 */
const NODE_SURVIVES =
  'What is lost is the EFFECT and not the node: it arrives whole — every fill, stroke, glyph and child ' +
  'of it — and lands unfiltered. That is the opposite of the <pattern> failure, where the node itself ' +
  'never arrives.'

/** Said last, every time, because it is the reason none of this is a bug in the SVG. */
const BROWSER_EXACT = 'In a browser this filter renders exactly what CSS specifies.'

/** The way out, named where the loss is declared and nowhere else. */
const RASTER_FIX =
  'rasterFilters:true rasterizes exactly the nodes whose filter does not survive — and only those — ' +
  'to a PNG <image>, the one degraded form the paste probe proves Figma draws, at the cost of the ' +
  'subtree\'s editability.'

/**
 * Declare a filter the destination will not run.
 *
 * Reads the primitives off the body that is about to be written, so it cannot
 * drift from what is emitted: a new branch in either filter builder is covered
 * the day it is written, without anybody remembering to update a list.
 *
 * @param {string[]} body    the filter body, as lines
 * @param {object} ctx
 * @param {string} nodeId
 * @param {string} what      prose naming the CSS this filter came from
 * @param {string} fix       the option that avoids the loss
 * @returns {string[]} the primitives that will not run; empty when the filter arrives
 */
function declareUnimported(body, ctx, nodeId, what, fix) {
  const kinds = []
  for (const line of body) {
    const m = /^<(fe[A-Za-z]+)\b/.exec(String(line).trim())
    if (m && !kinds.includes(m[1])) kinds.push(m[1])
  }
  const unread = kinds.filter((k) => !IMPORTED_PRIMITIVES.has(k))
  if (!unread.length) return []
  const mapped = kinds.filter((k) => IMPORTED_PRIMITIVES.has(k))

  // The node's own line: which node, which CSS, which primitives. Short on
  // purpose — everything true of the DESTINATION rather than of this element is
  // in the document-level note below, said once.
  ctx.note(nodeId,
    `${what} is emitted as ${kinds.join(' + ')}, of which ` +
    `${mapped.length ? `only the ${mapped.join(' and ')} maps` : 'nothing maps'} onto an effect an importer ` +
    'of Figma\'s class has, so the whole <filter> is dropped there.',
  'emit.svg.filter-not-imported', 'E')

  // The measurement, the reason and the way out: once per document, not once per
  // node. Five table cells with the same inner shadow are five nodes and ONE
  // fact, and `ctx.note` deduplicates on the message, so a null node id is what
  // says "this is about the destination, not about this element". Measured on
  // fx-table, where saying it five times was 8.5 kB of a 40 kB file — a comment
  // block nobody can read is the same silence this one exists to break.
  ctx.note(null,
    'a filter this document emits will not be executed by the destination it is written for. Figma maps ' +
    'feDropShadow and feGaussianBlur onto effects of its own and ignores any filter it cannot map — ' +
    'measured by pasting (2026-08-06, FIGMA_FINDINGS §7): a lone feColorMatrix, with nothing composite ' +
    'around it, arrived WITH ITS NODE and with no colour change at all. That covers the colour functions ' +
    'of filter/backdrop-filter (saturate, brightness, contrast, grayscale, sepia, hue-rotate, invert), ' +
    'which compose into one feColorMatrix, and inner shadows, which have no primitive at all. What gets ' +
    `ignored is the <filter> ELEMENT and not the primitive, so anything else in the same chain — a blur ` +
    `beside a colour matrix — goes with it. ${NODE_SURVIVES} ${BROWSER_EXACT} ${fix}`,
  'emit.svg.filter-not-imported', 'E')

  // A filter carrying a feFlood has been measured landing BOTH ways, and the two
  // are not equally survivable, so neither is presented as the outcome.
  if (kinds.includes('feFlood')) {
    ctx.note(null,
      'one of those filters carries a feFlood, and a flood has been measured landing two different ways: ' +
      'the exact box-shadow chain (FIGMA_FINDINGS §4) arrived as a flat rectangle of the shadow colour — ' +
      'Figma kept the flood and lost the feComposite that cuts it down to the silhouette — while the ' +
      'inner-shadow chain of the six-shape probe arrived with nothing painted at all. Which of the two ' +
      'a given chain gets is not predictable from here, and the rectangle is the worse one: it covers ' +
      'the design instead of leaving it plain.',
    'emit.svg.filter-not-imported', 'E')
  }
  return unread
}

/**
 * Whether a box-shadow lands as something other than plain `feDropShadow`
 * primitives — the one predicate `rasterFilterPlan` and `boxShadowFilter` must
 * agree on, so it is written once and read twice.
 */
function boxShadowIsChained(effects, exactShadows) {
  if (!effects.length) return false
  const drops = effects.filter((e) => e.type === 'dropShadow')
  const inners = effects.filter((e) => e.type === 'innerShadow')
  if (drops.length === 1 && !inners.length && !finite(drops[0].spread)) return false
  return exactShadows ? true : inners.length > 0
}

/** The smallest rect containing all of them. */
function unionRects(rects) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/**
 * The box a node's unimportable filters would have to be rasterized over, in
 * NODE-LOCAL px — or null when every filter it carries arrives intact.
 *
 * Exported because the decision and the rasterization live in different places
 * and must not be two opinions. This backend is synchronous and DOM-free: it can
 * neither paint a pixel nor wait for one. The export that still holds the mounted
 * clone (`index.js`) is the one that can, so it asks THIS function what to
 * rasterize and how big, and leaves the answer on the node; here, presence of
 * that answer is the whole instruction. Nothing re-derives the geometry.
 *
 * The box is the filter REGION, not the border box — `3σ + |offset|` per effect
 * (`filterBleed`, the same margin the `<filter>` gets) — because a shadow whose
 * raster is cropped to the box ends in a straight line. And for a `filter:`
 * chain it is the SUBTREE's extent, since that is what CSS filters.
 *
 * @param {object} node
 * @param {Record<string, object>} nodes  the document's node map, for the subtree extent
 * @param {object} [options]
 * @param {boolean} [options.exactShadows=false]  match the emitter's own option
 * @returns {{box: {x:number,y:number,w:number,h:number}, why: string[]}|null}
 */
export function rasterFilterPlan(node, nodes, { exactShadows = false } = {}) {
  if (!isObject(node)) return null
  const effects = (Array.isArray(node.effects) ? node.effects : []).filter(isObject)
  const boxEffects = effects.filter((e) => (e.type === 'dropShadow' || e.type === 'innerShadow') && e.source !== 'filter')
  const chainEffects = effects.filter((e) => e.type === 'layerBlur' || e.type === 'colorMatrix' ||
    ((e.type === 'dropShadow' || e.type === 'innerShadow') && e.source === 'filter'))
  const frame = frameOf(node)
  const boxes = []
  const why = []

  if (chainEffects.some((e) => e.type === 'colorMatrix')) {
    const src = chainEffects.map((e) => e.srcCss).filter(Boolean).join(' ')
    why.push(`the colour functions of a filter chain${src ? ` (${src})` : ''} are a feColorMatrix, which ` +
      'Figma does not map onto an effect of its own')
    const extent = subtreeExtent(node, { nodes: isObject(nodes) ? nodes : {} })
    const bleed = filterBleed(chainEffects)
    boxes.push({ x: extent.x - bleed, y: extent.y - bleed, w: extent.w + 2 * bleed, h: extent.h + 2 * bleed })
  }
  if (boxShadowIsChained(boxEffects, exactShadows)) {
    const inners = boxEffects.filter((e) => e.type === 'innerShadow').length
    why.push(inners
      ? `${inners === 1 ? 'an inner shadow has' : `${inners} inner shadows have`} no SVG primitive, so the ` +
        'box-shadow filter stays a feFlood + feComposite chain Figma will not run'
      : 'the box-shadow is emitted as the exact feMorphology chain (exactShadows), which Figma will not run')
    const bleed = filterBleed(boxEffects)
    boxes.push({ x: -bleed, y: -bleed, w: frame.w + 2 * bleed, h: frame.h + 2 * bleed })
  }
  if (!boxes.length) return null
  return { box: unionRects(boxes), why }
}

/**
 * The PNG a node's unimportable filter was resolved to upstream, or null.
 *
 * The bytes live in `assets` like every other bitmap in the document — one place
 * for one payload — and the node carries the reference and the box.
 */
function readFilterRaster(node, ctx) {
  const raster = isObject(node.filterRaster) ? node.filterRaster : null
  if (!raster) return null
  const assets = isObject(ctx.doc.assets) ? ctx.doc.assets : {}
  const asset = typeof raster.asset === 'string' ? assets[raster.asset] : null
  const href = isObject(asset) ? asset.data : null
  if (typeof href !== 'string' || !href.startsWith('data:image/png')) return null
  const box = isObject(raster.box) ? rectOf(raster.box) : null
  if (!box || !(box.w > 0) || !(box.h > 0)) return null
  return { href, box, scale: finite(raster.scale, 1), why: Array.isArray(raster.why) ? raster.why : [] }
}

/**
 * The box-shadow filter: drop shadows behind the box, inner shadows over it.
 * Applied to the node's OWN paint only — a CSS box-shadow follows the border box,
 * not the silhouette of the descendants, and a filter on the whole group would
 * cast a shadow from every child.
 *
 * Two compositions, and the default is the SHORT one (FIGMA_FINDINGS.md §4).
 * `feMorphology → feGaussianBlur → feOffset → feFlood → feComposite → feMerge`
 * is what a browser paints exactly, but Figma runs part of it: it keeps the
 * flood and loses the `feComposite` that cuts that colour down to the silhouette,
 * so a shadow arrives as a black rectangle over the design. `feDropShadow` is one
 * primitive and arrives intact. `{exactShadows: true}` asks for the chain back,
 * for a caller who would rather be exact in a browser than importable.
 */
function boxShadowFilter(effects, region, defs, ctx, nodeId) {
  const drops = effects.filter((e) => e.type === 'dropShadow')
  const inners = effects.filter((e) => e.type === 'innerShadow')
  const body = []

  // The exact single case the spec has a primitive for, and by far the common one.
  if (drops.length === 1 && !inners.length && !finite(drops[0].spread)) {
    const e = drops[0]
    const offset = Array.isArray(e.offset) ? e.offset : [0, 0]
    body.push(`<feDropShadow dx="${num(offset[0])}" dy="${num(offset[1])}" ` +
      `stdDeviation="${num(sigma(e.blur))}" ${floodAttrs(e.color)}/>`)
  } else if (!ctx.exactShadows) {
    // One primitive per drop shadow, chained: nothing here depends on an importer
    // running a feComposite, and the whole filter is shorter than the exact form
    // it replaces.
    let input = 'SourceGraphic'
    drops.forEach((e, i) => {
      const offset = Array.isArray(e.offset) ? e.offset : [0, 0]
      const spread = finite(e.spread)
      const sd = spread ? spreadSigma(e.blur, spread) : sigma(e.blur)
      if (spread) {
        ctx.note(nodeId, `a drop shadow with ${num(spread)}px spread has no feDropShadow equivalent: the spread is ` +
          `folded into the blur radius (stdDeviation ${num(sigma(e.blur))} -> ${num(sd)}), which keeps the shadow's ` +
          `reach and leaves its edge up to ${num(Math.abs(spread))}px off the silhouette CSS grows. ` +
          'exactShadows:true emits the feMorphology chain instead, which is exact and which Figma cannot read.',
          'emit.svg.shadow-spread-in-blur', 'A')
      }
      if (i > 0) {
        ctx.note(nodeId, `${drops.length} stacked drop shadows are chained feDropShadow primitives, so shadow ` +
          `${i + 1} is cast from the source AND the shadows already under it; where they overlap it reads wider ` +
          'and darker than CSS paints it. exactShadows:true composes each one from the source alone.',
          'emit.svg.shadow-stacked-chain', 'A')
      }
      body.push(`<feDropShadow in="${input}" dx="${num(offset[0])}" dy="${num(offset[1])}" ` +
        `stdDeviation="${num(sd)}" ${floodAttrs(e.color)} result="ds${i}"/>`)
      input = `ds${i}`
    })
    if (inners.length) {
      ctx.note(nodeId, 'an inner shadow is "the shape minus its own offset blurred alpha", which SVG has no ' +
        'primitive for, so it stays a feFlood + feComposite chain even in the short mode, where every other ' +
        'shadow here is one feDropShadow. The chain is exact; what an importer does with it is ' +
        'emit.svg.filter-not-imported.',
      'emit.svg.inner-shadow-chain', 'E')
      const innerResults = innerShadowChain(body, inners, ctx, nodeId)
      // `input` already carries the source over its shadows; CSS paints the
      // first-declared shadow on top, so the inner ones go over it backwards.
      body.push('<feMerge>')
      for (const r of [input, ...innerResults.reverse()]) body.push(`  <feMergeNode in="${r}"/>`)
      body.push('</feMerge>')
    }
  } else {
    const dropResults = exactDropChain(body, drops, ctx, nodeId)
    const innerResults = innerShadowChain(body, inners, ctx, nodeId)
    // CSS paints the first-declared shadow on top, so the merge runs the list
    // backwards under the source and forwards over it.
    const merge = [...dropResults.reverse().map((r) => `<feMergeNode in="${r}"/>`),
      '<feMergeNode in="SourceGraphic"/>',
      ...innerResults.reverse().map((r) => `<feMergeNode in="${r}"/>`)]
    body.push('<feMerge>')
    for (const node of merge) body.push(`  ${node}`)
    body.push('</feMerge>')
  }

  declareUnimported(body, ctx, nodeId,
    `the box-shadow on this node (${drops.length} outer, ${inners.length} inner)`,
    ctx.exactShadows
      ? 'exactShadows:false — the default — emits the outer shadows as feDropShadow primitives, which do ' +
        `arrive${inners.length ? '; an inner shadow has no primitive in either mode' : ''}. ${RASTER_FIX}`
      : RASTER_FIX)

  const key = JSON.stringify([body, region])
  return defs.add('fx', key, (id) => [
    `<filter id="${id}" filterUnits="userSpaceOnUse" x="${num(region.x)}" y="${num(region.y)}" ` +
    `width="${num(region.w)}" height="${num(region.h)}" color-interpolation-filters="sRGB">`,
    ...body.map((line) => `  ${line}`),
    '</filter>',
  ])
}

/**
 * The exact per-shadow chain of the `exactShadows` branch: shape (morphology for
 * spread), blur, offset, flood, composite — one `ds{i}` result per drop shadow.
 * Written once because two filters build it: `boxShadowFilter`, which merges the
 * source in between, and `dropShadowOnlyFilter`, which deliberately does not.
 *
 * @returns {string[]} the `result` name of each drop shadow, in CSS order
 */
function exactDropChain(body, drops, ctx, nodeId) {
  const dropResults = []
  drops.forEach((e, i) => {
    const offset = Array.isArray(e.offset) ? e.offset : [0, 0]
    const spread = finite(e.spread)
    let input = 'SourceAlpha'
    if (spread) {
      // CSS spread grows the SHAPE; feMorphology grows the alpha with a
      // rectangular kernel, which rounds off differently at the corners.
      ctx.note(nodeId, `a drop shadow with ${num(spread)}px spread is emitted with feMorphology; ` +
        'the spread corners are approximated by a rectangular kernel.',
        'emit.svg.shadow-spread-morphology', 'A')
      body.push(`<feMorphology in="SourceAlpha" operator="${spread > 0 ? 'dilate' : 'erode'}" ` +
        `radius="${num(Math.abs(spread))}" result="dm${i}"/>`)
      input = `dm${i}`
    }
    body.push(`<feGaussianBlur in="${input}" stdDeviation="${num(sigma(e.blur))}" result="db${i}"/>`)
    body.push(`<feOffset dx="${num(offset[0])}" dy="${num(offset[1])}" result="do${i}"/>`)
    body.push(`<feFlood ${floodAttrs(e.color)} result="dc${i}"/>`)
    body.push(`<feComposite in="dc${i}" in2="do${i}" operator="in" result="ds${i}"/>`)
    dropResults.push(`ds${i}`)
  })
  return dropResults
}

/**
 * The outer shadows ALONE — no SourceGraphic in the merge — for the node whose
 * own paint has moved inside its overflow-clip group (`blend-backdrop-in-clip`):
 * the shadow paints outside the clip, so it cannot move with the paint, and it
 * is cast here from an opaque copy of the silhouette instead.
 *
 * Two things this chain is MORE exact about than the merged one, both because
 * the silhouette handed to it is opaque where the element's fill may not be:
 * CSS casts a box-shadow as if the border box were opaque (a translucent
 * background does not thin its shadow), and it does not paint the shadow under
 * the box — the closing feComposite `out` excises exactly that region.
 */
function dropShadowOnlyFilter(drops, region, defs, ctx, nodeId) {
  const body = []
  const dropResults = exactDropChain(body, drops, ctx, nodeId)
  body.push('<feMerge result="dsm">')
  for (const r of dropResults.reverse()) body.push(`  <feMergeNode in="${r}"/>`)
  body.push('</feMerge>')
  body.push('<feComposite in="dsm" in2="SourceAlpha" operator="out"/>')
  declareUnimported(body, ctx, nodeId,
    'the box-shadow on this node (cast shadow-only, outside its overflow clip)',
    RASTER_FIX)
  const key = JSON.stringify(['drop-only', body, region])
  return defs.add('fx', key, (id) => [
    `<filter id="${id}" filterUnits="userSpaceOnUse" x="${num(region.x)}" y="${num(region.y)}" ` +
    `width="${num(region.w)}" height="${num(region.h)}" color-interpolation-filters="sRGB">`,
    ...body.map((line) => `  ${line}`),
    '</filter>',
  ])
}

/**
 * The 20 floats of a `colorMatrix` effect, in `feColorMatrix type="matrix"` order
 * (row-major, 4 rows of 5: R, G, B, A), or null when the effect does not carry a
 * usable one. Null is not an internal error — the collector may have a colour
 * function it could compose no matrix for — and the caller declares it.
 *
 * @param {object} effect
 * @returns {number[]|null}
 */
function colorMatrixValues(effect) {
  const values = effect && effect.values
  if (!Array.isArray(values) || values.length !== 20) return null
  return values.every(isNum) ? values : null
}

/**
 * The `filter:` chain, applied to the node AND its descendants — which is what
 * CSS does, and the reason it cannot share a filter with box-shadow.
 */
function layerFilter(effects, region, defs, ctx, nodeId) {
  const body = []
  let input = 'SourceGraphic'
  effects.forEach((e, i) => {
    if (e.type === 'layerBlur') {
      body.push(`<feGaussianBlur in="${input}" stdDeviation="${num(filterSigma(e.blur))}" result="lb${i}"/>`)
      input = `lb${i}`
      return
    }
    // The colour half of a filter chain — `saturate()`, `grayscale()`, `sepia()`,
    // `hue-rotate()`, `invert()`, `brightness()`, `contrast()` — composed by the
    // collector into ONE 4x5 matrix and emitted as the one primitive SVG has for
    // it. It chains with the blur in list order, which is CSS's own order, so
    // `blur(14px) saturate(1.8)` blurs first and re-saturates the blurred pixels
    // exactly as the browser does.
    if (e.type === 'colorMatrix') {
      const values = colorMatrixValues(e)
      if (!values) {
        ctx.note(nodeId, `a colorMatrix effect${e.srcCss ? ` (${e.srcCss})` : ''} carries no readable 4x5 ` +
          'matrix (20 finite numbers, feColorMatrix row order); the colour change is dropped and the rest ' +
          'of the chain still runs.',
        'emit.svg.color-matrix-unreadable', 'O')
        return
      }
      body.push(`<feColorMatrix in="${input}" type="matrix" values="${values.map((v) => num(v)).join(' ')}" ` +
        `result="cm${i}"/>`)
      input = `cm${i}`
      // `backdrop: true` means the matrix came from `backdrop-filter`, which
      // filters what is BEHIND the element. snapdom pre-composes that backdrop
      // into a node of its own, so the matrix lands on a subtree that IS the
      // backdrop — but only if this node is that subtree. Say which one it is
      // rather than let a reader assume.
      if (e.backdrop) {
        ctx.note(nodeId, `the colour part of a backdrop-filter (${e.srcCss || 'colour functions'}) is emitted as ` +
          'a feColorMatrix over this node and everything inside it. That is exact when the node is the ' +
          'pre-composed copy of the backdrop (which is what snapdom builds for `backdrop-filter`) and too ' +
          'wide if it is the element itself, where CSS would filter only the pixels behind it.',
        'emit.svg.backdrop-color-matrix', 'A')
      }
      return
    }
    if (e.type === 'dropShadow') {
      const offset = Array.isArray(e.offset) ? e.offset : [0, 0]
      if (finite(e.spread)) {
        ctx.note(nodeId, 'filter: drop-shadow() with a spread is emitted without it; feDropShadow has no spread.',
          'emit.svg.filter-spread-lost', 'O')
      }
      body.push(`<feDropShadow in="${input}" dx="${num(offset[0])}" dy="${num(offset[1])}" ` +
        `stdDeviation="${num(sigma(e.blur))}" ${floodAttrs(e.color)} result="ld${i}"/>`)
      input = `ld${i}`
      return
    }
    ctx.note(nodeId, `effect "${String(e.type)}" has no SVG filter equivalent and is dropped.`,
      'emit.svg.effect-unsupported', 'O')
  })
  if (!body.length) return null

  const src = effects.map((e) => e.srcCss).filter(Boolean).join(' ')
  declareUnimported(body, ctx, nodeId,
    `the CSS filter chain on this node${src ? ` (${src})` : ''}, which applies to it AND to everything ` +
    'inside it', RASTER_FIX)

  const key = JSON.stringify([body, region])
  return defs.add('fx', key, (id) => [
    `<filter id="${id}" filterUnits="userSpaceOnUse" x="${num(region.x)}" y="${num(region.y)}" ` +
    `width="${num(region.w)}" height="${num(region.h)}" color-interpolation-filters="sRGB">`,
    ...body.map((line) => `  ${line}`),
    '</filter>',
  ])
}

// ——— text ———

function stripIllegal(value, ctx, nodeId) {
  const s = String(value)
  const clean = s.replace(ILLEGAL_XML, '').replace(LONE_SURROGATE, '')
  if (clean !== s) {
    ctx.note(nodeId, 'text contained characters XML cannot encode (control codes or lone surrogates); they are removed.',
      'emit.svg.text-illegal-chars', 'O')
  }
  // U+2028 separates visual lines in `characters`; inside a line it would make a
  // consumer break where the measurement says it must not.
  const noSep = clean.replace(LINE_SEPARATOR, ' ')
  if (noSep !== clean) ctx.note(nodeId, 'a text line contained U+2028 inside its own span; it is replaced by a space.',
    'emit.svg.text-line-separator', 'A')
  return noSep
}

/** The family the `@font-face` rule declares, prepended so it wins over the stack. */
function styleFontFamily(style, ctx) {
  const stack = typeof style.stack === 'string' && style.stack ? style.stack : 'sans-serif'
  const embedded = ctx.embeddedFamilies.get(style.font)
  if (!embedded) return stack
  const quoted = /[\s,]/.test(embedded) ? `'${embedded.replace(/'/g, '')}'` : embedded
  return stack.startsWith(quoted) ? stack : `${quoted}, ${stack}`
}

/**
 * Typography for the `<text>` element itself, so the block has an inherited
 * baseline instead of being bare.
 *
 * Verified in Figma: an importer builds its text node from `<text>` and does NOT
 * look inside for a `<tspan>` that carries the real values. A bare parent means
 * the paste lands at the importer's own default — a 21px bold heading came in
 * small and unweighted even though its tspan said `font-size="21" font-weight="700"`.
 * The tspans keep their own attributes; this is the fallback they override.
 *
 * Deliberately narrower than `textStyleAttrs`: no gradient fills (that would
 * register a second identical `<defs>` entry) and no notes (they would be
 * emitted twice for the same run).
 */
function inheritedTextAttrs(style, ctx) {
  const attrs = [
    `font-family="${escAttr(styleFontFamily(style, ctx))}"`,
    `font-size="${num(style.size, 16)}"`,
  ]
  if (Number.isFinite(Number(style.weight)) && Number(style.weight) !== 400) {
    attrs.push(`font-weight="${num(style.weight)}"`)
  }
  if (style.italic) attrs.push('font-style="italic"')
  if (Number.isFinite(Number(style.letterSpacing)) && Number(style.letterSpacing) !== 0) {
    attrs.push(`letter-spacing="${num(style.letterSpacing)}"`)
  }
  // Small caps inherits, like every other typographic property here: an importer
  // that reads the `<text>` element and not its tspans has to see it too.
  if (typeof style.variant === 'string' && style.variant.split(/\s+/).includes('small-caps')) {
    attrs.push('font-variant="small-caps"')
  }
  const fill = Array.isArray(style.fills) ? style.fills.find(isObject) : null
  if (!fill || fill.type === 'solid') attrs.push(paintAttrs(fill ? fill.color : [0, 0, 0, 1]))
  attrs.push(...textStrokeAttrs(style))
  return attrs
}

/**
 * `-webkit-text-stroke` as an SVG stroke on the glyphs.
 *
 * Both are centred on the outline and both take the full width, so this is exact
 * rather than an approximation — and SVG's default paint order (fill, then
 * stroke) is WebKit's, which is what makes an outlined-and-unfilled heading come
 * out hollow instead of the pale solid block it was. `collect/text.js` reports
 * the pair as `strokeWidth`/`strokeColor` on the run style; a width with no
 * colour is `currentColor` in CSS, which here is the run's own fill.
 *
 * `reset` is what keeps it from spreading: the `<text>` element carries the
 * DOMINANT run's typography so an importer that reads only the parent gets the
 * real one (FIGMA_FINDINGS.md §1), and `stroke` inherits — so when the dominant
 * run is outlined, every run that is not has to say `stroke="none"` or it comes
 * out outlined too.
 *
 * @returns {string[]} rendered attributes, empty when the run carries no stroke
 */
function textStrokeAttrs(style, reset = false) {
  const width = Number(style.strokeWidth)
  if (!Number.isFinite(width) || width <= 0) return reset ? ['stroke="none"'] : []
  const own = Array.isArray(style.strokeColor) ? style.strokeColor : null
  const fill = Array.isArray(style.fills) ? style.fills.find(isObject) : null
  const color = own || (fill && fill.type === 'solid' && Array.isArray(fill.color) ? fill.color : [0, 0, 0, 1])
  const { color: hex, alpha } = splitColor(color)
  const attrs = [`stroke="${hex}"`, `stroke-width="${num(width)}"`]
  if (alpha < 1) attrs.push(`stroke-opacity="${num(alpha)}"`)
  return attrs
}

/** The style covering the most characters — what the block reads as. */
function dominantStyle(runs, styles) {
  const covered = new Map()
  for (const run of runs) {
    const id = run.style
    if (typeof id !== 'string' || !isObject(styles[id])) continue
    const from = Number.isInteger(run.start) ? run.start : 0
    const to = Number.isInteger(run.end) ? run.end : 0
    if (to > from) covered.set(id, (covered.get(id) || 0) + (to - from))
  }
  let best = null
  let bestSpan = 0
  for (const [id, span] of covered) if (span > bestSpan) { best = id; bestSpan = span }
  return best ? styles[best] : null
}

/**
 * Everything one run's style says, as separate attributes.
 *
 * A LIST, not a string: with one `<text>` per line these have to be merged with
 * the block's inherited typography (`mergeAttrs`), and a pre-joined string can
 * only be concatenated — which is how the same attribute ends up on an element
 * twice and the document stops parsing.
 *
 * @returns {string[]} rendered `name="value"` attributes
 */
function textStyleAttrs(style, ctx, nodeId, defs, { drawnDecoration = false, resetStroke = false, resetVariant = false, inheritedVariant = '' } = {}) {
  const attrs = [`font-family="${escAttr(styleFontFamily(style, ctx))}"`, `font-size="${num(style.size, 16)}"`]
  if (Number.isFinite(Number(style.weight)) && Number(style.weight) !== 400) attrs.push(`font-weight="${num(style.weight)}"`)
  if (style.italic) attrs.push('font-style="italic"')
  if (Number.isFinite(Number(style.letterSpacing)) && Number(style.letterSpacing) !== 0) {
    attrs.push(`letter-spacing="${num(style.letterSpacing)}"`)
  }
  if (Number.isFinite(Number(style.wordSpacing)) && Number(style.wordSpacing) !== 0) {
    attrs.push(`word-spacing="${num(style.wordSpacing)}"`)
  }
  // Small caps. `collect/text.js` reads `fontVariantCaps` and folds it back into
  // `variant`, which is the only way to see it — `font-variant` serialises
  // without the caps value the moment any other longhand is set. It reached the
  // document and stopped there: the glyphs came out full lower case with the
  // ADVANCES of small capitals, so the line was both the wrong shape and the
  // wrong width. `font-variant` is an SVG 1.1 presentation attribute, so the
  // ordinary value travels as one; `all-small-caps` and the petite/unicase
  // family have no attribute form and go through CSS.
  // `style.variant` is the whole `font-variant` shorthand, so it can hold caps
  // AND numeric AND ligature values at once (`lining-nums tabular-nums`). Only
  // `normal` and `small-caps` fit the SVG presentation attribute; everything else
  // is CSS. Both go out — the attribute for the renderers that read only SVG 1.1,
  // the property for the rest — and the part no attribute can carry is declared.
  const variant = typeof style.variant === 'string' ? style.variant.trim() : ''
  const capsToken = variant.split(/\s+/).find((t) => CAPS_VARIANTS.has(t)) || ''
  // `font-variant` inherits, so a run WITHOUT small caps inside a block whose
  // dominant run has them has to say so — the same trap `resetStroke` exists for.
  if (resetVariant && capsToken !== 'small-caps') attrs.push('font-variant="normal"')
  if (capsToken === 'small-caps') attrs.push('font-variant="small-caps"')
  const fill = Array.isArray(style.fills) ? style.fills.find(isObject) : null
  if (!fill || fill.type === 'solid') {
    attrs.push(paintAttrs(fill ? fill.color : [0, 0, 0, 1]))
  } else if (fill.type === 'linear' || fill.type === 'radial') {
    const ref = gradientRef(fill, defs, ctx, nodeId)
    ctx.note(nodeId, 'a gradient text fill is mapped onto the text node\'s box in user space, not onto the ' +
      'glyph bounding box the CSS measured it against.',
      'emit.svg.text-gradient-box', 'A')
    attrs.push(ref ? `fill="${ref}"` : 'fill="#000000"')
  } else {
    ctx.note(nodeId, `a ${String(fill.type)} text fill has no SVG equivalent; the text is painted flat black.`,
      'emit.svg.text-fill-unsupported', 'O')
    attrs.push('fill="#000000"')
  }
  attrs.push(...textStrokeAttrs(style, resetStroke))
  const css = []
  // `drawnDecoration`: the caller is painting this run's decoration as its own
  // path, so the presentation attribute has to go — emitting both draws it twice.
  const decoration = drawnDecoration ? null : readDecoration(style, ctx, nodeId)
  if (decoration) {
    // The presentation attribute is what SVG 1.1 renderers read; the three
    // longhands are CSS and are the only way to carry colour/thickness/style,
    // which is why they ride in `style` next to it.
    attrs.push(`text-decoration="${escAttr(decoration.line)}"`)
    // A CSS longhand takes a full colour, alpha and all — no split needed here.
    if (decoration.color) css.push(`text-decoration-color:${toCssString(decoration.color)}`)
    if (decoration.thickness !== null) css.push(`text-decoration-thickness:${num(decoration.thickness)}px`)
    if (decoration.offset !== null) css.push(`text-underline-offset:${num(decoration.offset)}px`)
    // `solid` is the initial value; writing it out would only be noise.
    if (decoration.style && !PLAIN_DECORATION_STYLES.has(decoration.style)) {
      css.push(`text-decoration-style:${decoration.style}`)
    }
  }
  // `features` is the computed CSS string (`normal`, `"tnum" 1`), never an array —
  // the old `Array.isArray` guard meant tabular figures and every other feature
  // were dropped without a word.
  const features = typeof style.features === 'string' ? style.features.trim()
    : Array.isArray(style.features) ? style.features.map((f) => String(f)).join(', ')
      : ''
  if (features && features !== 'normal') {
    css.push(`font-feature-settings:${features}`)
    ctx.note(nodeId, `a text run asks for font-feature-settings: ${features}; it is emitted as CSS, which a ` +
      'plain SVG 1.1 renderer ignores (the glyph advances were measured WITH the feature on).',
      'emit.svg.font-features', 'A')
  }
  // It inherits, so a run whose variant is the block's says nothing: writing
  // `font-variant:lining-nums tabular-nums` on all 240 tspans of a table cost
  // 7.1 kB — 24% of the file — to repeat what the `<text>` already said.
  if (variant && variant !== 'normal' && variant !== 'small-caps' && variant !== inheritedVariant) {
    css.push(`font-variant:${variant}`)
    if (capsToken !== variant) {
      ctx.note(nodeId, `a text run asks for font-variant: ${variant}. SVG's font-variant presentation ` +
        `attribute takes only normal or small-caps, so ${capsToken ? `"${capsToken}" travels as the ` +
        'attribute and the whole shorthand also' : 'the whole shorthand'} travels as CSS — a plain SVG 1.1 ` +
        'renderer ignores the CSS half and lays those glyphs out with default figures and default casing, ' +
        'at the advances the requested ones were measured at.', 'emit.svg.text-variant', 'A')
    }
  }
  const variations = typeof style.variations === 'string' ? style.variations.trim() : ''
  if (variations && variations !== 'normal') {
    css.push(`font-variation-settings:${variations}`)
    ctx.note(nodeId, `a text run asks for font-variation-settings: ${variations}; it is emitted as CSS, which a ` +
      'plain SVG 1.1 renderer ignores (the glyph advances were measured on the varied instance).',
      'emit.svg.font-variations', 'A')
  }
  // One `style` attribute or none: two would not be well-formed XML.
  if (css.length) attrs.push(`style="${escAttr(css.join(';'))}"`)
  return attrs
}

/**
 * `text-decoration` PROPAGATES rather than inherits, so `collect/text.js` hands
 * over a LIST — one entry per ancestor that draws, each with its own colour and
 * thickness. SVG has one decoration per element, so the innermost one wins and
 * the rest are declared. Both spellings are accepted: the array field is
 * `decorations`, and `decoration` may still arrive as the same array, as a single
 * object, or as the bare line string a hand-written document would use.
 *
 * `quiet` reads the same list without narrating it: the wavy painter has to ASK
 * what a run's decoration is before it can decide whether to draw it, and the
 * question must not produce the very note the answer may make untrue.
 *
 * @returns {{line:string, color:number[]|null, thickness:number|null, style:string}|null}
 */
function readDecoration(style, ctx, nodeId, quiet = false) {
  const raw = Array.isArray(style.decorations) ? style.decorations
    : Array.isArray(style.decoration) ? style.decoration
      : style.decoration === null || style.decoration === undefined ? []
        : [style.decoration]
  const drawn = raw
    .map((d) => (typeof d === 'string' ? { line: d } : d))
    .filter((d) => isObject(d) && typeof d.line === 'string' && d.line && d.line !== 'none')
  if (!drawn.length) return null
  const first = drawn[0]
  if (drawn.length > 1 && !quiet) {
    const dropped = drawn.slice(1).map((d) => d.line).join(', ')
    ctx.note(nodeId, `${drawn.length} text-decorations propagate onto one run (${drawn.map((d) => d.line).join(', ')}); ` +
      `SVG carries one, so "${first.line}" is emitted and ${dropped} ${drawn.length > 2 ? 'are' : 'is'} dropped.`,
      'emit.svg.text-decoration-collapsed', 'A')
  }
  const style_ = typeof first.style === 'string' ? first.style : ''
  if (style_ && !PLAIN_DECORATION_STYLES.has(style_) && !quiet) {
    ctx.note(nodeId, `a text-decoration is "${style_}"; SVG 1.1 has no decoration style, so a renderer that ` +
      'ignores the CSS longhand draws it solid.', 'emit.svg.text-decoration-style', 'A')
  }
  return {
    line: first.line,
    color: Array.isArray(first.color) ? first.color : null,
    thickness: Number.isFinite(Number(first.thickness)) && first.thickness !== null ? Number(first.thickness) : null,
    offset: Number.isFinite(Number(first.offset)) && first.offset !== null ? Number(first.offset) : null,
    style: style_ && style_ !== 'initial' ? style_ : '',
  }
}

/**
 * Where a half-period of the wave reaches the abscissa `x`.
 *
 * The half-period's x control points sit at 0, ½, ½, 1 of its span, so
 * `x(t) = 1.5t - 1.5t² + t³` — strictly increasing on 0..1 (its derivative
 * `3t² - 3t + 1.5` has no real root), which is what makes a bisection exact
 * enough here and cheaper than the cubic formula.
 *
 * @param {number} x0 the half-period's start
 * @param {number} half its horizontal span
 * @param {number} x the abscissa to solve for, inside `[x0, x0 + half]`
 * @returns {number} the Bézier parameter, 0..1
 */
function wavyT(x0, half, x) {
  if (!(half > 0)) return 1
  const u = Math.min(1, Math.max(0, (x - x0) / half))
  let lo = 0
  let hi = 1
  for (let i = 0; i < 40; i++) {
    const t = (lo + hi) / 2
    if (1.5 * t - 1.5 * t * t + t * t * t < u) lo = t
    else hi = t
  }
  return (lo + hi) / 2
}

/**
 * The head of a cubic, split at `t` by de Casteljau: the same curve up to `t`,
 * expressed as its own cubic. Answers `[c1, c2, end]`; the start is unchanged.
 *
 * @param {number[]} p0 start
 * @param {number[]} p1 first control point
 * @param {number[]} p2 second control point
 * @param {number[]} p3 end
 * @param {number} t split parameter, 0..1
 * @returns {number[][]}
 */
function splitCubicHead(p0, p1, p2, p3, t) {
  const lerp = (a, b) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  const q0 = lerp(p0, p1)
  const q1 = lerp(p1, p2)
  const q2 = lerp(p2, p3)
  const r0 = lerp(q0, q1)
  const r1 = lerp(q1, q2)
  return [q0, r0, lerp(r0, r1)]
}

/**
 * The wave itself: half-period S-curves between alternating peaks.
 *
 * A cubic whose two control points sit above the midpoint of the span, at the
 * two endpoint heights, is the smoothstep — horizontal where it meets each peak,
 * which is what a sine does and what Chromium's own Bézier chain does.
 *
 * The last half-period is SPLIT at `x1` rather than drawn past it and trimmed by
 * a `<clipPath>`. The two are the same ink, and the clip was the difference
 * between this path and the `<text>` it decorates: both sat in the same
 * `<g transform>`, the text landed on its glyphs when pasted into Figma and the
 * wave landed somewhere else entirely — the only thing that told them apart was
 * the `clip-path` attribute and the `clipPathUnits="userSpaceOnUse"` rectangle
 * it named, whose coordinates an importer has to resolve in the user space *in
 * force where the clip is referenced*. Ending the curve exactly where the run
 * ends needs no such agreement: one element, no defs entry, and nothing left to
 * resolve in the wrong space.
 */
function wavyPath(x0, x1, cy, peakToPeak, wavelength) {
  const a = peakToPeak / 2
  const half = wavelength / 2
  let x = x0
  let y = cy - a
  const d = [`M${num(x0)} ${num(y)}`]
  if (!(x1 > x0) || !(half > 0)) return d.join(' ')
  // A wave is at most `2 * span / wavelength` half-periods; the guard is there
  // so a degenerate wavelength cannot spin here forever.
  for (let i = 0; x < x1 && i < 4096; i++) {
    const ny = y > cy ? cy - a : cy + a
    const mid = x + half / 2
    if (x + half <= x1 + 1e-9) {
      d.push(`C${num(mid)} ${num(y)} ${num(mid)} ${num(ny)} ${num(x + half)} ${num(ny)}`)
    } else {
      const [c1, c2, end] = splitCubicHead([x, y], [mid, y], [mid, ny], [x + half, ny],
        wavyT(x, half, x1))
      d.push(`C${num(c1[0])} ${num(c1[1])} ${num(c2[0])} ${num(c2[1])} ${num(end[0])} ${num(end[1])}`)
    }
    x += half
    y = ny
  }
  return d.join(' ')
}

/**
 * `text-decoration-style: wavy` as real geometry.
 *
 * There is no SVG 1.1 attribute for it and the CSS longhand is ignored by every
 * plain SVG renderer, so today's output is a straight line in the text's colour —
 * wrong shape, wrong colour, and (in Figma) a straight line is what gets pasted.
 * The wave is drawn from `WAVY_*`, which are measured Chromium numbers rather
 * than invented ones.
 *
 * What stops it from being exact is one missing INPUT, not a choice: a `Run`
 * carries no `x`/`w`, only character offsets, so a decoration that covers PART
 * of a line has an extent only where `line.spans` reports one for exactly those
 * characters. Where it does not, the `text-decoration` attribute is kept and the
 * reason declared — a squiggle under the wrong words is worse than a straight
 * line under the right ones.
 *
 * The caller draws the returned `d` in the SAME user space as the piece it was
 * measured from, with no clip and no defs entry of its own: `x0`/`x1` are the
 * run's own extent and the path already ends at `x1`.
 *
 * @returns {{d:string, attrs:string, x0:number, x1:number}|null}
 */
function wavyUnderline(decoration, style, piece, ctx, nodeId) {
  if (!decoration || decoration.style !== 'wavy') return null
  if (decoration.line !== 'underline') {
    ctx.note(nodeId, `a "${decoration.line}" is wavy; only a wavy UNDERLINE is drawn as a path (its position ` +
      'below the baseline is the measured one), so this one stays a straight text-decoration.',
      'emit.svg.text-decoration-wavy-line', 'A')
    return null
  }
  let thickness = decoration.thickness
  if (!(thickness > 0)) {
    // `text-decoration-thickness: auto` reaches the document as null. Chromium
    // resolves it near `font-size / 10` snapped down to a half pixel — measured
    // 1.0/1.5/2.0/3.0/4.5 at 12/16/22/30/48px, which is what the wavelength of
    // the probe at each of those sizes says it drew.
    const size = Number(style.size)
    thickness = Math.max(1, Math.floor((Number.isFinite(size) ? size : 16) / 5) / 2)
    ctx.note(nodeId, `a wavy underline resolves text-decoration-thickness: auto, which the document does not ` +
      `carry; ${num(thickness)}px is used (Chromium's own resolution for ${num(style.size, 16)}px type) and the ` +
      'wave is drawn from it.', 'emit.svg.text-decoration-wavy-auto-thickness', 'A')
  }
  const peakToPeak = WAVY_PEAK_TO_PEAK(thickness)
  const wavelength = WAVY_WAVELENGTH(thickness)
  // `text-underline-offset` moves the whole decoration down from where the font
  // asks for it. `WAVY_INK_TOP` is the measured `auto` position, so a declared
  // offset is added to it — measured on `.ty-wavy` (offset 4px), the wave was
  // landing 3px above Chromium's with its horizontal extent already exact.
  const offset = Number.isFinite(decoration.offset) ? decoration.offset : 0
  const cy = piece.baseline + WAVY_INK_TOP + offset + (peakToPeak + thickness) / 2
  const { color, alpha } = splitColor(decoration.color || [0, 0, 0, 1])
  ctx.note(nodeId, `a wavy underline is emitted as a <path>: ${num(wavelength)}px wavelength, ` +
    `${num(peakToPeak)}px peak to peak, ${num(thickness)}px stroke — the geometry Chromium paints for that ` +
    `thickness, measured off its raster. It sits ${num(WAVY_INK_TOP + offset)}px below the baseline: the ` +
    `measured \`auto\` position${offset ? `, plus this run's text-underline-offset of ${num(offset)}px` : ''}. ` +
    'What stays assumed is the PHASE — the wave starts on a crest at the left end of the run, and CSS says ' +
    'nothing about where Chromium starts its own.', 'emit.svg.text-decoration-wavy-path', 'A')
  return {
    d: wavyPath(piece.x, piece.x + piece.w, cy, peakToPeak, wavelength),
    attrs: `fill="none" stroke="${color}"${alpha >= 1 ? '' : ` stroke-opacity="${num(alpha)}"`} ` +
      `stroke-width="${num(thickness)}"`,
  }
}

/**
 * A text block as `<text>` and `<tspan>`: every visual line at the baseline it
 * was measured at, never at a line-height a consumer computed. The measurement
 * happened once, in a browser, and nothing downstream is allowed to disagree
 * with it.
 *
 * WHERE the position is written is finding §2, and it is not free either way.
 * Figma builds its TextNode from the `<text>` element, DISCARDS the `x`/`y` of
 * every `<tspan>` inside it and reflows with its own leading — a three-line
 * paragraph arrived with its lines on top of each other. So a block that
 * occupies more than one positioned piece is emitted as one `<text>` per piece,
 * and a block that fits on one line keeps the single-element form, which is the
 * more editable object and has nothing to reflow. `textPerLine` moves the line
 * between those two ('auto' | 'always' | 'never').
 *
 * `textLength` + `lengthAdjust="spacingAndGlyphs"` pin a piece to its measured
 * width, and are emitted only when the font that measured it travels in the
 * file. Without it they do not protect the layout, they distort it.
 */
function emitText(out, depth, node, nodeId, defs, ctx, linear = IDENTITY_LINEAR, override = null) {
  const t = node.text
  if (!isObject(t) || typeof t.characters !== 'string' || !Array.isArray(t.lines) || !t.lines.length) {
    ctx.note(nodeId, 'a text node carries no measured lines; nothing is emitted for it.',
      'emit.svg.text-no-lines', 'O')
    return
  }
  const chars = t.characters
  const styles = isObject(ctx.doc.styles) && isObject(ctx.doc.styles.text) ? ctx.doc.styles.text : {}
  const runs = (Array.isArray(t.runs) ? t.runs : []).filter(isObject)
  if (runs.some((r) => typeof r.href === 'string' && r.href)) {
    ctx.note(nodeId, 'text runs carry links; svg-flat paints glyphs only and the links are not emitted.',
      'emit.svg.text-links-dropped', 'O')
  }

  // A paint that wins over every run's own: `background-clip: text` moves the
  // element's background onto the glyphs, which is the only shape in SVG that
  // both LOOKS right and stays a text object for the importer.
  const paint = override || ctx.textPaint.get(nodeId) || null
  const rangePaint = override ? [] : ctx.textRangePaint.get(nodeId) || []

  // The block's own box, which the reconstruction below measures the line bboxes
  // against. `frame` is the node's box in its emitted parent; the text is drawn
  // in the node's own space, whose origin is that box's corner.
  const frame = frameOf(node)
  const bboxSpace = !axisAligned(linear)

  const rtl = t.direction === 'rtl'
  let head = ['xml:space="preserve"']
  // An rtl line is anchored at its MIDDLE, and that is not a style choice.
  //
  // Measured in Chromium (`text-anchor` × `direction`, one Arabic line, bbox
  // read off `getBBox`): `text-anchor: start` means the RIGHT edge when the
  // direction is rtl and the LEFT edge when it is ltr — the same keyword, two
  // opposite sides. So an anchor pinned to either edge is only correct in a
  // renderer that honours `direction`; one that ignores it (the reported Figma
  // behaviour) puts the whole line one line-width to the wrong side, which is
  // how `demo/challenges.html#fx-type`'s rtl paragraph left its container.
  // `middle` is the one value that names the same point in both, so the line
  // lands in its box either way and the most a bidi-blind importer can get wrong
  // is the order of the glyphs inside it.
  //
  // (`text-anchor="end"` was tried first and is a regression: measured, it moves
  // the line a full width to the RIGHT in Chromium — 269.6..400 becomes
  // 400..530.4 for the same x.)
  if (rtl) head.push('direction="rtl"', 'text-anchor="middle"')
  const dominant = dominantStyle(runs, styles)
  if (dominant) head.push(...inheritedTextAttrs(dominant, ctx))
  else ctx.note(nodeId, 'a text block has no resolvable dominant run style, so its <text> element carries no ' +
    'typography; an importer that reads the parent will fall back to its own default size and family.',
    'emit.svg.text-no-inherited-style', 'A')
  if (paint) head = mergeAttrs(head, paint)
  // The `<text>` element carries the dominant run's stroke, and `stroke`
  // inherits — so every OTHER run has to state that it has none.
  const resetStroke = !!(dominant && textStrokeAttrs(dominant).length)
  const resetVariant = !!(dominant && typeof dominant.variant === 'string' &&
    dominant.variant.split(/\s+/).includes('small-caps'))
  // The dominant run's `font-variant` goes on the `<text>` and inherits from
  // there; every run that agrees with it then writes nothing.
  const inheritedVariant = dominant && typeof dominant.variant === 'string' &&
    dominant.variant.trim() !== 'normal' && dominant.variant.trim() !== 'small-caps'
    ? dominant.variant.trim()
    : ''
  if (inheritedVariant) head = mergeAttrs(head, [`style="font-variant:${escAttr(inheritedVariant)}"`])

  /** How far each line had to be moved back, so the block declares it once. */
  const unbboxed = []

  /**
   * The ink of every piece, unioned, in this block's own space.
   *
   * Only one thing needs it: the shape that carries a gradient through a mask of
   * this text (`paintTextThroughMask`) has to COVER the glyphs, where the rest of
   * this function only has to POSITION them. It is accumulated as the pieces are
   * built rather than re-derived from `t.lines`, because by then a line may have
   * been mapped back out of a bounding box (`unbbox`) or split at a baseline
   * shift, and the box has to be the one the glyphs actually went to.
   */
  const ink = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }

  /** The break hyphens painted back onto their lines, so the block declares it once. */
  const hyphens = []

  /**
   * The measured x and width of characters `[a, b)` of one line, from the
   * `spans` `collect/text.js` reports — the painted extent of each style stretch
   * on that line. Answers null unless the stretches that touch the range tile it
   * exactly: a span that straddles `a` or `b` painted characters outside the
   * range too, and its extent is not this range's.
   *
   * @returns {{x:number, w:number}|null}
   */
  const spanExtent = (line, a, b) => {
    const spans = isObject(line) && Array.isArray(line.spans) ? line.spans.filter(isObject) : null
    if (!spans || !spans.length) return null
    const hit = spans.filter((s) => isNum(s.start) && isNum(s.end) && s.end > s.start &&
      s.start < b && s.end > a)
    if (!hit.length) return null
    hit.sort((p, q) => p.start - q.start)
    if (hit[0].start !== a || hit[hit.length - 1].end !== b) return null
    for (let i = 1; i < hit.length; i++) if (hit[i].start !== hit[i - 1].end) return null
    let left = Infinity
    let right = -Infinity
    for (const s of hit) {
      if (!isNum(s.x) || !isNum(s.w)) return null
      left = Math.min(left, s.x)
      right = Math.max(right, s.x + s.w)
    }
    return right > left ? { x: left, w: right - left } : null
  }

  const styleOf = (segment, opts = {}) => {
    let style = segment.style
    if (!isObject(style)) {
      ctx.note(nodeId, 'a text run has no resolvable style; it is emitted at 16px sans-serif black.',
        'emit.svg.text-style-missing', 'O')
      style = { size: 16, stack: 'sans-serif' }
    }
    let base = textStyleAttrs(style, ctx, nodeId, defs, { ...opts, resetStroke, resetVariant, inheritedVariant })
    const ranged = rangePaint.find((r) => r.from <= segment.from && segment.to <= r.to)
    if (ranged) base = mergeAttrs(base, ranged.attrs)
    return paint ? mergeAttrs(base, paint) : base
  }

  /**
   * The ONE gradient every glyph of this block is painted with, `null` when there
   * is none or when they do not agree.
   *
   * Two paths put a paint server on glyphs and both end as the same attribute:
   * `background-clip: text` resolved onto the whole node (`applyTextClip`, which
   * wins over every run — `mergeAttrs(base, paint)` puts it last), and a run
   * whose own fill is a gradient (`textStyleAttrs`). Only a block painted with
   * ONE of them can go through a mask: the mask is the silhouette of the whole
   * text, so a block where some runs are flat colour would have those runs
   * repainted with the gradient. Mixed keeps the reference form and says why.
   *
   * @returns {string|null} the `url(#…)` the mask has to paint through
   */
  const blockGradient = () => {
    // Off is the DEFAULT branch now, so it cannot be a silent early return: the block
    // still ends up painted by a paint-server reference and that still has a cost at
    // one destination. Declared here, once, only when there is actually a gradient.
    if (!ctx.textGradientMask) {
      const hasGradient = paint
        ? (paint || []).some((a) => a.startsWith('fill="url(#'))
        : rangePaint.some((r) => r.attrs.some((a) => a.startsWith('fill="url(#'))) || runs.some((run) => {
          const style = styles[run.style]
          const fill = isObject(style) && Array.isArray(style.fills) ? style.fills.find(isObject) : null
          return !!fill && (fill.type === 'linear' || fill.type === 'radial')
        })
      if (hasGradient) {
        ctx.note(nodeId, 'this text is painted with a gradient and is emitted as <text fill="url(#…)"> — one ' +
          'editable, selectable, searchable text element, which is plain SVG 1.1 and what every conformant ' +
          'renderer resolves. Measured in Chromium against the <mask> form: pixel-identical. The exception is ' +
          'FIGMA\'s SVG importer, which does not resolve the reference and paints the block BLACK; for that ' +
          'destination use `textGradientMask: true` (the colours, at the cost of the text layer) or the h2d ' +
          'channel, which keeps both. The mask was the default until 2026-08-07 and was flipped because a ' +
          'renderer without <mask> support paints its rect UNMASKED and the text disappears entirely.',
        'emit.svg.text-gradient-fill-ref', 'A')
      }
      return null
    }
    const refIn = (attrs) => {
      const hit = (attrs || []).find((a) => a.startsWith('fill="'))
      const value = hit ? hit.slice(6, -1) : ''
      return value.startsWith('url(#') ? value : null
    }
    if (paint) return refIn(paint)
    const refs = new Set()
    for (const run of runs) {
      const style = styles[run.style]
      const fill = isObject(style) && Array.isArray(style.fills) ? style.fills.find(isObject) : null
      refs.add(fill && (fill.type === 'linear' || fill.type === 'radial')
        ? gradientRef(fill, defs, ctx, nodeId)
        : null)
    }
    if (refs.size === 1) return [...refs][0]
    if ([...refs].some((r) => typeof r === 'string')) {
      ctx.note(nodeId, 'some runs of this text block are painted with a gradient and some are not, so the block ' +
        'cannot go through one glyph mask — the mask is the silhouette of the whole text and would repaint the ' +
        'flat runs with the gradient too. Those runs keep fill="url(#…)", which an importer that does not resolve ' +
        'the reference (Figma) paints BLACK.', 'emit.svg.text-gradient-mask-mixed', 'A')
    }
    return null
  }

  /**
   * Did the font that produced these measurements travel with the file? Only
   * then may a piece be pinned to the width they say.
   */
  const measuredFontTravels = (segments) => segments.every((s) => isObject(s.style) &&
    typeof s.style.font === 'string' && ctx.embeddedFamilies.has(s.style.font))

  /**
   * The runs that touch characters `[from, to)`, clipped to it, in logical order.
   *
   * @returns {{from:number, to:number, style:object|undefined, dy:number}[]}
   */
  const segmentsIn = (from, to) => {
    const segments = []
    for (const run of runs) {
      const rFrom = Math.max(from, Number.isInteger(run.start) ? run.start : 0)
      const rTo = Math.min(to, Number.isInteger(run.end) ? run.end : 0)
      if (rTo > rFrom) segments.push({ from: rFrom, to: rTo, style: styles[run.style], dy: run.dy })
    }
    segments.sort((a, b) => a.from - b.from)
    return segments
  }

  /**
   * One positioned piece of a line: its own `x`, its own measured width, and the
   * runs that fall inside it.
   *
   * `shiftHandled` says the caller has already put every run in this piece on the
   * baseline it asked for — the piece's `baseline` argument carries the shift —
   * so no `dy` is written and none has to be paid back.
   *
   * @returns {{position:string[], length:string[], sole:string[]|null, body:string}|null}
   *   `sole` is the style of the ONE run that covers the whole piece, when there
   *   is one — the piece is then a single element and its attributes can be
   *   merged onto whatever element ends up carrying it.
   */
  const buildPiece = (from, to, x, w, baseline, line, shiftHandled = false) => {
    if (to <= from) return null
    let px = finite(x)
    let width = Math.max(0, finite(w))
    let py = finite(baseline)

    // A rotation or a skew anywhere above this block turned every client rect
    // into the bounding box of a quad before `collect/text.js` ever saw it, and
    // the `<g>` this text sits in is about to apply that same matrix again.
    if (bboxSpace) {
      const back = unbbox(linear, { w: frame.w, h: frame.h },
        { x: px, w: width, baseline: py, asc: finite(line && line.asc), desc: finite(line && line.desc) })
      if (back) {
        unbboxed.push(Math.hypot(back.x - px, back.baseline - py))
        px = back.x
        width = back.w
        py = back.baseline
      } else {
        ctx.note(nodeId, 'a rotation or skew above this block made every measured line the bounding box of a ' +
          'quad, and the matrix cannot be inverted for it (it is singular, or a 45-degree rotation, for which ' +
          'the bbox width and height carry the same information twice). The line is emitted at the bbox ' +
          'coordinates and lands off its glyphs by roughly the line height.',
          'emit.svg.text-unbbox-singular', 'O')
      }
    }

    // The extent this piece paints over, from the metrics the line was measured
    // with. `asc`/`desc` are optional in the schema, so a line without them falls
    // back to the em box, which is wider than the ink and therefore safe for the
    // only consumer of this box (a mask cannot paint outside the glyphs anyway).
    const em = finite(dominant && dominant.size, 16)
    const asc = finite(line && line.asc) || em
    const desc = finite(line && line.desc) || em * 0.5
    ink.x0 = Math.min(ink.x0, px)
    ink.x1 = Math.max(ink.x1, px + width)
    ink.y0 = Math.min(ink.y0, py - asc)
    ink.y1 = Math.max(ink.y1, py + desc)

    // A right-to-left line anchors at its middle (see `text-anchor` above); `x`
    // is the left edge in both directions, so the centre is the same arithmetic.
    const anchorX = rtl ? px + width / 2 : px
    const position = [`x="${num(anchorX)}"`, `y="${num(py)}"`]

    const segments = segmentsIn(from, to)
    if (!segments.length) segments.push({ from, to, style: null, dy: 0 })

    // The measured word anchors falling inside this piece (`line.words`,
    // justified blocks only). A word that starts exactly at `from` is excluded
    // here — the piece's own x already places it — and looked up by start
    // offset below for the chunk boundaries that land ON an anchor.
    const anchors = (!bboxSpace && !rtl && isObject(line) && Array.isArray(line.words))
      ? line.words.filter((wd) => isObject(wd) && isNum(wd.x) &&
        Number.isInteger(wd.start) && wd.start > from && wd.start < to)
      : []
    const wordX = new Map(anchors.map((wd) => [wd.start, wd.x]))

    // `textLength` is a promise the file can only keep with the font that made
    // the promise. Substituted, it is not a fallback but a distortion: the
    // viewer's own advances get scaled into a width they were never going to
    // produce, and the glyphs come out squeezed.
    //
    // A JUSTIFIED line is the exception, and it is one because the promise
    // changes direction: unpinned, the viewer lays the line at its natural
    // advances and the justification is simply gone — every word after the
    // first sits left of where the page painted it, by more the further into
    // the line it is (the ghosting `challenges/fx-type` -> `.ty-just` was built
    // to show). Where the collector measured per-word anchors, each word is
    // simply PLACED where the browser painted it — exact, whatever font renders
    // — and `textLength` is omitted: absolute anchors and a whole-piece length
    // would fight over the same glyphs. Where it could not (a skewed chain,
    // RTL, one-word lines), the line is pinned to its extent with
    // `lengthAdjust="spacing"`: the slack CSS puts into the word gaps is spread
    // over all advances instead, so a word's interior sits off by at most the
    // share of slack one word absorbs — against the whole line's without it.
    // The last line of a block is not justified (CSS) and keeps the rule above.
    const justified = t.align === 'justify' && isObject(line) &&
      Number.isInteger(line.i) && line.i < t.lines.length - 1
    let length = []
    if (anchors.length) {
      ctx.note(nodeId, 'the justified lines of this block carry a measured x for every word (`line.words`), ' +
        'so each word is anchored exactly where the browser painted it instead of approximating the ' +
        'justification by stretching. An importer that ignores the x of an interior tspan (Figma) reflows ' +
        'the line and loses the word gaps — as it already does to every multi-piece block.',
      'emit.svg.text-justified-words', 'E')
    } else if (!width) {
      ctx.note(nodeId, 'a text line carries no measured width; nothing pins its extent and the viewer\'s own ' +
        'glyph advances decide it.', 'emit.svg.text-no-width', 'A')
    } else if (measuredFontTravels(segments)) {
      length = [`textLength="${num(width)}"`, 'lengthAdjust="spacingAndGlyphs"']
    } else if (justified) {
      length = [`textLength="${num(width)}"`, 'lengthAdjust="spacing"']
      ctx.note(nodeId, 'a justified line is pinned to its measured extent with lengthAdjust="spacing" even ' +
        'though no font binary travels: unpinned it would lose the justification entirely and land every ' +
        'word left of where the page painted it. The slack CSS puts into the word gaps is divided between ' +
        'all glyph advances instead (the glyphs themselves are not stretched), so a word\'s interior can sit ' +
        'off by the share of slack one word absorbs — against the whole line\'s slack without the pin.',
      'emit.svg.text-justified-length', 'A')
    } else {
      ctx.note(null, 'no font binary travels with this SVG, so no line carries textLength and every line\'s width ' +
        'is the viewer\'s to decide. Pinning a substituted family to the advances the page\'s font measured does ' +
        'not degrade gracefully — it squeezes the glyphs into the measured width (verified by pasting into Figma), ' +
        'so the measurement is stated by position only.', 'emit.svg.text-length-viewer-width', 'A')
    }

    // `dy` is the measured offset of a raised/lowered run from the line baseline.
    // It shifts the glyphs only, so it can never live on the element that owns
    // the position, and a run that carries one has to be its own tspan.
    const shift = (segment) =>
      (!shiftHandled && isNum(segment.dy) && segment.dy !== 0 ? [`dy="${num(segment.dy)}"`] : [])
    const slice = (a, b) => escText(stripIllegal(chars.slice(a, b), ctx, nodeId))

    // The hyphen the browser painted at a hyphenation break. `hyphens: auto` cuts a
    // word and draws a hyphen that is NOT a character of the document, so
    // `collect/text.js` reports it on `line.hyphen` instead of inventing a character
    // in `characters` — which every offset in `runs`, `lines`, `frags` and `spans`
    // indexes, and which `sourceText` matches one for one. That makes the piece which
    // ENDS the line the one place it can be painted back on, and this is it: `whole`,
    // multi-style, per-fragment and the `dy` split all funnel through here, and the
    // last one of them is the one whose `to` reaches the line's end.
    //
    // Nothing else moves. The advance is already inside the measured `line.w` (and
    // `spans`/`frags`): the browser reports the hyphen as ink of the line it painted
    // it on, so a piece pinned to that width with the hyphen appended is exact and one
    // without it paints a line short of its own ink and a word that reads as misspelt.
    const lineEnd = isObject(line) && Number.isInteger(line.end) ? line.end : null
    const hyphen = (to === lineEnd && isObject(line) && typeof line.hyphen === 'string' && line.hyphen)
      ? escText(stripIllegal(line.hyphen, ctx, nodeId))
      : ''
    if (hyphen) hyphens.push(line.hyphen)

    // A decoration SVG cannot draw is painted as a path. When ONE run covers the
    // whole piece its extent IS the piece's. When it covers only part of one,
    // the extent comes from `line.spans` — the per-stretch rects `collect/text.js`
    // measured and now keeps instead of merging away. Where neither is available
    // the straight `text-decoration` stays and the reason is declared: a squiggle
    // under the wrong words is worse than a straight line under the right ones.
    const whole = segments.length === 1 && segments[0].from === from && segments[0].to === to &&
      !shift(segments[0]).length
    const waves = []
    if (bboxSpace) {
      if (segments.some((s) => isObject(s.style) &&
        (readDecoration(s.style, ctx, nodeId, true) || {}).style === 'wavy')) {
        ctx.note(nodeId, 'a wavy decoration sits inside a rotated or skewed block, whose lines this backend has ' +
          'already had to map back out of their bounding boxes; the wave would be drawn from a reconstruction ' +
          'rather than from a measurement, so it stays a straight text-decoration.',
          'emit.svg.text-decoration-wavy-transformed', 'A')
      }
    } else if (whole && isObject(segments[0].style)) {
      const w0 = wavyUnderline(readDecoration(segments[0].style, ctx, nodeId, true), segments[0].style,
        { x: px, w: width, baseline: py }, ctx, nodeId)
      if (w0) { waves.push(w0); segments[0].drawn = true }
    }
    if (!waves.length && !bboxSpace) {
      for (const s of segments) {
        if (whole && isObject(s.style)) continue    // already declared by `wavyUnderline`
        const d = isObject(s.style) ? readDecoration(s.style, ctx, nodeId, true) : null
        if (!d || d.style !== 'wavy') continue
        const span = shift(s).length ? null : spanExtent(line, s.from, s.to)
        const w1 = span ? wavyUnderline(d, s.style, { x: span.x, w: span.w, baseline: py }, ctx, nodeId) : null
        if (w1) { waves.push(w1); s.drawn = true; continue }
        ctx.note(nodeId, `a wavy ${d.line} covers characters ${s.from}-${s.to} of a line that runs ${from}-${to}, ` +
          'and this document carries no measured extent for exactly those characters (the line reports no ' +
          '`spans`, or the stretch that painted them straddles the run boundary, or the run is raised off the ' +
          'baseline by a `dy`). The straight text-decoration a renderer draws for it is kept instead of a wave ' +
          'guessed at the wrong words.',
          'emit.svg.text-decoration-wavy-no-extent', 'A')
      }
    }

    if (whole) {
      // One style, but the word anchors still split the string: each anchored
      // word becomes a bare `<tspan x="…">` that inherits every attribute from
      // the `<text>` — position is the only thing it adds.
      if (anchors.length) {
        const bounds = [from, ...anchors.map((wd) => wd.start), to]
        let body = slice(bounds[0], bounds[1])
        for (let i = 1; i < bounds.length - 1; i++) {
          body += `<tspan x="${num(anchors[i - 1].x)}">${slice(bounds[i], bounds[i + 1])}` +
            `${i === bounds.length - 2 ? hyphen : ''}</tspan>`
        }
        return {
          position,
          length,
          waves,
          sole: styleOf(segments[0], { drawnDecoration: !!segments[0].drawn }),
          body,
        }
      }
      return {
        position,
        length,
        waves,
        sole: styleOf(segments[0], { drawnDecoration: !!segments[0].drawn }),
        body: slice(from, to) + hyphen,
      }
    }
    // Several styles on one piece: the piece's own element owns the position and
    // the measured length, the inner tspans only the styling.
    //
    // `dy` is reached only when `pushRange` could not measure the pieces to split
    // the line into (see its header) — a raised run whose extent this document
    // does not carry. It is relative and cumulative, so a raised `<sup>` has to be
    // paid back or everything after it keeps climbing. The obvious way to pay it
    // back — an empty `<tspan dy="-6"/>` right after — is the shape Figma throws
    // away: an importer that builds a text node out of the character content drops
    // every tspan with no characters and the compensation goes with it. The debt
    // is folded into the `dy` of the NEXT tspan that carries text instead, which
    // no importer can drop without dropping the text.
    //
    // Word anchors cut across this: a range is split at every anchored word
    // start inside it, the FIRST chunk keeps the range's `dy` (relative and
    // cumulative — repeating it on later chunks would shift them twice; omitted,
    // the shifted baseline simply carries forward), later chunks carry the same
    // style plus their anchor's absolute x. A chunk that BEGINS on an anchor
    // gets the x alongside its own attributes.
    const inner = []
    let cursor = from
    let owed = 0
    const dyAttr = (v) => (Math.abs(v) > 1e-6 ? [`dy="${num(v)}"`] : [])
    const xAttr = (offset) => (wordX.has(offset) ? [`x="${num(wordX.get(offset))}"`] : [])
    const pushChunks = (styleAttrs, dyA, a, b) => {
      const cuts = anchors.filter((wd) => wd.start > a && wd.start < b)
      const bounds = [a, ...cuts.map((wd) => wd.start), b]
      for (let i = 0; i < bounds.length - 1; i++) {
        const attrs = i === 0
          ? [...styleAttrs, ...dyA, ...xAttr(a)]
          : [...styleAttrs, `x="${num(cuts[i - 1].x)}"`]
        inner.push({ attrs, text: slice(bounds[i], bounds[i + 1]) })
      }
    }
    for (const segment of segments) {
      if (segment.from > cursor) {
        pushChunks([], dyAttr(owed), cursor, segment.from)
        owed = 0
      }
      const own = shift(segment).length ? segment.dy : 0
      pushChunks(styleOf(segment, { drawnDecoration: !!segment.drawn }), dyAttr(owed + own),
        segment.from, segment.to)
      owed = -own
      cursor = Math.max(cursor, segment.to)
    }
    // A debt still open here is owed by the END of the piece, and every piece
    // states its own absolute `x`/`y`, so nothing after it inherits the shift.
    if (cursor < to) pushChunks([], dyAttr(owed), cursor, to)
    // The hyphen goes INSIDE the last tspan, not after it: a bare text node between
    // tspans is legal SVG that an importer building its node out of the tspans drops,
    // and the run at the break is the one whose font drew the glyph — so it is the
    // one whose styling it has to inherit.
    if (hyphen && inner.length) inner[inner.length - 1].text += hyphen
    return {
      position,
      length,
      waves,
      sole: null,
      body: inner.map((s) => `<tspan${s.attrs.length ? ' ' + s.attrs.join(' ') : ''}>${s.text}</tspan>`).join(''),
    }
  }

  const pieces = []

  /**
   * One line, or one fragment of one, as positioned pieces — split wherever a run
   * leaves the baseline.
   *
   * A superscript is a POSITIONED PIECE, exactly as a second visual line is: it
   * states a baseline of its own. SVG's way of saying so inside a `<text>` is
   * `dy`, which is relative AND cumulative — every raised run has to be paid back
   * by the next one, and the whole tail of the line rides on the arithmetic
   * surviving intact. It does not survive Figma. The empty `<tspan dy>` that used
   * to pay the debt was dropped outright (finding §"Sup/sub"), and folding the
   * debt into the next tspan that carries text — what this did until now — only
   * moves the dependency: `demo/challenges.html#fx-type`'s `E = mc²` still landed
   * off its line when pasted, while `H₂O` and `CO₂` did not, which is the
   * signature of an importer that reads SOME of the chain and not all of it.
   *
   * So the shift is taken out of the chain entirely. Each stretch of runs that
   * shares one offset becomes its own piece at its own measured `x` (from
   * `line.spans`, the per-stretch extents `collect/text.js` measured) and its own
   * absolute baseline. Nothing is relative, nothing is owed, and no consumer can
   * drop a compensation it never had to read. It also stops the line from
   * DERIVING the position of everything after a raised run from advances a
   * substituted font never produced: that is what pushed the formula line past
   * the right edge of its card.
   *
   * The cost is layers — a line with three superscripts arrives as seven text
   * objects instead of one — so it is spent only where a run actually leaves the
   * baseline, and only when every group's extent was measured. Otherwise the
   * relative form stays and says so.
   */
  const pushRange = (from, to, x, w, baseline, line) => {
    const segments = segmentsIn(from, to)
    const dyOf = (s) => (isNum(s.dy) ? s.dy : 0)
    if (segments.some((s) => dyOf(s) !== 0)) {
      // The groups have to TILE the range: a character no run covers still has to
      // be painted, and only the relative form below knows how to place it.
      const groups = []
      let cursor = from
      for (const s of segments) {
        if (s.from !== cursor) { groups.length = 0; break }
        const last = groups[groups.length - 1]
        if (last && last.dy === dyOf(s)) last.to = s.to
        else groups.push({ from: s.from, to: s.to, dy: dyOf(s) })
        cursor = s.to
      }
      if (cursor !== to) groups.length = 0
      const extents = groups.map((g) => (g.from === from && g.to === to
        ? { x, w }                                  // the whole range at one offset
        : spanExtent(line, g.from, g.to)))
      if (groups.length && extents.every(Boolean)) {
        if (groups.length > 1) {
          ctx.note(nodeId, 'a line whose runs leave the baseline (superscript, subscript, vertical-align) is ' +
            `emitted as ${groups.length} positioned pieces — each at the x its own characters were measured at ` +
            'and at its own absolute baseline — instead of one piece with relative `dy` shifts. SVG `dy` is ' +
            'cumulative, so every raised run has to be paid back by the next one, and an importer that carries ' +
            'only part of that chain drifts the rest of the line (measured by pasting into Figma). What is lost ' +
            `is the line as one object: it arrives as ${groups.length} text layers, each editable on its own.`,
          'emit.svg.text-baseline-shift-split', 'A')
        }
        groups.forEach((g, i) => {
          const piece = buildPiece(g.from, g.to, extents[i].x, extents[i].w, baseline + g.dy, line, true)
          if (piece) pieces.push(piece)
        })
        return
      }
      ctx.note(nodeId, 'a line carries a run raised or lowered off its baseline, and this document has no ' +
        'measured extent for the stretches around it (the line reports no `spans`, or they do not tile exactly ' +
        'the characters each offset covers). The shift is emitted as a relative `dy` instead, paid back on the ' +
        'next tspan that carries text: correct SVG, but an importer that drops part of that chain moves ' +
        'everything after the raised run.', 'emit.svg.text-baseline-shift-relative', 'A')
    }
    const piece = buildPiece(from, to, x, w, baseline, line)
    if (piece) pieces.push(piece)
  }

  for (const line of t.lines) {
    if (!isObject(line)) continue
    const start = Math.max(0, Number.isInteger(line.start) ? line.start : 0)
    const end = Math.min(chars.length, Number.isInteger(line.end) ? line.end : 0)
    if (end <= start) continue

    // A line with holes in it — an inline image, a float — is NOT one run of
    // glyphs from `line.x` to `line.x + line.w`: `line.w` is the sum of the
    // painted advances and the hole is not in it. Stretching the whole line to
    // that width squeezes the text; painting it from `line.x` at natural size
    // slides everything after the hole to the left. Each fragment is emitted at
    // its own measured `x` instead — and, when the measuring font travels, its
    // own `textLength`.
    const frags = Array.isArray(line.frags) && line.frags.length > 1
      ? line.frags.filter((f) => isObject(f) && Number.isInteger(f.start) && Number.isInteger(f.end))
      : null

    if (!frags || frags.length < 2) {
      pushRange(start, end, line.x, line.w, line.baseline, line)
      continue
    }
    for (const frag of frags) {
      pushRange(
        Math.max(start, frag.start),
        Math.min(end, frag.end),
        frag.x,
        frag.w,
        line.baseline,
        line
      )
    }
  }

  if (unbboxed.length) {
    ctx.note(nodeId, 'a rotation or skew above this block made every measured line the bounding box of a quad ' +
      '(`collect.text` says so), and this backend re-applies that same matrix to the group the glyphs sit in — ' +
      `so the two compounded. All ${unbboxed.length} line(s) are mapped back through the matrix, up to ` +
      `${num(Math.max(...unbboxed))}px of displacement removed. The centre and the extent come back exactly; ` +
      'what stays assumed is that the line\'s ascent is the font\'s, which is only false where one line mixes ' +
      'font sizes.', 'emit.svg.text-unbboxed', 'A')
  }

  if (hyphens.length) {
    ctx.note(nodeId, `${hyphens.length} line(s) of this block end in a hyphen the browser painted at a ` +
      'hyphenation break and the document does not contain (`collect.text-hyphen` measured it and put it on ' +
      `\`line.hyphen\`, not in \`characters\`, which every offset indexes). It is appended here to the piece ` +
      `that ends the line — ${[...new Set(hyphens)].map((h) => `U+${h.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(', ')} — ` +
      'inside the last tspan so no importer can drop it separately from the text. Its advance was already ' +
      'inside the measured line width, so nothing else moves. What this costs is that the emitted string is ' +
      'no longer character-for-character the page\'s `textContent`: a consumer that reflows this text (Figma ' +
      'reflows a TextNode) will keep the hyphen in the middle of a word.',
    'emit.svg.text-hyphen-painted', 'A')
  }

  // Decorations paint UNDER the glyphs (CSS Text Decoration §2: the line is drawn
  // before the text it decorates), so the waves go out first and the descenders
  // cross them the way the browser paints it.
  for (const w of pieces.flatMap((p) => p.waves || []).filter(Boolean)) {
    // No clip: the chain already stops at the run's end (`wavyPath` splits its
    // last half-period there), so the wave is one self-contained `<path>` in the
    // same user space as the glyphs it sits under.
    out.push(depth, `<path d="${w.d}" ${w.attrs}/>`)
  }

  // A fragment is as much a positioned piece as a line is — it is a line broken
  // by something that is not a character — so it counts the same way here: what
  // decides the shape is how many positions the block has to state, not how many
  // baselines it has.
  // `auto` splits from the FIRST piece, not the second. The reason to split is that
  // an importer ignoring the x/y of an interior tspan (Figma) never reads the
  // position at all — and that is just as true of a one-line block, which then
  // lands at its group's origin instead of its baseline. Measured pasting
  // `challenges.html#fx-img`: 9 of its 13 blocks were single-line, so 9 of 13
  // collapsed — two labels climbed on top of the photos they name, and a title and
  // its subtitle landed on each other.
  //
  // A single piece costs nothing to split: one piece is one `<text>` either way, so
  // this only moves the position from the tspan onto the element that owns it. That
  // makes `auto` and `always` agree wherever there is anything to place, which is
  // correct — the real choice is `never`, for a consumer that does honour interior
  // tspans and would rather keep the block editable as one.
  const perLine = ctx.textPerLine === 'never' ? false : pieces.length > 0

  if (perLine) {
    if (pieces.length > 1) {
      ctx.note(nodeId, `a text block that occupies ${pieces.length} positioned pieces is emitted as ` +
        `${pieces.length} <text> elements, one per piece at its own measured baseline. An importer that ignores ` +
        'the x/y of an interior tspan (Figma) reflows a single <text> with its own leading and stacks the lines on ' +
        'top of each other. The glyphs land where they were measured; what is lost is the block — each line ' +
        'arrives as its own text layer, editable on its own. textPerLine:"never" keeps one <text> per block.',
      'emit.svg.text-per-line', 'A')
    }
    // Each piece is one element, so the block's inherited typography and the
    // piece's own have to be MERGED onto it: concatenating the two lists writes
    // `font-size` twice, and a repeated attribute is not a bad tag, it is an
    // unparseable document — Figma pasted nothing at all.
    const elements = pieces.map((p) =>
      `<text ${mergeAttrs(head, p.sole || [], p.position, p.length).join(' ')}>${p.body}</text>`)
    emitTextElements(out, depth, elements, blockGradient(),
      { ink, box: { x: 0, y: 0, w: frame.w, h: frame.h }, nodeId, defs, ctx })
    return
  }

  // The WHOLE element is one row, with no indentation between its tags.
  // `xml:space="preserve"` is not optional — a line may legitimately start or end
  // with a space — and it makes every newline and every indent inside `<text>`
  // a PAINTED character. Pretty-printing this element put ~50 of them inside each
  // multi-run line, which then had to fit the measured `textLength`: the glyphs
  // were squeezed to 40% and smeared across the line. Emitting one row is what
  // makes `textLength` mean the text and nothing else.
  const parts = [`<text ${head.join(' ')}>`]
  for (const piece of pieces) {
    parts.push(`<tspan ${[...piece.position, ...(piece.sole || []), ...piece.length].join(' ')}>` +
      `${piece.body}</tspan>`)
  }
  parts.push('</text>')
  emitTextElements(out, depth, [parts.join('')], blockGradient(),
    { ink, box: { x: 0, y: 0, w: frame.w, h: frame.h }, nodeId, defs, ctx })
}

/**
 * The finished text elements, either as themselves or — when their fill is a
 * gradient — through a `<mask>` of themselves.
 *
 * ## Why the mask exists, and what it costs
 *
 * Measured by pasting ONE heading (`background-clip: text` over a linear
 * gradient) into Figma three ways, 2026-08-06:
 *
 * | form                                   | result                             |
 * |----------------------------------------|------------------------------------|
 * | `<text fill="url(#grad)">`             | **black** — the reference is not    |
 * |                                        | resolved and the default fill wins  |
 * | `<mask>` of the text + a painted rect  | **exact**, colours and all          |
 * | one `<tspan>` per letter, flat colours | colours arrive, **the spaces do     |
 * |                                        | not**: "Tipografíacondegradado"     |
 *
 * The third is not a third option. It does not degrade the picture, it changes
 * the CONTENT — the block arrives as one run-on word — and it is written down
 * here so nobody re-derives it as a way out. The real choice is between the first
 * two, and it is not a fidelity question at all:
 *
 *  - with the mask, the colours are the page's and the block stops being text for
 *    the importer: a rectangle and a mask, not a text layer, so it is no longer
 *    editable, selectable or searchable there (it is still one `<text>` element
 *    in the file, and still text for every SVG renderer);
 *  - with the fill reference, the block is a real editable text layer, in black.
 *
 * The mask is the default because a heading in the wrong colour is wrong on
 * arrival and a heading nobody can retype is only inconvenient. `textGradientMask:
 * false` takes the other side. (Figma's own extension keeps both, because it
 * writes the node through the Plugin API and never goes through this importer —
 * that is one of the three places its tool still wins, and pretending otherwise
 * in this comment would be the only real mistake here.)
 *
 * ## What is wrapped, and what does not move
 *
 * The mask holds the text it was HANDED, byte for byte, with one substitution:
 * the gradient reference becomes white. Every per-piece position, every
 * `textLength`, the small caps, the break hyphen, the `dy` of a superscript and
 * the split at a baseline shift are already in that markup, and building a
 * simpler `<text>` for the mask would be the one place they could quietly
 * disagree with the one that was measured.
 *
 * The gradient does not move either. Its paint server is `userSpaceOnUse` with
 * the layer's own box folded into the matrix (`gradientRef`, `applyTextClip`), so
 * the shape painted through the mask decides only WHERE the ramp shows — never
 * its origin, its scale or its angle. That is what lets the rect be generous: it
 * is the union of the element box (the box CSS measured the gradient against,
 * unchanged) and the ink of every piece, so a descender, an italic overhang or an
 * outline that leaves the box still gets paint.
 *
 * @param {string[]} rows  the `<text>` elements, already merged and positioned
 * @param {string|null} ref  `url(#…)` when every glyph is painted by one gradient
 */
function emitTextElements(out, depth, rows, ref, { ink, box, nodeId, defs, ctx }) {
  const plain = () => { if (rows.length) out.push(depth, rows.join('')) }
  if (!ref || !rows.length) return plain()

  // The box the rect covers. `ink` is Infinity when no piece was built, which is
  // the one case where there is nothing to cover and the element box is all there
  // is to go on.
  const x0 = Math.min(box.x, isNum(ink.x0) ? ink.x0 : box.x)
  const y0 = Math.min(box.y, isNum(ink.y0) ? ink.y0 : box.y)
  const x1 = Math.max(box.x + box.w, isNum(ink.x1) ? ink.x1 : box.x + box.w)
  const y1 = Math.max(box.y + box.h, isNum(ink.y1) ? ink.y1 : box.y + box.h)
  // The outline is centred on the glyph, so half of it is outside the ink, and an
  // antialiased edge is worth another px. Padding is free here — see above: the
  // rect cannot move the gradient, and the mask cannot paint outside the glyphs.
  const stroke = Math.max(0, ...rows.flatMap((row) =>
    [...row.matchAll(/stroke-width="([\d.]+)"/g)].map((hit) => finite(hit[1]))))
  const pad = 1 + stroke
  const rect = { x: x0 - pad, y: y0 - pad, w: (x1 - x0) + pad * 2, h: (y1 - y0) + pad * 2 }
  if (!(rect.w > 0) || !(rect.h > 0)) return plain()

  // The mask copy. `fill-opacity` deliberately survives the substitution: a
  // luminance mask multiplies luminance by alpha, so a half-transparent layer
  // masks in at half strength and the rect needs no opacity of its own.
  let white = rows.map((row) => row.split(`fill="${ref}"`).join('fill="#ffffff"'))

  // A decoration with a colour of its own would mask in at THAT colour's
  // luminance — a dark underline under a gradient heading would come out as a
  // hole in the letters' own colour. Under this form the only paint is the
  // gradient, so the colour is dropped and the line takes the ramp at full
  // strength, which is the same thing the glyphs above it do.
  const decorated = white.some((row) => row.includes('text-decoration-color:'))
  if (decorated) {
    white = white.map((row) => row.replace(/text-decoration-color:[^;"]*;?/g, ''))
    ctx.note(nodeId, 'a text-decoration on this gradient text carries a colour of its own. Through the glyph ' +
      'mask the only paint is the gradient, so the line is masked in at full strength and takes the gradient ' +
      'instead of its own colour. textGradientMask:false keeps the colour, and the glyphs arrive black.',
    'emit.svg.text-gradient-mask-decoration', 'A')
  }

  // `-webkit-text-stroke` paints ON TOP of the fill, in CSS and in SVG alike
  // (`textStrokeAttrs`). Inside the mask it becomes part of the silhouette, so
  // the gradient reaches the whole ink, ring included; the ring's own colour is
  // then painted back over the rect by this same text, unfilled. Two paints in
  // the same order as before, and the outline survives as an object.
  const stroked = white.some((row) => /stroke="#/.test(row))
  if (stroked) white = white.map((row) => row.replace(/stroke="#[0-9a-fA-F]+"/g, 'stroke="#ffffff"'))

  // `nodeId` is in the key on purpose: two headings with the same words and
  // different gradients must not end up pointing at one mask, and a def is shared
  // only when its whole key matches.
  const maskId = defs.add('tg', JSON.stringify([nodeId, rect, white]), (id) => [
    `<mask id="${id}" maskUnits="userSpaceOnUse" x="${num(rect.x)}" y="${num(rect.y)}" ` +
    `width="${num(rect.w)}" height="${num(rect.h)}">`,
    ...white.map((row) => `  ${row}`),
    '</mask>',
  ])
  out.push(depth, `<rect x="${num(rect.x)}" y="${num(rect.y)}" width="${num(rect.w)}" ` +
    `height="${num(rect.h)}" fill="${ref}" mask="url(#${maskId})"/>`)
  if (stroked) {
    out.push(depth, rows.map((row) => row.split(`fill="${ref}"`).join('fill="none"')).join(''))
  }

  ctx.note(nodeId, 'this text is painted with a gradient, so it is emitted as a <mask> holding the same text in ' +
    'white with the gradient painted through it, not as <text fill="url(#…)">. Measured by pasting both into ' +
    'Figma: the fill reference is not resolved there and the text arrives BLACK, the mask arrives with the ' +
    'page\'s colours. What that costs is the text — the importer builds a rectangle and a mask, so the block is ' +
    'no longer an editable, selectable or searchable text layer THERE (it is still one <text> element in this ' +
    'file, and still text to every SVG renderer). textGradientMask:false emits the fill reference instead: an ' +
    'editable text layer, in black. Per-letter <tspan>s are not a third option — measured, the same importer ' +
    'collapses the spaces between them and the block arrives as one run-on word. The gradient keeps the box it ' +
    'was measured against: the paint server is userSpaceOnUse, so the rect decides only where the ramp shows.' +
    (stroked ? ' The -webkit-text-stroke is masked in with the glyphs and then painted back over the rect by the ' +
      'same text, unfilled, so the outline keeps its own colour and its own object.' : ''),
  'emit.svg.text-gradient-mask', 'C')
}

// ——— nodes ———

function frameOf(node) {
  return rectOf(isObject(node.frame) ? node.frame : node.abs)
}

/**
 * The node box plus every descendant's, in node-local px. `abs` is relative to
 * the capture root, so the deltas need no matrix — which is exactly why the
 * schema insists on carrying it.
 */
function subtreeExtent(node, ctx) {
  const frame = frameOf(node)
  const origin = isObject(node.abs) ? rectOf(node.abs) : { x: 0, y: 0, w: frame.w, h: frame.h }
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

/**
 * The text nodes a `background-clip: text` layer paints through, each with the
 * offset from this node's user space into its own.
 *
 * The walk stops at anything that would make that offset a lie — a transform, an
 * opacity group, a mask — and declares it rather than painting the glyphs of a
 * box that is somewhere else.
 */
function textTargets(node, nodeId, ctx) {
  if (node.type === 'text') return { list: [{ id: nodeId, node, dx: 0, dy: 0 }], skipped: 0 }
  const list = []
  let skipped = 0
  const seen = new Set([nodeId])
  const walk = (parent, dx, dy) => {
    for (const id of (Array.isArray(parent.children) ? parent.children : [])) {
      if (seen.has(id)) continue
      seen.add(id)
      const child = ctx.nodes[id]
      if (!isObject(child)) continue
      if (isObject(child.transform) || isObject(child.mask)) { skipped++; continue }
      const f = frameOf(child)
      if (child.type === 'text') list.push({ id, node: child, dx: dx + f.x, dy: dy + f.y })
      walk(child, dx + f.x, dy + f.y)
    }
  }
  walk(node, 0, 0)
  return { list, skipped }
}

/** The id of the node that lists `id` among its children, from a map built on first use. */
function parentOf(id, ctx) {
  if (!ctx.parents) {
    ctx.parents = new Map()
    for (const [parentId, parent] of Object.entries(ctx.nodes)) {
      for (const child of (isObject(parent) && Array.isArray(parent.children) ? parent.children : [])) {
        ctx.parents.set(child, parentId)
      }
    }
  }
  return ctx.parents.get(id)
}

/**
 * The glyphs an INLINE `background-clip: text` element paints, for a node with no
 * text of its own.
 *
 * The collector gives a block's inline content one text node, so a `<b>` inside a
 * `<p>` is a box with no children and its characters are runs of a text node next
 * to it (the card scene's "$89" came out invisible). The walk climbs until a level
 * holds such a node, and takes the runs that sit inside the box (measured span
 * inside it, on a line whose baseline crosses it) and whose own fill is fully
 * transparent. Any other run shows its own colour over the clipped background in
 * CSS as well. Pinned by `test/verify-plugin.mjs` (inline background-clip:text).
 *
 * @returns {{id:string, node:object, dx:number, dy:number, ranges:number[][]}[]}
 */
function inlineTextTargets(node, nodeId, ctx) {
  const styles = isObject(ctx.doc.styles) && isObject(ctx.doc.styles.text) ? ctx.doc.styles.text : {}
  const transparent = (run) => {
    const style = styles[run.style]
    const fill = isObject(style) && Array.isArray(style.fills) ? style.fills.find(isObject) : null
    return !!fill && fill.type === 'solid' && Array.isArray(fill.color) && !(fill.color[3] > 0)
  }
  const box = frameOf(node)
  let ox = box.x
  let oy = box.y
  let from = nodeId
  for (let parentId = parentOf(nodeId, ctx); parentId !== undefined; parentId = parentOf(parentId, ctx)) {
    const parent = ctx.nodes[parentId]
    if (!isObject(parent)) break
    const list = []
    for (const id of (Array.isArray(parent.children) ? parent.children : [])) {
      const text = ctx.nodes[id]
      if (id === from || !isObject(text) || text.type !== 'text' || !isObject(text.text) ||
        isObject(text.transform) || isObject(text.mask)) continue
      const f = frameOf(text)
      const x0 = ox - f.x
      const y0 = oy - f.y
      const spans = []
      for (const line of (Array.isArray(text.text.lines) ? text.text.lines : []).filter(isObject)) {
        if (!isNum(line.baseline) || line.baseline < y0 || line.baseline > y0 + box.h) continue
        for (const s of (Array.isArray(line.spans) && line.spans.length ? line.spans : [line]).filter(isObject)) {
          if (isNum(s.x) && isNum(s.w) && s.x >= x0 - 0.5 && s.x + s.w <= x0 + box.w + 0.5) spans.push(s)
        }
      }
      const ranges = []
      for (const run of (Array.isArray(text.text.runs) ? text.text.runs : []).filter(isObject)) {
        if (!transparent(run)) continue
        for (const s of spans) {
          const a = Math.max(s.start, run.start)
          const b = Math.min(s.end, run.end)
          if (b > a) ranges.push([a, b])
        }
      }
      if (ranges.length) list.push({ id, node: text, dx: f.x - ox, dy: f.y - oy, ranges })
    }
    if (list.length) return list
    if (isObject(parent.transform) || isObject(parent.mask)) break
    const f = frameOf(parent)
    ox += f.x
    oy += f.y
    from = parentId
  }
  return []
}

/**
 * `background-clip: text`: the background is not clipped to a box at all, it is
 * clipped to the GLYPHS. Painting it on the border box — which is what this
 * backend did — turns a gradient heading into a gradient BAR with no letters in
 * it, and `collect/box.js` says so (`background-clip:text needs a glyph mask`)
 * while the picture still comes out wrong.
 *
 * So the paint is moved onto the glyphs rather than onto a box. This function
 * resolves WHICH paint reaches them and in what coordinates; the shape that
 * carries it belongs to the text node (`emitTextElements`), and the two answers
 * differ: a flat colour becomes the `<text>`'s own fill and stays one editable
 * element, while a gradient goes through a `<mask>` of the same text, because
 * `fill="url(#…)"` on a `<text>` is a reference Figma does not resolve and the
 * heading arrives black. That is measured, and it is what `textGradientMask`
 * turns off for anyone who would rather keep the editable layer.
 *
 * The gradient's reference box stays the ELEMENT's, not the glyphs' bounding box:
 * the paint server is `userSpaceOnUse` with the layer's own matrix, offset by
 * where the layer sits in the text node's space. CSS measures the gradient
 * against the element and so does this.
 *
 * An image or conic layer has no SVG text paint, and multiple stacked layers
 * cannot all fill one `<text>`. Those are declared and dropped rather than
 * painted as a bar: a rectangle in the place of a word is wrong content, and
 * wrong content is worse than missing content.
 */
function applyTextClip(clipped, node, nodeId, box, defs, ctx) {
  const own = textTargets(node, nodeId, ctx)
  const { skipped } = own
  const list = own.list.length ? own.list : inlineTextTargets(node, nodeId, ctx)
  if (skipped) {
    ctx.note(nodeId, `${skipped} descendant(s) of a background-clip:text element carry their own transform, mask ` +
      'or are otherwise not addressable from this node\'s space; their glyphs do not receive the paint.',
      'emit.svg.background-clip-text-unreachable', 'O')
  }
  if (!list.length) {
    ctx.note(nodeId, 'a background layer is clipped to text (background-clip: text), and this node has neither ' +
      'text of its own nor a transparent run of an enclosing text block measured inside its box, so the layer ' +
      'is dropped.',
      'emit.svg.background-clip-text-no-text', 'A')
    return
  }
  const top = clipped[clipped.length - 1]
  if (clipped.length > 1) {
    ctx.note(nodeId, `${clipped.length} background layers are clipped to the same glyphs; an SVG <text> takes one ` +
      'fill, so the topmost travels and the rest are dropped.', 'emit.svg.background-clip-text-layers', 'O')
  }
  if (top.type !== 'solid' && top.type !== 'linear' && top.type !== 'radial') {
    ctx.note(nodeId, `a ${String(top.type)} background layer is clipped to text; SVG has no such paint for glyphs, ` +
      'and painting it on the box instead would put a filled rectangle where the words are. It is dropped — the ' +
      'text is still emitted, with whatever fill its own colour gives it.',
      'emit.svg.background-clip-text-paint', 'O')
    return
  }
  const rect = layerRect(top, box)
  const alpha = isNum(top.opacity) ? Math.min(1, Math.max(0, top.opacity)) : 1
  for (const target of list) {
    let attrs
    if (top.type === 'solid') {
      const split = splitColor(top.color)
      attrs = [`fill="${split.color}"`, `fill-opacity="${num(split.alpha * alpha)}"`]
    } else {
      const ref = gradientRef(top, defs, ctx, nodeId, { x: rect.x - target.dx, y: rect.y - target.dy })
      if (!ref) return
      attrs = [`fill="${ref}"`, `fill-opacity="${num(alpha)}"`]
    }
    if (!target.ranges) {
      ctx.textPaint.set(target.id, attrs)
    } else if (ctx.visited.has(target.id)) {
      ctx.note(nodeId, 'this inline element is painted after the text block its glyphs belong to, so its ' +
        'background-clip:text paint cannot reach them and the layer is dropped.',
      'emit.svg.background-clip-text-order', 'O')
    } else {
      const prior = ctx.textRangePaint.get(target.id) || []
      ctx.textRangePaint.set(target.id, prior.concat(target.ranges.map(([from, to]) => ({ from, to, attrs }))))
    }
  }
  // What SHAPE carries it from here is the text node's decision, not this one's:
  // a solid colour is always the `<text>`'s own fill (nothing to resolve, nothing
  // to drop), and a gradient goes through a glyph mask unless `textGradientMask`
  // is off — `emitTextElements` measures that trade and declares it there. This
  // note stays about the paint, and says only what is true of both shapes.
  ctx.note(nodeId, `a ${top.type} background is clipped to this element's glyphs (background-clip: text). It is ` +
    'moved onto the glyphs themselves — as the fill of the <text> when it is a flat colour, and, when it is a ' +
    'gradient, through a mask of the same text (emit.svg.text-gradient-mask says what that costs). The paint ' +
    'keeps the ELEMENT as its reference box, which is the box CSS measured it against — not the glyph bounding ' +
    'box, and not the box of whatever shape ends up carrying it.',
  'emit.svg.background-clip-text', 'A')
}

/** Invariant 3: sort by `paint.z`, break ties with the DOM order, never re-derive. */
function sortedChildren(node, ctx) {
  const ids = (Array.isArray(node.children) ? node.children : []).filter((id) => isObject(ctx.nodes[id]))
  return ids
    .map((id, i) => ({ id, i, z: Number.isInteger(ctx.nodes[id].paint && ctx.nodes[id].paint.z) ? ctx.nodes[id].paint.z : 0 }))
    .sort((a, b) => (a.z - b.z) || (a.i - b.i))
    .map((entry) => entry.id)
}

/**
 * Will this node's own EMITTED group isolate its content? True for the groups
 * this backend writes with an isolating attribute — `isolation:isolate`, a
 * wrapping clip (either kind), opacity below 1, a mask, or a `filter` chain that
 * actually produces one (`backgroundBlur` alone does not; it is dropped).
 * A blend INSIDE such a node can never reach an ancestor's backdrop, whatever
 * the ancestor does.
 */
function contentIsolated(node) {
  if (node.isolate || node.mask || node.clipShape) return true
  if (isObject(node.clip)) return true
  if (isNum(node.opacity) && node.opacity < 1) return true
  const effects = Array.isArray(node.effects) ? node.effects : []
  return effects.some((e) => isObject(e) && (e.type === 'layerBlur' || e.type === 'colorMatrix' ||
    ((e.type === 'dropShadow' || e.type === 'innerShadow') && e.source === 'filter')))
}

/**
 * Does anything in this subtree blend with what is under THIS node?
 *
 * The question decides whether the node's own paint must move inside its clip
 * group (`backdropInClip`) or, failing that, whether the isolation cost is
 * declared. It is asked about the whole subtree, not the direct children,
 * because the blend can be several levels down — but the walk stops at any
 * descendant whose own emitted group already isolates its content
 * (`contentIsolated`): what blends inside one of those finds its backdrop
 * there, not here, no matter how this node is structured.
 */
function subtreeBlends(id, ctx, seen = new Set()) {
  if (seen.has(id)) return false
  seen.add(id)
  const node = ctx.nodes[id]
  if (!isObject(node)) return false
  if (typeof node.blend === 'string' && node.blend !== 'normal') return true
  if (contentIsolated(node)) return false
  const kids = Array.isArray(node.children) ? node.children : []
  return kids.some((kid) => subtreeBlends(kid, ctx, seen))
}

function emitNode(out, depth, nodeId, node, defs, ctx, scDepth, linear = IDENTITY_LINEAR) {
  if (ctx.visited.has(nodeId)) {
    ctx.note(nodeId, 'the node is reachable twice; the second visit is skipped to keep the emit finite.',
      'emit.svg.node-revisited', 'O')
    return
  }
  ctx.visited.add(nodeId)

  const frame = frameOf(node)
  const box = { x: 0, y: 0, w: frame.w, h: frame.h }
  const radii = normalizeRadii(node.radii, box.w, box.h)
  // The linear map from this node's CONTENTS to the space client rects were
  // measured in — the parent's, composed with this node's own. `collect/text.js`
  // builds the same product (`linearAbove`) and every line it reports was taken
  // through it; `emitText` needs it to know whether it can trust one.
  const own = linearOf(node)
  const content = own ? mul2(linear, own) : linear
  const effects = (Array.isArray(node.effects) ? node.effects : []).filter(isObject)
  const boxEffects = effects.filter((e) => (e.type === 'dropShadow' || e.type === 'innerShadow') && e.source !== 'filter')
  const chainEffects = effects.filter((e) => e.type === 'layerBlur' || e.type === 'backgroundBlur' ||
    e.type === 'colorMatrix' ||
    ((e.type === 'dropShadow' || e.type === 'innerShadow') && e.source === 'filter'))
  const allFills = (Array.isArray(node.fills) ? node.fills : []).filter(isObject)
  // `background-clip: text` is not a clip box this backend can inset to — it is
  // a different SHAPE, the glyphs, and it has to be resolved before the layers
  // are painted so the ones it takes never reach the box.
  const clipped = allFills.filter((f) => f.clipBox === 'text')
  const fills = clipped.length ? allFills.filter((f) => f.clipBox !== 'text') : allFills
  // Pixels the export resolved for this node because its filter is one the
  // destination will not run (`rasterFilters`). They replace the node's OWN
  // paint, its filters and its whole subtree — everything the filter applied to
  // — so nothing below may also emit them.
  const raster = readFilterRaster(node, ctx)
  if (clipped.length && !raster) applyTextClip(clipped, node, nodeId, box, defs, ctx)
  const strokes = (Array.isArray(node.strokes) ? node.strokes : []).filter(isObject)
  const ownDepth = node.paint && node.paint.stackingContext ? scDepth + 1 : scDepth

  // Node group: placement, compositing and the CSS `filter` chain, in that order.
  const attrs = [`id="${escAttr(safeId(nodeId, 'n'))}"`]
  const transforms = []
  if (frame.x || frame.y) transforms.push(`translate(${num(frame.x)} ${num(frame.y)})`)
  if (isObject(node.transform) && Array.isArray(node.transform.m) && node.transform.m.length === 6) {
    transforms.push(matrixAttr(node.transform.m))
  } else if (node.transform !== null && node.transform !== undefined && !isObject(node.transform)) {
    ctx.note(nodeId, 'the node carries an unreadable transform; it is emitted untransformed.',
      'emit.svg.transform-unreadable', 'O')
  }
  if (transforms.length) attrs.push(`transform="${transforms.join(' ')}"`)
  if (isNum(node.opacity) && node.opacity < 1) attrs.push(`opacity="${num(node.opacity)}"`)
  const styleProps = []
  if (typeof node.blend === 'string' && node.blend !== 'normal') styleProps.push(`mix-blend-mode:${node.blend}`)
  if (node.isolate) styleProps.push('isolation:isolate')
  if (styleProps.length) attrs.push(`style="${escAttr(styleProps.join(';'))}"`)

  if (chainEffects.length && !raster) {
    const extent = subtreeExtent(node, ctx)
    const bleed = filterBleed(chainEffects)
    const region = {
      x: extent.x - bleed, y: extent.y - bleed,
      w: extent.w + 2 * bleed, h: extent.h + 2 * bleed,
    }
    for (const e of chainEffects) {
      if (e.type === 'backgroundBlur') {
        ctx.note(nodeId, 'backdrop-filter has no SVG equivalent (BackgroundImage was never implemented); ' +
          'the node is emitted without it.',
          'emit.svg.backdrop-filter-dropped', 'O')
      }
    }
    const filterId = layerFilter(chainEffects.filter((e) => e.type !== 'backgroundBlur'), region, defs, ctx, nodeId)
    if (filterId) attrs.push(`filter="url(#${filterId})"`)
  }
  if (node.mask) {
    const maskId = emitMask(node, nodeId, defs, ctx)
    if (maskId) attrs.push(`mask="url(#${maskId})"`)
  }
  // `clip-path` cuts this node's own paint as well as its children's, so it goes
  // on the node group and not on the children group `node.clip` wraps.
  const shapeClip = emitClipShape(node.clipShape, nodeId, defs, ctx)
  if (shapeClip) attrs.push(`clip-path="url(#${shapeClip})"`)

  out.push(depth, `<g ${attrs.join(' ')}>`)
  const inner = depth + 1

  if (ctx.debugPaint) {
    const grade = isObject(node.fidelity) ? String(node.fidelity.grade) : '?'
    const z = isObject(node.paint) && Number.isInteger(node.paint.z) ? node.paint.z : '?'
    out.push(inner, `<title>${escText(`${nodeId} · ${node.type || '?'} · grade ${grade} · z ${z}` +
      `${node.name ? ` · ${node.name}` : ''}`)}</title>`)
  }

  // The whole node, as pixels. Everything the filter reached is inside the PNG —
  // this node's own paint AND its subtree — so the vector forms of both are
  // skipped, and the subtree is marked visited so the orphan check does not
  // report the children as unreachable: they were reached, and then baked.
  if (raster) {
    ctx.note(nodeId, `this node and its whole subtree are one PNG <image> at ${num(raster.scale)}x over ` +
      `${num(raster.box.w)}×${num(raster.box.h)}px, because ${raster.why.join('; ')}.`,
    'emit.svg.filter-rasterized', 'R')
    ctx.note(null, 'rasterFilters is on, so the nodes whose filter the destination will not run — and only ' +
      'those — were rasterized to PNG <image>s instead of being emitted as vector paint. A PNG inside an ' +
      '<image> is the one degraded form the paste probe proves Figma draws (FIGMA_FINDINGS §6; an SVG ' +
      'inside an <image> arrives blank). Each box is the filter\'s own region and not the border box, or ' +
      'the shadow would end in a straight line, and the pixels come from the mounted clone, where a ' +
      'backdrop-filter is already pre-composed. The cost is editability, and it is paid in EVERY consumer ' +
      'and not only in the one this buys: no text, no fills, no children, one bitmap. rasterFilters:false ' +
      '(the default) keeps the vector form and declares the loss instead.',
    'emit.svg.filter-rasterized', 'R')
    out.push(inner, `<image x="${num(raster.box.x)}" y="${num(raster.box.y)}" ` +
      `width="${num(raster.box.w)}" height="${num(raster.box.h)}" preserveAspectRatio="none" ` +
      `href="${escAttr(raster.href)}" xlink:href="${escAttr(raster.href)}"/>`)
    const stack = Array.isArray(node.children) ? node.children.slice() : []
    while (stack.length) {
      const id = stack.pop()
      if (ctx.visited.has(id)) continue
      ctx.visited.add(id)
      const kid = ctx.nodes[id]
      if (isObject(kid) && Array.isArray(kid.children)) stack.push(...kid.children)
    }
    out.push(depth, '</g>')
    return
  }

  // Own paint. box-shadow follows the border box, so the filter goes on this
  // subgroup and never sees the children.
  const paintsSomething = fills.length || strokes.length || node.type === 'text' || isObject(node.control)

  // The overflow clip is resolved BEFORE the node's own paint goes out, because a
  // blending descendant decides WHERE that paint must sit. A wrapping
  // `<g clip-path>` ISOLATES what it holds (CSS Compositing: a clip creates a
  // group), so a descendant with `mix-blend-mode` composes against an empty
  // backdrop unless this node's own background is painted INSIDE the group with
  // it — verified with a micro-probe, a `screen` rect reads (85,219,247) as a
  // sibling and (34,211,238), the raw source colour, inside `<g clip-path>`.
  // Handing the clip to each child instead was TRIED and is worse: measured on
  // fx-glass, mean 8.509 -> 11.187, because removing the group removes the
  // isolation the page actually has (`.glass` carries `isolation: isolate`).
  const children = sortedChildren(node, ctx)
  const paintable = children.filter((id) => !ctx.maskTargets.has(id))
  const clip = paintable.length && isObject(node.clip) ? node.clip : null
  const clipRadii = clip ? normalizeRadii(clip.radii || node.radii, box.w, box.h) : radii
  const clipBox = clip && isObject(clip.rect) ? rectOf(clip.rect) : box
  const childrenBlend = clip ? paintable.some((id) => subtreeBlends(id, ctx)) : false
  // Moving the paint in is exact only when the clip region covers the node's own
  // shape — same rect, corners no rounder than the fill's (a SMALLER clip radius
  // clips LESS) — which is exactly what `overflow` declares: same box, same radii.
  const clipCoversOwnPaint = clip &&
    Math.abs(clipBox.x - box.x) < 0.01 && Math.abs(clipBox.y - box.y) < 0.01 &&
    Math.abs(clipBox.w - box.w) < 0.01 && Math.abs(clipBox.h - box.h) < 0.01 &&
    clipRadii.every((corner, i) => corner[0] <= radii[i][0] + 0.01 && corner[1] <= radii[i][1] + 0.01)
  // Inner shadows must stay composited over the fills they shade, and the short
  // feDropShadow mode (`exactShadows:false`) has no shadow-only form, so both
  // keep the old structure and its declared cost.
  const backdropInClip = childrenBlend && clipCoversOwnPaint &&
    (fills.length > 0 || strokes.length > 0) &&
    !boxEffects.some((e) => e.type === 'innerShadow') &&
    (!boxEffects.length || ctx.exactShadows)
  let clipId = null
  if (clip) {
    if (clip.mode !== 'rect') {
      ctx.note(nodeId, `clip mode "${String(clip.mode)}" is not a rectangle; it is emitted as the box outline.`,
        'emit.svg.clip-not-rect', 'A')
    }
    if (!isObject(clip.rect) && clip.box && clip.box !== 'border') {
      ctx.note(nodeId, `the overflow clip is declared on the ${clip.box} box, but the node carries no ` +
        'padding inset; it is applied to the border box (the radii are the inner ones).',
      'emit.svg.clip-inset-unknown', 'A')
    }
    clipId = defs.add('cp', JSON.stringify(['clip', clipBox, clipRadii]), (id) => [
      `<clipPath id="${id}" clipPathUnits="userSpaceOnUse">`,
      `  ${shapeElement(clipBox, clipRadii, '')}`,
      '</clipPath>',
    ])
  }

  let paintDepth = inner
  let clipDepth = null
  if (backdropInClip) {
    ctx.note(nodeId, 'this node clips its children AND something under it uses mix-blend-mode, so its own ' +
      'fills and strokes are painted INSIDE the clip group, under the children: the group a clip creates ' +
      'is where those blends find their backdrop, and outside it they would composite against nothing and ' +
      'arrive as plain source-over. The overflow clip covers the node\'s own shape exactly, so no paint is ' +
      'lost to it' + (boxEffects.length
      ? '; the outer box-shadow cannot move with them — inside the group the clip would cut it off — so it ' +
        'is cast by a shadow-only silhouette emitted before the group.'
      : '.'),
    'emit.svg.blend-backdrop-in-clip', 'E')
    if (boxEffects.length) {
      const bleed = filterBleed(boxEffects)
      const region = { x: -bleed, y: -bleed, w: box.w + 2 * bleed, h: box.h + 2 * bleed }
      const filterId = dropShadowOnlyFilter(boxEffects, region, defs, ctx, nodeId)
      // An opaque stand-in, not a copy of the fills: the filter reads only
      // SourceAlpha, and opaque is the alpha CSS casts from (a translucent
      // background does not thin its box-shadow).
      out.push(inner, `<g filter="url(#${filterId})">`)
      out.push(inner + 1, shapeElement(box, radii, 'fill="#000"'))
      out.push(inner, '</g>')
    }
    out.push(inner, `<g clip-path="url(#${clipId})">`)
    paintDepth = inner + 1
    clipDepth = paintDepth
  } else if (boxEffects.length) {
    if (!fills.length && !strokes.length) {
      ctx.note(nodeId, 'the node has a box-shadow but no fill or stroke to cast it from; ' +
        'the shadow follows whatever silhouette its own paint has, which is empty.',
        'emit.svg.shadow-no-silhouette', 'A')
    }
    const bleed = filterBleed(boxEffects)
    const region = { x: -bleed, y: -bleed, w: box.w + 2 * bleed, h: box.h + 2 * bleed }
    const filterId = boxShadowFilter(boxEffects, region, defs, ctx, nodeId)
    if (boxEffects.some((e) => e.type === 'innerShadow') && strokes.length) {
      ctx.note(nodeId, 'an inner shadow is composited over the border as well as the background; ' +
        'CSS paints it between the two.',
        'emit.svg.inner-shadow-over-border', 'A')
    }
    out.push(inner, `<g filter="url(#${filterId})">`)
    paintDepth = inner + 1
  }
  if (fills.length) emitFills(out, paintDepth, fills, box, radii, defs, ctx, nodeId)
  if (strokes.length) emitStrokes(out, paintDepth, strokes, box, radii, defs, ctx, nodeId)
  // Over the element's own background and border, which is where the UA paints
  // the widget, and under the children — a control has none, but a `<progress>`
  // with a fallback label does.
  if (node.control) emitControl(out, paintDepth, node, nodeId, box, radii, ctx)
  if (node.type === 'text') emitText(out, paintDepth, node, nodeId, defs, ctx, content)
  if (node.type === 'vector') emitVector(out, paintDepth, node, nodeId, ctx, box, radii, defs)
  if (node.type === 'image' && !fills.length) {
    ctx.note(nodeId, 'an image node carries no image fill; nothing is painted for it.',
      'emit.svg.image-node-empty', 'O')
  }
  if (boxEffects.length && clipDepth === null) out.push(inner, '</g>')
  if (!paintsSomething && node.type !== 'group' && node.type !== 'frame' && node.type !== 'vector') {
    ctx.note(nodeId, `a ${String(node.type)} node paints nothing; it is emitted as an empty group.`,
      'emit.svg.node-paints-nothing', 'O')
  }

  // Children. The overflow clip applies to descendants and to the element's own
  // content, never to its background and border — those join the clip group only
  // when a blending descendant needs them as backdrop (`backdropInClip`, above,
  // where covering the shape exactly makes the clip a no-op on them).
  if (paintable.length) {
    let childDepth = clipDepth !== null ? clipDepth : inner
    if (clip && clipDepth === null) {
      out.push(inner, `<g clip-path="url(#${clipId})">`)
      childDepth = inner + 1
      if (childrenBlend) {
        ctx.note(nodeId, 'this node clips its children AND something under it uses mix-blend-mode. The clip ' +
          'group isolates them, so those blends composite against an empty backdrop instead of this node\'s ' +
          'own background and arrive as plain source-over. Measured on demo/challenges.html -> fx-glass: the ' +
          'panel reads magenta where the page paints orange (pixel 400,250: live 255,121,36, emitted ' +
          '255,91,81).', 'emit.svg.blend-isolated-by-clip', 'C')
      }
    }
    for (const id of paintable) emitNode(out, childDepth, id, ctx.nodes[id], defs, ctx, ownDepth, content)
    if (childDepth !== inner) out.push(inner, '</g>')
  }

  if (ctx.debugPaint) {
    const tint = debugColor(ownDepth)
    out.push(inner, shapeElement(box, radii,
      `fill="${tint}" fill-opacity="0.16" stroke="${tint}" stroke-opacity="0.75" ` +
      'stroke-width="1" pointer-events="none"'))
  }

  out.push(depth, '</g>')
}

// ——— form controls ———

/**
 * The widget a native control paints, as real primitives.
 *
 * `paint.js` (`describeWidget`) reads the SEMANTICS — which control, checked or
 * not, where the value sits in its range, which accent colour — and this draws
 * them. The split is the point: nothing here touches the DOM and nothing there
 * knows what a checkmark looks like.
 *
 * Every proportion below is a fraction of the control's own box and was measured
 * off Chromium's raster at dpr 4 (`scratchpad/probe-ink.mjs`, on
 * `demo/challenges.html#fx-form` at the sizes the fixture uses):
 *
 * | what | measured (16px control) | as a fraction |
 * |---|---|---|
 * | checkbox corner radius | 2px | 0.125 · min(w,h) |
 * | checkbox border (unchecked) | 1px `#767676` | 0.0625 · min(w,h) |
 * | checkmark stroke | 2px, round caps | 0.125 · min(w,h) |
 * | checkmark vertices | ink 2.5..13.25 vertical, vertex at x 6.4 | (0.22,0.60) (0.40,0.75) (0.75,0.26) |
 * | radio outer / white / dot | Ø16 / Ø14 / Ø9.5 | 0.5 / 0.4375 / 0.29 · min(w,h) |
 * | slider track | 6px tall, fully rounded, `#efefef` | 0.375 · h |
 * | slider thumb | Ø15, centre at 7.5 + f·(w−15) | min(w,h) − 1 |
 * | select chevron | 8 × 4 stroke 1.5, right edge 4px in from the border | fixed, clamped to the box |
 *
 * They are Chromium's, they are a version's, and they are not the widget the
 * user's platform draws. `B4.form-control` on the node says exactly that; this
 * function adds `emit.svg.control-reconstructed` so the claim is also in the
 * BACKEND's diagnostics, where a consumer reading only the SVG will see it.
 *
 * @returns {boolean} whether anything was drawn
 */
function emitControl(out, depth, node, nodeId, box, radii, ctx) {
  const control = isObject(node.control) ? node.control : null
  if (!control) return false
  if (!(box.w > 0) || !(box.h > 0)) {
    ctx.note(nodeId, `a ${String(control.kind)} control has an empty box, so its widget is not drawn.`,
      'emit.svg.control-empty-box', 'O')
    return false
  }
  const s = Math.min(box.w, box.h)
  const fill = (rgba) => paintAttrs(rgba, 'fill')
  const rows = []
  const rtl = control.direction === 'rtl'

  const drawCheck = () => {
    const r = 0.125 * s
    const bw = 0.0625 * s
    if (control.checked || control.indeterminate) {
      rows.push(shapeElement(box, [[r, r], [r, r], [r, r], [r, r]], fill(control.accent)))
      const d = control.indeterminate
        ? `M${num(0.22 * box.w)} ${num(0.5 * box.h)} L${num(0.78 * box.w)} ${num(0.5 * box.h)}`
        : `M${num(0.22 * box.w)} ${num(0.6 * box.h)} L${num(0.4 * box.w)} ${num(0.75 * box.h)} ` +
          `L${num(0.75 * box.w)} ${num(0.26 * box.h)}`
      rows.push(`<path d="${d}" fill="none" ${paintAttrs(control.ink, 'stroke')} ` +
        `stroke-width="${num(0.125 * s)}" stroke-linecap="round" stroke-linejoin="round"/>`)
      return
    }
    const inner = { x: bw / 2, y: bw / 2, w: box.w - bw, h: box.h - bw }
    const ir = Math.max(0, r - bw / 2)
    rows.push(shapeElement(inner, [[ir, ir], [ir, ir], [ir, ir], [ir, ir]],
      `${fill(control.surface)} ${paintAttrs(control.border, 'stroke')} stroke-width="${num(bw)}"`))
  }

  const drawRadio = () => {
    const cx = box.w / 2
    const cy = box.h / 2
    const R = s / 2
    const bw = 0.0625 * s
    const circle = (r, attrs) => `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}" ${attrs}/>`
    if (control.checked) {
      rows.push(circle(R, fill(control.accent)))
      rows.push(circle(R - bw, fill(control.surface)))
      rows.push(circle(0.29 * s, fill(control.accent)))
      return
    }
    rows.push(circle(Math.max(0, R - bw / 2),
      `${fill(control.surface)} ${paintAttrs(control.border, 'stroke')} stroke-width="${num(bw)}"`))
  }

  const drawRange = () => {
    const th = Math.max(1, 0.375 * box.h)
    const track = { x: 0, y: (box.h - th) / 2, w: box.w, h: th }
    const tr = [[th / 2, th / 2], [th / 2, th / 2], [th / 2, th / 2], [th / 2, th / 2]]
    rows.push(shapeElement(track, tr, fill(control.track)))
    if (!isNum(control.fraction)) {
      ctx.note(nodeId, `a range control carries no readable value (${JSON.stringify(control.value)} of ` +
        `${control.min}..${control.max}); its track is drawn and its thumb is not.`,
      'emit.svg.control-no-value', 'O')
      return
    }
    const r = Math.max(th / 2, s / 2 - 0.5)
    const cx = rtl
      ? box.w - r - control.fraction * (box.w - 2 * r)
      : r + control.fraction * (box.w - 2 * r)
    const filled = rtl
      ? { x: cx, y: track.y, w: box.w - cx, h: th }
      : { x: 0, y: track.y, w: cx, h: th }
    if (filled.w > 0) rows.push(shapeElement(filled, tr, fill(control.accent)))
    rows.push(`<circle cx="${num(cx)}" cy="${num(box.h / 2)}" r="${num(r)}" ${fill(control.accent)}/>`)
  }

  const drawBar = () => {
    rows.push(shapeElement(box, radii, fill(control.track)))
    if (!isNum(control.fraction)) {
      ctx.note(nodeId, `this <${control.kind}> is indeterminate (value ${JSON.stringify(control.value)}), which the ` +
        'UA paints as a moving stripe; only its track is drawn, because a bar would state a value the ' +
        'page does not have.',
      'emit.svg.control-indeterminate', 'O')
      return
    }
    const bar = { x: rtl ? box.w * (1 - control.fraction) : 0, y: 0, w: box.w * control.fraction, h: box.h }
    if (!(bar.w > 0)) return
    // The end the bar STARTS from keeps the track's corners and the end it stops
    // at is square, which is what a bar clipped to a pill track looks like — and
    // it is one `<rect>` rather than a `<clipPath>` plus a group. That matters
    // beyond tidiness: FIGMA_FINDINGS.md records a `userSpaceOnUse` clip inside a
    // transformed group being resolved differently from the shape next to it.
    const [tl, tr, br, bl] = normalizeRadii(radii, box.w, box.h)
    const full = control.fraction >= 1
    const barRadii = full ? [tl, tr, br, bl]
      : rtl ? [ZERO_RADII[0], tr, br, ZERO_RADII[3]] : [tl, ZERO_RADII[1], ZERO_RADII[2], bl]
    rows.push(shapeElement(bar, normalizeRadii(barRadii, bar.w, bar.h), fill(control.accent)))
  }

  const drawSelect = () => {
    const inset = isObject(control.inset) ? control.inset : { left: 0, right: 0 }
    const W = Math.min(8, Math.max(4, box.w * 0.4))
    const H = W / 2
    const sw = Math.min(1.5, W / 5)
    const cy = box.h / 2
    // Measured on the fixture: the arrow's outer edge sits 4px inside the border
    // edge, NOT inside the padding — a 11px right padding did not move it.
    const x1 = rtl ? finite(inset.left) + 4 + W : box.w - finite(inset.right) - 4
    const x0 = x1 - W
    rows.push(`<path d="M${num(x0)} ${num(cy - H / 2)} L${num(x0 + W / 2)} ${num(cy + H / 2)} ` +
      `L${num(x1)} ${num(cy - H / 2)}" fill="none" ${paintAttrs(control.ink, 'stroke')} ` +
      `stroke-width="${num(sw)}" stroke-linecap="round" stroke-linejoin="round"/>`)
  }

  switch (control.kind) {
    case 'checkbox': drawCheck(); break
    case 'radio': drawRadio(); break
    case 'range': drawRange(); break
    case 'progress': case 'meter': drawBar(); break
    case 'select': drawSelect(); break
    default:
      ctx.note(nodeId, `the control descriptor names a widget this backend does not draw ` +
        `(${JSON.stringify(control.kind)}); the box is emitted without it.`,
      'emit.svg.control-unknown', 'O')
      return false
  }
  if (!rows.length) return false

  out.push(depth, `<g data-control="${escAttr(String(control.kind))}">`)
  out.merge(depth + 1, rows)
  out.push(depth, '</g>')
  ctx.note(nodeId, `the ${control.kind} widget is drawn from primitives at Chromium's measured ` +
    'proportions — it is a reconstruction from the element\'s type, state and accent-color, not a ' +
    'capture of the widget the platform paints, and another engine or theme draws it differently.' +
    (control.disabled ? ' The control is disabled, and the greying a UA applies to a disabled widget is not modelled.' : ''),
  'emit.svg.control-reconstructed', 'A')
  return true
}

/**
 * A `vector` node is passthrough SVG whose ids the collector has already
 * namespaced. The contract does not name the field that carries it, so both
 * spellings the format skeleton implies are accepted and anything else is
 * declared rather than dropped in silence.
 */
function emitVector(out, depth, node, nodeId, ctx, box, radii, defs) {
  const raw = typeof node.svg === 'string' ? node.svg
    : isObject(node.vector) && typeof node.vector.markup === 'string' ? node.vector.markup
      : typeof node.vector === 'string' ? node.vector : null
  // One asset, two nodes: an image asset is cached by URL, so one icon used
  // twice is the same markup — and the same ids — twice in one document. Every
  // copy after the first is renamed. The node carries the markup rather than an
  // asset reference, so identity is the markup itself; two different files that
  // happened to key alike would only cost a rename nobody needed.
  const prefix = typeof node.svgPrefix === 'string' ? node.svgPrefix
    : (isObject(node.vector) && typeof node.vector.idPrefix === 'string' ? node.vector.idPrefix : null)
  const markup = raw === null ? null
    : markupInstance(raw, `svg:${raw.length}:${raw.slice(0, 120)}`, prefix, ctx, nodeId)
  if (!markup) {
    ctx.note(nodeId, 'a vector node carries no passthrough markup; it is emitted as an empty group.',
      'emit.svg.vector-no-markup', 'O')
    return
  }
  // The markup is in the asset's own natural units. `svgPlacement` is the
  // `object-fit`/`object-position` result the collector already solved: `crop` is
  // the window of source pixels that survives and `transform` maps the unit
  // square of that window onto the node's box. Composing the two lands the
  // markup where the browser paints it; without it an `<img src=*.svg>` with
  // `object-fit: cover` would draw at natural size in the corner.
  const place = isObject(node.svgPlacement) ? node.svgPlacement : null
  const crop = place && isObject(place.crop) ? place.crop : null
  const m = place && Array.isArray(place.transform) && place.transform.length === 6 ? place.transform : null
  if (!crop || !m || !(crop.w > 0) || !(crop.h > 0)) {
    if (place) {
      ctx.note(nodeId, 'the vector placement is unreadable or empty; the markup is drawn at the node origin ' +
        'at its own natural size.', 'emit.svg.vector-placement-unknown', 'A')
    }
    out.merge(depth, markup.split(/\r?\n/))
    return
  }
  const sx = m[0] / crop.w
  const sy = m[3] / crop.h
  const tx = m[4] - crop.x * sx
  const ty = m[5] - crop.y * sy
  const identity = Math.abs(sx - 1) < 1e-6 && Math.abs(sy - 1) < 1e-6 &&
    Math.abs(tx) < 1e-6 && Math.abs(ty) < 1e-6 && !m[1] && !m[2]
  // Two clips, both real. `object-fit: cover` overflows the box on purpose, so
  // the crop has to be enforced and not promised; and a rounded box rounds its
  // replaced content too, which is why `.im-srcset`'s 10px radius came out as
  // four square corners.
  const overflows = m[4] < -0.01 || m[5] < -0.01 ||
    m[4] + m[0] > box.w + 0.01 || m[5] + m[3] > box.h + 0.01
  const rounded = Array.isArray(radii) && radii.some((r) => Array.isArray(r) ? r.some((v) => v > 0.01) : r > 0.01)
  const rect = { x: m[4], y: m[5], w: m[0], h: m[3] }
  let inner = depth
  if (overflows || rounded) {
    const clipId = defs.add('cp', JSON.stringify(['vec', rect, rounded ? radii : null, box.w, box.h]), (id) => {
      const rows = [`<clipPath id="${id}" clipPathUnits="userSpaceOnUse">`]
      // Nesting one clipPath inside another is how SVG 1.1 spells intersection.
      if (overflows && rounded) {
        rows.push(`  <rect x="${num(rect.x)}" y="${num(rect.y)}" width="${num(rect.w)}" ` +
          `height="${num(rect.h)}" clip-path="url(#${id}__box)"/>`)
      } else if (overflows) {
        rows.push(`  <rect x="${num(rect.x)}" y="${num(rect.y)}" width="${num(rect.w)}" height="${num(rect.h)}"/>`)
      } else {
        rows.push(`  ${shapeElement(box, radii, '')}`)
      }
      rows.push('</clipPath>')
      if (overflows && rounded) {
        rows.unshift(`<clipPath id="${id}__box" clipPathUnits="userSpaceOnUse">`,
          `  ${shapeElement(box, radii, '')}`, '</clipPath>')
      }
      return rows
    })
    out.push(inner, `<g clip-path="url(#${clipId})">`)
    inner += 1
  }
  if (!identity) {
    out.push(inner, `<g transform="matrix(${num(sx)} 0 0 ${num(sy)} ${num(tx)} ${num(ty)})">`)
    out.merge(inner + 1, markup.split(/\r?\n/))
    out.push(inner, '</g>')
  } else {
    out.merge(inner, markup.split(/\r?\n/))
  }
  if (overflows || rounded) out.push(depth, '</g>')
}

/**
 * `clip-path` as a real `<clipPath>`. `collect/box.js` resolved the basic shape
 * against its reference box, so everything here is node-local px and no
 * percentage survives — which is what lets the same def be shared by content.
 *
 * @returns {string|null} the def id, or null when there is no shape
 */
function emitClipShape(shape, nodeId, defs, ctx) {
  if (!isObject(shape)) return null
  const rule = shape.rule === 'evenodd' ? ' clip-rule="evenodd"' : ''
  let body = null
  if (shape.kind === 'polygon' && Array.isArray(shape.points) && shape.points.length > 2) {
    body = `<polygon points="${shape.points.map((p) => `${num(p[0])},${num(p[1])}`).join(' ')}"${rule}/>`
  } else if (shape.kind === 'ellipse' && isNum(shape.rx) && isNum(shape.ry)) {
    body = `<ellipse cx="${num(shape.cx)}" cy="${num(shape.cy)}" rx="${num(Math.max(0, shape.rx))}" ` +
      `ry="${num(Math.max(0, shape.ry))}"/>`
  } else if ((shape.kind === 'inset' || shape.kind === 'rect') && isObject(shape.rect)) {
    const r = rectOf(shape.rect)
    const radii = shape.kind === 'rect' ? shape.radii : shape.round
    body = `  ${shapeElement(r, normalizeRadii(radii, r.w, r.h), '')}`.trim()
  } else if (shape.kind === 'path' && typeof shape.d === 'string' && shape.d) {
    body = `<path d="${escAttr(shape.d)}"${rule}/>`
  }
  if (!body) {
    ctx.note(nodeId, `a clip-path of kind "${String(shape.kind)}" reached the emitter with no geometry it ` +
      'could draw; the node is emitted unclipped, at its full rectangle.',
      'emit.svg.clip-path-unknown', 'O')
    return null
  }
  return defs.add('cs', JSON.stringify(['shape', shape]), (id) => [
    `<clipPath id="${id}" clipPathUnits="userSpaceOnUse">`,
    `  ${body}`,
    '</clipPath>',
  ])
}

/**
 * `mask` points at another node, which is elsewhere in the tree with its own
 * `abs`. Rendering it into a `<mask>` means translating it into this node's
 * local space — the deltas of the two `abs` boxes, no matrix needed.
 */
function emitMask(node, nodeId, defs, ctx) {
  const mask = isObject(node.mask) ? node.mask : null
  const target = mask && typeof mask.node === 'string' ? ctx.nodes[mask.node] : null
  if (!target) {
    ctx.note(nodeId, 'the mask references a node that is not in the document; the node is emitted unmasked.',
      'emit.svg.mask-missing', 'O')
    return null
  }
  const here = isObject(node.abs) ? rectOf(node.abs) : { x: 0, y: 0 }
  const there = isObject(target.abs) ? rectOf(target.abs) : { x: 0, y: 0 }
  const body = createWriter(0)
  const wasVisited = ctx.visited.has(mask.node)
  ctx.visited.delete(mask.node)
  emitNode(body, 1, mask.node, target, defs, ctx, 0)
  if (wasVisited) ctx.visited.add(mask.node)
  const type = mask.type === 'alpha' ? 'alpha' : 'luminance'
  const extent = subtreeExtent(node, ctx)
  const key = JSON.stringify([mask.node, type, here.x - there.x, here.y - there.y, body.rows])
  return defs.add('mk', key, (id) => [
    `<mask id="${id}" maskUnits="userSpaceOnUse" x="${num(extent.x)}" y="${num(extent.y)}" ` +
    `width="${num(extent.w)}" height="${num(extent.h)}" style="mask-type:${type}">`,
    `  <g transform="translate(${num(there.x - here.x)} ${num(there.y - here.y)})">`,
    ...body.rows.map((line) => `  ${line}`),
    '  </g>',
    '</mask>',
  ])
}

// ——— fonts ———

/** The first family of the stack, unquoted — the name a viewer has to resolve. */
function familyOf(style) {
  const raw = typeof style.family === 'string' && style.family ? style.family
    : typeof style.stack === 'string' ? style.stack.split(',')[0] : ''
  return raw.trim().replace(/^['"]|['"]$/g, '')
}

/**
 * `@font-face` rules for the embedded font assets. A standalone SVG that carries
 * its own binaries renders the same everywhere; without them the whole point of
 * `textLength` is to paper over a substituted font.
 */
function fontFaceRules(doc, ctx) {
  const styles = isObject(doc.styles) && isObject(doc.styles.text) ? doc.styles.text : {}
  const assets = isObject(doc.assets) ? doc.assets : {}
  const rules = []
  const done = new Set()
  const byName = new Set()
  for (const key of Object.keys(styles)) {
    const style = styles[key]
    if (!isObject(style)) continue
    if (typeof style.font !== 'string') {
      // No font asset at all: the family travels as a NAME. Declaring this is not
      // pedantry — the substitute a viewer picks has its own advances, so the
      // line breaks are the page's and the line WIDTHS are the viewer's, and
      // `emitText` gives up `textLength` rather than force one onto the other.
      const family = familyOf(style)
      if (family && !RESOLVABLE_FAMILIES.has(family.toLowerCase()) && !byName.has(family)) {
        byName.add(family)
        ctx.note(null, `no binary travels for "${family}": the SVG names the family and the viewer decides. ` +
          'On a machine without it the substitute sets its own glyph advances, so a line is positioned where it ' +
          'was measured but is as wide as the substitute makes it. The collector (`collect/font.js`) embeds ' +
          'only @font-face-served families it could fetch and cover — a system or locally-installed face has ' +
          'no bytes a page can hand over, and a webfont that failed carries its own assets.* diagnostic.',
        'emit.svg.font-not-embedded', 'A')
      }
      continue
    }
    if (done.has(style.font)) continue
    done.add(style.font)
    const asset = assets[style.font]
    if (!isObject(asset)) {
      ctx.note(null, `text style "${key}" references font asset "${style.font}", which is not in assets; ` +
        'the CSS stack decides the family.', 'emit.svg.font-asset-missing', 'A')
      continue
    }
    if (typeof asset.data !== 'string' || !asset.data) {
      ctx.note(null, `font asset "${style.font}" carries no embedded binary; the SVG falls back to the ` +
        'CSS stack and the glyph advances may not match the measured line widths.',
        'emit.svg.font-not-embedded', 'A')
      continue
    }
    const family = typeof asset.cssFamily === 'string' && asset.cssFamily
      ? asset.cssFamily
      : String(style.stack || style.font).split(',')[0].trim().replace(/^['"]|['"]$/g, '')
    ctx.embeddedFamilies.set(style.font, family)
    const format = FONT_FORMATS[String(asset.mime)] || null
    const parts = [`  font-family: "${family.replace(/"/g, '')}";`]
    parts.push(`  src: url("${asset.data}")${format ? ` format("${format}")` : ''};`)
    // A variable face covers a RANGE and must say so: a `100 900` file declared
    // as one weight makes the browser synthesise every other weight it serves.
    if (typeof asset.weightRange === 'string' && /^\d+\s+\d+$/.test(asset.weightRange)) {
      parts.push(`  font-weight: ${asset.weightRange};`)
    } else if (Number.isFinite(Number(asset.weight))) {
      parts.push(`  font-weight: ${num(asset.weight)};`)
    }
    parts.push(`  font-style: ${asset.italic ? 'italic' : 'normal'};`)
    rules.push(['@font-face {', ...parts, '}'].join('\n'))
    if (asset.subset) {
      ctx.note(null, `font asset "${style.font}" is subsetted; the SVG renders correctly but the binary is ` +
        'not suitable for redistribution or for uploading to a Figma account.',
        'emit.svg.font-subset', 'A')
    }
  }
  return rules
}

// ——— entry point ———

function readRootId(root) {
  if (typeof root === 'string' && root) return root
  if (isObject(root) && typeof root.$ref === 'string' && root.$ref) return root.$ref
  return null
}

/** Diagnostic severity for an SVD fidelity grade, same table the orchestrator uses. */
const SEVERITY_OF = { E: 'info', A: 'info', C: 'info', R: 'warn', RH: 'warn', O: 'warn' }

/**
 * The return value of `svdToSvg`: `{svg, diagnostics}` — AND a string.
 *
 * The diagnostics had to get out (an approximation that only reaches an XML
 * comment is a silent degradation, which is the one thing this engine promises
 * not to do), but three callers already treat the return as markup: the plugin's
 * `vectorSvg` export, and the demo twice, which reads `.length` and assigns it
 * to `innerHTML`.
 * So the object answers to both: `svg`/`diagnostics` for anyone who wants the
 * pair, and `toString`/`length` for anyone who still thinks it is a string.
 * The string-ish members are non-enumerable, so `JSON.stringify` sees the pair
 * and not a map of characters.
 */
function svgResult(svg, diagnostics) {
  const out = { svg, diagnostics }
  Object.defineProperties(out, {
    length: { get: () => svg.length },
    toString: { value: () => svg },
    valueOf: { value: () => svg },
    [Symbol.toPrimitive]: { value: () => svg },
  })
  return out
}

/**
 * Render an SVD document as standalone, flat SVG.
 *
 * @param {object} doc                    an SVD document (`svd/1.0`)
 * @param {object} [options]
 * @param {boolean} [options.debugPaint=false]  tint every node by its stacking-context
 *   depth and give it a `<title>` naming its id, fidelity grade and paint order —
 *   the only way to SEE the paint tree the engine built.
 * @param {'auto'|'always'|'never'} [options.textPerLine='auto']  how a text block
 *   states its line positions. `'auto'`: one `<text>` for a block that fits on one
 *   line, one per line for a block that does not — because an importer that
 *   discards an interior `<tspan>`'s `x`/`y` (Figma) stacks the lines of the
 *   second. `'never'` is the SVG-native shape, one element per block, and reflows
 *   there. `'always'` splits even a single line, for a consumer that wants every
 *   line as its own object.
 * @param {boolean} [options.exactShadows=false]  emit `box-shadow` as the exact
 *   `feMorphology → feGaussianBlur → feOffset → feFlood → feComposite → feMerge`
 *   chain instead of `feDropShadow`. Exact in a browser, and unreadable by an
 *   importer that runs only part of the chain — Figma keeps the flood, loses the
 *   composite, and paints a black rectangle.
 * @param {boolean} [options.textGradientMask=true]  paint a gradient-filled text
 *   block through a `<mask>` of itself (a rect carrying the gradient behind the
 *   glyph silhouette) instead of writing the gradient as the `<text>`'s own
 *   `fill="url(#…)"`. Measured by pasting both into Figma: the fill reference is
 *   not resolved there and the heading arrives BLACK; the mask arrives with the
 *   page's colours and stops being a text layer. `false` takes the other side —
 *   an editable text layer in the wrong colour — and the choice is declared
 *   either way (`emit.svg.text-gradient-mask`, `emit.svg.text-gradient-box`).
 *
 * There is deliberately no `rasterFilters` option HERE. Rasterizing needs a DOM
 * and a wait, and this function has neither; the export that mounts the clone
 * takes that option, paints the PNG and leaves it on the node, and this backend
 * emits an `<image>` for any node carrying one. The decision travels in the
 * document, which is also what keeps `svdToSvg(doc)` a pure function of `doc`.
 * @returns {{svg: string, diagnostics: Diagnostic[]}} the markup, and every
 *   approximation this backend made on the way — `{code, severity, message,
 *   grade, node?}`, the shape `doc.diagnostics` holds, so the orchestrator can
 *   concatenate them and degrade the nodes they name. The same notes are also
 *   written into a comment block under the `<svg>` tag, so the file stays
 *   self-describing on its own. **The result also behaves as the markup string**
 *   (`toString`, `length`) for callers written against the old signature.
 */
export function svdToSvg(doc, {
  debugPaint = false, textPerLine = 'auto', exactShadows = true, textGradientMask = false,
} = {}) {
  if (!isObject(doc)) throw new TypeError('svdToSvg: doc must be an SVD document object')

  const nodes = isObject(doc.nodes) ? doc.nodes : {}
  const seenNotes = new Set()
  const notes = []
  const diagnostics = []
  const ctx = {
    doc,
    nodes,
    debugPaint,
    textPerLine: TEXT_PER_LINE.has(textPerLine) ? textPerLine : 'auto',
    exactShadows: exactShadows !== false,
    // **Default OFF since 2026-08-07, and the flip is the point.** It used to be
    // ON, which bought the page's colours in Figma's SVG importer at the cost of
    // the text layer. Two things changed. Figma has its own channel now
    // (`emit/h2d.js`), so this backend no longer has to bend for an importer that
    // has an alternative; and pasting the masked output into a generic SVG editor
    // showed what the mask costs everywhere else — a renderer without `<mask>`
    // support paints the rect UNMASKED and the heading arrives as a coloured bar
    // with no text in it. `fill="url(#…)"` on a `<text>` is plain SVG 1.1 that
    // every conformant renderer resolves, and it stays one editable element.
    // Measured side by side in Chromium: the two branches are pixel-identical
    // there, and only one of them survives a renderer with no mask.
    textGradientMask: textGradientMask === true,
    visited: new Set(),
    maskTargets: new Set(),
    /**
     * Node id -> the fill attributes its glyphs must use instead of their own.
     * `background-clip: text` is resolved on the element that declares the
     * background and consumed on the text node that paints the glyphs, and the
     * two are different nodes emitted at different times.
     * @type {Map<string, string[]>}
     */
    textPaint: new Map(),
    /**
     * Text node id -> the character ranges an INLINE element's `background-clip: text`
     * paints (`inlineTextTargets`). Those glyphs are runs of their block's text node,
     * so the paint covers a range of it and not the whole node.
     * @type {Map<string, {from:number, to:number, attrs:string[]}[]>}
     */
    textRangePaint: new Map(),
    /** Child id -> parent id, built by `parentOf` on first use. @type {Map<string, string>|null} */
    parents: null,
    embeddedFamilies: new Map(),
    /**
     * Asset key -> how many times its markup has been spliced into this
     * document. One asset painted twice is one set of ids painted twice, and
     * `markupInstance` renames every copy after the first.
     * @type {Map<string, number>}
     */
    markupInstances: new Map(),
    /**
     * One approximation, in both channels: the XML comment (so the file is
     * self-describing) and `diagnostics` (so it reaches `doc.diagnostics`).
     *
     * @param {string|null} nodeId  the node it happened on, null for the document
     * @param {string} message      prose, for a human reading the file
     * @param {string} [code]       stable id, so nobody has to regex the prose
     * @param {string} [grade]      SVD fidelity grade this implies for the node
     */
    note(nodeId, message, code = 'emit.svg.approximation', grade = 'A') {
      const key = `${nodeId || ''}::${message}`
      if (seenNotes.has(key)) return
      seenNotes.add(key)
      notes.push(nodeId ? `[${nodeId}] ${message}` : message)
      const entry = { code, severity: SEVERITY_OF[grade] || 'warn', message, grade }
      if (nodeId) entry.node = nodeId
      diagnostics.push(entry)
    },
  }

  if (!TEXT_PER_LINE.has(textPerLine)) {
    ctx.note(null, `textPerLine: "${String(textPerLine)}" is not one of ${[...TEXT_PER_LINE].join(', ')}; ` +
      '"auto" is used. An option the emitter does not understand is not a preference it can honour.',
      'emit.svg.option-unknown', 'A')
  }

  // A node used as a mask is painted into the <mask>, not into the tree.
  for (const id of Object.keys(nodes)) {
    const node = nodes[id]
    if (isObject(node) && isObject(node.mask) && typeof node.mask.node === 'string') {
      ctx.maskTargets.add(node.mask.node)
    }
  }

  const rootId = readRootId(doc.root)
  const root = rootId !== null ? nodes[rootId] : null

  const capture = isObject(doc.capture) ? doc.capture : {}
  const captureRoot = isObject(capture.root) ? capture.root : null
  const rootFrame = isObject(root) ? frameOf(root) : { x: 0, y: 0, w: 0, h: 0 }
  const width = captureRoot && finite(captureRoot.w) > 0 ? finite(captureRoot.w) : rootFrame.w
  const height = captureRoot && finite(captureRoot.h) > 0 ? finite(captureRoot.h) : rootFrame.h

  const defs = createDefs()
  const body = createWriter(1)
  const fonts = fontFaceRules(doc, ctx)

  if (!isObject(root)) {
    ctx.note(null, `root ${rootId === null ? 'is missing' : `"${rootId}" does not resolve to a node`}; ` +
      'the document is emitted empty.',
      'emit.svg.root-missing', 'O')
  } else {
    emitNode(body, 0, rootId, root, defs, ctx, 0)
    const orphans = Object.keys(nodes).filter((id) => !ctx.visited.has(id) && !ctx.maskTargets.has(id))
    if (orphans.length) {
      ctx.note(null, `${orphans.length} node(s) are not reachable from the root and are not emitted: ` +
        `${orphans.slice(0, 8).join(', ')}${orphans.length > 8 ? ', …' : ''}.`,
      'emit.svg.orphan-nodes', 'O')
    }
  }

  const out = createWriter(0)
  out.push(0, `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}" ` +
    'text-rendering="geometricPrecision">')

  if (notes.length) {
    out.push(1, `<!-- snapdom-vector svg-flat: ${notes.length} approximation(s) — nothing here is silent.`)
    for (const note of notes) out.push(2, `· ${escComment(note)}`)
    out.push(1, '-->')
  }

  const generator = isObject(doc.generator) ? doc.generator : {}
  out.push(1, `<title>${escText(capture.selector || generator.name || 'snapdom vector capture')}</title>`)
  out.push(1, `<desc>${escText(`${generator.name || '@zumer/snapdom-vector'} ${generator.version || ''} · ` +
    `${doc.schema || 'svd'} · ${capture.url || ''} ${capture.capturedAt || ''}`.trim())}</desc>`)

  if (fonts.length || defs.chunks.length) {
    out.push(1, '<defs>')
    if (fonts.length) {
      out.push(2, '<style type="text/css"><![CDATA[')
      for (const rule of fonts) out.merge(3, rule.split('\n'))
      out.push(2, ']]></style>')
    }
    for (const chunk of defs.chunks) out.merge(2, chunk)
    out.push(1, '</defs>')
  }

  out.rows.push(...body.rows)
  out.push(0, '</svg>')
  return svgResult(`${out.rows.join('\n')}\n`, diagnostics)
}

export default svdToSvg
