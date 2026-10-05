/**
 * Page-break geometry: where a slice boundary may fall without cutting through
 * something that reads as a single object — a table row, a list item, a card,
 * an image. Fixed bands cut blind; these two functions replace them.
 *
 * Two spaces are in play, and converting between them is the CALLER's job:
 * collectBlocks reads the DOM, so it returns VIEWPORT CSS px; paginate answers
 * in CONTENT px, where 0 is the top of the capture element's box and the unit
 * is whatever the page geometry uses. index.js owns the element rect and the
 * draw scale, so only it can map one onto the other:
 *
 *   contentY = (viewportY - rect.top) * PT * drawScale
 *
 * A block is `{ top, bottom, forced?, loose? }`. Only the two coordinates need
 * converting, but the flags have to survive the trip: a caller that rebuilds bare
 * `{ top, bottom }` pairs turns every declared break into a zero-height span and
 * every long paragraph into a constraint no cut may straddle.
 */

const EPS = 1e-6

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META'])

/**
 * Elements a break must not cut. Each one is either a row/item of a repeating
 * structure or replaced content: half of it on each page is always wrong, and
 * none of them is a general-purpose container, so treating them as atomic still
 * leaves a legal break between every pair of them. Containers (section, div,
 * table, ul) are deliberately absent — make those atomic and a long document
 * can never break at all.
 */
const ATOMIC_TAGS = new Set([
  'TR', 'THEAD', 'TFOOT', 'LI', 'DT', 'DD', 'FIGURE', 'BLOCKQUOTE',
  'IMG', 'SVG', 'CANVAS', 'VIDEO', 'IFRAME', 'INPUT', 'SELECT', 'TEXTAREA', 'BUTTON',
])

/** Subtrees with no flow of their own to break: descending costs time and yields nothing. */
const OPAQUE_TAGS = new Set(['SVG', 'CANVAS', 'VIDEO', 'IFRAME', 'SELECT', 'TEXTAREA'])

const FORCED = /^(always|page|left|right|recto|verso)$/
const AVOID = /^avoid/
const CONTAIN_PAINT = /\b(paint|strict|content)\b/

/**
 * Boxes whose children are all inline — a heading, a caption, a short paragraph.
 * The inline-level box types count: a chip or a KPI card is `inline-block` far
 * more often than `block`, and it tears exactly as badly.
 */
function isLeafBlock(el, style, styleOf) {
  if (!/^((inline-)?(block|flex|grid)|flow-root|list-item|table-caption)$/.test(style.display)) return false
  for (const child of el.children) {
    const d = styleOf(child).display
    if (!/^inline/.test(d) && d !== 'contents' && d !== 'none') return false
  }
  return true
}

/**
 * `true` — a break must not cut this box. `false` — it may, but the box is still
 * evidence that something is painted there, which is all paginate needs to tell a
 * blank tail from a long one. `null` — a container: evidence of nothing.
 */
function atomicity(el, tag, style, height, maxLeaf, styleOf) {
  if (AVOID.test(style.breakInside) || AVOID.test(style.pageBreakInside)) return true
  if (ATOMIC_TAGS.has(tag)) return true
  if (!isLeafBlock(el, style, styleOf)) return null
  // Judgement call: a short leaf block split across pages reads as a defect,
  // but past maxLeaf it is just a long paragraph, and breaking those is normal
  // typography — plus every one kept whole is a break point taken away.
  return height <= maxLeaf
}

// ——— clipping ———
//
// A rect only means what it says while nothing crops it. An overflow ancestor
// shows a window onto its content, and a scrolled or overflowing descendant
// reports a rect for a place nothing is painted — refusing a legal cut, or
// dragging one up, for content that is not on the page at all.
//
// DUPLICATED from text-layer.js, which runs the same tests to prune clipped
// runs. Its versions are the reference (they also map through the accumulated
// transform); these should become imports the moment that module exports a clip
// rect built PER AXIS — an axis left 'visible' has to come back unbounded, and a
// rect snapped to the padding box on both would crop content that paints.

