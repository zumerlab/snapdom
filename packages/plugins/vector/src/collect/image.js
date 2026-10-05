/**
 * Replaced content: `<img>`, `<canvas>`, `<video>` and inline `<svg>`.
 *
 * Two jobs that look like one. The first is getting the *bytes* into the
 * document — invariant 8 says nothing may be external, and the only routes a
 * page gives us are `fetch` (keeps the original file, so no re-encode) and a
 * canvas readback (re-encodes, and dies on a tainted canvas). The second is
 * geometry: `object-fit` + `object-position` decide which part of the source is
 * on screen and where, and that is emitted as a **crop in source pixels plus a
 * 2×3 matrix**, never as a fit keyword — a keyword pushes the same five-case
 * calculation onto every backend, and they will not all get it right.
 *
 * An SVG source is never rasterized: it is fetched (or serialized, when it is
 * inline), its ids are namespaced per instance, and it travels as a `vector`
 * asset. The namespacing is not cosmetic — two Illustrator icons both carrying
 * `id="a"` and `.st0` overwrite each other's gradients with no error anywhere.
 */

/** @typedef {{id:string, kind:'bitmap'|'vector', mime:string, w:number, h:number, src:string, data:string|null}} Asset */
/** @typedef {{assets?: Record<string, object>, uid?: (prefix: string) => string, fetchTimeout?: number, maxAssetBytes?: number}} CollectCtx */

const IMAGE_TAGS = new Set(['IMG', 'CANVAS', 'VIDEO', 'SVG'])

const SVG_NS = 'http://www.w3.org/2000/svg'

/** css-images-3 §5.1: the size a replaced element falls back to with no intrinsic one. */
const DEFAULT_OBJECT_SIZE = { w: 300, h: 150 }

/** Past this an asset is worth reporting; it is still embedded, because dropping it is worse. */
const BIG_ASSET_BYTES = 8 * 1024 * 1024

/** Baking computed style onto a huge inline SVG costs more than it buys. */
const MAX_BAKE_NODES = 2000

/** Raster `<image>` children pulled into an inlined SVG, per instance. */
const MAX_NESTED_IMAGES = 8

/** `<use href="#x">` chains can point at nodes that point at more nodes. */
const MAX_DEF_IMPORT_PASSES = 6

/**
 * Inherited SVG presentation properties, with their initial computed values.
 *
 * An inline SVG loses the page's stylesheet the moment it is serialized, and
 * `currentColor` on an icon is the commonest way a page colours one — so these
 * are baked back on, but only where an element differs from its parent, or every
 * icon triples in size. The ROOT has no parent once serialized, so there it is
 * compared against the initial value instead: `.icon svg { fill: red }` sets the
 * same value on the root and on the `<span>` around it, and comparing those two
 * would drop the red entirely.
 *
 * `null` marks a property whose initial value is the browser's own default and
 * so cannot be written down here; those are baked on the root only when the SVG
 * actually has text to apply them to.
 */
const INHERITED_SVG_PROPS = [
  ['fill', 'rgb(0, 0, 0)'],
  ['fill-opacity', '1'],
  ['fill-rule', 'nonzero'],
  ['stroke', 'none'],
  ['stroke-width', '1px'],
  ['stroke-opacity', '1'],
  ['stroke-linecap', 'butt'],
  ['stroke-linejoin', 'miter'],
  ['stroke-dasharray', 'none'],
  ['stroke-dashoffset', '0px'],
  ['stroke-miterlimit', '4'],
  ['color', 'rgb(0, 0, 0)'],
  ['visibility', 'visible'],
  ['clip-rule', 'nonzero'],
  ['paint-order', 'normal'],
  ['marker-start', 'none'],
  ['marker-mid', 'none'],
  ['marker-end', 'none'],
  ['text-anchor', 'start'],
  ['dominant-baseline', 'auto'],
  ['letter-spacing', 'normal'],
  ['font-family', null],
  ['font-size', null],
  ['font-weight', null],
  ['font-style', null],
]

/** Non-inherited: baked whenever they differ from the initial value, since the clone inherits nothing. */
const OWN_SVG_PROPS = [
  ['opacity', '1'],
  ['clip-path', 'none'],
  ['mask', 'none'],
  ['filter', 'none'],
  ['mix-blend-mode', 'normal'],
  ['stop-color', 'rgb(0, 0, 0)'],
  ['stop-opacity', '1'],
]

// ——— geometry ———

/**
 * The content box, plus the offset from the border box's origin to it, both in
 * layout px. `client*` is used rather than `getBoundingClientRect` because it is
 * transform-free: the node's own transform is emitted separately and must not be
 * baked into the image paint twice.
 */
function contentBox (el, cs) {
  const num = (v) => parseFloat(v) || 0
  const padL = num(cs.paddingLeft), padR = num(cs.paddingRight)
  const padT = num(cs.paddingTop), padB = num(cs.paddingBottom)
  const insetX = num(cs.borderLeftWidth) + padL
  const insetY = num(cs.borderTopWidth) + padT
  const cw = el.clientWidth
  const ch = el.clientHeight
  if (cw > 0 || ch > 0) {
    return { w: Math.max(0, cw - padL - padR), h: Math.max(0, ch - padT - padB), insetX, insetY }
  }
  // Inline replaced boxes and SVG roots can report clientWidth 0; the border box
  // minus the same insets is the next best thing.
  const r = el.getBoundingClientRect()
  return {
    w: Math.max(0, r.width - insetX - num(cs.borderRightWidth) - padR),
    h: Math.max(0, r.height - insetY - num(cs.borderBottomWidth) - padB),
    insetX,
    insetY,
  }
}

/** Splits on whitespace outside parens, so `calc(10% + 4px)` survives as one token. */
function tokenize (css) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of String(css).trim()) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (depth === 0 && /\s/.test(ch)) {
      if (cur) { out.push(cur); cur = '' }
    } else {
      cur += ch
    }
  }
  if (cur) out.push(cur)
  return out
}

/**
 * A CSS `<length-percentage>` as `{px, pct}`, `calc()` included — the computed
 * value of `object-position` keeps `calc()` verbatim, and `new Function` is not
 * an option here (it detonates under a page CSP). Only the linear `+`/`-` forms
 * are handled; anything else returns null and the caller says so.
 */
function parseLengthPct (value) {
  let s = String(value).trim()
  const calc = /^(?:-webkit-)?calc\((.*)\)$/is.exec(s)
  if (calc) s = calc[1].trim()
  const terms = []
  let depth = 0
  let start = 0
  let sign = 1
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    // CSS requires whitespace around a top-level +/- inside calc(), which is
    // what separates an operator from the sign of a literal.
    else if (depth === 0 && (ch === '+' || ch === '-') && i > start && /\s/.test(s[i - 1])) {
      terms.push({ sign, text: s.slice(start, i) })
      sign = ch === '-' ? -1 : 1
      start = i + 1
    }
  }
  terms.push({ sign, text: s.slice(start) })

  const out = { px: 0, pct: 0 }
  for (const term of terms) {
    const text = term.text.trim()
    if (!text) return null
    const n = parseFloat(text)
    if (!Number.isFinite(n)) return null
    if (text.endsWith('%')) out.pct += term.sign * n
    else if (/px$/i.test(text)) out.px += term.sign * n
    else if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) out.px += term.sign * n
    else return null
  }
  return out
}

