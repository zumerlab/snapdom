/**
 * Front and back matter: a cover, a generated index, a closing page.
 *
 * These are the pages that are NOT the capture. A cover and a colophon are
 * captured elements of your own — same engine, same fidelity, whatever CSS you
 * put in them — placed one to a page. The index is the opposite: it is generated,
 * because its content does not exist anywhere until pagination has happened, and
 * it is drawn as REAL PDF TEXT so its links are live, its type is crisp at any
 * zoom and it costs a few hundred bytes rather than another raster.
 *
 * The index is only possible at all because `nav.js` already had to find the
 * headings and `index.js` already had to place them on pages. Nothing here reads
 * the DOM: it is handed finished entries and lays them out.
 *
 * Front matter is deliberately OUTSIDE the page numbering. A cover that says
 * "1 / 14" is a cover nobody would ship, and an index that counts itself makes
 * every number in it disagree with the number printed on the page it names.
 */

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

function rgb(colour) {
  const m = HEX.exec(String(colour || '').trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const n = parseInt(h, 16)
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]
}

/**
 * Content-stream ops that place a captured page image inside the page box:
 * scaled to fit and centred, aspect preserved, margins ignored.
 *
 * Fit rather than fill, so nothing is ever cropped — a cover whose title is cut
 * off is a worse failure than one with a band of paper down its side. Design the
 * element at the page's aspect ratio and fit IS full bleed.
 *
 * @param {{name: string, pageW: number, pageH: number, aspect: number}} args
 *   `aspect` is height / width of the captured element.
 */
export function fullPageOps({ name, pageW, pageH, aspect }) {
  const ratio = aspect > 0 ? aspect : 1
  let w = pageW
  let h = w * ratio
  if (h > pageH) { h = pageH; w = h / ratio }
  return [
    'q',
    `${w.toFixed(3)} 0 0 ${h.toFixed(3)} ${((pageW - w) / 2).toFixed(3)} ${((pageH - h) / 2).toFixed(3)} cm`,
    `/${name} Do`,
    'Q',
  ]
}

/**
 * Normalise the `toc` option. `true` has to be the whole feature, because for
 * most documents "put an index in" is the entire thought.
 *
 * @returns {{title: string, levels: number, size: number, font: string,
 *            indent: number, dots: boolean, colour: number[], leader: number[]}|null}
 */
export function tocSpec(option) {
  if (!option) return null
  const o = option === true ? {} : (typeof option === 'string' ? { title: option } : option)
  return {
    title: o.title == null ? 'Contents' : String(o.title),
    // Depth, not heading level: an index of a document that starts at h2 should
    // still show two tiers, and depth is what the outline already nests by.
    levels: Number.isFinite(o.levels) && o.levels > 0 ? Math.floor(o.levels) : 3,
    size: Number.isFinite(o.size) && o.size > 0 ? o.size : 10,
    font: o.font === 'serif' || o.font === 'mono' || o.font === 'sans'
      ? o.font
      // The document's own embedded face when the export has one; an explicit
      // base-14 request keeps meaning exactly what it says.
      : 'document',
    indent: Number.isFinite(o.indent) ? o.indent : 14,
    // The number as the index PRINTS it. Plain by default, which is the numeral
    // the standard "3 / 12" page number carries — override it in step with
    // `pageNumbers.format` if you renumber, or the two will disagree in print.
    label: typeof o.label === 'function' ? o.label : (n) => String(n),
    dots: o.dots !== false,
    colour: rgb(o.color ?? o.colour) || [0.1, 0.11, 0.13],
    leader: rgb(o.leaderColor ?? o.leaderColour) || [0.72, 0.74, 0.78],
  }
}

/** Cut a title down until it fits, and say so with an ellipsis. */
export function fitText(text, room, measure) {
  if (measure(text) <= room) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (measure(text.slice(0, mid) + '…') <= room) lo = mid
    else hi = mid - 1
  }
  return lo > 0 ? text.slice(0, lo) + '…' : ''
}

