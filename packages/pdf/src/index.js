/**
 * SnapDOM — PDF export: snapdom's raster plus an invisible text layer.
 *
 * The page image is snapdom's own capture, and over it goes an INVISIBLE text
 * layer (Tr 3) positioned from snapdom's final serialized clone, which makes the file
 * selectable, searchable and copy-pasteable, plus real link annotations.
 *
 * The raster is the path because fidelity is not approximated here: the pixels
 * ARE snapdom's, so nothing in the file can disagree with what was on screen —
 * nothing is re-drawn, no CSS is re-modelled, no font is substituted and no
 * layout is recomputed. The text layer buys back everything a picture loses,
 * without touching a pixel of it.
 *
 * This is a snapdom PLUGIN, so a PDF is one more thing a capture can be:
 *
 *   snapdom.plugins(pdf())
 *   const shot = await snapdom(el)
 *   await shot.toPdf({ page: 'a4' })      // or shot.to('pdf', …)
 *
 * The split between `pdf(…)` and `toPdf(…)` is the engine's own split, not a
 * quirk: the final capture artifact is MEASURED lazily and the page is DRAWN at export.
 * Anything that changes what gets measured belongs in `pdf(…)`; anything about
 * the paper belongs in `toPdf(…)`. Passing a capture-time option at export time
 * is reported rather than silently ignored.
 *
 * What is about the PAGE rather than the paint is kept out of the drawing code:
 * the coordinate contract (`PT`, the element's border box as content origin),
 * `pageBox`, and `collectBlocks` + `paginate`, which read that isolated clone and know
 * nothing about how the page is painted.
 *
 * Requires the SnapDOM plugin contract that exposes immutable capture metadata,
 * raw export options and pre-decode canvas crops (SnapDOM v3).
 */
// `src/writer/` is the byte-level half, and it is this product's own source. It
// was a package shared with a sibling product once, which is why it still knows
// nothing about text layers or page models and why `setWarnPrefix` exists — that
// is what makes a warning raised down there say `[snapdom-pdf]` to the person who
// bought this. Nothing of it reaches the buyer as a separate file; it is bundled.
import {
  createPdfDoc, pdfString, pdfTextString, BASE14,
  deflate, canDeflate, encodeImage, createUnicodeFont, setWarnPrefix,
  writeOutlines, writeNameTree, writeStructTree,
} from './writer/index.js'
import { collectTextLayer, measureBase14 } from './text-layer.js'
import { collectNav, outlineTree, fragmentOf } from './nav.js'
import { buildStructure } from './tagged.js'
import { createEmbeddedFont } from './writer/font.js'
import { metaSpec, infoDict, xmpPacket } from './mega/meta.js'
import { collectFaceRules, resolveFaces } from './mega/fonts.js'
import { buildReport, reportSpec } from './mega/diag.js'
import { flowSpec } from './mega/flow.js'
import { pageLabels } from './mega/labels.js'
import { planFields, createFieldWriter, wantsCropAP } from './mega/forms.js'
import { collectBlocks, collectRepeats, paginate, headerReserve, repeatsAt } from './paginate.js'
import {
  captureBand, captureElement, numberSpec, numberOps, bandOps,
  bandSpec, textBandHeight, textBandOps, watermarkSpec, watermarkOps,
} from './furniture.js'
import { fullPageOps, tocSpec, tocLayout, fitText } from './frontmatter.js'

// Module-level, and safe because each product is bundled on its own: the writer
// inlined here is this build's private copy, so a page running both plugins has
// two of them and neither can rename the other's warnings. In the workspace,
// where Node resolves one shared module, the last plugin loaded wins the prefix —
// that is a harness cosmetic and it is the only place it can happen.
setWarnPrefix('[snapdom-pdf]')

/** CSS px → PDF points (96dpi → 72dpi), so printed size matches on-screen size. */
const PT = 0.75

/** Browser bitmap ceilings mirrored from SnapDOM's canvas exporter. */
const MAX_RASTER_SIDE = 16384
const MAX_RASTER_AREA = MAX_RASTER_SIDE * MAX_RASTER_SIDE

/** Points, portrait. ISO A and B, plus the North American sizes people actually ask for. */
const PAGE_SIZES = {
  a3: [841.89, 1190.55],
  a4: [595.28, 841.89],
  a5: [419.53, 595.28],
  a6: [297.64, 419.53],
  b4: [708.66, 1000.63],
  b5: [498.9, 708.66],
  letter: [612, 792],
  legal: [612, 1008],
  tabloid: [792, 1224],
  executive: [521.86, 756],
}

/**
 * Options that decide what gets MEASURED, so they are read when the capture runs
 * and cannot be changed at export time. Naming them lets the exporter say so
 * instead of accepting them and quietly doing something else.
 */
const CAPTURE_TIME = ['formValues', 'shadow', 'breakAvoid', 'outline', 'forms']

const warn = (msg) => console.warn(`[snapdom-pdf] ${msg}`)

/** Snapshot declarative option containers while preserving identity-bearing DOM
 * Elements and callbacks. Defaults are read lazily, so freezing only their top
 * level would still let `page`, `toc`, bands or watermarks change after pdf(). */
function snapshotOptions(value, seen = new WeakMap()) {
  if (!value || typeof value !== 'object') return value
  const proto = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return value
  if (seen.has(value)) return seen.get(value)
  const copy = Array.isArray(value) ? [] : Object.create(proto)
  seen.set(value, copy)
  for (const key of Object.keys(value)) copy[key] = snapshotOptions(value[key], seen)
  return Object.freeze(copy)
}

/**
 * `page` is a keyword, `'fit'`, or a `[width, height]` pair in points — the escape
 * hatch for the sizes nobody standardised, like a receipt roll or a card.
 */
function pageSize(page, report) {
  if (Array.isArray(page)) {
    const [w, h] = page
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return [w, h]
    report(`page [${page}] is not a usable size in points — falling back to a4.`)
    return PAGE_SIZES.a4
  }
  if (PAGE_SIZES[page]) return PAGE_SIZES[page]
  report(`unknown page size "${page}" — falling back to a4.`)
  return PAGE_SIZES.a4
}

/**
 * Where the element's border box sits inside the capture's viewBox, in CSS px.
 *
 * snapdom sizes its raster from a viewBox that can be larger than the element —
 * blur bleed, a rotated bbox, the anti-shaving pad. v3 publishes the exact
 * logical origin; export validation requires those fields before any work.
 */
function bleedOffset(meta) {
  return {
    offX: meta.contentX,
    offY: meta.contentY,
  }
}

/**
 * A diagnostic for roots whose own transform can make a text layer surprising.
 * about a corner grows its bounding box on one side only, so half the difference
 * is not where the element starts. Exact placement comes from `meta.contentX/Y`;
 * this warning remains useful when inspecting the isolated final artifact.
 */
function offCentreTurn(element, rect) {
  const style = getComputedStyle(element)
  const turned = (style.transform && style.transform !== 'none') ||
    (style.rotate && style.rotate !== 'none') ||
    (style.scale && style.scale !== 'none')
  if (!turned) return false
  const [ox, oy] = String(style.transformOrigin || '').split(' ').map(parseFloat)
  if (!Number.isFinite(ox) || !Number.isFinite(oy)) return false
  return Math.abs(ox - rect.width / 2) > 0.5 || Math.abs(oy - rect.height / 2) > 0.5
}

/**
 * The page box, in points, and the factor that maps content space onto it.
 *
 * Kept apart from the drawing because it is about the PAPER: what an A4 page is
 * and where its margins fall does not depend on how the page gets painted. The
 * one thing a caller can get wrong here — a `page` keyword nothing knows — is
 * reported rather than silently taken as A4.
 *
 * @returns {{pageW:number, pageH:number, marginX:number, marginY:number,
 *            drawScale:number, availW:number, availH:number, k:number, scaledH:number}}
 *   `k` is CSS px → page points including the fit scale; `scaledH` is the whole
 *   content height in page points, which is what `paginate` cuts.
 */
function pageBox({ page, orientation, margin, contentW, contentH, headerH = 0, footerH = 0, report }) {
  if (![contentW, contentH, margin, headerH, footerH].every(Number.isFinite) ||
      contentW <= 0 || contentH <= 0 || margin < 0 || headerH < 0 || footerH < 0) {
    throw new RangeError('[snapdom-pdf] page geometry must use finite positive dimensions and non-negative margins')
  }
  let pageW, pageH, marginX, marginY, drawScale
  if (page === 'fit') {
    pageW = contentW
    pageH = contentH
    marginX = marginY = 0
    drawScale = 1
  } else {
    const size = pageSize(page, report)
    ;[pageW, pageH] = orientation === 'landscape' ? [size[1], size[0]] : size
    marginX = marginY = margin
    drawScale = (pageW - marginX * 2) / contentW
  }
  const availW = pageW - marginX * 2
  const availH = pageH - marginY * 2 - headerH - footerH
  if (![pageW, pageH, availW, availH, drawScale].every(Number.isFinite) ||
      pageW <= 0 || pageH <= 0 || availW <= 0 || availH <= 0 || drawScale <= 0) {
    throw new RangeError('[snapdom-pdf] margins and page furniture leave no positive printable area')
  }
  return {
    pageW, pageH, marginX, marginY, drawScale,
    availW,
    // A header and a footer are not decoration over the page, they take room from
    // it — so the cut height shrinks and the content starts lower.
    availH,
    contentTop: pageH - marginY - headerH,
    k: PT * drawScale,
    scaledH: contentH * drawScale,
  }
}

/** Reject impossible work before mounting the snapshot, allocating a canvas or
 * running an image codec. Unknown named paper still follows pageSize's documented
 * a4 fallback, but malformed numeric geometry is never guessed. */
function validateExport(options, meta) {
  for (const key of ['w0', 'h0', 'vbW', 'vbH', 'targetW', 'targetH', 'contentX', 'contentY']) {
    if (!Number.isFinite(meta?.[key])) {
      throw new RangeError(`[snapdom-pdf] snapdom capture metadata has no finite ${key}`)
    }
  }
  if (meta.w0 <= 0 || meta.h0 <= 0 || meta.vbW <= 0 || meta.vbH <= 0 ||
      meta.targetW <= 0 || meta.targetH <= 0) {
    throw new RangeError('[snapdom-pdf] snapdom capture dimensions must be positive')
  }
  if (!Number.isFinite(options.scale) || options.scale <= 0 ||
      !Number.isFinite(options.dpr) || options.dpr <= 0) {
    throw new RangeError('[snapdom-pdf] capture scale and dpr must be finite positive numbers')
  }
  const margin = options.margin ?? 24
  if (!Number.isFinite(margin) || margin < 0) {
    throw new RangeError('[snapdom-pdf] margin must be a finite non-negative number of points')
  }
  const orientation = options.orientation ?? 'portrait'
  if (orientation !== 'portrait' && orientation !== 'landscape') {
    throw new TypeError('[snapdom-pdf] orientation must be "portrait" or "landscape"')
  }
  const page = options.page ?? 'fit'
  if (Array.isArray(page)) {
    if (page.length !== 2 || !page.every(n => Number.isFinite(n) && n > 0)) {
      throw new RangeError('[snapdom-pdf] a custom page must be [positiveWidth, positiveHeight] in points')
    }
  } else if (typeof page !== 'string') {
    throw new TypeError('[snapdom-pdf] page must be a paper name, "fit", or [width, height]')
  }
  if (page !== 'fit') {
    // Silent here on purpose: `pageBox` reports the a4 fallback when it takes it,
    // and reporting from both put the same sentence in the console twice.
    const size = pageSize(page, () => {})
    const [w, h] = orientation === 'landscape' ? [size[1], size[0]] : size
    if (margin * 2 >= w || margin * 2 >= h) {
      throw new RangeError('[snapdom-pdf] margin leaves no positive page area')
    }
  }
  if (options.image !== false) {
    const quality = options.quality ?? 0.92
    if (!Number.isFinite(quality) || quality < 0 || quality > 1) {
      throw new RangeError('[snapdom-pdf] quality must be between 0 and 1')
    }
    if (!['auto', 'jpeg', 'flate'].includes(options.codec ?? 'auto')) {
      throw new TypeError('[snapdom-pdf] codec must be "auto", "jpeg" or "flate"')
    }
  }
  if (options.encrypt != null) validateEncrypt(options.encrypt)
}

/**
 * Everything about `encrypt` that can be wrong before any work happens.
 *
 * The empty user password is the one that gets its own error rather than a
 * warning. A PDF whose user password is '' opens with no prompt at all: the
 * file is encrypted, the bytes are unreadable to a text editor, and every
 * viewer in the world walks straight in. That is the exact shape of a document
 * somebody believes is protected and is not, so it is refused instead of
 * produced. `permissions` alone is the same mistake wearing a different hat —
 * a flag is a request, and there is nothing behind it without a password.
 */
function validateEncrypt(spec) {
  if (typeof spec !== 'object' || Array.isArray(spec)) {
    throw new TypeError('[snapdom-pdf] encrypt must be an object, ' +
      'for example { userPassword: "…" }')
  }
  const { userPassword, ownerPassword, permissions } = spec
  if (typeof userPassword !== 'string' || !userPassword) {
    throw new TypeError('[snapdom-pdf] encrypt.userPassword must be a non-empty string — ' +
      'a document with an empty user password is encrypted but opens without asking, ' +
      'which protects nothing')
  }
  if (ownerPassword != null && typeof ownerPassword !== 'string') {
    throw new TypeError('[snapdom-pdf] encrypt.ownerPassword must be a string')
  }
  if (permissions != null && (typeof permissions !== 'object' || Array.isArray(permissions))) {
    throw new TypeError('[snapdom-pdf] encrypt.permissions must be an object of booleans')
  }
  for (const key of Object.keys(permissions || {})) {
    if (typeof permissions[key] !== 'boolean') {
      throw new TypeError(`[snapdom-pdf] encrypt.permissions.${key} must be a boolean`)
    }
  }
}

