/**
 * SnapDOM Vector: Figma plugin, sandbox half.
 *
 * Deliberately dumb: it consumes an already-decided document and turns it into
 * nodes. Every decision that needs measuring was taken in the browser, where
 * the layout actually happened. Nothing here re-measures, re-breaks lines or
 * re-derives paint order — if a value is missing, that is a bug upstream and
 * this file says so instead of guessing.
 *
 * The input is the `svdToFigma` payload and nothing else (CONTRACT.md: it is
 * the single canonical translator). This file therefore knows Figma's
 * vocabulary only: `x/y/width/height`, types in caps, paints already in Figma
 * shape, text as a `setRange` instruction list. It does NOT read an SVD
 * document. There used to be a second translation in here, reading `frame`,
 * `node.type === 'text'` and `unit.from`, and it was the one that ran — which
 * is why every linear gradient imported top-to-bottom and why the payload from
 * the engine was rejected outright. Anything that has to be *derived* belongs
 * in `packages/vector/src/emit/figma-json.js`, where Node can test it without
 * this sandbox.
 *
 * Two rules shape the rest:
 *
 *  1. **Reject, never repair.** A payload version we do not know is a hard stop.
 *     A repaired document is a document whose bug ships.
 *  2. **Nothing degrades silently.** Every approximation appends to `warnings`,
 *     and `warnings` is shown to the user — before the build when it is
 *     knowable in advance (the preflight), after it when it is not.
 *
 * Environment notes, because they are not obvious and they cost hours:
 *  - This runs in Figma's sandbox: no DOM, no `fetch`, no `atob`, no modules.
 *    So this file is a classic script, not ESM, unlike the rest of the repo.
 *  - `loadFontAsync` *rejects* when the font is not installed. Every load is
 *    wrapped, and all of them resolve before a single node is created — a
 *    half-loaded font set means half a document built and then a throw.
 *  - Figma's `children` array is back-to-front: index 0 paints first. The
 *    payload's `children` arrays are already in that order (the emitter sorted
 *    them by `paint.z`), so they are appended as they come and never re-sorted.
 */

/* global figma, __html__ */

'use strict'

const FIGMA_PAYLOAD_VERSION = 1

/** `setPluginData` caps an entry at 100 kB; stay under it with room for UTF-8. */
const PLUGIN_DATA_KEY = 'svd'
const PLUGIN_DATA_CHUNK = 80000

/** Nodes built between yields. Long synchronous runs freeze the editor. */
const YIELD_EVERY = 120

/** Beyond this the preflight list stops being read and starts being noise. */
const DIAGNOSTIC_SAMPLE = 24

figma.skipInvisibleInstanceChildren = true

figma.showUI(__html__, { width: 420, height: 560 })

// ——— tiny helpers ———

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNum = (v) => typeof v === 'number' && isFinite(v)
const isStr = (v) => typeof v === 'string' && v.length > 0
const num = (v, d) => (isNum(v) ? v : d)
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Figma refuses zero-sized nodes; 0.01 is the documented floor. */
const size = (v) => Math.max(0.01, num(v, 0.01))

/**
 * The warning ledger. Everything this file could not do exactly lands here and
 * is surfaced in the UI — that is the product, not a nicety.
 */
function makeWarnings () {
  const byCode = new Map()
  return {
    add (code, message, node) {
      let entry = byCode.get(code)
      if (!entry) {
        entry = { code, message, count: 0, nodes: [] }
        byCode.set(code, entry)
      }
      entry.count++
      if (isStr(node) && entry.nodes.length < DIAGNOSTIC_SAMPLE) entry.nodes.push(node)
      return entry
    },
    list () {
      return Array.from(byCode.values())
    },
    get size () {
      return byCode.size
    },
  }
}

// ——— base64 / data URIs ———
//
// The sandbox has `figma.base64Decode` on current builds and nothing at all on
// older ones, so the fallback is hand-rolled. No `atob`, and emphatically no
// `new Function`.

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
let B64_LOOKUP = null

function base64ToBytes (b64) {
  if (typeof figma.base64Decode === 'function') return figma.base64Decode(b64)
  if (B64_LOOKUP === null) {
    B64_LOOKUP = {}
    for (let i = 0; i < B64_ALPHABET.length; i++) B64_LOOKUP[B64_ALPHABET[i]] = i
  }
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let acc = 0
  let bits = 0
  let o = 0
  for (let i = 0; i < clean.length; i++) {
    const v = B64_LOOKUP[clean[i]]
    if (v === undefined) continue
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (acc >> bits) & 0xff
    }
  }
  return out.subarray(0, o)
}

/** UTF-8 bytes -> string. `TextDecoder` is not guaranteed in the sandbox. */
function bytesToText (bytes) {
  let out = ''
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i]
    let cp
    if (b < 0x80) { cp = b; i += 1 }
    else if (b < 0xe0) { cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f); i += 2 }
    else if (b < 0xf0) { cp = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f); i += 3 }
    else {
      cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f)
      i += 4
    }
    out += String.fromCodePoint(cp)
  }
  return out
}

function splitDataUri (uri) {
  if (!isStr(uri)) return null
  if (uri.slice(0, 5) !== 'data:') return null
  const comma = uri.indexOf(',')
  if (comma === -1) return null
  return { head: uri.slice(5, comma), body: uri.slice(comma + 1) }
}

function dataUriToBytes (uri) {
  const parts = splitDataUri(uri)
  if (!parts) return null
  if (parts.head.indexOf(';base64') !== -1) return base64ToBytes(parts.body)
  const text = decodeURIComponent(parts.body)
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff
  return bytes
}

/** Text payloads (inline SVG) may arrive as a data URI or as raw markup. */
function assetToText (asset) {
  if (!isObj(asset)) return null
  if (isStr(asset.svg)) return asset.svg
  const data = asset.data
  if (!isStr(data)) return null
  const parts = splitDataUri(data)
  if (!parts) return data
  if (parts.head.indexOf(';base64') !== -1) return bytesToText(base64ToBytes(parts.body))
  return decodeURIComponent(parts.body)
}

// ——— payload validation ———

const NODE_TYPES = ['FRAME', 'GROUP', 'TEXT', 'RECTANGLE', 'ELLIPSE', 'VECTOR']

function readRootId (root) {
  if (isStr(root)) return root
  if (isObj(root) && isStr(root.$ref)) return root.$ref
  return null
}

/**
 * Accepts exactly one thing: the `svdToFigma` payload. A raw SVD document is
 * refused with the reason and the fix, because silently half-reading it is what
 * produced two divergent translations in the first place.
 *
 * @param {unknown} payload
 * @returns {{ok: boolean, errors: string[], doc: object|null}}
 */
