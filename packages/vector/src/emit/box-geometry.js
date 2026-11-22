/**
 * Box geometry every backend needs and none should work out twice: where the
 * browser really paints a box, and how it draws a border side that is not a solid
 * band. `emit/svg-flat.js` here and the PDF plugin's vector page turn these numbers
 * into their own markup; the numbers themselves are Chromium's, measured, and live
 * here once. The PDF plugin imports this file as `@zumer/snapdom-vector/box-geometry`,
 * so its three exports are an interface: renaming one breaks that package.
 *
 * Pure: no DOM, no backend.
 */

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * How Chromium spaces the dashes of ONE straight border side, so a dashed or
 * dotted side is emitted as dashes rather than as a solid band.
 *
 * The numbers are Blink's (`StyledStrokeData`): a dash is 2 widths long with a
 * 1-width gap from 3px up and 3 / 2 below that; a dot is as long as the border is
 * wide with a gap of the same size, round from 3px up (zero-length dashes with a
 * round cap) and square below. The gap is then stretched or squeezed so that a
 * whole number of dashes fits and the side both starts and ends on ink — which is
 * why a fixed period drifts out of phase with the page by the end of a long rule.
 *
 * @param {'dashed'|'dotted'} style
 * @param {number} width   the side's border width
 * @param {number} length  the length of the side
 * @returns {{dash: number, gap: number, round: boolean}|null} null when the side is
 *   too short to hold a pattern, and solid is the honest rendering
 */
export function sideDashes(style, width, length) {
  if (!(width > 0) || !(length > 0)) return null
  const dotted = style === 'dotted'
  const round = dotted && width > 3
  const dash = dotted ? width : width * (width >= 3 ? 2 : 3)
  const nominalGap = dotted ? width : width * (width >= 3 ? 1 : 2)
  // An open path: n dashes need n - 1 gaps, so one extra gap's worth of room fits.
  const fewest = Math.floor((length + nominalGap) / (dash + nominalGap))
  if (fewest < 2) return null
  // Square dots keep their nominal gap: Blink only refits dashes and round dots.
  if (dotted && !round) return { dash, gap: nominalGap, round }
  const gapFor = (dashes) => (length - dashes * dash) / (dashes - 1)
  const loose = gapFor(fewest)
  const tight = gapFor(fewest + 1)
  const gap = tight <= 0 || Math.abs(loose - nominalGap) < Math.abs(tight - nominalGap) ? loose : tight
  return gap > 0 ? { dash, gap, round } : null
}

/**
 * The width of each of the two lines of a `double` border side, or null when the
 * side is too thin to be anything but solid. Blink's rule, `(width + 1) / 3` in
 * whole pixels: 2/1/2 for 5px, 1/2/1 for 4px, 1/1/1 for 3px (measured on 4 and 5).
 *
 * @param {number} width
 * @returns {number|null}
 */
export function doubleBand(width) {
  const third = Math.floor((width + 1) / 3)
  return third > 0 && third * 2 < width ? third : null
}

/**
 * The node's own box, moved onto whole pixels the way the browser moves it.
 *
 * Layout is fractional — a row that follows three 19.6px lines starts at y = 58.8
 * — but Chromium does not paint a box where layout put it: backgrounds and borders
 * go to the pixel-snapped rect, `round(x)` to `round(x + w)` on each axis, rounding
 * half up. Emitted at the fractional position instead, every thin edge was smeared
 * over two pixel rows: MEASURED on `<hr style="border-top:4px double">` at
 * y = 167.375, the page paints two crisp 1px lines (rows 167 and 170, full colour)
 * and the SVG painted four half-strength ones.
 *
 * Only the BOX moves, by at most half a pixel, inside a group whose own origin
 * stays exactly where layout put it — so the children, and above all the text
 * baselines, which the browser positions by a different rule, are not touched.
 *
 * Not under a transform: there the browser's own snapping is off (the layer is
 * rasterised in its own space and resampled), and an `abs` that came through a
 * matrix is a bounding box, not a rect to snap. Not for text and inline SVG, whose
 * boxes are bookkeeping for glyphs and viewBoxes, not paint.
 *
 * @param {object} node
 * @param {{w: number, h: number}} frame  the node's own frame
 * @param {boolean} upright  false when any transform above this node rotates, scales or skews
 * @returns {{x: number, y: number, w: number, h: number}} in node-local px
 */
export function paintedBox(node, frame, upright) {
  const plain = { x: 0, y: 0, w: frame.w, h: frame.h }
  if (node.type === 'text' || node.type === 'vector') return plain
  // Table parts are left where layout put them. The table lays its grid out by rules
  // of its own (collapsed borders sit ON the grid lines and belong to the table),
  // and the plain rule put cell edges a row off: MEASURED, three fixtures with a
  // table went from 0.3-0.8% to 0.6-2.3% wrong with it, and back without.
  const display = isObject(node.source) && isObject(node.source.css) ? node.source.css.display : ''
  if (typeof display === 'string' && display.startsWith('table')) return plain
  if (!upright || (node.transform !== null && node.transform !== undefined)) return plain
  const abs = isObject(node.abs) ? node.abs : null
  if (!abs || ![abs.x, abs.y, abs.w, abs.h].every(isNum)) return plain
  // `abs` and `frame` describe the same box; if they disagree on its size the node
  // is not the plain box this assumes, and it is left alone.
  if (Math.abs(abs.w - frame.w) > 1e-6 || Math.abs(abs.h - frame.h) > 1e-6) return plain
  const left = Math.round(abs.x)
  const top = Math.round(abs.y)
  const w = Math.round(abs.x + abs.w) - left
  const h = Math.round(abs.y + abs.h) - top
  // A box that rounds away entirely is kept as layout had it: a hairline is
  // better smeared than gone.
  if ((abs.w > 0 && w <= 0) || (abs.h > 0 && h <= 0)) return plain
  return { x: left - abs.x, y: top - abs.y, w, h }
}