/**
 * Cut the content into page slices. Knows nothing about the paint either:
 * `collectBlocks` reads the isolated clone and `paginate` is pure geometry in content
 * points.
 */
function slicePages({ blocks, toContentY, scaledH, availH, single, report, reserve = null }) {
  if (single) return [{ top: 0, height: scaledH, cut: 0 }]
  const { slices, forcedIgnored } = paginate({
    blocks: blocks.map(b => ({ ...b, top: toContentY(b.top), bottom: toContentY(b.bottom) })),
    contentHeight: scaledH,
    availHeight: availH,
    reserve,
  })
  const cutRows = slices.reduce((n, s) => n + (s.cut || 0), 0)
  if (cutRows) report(`${cutRows} block(s) had to be split across a page break.`)
  if (forcedIgnored) report(`${forcedIgnored} declared page break(s) could not be honoured.`)
  return slices
}

/** A download is a side effect of `download`, never of producing the blob. */
function deliver(blob, name) {
  if (!name) return blob
  const file = name === true ? 'snapdom.pdf' : String(name)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file.endsWith('.pdf') ? file : `${file}.pdf`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return blob
}

const rect = (left, top, width, height) => ({
  left, top, width, height, right: left + width, bottom: top + height,
})

const overlaps = (a, b) =>
  a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom

const contains = (outer, inner) =>
  inner.left >= outer.left - 0.01 && inner.top >= outer.top - 0.01 &&
  inner.right <= outer.right + 0.01 && inner.bottom <= outer.bottom + 0.01

/** Conservative AABB for one text run. A partly clipped word is dropped whole:
 * keeping its full string would make characters outside a snapdom clip searchable. */
function runBox(run) {
  const points = [[0, -run.ascent], [run.width, -run.ascent],
    [0, run.height - run.ascent], [run.width, run.height - run.ascent]]
  const m = run.matrix
  const mapped = points.map(([x, y]) => ({
    x: run.originX + (m ? m.a * x + m.c * y : x),
    y: run.originY + (m ? m.b * x + m.d * y : y),
  }))
  const xs = mapped.map(p => p.x)
  const ys = mapped.map(p => p.y)
  return rect(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys))
}

/** Apply the capture window to every semantic surface, not only to pixels. */
function clipMeasurement(layer, blocks, repeats, nav, frame, notes) {
  const runs = []
  const owners = []
  let clippedRuns = 0
  for (let i = 0; i < layer.runs.length; i++) {
    if (!contains(frame, runBox(layer.runs[i]))) { clippedRuns++; continue }
    runs.push(layer.runs[i])
    owners.push(layer.owners[i])
  }
  if (clippedRuns) {
    notes.push(`${clippedRuns} text run(s) crossing the snapdom clip edge were omitted ` +
      'from the searchable layer so clipped text cannot leak through extraction.')
  }
  const links = []
  for (const link of layer.links) {
    const box = rect(link.x, link.y, link.width, link.height)
    if (!overlaps(frame, box)) continue
    const left = Math.max(frame.left, box.left)
    const top = Math.max(frame.top, box.top)
    const right = Math.min(frame.right, box.right)
    const bottom = Math.min(frame.bottom, box.bottom)
    links.push({ ...link, x: left, y: top, width: right - left, height: bottom - top })
  }
  layer = { ...layer, runs, owners, links }

  blocks = blocks.flatMap(b => {
    const top = Math.max(frame.top, b.top)
    const bottom = Math.min(frame.bottom, b.bottom)
    return bottom >= top ? [{ ...b, top, bottom }] : []
  })
  repeats = repeats.filter(b => b.bottom > frame.top && b.top < frame.bottom)

  const dests = new Map([...nav.dests].filter(([, at]) => at.top || (
    at.x >= frame.left && at.x <= frame.right && at.y >= frame.top && at.y <= frame.bottom
  )))
  const outline = nav.outline.filter(item => !item.box || contains(frame, {
    left: item.box.x, top: item.box.y, right: item.box.x + item.box.w,
    bottom: item.box.y + item.box.h,
  }))
  return { layer, blocks, repeats, nav: { ...nav, dests, outline } }
}

function walkElements(root, visit) {
  const stack = [root]
  while (stack.length) {
    const el = stack.pop()
    visit(el)
    if (el.shadowRoot) for (let i = el.shadowRoot.children.length - 1; i >= 0; i--) {
      stack.push(el.shadowRoot.children[i])
    }
    for (let i = el.children.length - 1; i >= 0; i--) stack.push(el.children[i])
  }
}

/** Resolve fragments inside the mounted snapshot. ownerDocument.getElementById()
 * cannot do this across the measurement ShadowRoot and may find the live twin. */
function addSnapshotDestinations(root, links, nav, frame, clipped, documentURL) {
  const wanted = new Set()
  for (const link of links) {
    const name = fragmentOf(link.href, documentURL)
    if (name !== null) wanted.add(name)
  }
  const targets = new Map()
  walkElements(root, (el) => {
    if (el.id && !targets.has(el.id)) targets.set(el.id, el)
    if (el.tagName === 'A') {
      const name = el.getAttribute('name')
      if (name && !targets.has(name)) targets.set(name, el)
    }
  })
  let unresolved = 0
  for (const name of wanted) {
    if (name === '') { nav.dests.set('', { x: frame.left, y: frame.top, top: true }); continue }
    if (nav.dests.has(name)) continue
    const el = targets.get(name)
    if (!el) { unresolved++; continue }
    const r = el.getBoundingClientRect()
    const at = rect(r.left, r.top, r.width, r.height)
    if (clipped && !overlaps(frame, at)) { unresolved++; continue }
    nav.dests.set(name, { x: r.left, y: r.top })
  }
  if (unresolved) {
    nav.warnings.push(`${unresolved} internal link(s) point outside the final captured tree or clip — ` +
      'written with no annotation rather than a destination that could expose excluded content')
  }
}

/** Measure only the final serialized clone. Never fall back to the live source: a
 * fallback would re-introduce excluded/redacted text into a nominally safe PDF. */
function measure(element, opts, frame, clipped = false, documentURL = location.href) {
  const notes = []
  const ownRect = frame || element.getBoundingClientRect()
  if (!ownRect.width || !ownRect.height) {
    notes.push('the capture element has no layout box — there is nothing to lay out a page from.')
    return {
      rect: ownRect, layer: { runs: [], owners: [], links: [], warnings: [] }, blocks: [], notes,
      nav: { dests: new Map(), outline: [] }, repeats: [], controls: [],
      structure: {
        root: { type: 'Document', children: [] }, ofRun: [], ofLink: [], ofControl: [],
        lang: null, warnings: [],
      },
    }
  }

  if (offCentreTurn(element, ownRect)) {
    notes.push('the capture root is turned about an off-centre origin, so its bounding box grew ' +
      'on one side only and the whole layer may be offset — capture an untransformed wrapper instead.')
  }

  const formValues = opts.formValues !== false
  const shadow = opts.shadow !== false
  const forms = opts.forms !== false
  let layer = collectTextLayer(element, { formValues, shadow, documentURL, forms })
  notes.push(...layer.warnings)

  // Navigation reads the mounted final-artifact layout AFTER the links exist:
  // the set of destinations worth resolving is exactly the set something points
  // at, so the text layer's links are its input.
  // Link targets are resolved locally below. Passing the links here would make
  // getElementById find the live page's duplicate IDs outside this ShadowRoot.
  let nav = collectNav(element, {
    links: [],
    shadow,
    outline: opts.outline !== false,
    headings: typeof opts.outline === 'string' ? opts.outline : null,
  })
  notes.push(...nav.warnings)
  const navNotes = nav.warnings.length

  // Block geometry only matters where a page break can happen, but the page size
  // is not known yet — collecting is cheap next to being unable to.
  let blocks = opts.breakAvoid === false ? [] : collectBlocks(element, { shadow })
  // Always measured, never gated here: whether a header repeats is about the
  // PAPER — it does nothing on `page: 'fit'` — so the decision belongs to the
  // export, and measuring a document's theads costs one rect each.
  let repeats = collectRepeats(element, { shadow })
  addSnapshotDestinations(element, layer.links, nav, ownRect, clipped, documentURL)
  notes.push(...nav.warnings.slice(navNotes))
  if (clipped) {
    const cut = clipMeasurement(layer, blocks, repeats, nav, ownRect, notes)
    layer = cut.layer
    blocks = cut.blocks
    repeats = cut.repeats
    nav = cut.nav
  }
  // The capture window applies to fields like everything semantic: a control the
  // clip cuts must not become a widget reaching outside what the pixels show.
  const controls = layer.controls || []
  if (clipped) {
    for (const c of controls) {
      if (c.skip) continue
      const box = rect(c.rect.left, c.rect.top, c.rect.width, c.rect.height)
      if (!contains(ownRect, box)) c.skip = 'clipped'
    }
  }
  // Which text-layer runs carry each control's VALUE — a control owns its value
  // runs directly (see pushLocalRun), so index equality is the whole join. The
  // field planner suppresses these from the invisible layer: a value must not
  // extract twice, once from the field and once from under it.
  const controlByEl = new Map(controls.map(c => [c.el, c]))
  layer.owners.forEach((owner, i) => {
    const c = controlByEl.get(owner)
    if (c) c.runs.push(i)
  })
  // Built here for the same reason everything else is: the structure of a document
  // is a fact about the DOM, and the DOM is only this document while the capture
  // is running. Whether it reaches the FILE is the export's decision, so its
  // warnings are held back rather than pushed into `notes`.
  const structure = buildStructure(element, layer.owners, {
    lang: opts.lang,
    links: layer.links.map(l => l.el),
    controls: controls.map(c => c.el),
  })

  // buildStructure has already converted ownership to plain structure nodes.
  // Keeping owner Elements here — or on a link or control record — would retain
  // the isolated iframe Document through measuredPromise for the lifetime of the
  // capture result.
  layer = {
    ...layer,
    owners: [],
    links: layer.links.map(({ el, ...link }) => link),
    controls: undefined,
  }

  return {
    rect: ownRect, layer, blocks, nav, repeats, structure, notes, formValues, shadow,
    documentURL,
    controls: controls.map(({ el, ...control }) => control),
  }
}

