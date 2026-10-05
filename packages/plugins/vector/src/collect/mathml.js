/** Native MathML, reconstructed from the mounted clone's measured layout.
 *
 * Browsers do not expose their MATH-table glyph assemblies or rule metrics.
 * Text stays text; rules and radicals become geometry. This is deliberately an
 * approximation, never a raster/foreignObject fallback or a semantic equation.
 */
import { isExcluded } from '../exclusion.js'
import { collectText } from './text.js'

const NS = 'http://www.w3.org/2000/svg'
const TOKENS = new Set(['mi', 'mn', 'mo', 'mtext', 'ms'])
const CONTAINERS = new Set(['math', 'mrow', 'mstyle', 'mpadded', 'mspace',
  'msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover', 'mmultiscripts',
  'mprescripts', 'none', 'mtable', 'mtr', 'mlabeledtr', 'mtd', 'semantics'])
const SKIP = new Set(['annotation', 'annotation-xml', 'mphantom'])
const STRETCH = /^[()\[\]{}|‖⌈⌉⌊⌋⟨⟩∑∏∐∫∬∭∮√]$/u
const esc = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]))
const num = value => String(Math.round(value * 10000) / 10000)
const positive = value => Number.isFinite(value) && value > 0
const MATH_AUTO_DEFAULTS = new WeakMap()

/** Some engines expose default <mi> italicization as CSS; others keep it internal.
 * A shadow root isolates this capability probe from the captured page's CSS.
 * Mount/read/remove is synchronous, so neither a paint nor an await sees it.
 */
function exposesMathAuto (doc) {
  if (MATH_AUTO_DEFAULTS.has(doc)) return MATH_AUTO_DEFAULTS.get(doc)
  const host = doc.createElement('div')
  host.style.cssText = 'all:initial!important;position:fixed!important;left:-10000px!important;top:0!important;visibility:hidden!important;pointer-events:none!important'
  const shadow = host.attachShadow({ mode: 'closed' })
  const math = doc.createElementNS('http://www.w3.org/1998/Math/MathML', 'math')
  const mi = doc.createElementNS(math.namespaceURI, 'mi')
  mi.textContent = 'x'
  math.appendChild(mi)
  shadow.appendChild(math)
  let exposed
  try {
    doc.documentElement.appendChild(host)
    exposed = doc.defaultView.getComputedStyle(mi).textTransform === 'math-auto'
  } finally { host.remove() }
  MATH_AUTO_DEFAULTS.set(doc, exposed)
  return exposed
}

// MathML Core's default single-letter <mi> is Unicode math italic, not a
// synthetically slanted Latin glyph. U+210E fills the deliberate hole for h.
function italicIdentifier (text) {
  if ([...text].length !== 1) return text
  const cp = text.codePointAt(0)
  if (cp >= 65 && cp <= 90) return String.fromCodePoint(0x1d434 + cp - 65)
  if (cp >= 97 && cp <= 122) return cp === 104 ? '\u210e' : String.fromCodePoint(0x1d44e + cp - 97)
  const greek = 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡϴΣΤΥΦΧΨΩ∇αβγδεζηθικλμνξοπρςστυφχψω∂ϵϑϰϕϱϖ'
  const at = [...greek].indexOf(text)
  return at < 0 ? text : String.fromCodePoint(0x1d6e2 + at)
}

/** Axis-aligned ancestor scale is divided out; the normal node transform owns it. */
function scaleAbove (el, styleOf, warn) {
  let sx = 1, sy = 1
  const Matrix = el.ownerDocument.defaultView.DOMMatrix
  for (let node = el; node; node = node.parentElement) {
    const cs = styleOf(node)
    if (cs.transform && cs.transform !== 'none') {
      try {
        const m = new Matrix(cs.transform)
        if (!m.is2D || Math.abs(m.b) > 1e-6 || Math.abs(m.c) > 1e-6 || m.a <= 0 || m.d <= 0) {
          warn('transform', 'Rotated, skewed or mirrored MathML uses bounding-box geometry; glyph placement is approximate.')
        } else { sx *= m.a; sy *= m.d }
      } catch { warn('transform', 'The MathML transform could not be resolved into local geometry.') }
    }
    if (cs.scale && cs.scale !== 'none') {
      const values = cs.scale.trim().split(/\s+/).map(Number)
      if (positive(values[0]) && (values.length === 1 || positive(values[1]))) {
        sx *= values[0]; sy *= values[1] ?? values[0]
      } else warn('transform', 'A non-positive MathML scale uses bounding-box geometry.')
    }
    if (cs.rotate && !['none', '0deg'].includes(cs.rotate)) warn('transform', 'Rotated MathML uses bounding-box geometry.')
    const zoom = parseFloat(cs.zoom)
    if (positive(zoom)) { sx *= zoom; sy *= zoom }
  }
  return { sx, sy }
}

