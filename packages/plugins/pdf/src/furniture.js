/**
 * Page furniture: the header and footer bands, and the page number.
 *
 * The two are drawn by different means on purpose. A header or footer is a piece
 * of your page, so it is CAPTURED — same engine, same fidelity, whatever CSS you
 * put in it. A page number is one short string that changes on every page, so it
 * is drawn as real PDF text: crisp at any zoom, a few bytes, and selectable and
 * searchable like the rest of the layer.
 *
 * Element bands are captured once before pagination. Their authoritative height
 * comes from the final artifact's aspect ratio, so effects and render hooks cannot
 * make the reserved strip disagree with what is drawn.
 */
import { snapdom } from '@zumer/snapdom'

const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback
const nonNegative = (value, fallback) => Number.isFinite(value) && value >= 0 ? value : fallback

/**
 * Cheap standalone estimate from an element's current box. The PDF exporter does
 * not use this for pagination; captured artifact geometry is authoritative there.
 *
 * @param {Element|null} el
 * @param {number} availW  printable width in points
 * @returns {number} height in points, 0 when there is no band
 */
export function bandHeight(el, availW) {
  if (!el || typeof el.getBoundingClientRect !== 'function' ||
      !Number.isFinite(availW) || availW <= 0) return 0
  const r = el.getBoundingClientRect()
  if (!r.width || !r.height) return 0
  return r.height * (availW / r.width)
}

/**
 * Capture a band and hand back what `addStream` needs. Its height is derived from
 * the FINAL artifact, not measured again from the live element: index.js captures
 * bands before pageBox, and render hooks may change the artifact's aspect.
 *
 * The band rides the SAME scale and dpr as the page it sits on, so a header never
 * looks softer or sharper than the content under it.
 *
 * @param {Element} el
 * @param {{scale: number, dpr: number, quality: number,
 *          backgroundColor: string|null, availW: number}} opts
 */
export async function captureBand(el, options, encodeImage) {
  const img = await captureElement(el, options, encodeImage)
  const availW = positive(options.availW, 0)
  const aspect = positive(img.aspect, 0)
  return { ...img, heightPt: availW * aspect }
}

/**
 * Capture any element as an image XObject, plus its own aspect ratio — which is
 * all a cover, a closing page or an element watermark needs, none of which is
 * bound to the printable width the way a band is.
 *
 * @returns {Promise<object>} what `addStream` needs, plus `aspect` (height/width).
 */