function svgTextFromDataURL(url) {
  if (typeof url !== 'string' || !/^data:image\/svg\+xml/i.test(url)) {
    throw new Error('[snapdom-pdf] the final capture artifact is not an SVG data URL')
  }
  const comma = url.indexOf(',')
  if (comma < 0) throw new Error('[snapdom-pdf] the final SVG data URL is malformed')
  const header = url.slice(0, comma)
  const payload = url.slice(comma + 1)
  if (/;base64/i.test(header)) {
    const bytes = Uint8Array.from(atob(payload), c => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  }
  return decodeURIComponent(payload)
}

async function measureArtifact(url, meta, opts, source = {}) {
  const svgText = svgTextFromDataURL(url)
  const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') {
    throw new Error('[snapdom-pdf] the final SVG artifact could not be parsed safely')
  }
  const viewBox = String(parsed.documentElement.getAttribute('viewBox') || '')
    .trim().split(/[\s,]+/).map(Number)
  const expectedViewBox = [0, 0, meta.vbW, meta.vbH]
  if (viewBox.length !== 4 || !viewBox.every(Number.isFinite) ||
      viewBox.some((n, i) => Math.abs(n - expectedViewBox[i]) > 1e-4)) {
    // Metadata and pixels form one coordinate contract. Continuing after an
    // afterRender hook windows only the SVG would let clipped pixels retain text,
    // links or tags measured with the old frame.
    throw new Error('[snapdom-pdf] final SVG viewBox no longer matches immutable capture metadata')
  }
  const svgRoot = parsed.documentElement
  const allowedRootAttrs = new Set(['xmlns', 'width', 'height', 'viewBox', 'font-size'])
  const unexpectedRootAttrs = [...svgRoot.attributes]
    .map(attr => attr.name)
    .filter(name => !allowedRootAttrs.has(name))
  if (unexpectedRootAttrs.length) {
    throw new Error('[snapdom-pdf] final SVG root has paint/layout attributes outside the capture contract: ' +
      unexpectedRootAttrs.join(', '))
  }
  const intrinsicW = Number(svgRoot.getAttribute('width'))
  const intrinsicH = Number(svgRoot.getAttribute('height'))
  if (!(intrinsicW > 0) || !(intrinsicH > 0)) {
    throw new Error('[snapdom-pdf] final SVG has no finite positive intrinsic dimensions')
  }
  const intrinsicAspect = intrinsicW / intrinsicH
  const viewBoxAspect = meta.vbW / meta.vbH
  if (!Number.isFinite(intrinsicAspect) ||
      Math.abs(intrinsicAspect / viewBoxAspect - 1) > 1e-4) {
    throw new Error('[snapdom-pdf] final SVG intrinsic aspect no longer matches its viewBox')
  }
  const doc = document
  if (!doc.body) throw new Error('[snapdom-pdf] a document body is required to measure the final capture')
  // Never reconnect serialized page markup to the application document. Event
  // handlers, custom-element callbacks and loadable elements could otherwise run
  // again merely because somebody asked for a PDF. A same-origin sandbox gives us
  // layout access but, without allow-scripts, no script execution; CSP closes the
  // remaining network/object/frame channels while permitting embedded assets.
  const sandboxFrame = doc.createElement('iframe')
  sandboxFrame.setAttribute('data-snapdom-pdf-measure', '')
  sandboxFrame.setAttribute('sandbox', 'allow-same-origin')
  sandboxFrame.style.cssText =
    `position:fixed!important;left:0!important;top:0!important;opacity:0!important;` +
    `width:${meta.vbW}px!important;height:${meta.vbH}px!important;` +
    'display:block!important;border:0!important;pointer-events:none!important;z-index:-2147483648!important;'
  const loaded = new Promise((resolve, reject) => {
    sandboxFrame.onload = resolve
    sandboxFrame.onerror = () => reject(new Error('[snapdom-pdf] isolated measurement frame failed to load'))
  })
  sandboxFrame.srcdoc = '<!doctype html><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; ' +
    'style-src \'unsafe-inline\'; img-src data:; font-src data:; media-src data:; ' +
    'connect-src \'none\'; object-src \'none\'; frame-src \'none\'">' +
    '<style>html,body{margin:0;padding:0;overflow:visible}</style><body></body>'
  doc.body.appendChild(sandboxFrame)
  try {
    await loaded
    const frameDoc = sandboxFrame.contentDocument
    if (!frameDoc?.body) throw new Error('[snapdom-pdf] isolated measurement document is unavailable')
    frameDoc.documentElement.lang = String(source.documentLang || '')
    const base = frameDoc.createElement('base')
    base.href = String(source.baseURL || source.documentURL || doc.baseURI)
    frameDoc.head.prepend(base)
    const svg = frameDoc.importNode(parsed.documentElement, true)
    svg.style.cssText = `display:block;width:${meta.vbW}px;height:${meta.vbH}px;max-width:none;max-height:none;overflow:visible;`
    frameDoc.body.appendChild(svg)
    if (frameDoc.fonts?.ready) await frameDoc.fonts.ready
    const fo = svg.getElementsByTagNameNS('http://www.w3.org/2000/svg', 'foreignObject')[0] ||
      svg.querySelector('foreignObject')
    const container = fo && [...fo.children].find(el => el.localName === 'div')
    const root = container?.firstElementChild
    if (!root) throw new Error('[snapdom-pdf] the final SVG has no measurable capture root')
    const svgRect = svg.getBoundingClientRect()
    const contentFrame = rect(
      svgRect.left + meta.contentX, svgRect.top + meta.contentY, meta.w0, meta.h0
    )
    const measured = measure(
      root, opts, contentFrame, !!meta.clip,
      String(source.documentURL || source.baseURL || doc.location?.href || doc.baseURI)
    )
    return {
      ...measured,
      // The @font-face rules behind the text, read NOW: this CSSOM dies with the
      // frame, and the export that wants the bytes runs after it is gone.
      fontRules: collectFaceRules(frameDoc),
      intrinsic: {
        width: Number.isFinite(intrinsicW) && intrinsicW > 0 ? intrinsicW : meta.vbW,
        height: Number.isFinite(intrinsicH) && intrinsicH > 0 ? intrinsicH : meta.vbH,
      },
    }
  } finally {
    sandboxFrame.remove()
  }
}

/**
 * Produce the document from a finished capture: snapdom's raster, then the
 * invisible text layer over it.
 *
 * @param {object} args
 * @param {{rect: DOMRect, layer: object, blocks: Array}} args.measured
 * @param {(crop?: object) => Promise<object>} [args.raster] lazy encoded capture regions
 * @param {{w0:number, h0:number, vbW:number, vbH:number}} args.meta
 * @param {object} args.options
 * @param {(msg: string) => void} args.report
 * @param {{check: Function, tick: Function}|null} [args.flow]
 * @returns {Promise<{blob: Blob, stats: object}>}
 */