function readPayload (payload) {
  const errors = []
  if (!isObj(payload)) {
    return { ok: false, errors: ['The file is not a JSON object.'], doc: null }
  }

  if (payload.version === undefined) {
    return {
      ok: false,
      doc: null,
      errors: [
        isStr(payload.schema)
          ? `This is a raw ${payload.schema} document, not a Figma payload. This plugin reads the ` +
            'output of `svdToFigma(doc)` — export "Figma payload" from the snapdom panel, or call ' +
            '`svdToFigma` on the .svd.json first. The plugin deliberately has no second translator.'
          : 'The file carries no `version`, so it is not a snapdom Figma payload.',
      ],
    }
  }
  if (payload.version !== FIGMA_PAYLOAD_VERSION) {
    return {
      ok: false,
      doc: null,
      errors: [
        `Unsupported document: payload version is ${JSON.stringify(payload.version)}, this plugin ` +
        `reads ${FIGMA_PAYLOAD_VERSION}. Re-export with a matching version of @zumer/snapdom-vector — ` +
        'the plugin does not convert between payload versions.',
      ],
    }
  }

  const nodes = payload.nodes
  if (!isObj(nodes)) {
    errors.push('`nodes` must be an object keyed by node id.')
    return { ok: false, errors, doc: null }
  }

  const rootId = readRootId(payload.root)
  if (rootId === null) {
    errors.push('`root` must be a node id or {"$ref": id}.')
  } else if (!Object.prototype.hasOwnProperty.call(nodes, rootId)) {
    errors.push(`\`root\` points at ${JSON.stringify(rootId)}, which is not in \`nodes\`.`)
  }

  // Only the structural invariants a builder cannot survive without. The strict
  // validator runs engine-side (packages/svd) on the SVD before it is
  // translated; duplicating it here would mean two validators that can disagree.
  const ids = Object.keys(nodes)
  for (let i = 0; i < ids.length && errors.length < 12; i++) {
    const id = ids[i]
    const node = nodes[id]
    if (!isObj(node)) {
      errors.push(`Node ${JSON.stringify(id)} is not an object.`)
      continue
    }
    if (NODE_TYPES.indexOf(node.type) === -1) {
      errors.push(
        `Node ${JSON.stringify(id)} has type ${JSON.stringify(node.type)}, which is not one of ` +
        `${NODE_TYPES.join(', ')}.`
      )
    }
    if (!isNum(node.x) || !isNum(node.y) || !isNum(node.width) || !isNum(node.height)) {
      errors.push(`Node ${JSON.stringify(id)} has no numeric \`x\`/\`y\`/\`width\`/\`height\`.`)
    }
    if (node.children !== undefined && !Array.isArray(node.children)) {
      errors.push(`Node ${JSON.stringify(id)}: \`children\` must be an array of ids.`)
      continue
    }
    const kids = node.children || []
    for (let k = 0; k < kids.length; k++) {
      if (!Object.prototype.hasOwnProperty.call(nodes, kids[k])) {
        errors.push(`Node ${JSON.stringify(id)}: child ${JSON.stringify(kids[k])} is not in \`nodes\`.`)
        break
      }
    }
  }

  if (errors.length) return { ok: false, errors, doc: null }

  const passthrough = isObj(payload.document) ? payload.document : {}
  return {
    ok: true,
    errors: [],
    doc: {
      nodes,
      rootId,
      fonts: Array.isArray(payload.fonts) ? payload.fonts.filter(isObj) : [],
      // What the translation itself lost, and what the engine lost before it.
      // Kept apart so neither list double-counts the other.
      diagnostics: Array.isArray(payload.diagnostics) ? payload.diagnostics : [],
      documentDiagnostics: Array.isArray(passthrough.diagnostics) ? passthrough.diagnostics : [],
      assets: isObj(passthrough.assets) ? passthrough.assets : {},
      capture: isObj(passthrough.capture) ? passthrough.capture : {},
      report: isObj(passthrough.report) ? passthrough.report : {},
    },
  }
}

/** Depth-first over the payload tree, root first. */
function walk (doc, visit) {
  const stack = [doc.rootId]
  const seen = new Set()
  const root = doc.nodes[doc.rootId]
  if (isObj(root) && Array.isArray(root.siblings)) {
    for (let i = root.siblings.length - 1; i >= 0; i--) stack.push(root.siblings[i])
  }
  while (stack.length) {
    const id = stack.pop()
    if (seen.has(id)) continue
    seen.add(id)
    const node = doc.nodes[id]
    if (!isObj(node)) continue
    visit(id, node)
    const kids = node.children || []
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i])
  }
}

// ——— fonts ———

const WEIGHT_NAMES = [
  ['thin', 100], ['hairline', 100],
  ['extralight', 200], ['ultralight', 200], ['extra light', 200], ['ultra light', 200],
  ['light', 300],
  ['regular', 400], ['normal', 400], ['book', 400], ['roman', 400],
  ['medium', 500],
  ['semibold', 600], ['demibold', 600], ['semi bold', 600], ['demi bold', 600],
  ['extrabold', 800], ['ultrabold', 800], ['extra bold', 800], ['ultra bold', 800],
  ['bold', 700],
  ['black', 900], ['heavy', 900], ['fat', 900], ['poster', 900],
]

const ITALIC_RE = /italic|oblique|kursiv/i

/**
 * Figma style names are prose ("Semi Bold Italic"), so weight has to be read
 * out of them. Longest-match first: "extrabold" must not resolve as "bold".
 */
function parseStyleName (styleName) {
  const lower = String(styleName || '').toLowerCase()
  const italic = ITALIC_RE.test(lower)
  let weight = 400
  let best = 0
  for (let i = 0; i < WEIGHT_NAMES.length; i++) {
    const [name, w] = WEIGHT_NAMES[i]
    if (lower.indexOf(name) !== -1 && name.length > best) {
      best = name.length
      weight = w
    }
  }
  return { weight, italic }
}

/** Real families in a CSS stack, quotes stripped and generics removed. */
function familiesFromStack (stack) {
  if (!isStr(stack)) return []
  const generic = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
    'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong']
  return stack.split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter((s) => s.length > 0 && generic.indexOf(s.toLowerCase()) === -1)
}

// U+0000 separator: it cannot occur in a font name, so "Inter Semi"+"Bold"
// and "Inter"+"SemiBold" cannot collide the way a space would. Same key the
// emitter builds, so `payload.fonts[].key` and a `setRange` face agree.
const fontKey = (family, style) => `${family}\u0000${style}`

/**
 * The payload's font rows, normalised. `family`/`style` are what the page
 * painted; `weight`, `italic` and `stack` are what the matcher below needs to
 * fall back sensibly, and `nodes`/`chars` are what the preflight shows.
 */