const NO_CLIP = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity }

function intersect(a, b) {
  if (a === NO_CLIP) return b
  return {
    left: Math.max(a.left, b.left), top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom),
  }
}

function clipsContent(s) {
  // A 'visible' axis beside a non-visible one COMPUTES to 'auto' — except beside
  // 'clip', which leaves it visible. So this is the gate only; WHICH axes crop is
  // paddingBox's answer.
  return s.overflowX !== 'visible' || s.overflowY !== 'visible' || CONTAIN_PAINT.test(s.contain)
}

/**
 * Anything here makes the element the containing block of its absolute
 * descendants. The individual transform properties are guarded like text-layer's
 * copy: where the engine does not have them, `undefined !== 'none'` would make
 * EVERY element a containing block and collapse clipAbs to the nearest clipper.
 */
function isContainingBlock(s) {
  return s.position !== 'static' || s.transform !== 'none' || s.filter !== 'none' ||
    s.perspective !== 'none' || (s.rotate || 'none') !== 'none' || (s.scale || 'none') !== 'none' ||
    (s.translate || 'none') !== 'none' ||
    (s.backdropFilter || 'none') !== 'none' || s.willChange.includes('transform') ||
    CONTAIN_PAINT.test(s.contain)
}

/**
 * The computed value is `<visual-box> || <length>`, serialised keyword-first with
 * the default `padding-box` dropped — `20px content-box` computes to the string
 * `content-box 20px`, `padding-box 30px` to `30px`. So the length is the LAST
 * token, and reading the whole string gives NaN for every two-value form: the
 * clip would snap back to the padding box and refuse cuts through content that
 * paints. The keyword itself is not modelled, because the residual is smaller
 * than the boxes this decides between: measured in Chromium on a 10px padding /
 * 3px border box, `content-box 20px` puts this edge 10px outside the true one and
 * `border-box 5px` 3px inside it — the box's own padding or border, either way.
 */
function clipMargin(style) {
  const parts = (style.overflowClipMargin || '').trim().split(/\s+/)
  return parseFloat(parts[parts.length - 1]) || 0
}

/**
 * The clip is the PADDING box; getBoundingClientRect gives the border box, and
 * client* are the transform-free layout metrics that inset it — exact for the
 * axis-aligned boxes this module models. Inline boxes report clientWidth 0 and
 * SVG/MathML roots report no offsetWidth at all; both take the border box — a clip
 * one border wider than it should be — rather than an empty one that swallows the
 * subtree. The offsetWidth half of that test earns its place in text-layer, whose
 * mapped box cannot be placed without it, and stays here so both take the same
 * branch on the same elements.
 */
function paddingBox(el, style, rect) {
  const paint = CONTAIN_PAINT.test(style.contain)
  // The margin only widens a clip that HAS an outward edge: 'hidden' crops at the
  // padding box and ignores it, though Chromium reports a length there all the
  // same. Among the overflow values the cropping axes are then exactly the 'clip'
  // ones, since 'clip' beside any other non-visible value computes to 'hidden'.
  // Paint containment is the other way in: it crops both axes while `overflow`
  // still computes 'visible', which is why it gates the margin on its own.
  const m = paint || style.overflowX === 'clip' || style.overflowY === 'clip'
    ? clipMargin(style)
    : 0
  const w = el.clientWidth
  let box
  if (!w || !el.offsetWidth) {
    box = { left: rect.left - m, top: rect.top - m, right: rect.right + m, bottom: rect.bottom + m }
  } else {
    const left = rect.left + el.clientLeft - m
    const top = rect.top + el.clientTop - m
    box = { left, top, right: left + w + 2 * m, bottom: top + el.clientHeight + 2 * m }
  }
  // An axis still 'visible' crops nothing — 'overflow-x: clip' next to
  // 'overflow-y: visible' is a real computed pair, and cropping Y there would
  // discard blocks that are painted and breakable. contain:paint crops both.
  if (!paint && style.overflowX === 'visible') { box.left = -Infinity; box.right = Infinity }
  if (!paint && style.overflowY === 'visible') { box.top = -Infinity; box.bottom = Infinity }
  return box
}