/**
 * Lay the index out into pages.
 *
 * @param {object} args
 * @param {Array<{depth:number, title:string, dest:string, label:string}>} args.entries
 *   `dest` is a finished PDF destination array string and `label` the page number
 *   as it is PRINTED on the page it names — this file never computes either, so an
 *   index can never disagree with the page it points at.
 * @param {(text: string, key: string, size: number) => ({str, font, width}|null)} args.pdfText
 * @returns {Array<{ops: string[], annots: Array<{rect: number[], dest: string}>, fonts: Set, xobjects: Set}>}
 *   one entry per index page, in order.
 */
export function tocLayout({ entries, spec, pdfText, drawTitle, marginX, availW, contentTop, availH }) {
  const line = spec.size * 1.75
  const headSize = spec.size * 1.8
  const headRoom = spec.title.trim() ? headSize * 2.4 : 0

  const pages = []
  let page = null
  let y = 0
  let room = 0

  const open = (first) => {
    page = { ops: ['q'], annots: [], fonts: new Set(), xobjects: new Set() }
    pages.push(page)
    y = contentTop
    room = availH
    if (first && headRoom) {
      const head = pdfText(spec.title, `${spec.font}-bold`, headSize)
      if (head) {
        page.fonts.add(head.font)
        page.ops.push(`${spec.colour.map(c => c.toFixed(3)).join(' ')} rg`)
        page.ops.push(`BT 0 Tr /${head.font.name} ${headSize.toFixed(3)} Tf 1 0 0 1 ` +
          `${marginX.toFixed(3)} ${(y - headSize).toFixed(3)} Tm ${head.str} Tj ET`)
      }
      y -= headRoom
      room -= headRoom
    }
  }
  open(true)

  for (const entry of entries) {
    if (room < line) open(false)
    const baseline = y - spec.size
    const key = entry.depth === 0 ? `${spec.font}-bold` : spec.font
    const label = pdfText(entry.label, spec.font, spec.size)
    const labelW = label ? label.width : 0
    const indent = entry.depth * spec.indent
    const left = marginX + indent
    // Room for the title is everything the number and one em of breathing space
    // do not already claim.
    const titleRoom = availW - indent - labelW - spec.size * 2

    // How a title gets onto the page is the CALLER's problem, because the answer
    // depends on the script: base-14 text where WinAnsi can address it, and a crop
    // of the heading's own pixels where it cannot. This file owns the layout and
    // knows nothing about rasters.
    const drawn = titleRoom > 0
      ? drawTitle({ entry, key, size: spec.size, x: left, baseline, room: titleRoom, colour: spec.colour })
      : null
    if (drawn) {
      for (const f of drawn.fonts || []) page.fonts.add(f)
      // A title drawn as a CROP of the page raster needs that raster in the index
      // page's own resources — the fonts are not the only thing a line can borrow.
      for (const x of drawn.xobjects || []) page.xobjects.add(x)
      page.ops.push(...drawn.ops)
    }
    if (label) {
      page.fonts.add(label.font)
      page.ops.push(`BT 0 Tr /${label.font.name} ${spec.size} Tf 1 0 0 1 ` +
        `${(marginX + availW - labelW).toFixed(3)} ${baseline.toFixed(3)} Tm ${label.str} Tj ET`)
    }
    // Leaders as a dashed rule rather than a run of full stops: a row of '.'
    // glyphs is a row of glyphs an extractor returns as text, and an index whose
    // copy-paste is "Introduction......3" is worse than one with no leader.
    if (spec.dots && drawn && drawn.width > 0 && label) {
      const from = left + drawn.width + spec.size * 0.6
      const to = marginX + availW - labelW - spec.size * 0.6
      if (to - from > spec.size) {
        page.ops.push('q', `${spec.leader.map(c => c.toFixed(3)).join(' ')} RG`,
          `0.7 w [0.7 ${(spec.size * 0.28).toFixed(2)}] 0 d 1 J`,
          `${from.toFixed(3)} ${(baseline + spec.size * 0.25).toFixed(3)} m ` +
          `${to.toFixed(3)} ${(baseline + spec.size * 0.25).toFixed(3)} l S`, 'Q')
      }
    }
    // The whole line is the target, not just the words: an index nobody can hit
    // without aiming is an index people scroll past.
    if (entry.dest) {
      page.annots.push({
        rect: [marginX, baseline - spec.size * 0.3, marginX + availW, baseline + spec.size],
        dest: entry.dest,
      })
    }

    y -= line
    room -= line
  }

  for (const p of pages) p.ops.push('Q')
  return pages
}