const resolveLengthPct = (lp, free) => lp.px + (lp.pct / 100) * free

const X_KEYWORDS = { left: 0, center: 50, right: 100 }
const Y_KEYWORDS = { top: 0, center: 50, bottom: 100 }

/**
 * `object-position` → the two offsets of the object box inside the content box,
 * as functions of the free space. Handles the 1/2/3/4-token grammar including
 * the edge-relative form (`right 10px bottom 20px`), which Chromium does keep in
 * the computed value.
 *
 * @returns {{x: (free:number)=>number, y: (free:number)=>number}|null}
 */
function parseObjectPosition (css) {
  const tokens = tokenize(css || '50% 50%')
  if (!tokens.length || tokens.length > 4) return null

  const lower = tokens.map((t) => t.toLowerCase())
  const isX = (t) => Object.prototype.hasOwnProperty.call(X_KEYWORDS, t)
  const isY = (t) => Object.prototype.hasOwnProperty.call(Y_KEYWORDS, t)
  const isKeyword = (t) => isX(t) || isY(t)

  let x = null
  let y = null

  const put = (edge, offset) => {
    if (isY(edge) && edge !== 'center') y = { edge, offset }
    else if (isX(edge) && edge !== 'center') x = { edge, offset }
    else if (!x) x = { edge: 'start', offset }
    else y = { edge: 'start', offset }
  }

  // One or two tokens is always the plain form — the edge-relative grammar needs
  // both components present, so `right 10px` alone parses as x=right, y=10px.
  if (tokens.length <= 2) {
    // `50% 50%`, `left top`, `top left`, `10px`.
    const values = []
    for (const t of lower) {
      if (isKeyword(t)) values.push({ keyword: t })
      else {
        const lp = parseLengthPct(t)
        if (!lp) return null
        values.push({ lp })
      }
    }
    if (values.length === 1) values.push({ keyword: 'center' })
    let [a, b] = values
    // `top left` is legal and means the same as `left top`.
    if ((a.keyword && isY(a.keyword) && a.keyword !== 'center') ||
        (b.keyword && isX(b.keyword) && b.keyword !== 'center')) {
      [a, b] = [b, a]
    }
    const axis = (v, keywords) => (v.keyword
      ? { edge: 'start', offset: { px: 0, pct: keywords[v.keyword] } }
      : { edge: 'start', offset: v.lp })
    if (a.keyword && !isX(a.keyword)) return null
    if (b.keyword && !isY(b.keyword)) return null
    x = axis(a, X_KEYWORDS)
    y = axis(b, Y_KEYWORDS)
  } else {
    // Edge-relative form: keyword, optional offset, keyword, optional offset.
    for (let i = 0; i < lower.length;) {
      const edge = lower[i]
      if (!isKeyword(edge)) return null
      let offset = { px: 0, pct: edge === 'center' ? 50 : 0 }
      if (i + 1 < lower.length && !isKeyword(lower[i + 1])) {
        const lp = parseLengthPct(lower[i + 1])
        if (!lp) return null
        offset = lp
        i += 2
      } else {
        i += 1
      }
      put(edge, offset)
    }
    if (!x) x = { edge: 'start', offset: { px: 0, pct: 50 } }
    if (!y) y = { edge: 'start', offset: { px: 0, pct: 50 } }
  }

  // `right 10px` puts the object's right edge 10px from the box's right edge.
  const fn = (side, far) => (free) => (side.edge === far
    ? free - resolveLengthPct(side.offset, free)
    : resolveLengthPct(side.offset, free))
  return { x: fn(x, 'right'), y: fn(y, 'bottom') }
}

/** css-images-3 §5.5: the concrete object size for each of the five `object-fit` values. */
function concreteSize (fit, nw, nh, bw, bh) {
  if (!(nw > 0) || !(nh > 0)) return { w: bw, h: bh }
  switch (fit) {
    case 'none':
      return { w: nw, h: nh }
    case 'contain': {
      const s = Math.min(bw / nw, bh / nh)
      return { w: nw * s, h: nh * s }
    }
    case 'cover': {
      const s = Math.max(bw / nw, bh / nh)
      return { w: nw * s, h: nh * s }
    }
    case 'scale-down': {
      // "the smaller of `none` and `contain`" — which, since both preserve the
      // ratio, is `contain` exactly when contain's scale is below 1.
      const s = Math.min(1, Math.min(bw / nw, bh / nh))
      return { w: nw * s, h: nh * s }
    }
    case 'fill':
    default:
      return { w: bw, h: bh }
  }
}

/**
 * `object-fit` + `object-position` → the source rectangle that is actually on
 * screen and the matrix that puts it there.
 *
 * @returns {{crop:{x,y,w,h}, transform:number[], visible:boolean, overflowed:boolean}}
 *   `crop` is in SOURCE pixels (the asset's own `w`/`h`); `transform` maps the
 *   unit square of that crop onto the node's BORDER box, in px.
 */
function placeObject (fit, position, natural, box) {
  const nw = natural.w > 0 ? natural.w : box.w
  const nh = natural.h > 0 ? natural.h : box.h
  const size = concreteSize(fit, natural.w, natural.h, box.w, box.h)
  const ox = position.x(box.w - size.w)
  const oy = position.y(box.h - size.h)

  // The replaced content is clipped to the content box (an `overflow` other than
  // the default is handled by the caller's clip, not here).
  const vx0 = Math.max(0, ox)
  const vy0 = Math.max(0, oy)
  const vx1 = Math.min(box.w, ox + size.w)
  const vy1 = Math.min(box.h, oy + size.h)
  const overflowed = ox < -0.01 || oy < -0.01 ||
    ox + size.w > box.w + 0.01 || oy + size.h > box.h + 0.01

  if (!(vx1 > vx0) || !(vy1 > vy0)) {
    return {
      crop: { x: 0, y: 0, w: 0, h: 0 },
      transform: [0, 0, 0, 0, box.insetX, box.insetY],
      visible: false,
      overflowed,
    }
  }

  const sx = size.w / nw
  const sy = size.h / nh
  return {
    crop: {
      x: (vx0 - ox) / sx,
      y: (vy0 - oy) / sy,
      w: (vx1 - vx0) / sx,
      h: (vy1 - vy0) / sy,
    },
    transform: [vx1 - vx0, 0, 0, vy1 - vy0, box.insetX + vx0, box.insetY + vy0],
    visible: true,
    overflowed,
  }
}

// ——— bytes ———

function bytesToBase64 (bytes) {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function parseDataUri (url) {
  const comma = url.indexOf(',')
  if (comma === -1) return null
  const head = url.slice(5, comma)
  const isB64 = /;base64$/i.test(head)
  const mime = ((isB64 ? head.slice(0, -7) : head).split(';')[0] || '').trim() || 'text/plain'
  const body = url.slice(comma + 1)
  try {
    if (isB64) {
      const bin = atob(body)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return { bytes, mime }
    }
    return { bytes: new TextEncoder().encode(decodeURIComponent(body)), mime }
  } catch {
    return null
  }
}

const MAGIC = [
  { mime: 'image/png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  { mime: 'image/webp', test: (b) => b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45 },
  { mime: 'image/avif', test: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 },
]

/** A `Content-Type` is not guaranteed, and the mime rides in the data URI. */
function sniffMime (bytes) {
  if (bytes.length >= 12) {
    for (const { mime, test } of MAGIC) if (test(bytes)) return mime
  }
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 256)).trimStart()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml'
  return 'application/octet-stream'
}