/** Inclusive, because a zero-size break marker still sits inside its container. */
function inClip(rect, clip) {
  return clip === NO_CLIP || (
    rect.right >= clip.left - EPS && rect.left <= clip.right + EPS &&
    rect.bottom >= clip.top - EPS && rect.top <= clip.bottom + EPS)
}

/** Only the painted part of a box is breakable, so spans and points both clamp. */
const clampY = (y, clip) => Math.min(Math.max(y, clip.top), clip.bottom)

/**
 * Vertical spans, in VIEWPORT CSS px, that a page break must not cut.
 *
 * A plain `{ top, bottom }` entry is such a span, and always has height. The two
 * flags are the exceptions at either extreme. `forced: true` has `top === bottom`
 * and is not a span at all but a point: a break-before / break-after: always|page
 * the author declared, which paginate honours first — the zero height makes it
 * inert to the straddle test. `loose: true` is a leaf block too tall to protect:
 * a break MAY cut it, it constrains nothing, and it is here only because a long
 * paragraph is otherwise indistinguishable from empty space to a caller deciding
 * whether a trailing region is worth a page.
 *
 * Nothing here is capped by page size — collectBlocks does not know it. A block
 * taller than a page is paginate's problem, and it cuts it.
 *
 * @param {Element} root
 * @param {object} [options]
 * @param {number} [options.maxLeaf=200] CSS px; above this a leaf block may be cut.
 * @param {boolean} [options.shadow=true] Walk shadow roots too.
 * @returns {Array<{top: number, bottom: number, forced?: boolean, loose?: boolean}>} unsorted
 */