function fontRequirements (doc) {
  const out = []
  for (let i = 0; i < doc.fonts.length; i++) {
    const f = doc.fonts[i]
    if (!isStr(f.family) || !isStr(f.style)) continue
    const parsed = parseStyleName(f.style)
    out.push({
      key: isStr(f.key) ? f.key : fontKey(f.family, f.style),
      family: f.family,
      style: f.style,
      weight: num(f.weight, parsed.weight),
      italic: f.italic === true || (f.italic === undefined && parsed.italic),
      stack: familiesFromStack(f.stack),
      nodes: Math.max(0, num(f.nodes, 0)),
      chars: Math.max(0, num(f.chars, 0)),
      nodeIds: Array.isArray(f.nodeIds) ? f.nodeIds.filter(isStr) : [],
      outlinable: f.canOutline === true,
      rasterizable: f.canRaster === true,
    })
  }
  return out
}

/** family (lowercased) -> [{style, weight, italic}], built once per session. */
let availableIndex = null
let availableFamilies = null

async function loadAvailableFonts () {
  if (availableIndex) return availableIndex
  const list = await figma.listAvailableFontsAsync()
  availableIndex = new Map()
  const families = []
  for (let i = 0; i < list.length; i++) {
    const fn = list[i].fontName
    if (!fn || !isStr(fn.family)) continue
    const key = fn.family.toLowerCase()
    let bucket = availableIndex.get(key)
    if (!bucket) {
      bucket = { family: fn.family, styles: [] }
      availableIndex.set(key, bucket)
      families.push(fn.family)
    }
    const parsed = parseStyleName(fn.style)
    bucket.styles.push({ style: fn.style, weight: parsed.weight, italic: parsed.italic })
  }
  families.sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1))
  availableFamilies = families
  return availableIndex
}

/**
 * CSS Fonts 4 §5.2 weight matching, not nearest-absolute-distance. The
 * difference is visible: with 400/500/700 installed and 600 wanted, "nearest"
 * ties and picks Medium, while the spec walks upward first and picks Bold —
 * which is what the browser painted.
 */
function pickWeight (pool, want) {
  for (let i = 0; i < pool.length; i++) if (pool[i].weight === want) return pool[i]
  const below = pool.filter((s) => s.weight < want).sort((a, b) => b.weight - a.weight)
  const above = pool.filter((s) => s.weight > want).sort((a, b) => a.weight - b.weight)
  if (want === 400) {
    for (let i = 0; i < pool.length; i++) if (pool[i].weight === 500) return pool[i]
    return below[0] || above[0]
  }
  if (want < 500) return below[0] || above[0]
  return above[0] || below[0]
}

/**
 * Fuzzy match, in the order a human would try: the exact face, then the
 * nearest weight in the same family with the same slant, then the same family
 * ignoring slant (Figma synthesises nothing, so that is a real loss), then the
 * next family in the CSS stack, then the document default.
 *
 * @returns {{family:string, style:string, status:string, detail:string}}
 */
function resolveFont (req, index) {
  const candidates = [req.family].concat(req.stack || [])
  for (let c = 0; c < candidates.length; c++) {
    const bucket = index.get(String(candidates[c]).toLowerCase())
    if (!bucket || !bucket.styles.length) continue
    const bits = []
    if (c > 0) bits.push(`family ${req.family} → ${bucket.family}`)

    for (let i = 0; i < bucket.styles.length; i++) {
      if (bucket.styles[i].style === req.style) {
        return {
          family: bucket.family,
          style: bucket.styles[i].style,
          status: c > 0 ? 'family' : 'exact',
          detail: bits.join('; '),
        }
      }
    }

    const sameSlant = bucket.styles.filter((s) => s.italic === req.italic)
    const pool = sameSlant.length ? sameSlant : bucket.styles
    const best = pickWeight(pool, req.weight)
    if (!best) continue
    if (best.weight !== req.weight) bits.push(`weight ${req.weight} → ${best.weight}`)
    if (!sameSlant.length && req.italic) bits.push('no italic face; upright used')
    return {
      family: bucket.family,
      style: best.style,
      status: c > 0 ? 'family' : (bits.length ? 'weight' : 'exact'),
      detail: bits.join('; '),
    }
  }

  const fallback = index.get('inter') || index.values().next().value
  if (!fallback || !fallback.styles.length) {
    return { family: 'Inter', style: 'Regular', status: 'missing', detail: 'no local fonts listed' }
  }
  const sameSlant = fallback.styles.filter((s) => s.italic === req.italic)
  const best = pickWeight(sameSlant.length ? sameSlant : fallback.styles, req.weight)
  return {
    family: fallback.family,
    style: best ? best.style : 'Regular',
    status: 'missing',
    detail: `neither ${req.family} nor any family in the CSS stack is installed`,
  }
}

// ——— paints and effects ———
//
// These arrive in Figma's own shape. The only thing the sandbox adds is the
// `imageHash`, which only `figma.createImage` can mint. Everything else is
// copied key by key: an unknown key on a paint is rejected by the API, and a
// payload is not trusted to have none.

const PAINT_KEYS = {
  SOLID: ['color', 'opacity', 'blendMode', 'visible'],
  GRADIENT_LINEAR: ['gradientTransform', 'gradientStops', 'opacity', 'blendMode', 'visible'],
  GRADIENT_RADIAL: ['gradientTransform', 'gradientStops', 'opacity', 'blendMode', 'visible'],
  GRADIENT_ANGULAR: ['gradientTransform', 'gradientStops', 'opacity', 'blendMode', 'visible'],
  GRADIENT_DIAMOND: ['gradientTransform', 'gradientStops', 'opacity', 'blendMode', 'visible'],
  IMAGE: ['imageHash', 'scaleMode', 'imageTransform', 'scalingFactor', 'rotation', 'opacity',
    'blendMode', 'visible', 'filters'],
}

const EFFECT_KEYS = {
  DROP_SHADOW: ['color', 'offset', 'radius', 'spread', 'visible', 'blendMode', 'showShadowBehindNode'],
  INNER_SHADOW: ['color', 'offset', 'radius', 'spread', 'visible', 'blendMode'],
  LAYER_BLUR: ['radius', 'visible', 'blurType'],
  BACKGROUND_BLUR: ['radius', 'visible', 'blurType'],
}

function pick (src, keys) {
  const out = {}
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    if (src[k] !== undefined && src[k] !== null) out[k] = src[k]
  }
  return out
}

function toPaint (paint, ctx, id) {
  if (!isObj(paint) || !isStr(paint.type)) return null
  const keys = PAINT_KEYS[paint.type]
  if (!keys) {
    ctx.warnings.add('paint.unknown', `The payload asked for a ${paint.type} paint, which this Figma build has no setter for.`, id)
    return null
  }
  const out = pick(paint, keys)
  out.type = paint.type
  if (paint.type === 'IMAGE') {
    const hash = imageHashFor(paint.asset, ctx, id)
    if (!hash) return null
    out.imageHash = hash
  }
  return out
}