async function fetchBytes (url, timeout) {
  if (url.startsWith('data:')) return parseDataUri(url)
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller && timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null
  try {
    // force-cache: the element already downloaded this, so the HTTP cache should
    // answer without a second network trip.
    const res = await fetch(url, { signal: controller ? controller.signal : undefined, cache: 'force-cache' })
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    const declared = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    return { bytes, mime: declared && declared !== 'application/octet-stream' ? declared : sniffMime(bytes) }
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * EXIF orientation of a JPEG, 1 when absent or unreadable.
 *
 * It matters because `naturalWidth/Height` are already the *oriented* dimensions
 * — so shipping the original bytes to a consumer that ignores EXIF yields an
 * image rotated against the geometry we just measured.
 */
function jpegOrientation (bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let off = 2
  while (off + 4 <= bytes.length) {
    if (view.getUint8(off) !== 0xff) break
    const marker = view.getUint8(off + 1)
    if (marker === 0xda || marker === 0xd9) break // start of scan / end of image
    const size = view.getUint16(off + 2)
    if (size < 2) break
    if (marker === 0xe1 && off + 10 <= bytes.length && view.getUint32(off + 4) === 0x45786966) {
      const tiff = off + 10
      if (tiff + 8 > bytes.length) return 1
      const le = view.getUint16(tiff) === 0x4949
      if (view.getUint16(tiff + 2, le) !== 42) return 1
      const ifd = tiff + view.getUint32(tiff + 4, le)
      if (ifd + 2 > bytes.length) return 1
      const count = view.getUint16(ifd, le)
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12
        if (entry + 12 > bytes.length) break
        if (view.getUint16(entry, le) === 0x0112) return view.getUint16(entry + 8, le) || 1
      }
      return 1
    }
    off += 2 + size
  }
  return 1
}

/**
 * Draws a source into a fresh canvas and reads it back.
 * Throws `SecurityError` when the source taints the canvas — that is the only
 * way to find out, and the caller turns it into a diagnostic.
 */
function readback (source, w, h, mime = 'image/png', quality) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w))
  canvas.height = Math.max(1, Math.round(h))
  const g = canvas.getContext('2d')
  g.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL(mime, quality)
}

// ——— svg ———

/**
 * Rewrites `url(#x)` / `href="#x"` references through a rename map.
 * Chromium serializes computed `fill: url(#g)` with the document URL in front of
 * the fragment, so the base is compared rather than assumed empty.
 */
function makeReferenceRewriter (map, missing) {
  const base = typeof location !== 'undefined' ? location.href.split('#')[0] : ''
  return (text) => text.replace(/url\((['"]?)([^'")]*)\1\)/gi, (whole, quote, target) => {
    const hash = target.indexOf('#')
    if (hash === -1) return whole
    const head = target.slice(0, hash)
    if (head && head !== base) return whole
    const id = target.slice(hash + 1)
    const next = map.get(id)
    if (!next) { missing.add(id); return whole }
    return `url(#${next})`
  })
}

const CSS_IDENT = /[A-Za-z0-9_\-\u00a0-\uffff]/

/** Rewrites `#id` / `.class` occurrences in a `<style>` body through a rename map. */
function rewriteSelectors (text, map, sigil) {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== sigil) { out += text[i]; continue }
    let j = i + 1
    while (j < text.length && CSS_IDENT.test(text[j])) j++
    const name = text.slice(i + 1, j)
    const next = map.get(name)
    out += next ? sigil + next : text.slice(i, j)
    i = j - 1
  }
  return out
}