export function collectBlocks(root, options = {}) {
  const { maxLeaf = 200, shadow = true } = options
  const blocks = []
  const seen = new Set()
  const styles = new WeakMap()
  const styleOf = (el) => {
    let s = styles.get(el)
    if (!s) { s = getComputedStyle(el); styles.set(el, s) }
    return s
  }

  // Nested elements share edges constantly (a td inside a tr inside a table);
  // half-pixel keys keep the boundary list to the distinct ones.
  const push = (top, bottom, kind = '') => {
    if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom < top) return
    const key = `${kind}${Math.round(top * 2)}:${Math.round(bottom * 2)}`
    if (seen.has(key)) return
    seen.add(key)
    blocks.push(kind ? { top, bottom, [kind]: true } : { top, bottom })
  }

  /**
   * A long paragraph may be split, but never through a painted line. Range gives
   * one rect per line fragment for a whole text node, which is precisely the set
   * of small atomic spans paginate needs. This is paid only for loose leaf blocks;
   * short prose is already protected by its block box and containers never enter.
   */
  const protectLines = (leaf, clip) => {
    if ((styleOf(leaf).writingMode || 'horizontal-tb') !== 'horizontal-tb') return
    const range = leaf.ownerDocument.createRange()
    const seenNodes = new Set()
    const scan = (node) => {
      if (!node || seenNodes.has(node)) return
      seenNodes.add(node)
      if (node.nodeType === Node.TEXT_NODE) {
        if (!/\S/.test(node.data || '')) return
        const parent = node.parentElement || (node.getRootNode() instanceof ShadowRoot
          ? node.getRootNode().host : null)
        if (parent) {
          const cs = styleOf(parent)
          if (cs.display === 'none' || cs.visibility !== 'visible' || cs.opacity === '0') return
        }
        range.selectNodeContents(node)
        for (const rect of range.getClientRects()) {
          if (!(rect.width > EPS && rect.height > EPS) || !inClip(rect, clip)) continue
          const top = clampY(rect.top, clip)
          const bottom = clampY(rect.bottom, clip)
          if (bottom - top > EPS) push(top, bottom)
        }
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return
      const tag = node.tagName.toUpperCase()
      if (SKIP_TAGS.has(tag)) return
      const cs = styleOf(node)
      if (cs.display === 'none' || cs.opacity === '0') return

      let kids
      if (node.shadowRoot) kids = node.shadowRoot.childNodes
      else if (tag === 'SLOT') kids = node.assignedNodes({ flatten: true })
      else kids = node.childNodes
      for (const kid of kids) scan(kid)
    }
    scan(leaf)
  }

  const walk = (el, clip, clipAbs) => {
    const tag = el.tagName.toUpperCase()
    if (SKIP_TAGS.has(tag)) return
    const style = styleOf(el)
    // display:none and opacity:0 hide the whole subtree; visibility:hidden does
    // not, since a descendant can turn it back on.
    if (style.display === 'none' || style.opacity === '0') return
    // Out of flow: a break "through" one of these is meaningless, and the rect it
    // reports has nothing to do with where its content sits in the page — a stuck
    // header is parked somewhere its flow position never was.
    if (style.position === 'fixed' || style.position === 'sticky') return

    // An absolute box escapes every clipper outside its containing-block chain.
    const own = style.position === 'absolute' ? clipAbs : clip
    let inner = own

    if (style.display !== 'contents') {
      const rect = el.getBoundingClientRect()
      if (inClip(rect, own)) {
        const top = clampY(rect.top, own)
        const bottom = clampY(rect.bottom, own)
        // Not behind the size guard: `<div style="page-break-after:always">` is
        // the idiomatic marker and it is deliberately empty. An author who put a
        // break on an invisible element still meant the break.
        if (FORCED.test(style.breakBefore) || FORCED.test(style.pageBreakBefore)) push(top, top, 'forced')
        if (FORCED.test(style.breakAfter) || FORCED.test(style.pageBreakAfter)) push(bottom, bottom, 'forced')
        // maxLeaf is measured on the PAINTED extent, not the layout one: what a
        // break can tear is what shows, so a 600px card cropped to 60 visible px
        // is as protectable as a 60px one — and one cropped to nothing is not a
        // span at all, since a zero height is the forced points' signature.
        if (bottom - top > EPS && rect.width > 0 && style.visibility !== 'hidden') {
          const atomic = atomicity(el, tag, style, bottom - top, maxLeaf, styleOf)
          if (atomic !== null) {
            push(top, bottom, atomic ? '' : 'loose')
            if (!atomic) protectLines(el, own)
          }
        }
      }
      if (clipsContent(style)) inner = intersect(own, paddingBox(el, style, rect))
    }

    if (OPAQUE_TAGS.has(tag)) return
    const innerAbs = isContainingBlock(style) ? inner : clipAbs
    for (const child of el.children) walk(child, inner, innerAbs)
    if (shadow && el.shadowRoot) for (const child of el.shadowRoot.children) walk(child, inner, innerAbs)
  }

  // root itself is skipped: the capture element is the container by definition,
  // and a break before or after the whole capture has nowhere to go. Its clip is
  // not skipped — snapdom crops the raster to it just as the screen does.
  const rootStyle = styleOf(root)
  const rootClip = clipsContent(rootStyle)
    ? paddingBox(root, rootStyle, root.getBoundingClientRect())
    : NO_CLIP
  for (const child of root.children) walk(child, rootClip, rootClip)
  if (shadow && root.shadowRoot) for (const child of root.shadowRoot.children) walk(child, rootClip, rootClip)

  return blocks
}

// ——— repeated header bands ———
//
// A `<thead>` is the one band of a document that belongs at the top of every page
// its table reaches, and the browser's own print path already does this. It is
// modelled here rather than at the paint, because it is not decoration over the
// page: a repeated header TAKES ROOM, so pagination has to know about it or the
// rows underneath end up behind it.