export async function captureElement(el, {
  scale, dpr, quality, backgroundColor, codec, captureOptions = {}, image = true,
}, encodeImage) {
  if (!el || el.nodeType !== 1) throw new TypeError('captureElement: expected an Element')
  if (image && typeof encodeImage !== 'function') throw new TypeError('captureElement: encodeImage must be a function')
  const rasterScale = positive(scale, 1)
  const rasterDpr = positive(dpr, 1)
  const source = {
    baseURL: String(el.ownerDocument?.baseURI || document.baseURI),
    documentURL: String(el.ownerDocument?.location?.href || el.ownerDocument?.baseURI || location.href),
    documentLang: String(el.ownerDocument?.documentElement?.lang || ''),
  }
  const result = await snapdom(el, {
    ...captureOptions,
    outerShadows: captureOptions.outerShadows ?? false,
    outerTransforms: captureOptions.outerTransforms ?? true,
    scale: rasterScale, dpr: rasterDpr,
    ...(backgroundColor ? { backgroundColor } : {}),
  })
  const meta = result.meta
  if (!meta || !Number.isFinite(meta.vbW) || !Number.isFinite(meta.vbH)) {
    throw new Error('captureElement: snapdom did not expose final render geometry')
  }

  const base = {
    url: result.url,
    meta,
    vbW: meta.vbW,
    vbH: meta.vbH,
    offX: meta.contentX,
    offY: meta.contentY,
    aspect: meta.vbW > 0 ? meta.vbH / meta.vbW : 1,
    source,
  }
  if (!image) return base

  const canvas = await result.toCanvas({ backgroundColor: null })
  const img = await encodeImage(canvas, { quality, background: backgroundColor, codec })

  // Geometry is the immutable render contract returned by SnapDOM, so asymmetric
  // bleed and transformed roots need no canvas-size heuristic here.
  return {
    ...img,
    ...base,
  }
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/** `rg` wants three 0–1 components; anything unparseable stays the caller's grey. */
function rgb(colour) {
  const m = HEX.exec(String(colour || '').trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const n = parseInt(h, 16)
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]
}

/**
 * Normalise the `pageNumbers` option. `true` is the whole feature for most
 * callers, so it has to mean something complete on its own.
 */
export function numberSpec(option) {
  if (!option) return null
  const o = option === true ? {} : option
  return {
    format: typeof o.format === 'function' ? o.format : (page, pages) => `${page} / ${pages}`,
    align: o.align === 'left' || o.align === 'right' ? o.align : 'center',
    size: positive(o.size, 9),
    font: o.font === 'serif' || o.font === 'mono' || o.font === 'sans'
      ? o.font
      // The document's own embedded face when the export has one; an explicit
      // base-14 request keeps meaning exactly what it says.
      : 'document',
    colour: rgb(o.color ?? o.colour) || [0.36, 0.39, 0.47],
  }
}

/**
 * Content-stream ops for one page's number, drawn in the bottom margin — below a
 * footer band if there is one, so the two never fight over the same strip.
 *
 * @returns {{ops: string[], font: object}|null} null when the string is empty or
 *   unrepresentable, which is the caller's cue not to add a font resource.
 */
export function numberOps({ spec, page, pages, pageW, marginX, marginY, availW, pdfText }) {
  const str = String(spec.format(page, pages) ?? '')
  if (!str.trim()) return null
  const drawn = pdfText(str, spec.font, spec.size)
  if (!drawn) return null
  const { str: encoded, font, width } = drawn

  const x = spec.align === 'left' ? marginX
    : spec.align === 'right' ? marginX + availW - width
    : marginX + (availW - width) / 2
  // Sat in the middle of the bottom margin, on its own baseline.
  const y = Math.max(2, marginY / 2 - spec.size * 0.35)

  return {
    font,
    ops: [
      'q',
      `${spec.colour.map(c => c.toFixed(3)).join(' ')} rg`,
      // `0 Tr` is not redundant: the render mode is graphics state and survives ET,
      // so the invisible layer drawn above would otherwise make this ghost too —
      // present in the file, extractable, and painted by nobody.
      `BT 0 Tr /${font.name} ${spec.size} Tf 1 0 0 1 ${x.toFixed(3)} ${y.toFixed(3)} Tm ${encoded} Tj ET`,
      'Q',
    ],
  }
}


/**
 * Normalise a header or footer into one of two shapes.
 *
 * A string or an object of segments becomes REAL PDF TEXT — selectable, searchable
 * and crisp at any zoom, which is what a running head almost always wants. An
 * Element is captured instead, for the cases text cannot express: a logo, a rule in
 * brand colours, a signature block.
 *
 * @returns {{kind:'text', …}|{kind:'element', el:Element}|null}
 */
export function bandSpec(band) {
  if (!band) return null
  if (typeof band === 'object' && band.nodeType === 1) return { kind: 'element', el: band }
  if (typeof band !== 'string' && typeof band !== 'function' && typeof band !== 'object') return null

  const o = typeof band === 'string' || typeof band === 'function' ? { center: band } : band
  const seg = (v) => (typeof v === 'function' ? v : v == null ? null : () => String(v))
  const spec = {
    kind: 'text',
    left: seg(o.left), center: seg(o.center), right: seg(o.right),
    size: positive(o.size, 9),
    font: o.font === 'serif' || o.font === 'mono' || o.font === 'sans'
      ? o.font
      // The document's own embedded face when the export has one; an explicit
      // base-14 request keeps meaning exactly what it says.
      : 'document',
    colour: rgb(o.color ?? o.colour) || [0.36, 0.39, 0.47],
    rule: o.rule !== false,
    gap: nonNegative(o.gap, 10),
  }
  return spec.left || spec.center || spec.right ? spec : null
}

/** How much of the page a text band takes, in points. */
export function textBandHeight(spec) {
  return positive(spec && spec.size, 9) * 1.4 + nonNegative(spec && spec.gap, 10) + (spec && spec.rule ? 1 : 0)
}

/**
 * Content-stream ops for a text band. The three segments are independent, so a
 * left-aligned title and a right-aligned date never collide the way one centred
 * string with padding would.
 */
export function textBandOps({ spec, where, page, pages, pageH, marginX, marginY, availW, pdfText }) {
  const height = textBandHeight(spec)
  // The band occupies a strip against its margin; the rule always sits on the
  // CONTENT side of the text, with the gap between them. Getting this the same way
  // round for both put the footer's rule straight through its own words.
  const top = where === 'header' ? pageH - marginY : marginY + height
  const baseline = where === 'header'
    ? top - spec.size
    : top - spec.gap - spec.size * 0.8
  const ruleY = where === 'header' ? top - height + spec.gap : top - 0.5

  const ops = ['q', `${spec.colour.map(c => c.toFixed(3)).join(' ')} rg`]
  const fonts = new Set()
  for (const [key, align] of [['left', 'left'], ['center', 'center'], ['right', 'right']]) {
    if (!spec[key]) continue
    const str = String(spec[key](page, pages) ?? '')
    if (!str.trim()) continue
    const drawn = pdfText(str, spec.font, spec.size)
    if (!drawn) continue
    const { str: encoded, font, width } = drawn
    const x = align === 'left' ? marginX
      : align === 'right' ? marginX + availW - width
      : marginX + (availW - width) / 2
    // `0 Tr` explicitly: render mode is graphics state and survives ET, so the
    // invisible layer drawn earlier would otherwise make this a ghost.
    ops.push(`BT 0 Tr /${font.name} ${spec.size} Tf 1 0 0 1 ${x.toFixed(3)} ${baseline.toFixed(3)} Tm ${encoded} Tj ET`)
    fonts.add(font)
  }
  if (!fonts.size) return null

  if (spec.rule) {
    ops.push(`${spec.colour.map(c => (c * 0.35 + 0.65).toFixed(3)).join(' ')} RG`,
      '0.5 w', `${marginX} ${ruleY.toFixed(3)} m ${(marginX + availW).toFixed(3)} ${ruleY.toFixed(3)} l S`)
  }
  ops.push('Q')
  return { ops, fonts: [...fonts] }
}

// ——— watermark ———
//
// The one piece of furniture that goes OVER the content rather than beside it,
// which is the whole point: a watermark under the page image would be invisible
// on any page with a background, and a watermark that can be covered is not one.

const clamp01 = (n, fallback) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback)