function toPaints (list, ctx, id) {
  const out = []
  if (!Array.isArray(list)) return out
  for (let i = 0; i < list.length; i++) {
    const p = toPaint(list[i], ctx, id)
    if (p) out.push(p)
    else if (isObj(list[i])) {
      ctx.warnings.add('fill.dropped', `A ${String(list[i].type)} paint could not be created and was dropped.`, id)
    }
  }
  return out
}

function toEffects (list, ctx, id) {
  const out = []
  if (!Array.isArray(list)) return out
  for (let i = 0; i < list.length; i++) {
    const e = list[i]
    if (!isObj(e) || !isStr(e.type)) continue
    const keys = EFFECT_KEYS[e.type]
    if (!keys) {
      ctx.warnings.add('effect.dropped', `A ${String(e.type)} effect has no setter in this Figma build and was dropped.`, id)
      continue
    }
    const effect = pick(e, keys)
    effect.type = e.type
    out.push(effect)
  }
  return out
}

function imageHashFor (assetId, ctx, id) {
  if (!isStr(assetId)) return null
  if (ctx.images.has(assetId)) return ctx.images.get(assetId)
  const asset = ctx.doc.assets[assetId]
  const bytes = isObj(asset) ? dataUriToBytes(asset.data) : null
  if (!bytes || !bytes.length) {
    ctx.warnings.add('image.missing', `Asset ${assetId} carries no decodable bitmap; the fill was dropped.`, id)
    ctx.images.set(assetId, null)
    return null
  }
  let hash = null
  try {
    hash = figma.createImage(bytes).hash
  } catch (err) {
    ctx.warnings.add('image.rejected', `Figma refused asset ${assetId}: ${String(err && err.message || err)}`, id)
  }
  ctx.images.set(assetId, hash)
  return hash
}

// ——— geometry and common properties ———

/**
 * `width`/`height` and either `x`/`y` or a `relativeTransform` that already
 * carries the rotation. Both were computed by the emitter; neither is derived
 * here. Order matters: `resize` before the matrix, or the matrix is re-based.
 */
function placeNode (fig, node, ctx, id) {
  if (typeof fig.resize === 'function') fig.resize(size(node.width), size(node.height))
  const rt = node.relativeTransform
  if (Array.isArray(rt) && rt.length === 2 && Array.isArray(rt[0]) && Array.isArray(rt[1])) {
    try {
      fig.relativeTransform = [
        [num(rt[0][0], 1), num(rt[0][1], 0), num(rt[0][2], node.x)],
        [num(rt[1][0], 0), num(rt[1][1], 1), num(rt[1][2], node.y)],
      ]
      return
    } catch (err) {
      ctx.warnings.add('transform.rejected', `Figma refused a relativeTransform: ${String(err && err.message || err)}`, id)
    }
  }
  fig.x = num(node.x, 0)
  fig.y = num(node.y, 0)
}

function applyCommon (fig, node, ctx, id) {
  if ('fills' in fig) {
    const fills = toPaints(node.fills, ctx, id)
    // A TextNode already got its colour per range; assigning an empty array here
    // would wipe every `setRangeFills` call that just ran.
    if (fills.length || fig.type !== 'TEXT') fig.fills = fills
  }

  const strokes = toPaints(node.strokes, ctx, id)
  if (strokes.length && 'strokes' in fig) {
    fig.strokes = strokes
    if (isStr(node.strokeAlign) && 'strokeAlign' in fig) fig.strokeAlign = node.strokeAlign
    if (isNum(node.strokeWeight) && 'strokeWeight' in fig) fig.strokeWeight = Math.max(0, node.strokeWeight)
    if (isNum(node.strokeTopWeight)) {
      if ('strokeTopWeight' in fig) {
        fig.strokeTopWeight = Math.max(0, num(node.strokeTopWeight, 0))
        fig.strokeRightWeight = Math.max(0, num(node.strokeRightWeight, 0))
        fig.strokeBottomWeight = Math.max(0, num(node.strokeBottomWeight, 0))
        fig.strokeLeftWeight = Math.max(0, num(node.strokeLeftWeight, 0))
      } else {
        // The emitter only emits per-side weights on rect-like nodes, so this is
        // a Figma build that lost the property, not a payload mistake.
        const max = Math.max(
          num(node.strokeTopWeight, 0), num(node.strokeRightWeight, 0),
          num(node.strokeBottomWeight, 0), num(node.strokeLeftWeight, 0)
        )
        fig.strokeWeight = max
        ctx.warnings.add(
          'stroke.per-side-unsupported',
          `Per-side stroke weights are not settable on this ${fig.type}; the thickest side (${max}px) was ` +
          'used on all four.',
          id
        )
      }
    }
    if (Array.isArray(node.dashPattern) && 'dashPattern' in fig) fig.dashPattern = node.dashPattern
    if (isStr(node.strokeCap) && 'strokeCap' in fig) fig.strokeCap = node.strokeCap
    if (isStr(node.strokeJoin) && 'strokeJoin' in fig) fig.strokeJoin = node.strokeJoin
    if (isNum(node.strokeMiterLimit) && 'strokeMiterLimit' in fig) fig.strokeMiterLimit = node.strokeMiterLimit
  }

  const effects = toEffects(node.effects, ctx, id)
  if (effects.length && 'effects' in fig) {
    try {
      fig.effects = effects
    } catch (err) {
      ctx.warnings.add('effect.rejected', `Figma refused an effect list: ${String(err && err.message || err)}`, id)
    }
  }

  applyRadii(fig, node, ctx, id)

  if ('clipsContent' in fig) fig.clipsContent = node.clipsContent === true
  if ('opacity' in fig) fig.opacity = clamp01(num(node.opacity, 1))
  if (isStr(node.blendMode) && 'blendMode' in fig) {
    try {
      fig.blendMode = node.blendMode
    } catch (err) {
      ctx.warnings.add('blend.rejected', `Figma refused blend mode ${node.blendMode}.`, id)
    }
  }
  if (isObj(node.mask)) {
    ctx.warnings.add(
      'mask.unsupported',
      `Masks are not applied by this version; node ${String(node.mask.node)} was built as an ordinary layer.`,
      id
    )
  }
}

function applyRadii (fig, node, ctx, id) {
  const tl = node.topLeftRadius
  const tr = node.topRightRadius
  const br = node.bottomRightRadius
  const bl = node.bottomLeftRadius
  if (!isNum(tl) && !isNum(tr) && !isNum(br) && !isNum(bl)) return
  if (!('topLeftRadius' in fig)) {
    ctx.warnings.add('radius.unsupported', `Corner radii are not settable on a ${fig.type}; the corners are square.`, id)
    return
  }
  fig.topLeftRadius = Math.max(0, num(tl, 0))
  fig.topRightRadius = Math.max(0, num(tr, 0))
  fig.bottomRightRadius = Math.max(0, num(br, 0))
  fig.bottomLeftRadius = Math.max(0, num(bl, 0))
}