function assetId (ctx) {
  if (typeof ctx.uid === 'function') return ctx.uid('a')
  if (!ctx.assetIds) ctx.assetIds = new Set()
  let id = 'a_mathml', index = 1
  while (ctx.assetIds.has(id) || Object.prototype.hasOwnProperty.call(ctx.assets || {}, id)) id = `a_mathml_${index++}`
  ctx.assetIds.add(id)
  return id
}

/** @returns {Promise<{asset:object, fill:object, warnings:object[], fontStyles:object[]}|null>} */
export async function collectMathML (el, cs, ctx = {}) {
  if (!el || el.localName?.toLowerCase() !== 'math') return null
  const warnings = []
  const seen = new Set()
  const warn = (code, message, grade = 'A') => {
    if (seen.has(`${code}:${message}`)) return
    seen.add(`${code}:${message}`)
    warnings.push({ code: `collect.mathml-${code}`, grade, message })
  }
  const styleOf = node => typeof ctx.styleOf === 'function' ? ctx.styleOf(node) : el.ownerDocument.defaultView.getComputedStyle(node)
  let fullyClipped = false
  for (let node = el; node && !fullyClipped; node = node.parentElement) {
    const style = styleOf(node)
    const clip = /^rect\(([^)]+)\)$/.exec(style.clip || '')
    if (clip && ['absolute', 'fixed'].includes(style.position)) {
      const values = clip[1].trim().split(/[,\s]+/).map(value => value === 'auto' ? NaN : parseFloat(value))
      if (values.length === 4) fullyClipped = values[1] <= values[3] || values[2] <= values[0]
    }
  }
  const { sx, sy } = fullyClipped ? { sx: 1, sy: 1 } : scaleAbove(el, styleOf, warn)
  const origin = el.getBoundingClientRect()
  const w = origin.width / sx, h = origin.height / sy
  const box = node => {
    const r = node.getBoundingClientRect()
    return { x: (r.left - origin.left) / sx, y: (r.top - origin.top) / sy, w: r.width / sx, h: r.height / sy }
  }
  const rangeBox = node => {
    const range = el.ownerDocument.createRange()
    range.selectNodeContents(node)
    const r = range.getBoundingClientRect()
    return { x: (r.left - origin.left) / sx, y: (r.top - origin.top) / sy, w: r.width / sx, h: r.height / sy }
  }
  const canvas = el.ownerDocument.createElement('canvas').getContext('2d')
  const markup = [], fontStyles = [], inkBounds = new WeakMap()
  const exclude = [].concat(ctx.exclude || [])
  const tokenText = node => {
    if (SKIP.has(node.localName) || isExcluded(node, exclude)) return ''
    const style = styleOf(node)
    if (style.display === 'none' || style.contentVisibility === 'hidden' || style.opacity === '0') return ''
    return [...node.childNodes].map(child => child.nodeType === 1 ? tokenText(child)
      : child.nodeType === 3 && !['hidden', 'collapse'].includes(style.visibility) ? child.data : '').join('')
  }

  const token = (node, style, rect, opacity) => {
    let text = tokenText(node).replace(/\s+/g, ' ').trim()
    if (!text) return
    if (node.children.length) warn('approximation', 'Nested styling inside a MathML token uses its visible text and the token font; descendant styling may differ.')
    if (node.localName === 'ms') {
      text = `${node.getAttribute('lquote') ?? '"'}${text}${node.getAttribute('rquote') ?? '"'}`
      warn('approximation', 'MathML string quotes are reconstructed around the measured text box.')
    }
    const variant = node.getAttribute('mathvariant')
    // Where the UA exposes math-auto, computed `none` is an actual opt-out.
    // Legacy engines still apply default <mi> italicization internally.
    const transform = style.textTransform || 'none'
    const automatic = node.localName === 'mi' && !variant && (transform === 'math-auto' ||
      (transform === 'none' && !exposesMathAuto(el.ownerDocument)))
    if (automatic || variant === 'italic') text = italicIdentifier(text)
    else if (variant && variant !== 'normal') warn('unsupported', `MathML mathvariant="${variant}" is retained as text without its mathematical alphabet mapping.`, 'O')
    if (!['none', 'math-auto'].includes(transform)) warn('unsupported', `MathML text-transform:${transform} is retained as source text without the CSS character transformation.`, 'O')
    const size = parseFloat(style.fontSize) || 16
    const family = style.fontFamily || 'serif'
    const fontStyle = style.fontStyle || 'normal'
    const weight = style.fontWeight || '400'
    canvas.font = `${fontStyle} ${weight} ${size}px ${family}`
    const metrics = canvas.measureText(text)
    const rr = rangeBox(node)
    let x = rect.x, baseline = rr.y + (metrics.fontBoundingBoxAscent || size * 0.8)
    let advance = rect.w, yScale = 1
    if (node.localName === 'mo') {
      const inkHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
      const inkBox = Math.abs(rect.h - rr.h) > 1
      const stretched = STRETCH.test(text) && inkBox && positive(inkHeight)
      advance = stretched ? rect.w : Math.min(rect.w, rr.w || rect.w)
      x += (rect.w - advance) / 2
      if (inkBox && positive(inkHeight)) {
        yScale = stretched ? rect.h / inkHeight : 1
        baseline = rect.y + metrics.actualBoundingBoxAscent * yScale
      }
    }
    const inkWidth = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight
    if (!positive(advance) && !positive(inkWidth)) {
      warn('unsupported', 'A visible MathML token has no measurable advance or glyph ink and could not be reconstructed.', 'O')
      return
    }
    inkBounds.set(node, { x, y: baseline - metrics.actualBoundingBoxAscent * yScale,
      w: advance || inkWidth, h: (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) * yScale })
    // Use the existing resolver for font metadata, including @font-face aliases.
    // Geometry/characters come from MathML, not the prose collector's text runs.
    const collected = collectText(node, ctx)
    const resolved = collected && Object.values(collected.styles)[0]
    if (resolved) fontStyles.push({ ...resolved, characters: text, fontStyle, fontSize: size, textTransform: 'none' })
    const svgTransform = yScale === 1 ? '' : ` transform="translate(0 ${num(baseline)}) scale(1 ${num(yScale)})"`
    const length = positive(advance) ? ` textLength="${num(advance)}" lengthAdjust="spacingAndGlyphs"` : ''
    markup.push(`<text x="${num(x)}" y="${yScale === 1 ? num(baseline) : '0'}"${svgTransform} font-family="${esc(family)}" font-size="${num(size)}" font-weight="${esc(weight)}" font-style="${esc(fontStyle)}" fill="${esc(style.color)}" opacity="${num(opacity)}"${length} xml:space="preserve">${esc(text)}</text>`)
  }

  const visit = (node, inheritedOpacity = 1) => {
    const tag = node.localName?.toLowerCase()
    if (!tag || SKIP.has(tag) || isExcluded(node, exclude)) return
    const style = node === el ? cs : styleOf(node)
    if (style.display === 'none' || style.contentVisibility === 'hidden') return
    const opacity = inheritedOpacity * (node === el ? 1 : (Number.parseFloat(style.opacity) || (style.opacity === '0' ? 0 : 1)))
    if (!opacity) return
    const rect = box(node)
    const visible = style.visibility !== 'hidden' && style.visibility !== 'collapse'
    if (!(rect.w > 0 || rect.h > 0)) {
      if (visible && TOKENS.has(tag) && parseFloat(style.fontSize) > 0 && tokenText(node).trim()) {
        warn('unsupported', 'A visible MathML token has no measurable box and could not be reconstructed.', 'O')
      }
      return
    }
    if (node !== el && visible && style.backgroundColor && !['transparent', 'rgba(0, 0, 0, 0)'].includes(style.backgroundColor)) {
      markup.push(`<rect x="${num(rect.x)}" y="${num(rect.y)}" width="${num(rect.w)}" height="${num(rect.h)}" fill="${esc(style.backgroundColor)}" opacity="${num(opacity)}"/>`)
    }
    if (node !== el && visible && ((style.transform && style.transform !== 'none') || (style.filter && style.filter !== 'none') || (style.clipPath && style.clipPath !== 'none') || (style.maskImage && style.maskImage !== 'none') || (style.textShadow && style.textShadow !== 'none'))) {
      warn('approximation', 'Effects or transforms on MathML descendants use measured boxes without their complete CSS paint.')
    }
    if (node !== el && visible && ['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(style[`border${side}Width`]) > 0)) {
      warn('unsupported', 'Borders on MathML descendants are not reconstructed; their text and mathematical layout remain.', 'O')
    }
    if (TOKENS.has(tag)) {
      if (visible) token(node, style, rect, opacity)
      return
    }
    const children = [...node.children].filter(child => !SKIP.has(child.localName))
    if (visible && tag === 'mfrac' && children.length >= 2) {
      const numerator = box(children[0]), denominator = box(children[1])
      const size = parseFloat(style.fontSize) || 16
      const raw = node.getAttribute('linethickness')
      let thickness = size * 0.04
      if (raw !== null) {
        const n = parseFloat(raw)
        if (Number.isFinite(n)) thickness = raw.trim().endsWith('%') ? thickness * n / 100 : /em$/.test(raw) ? size * n : n
        else if (raw === 'thin') thickness *= 0.5
        else if (raw === 'thick') thickness *= 2
        else if (raw !== 'medium') warn('approximation', `MathML fraction thickness "${raw}" uses the default rule width.`)
      }
      if (node.getAttribute('bevelled') === 'true') warn('unsupported', 'Bevelled MathML fraction separators are not reconstructed; their child content remains.', 'O')
      else if (thickness > 0) {
        const y = (numerator.y + numerator.h + denominator.y) / 2
        markup.push(`<line x1="${num(rect.x)}" y1="${num(y)}" x2="${num(rect.x + rect.w)}" y2="${num(y)}" stroke="${esc(style.color)}" stroke-width="${num(thickness)}" opacity="${num(opacity)}"/>`)
      }
    } else if (visible && !CONTAINERS.has(tag) && tag !== 'msqrt' && tag !== 'mroot') {
      warn('unsupported', `MathML <${tag}> decoration or generated content is not reconstructed; measurable child tokens remain.`, 'O')
    }
    if (visible && tag === 'mtable' && ['rowlines', 'columnlines', 'frame'].some(attr => node.hasAttribute(attr) && !/^(none\s*)+$/.test(node.getAttribute(attr)))) {
      warn('unsupported', 'MathML table rules and frames are not reconstructed; cell contents and placement remain.', 'O')
    }
    for (const child of tag === 'semantics' ? children.slice(0, 1) : children) visit(child, opacity)
    if (visible && (tag === 'msqrt' || tag === 'mroot') && children.length) {
      const contents = tag === 'mroot' ? children.slice(0, 1) : children
      const boxes = contents.map(box)
      const ink = contents.flatMap(child => [child, ...child.querySelectorAll('*')]).map(child => inkBounds.get(child)).filter(Boolean)
      const left = Math.min(...boxes.map(r => r.x)), right = Math.max(...boxes.map(r => r.x + r.w))
      const top = Math.min(...(ink.length ? ink : boxes).map(r => r.y))
      const bottom = Math.max(...(ink.length ? ink : boxes).map(r => r.y + r.h))
      const size = parseFloat(style.fontSize) || 16, stroke = Math.max(0.5, size * 0.04)
      const gap = Math.min(size * 0.7, Math.max(stroke * 3, left - rect.x))
      const start = left - gap, y = Math.max(rect.y, top - size * 0.12) + stroke / 2
      const height = Math.max(stroke * 3, bottom - y)
      const d = `M${num(start)} ${num(y + height * 0.58)} L${num(start + gap * 0.2)} ${num(y + height * 0.49)} L${num(start + gap * 0.43)} ${num(bottom)} L${num(left)} ${num(y)} H${num(right)}`
      markup.push(`<path d="${d}" fill="none" stroke="${esc(style.color)}" stroke-width="${num(stroke)}" stroke-linejoin="miter" opacity="${num(opacity)}"/>`)
    }
  }
  if (!fullyClipped) visit(el)
  if (markup.length) warn('approximation', 'Native MathML is reconstructed as measured SVG text, fraction rules and radical paths. Font-dependent glyph assemblies, rule metrics and local system math fonts may differ from the browser.')
  const id = assetId(ctx)
  const grade = warnings.some(warning => warning.grade === 'O') ? 'O' : warnings.length ? 'A' : 'E'
  return {
    asset: { id, kind: 'vector', mime: 'image/svg+xml', w, h, viewBox: [0, 0, w, h], src: '', data: null,
      markup: `<svg xmlns="${NS}" width="${num(w)}" height="${num(h)}" viewBox="0 0 ${num(w)} ${num(h)}" overflow="visible">${markup.join('')}</svg>` },
    fill: { type: 'image', asset: id, fit: 'stretch', crop: { x: 0, y: 0, w, h }, transform: [w, 0, 0, h, 0, 0], clipBox: 'border', opacity: 1, grade, notes: ['native-mathml-measured'] },
    warnings,
    fontStyles,
  }
}

export default collectMathML