/** Every `#id` a subtree points at, from attributes and from `<style>` bodies. */
function collectReferencedIds (nodes) {
  const wanted = new Set()
  for (const node of nodes) {
    if (!node.attributes) continue
    const texts = Array.from(node.attributes).map((a) => a.value)
    if (node.localName === 'style' && node.textContent) texts.push(node.textContent)
    for (const text of texts) {
      for (const m of text.matchAll(/url\((['"]?)([^'")]*)\1\)/gi)) {
        const hash = m[2].indexOf('#')
        if (hash !== -1 && m[2].length > hash + 1) wanted.add(m[2].slice(hash + 1))
      }
    }
    const href = node.getAttribute && (node.getAttribute('href') || node.getAttribute('xlink:href'))
    if (href && href.length > 1 && href.startsWith('#')) wanted.add(href.slice(1))
  }
  return wanted
}

/**
 * Which element an `#id` reference resolves to, indexed in tree order:
 * **the first occurrence wins**, which is what `getElementById` does and what
 * the renderer therefore did on the page. Two icons that both declare
 * `#cx-grad` do NOT get one gradient each — they both get the first one, and an
 * export that hands them one each has changed the picture, not preserved it.
 *
 * snapdom's own `svg.inline-defs-container` is indexed LAST. It holds
 * definitions hoisted from outside the captured subtree, so it is a fallback for
 * ids the page could not resolve locally, never a competitor for ids it could.
 *
 * @param {Element} root
 * @returns {Map<string, Element>}
 */
function buildIdIndex (root) {
  const index = new Map()
  const deferred = []
  const visit = (node) => {
    const id = node.getAttribute && node.getAttribute('id')
    if (id && !index.has(id)) index.set(id, node)
    for (const child of node.children || []) {
      if (child.localName === 'svg' && child.classList &&
          child.classList.contains('inline-defs-container')) deferred.push(child)
      else visit(child)
    }
  }
  visit(root)
  for (const node of deferred) visit(node)
  return index
}

/** `cloneNode(true)` walks in the same order twice, so index i is index i. */
function pairSubtrees (live, copy, into) {
  const a = [live, ...live.querySelectorAll('*')]
  const b = [copy, ...copy.querySelectorAll('*')]
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) into.set(a[i], b[i])
  return true
}

/**
 * Prefixes every `id` and every class in an SVG subtree and repoints every
 * reference at **the element the document actually resolved it to**, importing
 * that element when it lives outside the subtree.
 *
 * Two failure modes, one mechanism. Without prefixing, two Illustrator icons
 * both shipping `id="a"` overwrite each other's gradients once they share a
 * document, with no error anywhere. With prefixing but no resolution, the
 * opposite lie: a second icon that redeclares an id the first one already owns
 * gets its OWN definition, when on the page it was rendering with the first
 * one's — the export then shows two colours where the browser showed one. Both
 * are silent, and the second is worse, because it looks deliberate.
 *
 * @param {SVGElement} clone   the copy being serialized, mutated in place
 * @param {string} prefix
 * @param {string[]} warnings
 * @param {{live?: Element|null, index?: Map<string, Element>|null}} [resolution]
 *   `live` is the mounted element `clone` was copied from and `index` the id
 *   index of the tree it was resolved in. Omit both for a fetched file, which is
 *   self-contained and resolves against itself.
 */
function namespaceSvg (clone, prefix, warnings, resolution = {}) {
  const doc = clone.ownerDocument
  const live = resolution.live || null
  const index = resolution.index || null

  // live element -> the node in `clone` that stands for it.
  const liveToClone = new Map()
  const paired = live && index ? pairSubtrees(live, clone, liveToClone) : false
  if (live && index && !paired) {
    warnings.push('image: the inline SVG changed shape while being cloned; its references were ' +
      'resolved inside the element instead of against the document, so a definition it shares ' +
      'with another SVG may be the wrong one.')
  }

  const taken = new Set()
  /** clone node -> its final, namespaced id. */
  const finalId = new Map()
  const assignId = (node, hint) => {
    const base = prefix + String(hint).replace(/[^A-Za-z0-9_-]/g, '_')
    let id = base
    let n = 1
    while (taken.has(id)) id = `${base}_${n++}`
    taken.add(id)
    finalId.set(node, id)
    node.setAttribute('id', id)
    return id
  }

  // Read every original id before renaming any of them: within one instance the
  // ids can collide with each other too, and the first is the one that wins.
  const nodes = [clone, ...clone.querySelectorAll('*')]
  const localFirst = new Map()
  let hasStyleElement = false
  const originals = []
  for (const node of nodes) {
    const id = node.getAttribute && node.getAttribute('id')
    if (id) {
      originals.push([node, id])
      if (!localFirst.has(id)) localFirst.set(id, node)
    }
    if (node.localName === 'style') hasStyleElement = true
  }
  for (const [node, id] of originals) assignId(node, id)

  /** original id -> final id, the whole point of the pass. */
  const refMap = new Map()
  const missing = new Set()
  const stolen = []
  let imported = 0

  const importDefinition = (id, winner) => {
    let defs = clone.querySelector(':scope > defs')
    if (!defs) {
      defs = doc.createElementNS(SVG_NS, 'defs')
      clone.insertBefore(defs, clone.firstChild)
    }
    const copy = winner.cloneNode(true)
    // The imported node comes from elsewhere in the page: its stylesheet rules do
    // not travel with the markup any more than this SVG's own did.
    bakeComputedStyle(winner, copy, warnings)
    defs.appendChild(copy)
    pairSubtrees(winner, copy, liveToClone)
    for (const node of [copy, ...copy.querySelectorAll('*')]) {
      const own = node.getAttribute && node.getAttribute('id')
      if (own) assignId(node, own)
    }
    imported++
    return finalId.get(copy)
  }

  const resolve = (id) => {
    if (refMap.has(id) || missing.has(id)) return
    const local = localFirst.get(id) || null
    if (!paired) {
      if (local) refMap.set(id, finalId.get(local))
      else missing.add(id)
      return
    }
    const winner = index.get(id) || null
    if (!winner) {
      if (local) refMap.set(id, finalId.get(local))
      else missing.add(id)
      return
    }
    const mapped = liveToClone.get(winner)
    if (mapped) {
      refMap.set(id, finalId.get(mapped))
      return
    }
    if (winner.namespaceURI !== SVG_NS) { missing.add(id); return }
    refMap.set(id, importDefinition(id, winner))
    if (local) stolen.push(id)
  }

  for (let pass = 0; pass < MAX_DEF_IMPORT_PASSES; pass++) {
    const before = refMap.size + missing.size
    for (const id of collectReferencedIds([clone, ...clone.querySelectorAll('*')])) resolve(id)
    if (refMap.size + missing.size === before) break
  }

  const classMap = new Map()
  // Classes only collide through a <style> block; without one they are inert and
  // renaming them would only make the markup harder to read.
  if (hasStyleElement) {
    for (const node of [clone, ...clone.querySelectorAll('*')]) {
      const cls = node.getAttribute && node.getAttribute('class')
      if (!cls) continue
      for (const name of cls.trim().split(/\s+/)) if (name) classMap.set(name, prefix + name)
    }
  }

  const rewriteUrls = makeReferenceRewriter(refMap, missing)
  let smil = false
  for (const node of [clone, ...clone.querySelectorAll('*')]) {
    if (!node.attributes) continue
    for (const attr of Array.from(node.attributes)) {
      if (attr.localName === 'id') continue
      let value = attr.value
      if (value.includes('url(')) value = rewriteUrls(value)
      if (attr.localName === 'href' && value.startsWith('#')) {
        const next = refMap.get(value.slice(1))
        if (next) value = '#' + next
        else missing.add(value.slice(1))
      }
      if (attr.localName === 'class' && classMap.size) {
        value = value.trim().split(/\s+/).map((n) => classMap.get(n) || n).join(' ')
      }
      // `begin="other.click"` and friends address elements by bare id; SMIL is
      // out of scope, but the reference would break silently, so it is reported.
      if ((attr.localName === 'begin' || attr.localName === 'end') && /[A-Za-z_][\w-]*\./.test(value)) smil = true
      if (value !== attr.value) attr.value = value
    }
    if (node.localName === 'style' && node.textContent) {
      let css = rewriteUrls(node.textContent)
      css = rewriteSelectors(css, refMap, '#')
      if (classMap.size) css = rewriteSelectors(css, classMap, '.')
      node.textContent = css
    }
  }

  if (imported) {
    warnings.push(`image: ${imported} referenced definition(s) live outside this <svg> and were copied into it.`)
  }
  if (stolen.length) {
    warnings.push(`image: this <svg> declares #${stolen.join(', #')} but does not win ${stolen.length > 1 ? 'them' : 'it'} — ` +
      'an earlier element in the capture declares the same id and the document resolves the reference to that ' +
      'one. The winning definition was imported so the export renders what the page rendered; the local ' +
      'declaration is kept, renamed, and unreferenced.')
  }
  if (smil) {
    warnings.push('image: SMIL timing references inside the SVG were not namespaced (animation is not captured).')
  }
  if (missing.size) {
    warnings.push(`image: ${missing.size} dangling reference(s) inside the SVG (#${[...missing].join(', #')}) — the target is not in the captured subtree.`)
  }
}

/**
 * Copies the computed value of the SVG presentation properties onto the clone.
 * The page's stylesheets do not travel with the markup, and `currentColor` — the
 * usual way an icon gets its colour — resolves to nothing without this.
 */
function bakeComputedStyle (live, clone, warnings) {
  const liveNodes = [live, ...live.querySelectorAll('*')]
  const cloneNodes = [clone, ...clone.querySelectorAll('*')]
  if (liveNodes.length !== cloneNodes.length) {
    warnings.push('image: inline SVG changed shape while being cloned; CSS presentation values were not baked in.')
    return
  }
  if (liveNodes.length > MAX_BAKE_NODES) {
    warnings.push(`image: inline SVG has ${liveNodes.length} nodes (over ${MAX_BAKE_NODES}); CSS presentation values were not baked in, so stylesheet-driven fills may be lost.`)
    return
  }
  const styles = new Map()
  const styleOf = (node) => {
    let s = styles.get(node)
    if (!s) { s = getComputedStyle(node); styles.set(node, s) }
    return s
  }

  const hasText = !!live.querySelector('text, tspan, textPath')
  let cssTransforms = 0
  for (let i = 0; i < liveNodes.length; i++) {
    const node = liveNodes[i]
    const target = cloneNodes[i]
    let style
    try {
      style = styleOf(node)
    } catch {
      continue
    }
    const isRoot = i === 0
    const parentStyle = !isRoot && node.parentElement ? styleOf(node.parentElement) : null
    // Presentation attributes lose to both the inline `style` attribute and the
    // SVG's own <style> block — which is why the attribute is left in place:
    // wherever one of those wins, it won when the computed value was read too,
    // so the two agree, and removing it would drop the properties NOT baked here
    // (`d`, `transform`, `transform-origin`, …).
    for (const [prop, initial] of INHERITED_SVG_PROPS) {
      const value = style.getPropertyValue(prop)
      if (!value) continue
      if (isRoot) {
        if (initial === null ? !hasText : value === initial) continue
      } else if (parentStyle && value === parentStyle.getPropertyValue(prop)) {
        continue
      }
      target.setAttribute(prop, value)
    }
    for (const [prop, initial] of OWN_SVG_PROPS) {
      const value = style.getPropertyValue(prop)
      if (value && value !== initial) target.setAttribute(prop, value)
    }
    if (style.display === 'none') target.setAttribute('display', 'none')
    // A CSS `transform` on an SVG child cannot be baked as an attribute: the two
    // resolve `transform-origin` against different boxes, so copying the matrix
    // across would move the shape. Reported rather than guessed at.
    if (style.transform && style.transform !== 'none' && !target.hasAttribute('transform')) cssTransforms++
  }
  if (cssTransforms) {
    warnings.push(`image: ${cssTransforms} node(s) inside the inline SVG are transformed by CSS; that transform is not carried into the serialized markup.`)
  }
}

/** Intrinsic size from the markup: `width`/`height` when absolute, else the viewBox. */
function svgIntrinsic (svgEl) {
  const raw = svgEl.getAttribute('viewBox')
  let viewBox = null
  if (raw) {
    const parts = raw.trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) viewBox = parts
  }
  const attr = (name) => {
    const v = svgEl.getAttribute(name)
    if (!v || v.trim().endsWith('%')) return null
    const n = parseFloat(v)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return { viewBox, w: attr('width'), h: attr('height') }
}

/** Pulls raster `<image>` children of an inlined SVG in as data URIs — they are external otherwise. */
async function embedNestedImages (root, timeout, warnings, base) {
  const images = Array.from(root.querySelectorAll('image'))
  if (!images.length) return
  let embedded = 0
  let failed = 0
  for (const node of images.slice(0, MAX_NESTED_IMAGES)) {
    const href = node.getAttribute('href') || node.getAttribute('xlink:href')
    if (!href || href.startsWith('data:') || href.startsWith('#')) continue
    let absolute = href
    try {
      absolute = new URL(href, base || (typeof location !== 'undefined' ? location.href : undefined)).href
    } catch { /* keep the raw href; fetch will fail and be reported */ }
    const got = await fetchBytes(absolute, timeout)
    if (!got) { failed++; continue }
    const uri = `data:${got.mime};base64,${bytesToBase64(got.bytes)}`
    if (node.hasAttribute('xlink:href')) node.removeAttribute('xlink:href')
    node.setAttribute('href', uri)
    embedded++
  }
  if (embedded) warnings.push(`image: ${embedded} raster <image> child(ren) of the SVG were inlined as data URIs.`)
  if (failed || images.length > MAX_NESTED_IMAGES) {
    warnings.push(`image: ${failed + Math.max(0, images.length - MAX_NESTED_IMAGES)} raster <image> child(ren) of the SVG could not be inlined and stay external.`)
  }
}

/** Grade-lowering constructs: the geometry survives, these do not. */
function auditSvgFeatures (root, warnings) {
  let grade = 'E'
  const notes = []
  if (root.querySelector('filter')) {
    warnings.push('image: the SVG uses <filter>; it is passed through verbatim and the target may render it differently.')
    notes.push('svg-filter-passthrough')
    grade = 'A'
  }
  if (root.querySelector('foreignObject')) {
    warnings.push('image: the SVG contains <foreignObject>; its HTML content is not vectorized.')
    notes.push('svg-foreignobject')
    grade = 'A'
  }
  if (root.querySelector('animate, animateTransform, animateMotion, set')) {
    warnings.push('image: the SVG is animated; the captured markup holds the declarations, not the current frame.')
    notes.push('svg-animated')
    grade = 'A'
  }
  return { grade, notes }
}

/**
 * Active content, out of the exported markup.
 *
 * A `<script>` has no business in a vector file. Rendered as an image nothing runs
 * it, rendered as a document something might, and either way the person who opens
 * the file has to audit it first. It also breaks the file outright: measured on
 * 2026-08-08, a dev server that injects a live-reload script into every `.svg` it
 * serves put three of them inside one capture — the icons the fixture loads — and
 * the emitted SVG stopped parsing at the first `// <![CDATA[`, which is a defect
 * the export had no way to see and the buyer had no way to explain.
 *
 * The engine copies what the page gave it; it does not have to copy this.
 *
 * @param {Element} node  the tree about to be serialized, never the live one
 * @param {Array} warnings
 */
function stripActiveContent (node, warnings) {
  let scripts = 0
  for (const el of node.querySelectorAll('script')) { el.remove(); scripts++ }
  let handlers = 0
  for (const el of [node, ...node.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name)) { el.removeAttribute(attr.name); handlers++ }
    }
  }
  if (scripts || handlers) {
    warnings.push({
      code: 'collect.image.active-content-stripped',
      // Nothing VISUAL was lost, so the node keeps its grade. What happened is
      // still reported, because a capture that quietly edits its own output is
      // the thing this engine exists not to be.
      grade: 'E',
      severity: 'warn',
      message: `image: the SVG carried ${scripts} <script> element(s) and ${handlers} event-handler ` +
        'attribute(s). They are removed from the exported markup: a drawing does not need them, and ' +
        'an injected one (a dev server\'s live-reload snippet, for instance) makes the file fail to parse.',
    })
  }
  return { scripts, handlers }
}

// ——— assets ———

/**
 * Ids issued here are tracked on the ctx as well as checked against
 * `ctx.assets`: the caller registers an asset only after this returns, so two
 * sources whose file names agree (`/a/logo.png`, `/b/logo.png`) would otherwise
 * both be handed `a_logo` and the second would overwrite the first.
 */
function nextAssetId (ctx, seed) {
  if (typeof ctx.uid === 'function') return ctx.uid('a')
  const used = ctx.assets || {}
  if (!ctx.assetIds) ctx.assetIds = new Set()
  const taken = (id) => ctx.assetIds.has(id) || Object.prototype.hasOwnProperty.call(used, id)
  let id = `a_${seed}`
  let n = 1
  while (taken(id)) id = `a_${seed}_${n++}`
  ctx.assetIds.add(id)
  return id
}

/** Keyed by URL, so one logo used twenty times is fetched and embedded once. */
function assetCache (ctx) {
  if (!ctx || typeof ctx !== 'object') return new Map()
  if (!ctx.assetCache) ctx.assetCache = new Map()
  return ctx.assetCache
}

function seedFromSrc (src, fallback) {
  if (!src || src.startsWith('data:')) return fallback
  const clean = String(src).split(/[?#]/)[0]
  const name = clean.slice(clean.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')
  const safe = name.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 24)
  return safe || fallback
}

// ——— sources ———

/**
 * Bytes that claim to be an SVG, as MARKUP: audited, its raster children
 * inlined, its ids namespaced, and given a viewport in its own natural units.
 *
 * **An SVG never travels inside an `<image>`.** Measured pasting into Figma
 * (FIGMA_FINDINGS §6): an `<image>` whose `href` is an SVG data URI draws
 * NOTHING — no diagnostic, no fallback, a blank node. The same drawing as
 * inline markup under a nested `<svg>` or a matrix lands correctly. That is why
 * both SVG sources — `<img src="*.svg">` and `background-image: url(*.svg)` —
 * come through here rather than through `bitmapAsset`.
 *
 * @param {Uint8Array} bytes
 * @param {string} src        for the messages, and the asset's `src`
 * @param {string} id         already minted by the caller: the id seeds the
 *   namespace prefix, so it cannot be issued after the markup is built
 * @param {object} ctx
 * @param {{w:number,h:number}|null} natural  the size the LAYOUT resolved the
 *   source to (`naturalWidth/Height` for an `<img>`, the measured intrinsic
 *   size for a background layer). It wins over the markup's own attributes
 *   because it is the number CSS sized against.
 * @param {{w:number,h:number}|null} box  the element box the CSS default sizing
 *   algorithm fits a ratio-only SVG into; null for a background layer, whose
 *   positioning area is resolved by the caller instead.
 * @param {string[]} warnings
 * @param {number} timeout
 * @returns {Promise<{asset:object, natural:{w:number,h:number}, grade:string, notes:string[]}|null>}
 *   null when the bytes are not a parseable SVG, which is a raster job again.
 */
async function svgMarkupAsset (bytes, src, id, ctx, natural, box, warnings, timeout) {
  const text = new TextDecoder('utf-8').decode(bytes)
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml')
  const root = parsed.documentElement
  if (!root || root.localName !== 'svg' || parsed.querySelector('parsererror')) return null

  const audit = auditSvgFeatures(root, warnings)
  await embedNestedImages(root, timeout, warnings, src)
  namespaceSvg(root, `${id}__`, warnings)

  const intrinsic = svgIntrinsic(root)
  let nw = natural && natural.w > 0 ? natural.w : intrinsic.w
  let nh = natural && natural.h > 0 ? natural.h : intrinsic.h
  const notes = [...audit.notes]
  if (!(nw > 0) || !(nh > 0)) {
    if (intrinsic.viewBox && intrinsic.viewBox[2] > 0 && intrinsic.viewBox[3] > 0) {
      notes.push('svg-intrinsic-from-viewbox')
      if (box && box.w > 0) {
        // Ratio only: the default sizing algorithm fits the ratio into the box.
        nw = box.w
        nh = nw / (intrinsic.viewBox[2] / intrinsic.viewBox[3])
        warnings.push(`image: the SVG at ${src} has no intrinsic size; its viewBox ratio was fitted to the element box.`)
      } else {
        // No box to fit into — a background layer's area is resolved against
        // this asset, not the other way round. The viewBox is kept verbatim so
        // the RATIO, which is the only intrinsic thing the file has, survives.
        nw = intrinsic.viewBox[2]
        nh = intrinsic.viewBox[3]
        warnings.push(`image: the SVG at ${src} has no intrinsic size; its viewBox is used as the natural size, so only its ratio is trustworthy.`)
      }
    } else {
      nw = DEFAULT_OBJECT_SIZE.w
      nh = DEFAULT_OBJECT_SIZE.h
      notes.push('svg-default-object-size')
      warnings.push(`image: the SVG at ${src} declares neither size nor viewBox; the 300x150 default object size was assumed.`)
    }
  }

  // Self-describing: the consumer gets a viewport in the same units the crop is in.
  root.setAttribute('width', String(nw))
  root.setAttribute('height', String(nh))
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', SVG_NS)

  return {
    asset: {
      id,
      kind: 'vector',
      mime: 'image/svg+xml',
      w: nw,
      h: nh,
      viewBox: intrinsic.viewBox,
      src,
      idPrefix: `${id}__`,
      markup: (stripActiveContent(root, warnings), new XMLSerializer().serializeToString(root)),
      data: null,
    },
    natural: { w: nw, h: nh },
    grade: audit.grade,
    notes,
  }
}

/**
 * `<img>` whose source is an SVG: fetched, namespaced, kept as vector.
 * @returns {Promise<{asset:object, natural:{w:number,h:number}, grade:string, notes:string[]}|null>}
 */
async function svgAssetFromBytes (bytes, src, el, ctx, box, warnings, timeout) {
  const natural = el && el.naturalWidth > 0 && el.naturalHeight > 0
    ? { w: el.naturalWidth, h: el.naturalHeight }
    : null
  const collected = await svgMarkupAsset(
    bytes, src, nextAssetId(ctx, seedFromSrc(src, 'svg')), ctx, natural, box, warnings, timeout)
  if (!collected) warnings.push(`image: the SVG at ${src} did not parse; falling back to raster.`)
  return collected
}

/**
 * A `background-image: url(...)` layer whose bytes are an SVG, as markup.
 *
 * The counterpart of `svgAssetFromBytes` for the OTHER source of SVG in a
 * document, and the one that was missing: `background-image` went to
 * `<image href="data:image/svg+xml…">`, which Figma renders as nothing at all
 * (FIGMA_FINDINGS §6 — the fixture's header came out flat grey, which was the
 * legibility gradient over an empty node).
 *
 * The id is minted by the caller because a background asset is keyed and cached
 * by URL there; `natural` is the intrinsic size the caller measured, since that
 * is the number `background-size` resolved `cover`/`contain` against and the
 * placed rect the emitter gets is only consistent with the markup if both come
 * from it.
 *
 * @param {Uint8Array} bytes
 * @param {string} url
 * @param {string} id
 * @param {object} ctx
 * @param {{w:number,h:number}|null} natural
 * @param {string[]} warnings  bare prose, in the same voice as the `<img>` path
 *   so identical messages classify identically wherever they were collected
 * @param {number} [timeout]
 * @returns {Promise<{asset:object, natural:{w:number,h:number}, grade:string, notes:string[]}|null>}
 */
export async function svgBackgroundAsset (bytes, url, id, ctx, natural, warnings, timeout = 8000) {
  return svgMarkupAsset(bytes, url, id, ctx, natural, null, warnings, timeout)
}

/**
 * Do these bytes hold an SVG? The `Content-Type` is the answer when the server
 * gave a real one, the extension is a hint, and the bytes themselves are the
 * only thing that cannot lie — a data URI with no mime, a CDN that serves
 * `application/octet-stream`, and `?v=2` on the end of a `.svg` all reach here.
 *
 * @param {Uint8Array|null} bytes
 * @param {string} url
 * @param {string} [mime]  as declared by the transfer, when there is one
 */
export function looksLikeSvg (bytes, url, mime) {
  if (typeof mime === 'string' && /^image\/svg\+xml\b/i.test(mime.trim())) return true
  if (/^data:image\/svg\+xml[;,]/i.test(String(url || ''))) return true
  if (bytes && bytes.length && sniffMime(bytes) === 'image/svg+xml') return true
  return !bytes && /\.svgz?(?:$|[?#])/i.test(String(url || ''))
}

/**
 * `<img>` with a raster source. The original bytes when we can get them (no
 * re-encode, metadata intact), a canvas readback otherwise, a bare reference
 * when the canvas is tainted.
 *
 * @param {{bytes: Uint8Array, mime: string}|null} fetched  already downloaded by
 *   the SVG probe, so the file is not requested twice.
 */
async function bitmapAsset (el, src, ctx, warnings, fetched) {
  const nw = el.naturalWidth || 0
  const nh = el.naturalHeight || 0
  const id = nextAssetId(ctx, seedFromSrc(src, 'img'))
  const notes = []
  const big = Number.isFinite(ctx.maxAssetBytes) ? ctx.maxAssetBytes : BIG_ASSET_BYTES

  // EXIF orientation is already applied to naturalWidth/Height and to
  // drawImage, but NOT to the bytes — so an oriented JPEG has to go through the
  // canvas, where the rotation is baked in and the two agree again.
  const orientation = fetched && /jpeg|jpg/.test(fetched.mime) ? jpegOrientation(fetched.bytes) : 1

  if (fetched && orientation === 1) {
    if (fetched.bytes.length > big) {
      warnings.push(`image: ${src} is ${(fetched.bytes.length / 1048576).toFixed(1)} MB and is embedded verbatim.`)
      notes.push('large-asset')
    }
    return {
      asset: {
        id,
        kind: 'bitmap',
        mime: fetched.mime,
        w: nw || 0,
        h: nh || 0,
        src,
        origin: 'original-bytes',
        data: `data:${fetched.mime};base64,${bytesToBase64(fetched.bytes)}`,
      },
      natural: { w: nw, h: nh },
      grade: 'E',
      notes,
    }
  }

  if (el.complete && nw > 0 && nh > 0) {
    try {
      const data = readback(el, nw, nh)
      if (orientation !== 1) {
        warnings.push(`image: ${src} carries EXIF orientation ${orientation}; it was re-encoded upright, which drops its EXIF and colour profile.`)
        notes.push('exif-orientation-baked')
      } else {
        warnings.push(`image: the bytes of ${src} could not be read (CORS); it was re-encoded to PNG through a canvas, dropping metadata and colour profile.`)
        notes.push('re-encoded-png')
      }
      return {
        asset: { id, kind: 'bitmap', mime: 'image/png', w: nw, h: nh, src, origin: 'canvas', data },
        natural: { w: nw, h: nh },
        grade: 'A',
        notes,
      }
    } catch {
      warnings.push(`image: ${src} taints the canvas and its bytes are not fetchable; the asset is referenced by URL with no data.`)
      notes.push('tainted-canvas')
    }
  } else {
    warnings.push(`image: ${src} is not decoded (broken or still loading); the asset is referenced by URL with no data.`)
    notes.push('not-decoded')
  }

  return {
    asset: { id, kind: 'bitmap', mime: 'application/octet-stream', w: nw, h: nh, src, origin: 'unresolved', data: null },
    natural: { w: nw, h: nh },
    grade: 'O',
    notes,
  }
}

/**
 * The rendering context a `<canvas>` already has. Probing '2d' first is
 * deliberate: it returns null on a WebGL canvas without disturbing it, whereas
 * probing 'webgl' first would CREATE a WebGL context on a never-drawn canvas and
 * lock the page out of its own 2d context.
 */
function canvasKind (el) {
  try {
    if (el.getContext('2d')) return { kind: '2d', attributes: null }
  } catch { /* fall through to the GL probe */ }
  for (const type of ['webgl2', 'webgl', 'experimental-webgl']) {
    try {
      const gl = el.getContext(type)
      if (gl) return { kind: 'webgl', attributes: gl.getContextAttributes ? gl.getContextAttributes() : null }
    } catch { /* try the next type */ }
  }
  return { kind: 'unknown', attributes: null }
}

function canvasAsset (el, ctx, box, warnings) {
  const w = el.width || 0
  const h = el.height || 0
  const id = nextAssetId(ctx, 'canvas')
  const natural = { w, h }
  const base = { id, kind: 'bitmap', mime: 'image/png', w, h, src: '', origin: 'canvas' }
  // The backing store is the resolution we read back at; `scale` records how it
  // relates to the CSS box so a consumer knows it is not a 1:1 asset.
  if (box.w > 0 && w > 0) base.scale = w / box.w

  if (!w || !h) {
    warnings.push('image: the <canvas> has a zero-sized backing store; nothing was captured.')
    return { asset: { ...base, data: null }, natural, grade: 'O', notes: ['canvas-empty'] }
  }

  const { kind, attributes } = canvasKind(el)
  if (kind === 'webgl' && attributes && attributes.preserveDrawingBuffer === false) {
    warnings.push('image: the <canvas> is WebGL without preserveDrawingBuffer; its buffer is undefined outside the drawing frame, so no pixels were read.')
    return { asset: { ...base, data: null }, natural, grade: 'O', notes: ['webgl-no-preserve-drawing-buffer'] }
  }
  if (kind === 'unknown') {
    warnings.push('image: the <canvas> uses a rendering context we cannot identify; the readback may be blank.')
  }

  try {
    const data = el.toDataURL('image/png')
    return { asset: { ...base, data }, natural, grade: 'R', notes: ['canvas-readback'] }
  } catch {
    warnings.push('image: the <canvas> is tainted by cross-origin content; its pixels cannot be read and a placeholder was emitted.')
    return { asset: { ...base, data: null }, natural, grade: 'O', notes: ['tainted-canvas'] }
  }
}

async function videoAsset (el, ctx, warnings, timeout) {
  const w = el.videoWidth || 0
  const h = el.videoHeight || 0
  const src = el.currentSrc || el.src || ''
  const id = nextAssetId(ctx, seedFromSrc(src, 'video'))
  const base = { id, kind: 'bitmap', mime: 'image/png', w, h, src, origin: 'video-frame' }

  if (w > 0 && h > 0 && el.readyState >= 2) {
    try {
      const data = readback(el, w, h)
      warnings.push('image: the <video> was captured as its current frame; playback is not represented.')
      return { asset: { ...base, data }, natural: { w, h }, grade: 'R', notes: ['video-current-frame'] }
    } catch {
      warnings.push('image: the <video> is cross-origin and taints the canvas; its current frame could not be read.')
    }
  } else {
    warnings.push('image: the <video> has no decoded frame yet (readyState < HAVE_CURRENT_DATA).')
  }

  const poster = el.getAttribute('poster')
  if (poster) {
    let absolute = poster
    try {
      absolute = new URL(poster, typeof location !== 'undefined' ? location.href : undefined).href
    } catch { /* keep the raw value */ }
    const fetched = await fetchBytes(absolute, timeout)
    if (fetched) {
      warnings.push('image: the <video> poster was embedded in place of a frame.')
      return {
        asset: { ...base, mime: fetched.mime, src: absolute, origin: 'video-poster', data: `data:${fetched.mime};base64,${bytesToBase64(fetched.bytes)}` },
        natural: { w, h },
        grade: 'R',
        notes: ['video-poster'],
      }
    }
  }

  warnings.push('image: the <video> was emitted as an empty placeholder.')
  return { asset: { ...base, data: null }, natural: { w, h }, grade: 'O', notes: ['video-placeholder'] }
}

/**
 * The tree an inline SVG's `#id` references were resolved in. The capture root
 * is the honest answer — it is the tree that was laid out and painted, and it
 * carries snapdom's hoisted `inline-defs-container` — but a caller may hand us a
 * detached element, so the element's own root is the fallback.
 */
function resolutionRoot (el, ctx) {
  const root = ctx && ctx.rootEl
  if (root && root.nodeType === 1 && typeof root.contains === 'function' && root.contains(el)) return root
  const own = typeof el.getRootNode === 'function' ? el.getRootNode() : null
  if (own && own.nodeType === 9) return own.documentElement || el
  if (own && own.nodeType === 1) return own
  return el
}

/** Inline `<svg>`: serialized, styles baked, external defs pulled in, ids namespaced. */
async function inlineSvgAsset (el, ctx, box, warnings, timeout) {
  const id = nextAssetId(ctx, 'svg')
  const clone = el.cloneNode(true)
  const audit = auditSvgFeatures(el, warnings)
  bakeComputedStyle(el, clone, warnings)
  namespaceSvg(clone, `${id}__`, warnings, { live: el, index: buildIdIndex(resolutionRoot(el, ctx)) })
  await embedNestedImages(clone, timeout, warnings)

  const intrinsic = svgIntrinsic(el)
  // The element box IS the SVG viewport, so that is the natural size; anything
  // inside is mapped by the markup's own viewBox and preserveAspectRatio.
  const w = box.w > 0 ? box.w : (intrinsic.w || (intrinsic.viewBox ? intrinsic.viewBox[2] : DEFAULT_OBJECT_SIZE.w))
  const h = box.h > 0 ? box.h : (intrinsic.h || (intrinsic.viewBox ? intrinsic.viewBox[3] : DEFAULT_OBJECT_SIZE.h))
  if (!(box.w > 0) || !(box.h > 0)) {
    warnings.push(`image: the inline <svg> has no laid-out box (${box.w}x${box.h}); ` +
      `${intrinsic.w || intrinsic.viewBox ? 'its own markup' : `the ${DEFAULT_OBJECT_SIZE.w}x${DEFAULT_OBJECT_SIZE.h} default object size`} was used as the viewport instead.`)
  }
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', SVG_NS)

  return {
    asset: {
      id,
      kind: 'vector',
      mime: 'image/svg+xml',
      w,
      h,
      viewBox: intrinsic.viewBox,
      src: '',
      idPrefix: `${id}__`,
      markup: (stripActiveContent(clone, warnings), new XMLSerializer().serializeToString(clone)),
      data: null,
    },
    natural: { w, h },
    grade: audit.grade,
    notes: [...audit.notes, 'inline-svg'],
  }
}

// ——— entry point ———

/**
 * Collects the replaced content of an element as an asset plus the image paint
 * that places it.
 *
 * The paint carries `crop` (in the asset's own source pixels) and `transform`
 * (a 2x3 matrix mapping the unit square of that crop onto the node's BORDER
 * box, in px), which between them express all five `object-fit` values and any
 * `object-position`. `fill.grade` is the fidelity grade for the node and
 * `fill.notes` says why it is not `E`; `asset.kind === 'vector'` means the
 * caller must emit a `vector` node, not an `image` one.
 *
 * @param {Element} el   `<img>`, `<canvas>`, `<video>` or an inline `<svg>`
 * @param {CSSStyleDeclaration} cs   already-computed style for `el`
 * @param {CollectCtx} [ctx]
 * @returns {Promise<{asset: Asset, fill: object, warnings: string[]}|null>}
 *   null when the element carries no replaced content at all — which is not a
 *   degradation, so it is the one case with nothing to report.
 */
export async function collectImage (el, cs, ctx = {}) {
  const tag = el && el.tagName ? el.tagName.toUpperCase() : ''
  if (!IMAGE_TAGS.has(tag)) return null

  const warnings = []
  const notes = []
  const box = contentBox(el, cs)
  const timeout = Number.isFinite(ctx.fetchTimeout) ? ctx.fetchTimeout : 8000
  const cache = assetCache(ctx)

  let collected = null
  let fit = (cs && cs.objectFit) || 'fill'

  if (tag === 'IMG') {
    const src = el.currentSrc || el.src || ''
    if (!src) {
      warnings.push('image: <img> has no resolved source; an empty placeholder was emitted.')
      collected = {
        asset: { id: nextAssetId(ctx, 'img'), kind: 'bitmap', mime: 'application/octet-stream', w: 0, h: 0, src: '', origin: 'unresolved', data: null },
        natural: { w: 0, h: 0 },
        grade: 'O',
        notes: ['no-source'],
      }
    } else {
      const cached = cache.get(src)
      if (cached) {
        // The grade travels with the asset, so its reason has to travel too: a
        // second node graded 'O' with no diagnostic is exactly what the schema
        // rejects, and rightly.
        warnings.push(...cached.warnings)
        collected = { ...cached, notes: [...cached.notes, 'asset-reused'] }
      } else {
        const before = warnings.length
        // srcset means `src` and `currentSrc` disagree; the paint has to describe
        // the file the browser actually chose.
        if (el.srcset || (el.parentElement && el.parentElement.tagName === 'PICTURE')) {
          notes.push('srcset-currentsrc')
        }
        const fetched = await fetchBytes(src, timeout)
        // One spelling of "is this an SVG?" for both sources: a `Content-Type`
        // when the transfer gave a real one, the bytes when it did not (a CDN
        // that answers `application/octet-stream` used to send an icon down the
        // raster road), and the extension only when there are no bytes to read.
        const looksSvg = looksLikeSvg(fetched && fetched.bytes, src, fetched && fetched.mime)

        if (fetched && looksSvg) {
          collected = await svgAssetFromBytes(fetched.bytes, src, el, ctx, box, warnings, timeout)
        } else if (looksSvg) {
          warnings.push(`image: ${src} is an SVG whose bytes are unreachable (CORS); it was rasterized instead of vectorized.`)
        }
        // Falls through when the SVG did not parse, which is a raster job again.
        if (!collected) collected = await bitmapAsset(el, src, ctx, warnings, looksSvg ? null : fetched)
        collected = { ...collected, warnings: warnings.slice(before) }
        cache.set(src, collected)
      }
    }
  } else if (tag === 'CANVAS') {
    collected = canvasAsset(el, ctx, box, warnings)
  } else if (tag === 'VIDEO') {
    collected = await videoAsset(el, ctx, warnings, timeout)
  } else {
    collected = await inlineSvgAsset(el, ctx, box, warnings, timeout)
    // object-fit does not apply to an inline SVG root: its own viewBox and
    // preserveAspectRatio already did that job inside the markup.
    if (fit && fit !== 'fill') {
      warnings.push(`image: object-fit:${fit} on an inline <svg> is ignored by CSS; the element box was used verbatim.`)
    }
    fit = 'fill'
  }

  notes.push(...collected.notes)

  let position = parseObjectPosition(cs && cs.objectPosition)
  if (!position) {
    warnings.push(`image: object-position "${cs && cs.objectPosition}" could not be resolved; it was centred.`)
    notes.push('object-position-fallback')
    position = { x: (free) => free / 2, y: (free) => free / 2 }
  }

  const placed = placeObject(fit, position, collected.natural, box)
  if (!placed.visible && box.w > 0 && box.h > 0) {
    warnings.push('image: object-position pushes the whole image outside the content box; nothing of it is painted.')
    notes.push('object-out-of-box')
  } else if (placed.overflowed) {
    notes.push(`object-fit:${fit}-cropped`)
  }
  if (cs && cs.imageRendering && cs.imageRendering !== 'auto') {
    notes.push(`image-rendering:${cs.imageRendering}`)
  }

  const fill = {
    type: 'image',
    asset: collected.asset.id,
    fit: 'stretch',
    crop: placed.crop,
    transform: placed.transform,
    clipBox: 'content',
    opacity: 1,
    grade: collected.grade,
    notes,
    srcCss: { objectFit: fit, objectPosition: (cs && cs.objectPosition) || '50% 50%' },
  }

  return { asset: collected.asset, fill, warnings }
}

export default collectImage