/**
 * Normalise the `watermark` option. A bare string is the common case and has to
 * mean something complete: grey, translucent, across the diagonal, sized to the
 * page.
 *
 * @returns {{kind:'text'|'element', …}|null}
 */
export function watermarkSpec(option) {
  if (!option) return null
  if (typeof option === 'object' && option.nodeType === 1) {
    return { kind: 'element', el: option, opacity: 0.12, angle: 0, fit: 0.6 }
  }
  const o = typeof option === 'string' ? { text: option } : (option || {})
  if (o.element && o.element.nodeType === 1) {
    return {
      kind: 'element', el: o.element,
      opacity: clamp01(o.opacity, 0.12),
      angle: Number.isFinite(o.angle) ? o.angle : 0,
      fit: clamp01(o.fit, 0.6) || 0.6,
    }
  }
  const text = o.text == null ? '' : String(o.text)
  if (!text.trim()) return null
  return {
    kind: 'text', text,
    // 0 means "as wide as the page will take", which is what a watermark almost
    // always wants and what nobody wants to compute by hand for every page size.
    size: Number.isFinite(o.size) && o.size > 0 ? o.size : 0,
    angle: Number.isFinite(o.angle) ? o.angle : 45,
    opacity: clamp01(o.opacity, 0.12),
    colour: rgb(o.color ?? o.colour) || [0.45, 0.45, 0.5],
    font: o.font === 'serif' || o.font === 'mono' || o.font === 'sans'
      ? o.font
      // The document's own embedded face when the export has one; an explicit
      // base-14 request keeps meaning exactly what it says.
      : 'document',
  }
}