async function draw({ measured, raster, meta, options, report, flow = null }) {
  const {
    quality = 0.92,
    page = 'fit',
    orientation = 'portrait',
    margin = 24,
    text = true,
    links = true,
    image = true,
    deflate: wantDeflate = true,
    header = null,
    footer = null,
    pageNumbers = false,
    debugText = false,
    backgroundColor = null,
    repeatHeaders = true,
    tagged = true,
    lang = null,
    codec = 'auto',
    cover = null,
    back = null,
    toc = null,
    watermark = null,
    fields = true,
    embedFonts = true,
    vectorText = false,
    encrypt: encryptSpec = null,
    meta: docMeta = null,
  } = options

  const { rect, layer, blocks, nav } = measured
  const { offX, offY } = bleedOffset(meta)
  const { vbW, vbH } = meta

  // Content space: points from the element's border-box top-left. The raster can
  // start above/left of that (bleed) and end below it, and pagination has to
  // cover what is drawn, not just the element box.
  const contentW = rect.width * PT
  const contentH = (page === 'fit' ? rect.height : Math.max(rect.height, vbH - offY)) * PT

  // Text bands have intrinsic metrics. Element bands are captured below before
  // pagination; their final artifact aspect determines the strip they reserve.
  if (page === 'fit' && (header || footer || pageNumbers)) {
    report("header, footer and pageNumbers need a paginated page size — they do nothing on page:'fit'.")
  }
  // Orientation is a fact about the PAPER, and `page: 'fit'` has none — the page
  // IS the element, whatever shape that element happens to be.
  if (page === 'fit' && orientation === 'landscape') {
    report("orientation does nothing on page:'fit' — the page is the element's own box, " +
      'so there is no paper to turn.')
  }
  const rawBands = page === 'fit'
    ? { header: null, footer: null }
    : { header: bandSpec(header), footer: bandSpec(footer) }
  const bands = { ...rawBands }
  if (!image) {
    for (const where of ['header', 'footer']) {
      if (bands[where]?.kind === 'element') {
        report(`${where} element omitted because image:false forbids raster/XObject work.`)
        bands[where] = null
      }
    }
  }
  const provisional = page === 'fit' ? [0, 0] : pageSize(page, () => {})
  const provisionalW = (orientation === 'landscape' ? provisional[1] : provisional[0]) - margin * 2
  const encodeOpaque = (surface, encodeOptions) =>
    encodeImage(surface, { ...encodeOptions, background: backgroundColor })
  const capturedBands = new Map()
  if (image) {
    for (const [where, spec] of [['header', bands.header], ['footer', bands.footer]]) {
      if (!spec || spec.kind !== 'element') continue
      const band = await captureBand(spec.el, {
        scale: options.scale, dpr: options.dpr, backgroundColor: null, quality, codec,
        availW: provisionalW, captureOptions: options.captureOptions,
      }, encodeOpaque)
      capturedBands.set(where, band)
    }
  }
  // Final-artifact aspect is authoritative for element bands. The pageBox call
  // below also catches a render hook that enlarged a band until no printable area
  // remains.
  const bandRoom = (b, where) => !b ? 0
    : b.kind === 'text' ? textBandHeight(b) : capturedBands.get(where)?.heightPt || 0
  const headerH = bandRoom(bands.header, 'header')
  const footerH = bandRoom(bands.footer, 'footer')

  const geo = pageBox({ page, orientation, margin, contentW, contentH, headerH, footerH, report })
  const { pageW, pageH, marginX, marginY, availW, availH, contentTop, k, scaledH } = geo

  // Viewport CSS px → content points.
  const toContentX = (vx) => (vx - rect.left) * k
  const toContentY = (vy) => (vy - rect.top) * k

  // A repeated table header is not drawn over the page, it takes room from it, so
  // pagination has to see it before it cuts anything. `page: 'fit'` has one page
  // and nothing to repeat onto.
  const repeatBands = (repeatHeaders !== false && page !== 'fit')
    ? (measured.repeats || []).map(b => ({
      top: toContentY(b.top), bottom: toContentY(b.bottom), bodyBottom: toContentY(b.bodyBottom),
    }))
    : []
  const maxRepeat = availH * 0.5

  const slices = slicePages({
    blocks, toContentY, scaledH, availH, report,
    single: page === 'fit',
    reserve: headerReserve(repeatBands, maxRepeat),
  })

  const doc = createPdfDoc()
  const catalogId = doc.reserve()
  const pagesId = doc.reserve()

  // ——— fillable fields ———
  //
  // Planned before any page is drawn because the plan reaches BACKWARDS into the
  // text layer: a value that lives in a field must leave the invisible layer, or
  // every extraction returns it twice — once from the field, once from under it.
  const fieldPlan = (fields !== false && (measured.controls || []).length)
    ? planFields(measured.controls, report)
    : null
  const fieldWriter = fieldPlan && fieldPlan.fields.length
    ? createFieldWriter(doc, { report })
    : null
  const suppressedRuns = fieldWriter ? fieldPlan.suppressed : new Set()
  const docMetaSpec = metaSpec(docMeta, report)

  // One encoded region may be painted more than once (repeated headers) but is
  // registered as one PDF object. The raster provider itself caches canvas and
  // codec work across repeated exports of this capture.
  // Which candidate `codec: 'auto'` actually kept, per region. It decides by
  // SIZE, so on a page of flat runs and sharp edges Flate wins and the JPEG —
  // the only one `quality` has any say over — is discarded. Counted because a
  // caller who lowers quality and gets a byte-identical file deserves to be told
  // why rather than left to conclude the option is broken.
  let jpegRegions = 0
  let losslessRegions = 0
  const imageObjects = new WeakMap()
  const imageObject = async (crop = null) => {
    if (!raster) throw new Error('[snapdom-pdf] raster requested while image:false')
    const encoded = await raster(crop)
    let saved = imageObjects.get(encoded)
    if (saved) return saved
    if (/DCTDecode/.test(encoded.dict)) jpegRegions++
    else losslessRegions++
    const smaskRef = encoded.smask
      ? ` /SMask ${doc.addStream(encoded.smask.dict, encoded.smask.bytes)} 0 R`
      : ''
    saved = { id: doc.addStream(encoded.dict + smaskRef, encoded.bytes), crop }
    imageObjects.set(encoded, saved)
    return saved
  }
  // Every body image is requested as a pre-decode region, including page:'fit'.
  // A fit page may still be a very long document; it is composed from several
  // bands on one MediaBox rather than allocating one document-height bitmap.

  // Captured bands become one XObject each, reused by every page: a band is an
  // element and an element does not change between pages. Text bands are drawn
  // per page, because their segments may depend on the page number.
  const furniture = []
  for (const [where, spec, name] of [['header', bands.header, 'Ih'], ['footer', bands.footer, 'If']]) {
    if (!spec || spec.kind !== 'element') continue
    const band = capturedBands.get(where)
    if (!band) continue
    const mask = band.smask ? ` /SMask ${doc.addStream(band.smask.dict, band.smask.bytes)} 0 R` : ''
    furniture.push({ where, name, id: doc.addStream(band.dict + mask, band.bytes), heightPt: band.heightPt })
  }
  const numbers = numberSpec(page === 'fit' ? false : pageNumbers)

  // The watermark's translucency is graphics state, so it needs one ExtGState the
  // pages share, and an element watermark needs its own XObject. Both are built
  // once: a stamp does not change between pages.
  let mark = watermarkSpec(watermark)
  if (!image && mark?.kind === 'element') {
    report('element watermark omitted because image:false forbids raster/XObject work.')
    mark = null
  }
  let markGs = null
  let markImage = null
  let markAspect = 1
  if (mark) {
    markGs = { name: 'GSw', id: doc.add(`<< /Type /ExtGState /ca ${mark.opacity} /CA ${mark.opacity} >>`) }
    if (mark.kind === 'element') {
      const stamp = await captureElement(mark.el, {
        scale: options.scale, dpr: options.dpr, backgroundColor: null, quality, codec,
        captureOptions: options.captureOptions,
      }, encodeImage)
      const maskRef = stamp.smask ? ` /SMask ${doc.addStream(stamp.smask.dict, stamp.smask.bytes)} 0 R` : ''
      markImage = { name: 'Iw', id: doc.addStream(stamp.dict + maskRef, stamp.bytes) }
      markAspect = stamp.aspect
    }
  }
  /**
   * One page dictionary. Every page in the file — body, cover, index, colophon —
   * goes through here, so a resource the watermark needs cannot be present on the
   * pages somebody remembered and missing from the ones they did not.
   */
  const pageDict = ({ contentId, annots = [], fonts, xobjects = [], structParents = null }) => {
    const all = [...xobjects]
    if (markImage) all.push(`/${markImage.name} ${markImage.id} 0 R`)
    const res = [
      all.length ? `/XObject << ${all.join(' ')} >>` : '',
      fonts.size ? `/Font << ${[...fonts].map(f => `/${f.name} ${f.id} 0 R`).join(' ')} >>` : '',
      markGs ? `/ExtGState << /${markGs.name} ${markGs.id} 0 R >>` : '',
    ].filter(Boolean).join(' ')
    return `<< /Type /Page /Parent ${pagesId} 0 R ` +
      `/MediaBox [0 0 ${pageW.toFixed(3)} ${pageH.toFixed(3)}] /Resources << ${res} >> ` +
      (structParents === null ? '' : `/StructParents ${structParents} `) +
      // Structure order is the tab order — the only honest /Tabs value here,
      // since widgets and links join the tree through /OBJR.
      (struct ? '/Tabs /S ' : '') +
      `/Contents ${contentId} 0 R${annots.length ? ` /Annots [${annots.join(' ')}]` : ''} >>`
  }

  /** The same stamp on every page, front matter included — including the cover. */
  const markOps = (pageFonts) => {
    if (!mark) return []
    const out = watermarkOps({
      spec: mark, pageW, pageH, gs: markGs.name,
      image: markImage && markImage.name, imageAspect: markAspect, pdfText,
    })
    if (!out) return []
    if (out.font) pageFonts.add(out.font)
    return out.ops
  }

  // Only emit fonts the document actually uses.
  const usedFonts = new Map()
  const fontRef = (key) => {
    if (!usedFonts.has(key)) {
      const name = `F${usedFonts.size}`
      const id = doc.add(
        `<< /Type /Font /Subtype /Type1 /BaseFont /${BASE14[key] || BASE14.sans} /Encoding /WinAnsiEncoding >>`
      )
      usedFonts.set(key, { name, id })
    }
    return usedFonts.get(key)
  }
  // Registers no objects until a run needs it, so a Latin-only document is
  // byte-identical to the base-14-only build.
  const unicodeFont = createUnicodeFont(doc)

  // ——— embedded fonts ———
  //
  // The faces behind the capture's own @font-face rules, resolved per font key
  // and embedded WHOLE (see pdf-writer/font.js for what that buys and what it
  // refuses). A run rides its embedded face only when the face's real cmap has
  // every glyph the run paints; anything else keeps the base-14/Type0 path it
  // always had, and is counted. Parsed binaries cache on the capture, so a
  // second export re-encodes nothing.
  const fontCache = measured.fontCache || (measured.fontCache = new Map())
  const facesFor = (fontKeys, runs, fontRules) => {
    if (!embedFonts || !fontKeys?.length || !fontRules?.length) return Promise.resolve([])
    const points = fontKeys.map(() => new Set())
    for (const run of runs) {
      const set = run.fk >= 0 ? points[run.fk] : null
      if (set) for (const ch of run.text) set.add(ch.codePointAt(0))
    }
    return resolveFaces(fontKeys, points, fontRules, fontCache, report)
  }
  const bodyFaces = await facesFor(layer.fontKeys, layer.runs, measured.fontRules)
  // The page has loaded webfonts, but the capture carries no @font-face for the
  // export to read: snapdom strips them unless the CAPTURE inlines them. Said
  // here once, because the alternative is fonts that silently never embed.
  if (embedFonts && !(measured.fontRules?.length) &&
      typeof document !== 'undefined' && document.fonts?.size) {
    report('the page declares webfonts but none reached the capture, so nothing can be embedded — ' +
      'pass `embedFonts: true` to snapdom(…) so the capture carries its @font-face rules.')
  }

  // Keyed by the PARSED BINARY, not the face record: the cover and the body
  // each resolve their own faces, and when both land on the same file — the
  // cache hands both the same parsed object — the document must carry that
  // program once, not once per page that asked.
  const embeddedFonts = new Map()
  const embeddedOf = (face) => {
    let f = embeddedFonts.get(face.parsed)
    if (!f) {
      f = createEmbeddedFont(doc, face.parsed, face.sfnt, String(embeddedFonts.size),
        { subset: embedFonts !== 'full' })
      f.label = face.label
      f.wholeKB = Math.round(face.sfnt.length / 1024)
      embeddedFonts.set(face.parsed, f)
    }
    return f
  }

  // The document's OWN face: the one that painted the most body text. Furniture
  // and generated pages default to it, so a running head is set in the same
  // type as the report it runs over — and set in REAL embedded glyphs.
  let primaryFace = null
  {
    const painted = new Map()
    for (const run of layer.runs) {
      const face = run.fk >= 0 ? bodyFaces[run.fk] : null
      if (face) painted.set(face, (painted.get(face) || 0) + run.text.length)
    }
    for (const [face, n] of painted) {
      if (!primaryFace || n > painted.get(primaryFace)) primaryFace = face
    }
  }
  let coverageFallbacks = 0
  const systemStacks = new Set()

  /**
   * One short string of the PLUGIN's own text — a page number, a running head, a
   * watermark, a line of the generated index — encoded and measured.
   *
   * Base-14 where WinAnsi can address it; the document's Type0 font otherwise, so
   * a Japanese heading reaches the index instead of being silently dropped the way
   * a base-14-only path drops it. The width comes back with it because every one
   * of these callers has to align or centre what it just encoded, and the standing
   * `length × size × 0.5` guess puts a right-aligned string off its own margin.
   *
   * @returns {{str: string, font: object, width: number}|null}
   */
  let unpaintable = 0
  const pdfText = (text, key = 'sans', size = 10, { paint = true } = {}) => {
    const body = String(text)
    // 'document' is the body's own embedded face — real glyphs, any script its
    // cmap reaches, PAINTABLE. It falls back to base-14 sans per string, so one
    // heading the face lacks does not cost the rest of the furniture its type.
    if (key === 'document') {
      if (primaryFace) {
        const f = embeddedOf(primaryFace)
        const str = f.encode(body)
        if (str) {
          return { str, font: f, width: f.width(body, size), base14: false, paintable: true }
        }
      }
      key = 'sans'
    }
    const str = pdfString(body)
    if (str) {
      return { str, font: fontRef(key), width: measureBase14(body, key, size), base14: true, paintable: true }
    }
    // The Type0 font carries NO GLYPHS — that is its whole design, and it is why
    // extraction can run off the CMap alone. So it may be written invisibly and
    // must never be PAINTED: a viewer with nothing to draw draws nothing, or
    // notdef boxes, and which of the two you get depends on the viewer. Refusing
    // here is what turns that into a warning instead of a blank line in somebody's
    // report.
    if (paint) { unpaintable++; return null }
    const encoded = unicodeFont.encode(body)
    if (!encoded) return null
    // A font with no glyphs has no metrics either: one em per codepoint is the
    // same estimate the run path uses for its own Tz denominator.
    return { str: encoded, font: unicodeFont, width: [...body].length * size, base14: false, paintable: false }
  }

  // Every run belongs to exactly ONE page. Choosing by baseline and then
  // clamping is what keeps a word that straddles a slice from vanishing off
  // both pages, which is how the fixed-band version lost content.
  const sliceOf = (cy) => {
    for (let i = 0; i < slices.length; i++) {
      if (cy < slices[i].top + slices[i].height) return i
    }
    return slices.length - 1
  }
  // The centre of the painted box, not the baseline: a line sitting on a slice
  // edge belongs to the page that shows most of its glyphs.
  const runPages = layer.runs.map((run) => {
    const dx = run.width / 2
    const dy = run.height / 2 - run.ascent
    const m = run.matrix
    const cy = toContentY(run.originY) + (m ? (m.b * dx + m.d * dy) : dy) * k
    return sliceOf(Math.max(0, cy))
  })

  // Reserved, not appended as each page finishes: a link on page 1 may point at
  // page 9, and a destination cannot name a page object that does not exist yet.
  const pageIds = slices.map(() => doc.reserve())

  /**
   * A measured point → the PDF destination that lands on it: `/XYZ`, so the
   * viewer keeps the reader's zoom and only scrolls. The point is the TOP-LEFT of
   * the target, which is what puts the heading itself at the top of the window
   * rather than just off it.
   *
   * Clamped to the page box because a destination outside it is not a scroll
   * position any viewer can honour — it silently becomes the origin, which sends
   * the reader to the wrong end of the page instead of the wrong place on it.
   */
  // What each page gives up to repeated headers, and therefore where its own
  // content starts. Read once, here, by everything that places anything: the
  // destinations below, the page image, the runs and the links.
  const repeated = slices.map(s => repeatsAt(repeatBands, s.top, maxRepeat))
  const pageTopOf = (p) => contentTop - repeated[p].height
  if (repeated.some(r => r.refused)) {
    report('a table header is more than half a page tall — it is drawn once, where it is, ' +
      'and not repeated: a page that is mostly header carries no rows.')
  }

  const destOf = (at) => {
    if (at.top) return { page: 0, ref: `[${pageIds[0]} 0 R /XYZ 0 ${pageH.toFixed(3)} null]` }
    const cy = Math.max(0, toContentY(at.y))
    const p = sliceOf(cy)
    const x = Math.min(Math.max(0, marginX + toContentX(at.x)), pageW)
    const y = Math.min(Math.max(0, pageTopOf(p) - (cy - slices[p].top)), pageH)
    return { page: p, ref: `[${pageIds[p]} 0 R /XYZ ${x.toFixed(3)} ${y.toFixed(3)} null]` }
  }
  const dests = new Map()
  /** Which BODY page a destination is on, which is the number the index prints. */
  const destPage = new Map()
  for (const [name, at] of (nav?.dests || new Map())) {
    const d = destOf(at)
    dests.set(name, d.ref)
    destPage.set(name, d.page)
  }

  let dropped = 0
  let offPage = 0
  let unlinked = 0
  let vectorPainted = 0
  let vectorMissed = 0
  // Painted images nobody named, on body and matter pages alike. Any one of them
  // withholds the PDF/UA-1 claim.
  let unnamedImages = layer.unnamedImages

  const actionFor = (href, documentURL = measured.documentURL) => {
    const name = fragmentOf(href, documentURL)
    if (name !== null) {
      if (!dests.has(name)) { unlinked++; return null }
      return `/Dest ${dests.get(name)}`
    }
    return `/A << /Type /Action /S /URI /URI ${pdfString(href) || '()'} >>`
  }

  /**
   * Annotations that belong to the structure tree — a link's `/Link`, a widget's
   * `/Form` — cannot be finished while pages are still being drawn: their
   * `/StructParent` keys must come AFTER every page's `/StructParents` key, and
   * pages (cover, contents) are still being created. So a structured annotation
   * reserves its id now and is filled in one pass before the tree is written.
   */
  const annotStruct = []
  let annotCount = 0

  const addLinkAnnot = (box, action, owner = null) => {
    const left = Math.max(0, box.left)
    const bottom = Math.max(0, box.bottom)
    const right = Math.min(pageW, box.right)
    const top = Math.min(pageH, box.top)
    if (![left, bottom, right, top].every(Number.isFinite) || right <= left || top <= bottom) return null
    annotCount++
    const dict =
      `<< /Type /Annot /Subtype /Link /Border [0 0 0] ` +
      `/Rect [${left.toFixed(3)} ${bottom.toFixed(3)} ${right.toFixed(3)} ${top.toFixed(3)}] ` +
      `${action}`
    if (struct && owner && owner.node) {
      const id = doc.reserve()
      annotStruct.push({ id, dict, node: owner.node, pageId: owner.pageId })
      return id
    }
    return doc.add(dict + ' >>')
  }

  /**
   * Where content y = 0 sits on the page, for one draw. Every placement below is
   * `origin - contentY`, so a repeated header band and the page's own slice differ
   * in exactly this number and in nothing else — which is why the header lands on
   * the same pixels twice instead of nearly the same.
   */
  const originFor = (pageY, contentY) => pageY + contentY

  /**
   * The map `drawRun` takes for the CAPTURED BODY: content space is the element's
   * border box scaled by `k`, and `origin` is where content y = 0 sits.
   */
  const bodyMap = (origin) => ({
    ax: marginX - rect.left * k,
    ay: origin + rect.top * k,
    s: k,
  })

  const cropFor = (top, height) => {
    const y = Math.max(0, Math.min(vbH, offY + top / k))
    const bottom = Math.max(y, Math.min(vbH, offY + (top + height) / k))
    if (!(bottom > y)) throw new RangeError('[snapdom-pdf] page slice maps outside the raster viewBox')
    return { x: 0, y, width: vbW, height: bottom - y }
  }

  // Core crops before decode, then applies the capture scale and dpr to the
  // canvas. Bound both stages with the same side/area ceilings as toCanvas.
  const intrinsicW = measured.intrinsic?.width > 0 ? measured.intrinsic.width : vbW
  const intrinsicH = measured.intrinsic?.height > 0 ? measured.intrinsic.height : vbH
  const pixelFactor = options.scale * options.dpr
  const densityX = options.rasterDensity != null
    ? Math.max(intrinsicW / vbW, options.rasterDensity * options.dpr)
    : intrinsicW / vbW * pixelFactor
  const densityY = options.rasterDensity != null
    ? Math.max(intrinsicH / vbH, options.rasterDensity * options.dpr)
    : intrinsicH / vbH * pixelFactor
  const regionPixelW = vbW * densityX
  const maxRegionH = Math.max(1, Math.min(
    vbH,
    MAX_RASTER_SIDE / Math.max(densityY, Number.EPSILON),
    MAX_RASTER_AREA / Math.max(regionPixelW * densityY, Number.EPSILON)
  ))
  if (image && regionPixelW > MAX_RASTER_SIDE) {
    report(`the capture is ${Math.ceil(regionPixelW)} raster pixels wide, above the browser's ` +
      `${MAX_RASTER_SIDE}px image limit — vertical regions avoid a giant document bitmap, but ` +
      'SnapDOM may still downscale their width. Lower scale/dpr for full resolution.')
  }
  const cropsFor = (top, height) => {
    const whole = cropFor(top, height)
    const out = []
    const end = whole.y + whole.height
    for (let y = whole.y; y < end - 1e-7;) {
      const h = Math.min(maxRegionH, end - y)
      out.push({ x: whole.x, y, width: whole.width, height: h })
      y += h
    }
    return out
  }

  /** A full image or a pre-decode SVG crop, clipped to the page's content band. */
  const drawImage = (ops, name, origin, top, height, crop = null) => {
    const box = crop || { x: 0, y: 0, width: vbW, height: vbH }
    const imgW = box.width * k
    const imgH = box.height * k
    const imageTop = origin + offY * k - box.y * k
    ops.push('q')
    ops.push(`${marginX} ${(top - height).toFixed(3)} ${availW} ${height.toFixed(3)} re W n`)
    ops.push(`${imgW.toFixed(3)} 0 0 ${imgH.toFixed(3)} ` +
      `${(marginX - offX * k + box.x * k).toFixed(3)} ${(imageTop - imgH).toFixed(3)} cm`)
    ops.push(`/${name} Do`)
    ops.push('Q')
  }

  /**
   * One run, placed by an AFFINE MAP from viewport CSS px onto the page:
   * `x = ax + vx·s`, `y = ay − vy·s`. Three callers need three different maps —
   * the page's own slice, a repeated header band, and a cover or colophon drawn
   * at its own scale — and they differ in nothing but those three numbers.
   *
   * Returns false when the run carries a codepoint the Type0 font has no room
   * left for; the caller counts it.
   */
  const drawRun = (ops, pageFonts, run, { ax, ay, s }, faces = bodyFaces) => {
    // The run's own embedded face first — real glyphs, real advances, so Tz is
    // correcting sub-pixel truth rather than substituting Helvetica's. Base-14
    // is the fallback for system-font runs; the Type0 font carries everything
    // WinAnsi cannot address. The three disagree on advance, which is why the
    // caller — not the text layer — computes Tz.
    let str = null
    let font, natural
    let embeddedUsed = false
    const face = run.fk >= 0 ? faces[run.fk]
      // A synthetic marker run has no style of its own; it rides the document's
      // face when one exists, so an otherwise fully-embedded export does not
      // drag Helvetica back in for a figure's placeholder space.
      : (run.fk === -1 && primaryFace ? primaryFace : null)
    if (face) {
      const f = embeddedOf(face)
      str = f.encode(run.text)
      if (str) {
        font = f
        natural = f.width(run.text, run.size)
        embeddedUsed = true
      } else {
        coverageFallbacks++
      }
    }
    if (!str) {
      str = pdfString(run.text)
      if (str) {
        font = fontRef(run.font)
        natural = run.naturalWidth
      } else {
        str = unicodeFont.encode(run.text)
        if (!str) return false
        font = unicodeFont
        natural = [...run.text].length * run.size
      }
    }
    pageFonts.add(font)

    const px = ax + run.originX * s
    const py = ay - run.originY * s
    // Content painted outside the capture's own border box — a rotated leaf
    // overhanging its parent, say — lands off the MediaBox. It is written, but
    // no viewer will ever show it and no extractor will return it, so it is a
    // silent loss unless it is counted.
    if (px < 0 || px > pageW || py < 0 || py > pageH) offPage++
    const size = (run.size * s).toFixed(3)
    // CSS y grows down and PDF y grows up, so the linear part is conjugated
    // by the flip: b and c change sign, a and d do not.
    const m = run.matrix
    const tm = m
      ? `${m.a.toFixed(5)} ${(-m.b).toFixed(5)} ${(-m.c).toFixed(5)} ${m.d.toFixed(5)}`
      : '1 0 0 1'
    // Vector text PAINTS the run as real filled glyphs from the embedded face,
    // instead of leaving it invisible over the raster. It is faithful only where
    // no shaping stands between codepoints and glyphs: a left-to-right run in an
    // embedded face, with a resolved, opaque colour. Everything else — RTL, a
    // face that did not cover the run, a translucent or unresolved colour, a
    // word-spacing Type0 cannot express — stays as it was, shown by the raster
    // or, in an image-free export, lost and counted.
    const paint = vectorText && embeddedUsed && run.color && !run.rtl
    let tr = debugText ? 0 : 3
    let colorOp = ''
    // Letter-spacing rides `Tc`, NOT Tz: folding it into the horizontal scale
    // would fatten every glyph (measured 15–31% at 1–4px). Only a painted run
    // applies it — an invisible run keeps its width-matching Tz untouched, so
    // selection geometry is unchanged. Tc is unscaled text space, hence ×s.
    let natEff = natural
    let tc = 0
    if (paint) {
      tr = 0
      colorOp = `${run.color.map(c => c.toFixed(3)).join(' ')} rg `
      if (run.tracking) {
        tc = run.tracking * s
        natEff = natural + [...run.text].length * run.tracking
      }
      vectorPainted++
    } else if (vectorText && !image && tr === 3) {
      // Nothing will show this run: no raster beneath it, and it was not painted.
      vectorMissed++
    }
    const tz = (natEff > 0 ? Math.max(1, Math.min(1000, (run.width / natEff) * 100)) : 100).toFixed(2)
    // Tc is written EVERY run, and BEFORE `BT` where it is still a legal text-
    // state op: it persists across runs in a stream, so a tracked run would
    // otherwise leak its spacing onto the next — including invisible ones, whose
    // selection width it would widen. Placing it before BT also keeps it out of
    // the `BT … Tr` shape the geometry oracle matches.
    ops.push(
      `${colorOp}${tc.toFixed(4)} Tc BT ${tr} Tr /${font.name} ${size} Tf ${tz} Tz ${tm} ` +
      `${px.toFixed(3)} ${py.toFixed(3)} Tm ${str} Tj ET`
    )
    return true
  }

  // Which runs live in which header band, so a repeated header carries the same
  // SELECTABLE text as the one it was cut from — a header that is only pixels on
  // page 2 is a header a search cannot find.
  const bandRuns = repeatBands.map((b) => {
    const list = []
    for (let i = 0; i < layer.runs.length; i++) {
      const cy = toContentY(layer.runs[i].originY)
      if (cy > b.top - 0.5 && cy <= b.bottom + 0.5) list.push(i)
    }
    return list
  })

  // ——— tagging ———
  //
  // The structure tree covers the TEXT LAYER and nothing else. Every pixel this
  // plugin draws is an /Artifact: the page image is a picture of the same words
  // the layer carries, so tagging it as content would have a screen reader
  // announce a full-page image over the text it duplicates — and a repeated table
  // header would be read once per page it repeats onto.
  const struct = tagged ? measured.structure : null
  if (struct) for (const note of struct.warnings) {
    // buildStructure is cached per capture while `lang` is an export option. A
    // per-export language fully satisfies the document-level requirement.
    if (lang && /no `lang`/i.test(note)) continue
    report(note)
  }
  /**
   * `markOwners[key][mcid]` — what the parent tree is built from. Indexed by
   * /StructParents KEY, not by body page: a cover and an index are pages too, and
   * they are created after the body.
   */
  const markOwners = slices.map(() => [])
  // Held beside the tree, never in it: `measured.structure` belongs to the
  // CAPTURE and a capture can be exported more than once. Writing marks into the
  // nodes made the second export inherit the first one's content — caught by the
  // plugin fixture, which exports the same capture twice and compares sizes.
  const marksOf = new Map()

  const artifact = (ops, body) => {
    if (!body.length) return
    if (struct) ops.push('/Artifact BMC')
    ops.push(...body)
    if (struct) ops.push('EMC')
  }

  /** Structure grafted in from pages that are not the capture. */
  const frontStruct = []
  const backStruct = []

  /**
   * A /StructParents key for a page built outside the body loop, plus the marker
   * its content goes through. Returns null when tagging is off, so a caller can
   * pass the result straight to `pageDict`.
   */
  const matterMarks = () => {
    if (!struct) return null
    const key = markOwners.length
    markOwners.push([])
    return {
      key,
      mark: (node, pageId, body) => {
        const id = markOwners[key].length
        markOwners[key].push(node)
        const list = marksOf.get(node) || []
        list.push({ mcid: id, page: pageId })
        marksOf.set(node, list)
        return [`/${node.type} <</MCID ${id}>> BDC`, ...body, 'EMC']
      },
    }
  }

  /**
   * Where each fillable control lands, computed once for two consumers that must
   * agree to the point: the page image, which STOPS painting the control's area,
   * and the annotation pass, which puts the widget on exactly that rectangle.
   *
   * The page image yields because two renderers exist. Viewers that honour a
   * widget's appearance stream (pdf.js, PDFium, Acrobat) draw our AP — the
   * control's own crop of the capture — so the field still looks pixel-exact.
   * Viewers that REGENERATE widget appearances from /V, /DA and /MK (macOS
   * Preview and everything on PDFKit) draw their own field instead; with the
   * raster still painting the old value underneath, every such viewer showed the
   * value twice, slightly offset — MEASURED with a headless PDFKit render. A
   * field's pixels must have one owner, and the field is it.
   */
  const fieldPlacements = slices.map(() => [])
  if (fieldWriter) {
    for (const field of fieldPlan.fields) {
      for (const member of field.members) {
        const c = member.control
        const cy = toContentY(c.rect.top)
        const h = c.rect.height * k
        const w = c.rect.width * k
        const p = sliceOf(Math.max(0, cy + h / 2))
        const top = pageTopOf(p) - (cy - slices[p].top)
        const cx = toContentX(c.rect.left)
        if (cy < slices[p].top - 0.01 || cy + h > slices[p].top + slices[p].height + 0.01) {
          fieldWriter.straddle()
        }
        const llx = Math.max(0, Math.min(pageW, marginX + cx))
        const urx = Math.max(0, Math.min(pageW, marginX + cx + w))
        const ury = Math.max(0, Math.min(pageH, top))
        const lly = Math.max(0, Math.min(pageH, top - h))
        if (urx <= llx || ury <= lly) continue
        fieldPlacements[p].push({ field, member, rect: [llx, lly, urx, ury] })
      }
    }
  }

  for (let p = 0; p < slices.length; p++) {
    flow?.check()
    const slice = slices[p]
    const rep = repeated[p]
    const pageTop = pageTopOf(p)
    const ops = []
    const pageXObjects = furniture.map(f => `/${f.name} ${f.id} 0 R`)

    /** One tagged run: marked content the structure tree can be walked back from. */
    const marked = (node, body) => {
      if (!node || !body.length) { ops.push(...body); return }
      const id = markOwners[p].length
      markOwners[p].push(node)
      const list = marksOf.get(node) || []
      list.push({ mcid: id, page: pageIds[p] })
      marksOf.set(node, list)
      ops.push(`/${node.type} <</MCID ${id}>> BDC`, ...body, 'EMC')
    }

    // Page image: drawn whole at 1:1 CSS px, clipped to this page's slice. The
    // bleed spills into the margin and the clip crops it.
    if (image) {
      const body = []
      const regions = cropsFor(slice.top, slice.height)
      for (let j = 0; j < regions.length; j++) {
        const crop = regions[j]
        const ref = await imageObject(crop)
        const name = page === 'fit'
          ? `Im${j}`
          : `Ip${p}${j ? `_${j}` : ''}`
        pageXObjects.push(`/${name} ${ref.id} 0 R`)
        const contentY = (crop.y - offY) * k
        const regionTop = pageTop - (contentY - slice.top)
        drawImage(body, name, originFor(pageTop, slice.top), regionTop, crop.height * k, crop)
      }
      // A control that became a field leaves the page image: its area is filled
      // with the control's own background, so the widget — crop AP here, a
      // PDFKit-regenerated face on macOS — is the ONLY thing painting its value.
      for (const pl of fieldPlacements[p]) {
        const [llx, lly, urx, ury] = pl.rect
        const bg = pl.member.control.style.bg || [1, 1, 1]
        body.push(`${bg.map(v => v.toFixed(3)).join(' ')} rg ` +
          `${llx.toFixed(3)} ${lly.toFixed(3)} ${(urx - llx).toFixed(3)} ${(ury - lly).toFixed(3)} re f`)
      }
      artifact(ops, body)
    }
    if (debugText) ops.push('1 0 0 rg')

    const pageFonts = new Set()

    // Repeated headers, stacked down from the top margin — the same pixels of the
    // same raster, re-stamped. Nothing is re-drawn and nothing is synthesized:
    // what a reader sees at the top of page 2 is the crop of page 1 they already
    // saw, which is the only way this can keep the plugin's one promise.
    let bandTop = contentTop
    for (const b of rep.bands) {
      const height = b.bottom - b.top
      const origin = originFor(bandTop, b.top)
      // Wholly an artifact, pixels AND words: this header was already read on the
      // page it belongs to, and a reader that meets it again on every page is
      // being read a table's header five times.
      const body = []
      if (image) {
        const index = repeatBands.indexOf(b)
        const regions = cropsFor(b.top, height)
        for (let j = 0; j < regions.length; j++) {
          const crop = regions[j]
          const ref = await imageObject(crop)
          const name = `Ir${index}${j ? `_${j}` : ''}`
          pageXObjects.push(`/${name} ${ref.id} 0 R`)
          const contentY = (crop.y - offY) * k
          const regionTop = bandTop - (contentY - b.top)
          drawImage(body, name, origin, regionTop, crop.height * k, crop)
        }
      }
      if (text) {
        for (const i of bandRuns[repeatBands.indexOf(b)]) {
          if (suppressedRuns.has(i)) continue
          if (!drawRun(body, pageFonts, layer.runs[i], bodyMap(origin))) dropped++
        }
      }
      artifact(ops, body)
      bandTop -= height
    }

    if (text) {
      for (let i = 0; i < layer.runs.length; i++) {
        if (runPages[i] !== p) continue
        // A value that became a fillable field's /V leaves the invisible layer:
        // extraction must return it once, from the field.
        if (suppressedRuns.has(i)) continue
        const body = []
        if (!drawRun(body, pageFonts, layer.runs[i], bodyMap(originFor(pageTop, slice.top)))) {
          dropped++
          continue
        }
        marked(struct && struct.ofRun[i], body)
      }
    }

    // Running heads, page numbers and the watermark are pagination furniture by
    // definition — they belong to the paper, not to the document — so every one of
    // them is an artifact and none reaches the structure tree.
    const trim = []
    for (const f of furniture) {
      trim.push(...bandOps({ where: f.where, name: f.name, heightPt: f.heightPt,
        pageH, marginX, marginY, availW }))
    }
    for (const [where, spec] of [['header', bands.header], ['footer', bands.footer]]) {
      if (!spec || spec.kind !== 'text') continue
      const band = textBandOps({ spec, where, page: p + 1, pages: slices.length,
        pageH, marginX, marginY, availW, pdfText })
      if (band) { for (const f of band.fonts) pageFonts.add(f); trim.push(...band.ops) }
    }
    if (numbers) {
      const n = numberOps({ spec: numbers, page: p + 1, pages: slices.length,
        pageW, marginX, marginY, availW, pdfText })
      if (n) { pageFonts.add(n.font); trim.push(...n.ops) }
    }
    // Last, so it is over everything: a watermark under the page image would be
    // invisible on any page with a background.
    trim.push(...markOps(pageFonts))
    artifact(ops, trim)

    const annots = []
    if (links) {
      for (let j = 0; j < layer.links.length; j++) {
        const link = layer.links[j]
        const cy = toContentY(link.y)
        const h = link.height * k
        const w = link.width * k
        // A link may legitimately appear on both pages it spans.
        if (cy + h <= slice.top || cy >= slice.top + slice.height) continue
        const top = pageTop - (cy - slice.top)
        const cx = toContentX(link.x)
        const action = actionFor(link.href)
        if (!action) continue
        // Intersect with both the slice's painted content window and MediaBox.
        // A link that straddles a break becomes two trimmed annotations, never a
        // rectangle reaching into the next page or into margins/furniture.
        const id = addLinkAnnot({
          left: Math.max(marginX, marginX + cx),
          right: Math.min(marginX + availW, marginX + cx + w),
          bottom: Math.max(pageTop - slice.height, top - h),
          top: Math.min(pageTop, top),
        }, action, { node: struct && struct.ofLink && struct.ofLink[j], pageId: pageIds[p] })
        if (id) annots.push(`${id} 0 R`)
      }
    }

    // Fillable fields whose control lands on this page, on the same rectangle
    // the page image just yielded. A valued field's appearance is real text
    // built from the control's own measured runs; an empty field's is the
    // control's crop of the capture. The split is PDFKit's doing — see forms.js.
    for (const pl of fieldPlacements[p]) {
      const { field, member } = pl
      const c = member.control
      let cropId = null
      // Only an EMPTY field's appearance is the control's raster crop — a valued
      // one gets real text (see forms.js) — so the encode runs only when the
      // appearance will reference it.
      if (image && wantsCropAP(field, c)) {
        const cropX = Math.max(0, Math.min(vbW, offX + (c.rect.left - rect.left)))
        const cropY = Math.max(0, Math.min(vbH, offY + (c.rect.top - rect.top)))
        const cropW = Math.min(vbW - cropX, c.rect.width)
        const cropH = Math.min(vbH - cropY, c.rect.height)
        if (cropW > 0 && cropH > 0) {
          const ref = await imageObject({ x: cropX, y: cropY, width: cropW, height: cropH })
          cropId = ref.id
        }
      }
      // The control's own value runs, re-based into the widget's box: the same
      // wrap, alignment and scroll the page painted, now drawn as the field's
      // appearance text. A password's runs are its bullets, and an EMPTY field
      // must look empty — so it contributes none.
      const lines = field.kind === 'password' ? []
        : (c.runs || []).map(i => layer.runs[i]).filter(Boolean).map(run => ({
          text: run.text,
          x: (run.originX - c.rect.left) * k,
          y: (c.rect.top + c.rect.height - run.originY) * k,
          size: run.size * k,
        }))
      const id = fieldWriter.widget(field, member, pl.rect, c.style.size * k, cropId, lines)
      annots.push(`${id} 0 R`)
      if (struct && struct.ofControl && struct.ofControl[member.i]) {
        annotStruct.push({
          id, dict: null, member,
          node: struct.ofControl[member.i], pageId: pageIds[p],
        })
      }
      annotCount++
    }

    // debugText exists to be read, so it keeps its content stream in the clear.
    const body = ops.join('\n')
    const deflated = wantDeflate && canDeflate && !debugText
    const contentId = doc.addStream(
      deflated ? '/Filter /FlateDecode' : '',
      deflated ? await deflate(body) : body
    )
    doc.fill(pageIds[p],
      pageDict({
        contentId, annots, fonts: pageFonts, structParents: struct ? p : null,
        xobjects: pageXObjects,
      })
    )
    flow?.tick('page', p + 1, slices.length)
  }

  // ——— front and back matter ———
  //
  // Built AFTER the body, because none of it can be built before: an index needs
  // to know which page each heading landed on, and that is not knowable until the
  // body has been cut. Page objects are added in whatever order suits; only the
  // /Kids array below decides what comes first.
  if (page === 'fit' && (cover || back || toc)) {
    report("cover, back and toc need a paginated page size — they do nothing on page:'fit'.")
  }
  const paginated = page !== 'fit'

  /** One finished page from a list of ops — the same stream handling the body gets. */
  const addPage = async (ops, { annots = [], fonts, xobjects = [] }) => {
    const body = ops.join('\n')
    const deflated = wantDeflate && canDeflate && !debugText
    const contentId = doc.addStream(
      deflated ? '/Filter /FlateDecode' : '',
      deflated ? await deflate(body) : body
    )
    return doc.add(pageDict({ contentId, annots, fonts, xobjects }))
  }

  /**
   * A cover or a colophon: your own element, captured, one to a page — and given
   * the SAME invisible text layer the body gets.
   *
   * That layer is not a nicety here. A closing page is where the legal text goes,
   * and legal text nobody can search or copy is a picture of a contract. It is
   * measured from that element's own final SnapDOM artifact at export, so the
   * same exclusion, resolver and clone-plugin policy governs pixels and semantics.
   */
  const matterPage = async (el, name, where) => {
    // Auxiliary pages get their own final SnapDOM artifact. Measuring `el`
    // directly would bypass exclude/filter/resolveNode/afterClone and could put a
    // redacted secret back into text, links, outline or structure.
    const shot = await captureElement(el, {
      scale: options.scale, dpr: options.dpr, backgroundColor: null, quality, codec,
      captureOptions: options.captureOptions,
      image,
    }, image ? encodeOpaque : null)
    const subMeasured = await measureArtifact(shot.url, shot.meta, {
      formValues: measured.formValues !== false,
      shadow: measured.shadow !== false,
      breakAvoid: false,
      outline: false,
      // A cover or colophon is furniture around the document; a fillable field
      // on one would be a form nobody expects to submit from a title page.
      forms: false,
      lang: lang || undefined,
    }, shot.source)
    // A matter page is measured in isolation, so a valid link to the body appears
    // unresolved here. `actionFor` below resolves it against the combined document
    // and reports only links that are still genuinely unresolved.
    for (const note of subMeasured.notes) {
      if (!/^\d+ internal link\(s\) point outside the final captured tree or clip/.test(note)) {
        report(`${where}: ${note}`)
      }
    }
    let xid = null
    if (image) {
      const mask = shot.smask ? ` /SMask ${doc.addStream(shot.smask.dict, shot.smask.bytes)} 0 R` : ''
      xid = doc.addStream(shot.dict + mask, shot.bytes)
    }
    const fonts = new Set()
    const marks = matterMarks()
    const pageId = doc.reserve()
    const ops = []
    if (image) artifact(ops, fullPageOps({ name, pageW, pageH, aspect: shot.aspect }))

    const annots = []
    if (text || links || struct) {
      // The same fit `fullPageOps` computed, recovered rather than passed: one of
      // them would drift the day the other changed.
      const ratio = shot.aspect > 0 ? shot.aspect : 1
      let w = pageW
      let h = w * ratio
      if (h > pageH) { h = pageH; w = h / ratio }
      const s = shot.vbW > 0 ? w / shot.vbW : 1
      const box = subMeasured.rect
      const map = {
        ax: (pageW - w) / 2 + (shot.offX - box.left) * s,
        ay: (pageH - h) / 2 + h + (box.top - shot.offY) * s,
        s,
      }
      let collisions = 0
      for (const [destName, at] of subMeasured.nav?.dests || []) {
        // Body destinations are established first and always win. This keeps a
        // cover accidentally reusing `#intro` from retargeting every body link.
        if (dests.has(destName)) { collisions++; continue }
        const x = at.top ? 0 : Math.min(pageW, Math.max(0, map.ax + at.x * map.s))
        const y = at.top ? pageH : Math.min(pageH, Math.max(0, map.ay - at.y * map.s))
        dests.set(destName,
          `[${pageId} 0 R /XYZ ${x.toFixed(3)} ${y.toFixed(3)} null]`)
      }
      if (collisions) {
        report(`${where}: ${collisions} destination name collision(s) kept the body destination.`)
      }
      if (debugText) ops.push('1 0 0 rg')
      const sub = subMeasured.layer
      unnamedImages += sub.unnamedImages
      // A matter page was measured from its own artifact, so its font keys index
      // its own table — resolved here against its own rules, sharing the byte
      // cache (a cover set in the body's face parses the binary once).
      const subFaces = await facesFor(sub.fontKeys, sub.runs, subMeasured.fontRules)
      // Its own structure, grafted under a Sect: a colophon is a section of the
      // document, and untagged content inside a tagged file is content a reader is
      // entitled to skip.
      const subStruct = struct ? subMeasured.structure : null
      const section = subStruct && { type: 'Sect', alt: null, lang: null, children: [] }
      if (text) {
        for (let i = 0; i < sub.runs.length; i++) {
          const body = []
          if (!drawRun(body, fonts, sub.runs[i], map, subFaces)) { dropped++; continue }
          const node = subStruct && subStruct.ofRun[i]
          if (node && marks) ops.push(...marks.mark(node, pageId, body))
          else ops.push(...body)
        }
      }
      if (section) {
        section.children = subStruct.root.children
        ;(where === 'cover' ? frontStruct : backStruct).push(section)
      }

      if (links) {
        for (let j = 0; j < sub.links.length; j++) {
          const link = sub.links[j]
          const action = actionFor(link.href, subMeasured.documentURL)
          if (!action) continue
          const id = addLinkAnnot({
            left: map.ax + link.x * map.s,
            bottom: map.ay - (link.y + link.height) * map.s,
            right: map.ax + (link.x + link.width) * map.s,
            top: map.ay - link.y * map.s,
          }, action, {
            node: subStruct && subStruct.ofLink && subStruct.ofLink[j],
            pageId,
          })
          if (id) annots.push(`${id} 0 R`)
        }
      }
    }

    artifact(ops, markOps(fonts))
    const body = ops.join('\n')
    const deflated = wantDeflate && canDeflate && !debugText
    const contentId = doc.addStream(
      deflated ? '/Filter /FlateDecode' : '',
      deflated ? await deflate(body) : body
    )
    doc.fill(pageId, pageDict({
      contentId, annots, fonts, xobjects: image ? [`/${name} ${xid} 0 R`] : [],
      structParents: marks ? marks.key : null,
    }))
    return pageId
  }

  const frontIds = []
  const backIds = []
  if (paginated && cover && cover.nodeType === 1) {
    flow?.check()
    const id = await matterPage(cover, 'Ic', 'cover')
    if (id) frontIds.push(id)
    flow?.tick('matter')
  }

  /**
   * One index line's title.
   *
   * Base-14 text when WinAnsi can address it — crisp at any zoom, a few dozen
   * bytes. When it cannot, the answer is NOT to paint the glyph-less Type0 font:
   * it is to CROP THE HEADING OUT OF THE PAGE RASTER, the same re-stamp a
   * repeated table header uses, scaled down to the line. The heading's pixels
   * already exist in the file; a Japanese index reads because snapdom drew it,
   * not because a font was embedded. The invisible text goes over the crop, so
   * the line is still searchable and copyable.
   *
   * @returns {{ops: string[], width: number, fonts: object[]}|null}
   */
  let cropped = 0
  const tocImages = new Map()
  /**
   * How far the glyphs inside a heading's box actually reach, in viewport CSS px.
   * Falls back to the box when nothing in the layer sits there — a heading that
   * is an image, or one whose runs were dropped as clipped.
   */
  const inkWidth = (box) => {
    let right = box.x
    for (const run of layer.runs) {
      if (run.originY < box.y - 1 || run.originY > box.y + box.h + 1) continue
      if (run.originX < box.x - 1) continue
      const edge = run.originX + run.width
      if (edge <= box.x + box.w + 1 && edge > right) right = edge
    }
    return right > box.x ? right - box.x : box.w
  }
  const drawTitle = ({ entry, key, size, x, baseline, room, colour }) => {
    const flat = pdfText(entry.title, key, size, { paint: false })
    if (flat && flat.paintable) {
      const title = fitText(entry.title, room, (t) => {
        const m = pdfText(t, key, size, { paint: false })
        return m ? m.width : Infinity
      })
      const drawn = title ? pdfText(title, key, size, { paint: false }) : null
      if (!drawn) return null
      return {
        width: drawn.width,
        fonts: [drawn.font],
        ops: [
          `${colour.map(c => c.toFixed(3)).join(' ')} rg`,
          `BT 0 Tr /${drawn.font.name} ${size} Tf 1 0 0 1 ` +
          `${x.toFixed(3)} ${baseline.toFixed(3)} Tm ${drawn.str} Tj ET`,
        ],
      }
    }

    // Everything WinAnsi cannot address. Without the raster there is nothing to
    // crop from, and nothing this plugin can honestly paint.
    const box = entry.box
    const cropImage = tocImages.get(entry)
    if (!image || !box || !cropImage || !(box.w > 0) || !(box.h > 0)) { unpaintable++; return null }
    // The heading's INK, not its box: a block-level heading's box is the whole
    // column, and cropping that would leave the dot leader starting a third of
    // the way across the page with nothing before it. The runs already know where
    // the glyphs stop.
    const bw = inkWidth(box) * k
    const bh = box.h * k
    // Scale the heading down to the index line's own type size.
    const scale = (size * 1.2) / bh
    const naturalWidth = bw * scale
    const width = Math.min(naturalWidth, room)
    const height = bh * scale
    const top = baseline + size

    // This XObject is already the heading's viewBox crop, so it can be placed
    // directly. No full-document raster is allocated merely to paint one title.
    const ops = [
      'q',
      `${x.toFixed(3)} ${(top - height).toFixed(3)} ${width.toFixed(3)} ${height.toFixed(3)} re W n`,
      `${naturalWidth.toFixed(3)} 0 0 ${height.toFixed(3)} ${x.toFixed(3)} ${(top - height).toFixed(3)} cm`,
      `/${cropImage.name} Do`,
      'Q',
    ]
    const fonts = []
    // Invisible, so the line is searchable and copyable — the sanctioned use of
    // the glyph-less font, and the only one.
    const hidden = pdfText(entry.title, key, size, { paint: false })
    if (hidden) {
      fonts.push(hidden.font)
      const tz = hidden.width > 0
        ? Math.max(1, Math.min(1000, (width / hidden.width) * 100)).toFixed(2)
        : '100'
      ops.push(`BT 3 Tr /${hidden.font.name} ${size} Tf ${tz} Tz 1 0 0 1 ` +
        `${x.toFixed(3)} ${baseline.toFixed(3)} Tm ${hidden.str} Tj ET`)
    }
    cropped++
    return { ops, width, fonts, xobjects: [`/${cropImage.name} ${cropImage.id} 0 R`] }
  }

  const index = tocSpec(paginated ? toc : null)
  if (index) {
    // Depth from the outline TREE, not the heading level: a document that starts
    // at h2 should still show its two tiers, and a level gap is not an indent.
    const entries = []
    const gather = (nodes, depth) => {
      if (depth >= index.levels) return
      for (const node of nodes) {
        entries.push({
          depth,
          title: node.title,
          // Carried all the way from `collectNav`: without the heading's own box
          // there is nothing for a non-Latin line to crop.
          box: node.box || null,
          dest: dests.get(node.dest) || null,
          label: index.label(destPage.has(node.dest) ? destPage.get(node.dest) + 1 : 1, slices.length),
        })
        gather(node.children, depth + 1)
      }
    }
    gather(outlineTree(nav?.outline || []), 0)

    // Pre-decode one small crop for each non-WinAnsi title. tocLayout/drawTitle
    // stay synchronous, while the expensive raster work remains explicit here.
    if (image) {
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        const sample = pdfText(entry.title, index.font, index.size, { paint: false })
        if (sample?.paintable || !entry.box) continue
        const box = entry.box
        const left = Math.max(0, offX + (box.x - rect.left))
        const top = Math.max(0, offY + (box.y - rect.top))
        const right = Math.min(vbW, left + inkWidth(box))
        const bottom = Math.min(vbH, top + box.h)
        if (!(right > left) || !(bottom > top)) continue
        const ref = await imageObject({ x: left, y: top, width: right - left, height: bottom - top })
        tocImages.set(entry, { name: `It${i}`, id: ref.id })
      }
    }

    if (!entries.length) {
      report('toc was asked for but the document has no headings to put in one — no index page written.')
    } else {
      // One /TOC element for the whole index, however many pages it runs to. Its
      // lines are generated navigation rather than prose, so they go out as ONE
      // marked sequence per page instead of one per line: a reader is told "this
      // is a table of contents" and then reads it in order, which is what a table
      // of contents is for.
      const tocNode = struct ? { type: 'TOC', alt: null, lang: null, children: [] } : null
      if (tocNode) frontStruct.push(tocNode)

      for (const built of tocLayout({
        entries, spec: index, pdfText, drawTitle, marginX, availW, contentTop, availH,
      })) {
        const annots = links ? built.annots.map(a => {
          annotCount++
          return `${doc.add(
            `<< /Type /Annot /Subtype /Link /Border [0 0 0] ` +
            `/Rect [${a.rect.map(n => n.toFixed(3)).join(' ')}] /Dest ${a.dest} >>`
          )} 0 R`
        }) : []
        const marks = matterMarks()
        const pageId = doc.reserve()
        const ops = marks
          ? marks.mark(tocNode, pageId, built.ops)
          : [...built.ops]
        artifact(ops, markOps(built.fonts))
        const body = ops.join('\n')
        const deflated = wantDeflate && canDeflate && !debugText
        const contentId = doc.addStream(
          deflated ? '/Filter /FlateDecode' : '',
          deflated ? await deflate(body) : body
        )
        doc.fill(pageId, pageDict({
          contentId, annots, fonts: built.fonts, xobjects: [...built.xobjects],
          structParents: marks ? marks.key : null,
        }))
        frontIds.push(pageId)
        flow?.tick('matter')
      }
    }
  }

  if (paginated && back && back.nodeType === 1) {
    flow?.check()
    const id = await matterPage(back, 'Ib', 'back')
    if (id) backIds.push(id)
    flow?.tick('matter')
  }

  if (unlinked) {
    report(`${unlinked} in-document link(s) got no annotation — their fragment has no destination here.`)
  }

  // `quality` only ever reaches the JPEG candidate. When every region compressed
  // smaller losslessly, a lowered quality changed nothing at all — same bytes,
  // same size — and saying so is the difference between a knob that looks broken
  // and one that was simply not the knob for this document.
  if (codec === 'auto' && quality < 0.92 && losslessRegions && !jpegRegions) {
    report(`quality ${quality} changed nothing: all ${losslessRegions} page image(s) compressed ` +
      'smaller LOSSLESSLY than any JPEG, so the JPEG quality controls was discarded. Page artwork ' +
      'is flat runs and sharp edges, which deflate handles better than DCT. For a lighter file ' +
      "lower the capture's `scale`/`dpr`, or force `codec: 'jpeg'` and accept the artefacts.")
  }

  // Counted across every page in the file, front matter included, and therefore
  // reported only once everything has been drawn.
  if (offPage) {
    report(`${offPage} text run(s) land outside the page box and will not be selectable — ` +
      'content painted outside the capture element is not in the raster either.')
  }
  if (dropped) {
    report(`${dropped} text run(s) left out of the text layer (more than 65,534 distinct codepoints).`)
  }
  if (vectorText && vectorPainted) {
    report(`${vectorPainted} text run(s) painted as real vector glyphs from the embedded fonts — ` +
      'crisp at any zoom' + (image ? ', over the raster.' : ', and the raster is off.'))
  }
  if (vectorMissed) {
    report(`${vectorMissed} text run(s) could not be painted as vector (RTL, no embedded face, or an ` +
      'unresolved colour) and there is no raster to show them — they are searchable but not visible. ' +
      'Keep image:true for those, or embed a covering font.')
  }
  if (cropped) {
    report(`${cropped} index line(s) show the heading's own pixels rather than typeset text — ` +
      'their script is outside base-14, and this plugin embeds no fonts. They stay searchable.')
  }
  if (unpaintable) {
    report(`${unpaintable} piece(s) of page furniture could not be drawn: the plugin's own text is ` +
      'base-14 only and cannot address that script. Put it in an element instead — header, footer ' +
      'and watermark all take one, and elements are captured.')
  }

  flow?.check()
  flow?.tick('assemble')

  // ——— structured annotations and fields ———
  //
  // Only now can /StructParent keys exist: every page — body, cover, contents,
  // colophon — has claimed its /StructParents key, and annotation keys must
  // continue past ALL of them in the one shared number tree. Links reserved
  // their dictionaries; widgets waited for their parent fields. Both get their
  // key, their bytes, and their /OBJR back into the owning node here.
  const widgetKeys = new Map()
  const annotRefs = []
  {
    let nextKey = markOwners.length
    for (const entry of annotStruct) {
      const key = nextKey++
      if (entry.dict !== null) doc.fill(entry.id, entry.dict + ` /StructParent ${key} >>`)
      else widgetKeys.set(entry.member, key)
      const list = marksOf.get(entry.node) || []
      list.push({ objr: entry.id, page: entry.pageId })
      marksOf.set(entry.node, list)
      annotRefs.push({ key, node: entry.node })
    }
  }
  const acroForm = fieldWriter
    ? fieldWriter.finish(member => widgetKeys.get(member) ?? null, fieldPlan.needAppearances)
    : null

  // Writes the ToUnicode CMap, so it has to run after the last encode().
  unicodeFont.finalize()
  // The embedded programs deflate here — after the last encode named its glyphs,
  // before the build wants their bytes.
  for (const f of embeddedFonts.values()) await f.finalize()
  if (embeddedFonts.size) {
    const faces = [...embeddedFonts.values()].filter(f => f.active)
    if (faces.length) {
      const subset = faces.every(f => f.subset)
      report(`fonts embedded: ${faces.map(f =>
        `${f.label} (${f.kB} kB${f.subset ? ` subset of ${f.wholeKB} kB` : ' whole'})`).join(', ')} — ` +
        (subset
          ? 'only the glyphs the page drew travel, renumbered into a dense subset.'
          : 'the whole file travels; glyphs are the ones the page was painted with.'))
    }
  }
  if (coverageFallbacks) {
    report(`${coverageFallbacks} run(s) paint characters their embedded face lacks — those runs ` +
      'fall back to the unembedded layer and stay searchable.')
  }

  // Bookmarks and named destinations. The name tree is written whether or not
  // there is an outline, because it is what makes `report.pdf#intro` work from a
  // href, an email or another PDF — a cross-reference into this file, from
  // outside it, without anything here knowing who is pointing.
  // `collectNav` speaks in destination NAMES, because a name is all it can know
  // before pagination exists. Only here is a name a point on a page, so this is
  // where the tree stops naming and starts pointing.
  const pointAt = (nodes) => nodes.map(node => ({
    title: node.title,
    dest: dests.get(node.dest) || null,
    children: pointAt(node.children),
  }))
  const outlineId = writeOutlines(doc, pointAt(outlineTree(nav?.outline || [])))
  const namesId = writeNameTree(doc, dests)

  // Structure last: a node only earns its place once something on a page pointed
  // back at it, and that is only known after every page has been drawn.
  // Front matter reads first, back matter last — the order of the PAGES, which is
  // not the order they were built in.
  const structRoot = struct && {
    type: 'Document', alt: null, lang: null,
    children: [...frontStruct, ...struct.root.children, ...backStruct],
  }
  const structId = struct
    ? writeStructTree(doc, structRoot, markOwners.map((_, i) => i), markOwners, marksOf, annotRefs)
    : null

  // The only place page ORDER is decided. Everything above added its objects
  // whenever it happened to be built.
  const kids = [...frontIds, ...pageIds, ...backIds]
  doc.fill(pagesId, `<< /Type /Pages /Kids [${kids.map(id => `${id} 0 R`).join(' ')}] /Count ${kids.length} >>`)

  // PDF/UA-1 eligibility, COMPUTED rather than configured. The claim is written
  // only when this export can show its work: every text-showing operation rode
  // an embedded face, the structure tree exists, the document says its language
  // and displays its title. Anything short of that is a named blocker — and the
  // absence of a claim, never a lie in the XMP.
  const fieldsWritten = fieldWriter ? fieldPlan.fields.length : 0
  const uaBlockers = []
  if (!embedFonts) uaBlockers.push('embedFonts: false')
  if (!struct) uaBlockers.push('tagged: false')
  if (!(lang || struct?.lang)) uaBlockers.push('no document language')
  if (!docMetaSpec?.title) uaBlockers.push('no meta.title to display')
  if (!embeddedFonts.size) uaBlockers.push('no embeddable @font-face behind the text')
  if (usedFonts.size) {
    const stacks = new Set()
    for (const run of layer.runs) {
      if (run.fk >= 0 && !bodyFaces[run.fk] && layer.fontKeys[run.fk]) {
        stacks.add(layer.fontKeys[run.fk].stack.split(',')[0].trim().replace(/^["']|["']$/g, ''))
      }
    }
    uaBlockers.push(`base-14 text remains${stacks.size ? ` (system or unfetched: ${[...stacks].slice(0, 4).join(', ')})` : ''}`)
  }
  if (unicodeFont.id !== null) uaBlockers.push('glyph-less fallback text remains')
  if (fieldsWritten) uaBlockers.push('fillable fields type in unembedded Helvetica')
  if (unnamedImages) uaBlockers.push(`${unnamedImages} image(s) without alternative text`)
  const claimUA = uaBlockers.length === 0
  if (claimUA) {
    report('document claims PDF/UA-1: every text operation uses an embedded face, structure is ' +
      'tagged, language and displayed title are set.')
  } else if (embedFonts && struct && embeddedFonts.size && !usedFonts.size && unicodeFont.id === null) {
    // Fonts are fully clean — the remaining blockers are one option away, so
    // they are worth a sentence. A plain default export stays quiet.
    report(`PDF/UA-1 claim withheld: ${uaBlockers.join('; ')}.`)
  }

  // Document identity. /Info is written always — /Producer is how a support
  // case tells this exporter's files apart — while the XMP packet exists only
  // when the caller said something worth mirroring into it.
  const infoId = doc.add(infoDict(docMetaSpec))
  // ENCODED, not passed as a string: the packet opens with the U+FEFF the XMP
  // spec demands and may carry any script the metadata does. The writer's
  // string path is Latin-1 and would truncate both — the BOM became a lone
  // 0xFF, malformed UTF-8 inside the very stream a validator reads first.
  const xmpId = docMetaSpec
    ? doc.addStream('/Type /Metadata /Subtype /XML', new TextEncoder().encode(
      xmpPacket(docMetaSpec, lang || struct?.lang || null, { pdfua: claimUA })))
    : null
  const labels = pageLabels({
    front: frontIds.length, body: pageIds.length, back: backIds.length,
  })

  doc.fill(catalogId,
    `<< /Type /Catalog /Pages ${pagesId} 0 R` +
    (outlineId ? ` /Outlines ${outlineId} 0 R` : '') +
    // Opening the sidebar is right for a document and wrong for a picture, and
    // the page count is what tells them apart: a one-page `page: 'fit'` capture
    // with an outline is still a picture, and a panel over it is just chrome.
    (outlineId && kids.length > 1 ? ' /PageMode /UseOutlines' : '') +
    (namesId ? ` /Names << /Dests ${namesId} 0 R >>` : '') +
    (structId ? ` /StructTreeRoot ${structId} 0 R /MarkInfo << /Marked true >>` : '') +
    // The language of the document, which is what decides how a screen reader
    // PRONOUNCES it. A tagged file without one is tagged for a reader that has to
    // guess.
    (struct && (lang || struct.lang) ? ` /Lang ${pdfTextString(lang || struct.lang)}` : '') +
    (acroForm ? ` /AcroForm ${doc.add(acroForm)} 0 R` : '') +
    (xmpId ? ` /Metadata ${xmpId} 0 R` : '') +
    (labels ? ` /PageLabels ${labels}` : '') +
    // Without this, a viewer shows the FILENAME over a document that took the
    // trouble to say its title.
    (docMetaSpec?.title ? ' /ViewerPreferences << /DisplayDocTitle true >>' : '') +
    ' >>')

  // ——— encryption ———
  //
  // Dead last, and after the catalog fill above: the pass rewrites every object
  // that exists, so anything written afterwards would travel in the clear inside
  // a file that says nothing is. Nothing may be added to `doc` below this line.
  if (encryptSpec) {
    const { p } = await doc.encrypt(catalogId, encryptSpec)
    report('the document is encrypted with AES-256 (standard security handler, revision 6). ' +
      'Without the user password the bytes cannot be read at all.' + (p === -1 ? '' :
        ' Permission flags are written too, and a flag is a REQUEST a viewer may honour — ' +
        'any tool can ignore it. Only the password protects anything.'))
  }

  const blob = new Blob([doc.build(catalogId, { infoId, fileId: true })], { type: 'application/pdf' })
  return {
    blob,
    stats: {
      pages: kids.length,
      fields: fieldWriter ? fieldPlan.fields.length : 0,
      annotations: annotCount,
      fontsEmbedded: [...embeddedFonts.values()].filter(f => f.active)
        .map(f => ({ name: f.baseName, label: f.label, kB: f.kB, subset: f.subset })),
      pdfua: claimUA,
      vectorText: vectorPainted,
    },
  }
}

/**
 * The plugin. Register it once and every capture gains a `toPdf()`.
 *
 * ```js
 *  * import pdf from './snapdom-pdf.mjs'
 *
 * snapdom.plugins(pdf())                        // or snapdom(el, { plugins: [pdf()] })
 * const blob = await (await snapdom(report)).toPdf({ page: 'a4' })
 * ```
 *
 * @param {object} [defaults] Options for every export this plugin serves. The
 *   four CAPTURE-TIME ones can ONLY be set here, because they decide what the
 *   capture measures:
 * @param {boolean} [defaults.formValues=true]  Put input/textarea/select values in the layer.
 * @param {boolean} [defaults.shadow=true]      Walk open shadow roots.
 * @param {boolean} [defaults.breakAvoid=true]  Keep rows, list items and cards off page breaks.
 * @param {boolean|string} [defaults.outline=true]  Build bookmarks from `h1`–`h6`
 *   (and `role="heading"`). A CSS selector uses that instead; `false` writes no
 *   outline. Named destinations and in-document links do not depend on it.
 * @returns {object} a snapdom plugin
 */
export default function pdf(defaults = {}) {
  // Export is lazy and may happen long after plugin registration. Keep the
  // factory call deterministic even if its caller later reuses/mutates `defaults`.
  const pluginDefaults = snapshotOptions({ ...(defaults || {}) })
  return {
    name: 'snapdom-pdf',
    needs: 'render',
    pure: true,

    // The searchable layer measures the final serialized SVG. A render-boundary
    // hook asks v3 to use that artifact even when html-in-canvas was requested.
    // This hook changes nothing, so repeated captures can still use burst/diff.
    beforeRender() {},

    /**
     * defineExports runs after every afterRender hook. Closing over its canonical
     * URL therefore captures the final composed artifact, including another
     * plugin's redactions/replacements, without measuring every PNG capture.
     */
    defineExports(ctx) {
      const facade = ctx.exports
      const artifactURL = ctx.export?.url
      const rawMeta = ctx.meta || {}
      const meta = Object.freeze({
        w0: rawMeta.w0,
        h0: rawMeta.h0,
        vbW: rawMeta.vbW,
        vbH: rawMeta.vbH,
        targetW: rawMeta.targetW,
        targetH: rawMeta.targetH,
        contentX: rawMeta.contentX,
        contentY: rawMeta.contentY,
        clip: rawMeta.clip ? Object.freeze({ ...rawMeta.clip }) : null,
      })
      // v3 width/height specify absolute output pixels and suppress scale. Crops
      // inherit that density in their SVG header; clearing width/height at the
      // canvas facade must not make the user's ignored scale apply again.
      const absoluteSize = Number.isFinite(ctx.width) || Number.isFinite(ctx.height)
      const rasterScale = absoluteSize ? 1 : ctx.scale
      const captureDensity = absoluteSize
        ? (Number.isFinite(ctx.width) ? meta.targetW / meta.vbW : meta.targetH / meta.vbH)
        : ctx.scale
      const source = Object.freeze({
        baseURL: String(ctx.element?.ownerDocument?.baseURI || document.baseURI),
        documentURL: String(ctx.element?.ownerDocument?.location?.href ||
          ctx.element?.ownerDocument?.baseURI || location.href),
        documentLang: String(ctx.element?.ownerDocument?.documentElement?.lang ||
          document.documentElement?.lang || ''),
      })
      let measuredPromise = null
      // The ENCODED bytes are cached for the life of the capture, and the canvas
      // they came from is not. That asymmetry is the whole point: a page's canvas
      // is megabytes of RGBA and its JPEG is a couple of hundred KB, so keeping
      // every region's canvas alive — one per page — held a 40-page export's worth
      // of bitmaps on an object the caller is still holding. Nothing pays for the
      // drop: within one export every repeat of a region (a repeated table header,
      // a heading cropped for the index) hits this cache before a canvas is ever
      // asked for, and only re-exporting the SAME capture at a different quality,
      // codec or background rasterizes twice.
      const imageCache = new Map()

      const cropKey = (crop) => crop
        ? ['crop', crop.x, crop.y, crop.width, crop.height].map(String).join(':')
        : 'full'
      const rasterFor = (options) => async (crop = null) => {
        const key = JSON.stringify([
          cropKey(crop), options.quality, options.backgroundColor, options.codec,
        ])
        if (imageCache.has(key)) return imageCache.get(key)
        const promise = Promise.resolve().then(async () => {
          // Alpha is kept here; background flattening belongs to encodeImage.
          const canvas = await facade.canvas({
            backgroundColor: null,
            width: absoluteSize ? (crop?.width ?? meta.vbW) * captureDensity : null,
            height: absoluteSize ? (crop?.height ?? meta.vbH) * captureDensity : null,
            scale: rasterScale,
            ...(crop ? { crop } : {}),
          })
          return encodeImage(canvas, {
            quality: options.quality,
            background: options.backgroundColor,
            codec: options.codec,
          })
        })
        imageCache.set(key, promise)
        promise.catch(() => { if (imageCache.get(key) === promise) imageCache.delete(key) })
        return promise
      }
      const measuredForCapture = () => {
        if (!measuredPromise) measuredPromise = measureArtifact(artifactURL, meta, pluginDefaults, source)
        return measuredPromise
      }

      return {
        pdf: async (exportCtx, exportOptions = exportCtx.export?.options || {}) => {
          const requested = exportCtx.export?.requestedOptions
          if (!requested) {
            throw new Error('[snapdom-pdf] this build requires @zumer/snapdom >=3.0.0-beta.0 <4 ' +
              '(missing export.requestedOptions)')
          }
          const opts = { ...requested }
          // The raw request records explicit keys so normalized core defaults do
          // not overwrite pdf() defaults. beforeExport can still steer this export
          // by mutating its effective option bag, including removing request keys.
          for (const key of Object.keys(opts)) {
            if (!Object.hasOwn(exportOptions, key)) delete opts[key]
          }
          for (const [key, value] of Object.entries(exportOptions)) {
            if (Object.hasOwn(requested, key) || !Object.is(value, exportCtx[key])) opts[key] = value
          }
          if (Array.isArray(opts.page)) opts.page = [...opts.page]
          const notes = []
          const report = (msg) => notes.push(msg)

          for (const key of CAPTURE_TIME) {
            if (key in opts && opts[key] !== pluginDefaults[key]) {
              report(`\`${key}\` is decided when the capture measures the DOM — set it on ` +
                `pdf({ ${key}: … }), not on the export. Ignored here.`)
            }
          }
          // Names that no longer mean anything here, and the two that would have
          // collided with the engine's own: `compress` downsamples inlined images
          // and `filename` defaults to 'snapDOM', which as a download trigger would
          // have made every PDF save itself. Hence `deflate` and `download`, which
          // the engine has no opinion about.
          for (const gone of ['mode', 'vector', 'scale', 'background', 'filename', 'compress']) {
            if (gone in opts) {
              report(`\`${gone}\` is not a PDF option — see the reference at ` +
                'https://snapdom.dev/pro/pdf/docs.html. Ignored.')
            }
          }

          // The capture owns its own resolution and its own flattening; the PDF side
          // reads them rather than re-deciding them.
          const options = {
            ...pluginDefaults, ...opts, scale: captureDensity, dpr: exportCtx.dpr,
            rasterDensity: absoluteSize ? captureDensity : null,
          }
          if (!Object.hasOwn(options, 'quality')) options.quality = exportCtx.quality ?? 0.92
          if (!Object.hasOwn(options, 'backgroundColor')) {
            options.backgroundColor = exportCtx.backgroundColor ?? null
          }
          if (!Object.hasOwn(options, 'codec')) options.codec = 'auto'
          options.captureOptions = {
            exclude: exportCtx.excludePredicates?.length
              ? [...(exportCtx.exclude || []), ...exportCtx.excludePredicates]
              : exportCtx.exclude,
            excludeMode: exportCtx.excludeMode,
            plugins: exportCtx.plugins,
            reconcile: exportCtx.reconcile,
            embedFonts: exportCtx.embedFonts,
            localFonts: exportCtx.localFonts,
            excludeFonts: exportCtx.excludeFonts,
            fontStylesheetDomains: exportCtx.fontStylesheetDomains,
            useProxy: exportCtx.useProxy,
            fallbackURL: exportCtx.fallbackURL,
            compress: exportCtx.compress,
            excludeStyleProps: exportCtx.excludeStyleProps,
            outerTransforms: exportCtx.outerTransforms,
            outerShadows: exportCtx.outerShadows,
            captureSelection: exportCtx.captureSelection,
            iconFonts: exportCtx.iconFonts,
            placeholders: exportCtx.placeholders,
          }

          // All cheap validation precedes snapshot mount, canvas allocation and codec work.
          validateExport(options, meta)
          const flow = flowSpec({ signal: options.signal, onProgress: options.onProgress })
          const onReport = reportSpec(options.onReport)
          if (options.meta != null && (typeof options.meta !== 'object' || Array.isArray(options.meta))) {
            throw new TypeError('[snapdom-pdf] meta must be an object of document properties')
          }
          flow?.check()
          flow?.tick('measure')
          const measured = await measuredForCapture()
          if (!measured.rect.width || !measured.rect.height) {
            throw new Error('[snapdom-pdf] the final captured tree has no layout box')
          }
          notes.push(...measured.notes)

          const raster = options.image === false ? null : rasterFor(options)
          const { blob, stats } = await draw({ measured, raster, meta, options, report, flow })
          for (const n of notes) warn(n)
          onReport?.(buildReport({
            messages: notes, pages: stats.pages, bytes: blob.size,
            fields: stats.fields, annotations: stats.annotations,
            fontsEmbedded: stats.fontsEmbedded, pdfua: stats.pdfua,
            vectorText: stats.vectorText,
          }))
          return deliver(blob, options.download)
        },
      }
    },
  }
}

export { pdf }