/**
 * Header bands, in VIEWPORT CSS px: a `<thead>` whose table continues below it.
 *
 * `bodyBottom` is the table's own bottom edge, and it is what decides where
 * repeating stops — a header goes on every page the TABLE reaches and not one
 * more, which is a fact about the table and not about where the cuts fell.
 *
 * @param {Element} root
 * @param {object} [options]
 * @param {boolean} [options.shadow=true]
 * @returns {Array<{top: number, bottom: number, bodyBottom: number}>} in document order
 */
export function collectRepeats(root, options = {}) {
  const { shadow = true } = options
  const bands = []

  const record = (table) => {
    const head = table.tHead
    if (!head) return
    const style = getComputedStyle(head)
    if (style.display === 'none' || style.visibility === 'hidden') return
    const rect = head.getBoundingClientRect()
    const box = table.getBoundingClientRect()
    if (!(rect.height > EPS) || !(rect.width > EPS)) return
    // A table whose body ends at its header has nothing to continue onto a second
    // page, so there is nothing to repeat and no room to take.
    if (box.bottom <= rect.bottom + EPS) return
    bands.push({ top: rect.top, bottom: rect.bottom, bodyBottom: box.bottom })
  }

  const walk = (el) => {
    const tag = el.tagName.toUpperCase()
    if (SKIP_TAGS.has(tag)) return
    if (tag === 'TABLE') record(el)
    for (const child of el.children) walk(child)
    if (shadow && el.shadowRoot) for (const child of el.shadowRoot.children) walk(child)
  }
  for (const child of root.children) walk(child)
  if (shadow && root.shadowRoot) for (const child of root.shadowRoot.children) walk(child)

  return bands.sort((a, b) => a.top - b.top)
}

/**
 * Which header bands belong at the top of a page starting at `top` — the ONE
 * answer both the pagination and the paint read, so the room reserved and the
 * room used cannot drift apart.
 *
 * All or nothing against `maxHeight`: repeating an inner table's header while
 * dropping the outer one's produces a page that is worse than either choice, and
 * a header that will not fit is a fact worth reporting rather than trimming.
 *
 * @param {Array<{top:number, bottom:number, bodyBottom:number}>} bands  CONTENT px
 * @param {number} top        content y the page starts at
 * @param {number} maxHeight  the most a page may give up to repeated headers
 * @returns {{bands: Array, height: number, refused: boolean}}
 */
export function repeatsAt(bands, top, maxHeight) {
  const none = { bands: [], height: 0, refused: false }
  if (!bands || !bands.length) return none
  const on = []
  let height = 0
  for (const b of bands) {
    // Entirely above this page (so it was drawn on an earlier one) and its table
    // still has rows down here.
    if (b.bottom <= top + EPS && b.bodyBottom > top + EPS) {
      on.push(b)
      height += b.bottom - b.top
    }
  }
  if (!on.length) return none
  if (height > maxHeight) return { bands: [], height: 0, refused: true }
  return { bands: on, height, refused: false }
}

/**
 * The `reserve` callback `paginate` takes, built from header bands.
 * @param {Array} bands CONTENT px, as `repeatsAt` expects
 * @param {number} maxHeight
 * @returns {((top: number) => number)|null} null when nothing can ever repeat
 */
export function headerReserve(bands, maxHeight) {
  if (!bands || !bands.length) return null
  return (top) => repeatsAt(bands, top, maxHeight).height
}

/** Below this a slice is a blank page, and rounding noise could make it zero. */
const MIN_SLICE = 1

