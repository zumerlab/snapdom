/**
 * `border-radius` -> four `[rx, ry]` pairs, in the CSS corner order
 * tl, tr, br, bl.
 *
 * Two things are easy to get wrong and both are visible on screen:
 *
 *  - a percentage is resolved against a DIFFERENT base per axis — `rx` against
 *    the box width, `ry` against its height. `50%` on a 200x40 box is an
 *    100x20 ellipse quadrant, not a 100x100 one.
 *  - adjacent radii that together exceed the side they share are ALL scaled
 *    down by one shared factor `f` (CSS Backgrounds §5.5). The browser does
 *    this before painting, so the declared values never reach the screen; a
 *    document that carried them would round the wrong corners. The step is
 *    irreversible and it is applied here, once, for everyone downstream.
 *
 * Pure: `cs` is only ever read by property name, so a plain object works and the
 * module needs no DOM.
 */

const ABS_UNITS = {
  px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 25.4 / 4,
}

const NUMBER = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/i

/**
 * A radius is `<length-percentage>` and cannot be negative; anything else
 * (`em` without a font, garbage, `auto`) resolves to 0, which is the initial
 * value and therefore the safe floor — a square corner, never a rounder one.
 */
function resolve(token, base) {
  const m = NUMBER.exec(token)
  if (!m) return 0
  const n = parseFloat(m[1])
  if (!Number.isFinite(n) || n <= 0) return 0
  const unit = m[2].toLowerCase()
  if (unit === '%') return (n / 100) * base
  if (!unit) return 0
  const k = ABS_UNITS[unit]
  return k === undefined ? 0 : n * k
}

function read(cs, camel, dashed) {
  if (!cs) return ''
  const v = cs[camel]
  if (v != null && v !== '') return String(v)
  if (typeof cs.getPropertyValue === 'function') return String(cs.getPropertyValue(dashed) || '')
  return ''
}

/** 1-4 values expand to tl, tr, br, bl the same way in every CSS box shorthand. */
function expand(parts) {
  const [a, b = a, c = a, d = b] = parts
  return [a, b, c, d]
}

/**
 * The shorthand, for callers that hand us a style object carrying only
 * `border-radius`. A computed style always has the longhands, so this is the
 * fallback path — but returning four zeros for a perfectly readable `12px` is
 * the kind of silent wrong answer this codebase does not ship.
 */
function fromShorthand(cs, w, h) {
  const value = read(cs, 'borderRadius', 'border-radius').trim()
  if (!value) return null
  const [hor, ver] = value.split('/')
  const hParts = hor.trim().split(/\s+/).filter(Boolean)
  if (!hParts.length) return null
  const vParts = ver ? ver.trim().split(/\s+/).filter(Boolean) : []
  const xs = expand(hParts)
  const ys = expand(vParts.length ? vParts : hParts)
  return xs.map((x, i) => [resolve(x, w), resolve(ys[i], h)])
}

const CORNERS = [
  ['borderTopLeftRadius', 'border-top-left-radius'],
  ['borderTopRightRadius', 'border-top-right-radius'],
  ['borderBottomRightRadius', 'border-bottom-right-radius'],
  ['borderBottomLeftRadius', 'border-bottom-left-radius'],
]

/**
 * @param {CSSStyleDeclaration|Record<string,string>} cs  computed style of the element
 * @param {number} w  width of the box the radii are resolved against (border box for
 *                    the border/background edge; the caller insets it for inner boxes)
 * @param {number} h  height of that same box
 * @returns {[[number,number],[number,number],[number,number],[number,number]]}
 *   tl, tr, br, bl as `[rx, ry]`, with the §5.5 overlap factor already applied.
 */
export function parseRadii(cs, w, h) {
  const width = Number.isFinite(w) && w > 0 ? w : 0
  const height = Number.isFinite(h) && h > 0 ? h : 0

  let radii = null
  for (let i = 0; i < CORNERS.length; i++) {
    const value = read(cs, CORNERS[i][0], CORNERS[i][1]).trim()
    if (!value) continue
    if (!radii) radii = [[0, 0], [0, 0], [0, 0], [0, 0]]
    // One value is a circle: `12px` means rx and ry alike, each still resolved
    // against its own axis, so `50%` stays an ellipse.
    const parts = value.split(/\s+/).filter(Boolean)
    radii[i] = [resolve(parts[0], width), resolve(parts[1] !== undefined ? parts[1] : parts[0], height)]
  }
  if (!radii) radii = fromShorthand(cs, width, height)
  if (!radii) return [[0, 0], [0, 0], [0, 0], [0, 0]]

  const [tl, tr, br, bl] = radii

  // §5.5: f is the minimum over the four sides of side / (sum of its two radii).
  // A side with no radii contributes nothing (0/0 is not a constraint), and the
  // factor is only ever applied when it is < 1 — radii that fit are left exact.
  let f = 1
  const limit = (side, a, b) => {
    const sum = a + b
    if (sum > 0 && side >= 0) f = Math.min(f, side / sum)
  }
  limit(width, tl[0], tr[0])   // top
  limit(height, tr[1], br[1])  // right
  limit(width, bl[0], br[0])   // bottom
  limit(height, tl[1], bl[1])  // left

  if (!(f < 1)) return radii
  return radii.map(([rx, ry]) => [rx * f, ry * f])
}