// ——— text ———

let segmenter

/**
 * The set of legal range boundaries in `chars`. A boundary inside a surrogate
 * pair makes `setRangeFontName` throw; a boundary inside a grapheme cluster
 * merely restyles half an emoji, which is worse because it is silent.
 * Computed once per text block — segmenting per boundary is quadratic.
 */
function graphemeBoundaries (chars, ctx) {
  if (segmenter === undefined) {
    segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      : null
    if (segmenter === null) {
      ctx.warnings.add(
        'text.no-segmenter',
        'Intl.Segmenter is unavailable in this Figma build, so run boundaries were snapped to code ' +
        'units. Styling can split a grapheme cluster.'
      )
    }
  }
  if (!segmenter) return null
  const set = new Set([0, chars.length])
  const iter = segmenter.segment(chars)
  for (const seg of iter) set.add(seg.index + seg.segment.length)
  return set
}

/** Clamp into `chars` and slide back to the nearest legal boundary. */
function snapIndex (chars, index, boundaries) {
  const n = chars.length
  let i = Math.max(0, Math.min(n, Math.round(num(index, 0))))
  if (i === 0 || i === n) return i
  if (boundaries) {
    while (i > 0 && !boundaries.has(i)) i--
    return i
  }
  const code = chars.charCodeAt(i)
  if (code >= 0xdc00 && code <= 0xdfff) i -= 1
  return i
}

/**
 * The order in here is not negotiable and is the single most common cause of
 * silently wrong imports: `characters` first (it needs a loaded font),
 * `setRangeFontName` next (it re-flows everything downstream of it), and only
 * then the other ranges — set them earlier and the font change discards them.
 */
async function buildText (node, id, ctx, parent) {
  const chars = isStr(node.characters) ? node.characters : ''
  const fig = figma.createText()
  parent.appendChild(fig)

  const ranges = (Array.isArray(node.setRange) ? node.setRange : []).filter(isObj)
  fig.fontName = ctx.faceFor(ranges.length ? ranges[0].fontName : node.fontName)
  fig.characters = chars

  const bounds = graphemeBoundaries(chars, ctx)
  const spans = ranges.map((range) => ({
    range,
    start: snapIndex(chars, range.start, bounds),
    end: snapIndex(chars, range.end, bounds),
  }))

  for (let i = 0; i < spans.length; i++) {
    const { range, start, end } = spans[i]
    if (end <= start) continue
    fig.setRangeFontName(start, end, ctx.faceFor(range.fontName))
  }

  // Everything else, now that the runs own their faces.
  for (let i = 0; i < spans.length; i++) {
    const { range, start, end } = spans[i]
    if (end <= start) continue
    if (isNum(range.fontSize)) fig.setRangeFontSize(start, end, Math.max(1, range.fontSize))
    if (Array.isArray(range.fills) && range.fills.length) {
      const paints = toPaints(range.fills, ctx, id)
      if (paints.length) fig.setRangeFills(start, end, paints)
    }
    if (isStr(range.textDecoration) && range.textDecoration !== 'NONE') {
      fig.setRangeTextDecoration(start, end, range.textDecoration)
      // The three refinements below are newer than the rest of the text API, so
      // an older build losing them is reported rather than assumed away.
      applyDecorationDetail(fig, start, end, range, ctx, id)
    }
    if (isObj(range.hyperlink) && isStr(range.hyperlink.value)) {
      try {
        fig.setRangeHyperlink(start, end, { type: 'URL', value: range.hyperlink.value })
      } catch (err) {
        ctx.warnings.add('text.hyperlink-rejected', `Figma refused a hyperlink: ${String(err && err.message || err)}`, id)
      }
    }
    // Per-run tracking. The payload carries it on every run (`emit/figma-json.js`
    // says so in `figma.text-letterspacing-kept`), and until this call existed that
    // claim was false: only the block-level value below was applied, so a block whose
    // runs disagree — a headline with one tracked word — imported with one tracking
    // for all of them. `setRangeLetterSpacing` needs the run's font loaded, which the
    // `setRangeFontName` pass above has already done.
    if (isObj(range.letterSpacing) && isNum(range.letterSpacing.value)) {
      try {
        fig.setRangeLetterSpacing(start, end, range.letterSpacing)
      } catch (err) {
        ctx.warnings.add('text.letterspacing-rejected',
          `Figma refused a run's letter-spacing: ${String(err && err.message || err)}`, id)
      }
    }
    // `textCase` is applied ONLY for the small-caps values. The other cases
    // (UPPER/LOWER/TITLE) stay unapplied for the reason they always did: `characters`
    // already carries the post-`text-transform` string and setting them would apply
    // the transform twice. Small caps is not a transform — it is `font-variant`, a
    // rendering choice the characters do not encode — so the same argument does not
    // reach it, and leaving it off dropped real typography.
    if (isStr(range.textCase) && (range.textCase === 'SMALL_CAPS' || range.textCase === 'SMALL_CAPS_FORCED')) {
      try {
        fig.setRangeTextCase(start, end, range.textCase)
      } catch (err) {
        ctx.warnings.add('text.textcase-rejected',
          `Figma refused a run's small-caps: ${String(err && err.message || err)}`, id)
      }
    }
  }

  if (isObj(node.lineHeight)) fig.lineHeight = node.lineHeight
  if (isObj(node.letterSpacing)) fig.letterSpacing = node.letterSpacing
  if (isNum(node.paragraphSpacing)) fig.paragraphSpacing = Math.max(0, node.paragraphSpacing)
  if (isStr(node.textCase)) fig.textCase = node.textCase
  if (isStr(node.textAlignHorizontal)) fig.textAlignHorizontal = node.textAlignHorizontal
  if (isStr(node.textAlignVertical)) fig.textAlignVertical = node.textAlignVertical
  fig.textAutoResize = isStr(node.textAutoResize) ? node.textAutoResize : 'NONE'

  placeNode(fig, node, ctx, id)
  verifyTextLayout(fig, node, ctx, id)
  return fig
}

function applyDecorationDetail (fig, start, end, range, ctx, id) {
  const attempts = [
    ['setRangeTextDecorationStyle', range.textDecorationStyle],
    ['setRangeTextDecorationColor', range.textDecorationColor],
    ['setRangeTextDecorationThickness', range.textDecorationThickness],
  ]
  for (let i = 0; i < attempts.length; i++) {
    const [method, value] = attempts[i]
    if (value === undefined || value === null) continue
    if (typeof fig[method] !== 'function') {
      ctx.warnings.add(
        'text.decoration-detail-unsupported',
        `This Figma build has no ${method}, so the decoration is drawn solid, in the text colour, at ` +
        'the default thickness.',
        id
      )
      continue
    }
    try {
      fig[method](start, end, value)
    } catch (err) {
      ctx.warnings.add(
        'text.decoration-detail-rejected',
        `Figma refused ${method}: ${String(err && err.message || err)}`,
        id
      )
    }
  }
}