/**
 * Cut [0, contentHeight) into page slices, in CONTENT px.
 *
 * Greedy: the ideal cut is top + availHeight, pulled UP to the highest block
 * boundary that no atomic block straddles. A break the author declared beats
 * both, wherever in the window it falls, unless all it would buy is a blank final
 * page. The slices tile exactly — no gaps, no overlaps, the last one ends at
 * contentHeight, every height in (0, that page's own room].
 *
 * @param {object} args
 * @param {Array<{top: number, bottom: number, forced?: boolean, loose?: boolean}>} [args.blocks]
 * @param {number} args.contentHeight
 * @param {number} args.availHeight
 * @param {number} [args.minFill=0.2] a cut may not leave a page emptier than this fraction; below
 *                                    it, cutting an atomic block beats a nearly blank page
 * @param {(top: number) => number} [args.reserve] room, in content px, this page gives up before
 *   its own content starts — repeated table headers. It is a function of the page's TOP alone,
 *   which is what keeps this a single pass: what repeats on a page depends on where the page
 *   BEGINS, never on where it ends, so there is no fixed point to iterate towards. Clamped to
 *   half of `availHeight`, so a caller cannot starve a page into an infinite loop
 * @returns {{slices: Array<{top: number, height: number, cut: number}>, forcedIgnored: number}}
 *   `cut` is how many atomic blocks this slice's BOTTOM edge tears — 0 is a clean break, and the
 *   last slice is always 0. Sum them for the damage report. `forcedIgnored` counts declared breaks
 *   dropped because they landed within MIN_SLICE of a cut already taken, or because the page they
 *   would open is both under minFill and free of any block. A break outside
 *   `(EPS, contentHeight - MIN_SLICE)` is dropped WITHOUT being counted, and for two different
 *   reasons: at either end of the document the boundary it asks for is already the edge, while
 *   above or below the document there is no page for it to open — an absolute box parked past
 *   contentHeight is not in the raster either, so a warning would name content the export never
 *   had.
 */