/**
 * Content-stream ops for the watermark, centred on the whole page — the MEDIA
 * box, not the printable area: a watermark inside the margins reads as content.
 *
 * @param {object} args
 * @param {string} args.gs      name of the ExtGState carrying the opacity
 * @param {string} [args.image] name of the XObject, for an element watermark
 * @param {(text: string, key: string, size: number) => ({str, font, width}|null)} [args.pdfText]
 * @returns {{ops: string[], font: object|null}|null}
 */
export function watermarkOps({ spec, pageW, pageH, gs, image, imageAspect, pdfText }) {
  const cx = pageW / 2
  const cy = pageH / 2
  const rad = (spec.angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  if (spec.kind === 'element') {
    if (!image) return null
    // Fit inside the page at `fit` of its smaller dimension, aspect preserved, so
    // a wide stamp on a portrait page is not squashed to fit the width.
    const w = Math.min(pageW, pageH / (imageAspect || 1)) * spec.fit
    const h = w * (imageAspect || 1)
    // A form XObject's unit square maps through `cm`, so the rotation has to be
    // composed with the scale by hand rather than left to a text matrix.
    return {
      font: null,
      ops: [
        'q', `/${gs} gs`,
        `1 0 0 1 ${cx.toFixed(3)} ${cy.toFixed(3)} cm`,
        `${cos.toFixed(5)} ${sin.toFixed(5)} ${(-sin).toFixed(5)} ${cos.toFixed(5)} 0 0 cm`,
        `${w.toFixed(3)} 0 0 ${h.toFixed(3)} ${(-w / 2).toFixed(3)} ${(-h / 2).toFixed(3)} cm`,
        `/${image} Do`, 'Q',
      ],
    }
  }

  // Auto size: the largest the string can be with its ROTATED extent still inside
  // the page, which is what makes one option work on A4, on a receipt roll and on
  // a landscape slide alike.
  //
  // Not the page's diagonal LENGTH — that is the trap. A 486 × 1938 page has a
  // long diagonal and almost no width, and a string sized to that diagonal but
  // laid at 45° runs off both sides: a rotated string of advance W spans W·|cos θ|
  // across and W·|sin θ| down, so each axis caps W on its own and the smaller cap
  // is the one that decides.
  const unit = pdfText(spec.text, spec.font, 1)
  if (!unit) return null
  let size = spec.size
  if (!size) {
    const acrossX = Math.abs(cos) > 1e-6 ? (pageW * 0.9) / Math.abs(cos) : Infinity
    const acrossY = Math.abs(sin) > 1e-6 ? (pageH * 0.9) / Math.abs(sin) : Infinity
    const room = Math.min(acrossX, acrossY)
    size = unit.width > 0 && Number.isFinite(room) ? room / unit.width : 24
  }
  const drawn = pdfText(spec.text, spec.font, size)
  if (!drawn) return null
  const width = drawn.width

  // Centre the STRING on the page centre: back off half an advance along the
  // rotated baseline, and about a third of a size along the rotated up-vector,
  // which puts the x-height band on the centre rather than the baseline.
  const x = cx - (width / 2) * cos + 0.35 * size * sin
  const y = cy - (width / 2) * sin - 0.35 * size * cos

  return {
    font: drawn.font,
    ops: [
      'q', `/${gs} gs`,
      `${spec.colour.map(c => c.toFixed(3)).join(' ')} rg`,
      // `0 Tr` explicitly — render mode survives ET, and the invisible text layer
      // drawn before this would otherwise make the watermark a ghost too.
      `BT 0 Tr /${drawn.font.name} ${size.toFixed(3)} Tf ` +
      `${cos.toFixed(5)} ${sin.toFixed(5)} ${(-sin).toFixed(5)} ${cos.toFixed(5)} ` +
      `${x.toFixed(3)} ${y.toFixed(3)} Tm ${drawn.str} Tj ET`,
      'Q',
    ],
  }
}

/**
 * Content-stream ops that place a captured band across the printable width.
 *
 * @param {'header'|'footer'} where
 */
export function bandOps({ where, name, heightPt, pageH, marginX, marginY, availW }) {
  const bottom = where === 'header'
    ? pageH - marginY - heightPt
    : marginY
  return [
    'q',
    `${availW.toFixed(3)} 0 0 ${heightPt.toFixed(3)} ${marginX.toFixed(3)} ${bottom.toFixed(3)} cm`,
    `/${name} Do`,
    'Q',
  ]
}