/**
 * The one measurement this file is allowed to take, and it changes nothing: the
 * engine measured the browser's line count and width, and if Figma's shaping
 * disagrees the text reflowed — which is the single failure this pipeline
 * exists to prevent, so it is reported with the numbers rather than left to be
 * noticed later.
 */
function verifyTextLayout (fig, node, ctx, id) {
  const layout = isObj(node.textLayout) ? node.textLayout : null
  if (!layout || !isNum(layout.lineCount) || layout.lineCount < 1) return
  const pitch = num(layout.pitch, 0)
  if (!(pitch > 0)) return
  let measured = 0
  try {
    // The box is fixed (NONE), so the only way to ask Figma how tall the text
    // really came out is to let it hug for one frame and put the box back.
    fig.textAutoResize = 'HEIGHT'
    measured = fig.height
    fig.textAutoResize = 'NONE'
    fig.resize(size(node.width), size(node.height))
  } catch (err) {
    return
  }
  const lines = Math.round(measured / pitch)
  if (lines > layout.lineCount) {
    ctx.warnings.add(
      'text.reflowed',
      `A block the browser laid out in ${layout.lineCount} line(s) needs ${lines} in Figma ` +
      `(${Math.round(measured)}px vs ${Math.round(pitch * layout.lineCount)}px tall). The substituted ` +
      'font is wider than the page\'s, so these line breaks are Figma\'s, not the page\'s.',
      id
    )
  }
}

// ——— node construction ———