export function paginate({ blocks = [], contentHeight, availHeight, minFill = 0.2, reserve = null }) {
  if (!Number.isFinite(contentHeight) || contentHeight <= 0) throw new Error('paginate: contentHeight must be a positive finite number')
  if (!Number.isFinite(availHeight) || availHeight <= 0) throw new Error('paginate: availHeight must be a positive finite number')
  const fill = Math.min(0.9, Math.max(0, minFill))

  const atoms = []
  const forced = []
  // Deepest recorded box, protected or not — the only answer to "is anything down
  // there?" this function can get.
  let ink = -Infinity
  for (const b of blocks) {
    const { top, bottom } = b
    if (b.forced) {
      // At or past either end of the document, or inside a final band too short
      // to be a page: the boundary is already there, or there is no page for it
      // to open. Neither is a loss, so neither is counted below.
      if (top > EPS && top < contentHeight - MIN_SLICE) forced.push(top)
      continue
    }
    // Degenerate, out-of-page and non-finite spans can only add noise to the
    // edge list; the negated comparison is what excludes NaN.
    if (!(bottom - top > EPS) || bottom <= EPS || top >= contentHeight - EPS) continue
    if (bottom > ink) ink = bottom
    // A loose block is content, never a constraint: in `edges` it would move cuts,
    // in `atoms` it would refuse them.
    if (!b.loose) atoms.push({ top, bottom })
  }
  forced.sort((a, b) => a - b)

  const edges = [...new Set(atoms.flatMap(a => [a.top, a.bottom]))].sort((a, b) => a - b)

  // Half a page is the most repeated headers may ever take. Past that the page is
  // more furniture than content, and — since `room` is what every advance below is
  // measured against — a reserve free to approach availHeight could stall the walk.
  const MAX_RESERVE = 0.5
  const roomAt = (y) => (reserve
    ? availHeight - Math.min(Math.max(0, reserve(y)), availHeight * MAX_RESERVE)
    : availHeight)
  // The smallest page any reserve can produce, which is what the iteration belt
  // has to be sized against.
  const minRoom = reserve ? availHeight * (1 - MAX_RESERVE) : availHeight

  // A block taller than a page has to be cut wherever it lands, so it is left out
  // of both the straddle test — honouring it would drag every cut back to top —
  // and the damage count, where it would report unavoidable breakage every time.
  // Measured against THIS page's room: a block that fits on a full page but not on
  // one carrying a repeated header is genuinely uncuttable there.
  const breakable = (a, room) => a.bottom - a.top < room - EPS
  /**
   * figure > blockquote > p torn by one break is ONE visible tear, not three, so
   * only spans no other straddling span contains are counted. Sorted by (top asc,
   * bottom desc), a span is contained exactly when it ends no lower than the
   * deepest reach so far.
   */
  const damage = (y, room) => {
    const hit = atoms
      .filter(a => a.top < y - EPS && a.bottom > y + EPS && breakable(a, room))
      .sort((p, q) => p.top - q.top || q.bottom - p.bottom)
    let n = 0
    let reach = -Infinity
    for (const a of hit) if (a.bottom > reach + EPS) { n++; reach = a.bottom }
    return n
  }

  const slices = []
  let top = 0
  // Every slice advances by at least min(fill * room, MIN_SLICE), and only a
  // forced cut can advance by that little — one per declared break. Sized on the
  // SMALLEST room any page can have, so the bound stays true under a reserve.
  const limit = Math.ceil(contentHeight / Math.max(minRoom * fill, MIN_SLICE)) + forced.length + 8

  while (top < contentHeight - EPS && slices.length < limit) {
    const room = roomAt(top)
    const minPage = Math.max(room * fill, MIN_SLICE)
    const ideal = top + room
    const floor = top + minPage
    // Looked up before the tail: a break declared in the last page-and-a-bit is
    // the one that separates the final two sections of most reports.
    const declared = forced.find(y => y >= top + MIN_SLICE && y <= ideal + EPS)

    // Everything left fits on one page, so a break here is worth a page of its own
    // only if something is on it. Drop one whose page would be BOTH emptier than
    // minFill allows and free of any block: `break-after: page` on the LAST section
    // sits the capture element's bottom padding — or a shadow's bleed — above the
    // end, and ships a page of pure background. Both tests are needed, and neither
    // is more than the block list knows: a region holding only what collectBlocks
    // declines to record reads as empty here, which is why it records loose ones.
    if (contentHeight - top <= room + EPS &&
        (declared === undefined || (contentHeight - declared < minPage && ink <= declared + EPS))) {
      slices.push({ top, height: contentHeight - top, cut: 0 })
      top = contentHeight
      break
    }

    let cut = declared                                 // the author said break here
    if (cut === undefined) {
      const active = atoms.filter(a => a.top < ideal - EPS && a.bottom > floor + EPS && breakable(a, room))
      const straddled = (y) => active.some(a => a.top < y - EPS && a.bottom > y + EPS)
      cut = null
      if (!straddled(ideal)) cut = ideal
      else {
        for (let i = edges.length - 1; i >= 0; i--) {
          const y = edges[i]
          if (y > ideal + EPS) continue
          if (y < floor - EPS) break
          if (!straddled(y)) { cut = y; break }
        }
      }
      // No legal boundary that still fills the page: cut through, and report it.
      if (cut === null) cut = ideal
    }

    slices.push({ top, height: cut - top, cut: damage(cut, room) })
    top = cut
  }

  // Only reachable through the iteration belt: tile the rest blind rather than
  // silently losing the tail of the document.
  while (top < contentHeight - EPS) {
    const height = Math.min(roomAt(top), contentHeight - top)
    slices.push({ top, height, cut: 0 })
    top += height
  }

  // Cuts are assigned from `forced` verbatim, so identity is exact.
  const taken = new Set(slices.map(s => s.top))
  return { slices, forcedIgnored: forced.reduce((n, y) => n + (taken.has(y) ? 0 : 1), 0) }
}