async function buildNode (id, ctx, parent) {
  const node = ctx.doc.nodes[id]
  if (!isObj(node)) return null

  const kids = Array.isArray(node.children) ? node.children : []
  let fig = null
  // A block replaced by its pre-baked outline or bitmap is finished paint: its
  // own fills are already inside it, so `applyCommon` must not overwrite them.
  let replaced = false

  if (node.type === 'TEXT') {
    fig = await buildOutlineOrRaster(node, id, ctx, parent)
    if (fig) {
      replaced = true
      placeNode(fig, node, ctx, id)
      if ('opacity' in fig) fig.opacity = clamp01(num(node.opacity, 1))
    } else {
      fig = await buildText(node, id, ctx, parent)
    }
  } else if (node.type === 'GROUP') {
    fig = await buildGroup(node, id, ctx, parent, kids)
  } else if (node.type === 'VECTOR') {
    fig = buildVector(node, id, ctx, parent)
  } else if (node.type === 'ELLIPSE') {
    fig = figma.createEllipse()
    parent.appendChild(fig)
    fig.fills = []
    fig.strokes = []
  } else if (node.type === 'RECTANGLE') {
    fig = figma.createRectangle()
    parent.appendChild(fig)
    fig.fills = []
    fig.strokes = []
  } else {
    fig = figma.createFrame()
    parent.appendChild(fig)
    fig.fills = []
    fig.strokes = []
    fig.clipsContent = node.clipsContent === true
  }

  if (!fig) return null
  if (isStr(node.name)) fig.name = node.name

  if (node.type !== 'GROUP' && !replaced) {
    if (node.type !== 'TEXT') placeNode(fig, node, ctx, id)
    applyCommon(fig, node, ctx, id)
  }

  ctx.done++
  if (ctx.done % YIELD_EVERY === 0) {
    figma.ui.postMessage({ type: 'progress', done: ctx.done, total: ctx.total, label: fig.name })
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  if (node.type !== 'GROUP' && kids.length) {
    if ('appendChild' in fig) {
      // Already back-to-front: `children[0]` is the bottom layer, and
      // `appendChild` puts each new node on top of the previous one.
      for (let i = 0; i < kids.length; i++) await buildNode(kids[i], ctx, fig)
    } else {
      ctx.warnings.add('node.children-dropped', `${kids.length} children could not be attached to a ${fig.type}.`, id)
    }
  }

  writePluginData(fig, id, node, ctx)
  return fig
}

/**
 * `figma.group` needs its members already parented, so a group is built by
 * creating the children into the group's parent and collapsing them after. A
 * childless group cannot exist in Figma at all. The children already carry the
 * group's origin (the emitter folded it in), so nothing is offset here.
 */
async function buildGroup (node, id, ctx, parent, kids) {
  const made = []
  for (let i = 0; i < kids.length; i++) {
    const child = await buildNode(kids[i], ctx, parent)
    if (child) made.push(child)
  }
  if (!made.length) {
    ctx.warnings.add('group.empty', 'A group with no representable children was dropped.', id)
    return null
  }
  const group = figma.group(made, parent)
  group.opacity = clamp01(num(node.opacity, 1))
  if (isStr(node.blendMode)) {
    try {
      group.blendMode = node.blendMode
    } catch (err) {
      ctx.warnings.add('blend.rejected', `Figma refused blend mode ${node.blendMode} on a group.`, id)
    }
  }
  const effects = toEffects(node.effects, ctx, id)
  if (effects.length) group.effects = effects
  return group
}

function buildVector (node, id, ctx, parent) {
  if (isStr(node.svg)) return fromSvg(node.svg, id, ctx, parent, 'vector.rejected')
  const paths = Array.isArray(node.vectorPaths) ? node.vectorPaths.filter((p) => isObj(p) && isStr(p.data)) : []
  if (!paths.length) {
    ctx.warnings.add('vector.missing', 'A vector node carried neither `vectorPaths` nor `svg`; an empty frame was emitted.', id)
    const frame = figma.createFrame()
    parent.appendChild(frame)
    frame.fills = []
    return frame
  }
  const fig = figma.createVector()
  parent.appendChild(fig)
  fig.fills = []
  fig.strokes = []
  try {
    fig.vectorPaths = paths.map((p) => ({
      windingRule: p.windingRule === 'EVENODD' ? 'EVENODD' : 'NONZERO',
      data: p.data,
    }))
  } catch (err) {
    ctx.warnings.add('vector.rejected', `Figma refused a vector path: ${String(err && err.message || err)}`, id)
  }
  return fig
}

function fromSvg (svg, id, ctx, parent, code) {
  try {
    const fig = figma.createNodeFromSvg(svg)
    parent.appendChild(fig)
    return fig
  } catch (err) {
    ctx.warnings.add(code, `Figma refused an SVG payload: ${String(err && err.message || err)}`, id)
    const fig = figma.createFrame()
    parent.appendChild(fig)
    fig.fills = []
    return fig
  }
}

/**
 * The two escape hatches for text the user chose not to reproduce with a
 * substituted font. Both must have been baked in the browser: `outlineText()`
 * does not exist in the Plugin API, and the sandbox cannot rasterize.
 */
async function buildOutlineOrRaster (node, id, ctx, parent) {
  const decision = ctx.decisionForNode(id) || (isObj(node.degrade) ? { action: String(node.degrade.action || '').toLowerCase() } : null)
  if (!decision || (decision.action !== 'outline' && decision.action !== 'raster')) return null

  if (decision.action === 'outline' && isStr(node.outlineAsset)) {
    const svg = assetToText(ctx.doc.assets[node.outlineAsset])
    if (isStr(svg)) {
      ctx.warnings.add('text.outlined', 'Text was replaced by its outline; it is no longer editable.', id)
      return fromSvg(svg, id, ctx, parent, 'text.outline-rejected')
    }
  }
  if (decision.action === 'raster' && isStr(node.rasterAsset)) {
    const hash = imageHashFor(node.rasterAsset, ctx, id)
    if (hash) {
      const fig = figma.createRectangle()
      parent.appendChild(fig)
      fig.fills = [{ type: 'IMAGE', scaleMode: 'CROP', imageHash: hash, imageTransform: [[1, 0, 0], [0, 1, 0]] }]
      ctx.warnings.add('text.rasterized', 'Text was replaced by a bitmap; it is no longer editable or searchable.', id)
      return fig
    }
  }
  ctx.warnings.add(
    'text.fallback-unavailable',
    `The document carries no pre-baked ${decision.action} for this block, so the substituted font was ` +
    'used instead. Re-export with that fallback enabled if you need it.',
    id
  )
  return null
}

/**
 * Provenance, so a designer can ask a layer where it came from and why it looks
 * the way it does. `setPluginData` caps an entry at 100 kB, so a fat CSS
 * snapshot is split across numbered keys rather than truncated in silence.
 */
function writePluginData (fig, id, node, ctx) {
  const prov = isObj(node.provenance) ? node.provenance : {}
  const record = {
    id,
    selector: isStr(prov.selector) ? prov.selector : null,
    tag: isStr(prov.tag) ? prov.tag : null,
    grade: isStr(prov.grade) ? prov.grade : 'E',
    notes: Array.isArray(prov.notes) ? prov.notes : [],
    css: isObj(prov.css) ? prov.css : undefined,
  }
  let json
  try {
    json = JSON.stringify(record)
  } catch (err) {
    return
  }
  try {
    if (json.length <= PLUGIN_DATA_CHUNK) {
      fig.setPluginData(PLUGIN_DATA_KEY, json)
      return
    }
    const parts = Math.ceil(json.length / PLUGIN_DATA_CHUNK)
    fig.setPluginData(PLUGIN_DATA_KEY, JSON.stringify({ id, chunks: parts }))
    for (let i = 0; i < parts; i++) {
      fig.setPluginData(`${PLUGIN_DATA_KEY}~${i}`, json.substr(i * PLUGIN_DATA_CHUNK, PLUGIN_DATA_CHUNK))
    }
    ctx.warnings.add('plugindata.chunked', `Provenance for one node exceeded 100 kB and was split into ${parts} entries.`, id)
  } catch (err) {
    ctx.warnings.add('plugindata.rejected', `Figma refused plugin data: ${String(err && err.message || err)}`, id)
  }
}

// ——— preflight ———

function summarize (doc) {
  let total = 0
  let text = 0
  let images = 0
  let chars = 0
  walk(doc, (id, node) => {
    total++
    if (node.type === 'TEXT') {
      text++
      if (isStr(node.characters)) chars += node.characters.length
    }
    if (node.type === 'VECTOR') images++
    else if (Array.isArray(node.fills) && node.fills.some((f) => isObj(f) && f.type === 'IMAGE')) images++
  })
  // "Not exact" is the count of nodes some diagnostic names — the engine's or
  // the translation's. The payload carries no per-node grade, and inventing one
  // from the node itself would be a second opinion about the same document.
  const named = new Set()
  const all = doc.documentDiagnostics.concat(doc.diagnostics)
  for (let i = 0; i < all.length; i++) {
    const d = all[i]
    if (!isObj(d)) continue
    if (isStr(d.node)) named.add(d.node)
    if (Array.isArray(d.nodes)) for (let k = 0; k < d.nodes.length; k++) if (isStr(d.nodes[k])) named.add(d.nodes[k])
  }
  return { total, text, images, chars, degraded: named.size }
}

/** Diagnostics grouped by code — one line per kind of loss, not per node. */
function groupDiagnostics (diagnostics) {
  const groups = new Map()
  for (let i = 0; i < diagnostics.length; i++) {
    const d = diagnostics[i]
    if (!isObj(d) || !isStr(d.code)) continue
    let g = groups.get(d.code)
    if (!g) {
      g = { code: d.code, severity: d.severity || 'info', count: 0, samples: [] }
      groups.set(d.code, g)
    }
    g.count++
    if (d.severity === 'error') g.severity = 'error'
    else if (d.severity === 'warn' && g.severity !== 'error') g.severity = 'warn'
    if (g.samples.length < DIAGNOSTIC_SAMPLE) {
      g.samples.push({
        node: isStr(d.node) ? d.node : null,
        reason: isStr(d.message) ? d.message : (isStr(d.reason) ? d.reason : (isStr(d.note) ? d.note : null)),
        css: isStr(d.css) ? d.css : null,
        action: isStr(d.action) ? d.action : null,
      })
    }
  }
  const order = { error: 0, warn: 1, info: 2 }
  return Array.from(groups.values()).sort((a, b) => {
    const s = order[a.severity] - order[b.severity]
    return s !== 0 ? s : b.count - a.count
  })
}

async function preflight (doc) {
  const index = await loadAvailableFonts()
  const reqs = fontRequirements(doc)
  const fonts = reqs.map((req) => {
    const resolved = resolveFont(req, index)
    return {
      key: req.key,
      family: req.family,
      style: req.style,
      weight: req.weight,
      italic: req.italic,
      stack: req.stack,
      nodes: req.nodes,
      chars: req.chars,
      resolved: { family: resolved.family, style: resolved.style },
      status: resolved.status,
      detail: resolved.detail,
      canOutline: req.outlinable,
      canRaster: req.rasterizable,
    }
  })
  return {
    type: 'preflight',
    capture: {
      url: isStr(doc.capture.url) ? doc.capture.url : '',
      selector: isStr(doc.capture.selector) ? doc.capture.selector : '',
      capturedAt: isStr(doc.capture.capturedAt) ? doc.capture.capturedAt : '',
      generator: isStr(doc.report.generator) ? doc.report.generator : '',
    },
    stats: summarize(doc),
    fonts,
    diagnostics: groupDiagnostics(doc.documentDiagnostics.concat(doc.diagnostics)),
    families: availableFamilies,
  }
}

// ——— build ———

/**
 * @param {object} doc         a validated payload
 * @param {object} decisions   fontKey -> {action:'substitute'|'map'|'outline'|'raster', family, style}
 */
async function build (doc, decisions) {
  const warnings = makeWarnings()
  const index = await loadAvailableFonts()
  const reqs = fontRequirements(doc)

  // One resolved face per required font, honouring the user's choice.
  const perFace = new Map()
  const nodeAction = new Map()
  for (let i = 0; i < reqs.length; i++) {
    const req = reqs[i]
    const choice = isObj(decisions) ? decisions[req.key] : null
    let target
    if (isObj(choice) && choice.action === 'map' && isStr(choice.family)) {
      target = { family: choice.family, style: isStr(choice.style) ? choice.style : 'Regular' }
      warnings.add('font.mapped', `${req.family} ${req.style} → ${target.family} ${target.style} (${req.nodes} nodes, ${req.chars} chars), chosen by you.`)
    } else {
      const resolved = resolveFont(req, index)
      target = { family: resolved.family, style: resolved.style }
      if (resolved.status !== 'exact') {
        warnings.add('font.substituted', `${req.family} ${req.style} → ${target.family} ${target.style} — ${resolved.detail || resolved.status} (${req.nodes} nodes, ${req.chars} chars).`)
      }
    }
    perFace.set(fontKey(req.family, req.style), target)
    if (isObj(choice) && (choice.action === 'outline' || choice.action === 'raster')) {
      for (let n = 0; n < req.nodeIds.length; n++) nodeAction.set(req.nodeIds[n], { action: choice.action })
    }
  }

  // Every load resolves before a single node exists. A font that rejects here
  // and is discovered mid-build leaves half a document on the canvas.
  const unique = new Map()
  perFace.forEach((fn) => unique.set(fontKey(fn.family, fn.style), fn))
  // Inter Regular is the face a fresh TextNode starts with; keeping it loaded
  // means `characters` can always be set even if every other load failed.
  unique.set(fontKey('Inter', 'Regular'), { family: 'Inter', style: 'Regular' })

  const loads = []
  unique.forEach((fn, key) => {
    loads.push(
      figma.loadFontAsync(fn)
        .then(() => ({ key, fn, ok: true }))
        .catch((err) => ({ key, fn, ok: false, error: String(err && err.message || err) }))
    )
  })
  const results = await Promise.all(loads)
  const loaded = new Set()
  let fallbackFont = null
  for (let i = 0; i < results.length; i++) {
    if (results[i].ok) {
      loaded.add(results[i].key)
      if (!fallbackFont) fallbackFont = results[i].fn
    } else {
      warnings.add(
        'font.load-failed',
        `Figma could not load ${results[i].fn.family} ${results[i].fn.style}: ${results[i].error}`
      )
    }
  }
  if (loaded.has(fontKey('Inter', 'Regular'))) fallbackFont = { family: 'Inter', style: 'Regular' }
  if (!fallbackFont) throw new Error('No font could be loaded, so no text can be created.')

  const stats = summarize(doc)
  const ctx = {
    doc,
    warnings,
    images: new Map(),
    total: stats.total,
    done: 0,
    /** The face the payload asked for -> the face that is actually loaded. */
    faceFor (fontName) {
      if (!isObj(fontName) || !isStr(fontName.family) || !isStr(fontName.style)) {
        warnings.add(
          'font.unnamed-range',
          `A text range names no font; ${fallbackFont.family} ${fallbackFont.style} was used.`
        )
        return fallbackFont
      }
      const target = perFace.get(fontKey(fontName.family, fontName.style))
      if (target && loaded.has(fontKey(target.family, target.style))) return target
      if (!target) {
        warnings.add(
          'font.not-in-preflight',
          `A text range asks for ${fontName.family} ${fontName.style}, which the payload's font list ` +
          `does not contain, so it was never preloaded; ${fallbackFont.family} ${fallbackFont.style} was used.`
        )
      }
      return fallbackFont
    },
    decisionForNode (id) {
      return nodeAction.get(id) || null
    },
  }

  figma.ui.postMessage({ type: 'progress', done: 0, total: ctx.total, label: 'Creating nodes' })

  const page = figma.currentPage
  const root = await buildNode(doc.rootId, ctx, page)
  if (!root) throw new Error('The root node could not be created.')

  // Shapes the root's own border or outline had to be composed into, which it
  // cannot adopt. They are painted after it, beside it.
  const siblings = Array.isArray(doc.nodes[doc.rootId].siblings) ? doc.nodes[doc.rootId].siblings : []
  const made = [root]
  for (let i = 0; i < siblings.length; i++) {
    const extra = await buildNode(siblings[i], ctx, page)
    if (extra) made.push(extra)
  }

  // Land it in the middle of what the user is looking at, not at (0,0) on top
  // of whatever already lives there.
  const center = figma.viewport.center
  const dx = Math.round(center.x - root.width / 2) - root.x
  const dy = Math.round(center.y - root.height / 2) - root.y
  for (let i = 0; i < made.length; i++) {
    made[i].x += dx
    made[i].y += dy
  }

  figma.currentPage.selection = made
  figma.viewport.scrollAndZoomIntoView(made)

  return {
    type: 'done',
    created: ctx.done,
    total: ctx.total,
    name: root.name,
    warnings: warnings.list(),
  }
}

// ——— message loop ———

let currentDoc = null

figma.ui.onmessage = async (msg) => {
  if (!isObj(msg) || !isStr(msg.type)) return

  try {
    if (msg.type === 'analyze') {
      const read = readPayload(msg.payload)
      if (!read.ok) {
        figma.ui.postMessage({ type: 'error', message: 'This document was rejected.', errors: read.errors })
        return
      }
      currentDoc = read.doc
      const result = await preflight(currentDoc)
      figma.ui.postMessage(result)
      return
    }

    if (msg.type === 'styles-for') {
      const index = await loadAvailableFonts()
      const bucket = index.get(String(msg.family || '').toLowerCase())
      figma.ui.postMessage({
        type: 'styles',
        family: msg.family,
        styles: bucket ? bucket.styles.map((s) => s.style) : [],
      })
      return
    }

    if (msg.type === 'build') {
      if (!currentDoc) {
        figma.ui.postMessage({ type: 'error', message: 'Nothing to build — load a document first.', errors: [] })
        return
      }
      const result = await build(currentDoc, msg.decisions)
      figma.ui.postMessage(result)
      const losses = result.warnings.reduce((n, w) => n + w.count, 0)
      figma.notify(
        losses
          ? `${result.created} layers created · ${losses} approximation${losses === 1 ? '' : 's'} listed in the plugin.`
          : `${result.created} layers created with no approximations.`,
        { timeout: 6000 }
      )
      return
    }

    if (msg.type === 'close') {
      figma.closePlugin()
    }
  } catch (err) {
    figma.ui.postMessage({
      type: 'error',
      message: String((err && err.message) || err),
      errors: err && err.stack ? [String(err.stack)] : [],
    })
  }
}
