/**
 * snapdom Pro — vector capture, as a snapdom PLUGIN. One capture in, one SVD
 * document out:
 *
 *     const result = await snapdom(el, { plugins: [vector()] })
 *     const doc = await result.toVector()      // the SVD document
 *     const svg = await result.toVectorSvg()   // the flat SVG
 *     const h2d = await result.toVectorFigmaClipboard()  // Figma's paste envelope
 *
 * The third one is a PARALLEL backend off the same clone, not a consumer of the
 * SVD: it writes Figma's own `h2d` clipboard payload — the computed DOM, which
 * Figma converts on paste — and touches neither `emit/svg-flat.js` nor the
 * document. See `emit/h2d.js` for what that format costs.
 *
 * `vector()` at the bottom of this file is the whole public surface. There is no
 * second way in — no loose `toVector(element)` that makes its own snapdom call —
 * because two ways in means two behaviours to keep in step, and the one that
 * hid the `snapdom()` call also hid its options from the person making it.
 *
 * This module is an ORCHESTRATOR and nothing else. It owns four things and
 * delegates everything else:
 *
 *  1. the capture context — the root rect, the memoised `getComputedStyle`, the
 *     font-metric cache, the id counter, the shared measuring canvas and the
 *     warnings array every collector writes into;
 *  2. the traversal — `buildPaintTree` decides structure and paint order, and
 *     each emitted node is handed to the collector its type calls for, with the
 *     asynchronous ones (images, background bytes) batched through `Promise.all`
 *     rather than serialised;
 *  3. the bookkeeping no collector can do because each sees one element at a
 *     time — asset ids, text-style ids deduplicated across blocks, the fonts the
 *     page supplies and this build does not embed, and turning every `warnings`
 *     entry into a `diagnostics` entry with a fidelity grade. The GRADE belongs
 *     to the collector: a warning may arrive as `{code, grade, message}` and
 *     that grade is used verbatim. Guessing one from the prose is a fallback for
 *     the collectors that still speak only prose, and it is marked as such;
 *  4. the refusal to ship a broken document: `validate` runs on our own output
 *     and a failure throws, with the schema's errors in the message.
 *
 * The rule that outranks the rest of this file: **nothing degrades silently.**
 * A collector warning always becomes a diagnostic AND a grade on the node it
 * came from. A node graded other than `E` that no diagnostic names is a bug the
 * validator rejects — and it is right to.
 *
 * **The tree that gets walked is snapdom's CLONE, not the live DOM.** That is the
 * founding decision of this engine and `packages/CONTRACT.md` carries the
 * evidence: the plugin's `beforeRender` hook takes the resolved clone out of the
 * capture, `adapters/snapdom.js` mounts it offscreen and hands it over already
 * laid out, with pseudo-elements materialised
 * into real elements, shadow DOM flattened, icon fonts resolved and images inlined
 * past CORS. Membership in the tree is solved before this file runs; only geometry
 * and paint are ours.
 *
 * Two consequences the rest of this file depends on:
 *
 *  - **`capture.selector` and `capture.url` describe the ORIGINAL element.** The
 *    user wants to know what was captured, not where we mounted a copy of it.
 *  - **the mount is verified, every time.** `capture.drift` is the mounted
 *    clone's boxes measured against the live boxes they came from; it lands in
 *    `report.drift` and, past 1px, in a diagnostic. Every coordinate this engine
 *    emits is measured on the clone, so an unverified mount is an unverified
 *    document.
 *
 * The clone is transient: the export unmounts it in a `finally`, and drops the
 * `el` back-reference each node carries so the document does not pin a detached
 * copy of the user's subtree in memory for as long as it lives.
 */
import { emptyDocument, validate } from '../svd/index.js'
import { handoffFrom, mountClone } from './adapters/snapdom.js'
import { buildPaintTree } from './paint.js'
import { collectBox, resolveLayerRect } from './collect/box.js'
import { collectText } from './collect/text.js'
import { collectImage, svgBackgroundAsset, looksLikeSvg } from './collect/image.js'
import { collectMathML } from './collect/mathml.js'
import { collectFonts } from './collect/font.js'
import { svdToSvg, rasterFilterPlan } from './emit/svg-flat.js'
import { svdToFigma } from './emit/figma-json.js'
import { cloneToH2d, h2dEnvelope, h2dClipboardItem, H2D_PROPS, H2D_VERSION } from './emit/h2d.js'
import { findFallbackTargets, svdSliceToDataUri } from './emit/h2d-vector.js'

export { svdToSvg, svdToFigma }
export { cloneToH2d, h2dEnvelope, h2dClipboardItem, H2D_PROPS, H2D_VERSION }

/** Fidelity grades, worst-wins. Mirrors `FIDELITY` in @zumer/svd and `paint.js`. */
const GRADE_RANK = { E: 0, A: 1, C: 2, R: 3, RH: 3, O: 4 }

/**
 * CSS `mix-blend-mode` keywords the schema accepts. Duplicated from the
 * validator deliberately: an unknown keyword has to become a diagnostic here,
 * not a validation failure that takes a whole capture down.
 */
const BLEND_MODES = new Set([
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference',
  'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'plus-lighter',
])

/** Past this a background asset is worth reporting; it is still embedded. */
const BIG_ASSET_BYTES = 8 * 1024 * 1024

const EXT_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', svgz: 'image/svg+xml',
  bmp: 'image/bmp', ico: 'image/x-icon',
}

/**
 * Warnings that report WORK DONE rather than fidelity lost. They still become
 * diagnostics — the document says what happened — but they must not degrade the
 * node, or a capture that succeeded would grade itself down for succeeding.
 */
const INFORMATIONAL = [
  /have been copied into it\.$/,
  /were inlined as data URIs\.$/,
  // CSS itself ignores the declaration, so the capture matches the page exactly.
  // Nothing was lost; the reader still gets told why the property had no effect.
  /is ignored by CSS/,
]

/**
 * Structural approximations: the cases where the contract says the CALLER
 * composes several primitives and v0 does not. Each gets its own code so the
 * count is readable in the grouped log and greppable in `diagnostics`.
 */
const COMPOSE_CASES = [
  {
    test: /border sides differ/,
    code: 'compose.border-sides',
    note: 'per-side border colors ride on one stroke (the first visible side wins); ' +
      'one shape per side is not composed in v0',
  },
  {
    test: /background layers use more than one clip box/,
    code: 'compose.background-clip',
    note: 'the background layers stay on one node; splitting them per clip box is not done in v0',
  },
  {
    test: /outline is emitted as a sibling stroke/,
    code: 'compose.outline',
    note: 'the outline stays on this node as an outside-aligned stroke instead of becoming a ' +
      'sibling painted last in the parent z-order',
  },
]

/**
 * Loss keywords, in priority order: the first match decides the grade.
 *
 * LAST RESORT ONLY. A collector that knows what it lost says so with a grade
 * (see `classify`), and this list is what is left for the ones that still return
 * bare prose. Reading a grade off English is guessing, so the patterns are
 * anchored to what a message can only mean:
 *
 *  - `R` needs an actual rasterization VERB. The old pattern matched a bare
 *    `/canvas/i`, which graded *"the canvas rejected the font shorthand … metrics
 *    were measured with a generic sans-serif"* as R — a wholly vector text node
 *    counted as raster in `report.grades`, against a product whose claim is zero
 *    raster. A measuring canvas is not a rasterized node.
 *  - `O` needs something to be gone. `is ignored` used to be here and matched
 *    *"object-fit … is ignored by CSS"*, where nothing is missing at all — it is
 *    informational now.
 */
const GRADE_PATTERNS = [
  {
    // Every message that really means "pixels now" carries one of these verbs.
    // The word `canvas` is deliberately absent: this engine MEASURES with a
    // canvas (font metrics, colour resolution) far more often than it rasterizes
    // with one, and those two must never share a grade.
    test: /\brasteriz|\bre-encoded\b|\breadback\b|\bread back\b|current frame/i,
    grade: 'R',
  },
  {
    test: /dropped|placeholder|not applied|not represented|not emitted|not captured|omitted|left out|could not be read|could not be fetched|unreachable|no pixels|with no data/i,
    grade: 'O',
  },
]

const SEVERITY_OF = { E: 'info', A: 'info', C: 'info', R: 'warn', RH: 'warn', O: 'warn' }

/** The three the schema accepts; anything else a collector offers is ignored. */
const SEVERITIES = new Set(['info', 'warn', 'error'])

const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1)

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/** Worst grade wins: a node that is both approximate and omitted is omitted. */
function degradeNode (node, grade, note) {
  if (!node || !hasOwn(GRADE_RANK, grade)) return
  if (!node.fidelity) node.fidelity = { grade: 'E', notes: [] }
  if (!Array.isArray(node.fidelity.notes)) node.fidelity.notes = []
  if (GRADE_RANK[grade] > GRADE_RANK[node.fidelity.grade]) node.fidelity.grade = grade
  if (note && !node.fidelity.notes.includes(note)) node.fidelity.notes.push(note)
}

function escapeIdent (value) {
  if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') return CSS.escape(value)
  return String(value).replace(/([^\w-])/g, '\\$1')
}

/**
 * A selector that finds the capture root again in the page it came from. It
 * stops at the first ancestor carrying an id, because everything above that is
 * noise to whoever reads `capture.selector`.
 */
function cssSelector (el) {
  if (!el || el.nodeType !== 1) return ''
  const parts = []
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    if (n.id) {
      parts.unshift(`#${escapeIdent(n.id)}`)
      break
    }
    const tag = n.tagName.toLowerCase()
    const parent = n.parentElement
    if (!parent) {
      parts.unshift(tag)
      break
    }
    let i = 1
    for (const sib of parent.children) {
      if (sib === n) break
      i++
    }
    parts.unshift(`${tag}:nth-child(${i})`)
  }
  return parts.join(' > ')
}

/**
 * Ids are issued at CALL time, not at registration time: `collectImage` runs
 * concurrently, so two sources with the same file name would both be handed
 * `a_logo` if the set were only updated once the asset came back. Same
 * convention as `collect/image.js`, whose helper is not exported.
 */
function nextAssetId (ctx, seed) {
  const used = ctx.assets || {}
  const taken = (id) => ctx.assetIds.has(id) || hasOwn(used, id)
  let id = `a_${seed}`
  let n = 1
  while (taken(id)) id = `a_${seed}_${n++}`
  ctx.assetIds.add(id)
  return id
}

function seedFromUrl (url, fallback) {
  if (!url || url.startsWith('data:')) return fallback
  const clean = String(url).split(/[?#]/)[0]
  const name = clean.slice(clean.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')
  const safe = name.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 24)
  return safe || fallback
}

// ——— the capture context ———

/**
 * @typedef {object} CollectCtx
 * @property {'design'|'replica'} mode
 * @property {(el: Element) => CSSStyleDeclaration} styleOf memoised computed styles
 * @property {{x:number,y:number,w:number,h:number}} rootRect viewport rect of the capture root
 * @property {Map<string,{ascent:number,descent:number,ok:boolean}>} metrics by full font string
 * @property {CanvasRenderingContext2D|null} measureCtx one reusable 2D context
 * @property {(prefix: string) => string} nextId the capture's id counter
 * @property {Array<{code:string,node:(string|undefined),message:string}>} warnings
 */

/**
 * @param {Element} rootEl  the MOUNTED CLONE root — everything the collectors
 *   read comes off this tree, including `rootRect`, which is the origin `abs` is
 *   expressed against. It is the clone's rect and not the live one on purpose:
 *   both sides are relative to their own root, so the offscreen mount offset
 *   cancels, and mixing the two would offset the whole document by ~99999px.
 * @param {object} options
 */
function makeCtx (rootEl, options) {
  const rect = rootEl.getBoundingClientRect()
  const cache = new WeakMap()
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
  const measureCtx = canvas ? canvas.getContext('2d') : null
  let seq = 0

  const ctx = {
    mode: options.mode === 'replica' ? 'replica' : 'design',
    rootEl,
    rootRect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },

    styleOf (el) {
      let cs = cache.get(el)
      if (!cs) {
        cs = getComputedStyle(el)
        cache.set(el, cs)
      }
      return cs
    },

    metrics: new Map(),
    measureCtx,

    /**
     * Ascent/descent for one EXACT font string, cached on that string and never
     * on the family: Chromium rounds `fontBoundingBox*` to integers per size, so
     * a 12px ascent scaled down from a 16px measurement can be a whole pixel out.
     * `ok:false` means the context refused the shorthand and kept its previous
     * font — the numbers describe some other font and must not be used.
     */
    measureFont (fontCss) {
      const hit = ctx.metrics.get(fontCss)
      if (hit) return hit
      let out = { ascent: 0, descent: 0, ok: false }
      if (measureCtx) {
        measureCtx.font = fontCss
        if (measureCtx.font) {
          const m = measureCtx.measureText('Hxg')
          out = {
            ascent: Number.isFinite(m.fontBoundingBoxAscent) ? m.fontBoundingBoxAscent : 0,
            descent: Number.isFinite(m.fontBoundingBoxDescent) ? m.fontBoundingBoxDescent : 0,
            ok: true,
          }
        }
      }
      ctx.metrics.set(fontCss, out)
      return out
    },

    /** The capture's one id counter, for anything not content-addressed. */
    nextId: (prefix) => `${prefix}_${seq++}`,

    warnings: [],

    // Filled in once the document exists; `collect/image.js` reads both.
    assets: null,
    assetIds: new Set(),
    assetCache: new Map(),

    maxNodes: Number.isFinite(options.maxNodes) ? options.maxNodes : 20000,
    maxDepth: Number.isFinite(options.maxDepth) ? options.maxDepth : 256,
    maxDiagnosticsPerCode: Number.isFinite(options.maxDiagnosticsPerCode)
      ? options.maxDiagnosticsPerCode
      : 100,
    exclude: options.exclude,
    fetchTimeout: Number.isFinite(options.fetchTimeout) ? options.fetchTimeout : 8000,
    maxAssetBytes: Number.isFinite(options.maxAssetBytes) ? options.maxAssetBytes : BIG_ASSET_BYTES,

    // OFF, and not an option. `paint.js` uses this to probe `getComputedStyle(el,
    // '::before')` and declare generated content out of scope — which was true
    // when the walk was over the live DOM and is false now: snapdom materialises
    // `::before`/`::after`/`::first-letter` into real elements with real boxes,
    // so they arrive as ordinary nodes and are collected like any other. Probing
    // the clone would report a loss that did not happen, on top of the node that
    // represents the thing it claims is missing.
    //
    // What the clone does NOT materialise says so under its own code:
    // `B4.list-marker` for a `::marker` (snapdom keeps it as a native marker, and
    // a native marker has no element for the collectors to read), and
    // `capture.pseudo-not-materialised` below for a painting pseudo that snapdom
    // was asked for and did not produce.
    pseudo: false,
  }
  return ctx
}

// ——— warnings -> diagnostics + fidelity ———

/**
 * One collector warning becomes exactly one diagnostic and one grade.
 *
 * **The grade belongs to the collector.** It is the only place that knows
 * whether a message means "I approximated this" or "this is gone", so a warning
 * may be `{code, grade, message}` and that grade is used verbatim. Bare strings
 * are still accepted — `box` and `text` still speak prose — and only those fall
 * through to `GRADE_PATTERNS`, which is a heuristic and says so. The fallback is
 * deliberately pessimistic: an unrecognised warning grades `A`, so an
 * approximation nobody anticipated is still declared.
 *
 * `image` sets a grade on the fill as well, and `applyImage` declares that
 * separately; worst-wins makes the two agree.
 *
 * @param {string} source     collector name, for the default code
 * @param {string} message
 * @param {string|null} declared  the collector's own grade, when it gave one
 * @param {string|null} code      the collector's own code, when it gave one
 */
function classify (source, message, declared, code) {
  const fallback = code || `collect.${source}`
  for (const rule of COMPOSE_CASES) {
    if (rule.test.test(message)) {
      return { code: code || rule.code, grade: declared || 'A', note: rule.note }
    }
  }
  if (declared) return { code: fallback, grade: declared, note: null }
  for (const rule of INFORMATIONAL) {
    if (rule.test(message)) return { code: fallback, grade: 'E', note: null }
  }
  for (const rule of GRADE_PATTERNS) {
    if (rule.test.test(message)) return { code: fallback, grade: rule.grade, note: null }
  }
  return { code: fallback, grade: 'A', note: null }
}

/**
 * Record one degradation: a `diagnostics` entry, a `warnings` entry for the
 * grouped log, and the grade on the node. Every path that loses something goes
 * through here — there is no other way to write a diagnostic in this file.
 */
function report (st, nodeId, code, grade, message, severity) {
  const entry = { code, severity: severity || SEVERITY_OF[grade] || 'warn', message }
  if (nodeId) entry.node = nodeId
  st.doc.diagnostics.push(entry)
  st.ctx.warnings.push({ code, node: nodeId, message })
  if (nodeId && grade !== 'E') degradeNode(st.doc.nodes[nodeId], grade, message)
  return entry
}

/**
 * One collector warning, in either shape the collectors speak.
 *
 * @param {object} st
 * @param {string|undefined} nodeId
 * @param {string} source
 * @param {string|{code?:string, grade?:string, message:string, severity?:string}} w
 */
function warn (st, nodeId, source, w) {
  const object = w && typeof w === 'object'
  const message = object ? w.message : w
  if (typeof message !== 'string' || !message) return
  const declared = object && hasOwn(GRADE_RANK, w.grade) ? w.grade : null
  const code = object && typeof w.code === 'string' && w.code ? w.code : null
  const severity = object && SEVERITIES.has(w.severity) ? w.severity : undefined
  const classified = classify(source, message, declared, code)
  const entry = report(st, nodeId, classified.code, classified.grade, message, severity)
  const note = classified.note
  if (note) entry.note = note
}

/**
 * `warnings` hanging off a collected paint, stroke or effect.
 *
 * `parseColor()` returns `{rgba, srcCss, warnings}` and every approximation it
 * measured lives in that array: an out-of-gamut colour mapped by chroma
 * reduction WITH its ΔEOK computed, or a translucent `oklch()`/`lab()`/`color()`
 * resolved through a canvas pixel and un-premultiplied from an 8-bit store.
 * Tailwind v4 puts `oklch()` on every colour in its palette, so dropping this
 * channel means a whole page of approximated colour exported at grade `E` with
 * the error already calculated and thrown away.
 *
 * The collectors forward it by hanging it on the object they built; this is the
 * receiving end. The array is consumed — it is a channel, not a document field.
 */
function foldWarnings (st, id, source, carriers) {
  for (const carrier of carriers || []) {
    if (!carrier || typeof carrier !== 'object') continue
    const list = carrier.warnings
    if (!Array.isArray(list)) continue
    delete carrier.warnings
    for (const w of list) warn(st, id, source, w)
  }
}

// ——— box ———

const isWeightList = (v) => Array.isArray(v) && v.length === 4 && v.every(Number.isFinite)

function normalizeStrokes (strokes, warnings) {
  const out = []
  for (const stroke of strokes || []) {
    if (!stroke) continue
    const next = { ...stroke }
    // `collect/box.js` still speaks per-side `weights`; the schema's field is
    // `weight`, scalar when the four sides agree so a backend without per-side
    // support does not have to compare four numbers to find out they are the
    // same. A stroke that already arrives schema-shaped is left alone, so this
    // becomes a no-op the day the collector emits `weight` itself — and the
    // collector's spelling is REMOVED either way, because two emitters currently
    // carry a `|| stroke.weights` fallback for a private dialect that has no
    // business leaving the collector.
    if (!Number.isFinite(next.weight) && !isWeightList(next.weight)) {
      if (isWeightList(next.weights)) {
        const [t, r, b, l] = next.weights
        next.weight = (t === r && r === b && b === l) ? t : next.weights.slice()
      } else {
        warnings.push('a stroke arrived with no weight and was dropped.')
        continue
      }
    }
    delete next.weights
    if (!next.align) next.align = 'inside'
    out.push(next)
  }
  return out
}

/** Everything `collectBox` found, mapped onto the node's schema fields. */
function applyBox (st, id, node, box) {
  const extra = []
  node.fills = Array.isArray(box.fills) ? box.fills : []
  node.strokes = normalizeStrokes(box.strokes, extra)
  node.effects = Array.isArray(box.effects) ? box.effects : []
  node.clip = box.clip || null
  // `clip-path` is not `clip`: the overflow clip only cuts descendants, this one
  // also cuts the node's own background, border and shadow. It travels as its
  // own field for that reason.
  if (box.clipShape) node.clipShape = box.clipShape
  if (box.radii) node.radii = box.radii
  node.opacity = clamp01(box.opacity)
  if (typeof box.blend === 'string' && BLEND_MODES.has(box.blend)) node.blend = box.blend
  // `collectBox` reads the `mask-image` layers with the same grammar backgrounds
  // use, and then had nowhere to put them: the schema's `mask` is a REFERENCE to
  // another node, and a paint is not a node. That gap is why a masked box came
  // out as a full rectangle with a warning attached. The layers are parked here
  // and `wireMasks` turns each set into the node the reference needs, once the
  // whole tree exists and a free id can be chosen.
  if (box.mask && Array.isArray(box.mask.layers) && box.mask.layers.length) {
    st.masks.push({ id, mask: box.mask })
  }

  for (const message of box.warnings || []) warn(st, id, 'box', message)
  for (const message of extra) warn(st, id, 'box', message)
  // Whatever `parseColor`/`parseShadows` measured and hung on the paint itself.
  foldWarnings(st, id, 'box', node.fills)
  foldWarnings(st, id, 'box', node.strokes)
  foldWarnings(st, id, 'box', node.strokes.map((s) => s && s.paint))
  foldWarnings(st, id, 'box', node.effects)
}

// ——— text ———

/**
 * Text styles are deduplicated across the whole document: `collectText` numbers
 * them `ts_0..ts_n` per BLOCK, so keeping its ids would have every block after
 * the first overwrite the styles of the one before it.
 *
 * The shape changes too — the schema's key is `size`, not `fontSize` — which is
 * the one place the orchestrator translates rather than forwards.
 *
 * `warnings` on the style (the colour `parseColor` could only approximate, for
 * one) are collected into `sink` rather than stored: they belong to the node
 * that uses the style, and the caller is the only one holding its id.
 */
function registerTextStyle (st, style, sink) {
  if (Array.isArray(style.warnings)) for (const w of style.warnings) sink.push(w)
  const svd = {
    // `family` is the family that PAINTED, resolved out of the stack by
    // `collect/text.js`, and `stack` carries it in front of the page's own list —
    // a font picker reads one name, never a stack. The rest of the resolution
    // travels with it because a consumer has to know how good the name is:
    // `cssFamily` is what `@font-face` calls the same face, `styleName` the
    // subfamily its binary claims (`SemiBold`), `referenceable` false when the
    // winner is a system keyword no picker can be handed.
    family: style.family,
    stack: style.fontFamily,
    cssFamily: style.cssFamily || style.family,
    stackCss: style.stackCss || style.fontFamily,
    styleName: style.resolvedStyleName || null,
    resolvedFrom: style.resolvedFrom || null,
    genericClass: style.genericClass || null,
    referenceable: style.referenceable !== false,
    webfont: style.webfont === true,
    size: style.fontSize,
    weight: style.fontWeight,
    italic: /^(italic|oblique)/.test(style.fontStyle || ''),
    fontStyle: style.fontStyle,
    stretch: style.fontStretch,
    variant: style.fontVariant,
    features: style.fontFeatureSettings,
    variations: style.fontVariationSettings,
    letterSpacing: style.letterSpacing,
    wordSpacing: style.wordSpacing,
    lineHeight: style.lineHeight,
    case: style.textTransform,
    fills: [{ type: 'solid', color: style.color, srcCss: style.colorCss }],
    decoration: style.decorations && style.decorations.length ? style.decorations : null,
    strokeWidth: style.strokeWidth,
    strokeColor: style.strokeColor || null,
    ascent: style.ascent,
    descent: style.descent,
    fontCss: style.fontCss,
  }
  const key = JSON.stringify(svd)
  let id = st.textStyleIds.get(key)
  if (!id) {
    id = `ts_${st.textStyleIds.size}`
    st.textStyleIds.set(key, id)
    st.doc.styles.text[id] = svd
  }
  return id
}

/**
 * A `text` node whose block turned out to paint no characters. It cannot stay a
 * text node — the schema requires non-empty `characters`, and rightly: a text
 * node with nothing in it is a hole in the export nobody would notice. So it
 * becomes a plain box if it paints anything, and disappears if it does not.
 *
 * When it disappears the diagnostic must NOT name it: `applyDrops` deletes every
 * entry naming a node that no longer exists, so an entry naming this one would
 * take the only record of the block with it. The element's DOM path goes in the
 * message instead, which is what someone reading the report needs anyway.
 */
function demoteTextNode (st, id, node, why, code = 'collect.text-empty') {
  const paints = (node.fills && node.fills.length) || (node.strokes && node.strokes.length) ||
    (node.effects && node.effects.length) || node.clip || node.transform ||
    (node.children && node.children.length)
  const where = (node.source && node.source.path) || node.name || id
  if (!paints && id !== st.doc.root) {
    st.dropped.add(id)
    report(st, null, code, 'E', `${where}: ${why}; the text node was pruned.`,
      code === 'collect.text-empty' ? 'info' : 'warn')
    return
  }
  node.type = node.fills && node.fills.length ? 'frame' : 'group'
  node.text = null
  report(st, id, code, 'O', `${why}; the node keeps its box and loses its text.`)
}

function collectTextInto (st, id, node, cs) {
  let out = null
  try {
    out = collectText(node.el, st.ctx)
  } catch (error) {
    // The reason travels INSIDE the demotion, not alongside it: a separate entry
    // naming this node is deleted with the node on the pruning path, and a text
    // block that vanished because a collector threw is the last thing that may
    // go unrecorded.
    demoteTextNode(st, id, node,
      `the text of this block could not be measured — collectText threw: ${error && error.message}`,
      'collect.text-failed')
    return
  }
  if (!out || !out.characters) {
    demoteTextNode(st, id, node, 'no painted characters were found in this block')
    return
  }

  const styleIds = {}
  const styleWarnings = []
  for (const local of Object.keys(out.styles || {})) {
    styleIds[local] = registerTextStyle(st, out.styles[local], styleWarnings)
  }
  for (const w of styleWarnings) warn(st, id, 'text', w)
  const runs = []
  for (const run of out.runs || []) {
    const styleId = styleIds[run.style]
    if (!styleId) continue
    // `dy` is the measured offset of a raised/lowered run from its line's
    // baseline (sup/sub, `vertical-align`). It is a MEASUREMENT, not a hint: the
    // fold that put the run on this line already removed it from the baseline,
    // so dropping it here is the difference between H₂O and H2O.
    runs.push({
      start: run.start,
      end: run.end,
      style: styleId,
      href: run.href || null,
      dy: Number.isFinite(run.dy) ? run.dy : 0,
    })
  }
  if (!runs.length) {
    demoteTextNode(st, id, node, 'the block has characters but no styled runs')
    return
  }

  // The schema requires a positive pitch: a backend that steps by it would stack
  // every line on one baseline otherwise. A block with a single visual line has
  // no baseline difference to measure, and `collectText` already says so in its
  // own warnings — this only covers the case where even the fallback was zero.
  let pitch = out.pitch
  if (!(pitch > 0)) {
    const first = out.lines && out.lines[0]
    const box = first ? (first.asc || 0) + (first.desc || 0) : 0
    pitch = box > 0 ? box : (st.doc.styles.text[runs[0].style].size || 1)
    warn(st, id, 'text',
      `the measured baseline pitch was ${out.pitch}; it was replaced by ${pitch.toFixed(2)}px ` +
      'taken from the line box, which is not a measurement of the line spacing.')
  }

  const style = st.doc.styles.text[runs[0].style]
  node.type = 'text'
  node.text = {
    characters: out.characters,
    sourceText: out.sourceText,
    lines: out.lines,
    runs,
    pitch,
    align: out.align,
    direction: out.direction,
    letterSpacing: style.letterSpacing,
    wordSpacing: style.wordSpacing,
    // Visual lines are joined with LSEP, so the block is ONE paragraph by
    // construction and nothing downstream may add paragraph spacing to it.
    paragraphSpacing: 0,
  }
  for (const message of out.warnings || []) warn(st, id, 'text', message)

  // `text-shadow` paints the glyphs, and this node IS the glyphs — but nothing
  // on the text path collects it and `node.effects` would follow the box
  // silhouette even if it did. `collect/box.js` covers the elements that also
  // carry box paint (it hands the parsed shadows over on `textEffects`, which
  // `applyBox` still drops) and says in as many words that the block whose only
  // content is text "never reaches collectBox" — that half is here. Without
  // this, a shadowed heading exports with no effect and no entry at all: the
  // export looks clean and is wrong, which is the one outcome this format exists
  // to prevent.
  const shadow = cs && cs.textShadow
  if (shadow && shadow !== 'none') {
    report(st, id, 'collect.text-shadow-dropped', 'O',
      `text-shadow "${shadow}" paints these glyphs and is not emitted: no backend here carries a ` +
      'shadow on text, so the letters export flat.')
  }
}

// ——— replaced content ———

/**
 * The image paint goes ON TOP of whatever `collectBox` found: in CSS the
 * replaced content paints above the element's own backgrounds and below its
 * borders, and `fills` runs back to front.
 */
function applyImage (st, id, node, result) {
  const { asset, fill, warnings } = result
  st.doc.assets[asset.id] = asset
  node.fills = [...(node.fills || []), fill]
  if (asset.kind === 'vector' && node.type === 'image') node.type = 'vector'

  // A vector asset carries `markup`, never `data` — the whole point of the SVG
  // path is that it is NOT bytes. The image fill can only ever be an `<image>`
  // pointing at a data URI, so leaving it in `fills` bought one
  // `emit.svg.image-no-data` per icon and painted nothing at all. `node.svg` is
  // the field both emitters already read (`emit/svg-flat.js` `emitVector`,
  // `emit/figma-json.js:1270`); nothing ever wrote it, which is why every inline
  // SVG in `demo/challenges.html#fx-svg` came out as an empty group.
  //
  // The placement travels with it because the markup is in the asset's own
  // natural units and the fill is what knows where those land: `crop` is the
  // source-pixel window `object-fit`/`object-position` selected and `transform`
  // maps the unit square of that crop onto the node's box. For an inline `<svg>`
  // that reduces to a translate; for `<img src=*.svg>` it is what makes
  // `object-fit: cover` crop instead of stretch.
  if (asset.kind === 'vector' && typeof asset.markup === 'string' && asset.markup) {
    node.svg = asset.markup
    node.svgPlacement = { crop: fill.crop, transform: fill.transform, clipBox: fill.clipBox }
    // The namespace the collector minted travels with the markup: one asset can
    // reach two nodes (assets are cached by URL, so one icon used twice is one
    // asset used twice), and the emitter has to rename the second copy's ids.
    if (typeof asset.idPrefix === 'string' && asset.idPrefix) node.svgPrefix = asset.idPrefix
    node.fills = node.fills.filter((f) => f !== fill)
  }

  // MathML's SVG contains native text without SVD text nodes. Register its
  // painted font uses so they share the ordinary font embedding/diagnostics
  // pass, including unicode-range checks. These references stay in the
  // assembly state; the resulting font assets are all the emitter needs.
  for (const style of result.fontStyles || []) {
    const sink = []
    const sid = registerTextStyle(st, style, sink)
    st.markupTextUses.push({ nodeId: id, style: sid, characters: style.characters || '' })
    for (const warning of sink) warn(st, id, 'text', warning)
  }

  for (const message of warnings || []) warn(st, id, 'image', message)
  foldWarnings(st, id, 'image', [fill])

  // The grade travels on the fill, and some of the paths that set it emit no
  // warning at all (a clean canvas readback is grade R and says nothing). An
  // undeclared grade is exactly what the schema rejects, so it is declared here.
  if (fill.grade && fill.grade !== 'E') {
    const notes = (fill.notes || []).join(', ')
    report(st, id, 'collect.image-grade', fill.grade,
      `replaced content graded ${fill.grade}${notes ? ` (${notes})` : ''}.`)
  }
}

// ——— background images ———

function bytesToBase64 (bytes) {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function absoluteUrl (url) {
  try {
    return new URL(url, typeof location !== 'undefined' ? location.href : undefined).href
  } catch {
    return url
  }
}

function mimeFromUrl (url) {
  const m = /\.([a-z0-9]+)(?:$|[?#])/i.exec(String(url).split(/[?#]/)[0])
  return (m && EXT_MIME[m[1].toLowerCase()]) || ''
}

async function fetchBytes (url, timeout) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller && timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null
  try {
    // force-cache: the page already downloaded this image, so the HTTP cache
    // should answer without a second trip to the network.
    const res = await fetch(url, {
      signal: controller ? controller.signal : undefined,
      cache: 'force-cache',
    })
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    const declared = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    const mime = declared && declared !== 'application/octet-stream'
      ? declared
      : (mimeFromUrl(url) || 'application/octet-stream')
    return { bytes, mime }
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Intrinsic size of an image source. It is loaded rather than fetched because
 * `naturalWidth/Height` are the only numbers that agree with what CSS sized the
 * layer against, and a cross-origin image still reports them — only its PIXELS
 * are unreadable.
 */
function intrinsicSize (src) {
  return new Promise((resolve) => {
    if (typeof Image !== 'function' || !src) {
      resolve(null)
      return
    }
    const img = new Image()
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    img.onload = () => done({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 })
    img.onerror = () => done(null)
    img.src = src
    if (img.complete && img.naturalWidth) done({ w: img.naturalWidth, h: img.naturalHeight })
  })
}

/**
 * One `background-image: url(...)` layer as an embedded asset.
 *
 * Invariant 7 says nothing may be external, so the bytes are fetched and
 * inlined. When they are unreachable — a cross-origin CDN with no CORS header is
 * the common case — the asset keeps its URL, carries no data, and says so: an
 * export that silently references a URL nobody downstream can read is exactly
 * the failure this format exists to make visible.
 *
 * **An SVG is collected as markup, not as bytes.** `collectImage` has always
 * done that for `<img src="*.svg">`; a background layer took the other road and
 * became `<image href="data:image/svg+xml…">`, which Figma draws as nothing at
 * all (FIGMA_FINDINGS §6). Same rule, both roads, one asset shape: `kind:
 * 'vector'` with `markup` and `idPrefix`.
 *
 * @returns {Promise<{asset:object, warnings:object[], svgWarnings:string[],
 *   intrinsic:{w:number,h:number}|null}>} `svgWarnings` is bare prose in
 *   `collectImage`'s own voice, so the caller classifies it the way the same
 *   sentence is classified when an `<img>` produces it.
 */
async function loadBackgroundAsset (url, st) {
  const ctx = st.ctx
  const id = nextAssetId(ctx, seedFromUrl(url, 'bg'))
  const warnings = []
  const svgWarnings = []
  const fetched = await fetchBytes(url, ctx.fetchTimeout)

  const mime = fetched ? fetched.mime : (mimeFromUrl(url) || 'application/octet-stream')
  let data = null
  if (fetched) {
    if (fetched.bytes.length > ctx.maxAssetBytes) {
      warnings.push({
        grade: 'E',
        message: `background-image ${url} is ${(fetched.bytes.length / 1048576).toFixed(1)} MB and is embedded verbatim.`,
      })
    }
    data = `data:${mime};base64,${bytesToBase64(fetched.bytes)}`
  } else {
    warnings.push({
      grade: 'O',
      message: `background-image ${url}: the bytes could not be fetched (CORS or network); the asset is referenced by URL with no data.`,
    })
  }

  // The data URI is same-origin and cannot taint anything, so it is the better
  // source to measure; the original URL is the fallback when there is no data.
  const size = (await intrinsicSize(data)) || (await intrinsicSize(url))
  if (!size || !(size.w > 0) || !(size.h > 0)) {
    warnings.push({
      grade: 'A',
      message: `background-image ${url}: its intrinsic size could not be read, so the CSS sizing ` +
        'could not be resolved against it; the layer is sized to the positioning area instead.',
    })
  }

  const intrinsic = size && size.w > 0 && size.h > 0 ? size : null

  if (fetched && looksLikeSvg(fetched.bytes, url, mime)) {
    const vector = await svgBackgroundAsset(fetched.bytes, url, id, ctx, intrinsic, svgWarnings, ctx.fetchTimeout)
    if (vector) {
      // `origin` and the URL stay on the asset: the markup is the payload, but a
      // reader still has to be able to say where it came from.
      return { asset: { ...vector.asset, origin: 'original-bytes' }, warnings, svgWarnings, intrinsic }
    }
    warnings.push({
      grade: 'A',
      message: `background-image ${url} looks like an SVG but did not parse, so it stays raster bytes inside ` +
        'an <image>. A target that does not rasterize an SVG in an <image> (Figma, measured) draws nothing ' +
        'for this layer.',
    })
  }

  const asset = {
    id,
    kind: mime === 'image/svg+xml' ? 'vector' : 'bitmap',
    mime,
    w: size ? size.w : 0,
    h: size ? size.h : 0,
    src: url,
    origin: data ? 'original-bytes' : 'unresolved',
    data,
  }
  return { asset, warnings, svgWarnings, intrinsic }
}

/**
 * `collectBox` cannot place a `url()` layer: the intrinsic size is unknown until
 * the file loads, so it emits `asset: {pending:true, url}` and `rect: null` and
 * leaves both to us. One fetch per distinct URL, all of them in flight at once.
 */
async function resolveBackgroundAssets (st) {
  const pending = new Map()
  for (const id of Object.keys(st.doc.nodes)) {
    if (st.dropped.has(id)) continue
    for (const fill of st.doc.nodes[id].fills || []) {
      if (!fill || fill.type !== 'image') continue
      if (!fill.asset || typeof fill.asset !== 'object' || !fill.asset.pending) continue
      const url = absoluteUrl(fill.asset.url)
      if (!pending.has(url)) pending.set(url, [])
      pending.get(url).push({ id, fill })
    }
  }
  if (!pending.size) return

  await Promise.all([...pending].map(async ([url, uses]) => {
    let loaded
    try {
      loaded = await loadBackgroundAsset(url, st)
    } catch (error) {
      for (const use of uses) {
        report(st, use.id, 'assets.background-failed', 'O',
          `background-image ${url} could not be loaded: ${error && error.message}; the layer is dropped.`)
        const node = st.doc.nodes[use.id]
        node.fills = node.fills.filter((f) => f !== use.fill)
      }
      return
    }
    st.doc.assets[loaded.asset.id] = loaded.asset
    for (const use of uses) {
      use.fill.asset = loaded.asset.id
      if (!use.fill.rect && use.fill.placement) {
        use.fill.rect = resolveLayerRect(use.fill.placement, loaded.intrinsic)
      }
      for (const w of loaded.warnings) report(st, use.id, 'assets.background', w.grade, w.message)
      // The SVG path speaks `collectImage`'s prose, and `warn` grades a sentence
      // the same way whether an <img> or a background layer produced it — the
      // alternative is one message with two grades depending on where it came
      // from, which is how a diagnostic stops meaning anything.
      for (const w of loaded.svgWarnings || []) warn(st, use.id, 'image', w)
    }
  }))
}

// ——— filters the destination will not run: the opt-in PNG ———

/**
 * Device px per CSS px a filter raster is drawn at, and the largest side it may
 * reach. 2x is what a design tool's canvas wants; the cap is what stops a
 * full-page backdrop copy (fx-glass's frost is a copy of the whole capture root)
 * from becoming a 4000px PNG for a 130px panel.
 */
const FILTER_RASTER_SCALE = 2
const FILTER_RASTER_MAX_PX = 2048

/**
 * Bytes past which the 2x pass is thrown away and repainted at 1x — the same
 * shape, and the same number, as `TILE_RASTER_BYTES` in the emitter, and for the
 * same reason: density is chosen against the FILE, not assumed. Measured on
 * fx-glass, whose frost node is a copy of the whole capture root seen through a
 * 416×130 window: 2x is 230 kB of PNG, which the emitter writes twice (`href` and
 * `xlink:href`) and so 460 kB of a 14 kB document. 1x is a quarter of that on a
 * layer that is a 14px blur to begin with and has no detail to lose.
 */
const FILTER_RASTER_BYTES = 128 * 1024

/** Attributes the raster pass stamps on the mounted clone, and removes again. */
const RASTER_OFF = 'data-snapdom-vector-raster-off'
const RASTER_ON = 'data-snapdom-vector-raster-on'
const RASTER_UP = 'data-snapdom-vector-raster-up'
const RASTER_ROOT = 'data-snapdom-vector-raster-root'

/**
 * The isolation, and it is the whole trick.
 *
 * The raster has to be of ONE node's subtree, because it replaces one node's
 * subtree in the SVG — a crop of the mounted clone would carry whatever sits
 * behind it and paint it twice. Detaching the subtree and rendering it alone is
 * what snapdom does for a whole capture and it does not survive here: half these
 * nodes are `<th>`s, and a table cell outside its table lays out as something
 * else entirely. So the tree stays whole and everything except the target is
 * made INVISIBLE — `visibility` is the one property that hides an element's paint
 * while keeping every box where it was, and it is inheritable, so one rule on the
 * root and one on the target cover the whole document.
 *
 * `!important` is not decoration: snapdom's own per-node classes carry
 * `visibility: visible` for every element in the clone, and an ordinary rule
 * would lose to them.
 *
 * The ancestors are neutralised rather than refused. Everything above the target
 * — its transform, its opacity, its blend mode, its own filter — is applied AGAIN
 * by the SVG groups the `<image>` will sit inside, so leaving it in the pixels
 * would double it. Transform in particular has to go: `abs`, the coordinate this
 * whole placement is computed in, is defined as the border box with the transform
 * chain neutralised (`paint.js`), so a raster taken through that chain would not
 * land where the document says the node is. The target keeps its own filter (it
 * is the point) and loses its own transform (the SVG group still applies it).
 */
const RASTER_CSS =
  `[${RASTER_OFF}],[${RASTER_OFF}] *{visibility:hidden!important}` +
  `[${RASTER_ON}],[${RASTER_ON}] *{visibility:visible!important}` +
  `[${RASTER_UP}]{transform:none!important;opacity:1!important;mix-blend-mode:normal!important;` +
  'filter:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}' +
  `[${RASTER_ON}]{transform:none!important}` +
  `[${RASTER_ROOT}]{margin:0!important}` +
  'svg{overflow:visible}foreignObject{overflow:visible}'

/** Rect helpers, local to this pass: everything here is an axis-aligned box in `abs` px. */
const rectIntersect = (a, b) => {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const w = Math.min(a.x + a.w, b.x + b.w) - x
  const h = Math.min(a.y + a.h, b.y + b.h) - y
  return { x, y, w, h }
}

/**
 * The ancestors of `id`, nearest first, as node ids. Built from `children`
 * because the schema has no parent pointer and inventing one on the document
 * would be a field every consumer then has to be told to ignore.
 */
function ancestorsOf (doc, id, parents) {
  const chain = []
  for (let cur = parents.get(id); cur; cur = parents.get(cur)) {
    if (chain.includes(cur)) break
    chain.push(cur)
  }
  return chain.filter((cid) => isPlainObject(doc.nodes[cid]))
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * Shrink the raster box to what an ancestor's overflow clip will let through.
 *
 * Not an optimisation with a rounding error in it: the `<image>` is emitted
 * INSIDE the same clip groups, so anything the clip removes is invisible in both
 * forms and costs only bytes. It costs a great many — fx-glass's frost node is a
 * copy of the entire 470×320 capture root showing through a 416×130 window, and
 * without this the PNG is the whole root with 88% of it transparent.
 *
 * @param {object} doc
 * @param {string} id      the node being rasterized
 * @param {Map<string,string>} parents
 * @param {{x,y,w,h}} box  in the node's LOCAL px
 * @returns {{x,y,w,h}} the same box, clipped
 */
function clipToAncestors (doc, id, parents, box) {
  const node = doc.nodes[id]
  const origin = isPlainObject(node.abs) ? node.abs : { x: 0, y: 0 }
  let out = box
  for (const aid of ancestorsOf(doc, id, parents)) {
    const anc = doc.nodes[aid]
    const clip = isPlainObject(anc.clip) ? anc.clip : null
    if (!clip) continue
    const abs = isPlainObject(anc.abs) ? anc.abs : null
    const frame = isPlainObject(anc.frame) ? anc.frame : abs
    if (!abs || !frame) continue
    // The clip rect in the ancestor's own local px — `clip.rect` when it carries
    // one, its border box otherwise, which is what `emitClipShape` falls back to.
    const rect = isPlainObject(clip.rect)
      ? clip.rect
      : { x: 0, y: 0, w: Number(frame.w) || 0, h: Number(frame.h) || 0 }
    if (!(rect.w > 0) || !(rect.h > 0)) continue
    // Both boxes are transform-neutral, so `abs` deltas are the whole mapping.
    out = rectIntersect(out, {
      x: (abs.x - origin.x) + rect.x,
      y: (abs.y - origin.y) + rect.y,
      w: rect.w,
      h: rect.h,
    })
    if (!(out.w > 0) || !(out.h > 0)) return out
  }
  return out
}

/**
 * Everything the mounted clone needs to render on its own, once per export.
 *
 * `mountClone` deliberately injects only the FRONT half of snapdom's CSS into the
 * page — the per-node style snapshots would freeze used widths over the page's
 * own cascade and re-wrap text — so the style tag it leaves in `<head>` is not
 * enough to render the clone anywhere else. Inside a `foreignObject` there is no
 * page cascade at all, which is exactly the case snapdom itself builds for, so
 * the raster uses snapdom's full set: the base reset that neutralises the UA
 * stylesheet, the embedded faces, and the `.cN` snapshots.
 */
function rasterCss (handoff) {
  return `${handoff.baseCSS || ''}${handoff.fontsCSS || ''}${handoff.classCSS || ''}${RASTER_CSS}`
}

/**
 * One node's subtree, painted through its own filter, as PNG bytes.
 *
 * The clone is COPIED rather than moved: it is still mounted and still being
 * measured by everything after this. What goes into the `foreignObject` is that
 * copy plus the capture's whole CSS, and the geometry is snapdom's own
 * (`core/capture.js`): the container's padding carries a positive offset and the
 * `foreignObject`'s x/y carries a negative one, because Chrome does not paint
 * `foreignObject` overflow when it rasterizes an SVG as an image.
 *
 * @param {Element} cloneRoot  the mounted clone root
 * @param {Element} el         the element to isolate, inside it
 * @param {Element[]} up       `el` and its ancestors up to `cloneRoot`
 * @param {string} css
 * @param {{x,y,w,h}} box      the raster window in `abs` px (root border box origin)
 * @returns {Promise<{data: string, w: number, h: number, scale: number}|null>}
 */
async function paintFilterRaster (cloneRoot, el, up, css, box, want) {
  if (typeof document === 'undefined' || typeof Image !== 'function') return null
  const vbW = Math.max(1, Math.ceil(box.w))
  const vbH = Math.max(1, Math.ceil(box.h))
  const scale = Math.min(want, FILTER_RASTER_MAX_PX / Math.max(vbW, vbH))
  const outW = Math.max(1, Math.round(vbW * scale))
  const outH = Math.max(1, Math.round(vbH * scale))

  const offX = -box.x
  const offY = -box.y
  const padL = Math.max(0, offX)
  const padT = Math.max(0, offY)
  const foX = Math.min(0, offX)
  const foY = Math.min(0, offY)
  const foW = vbW - foX
  const foH = vbH - foY

  cloneRoot.setAttribute(RASTER_OFF, '')
  cloneRoot.setAttribute(RASTER_ROOT, '')
  for (const a of up) a.setAttribute(RASTER_UP, '')
  el.removeAttribute(RASTER_UP)
  el.setAttribute(RASTER_ON, '')
  let markup
  try {
    const svgNS = 'http://www.w3.org/2000/svg'
    const fo = document.createElementNS(svgNS, 'foreignObject')
    fo.setAttribute('x', String(foX))
    fo.setAttribute('y', String(foY))
    fo.setAttribute('width', String(foW))
    fo.setAttribute('height', String(foH))
    fo.style.overflow = 'visible'
    const style = document.createElement('style')
    style.textContent = css
    fo.appendChild(style)
    const container = document.createElement('div')
    container.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
    // The synthesized-node rules `mountClone` generates are scoped to the host
    // attribute, so the container has to BE the host or every invented node
    // (materialised pseudos, scroll wrappers) renders unstyled.
    container.setAttribute('data-snapdom-vector', 'clone-host')
    container.style.cssText =
      'all:initial;box-sizing:border-box;display:block;overflow:visible;' +
      `width:${foW}px;height:${foH}px` +
      ((padL || padT) ? `;padding:${padT}px 0 0 ${padL}px !important` : '')
    container.appendChild(cloneRoot.cloneNode(true))
    fo.appendChild(container)
    markup = `<svg xmlns="${svgNS}" width="${outW}" height="${outH}" viewBox="0 0 ${vbW} ${vbH}">` +
      `${new XMLSerializer().serializeToString(fo)}</svg>`
  } finally {
    cloneRoot.removeAttribute(RASTER_OFF)
    cloneRoot.removeAttribute(RASTER_ROOT)
    el.removeAttribute(RASTER_ON)
    for (const a of up) a.removeAttribute(RASTER_UP)
  }

  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const c2d = canvas.getContext('2d')
  if (!c2d) return null
  c2d.drawImage(img, 0, 0, outW, outH)
  const data = canvas.toDataURL('image/png')
  if (typeof data !== 'string' || !data.startsWith('data:image/png')) return null
  return { data, w: outW, h: outH, scale }
}

/**
 * `rasterFilters`, end to end.
 *
 * The emitter decides WHAT — `rasterFilterPlan` is the single predicate, so the
 * pass that paints and the pass that emits cannot hold two opinions about which
 * filters survive an import — and this decides whether a raster was possible at
 * all. A node it cannot paint keeps its vector form and its declaration; nothing
 * here silently leaves a node without either.
 *
 * It runs before the `el` back-references are dropped, which is the only window
 * in which the clone is both mounted and still attached to the document.
 */
async function rasterizeUnrunFilters (st, capture, handoff) {
  const doc = st.doc
  const parents = new Map()
  for (const id of Object.keys(doc.nodes)) {
    for (const kid of doc.nodes[id].children || []) parents.set(kid, id)
  }
  const targets = []
  for (const id of Object.keys(doc.nodes)) {
    if (st.dropped.has(id)) continue
    const plan = rasterFilterPlan(doc.nodes[id], doc.nodes)
    if (plan) targets.push({ id, plan, depth: ancestorsOf(doc, id, parents).length })
  }
  if (!targets.length) return
  // Outermost first, so the ancestor-already-baked test below is decidable in one
  // pass and never depends on `Object.keys` happening to be in tree order.
  targets.sort((a, b) => a.depth - b.depth)

  const css = rasterCss(handoff)
  const done = new Set()
  let rasterized = 0

  for (const { id, plan } of targets) {
    const node = doc.nodes[id]
    const el = node.el
    const why = plan.why.join('; ')
    // An ancestor already baked this subtree — the emitter stops at the outermost
    // raster and never reaches this node, so a second PNG of the same pixels would
    // be bytes nothing draws and a `report.raster` count of nodes that are not
    // separately rastered. It keeps its declaration; it just does not get its own
    // bitmap.
    if (ancestorsOf(doc, id, parents).some((aid) => done.has(aid))) continue
    if (!el || el.nodeType !== 1 || !el.isConnected) {
      report(st, id, 'raster.filter-unavailable', 'A',
        `rasterFilters could not rasterize this node (${why}): it has no element in the mounted clone. ` +
        'It keeps its vector form, and the filter is still declared as one the destination will not run.')
      continue
    }
    // The node's own transform is neutralised for the paint (the SVG group still
    // applies it), but a transform is only invertible for this if the emitter can
    // reproduce it — an unreadable one means the group applies nothing, and then
    // the raster and the vector disagree about where the node is.
    const readableTransform = node.transform === null || node.transform === undefined ||
      (isPlainObject(node.transform) && Array.isArray(node.transform.m) && node.transform.m.length === 6)
    if (!readableTransform) {
      report(st, id, 'raster.filter-unavailable', 'A',
        `rasterFilters could not rasterize this node (${why}): its transform is unreadable, so a raster ` +
        'taken with the transform chain neutralised could not be put back. It keeps its vector form.')
      continue
    }
    const local = clipToAncestors(doc, id, parents, plan.box)
    if (!(local.w > 0) || !(local.h > 0)) {
      report(st, id, 'raster.filter-unavailable', 'E',
        `rasterFilters had nothing to rasterize for this node (${why}): every pixel its filter reaches is ` +
        'outside an ancestor\'s overflow clip. Nothing is emitted for it either way.')
      continue
    }
    const abs = isPlainObject(node.abs) ? node.abs : { x: 0, y: 0 }
    const up = []
    for (let a = el; a && a !== capture.clone; a = a.parentElement) up.push(a)
    up.push(capture.clone)

    const pane = { x: abs.x + local.x, y: abs.y + local.y, w: local.w, h: local.h }
    let painted = null
    let failure = ''
    try {
      painted = await paintFilterRaster(capture.clone, el, up, css, pane, FILTER_RASTER_SCALE)
      // Density decided by what the pass COSTS, which is not knowable until it
      // has run — the same rule `rasterTiles` follows in the emitter.
      if (painted && painted.scale > 1 && painted.data.length > FILTER_RASTER_BYTES) {
        painted = (await paintFilterRaster(capture.clone, el, up, css, pane, 1)) || painted
      }
    } catch (error) {
      failure = (error && error.message) || String(error)
    }
    if (!painted) {
      report(st, id, 'raster.filter-failed', 'A',
        `rasterFilters could not rasterize this node (${why})${failure ? `: ${failure}` : ''}. It keeps its ` +
        'vector form, and the filter is still declared as one the destination will not run.')
      continue
    }

    const assetId = nextAssetId(st.ctx, `fx_${id}`)
    doc.assets[assetId] = {
      id: assetId,
      kind: 'bitmap',
      mime: 'image/png',
      w: painted.w,
      h: painted.h,
      origin: 'rasterized',
      data: painted.data,
    }
    node.filterRaster = { asset: assetId, box: local, scale: painted.scale, why: plan.why }
    done.add(id)
    // The grade is on the node here as well as in the emitter's own diagnostic,
    // because a document handed to `svdToFigma` or to the PDF backend carries the
    // same loss and never goes through `svdToSvg` to hear about it.
    report(st, id, 'raster.filter', 'R',
      `this node and its whole subtree are one ${painted.w}×${painted.h} PNG at ` +
      `${Math.round(painted.scale * 100) / 100}x, because ${why}.`)
    if (!rasterized++) {
      report(st, null, 'raster.filter', 'R',
        'rasterFilters is on, so every node whose filter the destination will not run — and only those — ' +
        'was painted from the MOUNTED CLONE, where snapdom has already pre-composed any backdrop-filter, ' +
        'over the filter\'s own region rather than the border box. Those subtrees are no longer editable ' +
        'anywhere — no text, no fills, no children, one bitmap each. ' +
        'AND IT DOES NOT ALWAYS LOOK BETTER: this trades a filter the destination drops for a bitmap it ' +
        'keeps, which wins only where the vector form was already wrong. Measured on these fixtures: the ' +
        'glass panel improved (its vector form was re-drawing by hand a backdrop-filter snapdom had ' +
        'already composed, 8.97 -> 7.38 mean px), while five table headers got WORSE (3.00 -> 3.04 ' +
        'overall, 8.93 -> 13.87 over the band that changed) because their inner-shadow chain already ' +
        'painted exactly in a browser and rasterising only resampled their text. Judge it per node, not ' +
        'per document. rasterFilters:false keeps the vector form and declares the loss instead. ' +
        'ONLY the flat-SVG backend reads these rasters: svdToFigma and the PDF backend do not know the ' +
        'field yet and emit these nodes\' vector paint, so a payload built through them carries the ' +
        'unfiltered node and not the bitmap — the loss this option buys back is bought back in ' +
        'toVectorSvg() and nowhere else.')
    }
  }
}

// ——— the walk over emitted nodes ———

/**
 * One node, one collector, per its type. Returns a promise only when the node
 * carries replaced content, so the caller can await them all together instead of
 * serialising one fetch per image.
 */
function collectNode (st, id, node) {
  const el = node.el
  if (!el) return null

  let cs
  try {
    cs = st.ctx.styleOf(el)
  } catch (error) {
    report(st, id, 'collect.style-failed', 'O',
      `the computed style of this element is unreadable: ${error && error.message}`)
    return null
  }

  // A text node's fills are the GLYPH fills in every backend, so it never takes
  // the box paint: `buildPaintTree` already split the block's box onto a parent
  // node wherever both exist.
  if (node.type === 'text') {
    collectTextInto(st, id, node, cs)
    return null
  }

  try {
    applyBox(st, id, node, collectBox(el, cs, st.ctx))
  } catch (error) {
    report(st, id, 'collect.box-failed', 'O',
      `collectBox threw on this element: ${error && error.message}; the node is emitted with no paint.`)
  }

  if (node.type !== 'image' && node.type !== 'vector') return null

  const isMath = el.localName === 'math' && el.namespaceURI === 'http://www.w3.org/1998/Math/MathML'
  return (isMath ? collectMathML(el, cs, st.ctx) : collectImage(el, cs, st.ctx))
    .then((result) => {
      if (result) {
        applyImage(st, id, node, result)
        return
      }
      // `<iframe>`, `<embed>`, `<object>` and `<input type=image>` reach here:
      // the paint tree types them as replaced content and no collector in v0
      // knows how to read their contents.
      report(st, id, 'collect.replaced-unsupported', 'O',
        `<${node.source && node.source.tag}> is replaced content v0 cannot read; the box is emitted empty.`)
    })
    .catch((error) => {
      report(st, id, isMath ? 'collect.mathml-failed' : 'collect.image-failed', 'O',
        `${isMath ? 'collectMathML' : 'collectImage'} threw on this element: ${error && error.message}; the box is emitted empty.`)
    })
}

// ——— assembly ———

/** Remove the nodes that collection pruned, and every reference to them. */
function applyDrops (st) {
  if (!st.dropped.size) return
  const { nodes } = st.doc
  for (const id of st.dropped) delete nodes[id]
  for (const id of Object.keys(nodes)) {
    const node = nodes[id]
    if (Array.isArray(node.children) && node.children.some((c) => st.dropped.has(c))) {
      node.children = node.children.filter((c) => !st.dropped.has(c))
    }
  }
  // A diagnostic naming a node that no longer exists is a validation error, and
  // the node it described is gone, so the entry goes with it.
  st.doc.diagnostics = st.doc.diagnostics.filter((d) => !(d.node && st.dropped.has(d.node)))
  for (const d of st.doc.diagnostics) {
    for (const key of ['from', 'to']) if (d[key] && st.dropped.has(d[key])) delete d[key]
    if (Array.isArray(d.overlaps)) d.overlaps = d.overlaps.filter((n) => !st.dropped.has(n))
  }
}

/**
 * A gradient that collapsed to a single stop is a flat colour, and the schema
 * requires two, so the stop is repeated at both ends — same paint, no loss.
 *
 * This function used to do a second job: rename every stop's `t` to `p`.
 * `css/gradient.js` has always emitted `t` and never emitted `p`, so `p` was a
 * spelling invented right here, in the one module that is supposed to forward
 * rather than translate. The contract now fixes the stop as `{t, color, srcCss}`
 * and `schema.js` validates `t`, so the rename is gone.
 *
 * Consumers read `stop.t`: `emit/svg-flat.js` (`readStops`), `emit/figma-json.js`
 * (`toPaint`) and `figma-plugin/code.js` (`gradientStops`).
 */
/**
 * Turns each set of collected `mask-image` layers into the node the schema's
 * `mask` reference needs, and points the masked node at it.
 *
 * The mask node hangs off the node it masks. It has to hang off SOMETHING — the
 * schema rejects a document with a node the root cannot reach, and rightly: an
 * unreachable node is one a backend can silently never emit. Being a child is
 * also what `emit/svg-flat.js` already assumes, since it filters mask targets out
 * of the children it paints. Its `abs` is the masked node's own, so the two
 * spaces coincide and the layer rects — already node-local, the same ones `fills`
 * use — need no translation at all.
 */
function wireMasks (st) {
  if (!st.masks.length) return
  for (const { id, mask } of st.masks) {
    const node = st.doc.nodes[id]
    if (!node || node.mask) continue
    let maskId = `${id}__mask`
    for (let n = 2; st.doc.nodes[maskId]; n++) maskId = `${id}__mask${n}`
    const frame = node.frame || node.abs
    st.doc.nodes[maskId] = {
      type: 'frame',
      name: `${node.name || id} mask`,
      // The mask paints in the masked node's OWN space: same origin, same size,
      // and `frame.x/y` are zero because `emitMask` has already translated by
      // the difference of the two `abs` boxes (here, zero).
      frame: { x: 0, y: 0, w: frame.w, h: frame.h },
      abs: { ...node.abs },
      paint: { z: 0, stackingContext: false },
      opacity: 1,
      radii: mask.radii || null,
      fills: mask.layers,
      strokes: [],
      effects: [],
      children: [],
      fidelity: { grade: 'E', notes: [] },
    }
    node.children = [...(node.children || []), maskId]
    node.mask = { node: maskId, type: mask.type === 'luminance' ? 'luminance' : 'alpha' }
    report(st, id, 'collect.box.mask-applied', 'A',
      `mask-image "${mask.srcCss}" is applied: its ${mask.layers.length} layer(s) are painted into node ` +
      `"${maskId}" and referenced as ${mask.type === 'luminance' ? 'a luminance' : 'an alpha'} mask over the ` +
      `${mask.clipBox} box. It is not exact — mask-composite is not modelled and the layers stack as "add", ` +
      'and a backend that cannot express a mask by reference (Figma flags a sibling instead) still has to ' +
      'build it. What is no longer true is that the box comes out rectangular.', 'info')
  }
}

function padGradients (st) {
  let padded = 0

  const fix = (paint) => {
    if (!paint || !Array.isArray(paint.stops) || paint.stops.length !== 1) return
    const only = paint.stops[0]
    paint.stops = [{ ...only, t: 0 }, { ...only, t: 1 }]
    padded++
  }

  for (const id of Object.keys(st.doc.nodes)) {
    const node = st.doc.nodes[id]
    for (const fill of node.fills || []) fix(fill)
    for (const stroke of node.strokes || []) fix(stroke && stroke.paint)
  }
  for (const id of Object.keys(st.doc.styles.text)) {
    for (const fill of st.doc.styles.text[id].fills || []) fix(fill)
  }

  if (padded) {
    st.doc.diagnostics.push({
      code: 'schema.gradient-stops-padded',
      severity: 'info',
      message: `${padded} gradient(s) had a single stop and it was repeated at both ends so the ` +
        'ramp is a flat colour rather than an invalid document. No colour or position was changed.',
    })
  }
}

// ——— fonts ———

/** Families CSS resolves itself; none of them can come from an `@font-face`. */
const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'math',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'fangsong',
  '-apple-system', 'blinkmacsystemfont',
])

const unquote = (v) => String(v == null ? '' : v).trim().replace(/^["']|["']$/g, '')

/**
 * The families this document's own page defines with `@font-face`.
 *
 * `document.fonts` is set-like and holds a CSS-connected `FontFace` for every
 * `@font-face` rule the page parsed, so membership answers exactly the question
 * that matters: is this family something the machine opening the export is
 * likely to have, or something the page shipped?
 *
 * Returns `null` when the API is not there — "I could not check" and "there is
 * nothing to declare" are different answers and must not share a return value.
 */
function webfontFamilies () {
  const set = typeof document !== 'undefined' ? document.fonts : null
  if (!set || typeof set.forEach !== 'function') return null
  const out = new Set()
  try {
    set.forEach((face) => {
      const name = unquote(face && face.family).toLowerCase()
      if (name && !GENERIC_FAMILIES.has(name)) out.add(name)
    })
  } catch {
    return null
  }
  return out
}

/**
 * What is STILL not embedded after `collect/font.js` ran, declared per family
 * and naming every node that uses it.
 *
 * The collector writes `style.font` for every `@font-face` face it could fetch
 * and cover, and each failure mode it hits is its own `assets.*` diagnostic —
 * so what reaches this function is what has no bytes to bring (a face whose
 * rule vanished, an uncovered subset, a failed fetch, or `embedFonts: false`).
 * For those the export carries the family NAME and gets whatever the viewer has
 * installed, and the loss compounds: their lines carry no `textLength`
 * (`measuredFontTravels` refuses to pin a substituted face), so a substitute
 * sets its own advances and the line widths are the viewer's.
 */
function declareFonts (st) {
  const { nodes, styles, diagnostics } = st.doc
  const styleIds = Object.keys(styles.text)
  if (!styleIds.length) return

  const faces = webfontFamilies()
  if (faces === null) {
    diagnostics.push({
      code: 'assets.font-embedding-unknown',
      severity: 'warn',
      message: 'this engine exposes no document.fonts, so whether the families in use come from ' +
        '@font-face could not be determined and none was embedded: the export names families ' +
        'and the viewer substitutes what it has.',
    })
    return
  }
  if (!faces.size) return

  // style id -> family, for the ones that are page-supplied. `cssFamily` is what
  // the `@font-face` rule calls this face and `family` may now be the name its
  // BINARY claims — `"Inter var"` against `Inter` — so the membership test is on
  // the first and the message names the second. Matching only on `family` stopped
  // recognising every renamed webfont, which is the exact case this exists for.
  const familyOf = new Map()
  for (const sid of styleIds) {
    const style = styles.text[sid]
    // A style whose face travels in `assets` is the solved case, not this one.
    if (typeof style.font === 'string' && style.font) continue
    const declared = unquote(style.cssFamily || style.family)
    if (declared && faces.has(declared.toLowerCase())) familyOf.set(sid, unquote(style.family) || declared)
  }
  if (!familyOf.size) return

  const used = new Map()
  for (const id of Object.keys(nodes)) {
    const node = nodes[id]
    if (node.type !== 'text' || !node.text || !Array.isArray(node.text.runs)) continue
    for (const run of node.text.runs) {
      const family = familyOf.get(run.style)
      if (!family) continue
      if (!used.has(family)) used.set(family, new Set())
      used.get(family).add(id)
    }
  }
  for (const use of st.markupTextUses) {
    const family = familyOf.get(use.style)
    if (!family) continue
    if (!used.has(family)) used.set(family, new Set())
    used.get(family).add(use.nodeId)
  }

  for (const [family, ids] of used) {
    const list = [...ids]
    diagnostics.push({
      code: 'assets.font-not-embedded',
      severity: 'warn',
      family,
      nodes: list,
      message: `"${family}" is served by an @font-face rule on this page and its bytes did not make ` +
        'it into the document (the assets.* diagnostics above say why, or embedFonts is off), so the ' +
        'export carries the family NAME and nothing else. On a machine without it the viewer ' +
        'substitutes another face with its own advances, and no line of it carries textLength ' +
        '(justified lines excepted — see emit.svg.text-justified-length): pinning a substitute to ' +
        'widths another font measured squeezes the glyphs.',
    })
    for (const id of list) {
      degradeNode(nodes[id], 'A', `the font "${family}" is referenced by name and not embedded`)
    }
  }
}

// ——— tracking, and what the destination will do with it ———

/** A font shorthand no caller passes, so a refused assignment is detectable. */
const FONT_SENTINEL = '1px serif'

/**
 * The advance of `text` in one font, or null when the context refused the
 * shorthand — which it does silently, keeping the font it had, so every width
 * measured after one would describe a font nobody asked for.
 */
function measureWidth (ctx, css, text) {
  const c = ctx.measureCtx
  if (!c || !text) return null
  c.font = FONT_SENTINEL
  c.font = css
  if (c.font === FONT_SENTINEL) return null
  const w = c.measureText(text).width
  return Number.isFinite(w) ? w : null
}

/** @param {string} familyCss  a family list, already CSS-ready — quoted if it needs to be */
function fontShorthand (style, familyCss) {
  const italic = style.italic ? 'italic ' : ''
  const weight = Number.isFinite(style.weight) ? Math.round(style.weight) : 400
  const size = Number.isFinite(style.size) && style.size > 0 ? style.size : 16
  return `${italic}${weight} ${size}px ${familyCss}`
}

let segmenter
/**
 * Typographic character units, which is what `letter-spacing` is added after —
 * NOT UTF-16 code units, and not code points either.
 *
 * MEASURED in Chromium (a span with and without `letter-spacing: 10px`, width
 * difference over 10): `🎯🌋👩🏽‍🚀🇪🇸🧑‍🚒` takes the spacing **5** times and is 11 code
 * points and 20 UTF-16 units; `áé👩🏽‍🚀x` takes it 4 times against 7 and 10. Counting
 * `string.length` would report four times the tracking on an emoji line — more
 * error than the whole effect being reported.
 */
function unitsOf (text) {
  if (!text) return 0
  if (segmenter === undefined) {
    try {
      segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
        ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        : null
    } catch {
      segmenter = null
    }
  }
  if (!segmenter) return [...text].length
  let n = 0
  for (const piece of segmenter.segment(text)) n += piece ? 1 : 0
  return n
}

/**
 * The line of a text block that loses the most to a destination ignoring
 * `letter-spacing`, and how much that is.
 *
 * The arithmetic is not an estimate: CSS adds the tracking after every character
 * of the line, so a target that drops it paints the line `|letterSpacing| ×
 * characters` narrower than it was measured — negative tracking WIDENS it by that
 * much, positive tracking narrows it, and either way the line no longer ends
 * where anything anchored to its end expects. Computed per line because runs on
 * one line can carry different tracking, and the worst line is what is reported:
 * an average would hide the one that overflows.
 */
function worstTrackedLine (text, textStyles) {
  const lines = Array.isArray(text.lines) ? text.lines : []
  const runs = Array.isArray(text.runs) ? text.runs : []
  const characters = typeof text.characters === 'string' ? text.characters : ''
  let worst = null
  let tracked = 0
  for (const line of lines) {
    let delta = 0
    let units = 0
    let dominant = null
    let dominantUnits = 0
    let spacing = 0
    for (const run of runs) {
      const from = Math.max(run.start, line.start)
      const to = Math.min(run.end, line.end)
      if (to <= from) continue
      const style = textStyles[run.style]
      if (!style) continue
      const n = unitsOf(characters.slice(from, to))
      if (n > dominantUnits) { dominantUnits = n; dominant = style }
      const ls = Number.isFinite(style.letterSpacing) ? style.letterSpacing : 0
      if (!ls) continue
      delta += Math.abs(ls) * n
      units += n
      if (Math.abs(ls) > Math.abs(spacing)) spacing = ls
    }
    if (!(delta > 0)) continue
    tracked++
    if (!worst || delta > worst.delta) worst = { line, delta, units, spacing, style: dominant }
  }
  if (worst) worst.lines = tracked
  return worst
}

/**
 * How much wider the same characters come out in the generic fallback of their
 * class than in the face the page actually painted them with. MEASURED on this
 * machine, where both faces are present, and never a constant: which face the
 * destination substitutes is its own business, but the ORDER of the error is the
 * distance between the real one and the generic its stack falls through to.
 *
 * The reference is the page's whole STACK, not the resolved family on its own,
 * and that is a measurement rather than a preference: MEASURED on this machine,
 * `bold 22px -apple-system` on a canvas is 397.24px where the same string laid
 * out by CSS is 425.72px and the canvas given the whole stack is 426.39px. A
 * system keyword on its own resolves to a different face in a canvas than it does
 * in layout, so measuring it alone would report a substitution that never
 * happened; the stack reproduces layout to 0.16%.
 */
function substitutionWidth (ctx, style, text) {
  const generic = typeof style.genericClass === 'string' && style.genericClass ? style.genericClass : 'sans-serif'
  const stack = typeof style.stackCss === 'string' && style.stackCss ? style.stackCss : style.stack
  const mine = measureWidth(ctx, fontShorthand(style, stack), text)
  const theirs = measureWidth(ctx, fontShorthand(style, generic), text)
  if (mine === null || theirs === null || !(mine > 0) || !(theirs > 0)) return null
  return { generic, mine, theirs, ratio: theirs / mine }
}

/**
 * The one loss this engine can measure exactly and no destination will honour.
 *
 * `letter-spacing` survives into the SVD and into the SVG, and Figma — VERIFIED by
 * pasting, `FIGMA_FINDINGS.md` §5 — drops it: the pasted node reports
 * `letter-spacing: 0`. Nothing here can force it, and four ways of trying are
 * written up as dead ends in that file. What is left is to say, before anyone
 * pastes, exactly how many px wider each line will arrive — and to add the second
 * half of the same sum when the family cannot travel either, because the reader
 * is looking at one line, not at two independent facts about it.
 */
function declareTracking (st) {
  const { nodes, styles } = st.doc
  for (const id of Object.keys(nodes)) {
    const node = nodes[id]
    if (node.type !== 'text' || !node.text) continue
    const worst = worstTrackedLine(node.text, styles.text)
    if (!worst) continue

    const { line, delta, units, spacing } = worst
    const style = worst.style || {}
    const text = typeof node.text.characters === 'string'
      ? node.text.characters.slice(line.start, line.end)
      : ''
    const excerpt = text.length > 46 ? `${text.slice(0, 46)}…` : text
    const width = Number.isFinite(line.w) && line.w > 0 ? line.w : 0
    // What the glyphs advance to on their own: the tracking comes OUT of the
    // measured line, because that is what a target dropping it is left holding.
    const untracked = width ? width + (spacing < 0 ? delta : -delta) : 0
    const signed = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}`
    const pct = (n, of) => `${n >= 0 ? '+' : '−'}${Math.abs(100 * n / of).toFixed(1)}%`

    const parts = [
      `this text is tracked and the target may well drop it — Figma does, verified by pasting: ` +
      `letter-spacing ${spacing}px over the ${units} character(s) of line ${line.i}` +
      `${worst.lines > 1 ? `, the worst of ${worst.lines} tracked lines,` : ''} is ${delta.toFixed(1)}px of ` +
      'advance that a target ignoring tracking never adds' +
      (width
        ? `: the line measures ${width.toFixed(1)}px here, its glyphs alone advance ${untracked.toFixed(1)}px, ` +
          `so it arrives ${signed(untracked - width)}px ${spacing < 0 ? 'wider' : 'narrower'} ` +
          `(${pct(untracked - width, width)})`
        : '') +
      `. The line is «${excerpt}».`,
    ]

    // The family is the other half of the same sum, and only when it really
    // cannot travel: a face the destination already has is not substituted.
    const travels = style.referenceable !== false && style.webfont !== true
    if (!travels) {
      const sub = substitutionWidth(st.ctx, style, text)
      const why = style.referenceable === false
        ? `"${style.family}" is a system keyword and not a font name — no picker can be handed it`
        : `"${style.family}" is served by an @font-face rule of this page and v0 embeds no font bytes`
      if (sub && Math.abs(sub.ratio - 1) > 0.001) {
        const wide = 100 * (sub.ratio - 1)
        const dest = untracked * sub.ratio
        parts.push(`Its family does not travel either: ${why}, so the destination substitutes. Measured on this ` +
          `machine, these same characters are ${sub.mine.toFixed(1)}px in the page's own stack and ` +
          `${sub.theirs.toFixed(1)}px in the ${sub.generic} it falls back to — ${wide >= 0 ? '+' : '−'}` +
          `${Math.abs(wide).toFixed(1)}% of glyph advance. Which face the destination picks is its own business — ` +
          'pasting this engine\'s SVG into Figma, it picked Inter and the line came out 6.1% wider, measured ' +
          'once and on one line — but that is the order of the error' +
          (untracked
            ? `, and on this line it puts the two together at about ${dest.toFixed(1)}px against the ` +
              `${width.toFixed(1)}px the page paints: ${signed(dest - width)}px, ${pct(dest - width, width)}`
            : '') + '.')
      } else {
        parts.push(`Its family does not travel either: ${why}, so the destination substitutes and the substitute ` +
          'sets its own advances' +
          (sub
            ? ' — how much could not be shown here, because the generic fallback of its class measures the same on this machine'
            : ' — how much could not be measured here') + '.')
      }
    }

    parts.push('Nothing is lost from THIS document — the tracking is in `styles.text` and on the emitted ' +
      'text — and nothing this engine can emit makes a target honour it: four ways of forcing it were tried ' +
      'against Figma and all four are written up as dead ends.')

    report(st, id, 'text.tracking-may-be-ignored', 'A', parts.join(' '), 'warn')
  }
}

// ——— the clone itself ———

/**
 * Past this the mount is not reproducing the live layout and every coordinate in
 * the document is measured against something the user never saw. In px, on the
 * MEDIAN — a single outlier is a node, a median is the mount.
 */
const DRIFT_LIMIT_PX = 1

/**
 * The mounted clone measured against the live element, as a diagnostic.
 *
 * This is the safety net for the whole architecture, so it is loud in both of its
 * failure modes and silent in neither: drift past the limit says so, and a mount
 * that could not be measured at all says THAT, because "no pairs" and "zero
 * drift" are different answers and only one of them is good news.
 *
 * The capture is not aborted either way. A drifted clone still produces a
 * document, and a document that declares its own drift is more useful than an
 * exception with the same information in it.
 */
function declareDrift (st, drift) {
  if (!drift) return
  const { pairs, median, p95, max } = drift
  // `measureDrift` now filters out the nodes that generate no box at all
  // (`<stop>`, `<option>`, `<clipPath>` …): subtracting two origins when one of
  // them is not a position was producing ~100.451px of "drift" that had nothing
  // to do with layout. The denominator below is therefore a FILTERED one, and a
  // fidelity number whose denominator is silently smaller than the tree is the
  // same class of lie this format exists to prevent — so it is stated.
  const skipped = Number.isFinite(drift.skipped) ? drift.skipped : 0
  const filtered = skipped
    ? ` ${skipped} clone node(s) generate no box on either side (no client rect at all — an SVG ` +
      '<stop>, an <option>, a display:none subtree) and are not comparable, so they are not in ' +
      'that count; a node with a box on ONE side is counted, because that is an element the ' +
      'export lost or invented.'
    : ''
  // Names for the offenders, so a drift warning points at an element instead of
  // asking the reader to go and find it.
  const worst = (drift.worst || []).slice(0, 3)
    .map((w) => `<${w.tag}${w.id ? '#' + w.id : ''}${w.cls ? '.' + w.cls.trim().split(/\s+/).join('.') : ''}> ` +
      `off by ${w.delta.toFixed(2)}px (clone ${w.clone}, live ${w.live})`)
  const blame = worst.length ? ` Worst: ${worst.join('; ')}.` : ''
  if (!pairs) {
    report(st, null, 'capture.clone-unverified', 'A',
      'not one clone node could be matched to a live element, so the mounted clone\'s layout was ' +
      'never checked against the layout it copies. Every coordinate in this document is measured ' +
      'on the clone and nothing here confirms the clone is right.' + filtered, 'warn')
    return
  }
  if (median > DRIFT_LIMIT_PX) {
    report(st, null, 'capture.clone-drift', 'A',
      `the mounted clone does not lay out like the element it copies: median ${median.toFixed(2)}px, ` +
      `p95 ${p95.toFixed(2)}px, max ${max.toFixed(2)}px over ${pairs} matched node(s), against a ` +
      `${DRIFT_LIMIT_PX}px limit. Every box, baseline and gradient in this document was measured on ` +
      'the clone, so they are all off by about that much.' + filtered + blame, 'warn')
    return
  }
  // The median is the mount and it is fine — but a median cannot see one node
  // that landed nowhere, and that is a whole element missing from the export
  // rather than a rounding error. The known cause is a custom element: mounting
  // the clone in the page CONNECTS it, the browser upgrades it, its
  // `connectedCallback` attaches a fresh shadow root, and the shadow content
  // snapdom had flattened into its light DOM stops being rendered. `paint.js`
  // sees the same thing from the other side and files `B4.unresolved-shadow-root`.
  if (max > DRIFT_LIMIT_PX) {
    report(st, null, 'capture.clone-drift-outlier', 'A',
      `the mounted clone lays out like its source overall (median ${median.toFixed(2)}px over ` +
      `${pairs} node(s)) but not everywhere: p95 ${p95.toFixed(2)}px, max ${max.toFixed(2)}px. A ` +
      'few nodes are somewhere else entirely, or have no box at all. The usual cause is a custom ' +
      'element upgrading when the clone is connected and hiding the shadow content snapdom ' +
      'flattened into it — look for `B4.unresolved-shadow-root` alongside this.' + filtered + blame, 'warn')
  }
}

/** clone attribute -> the pseudo snapdom stamps it for. See `snapdom/src/modules/pseudo.js`. */
const PSEUDO_ATTRS = [
  ['::before', 'data-snapdom-has-before'],
  ['::after', 'data-snapdom-has-after'],
]

const TRANSPARENT_RE = /^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$/

/**
 * Does this pseudo put anything on the screen?
 *
 * Deliberately mirrors snapdom's own `hasVisibleBox` test: a pseudo it decided
 * not to materialise BECAUSE it paints nothing is not a gap, and reporting one
 * would bury the real gaps in noise.
 */
function pseudoPaints (cs) {
  if (!cs || cs.display === 'none' || cs.visibility === 'hidden') return false
  const content = cs.content
  if (!content || content === 'none' || content === 'normal') return false
  if (content !== '""' && content !== "''") return true
  // `content:''` is the empty-box case: it paints only if it has a box.
  if (cs.backgroundImage && cs.backgroundImage !== 'none') return true
  const bg = cs.backgroundColor
  if (bg && bg !== 'transparent' && !TRANSPARENT_RE.test(bg)) return true
  if (cs.boxShadow && cs.boxShadow !== 'none') return true
  for (const side of ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth']) {
    if (parseFloat(cs[side]) > 0) return true
  }
  return false
}

/**
 * Generated content the clone was supposed to carry and does not.
 *
 * The clone materialises `::before`/`::after` into real `<span>`s and stamps the
 * host with `data-snapdom-has-before`/`-after` when it does, so the check is
 * exact in the direction that matters: the live element paints a pseudo, its
 * clone carries no stamp, therefore the export is missing it. That is a grade
 * `O` — something on the page is not in the document.
 *
 * This replaces `B4.pseudo-element`, which meant "generated content is out of
 * scope" and no longer is. The two must not share a code: one described a
 * limitation of the engine, this one describes a failure of a capture, and a
 * report that cannot tell them apart cannot be acted on.
 *
 * `::marker` is not here — snapdom leaves it as a native marker rather than an
 * element, so there is nothing for a collector to read and `paint.js` still
 * declares it under `B4.list-marker`.
 */
function declarePseudoGaps (st, nodeMap) {
  if (!nodeMap || typeof nodeMap.entries !== 'function') return
  if (typeof getComputedStyle !== 'function') return

  let elToId = null
  const idFor = (el) => {
    if (!elToId) {
      elToId = new Map()
      for (const id of Object.keys(st.doc.nodes)) {
        const node = st.doc.nodes[id]
        if (node.el) elToId.set(node.el, id)
      }
    }
    // The element itself may have been pruned; the loss is still inside the
    // nearest ancestor that survived, and that node is where it gets declared.
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const id = elToId.get(n)
      if (id) return id
    }
    return null
  }

  let found = 0
  for (const [cloneEl, srcEl] of nodeMap.entries()) {
    if (found >= st.ctx.maxDiagnosticsPerCode) break
    if (!cloneEl || cloneEl.nodeType !== 1 || !srcEl || srcEl.nodeType !== 1) continue
    if (srcEl.isConnected === false) continue
    for (const [sel, attr] of PSEUDO_ATTRS) {
      if (cloneEl.getAttribute(attr) !== null) continue
      let cs
      try {
        cs = getComputedStyle(srcEl, sel)
      } catch {
        continue
      }
      if (!pseudoPaints(cs)) continue
      found++
      report(st, idFor(cloneEl), 'capture.pseudo-not-materialised', 'O',
        `${cssSelector(srcEl)}${sel} paints on the page (content: ${cs.content}) and the clone ` +
        'carries no element for it, so it is not in this document. The clone is where generated ' +
        'content becomes real; when it does not, nothing downstream can recover it.')
      if (found >= st.ctx.maxDiagnosticsPerCode) break
    }
  }
}

/**
 * The last sweep before validation. Two jobs, both of them about the invariant
 * that outranks the schema:
 *
 *  - a `blend` the schema does not know is replaced and declared, rather than
 *    failing the whole document over one exotic keyword;
 *  - a node graded other than `E` that no diagnostic names gets one. That
 *    happens when `paint.js` suppresses repeats past its per-code cap: the node
 *    is degraded, its notes say why, and the entry that said so was counted
 *    instead of listed. The grade is real, so the declaration has to be too.
 */
function declareEverything (st) {
  const { nodes, diagnostics } = st.doc
  const named = new Set()
  for (const d of diagnostics) {
    for (const key of ['node', 'from', 'to']) if (typeof d[key] === 'string') named.add(d[key])
    for (const key of ['nodes', 'overlaps']) {
      if (Array.isArray(d[key])) for (const n of d[key]) if (typeof n === 'string') named.add(n)
    }
  }

  for (const id of Object.keys(nodes)) {
    const node = nodes[id]
    if (typeof node.blend === 'string' && !BLEND_MODES.has(node.blend)) {
      const bad = node.blend
      node.blend = 'normal'
      report(st, id, 'compose.blend-unsupported', 'A',
        `mix-blend-mode:${bad} is not a mode the schema carries; the node blends normally.`)
      named.add(id)
    }
    node.opacity = clamp01(node.opacity)

    const grade = node.fidelity && node.fidelity.grade
    if (!grade || grade === 'E' || named.has(id)) continue
    const notes = (node.fidelity.notes || []).join('; ')
    diagnostics.push({
      code: 'fidelity.undeclared',
      severity: 'warn',
      node: id,
      message: `graded ${grade} with no diagnostic naming it — reconstructed from fidelity.notes` +
        `${notes ? `: ${notes}` : ' (which are empty; the degradation was recorded without a reason)'}`,
    })
  }
}

/**
 * @param {object} st
 * @param {Element} element    the ORIGINAL element — `domElements` is a fact about
 *   the user's DOM and must not quietly become a fact about our clone, which has
 *   more elements in it (materialised pseudos, scroll wrappers, backdrops).
 * @param {Element} cloneRoot  the tree that was actually walked
 * @param {object} drift
 * @param {number} startedAt   when THIS export started; snapdom's own capture is
 *   not inside it any more — the caller makes that call and can time it.
 */
function buildReport (st, element, cloneRoot, drift, startedAt) {
  const { nodes, styles, assets } = st.doc
  const ids = Object.keys(nodes)
  const grades = { E: 0, A: 0, C: 0, R: 0, RH: 0, O: 0 }
  let raster = 0
  let textBlocks = 0

  // What the clone bought. Every one of these is a node that walking the live
  // DOM could not have produced: `pseudo` and `iconFont` do not exist as
  // elements there at all, `shadow` was behind a boundary the walker could not
  // cross, `artifact` is scaffolding snapdom added and we chose to keep. They
  // are counted, not asserted — if a number here is 0 for a fixture that
  // visibly has the feature, the migration did not deliver it there.
  const coverage = { pseudo: 0, shadow: 0, iconFont: 0, artifact: 0, synthetic: 0 }
  const nodeMap = st.nodeMap
  const live = (el) => nodeMap && typeof nodeMap.get === 'function' ? nodeMap.get(el) : undefined

  for (const id of ids) {
    const node = nodes[id]
    const grade = node.fidelity && node.fidelity.grade
    if (hasOwn(grades, grade)) grades[grade]++
    if (node.type === 'text') textBlocks++
    const hasBitmap = (node.fills || []).some((f) => {
      if (!f || f.type !== 'image' || typeof f.asset !== 'string') return false
      const asset = assets[f.asset]
      return !asset || asset.kind !== 'vector'
    })
    // `rasterFilters` produces a node that is a bitmap and carries no image fill
    // at all. Counting only fills would have reported `raster: 0` over a document
    // that had just baked a panel into a PNG — the exact false claim this field
    // was cleaned up to stop making.
    if (hasBitmap || (node.filterRaster && typeof node.filterRaster.asset === 'string')) raster++

    const source = node.source || {}
    if (source.pseudo) coverage.pseudo++
    if (source.clone) coverage.artifact++
    const el = node.el
    if (el && el.nodeType === 1) {
      const src = live(el)
      if (!src) {
        coverage.synthetic++
        // snapdom turns a ligature glyph into an <img> with a baked data URL; the
        // <img> has no live counterpart because in the page it was a text node in
        // an icon font. That pair of facts is the only signal it leaves.
        if (el.tagName === 'IMG' && String(el.getAttribute('src') || '').startsWith('data:image')) {
          coverage.iconFont++
        }
      } else if (behindShadowBoundary(src)) {
        // Counted on the SOURCE, not on the clone: the clone has the shadow tree
        // flattened into light DOM, so by then there is no boundary left to see.
        // The host element itself is often pruned for painting nothing, so
        // counting hosts would report 0 for a component that came through whole.
        coverage.shadow++
      } else if (source.shadowHost) {
        coverage.shadow++
      }
    }
  }

  const domElements = element.querySelectorAll ? element.querySelectorAll('*').length + 1 : 1
  const cloneElements = cloneRoot && cloneRoot.querySelectorAll
    ? cloneRoot.querySelectorAll('*').length + 1
    : 0
  const fonts = Object.keys(styles.text).map((id) => ({
    id,
    family: styles.text[id].family,
    weight: styles.text[id].weight,
    italic: styles.text[id].italic,
  }))

  return {
    nodes: ids.length,
    domElements,
    // The clone is the tree that was walked and it is BIGGER than the source:
    // both numbers are here so `nodeRatio` cannot be read as a claim about the
    // wrong one.
    cloneElements,
    // Measured, never promised: the whole point of the pruning in `paint.js` is
    // a number you can check, not a number in a pitch deck.
    nodeRatio: domElements ? ids.length / domElements : 0,
    // The mounted clone against the live element it copies, in px. Everything
    // above is measured ON the clone, so this is the error bar on all of it.
    drift,
    // Nodes the live-DOM walk could not have reached. See `coverage` above.
    coverage,
    vector: ids.length - raster,
    raster,
    textBlocks,
    fonts,
    grades,
    assets: Object.keys(assets).length,
    textStyles: Object.keys(styles.text).length,
    diagnostics: st.doc.diagnostics.length,
    promotions: st.doc.diagnostics.filter((d) => d.code === 'B4.promoted').length,
    // The mount, the walk, the collectors and the asset fetches — this export
    // and nothing else. What snapdom's own capture cost used to be itemised here
    // beside it, back when this module made that call itself; now the caller
    // does, and the caller is the only one who can time it honestly (the last
    // hook fires well before `captureDOM` finishes serializing).
    durationMs: now() - startedAt,
  }
}

function now () {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
}

/**
 * Is this live node inside a shadow tree? `getRootNode()` walks past nested
 * boundaries to the top, so the test is "the root is not the document" rather
 * than an `instanceof` against a global that may not be there.
 * @param {Node} node
 */
function behindShadowBoundary (node) {
  if (!node || typeof node.getRootNode !== 'function') return false
  const root = node.getRootNode()
  return !!root && root.nodeType === 11 && !!root.host
}

/** Grouped by code: 400 identical warnings are one line and a count, not 400 lines. */
function printDiagnostics (doc) {
  if (typeof console === 'undefined' || !doc.diagnostics.length) return
  const groups = new Map()
  for (const d of doc.diagnostics) {
    if (!groups.has(d.code)) groups.set(d.code, [])
    groups.get(d.code).push(d)
  }
  const text = (d) => d.message || d.note || d.reason || ''
  const ordered = [...groups].sort((a, b) => b[1].length - a[1].length)

  console.warn(
    `[snapdom-vector] ${doc.diagnostics.length} diagnostic(s) in ${ordered.length} code(s); ` +
    'all of them are in doc.diagnostics.'
  )
  for (const [code, list] of ordered) {
    const seen = []
    for (const d of list) {
      const message = text(d)
      if (message && !seen.includes(message)) seen.push(message)
      if (seen.length === 3) break
    }
    console.warn(`[snapdom-vector]   ${code} ×${list.length}`)
    for (const message of seen) console.warn(`[snapdom-vector]     ${message}`)
    if (list.length > seen.length && seen.length === 3) {
      console.warn(`[snapdom-vector]     …and ${list.length - 3} more of this code`)
    }
  }
}

// ——— entry points ———

/** Snapshot only plain option data, keeping functions and DOM objects opaque. */
function snapshotOption (value, seen = new WeakMap()) {
  const snapshot = { value }
  if (!value || typeof value !== 'object') return snapshot
  const proto = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return snapshot
  if (seen.has(value)) return seen.get(value)
  seen.set(value, snapshot)
  snapshot.entries = new Map(Object.keys(value).map(key => [key, snapshotOption(value[key], seen)]))
  if (Array.isArray(value)) snapshot.length = value.length
  return snapshot
}

/** Identity changes and in-place edits both count; cyclic option bags are safe. */
function sameOption (value, snapshot, seen = new Set()) {
  if (!Object.is(value, snapshot.value)) return false
  if (!snapshot.entries || seen.has(snapshot)) return true
  seen.add(snapshot)
  if (Array.isArray(value) && value.length !== snapshot.length) return false
  const keys = Object.keys(value)
  return keys.length === snapshot.entries.size && keys.every(key =>
    snapshot.entries.has(key) && sameOption(value[key], snapshot.entries.get(key), seen))
}

/**
 * v3 passes normalized capture options to exporters, including defaults such as
 * `exclude: []` and `embedFonts: 'auto'`. Those are not per-export requests and
 * must not erase defaults passed to vector(). Explicit export options and
 * detectable beforeExport changes win, including in-place array/object edits.
 * An assignment of the unchanged scalar value cannot be distinguished from an
 * untouched default; use an explicit export option for that case. Direct calls
 * without the v3 facade keep the usual defaults-then-options merge.
 */
function exportOptions (ctx, defaults, opts, captured) {
  const requested = ctx && ctx.export && ctx.export.requestedOptions
  if (!requested) return { ...defaults, ...opts }
  const merged = { ...opts, ...defaults }
  for (const [key, snapshot] of captured) {
    if (hasOwn(opts, key) && (hasOwn(requested, key) || !sameOption(opts[key], snapshot))) merged[key] = opts[key]
  }
  return merged
}

/**
 * The engine, as a snapdom plugin — the one way to use it.
 *
 * Shaped like the twelve official plugins (`snapdom/packages/plugins/`): a
 * factory returning `{name, hook, defineExports}`. What is specific to this one
 * is that the export does nearly all of the work, and the hook does almost none:
 * a capture whose result nobody asks a vector question of costs one object.
 *
 *     const result = await snapdom(el, { plugins: [vector({ mode: 'replica' })] })
 *     const doc = await result.toVector()             // SVD document
 *     const svg = await result.toVectorSvg()          // flat SVG markup
 *     const fig = svdToFigma(doc)                     // …or any emitter, off the doc
 *     const h2d = await result.toVectorFigmaClipboard()   // Figma's paste envelope
 *
 * **The export names.** snapdom's own `svg` export is `result.toSvg()` — an
 * `<img>` of the capture (`snapdom/src/api/snapdom.js:333`) — and plugin exports
 * OVERRIDE core ones by name (`buildResult`: `{...coreExports, ...provided}`), so
 * a plugin publishing `svg` would silently replace it for every caller of that
 * capture. `vector` and `vectorSvg` are free, and `buildResult` turns them into
 * `toVector()` / `toVectorSvg()` by the same rule it uses for every other plugin
 * (`'to' + key[0].toUpperCase() + key.slice(1)`).
 *
 * `vectorFigmaClipboard` is free by the same check, and it is prefixed for the
 * same reason the other two are: taken are the core `img|svg|canvas|blob|png|
 * jpeg|jpg|webp|download` and the official plugins' `agentMap|ascii|context|gif|
 * html|htmlInCanvas|pdfImage|mp4`, plus `pdf` from the sibling package here — a
 * bare `figma` or `html` would be a name a future plugin can take from us, or we
 * from it, with no warning either way. It is also NOT `svdToFigma`, which exists
 * and is a different thing: that one turns an SVD document into JSON for our own
 * Figma plugin to build nodes with. This one produces the clipboard envelope
 * FIGMA'S OWN importer opens, and never touches the SVD.
 *
 * Options given here are defaults for every export; the same names passed to an
 * export call override them for that call.
 *
 * @param {object} [options]
 * @param {'design'|'replica'} [options.mode='design']
 * @param {number} [options.maxNodes=20000]   ceiling; the walk stops and says so
 * @param {number} [options.maxDepth=256]
 * @param {string|Function|Array} [options.exclude]  selectors or predicates to skip
 * @param {number} [options.fetchTimeout=8000]       per asset, in ms
 * @param {number} [options.maxAssetBytes]           size past which an asset is reported
 * @param {boolean} [options.embedFonts=true]  fetch the bytes behind every
 *   `@font-face` family the capture paints with and carry them in `doc.assets`
 *   (`collect/font.js`): the emitted SVG then renders without the viewer's
 *   installed fonts and every line is pinned with `textLength`. The file travels
 *   WHOLE — there is no subsetter — and each face declares its size under
 *   `assets.font-embedded`; `false` keeps the export small and the families
 *   travel by name, declared per family instead.
 * @param {boolean} [options.silent=false]    do not print the grouped diagnostics
 * @param {boolean} [options.debugPaint=false]  `toVectorSvg` only: tint nodes by
 *   stacking-context depth
 * @param {boolean} [options.rasterFilters=false]  rasterize, to a PNG `<image>`,
 *   the nodes whose FILTER an importer of Figma's class does not run — the colour
 *   functions of `filter`/`backdrop-filter` (`saturate`, `brightness`, `contrast`,
 *   `grayscale`, `sepia`, `hue-rotate`, `invert`), which become one `feColorMatrix`,
 *   and inner shadows, which have no primitive and stay a composite chain. Those
 *   nodes and no others: a filter that arrives intact is never touched. Off by
 *   default because it is a real loss — the subtree stops being editable in every
 *   consumer, not only in the one it is for — and because with it off the document
 *   is unchanged and the loss is declared instead (`emit.svg.filter-not-imported`).
 *   The pixels come from the MOUNTED CLONE, which is where snapdom has already
 *   pre-composed `backdrop-filter`, over the filter's own region (`3σ + |offset|`)
 *   rather than the border box. Every node it rasterizes says so (`raster.filter`,
 *   grade R) and every node it could not says that (`raster.filter-failed`).
 *   **Only `toVectorSvg` consumes them.** `svdToFigma` and the PDF backend do not
 *   read `node.filterRaster` yet and emit the node's vector paint instead; that is
 *   said in the diagnostic rather than left for someone to discover.
 *
 * **`toVectorFigmaClipboard()` is a different KIND of export from the other two**
 * and should be read before it is shipped behind a button. It does not produce a
 * document this engine defines: it produces Figma's own `h2d` clipboard payload —
 * the computed DOM, which Figma converts on paste — in a format that is
 * proprietary, undocumented, reverse-engineered from one decoded capture of their
 * extension, and already at `version: 2`. Figma can change it in any release,
 * with no negotiation and no error; the only symptom is a ⌘V that does nothing.
 * What it buys is what the SVG importer cannot do at all: `letter-spacing`
 * survives (FIGMA_FINDINGS.md §5). What it costs is that only Figma opens it,
 * which is why `toVectorSvg()` is not going anywhere.
 *
 * @returns {object} snapdom plugin
 */
export function vector (options = {}) {
  return {
    name: 'vector',

    // No `pure: true`, and that is load-bearing rather than an omission. The flag
    // opts a plugin back into auto-burst (`snapdom/src/core/plugins.js:184`), and
    // burst's memo and differential paths both answer with a URL WITHOUT
    // re-entering `captureDOM` — so the hook below would not run and the export
    // would have no clone. Declaring a read-only hook impure is what buys the
    // `burst: false` the loose API used to force by hand.

    /**
     * The hand-off, and nothing else. v3 passes one capture context to every
     * hook; `state.options` aliases that same context. The export views preserve
     * its enumerable fields, including this hand-off.
     */
    beforeRender (state) {
      if (!state || !state.options) return
      const handoff = handoffFrom(state)
      // `baseCSS` is snapdom's UA-stylesheet reset, and it belongs to the RASTER
      // path and to nothing else. `handoffFrom` stays the adapter's six fields:
      // the mount does not want this string — injecting a tag reset into the live
      // page would restyle the page the clone is measured against — and only
      // `rasterizeUnrunFilters`, which renders the clone inside a foreignObject
      // where there is no page cascade at all, has any use for it. Read here
      // because `beforeRender` is the one hook where snapdom's state carries it
      // (`engines/svg.js` assembles the CSS before the hook runs).
      if (handoff) handoff.baseCSS = state.baseCSS || ''
      state.options.__vectorHandoff = handoff
    },

    defineExports (captureCtx) {
      // Only collisions need snapshots. Never traverse the whole capture context:
      // it owns the clone and maps, and export hooks share its option references.
      const captured = new Map(Object.keys(options).map(key => [key, snapshotOption(captureCtx && captureCtx[key])]))
      return {
        vector: (ctx, opts = {}) => buildDocument(ctx, exportOptions(ctx, options, opts, captured)),
        vectorSvg: async (ctx, opts = {}) => {
          const merged = exportOptions(ctx, options, opts, captured)
          return svgFrom(await buildDocument(ctx, merged), merged)
        },
        vectorFigmaClipboard: (ctx, opts = {}) => buildFigmaClipboard(ctx, exportOptions(ctx, options, opts, captured)),
      }
    },
  }
}

export default vector

/**
 * The two guards every export that walks the clone has to pass, in one place so
 * the second backend cannot drift from the first one's diagnosis.
 *
 * @param {object} ctx    the export context
 * @param {string} label  the export's own name, so the error names what was called
 * @returns {{handoff: object, element: Element}}
 */
function openCapture (ctx, label) {
  const handoff = ctx && ctx.__vectorHandoff
  if (!handoff) {
    throw new Error(
      `${label}: this capture carries no clone. The vector plugin's \`beforeRender\` hook never ` +
      'ran, so the capture did not go through captureDOM — the usual cause is an explicit ' +
      '`burst: true`, which serves a memoized URL instead. Leave `burst` unset: a plugin with ' +
      'render hooks suspends auto-burst on its own.'
    )
  }

  // No "is there a DOM?" check any more: the hand-off only exists because a hook
  // ran inside a capture, and a capture only happens in a browser.
  const element = handoff.element
  const rect = element.getBoundingClientRect()
  if (!(rect.width > 0) || !(rect.height > 0)) {
    const cs = getComputedStyle(element)
    const why = cs.display === 'none'
      ? 'it is display:none'
      : element.isConnected === false
        ? 'it is not connected to a document'
        : `its border box is ${rect.width}×${rect.height}`
    throw new Error(`${label}: the captured element has no layout box (${why}); there is nothing to capture`)
  }
  return { handoff, element }
}

/**
 * The `h2d` backend, end to end: mount the clone, walk it into Figma's own
 * clipboard payload, wrap it in the envelope, unmount.
 *
 * **It does not build an SVD document, and that is the point.** This is a
 * parallel backend off the same clone, not a second consumer of the first one's
 * output: Figma converts the DOM itself on this channel, so a paint tree,
 * gradients, measured text lines and everything else the SVD models would be work
 * done twice — once here and once by Figma, from raw styles, differently.
 * `emit/svg-flat.js` and the SVD are untouched by this path.
 *
 * The clone is unmounted in a `finally` for the same reason `buildDocument` does
 * it: without that, every call leaves a full copy of the user's subtree in their
 * page.
 *
 * @param {object} ctx
 * @param {object} options
 * @returns {Promise<import('./emit/h2d.js').H2DResult & {html: string, plain: string,
 *   json: string, bytes: number, clipboardItem: () => ClipboardItem}>}
 */
/**
 * The hybrid, in one place: find the nodes whose paint the h2d channel cannot spell,
 * draw them with the SVD backend, hand back a clone-element -> data-URI map.
 *
 * It is skipped entirely when the capture has none of them, and that is the common
 * case — assembling an SVD is the expensive half of this library, and paying for it
 * on a page of text and boxes to discover there was nothing to draw would make every
 * capture slower for the benefit of the ones that need it. The probe that decides is
 * a style read per element.
 *
 * @param {Element} element
 * @param {import('./adapters/snapdom.js').CloneCapture} capture
 * @param {object} options
 * @param {object} handoff
 * @returns {Promise<{overrides: Map<Element,string>|null, withheld: object[], bytes: number,
 *   diagnostics: object[]}>}
 */
async function hybridPaint (element, capture, options, handoff) {
  const none = { overrides: null, withheld: [], bytes: 0, diagnostics: [] }
  // `vectorFallback: false` turns off the DRAWING, not the reporting. A capture that
  // stops fixing something and also stops mentioning it is the failure mode this whole
  // engine is built against.
  const mode = options.mode === 'replica' ? 'replica' : 'design'
  const { targets, withheld, backdrop } = findFallbackTargets(capture.clone, {
    mode,
    isExcluded: (el) => !!(el.closest && el.closest('[data-capture="exclude"]')),
  })
  if (!targets.size && !withheld.length && !backdrop.length) return none

  const diagnostics = []
  if (backdrop.length) {
    const byCode = new Map()
    for (const c of backdrop) byCode.set(c, (byCode.get(c) || 0) + 1)
    diagnostics.push({
      code: 'h2d.backdrop-effects-lost',
      severity: 'warn',
      message: `${backdrop.length} node(s) use an effect that reads what is UNDERNEATH them ` +
        `(${[...byCode].map(([c, n]) => `${c}×${n}`).join(', ')}). The channel does not carry those ` +
        'properties and the vector fallback cannot supply them either: a per-node asset is its own ' +
        'document with a transparent backdrop, so multiplying against nothing produces the same flat ' +
        'shape as describing it as a box — measured on `demo/hybrid-probe.html`, where a ' +
        '`mix-blend-mode: multiply` square drew identically both ways. They arrive unblended. Figma ' +
        'does not apply blend on import either, so this is not a gap against their extension.',
    })
  }
  if (withheld.length) {
    const byCode = new Map()
    for (const w of withheld) for (const c of w.codes) byCode.set(c, (byCode.get(c) || 0) + 1)
    diagnostics.push({
      code: 'h2d.vector-paint-withheld',
      severity: 'warn',
      message: `${withheld.length} node(s) paint something this channel cannot describe ` +
        `(${[...byCode].map(([c, n]) => `${c}×${n}`).join(', ')}) and were NOT redrawn as vector, ` +
        'because they have text inside and replacing them would replace the editable text with a ' +
        'drawing. In `design` mode the text wins and the effect is lost; run the capture with ' +
        '`mode: "replica"` to trade it the other way. Figma\'s own extension loses these too — ' +
        'measured, FIGMA_FINDINGS.md § «El híbrido» — so this is not a gap against their tool.',
    })
  }
  if (!targets.size) return { ...none, withheld, diagnostics }
  if (options.vectorFallback === false) {
    diagnostics.push({
      code: 'h2d.vector-paint-off',
      severity: 'warn',
      message: `${targets.size} node(s) would have had their paint drawn as vector and \`vectorFallback: ` +
        'false\' turned it off. They are in the payload as plain CSS boxes, which means Figma paints ' +
        'them without the effect — no conic ramp, no filter, no clip.',
    })
    return { ...none, withheld, diagnostics }
  }

  const elementIndex = new Map()
  let doc
  try {
    doc = await assemble(element, capture, options, now(), handoff, elementIndex)
  } catch (error) {
    diagnostics.push({
      code: 'h2d.vector-paint-failed',
      severity: 'warn',
      message: `${targets.size} node(s) needed their paint drawn as vector and the SVD document ` +
        `could not be assembled: ${error && error.message}. They are in the payload described as ` +
        'plain CSS boxes, which is what they looked like before this step existed — the effect is ' +
        'lost, not the node.',
    })
    return { ...none, withheld, diagnostics }
  }

  const overrides = new Map()
  let bytes = 0
  const unresolved = []
  for (const [el, info] of targets) {
    const id = elementIndex.get(el)
    const slice = id ? svdSliceToDataUri(doc, id) : null
    if (!slice) { unresolved.push({ tag: el.tagName, codes: info.codes }); continue }
    overrides.set(el, slice.uri)
    bytes += slice.bytes
  }
  if (unresolved.length) {
    diagnostics.push({
      code: 'h2d.vector-paint-unresolved',
      severity: 'warn',
      message: `${unresolved.length} node(s) were selected for vector paint and no SVD node could be ` +
        `found for them (${unresolved.slice(0, 4).map((u) => u.tag + ':' + u.codes.join('+')).join(', ')}). ` +
        'They arrive as plain CSS boxes without the effect. This is an engine bug, not a page one: ' +
        'the paint tree and the h2d walk disagreed about which elements exist.',
    })
  }
  if (overrides.size) {
    const byCode = new Map()
    for (const [, info] of targets) for (const c of info.codes) byCode.set(c, (byCode.get(c) || 0) + 1)
    diagnostics.push({
      code: 'h2d.vector-paint',
      severity: 'info',
      message: `${overrides.size} node(s) have their paint drawn by this engine's SVD backend and ` +
        `carried as image/svg+xml instead of described as CSS (${[...byCode].map(([c, n]) => `${c}×${n}`).join(', ')}), ` +
        `${Math.round(bytes / 1024)} kB of markup. Measured in Figma (2026-08-07): an SVG asset from ` +
        'this channel imports AS PATHS in a group, not as an image fill, so those layers stay ' +
        'editable. It is done because the alternative is not a worse paste but no paint at all — ' +
        'Figma\'s importer has no conic gradient, does not run filters and does not clip, and their ' +
        'own extension loses exactly the same things. Turn it off with `vectorFallback: false`.',
    })
  }
  return { overrides: overrides.size ? overrides : null, withheld, bytes, diagnostics }
}

async function buildFigmaClipboard (ctx, options) {
  const { handoff, element } = openCapture(ctx, 'toVectorFigmaClipboard')
  const rect = element.getBoundingClientRect()
  const capture = mountClone(handoff)
  let out
  let hybrid = { overrides: null, withheld: [], bytes: 0, diagnostics: [] }
  try {
    hybrid = await hybridPaint(element, capture, options, handoff)
    out = cloneToH2d(capture.clone, {
      paintOverrides: hybrid.overrides,
      // The LIVE element's document position. Every rect in the payload is
      // measured on the clone and re-expressed against this, so the paste lands
      // where the element sits on the page and not 99999px to the left of it.
      docOrigin: {
        x: rect.left + (typeof scrollX === 'number' ? scrollX : 0),
        y: rect.top + (typeof scrollY === 'number' ? scrollY : 0),
      },
      rootSize: { width: rect.width, height: rect.height },
      // Clone node -> live node. The walk reads the resolved styles off the CLONE and
      // the authored ones off the live twin: snapdom resolves `width: 100%` into a px
      // when it clones, and that percentage is the only thing that tells Figma a layer
      // fills its parent instead of being pinned to the width it happens to have.
      nodeMap: capture.nodeMap,
      documentTitle: typeof document !== 'undefined' ? document.title : '',
      devicePixelRatio: typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
      exclude: options.exclude,
      maxNodes: options.maxNodes,
      // Off puts inline <svg> back to being a tree of CSS boxes, which Figma imports as
      // an empty frame. It exists so a paste that fails can be bisected against the one
      // behaviour of this backend that rewrites a node instead of describing it.
      inlineSvgAsAsset: options.inlineSvgAsAsset,
    })
  } finally {
    capture.unmount()
  }
  out.diagnostics.push(...hybrid.diagnostics)

  // The mount is verified on this path too, by the same `DRIFT_LIMIT_PX` the SVD
  // path uses. `drift` is the whole claim behind reading the clone instead of the
  // page: a payload built on an unverified mount is a paste whose coordinates
  // nobody checked, and here they are the ONLY geometry — Figma lays the tree out
  // from these rects.
  const drift = capture.drift || {}
  if (!drift.pairs) {
    out.diagnostics.push({
      code: 'h2d.clone-unverified',
      severity: 'warn',
      message: 'Not one clone node could be matched to a live element, so the mounted clone\'s layout ' +
        'was never checked against the layout it copies. Every rect in this payload is measured on the ' +
        'clone and nothing here confirms the clone is right.',
    })
  } else if (drift.median > DRIFT_LIMIT_PX || drift.max > DRIFT_LIMIT_PX) {
    out.diagnostics.push({
      code: 'h2d.clone-drift',
      severity: 'warn',
      message: `The mounted clone does not lay out like the element it copies: median ` +
        `${drift.median.toFixed(2)}px, p95 ${drift.p95.toFixed(2)}px, max ${drift.max.toFixed(2)}px ` +
        `over ${drift.pairs} matched node(s), against a ${DRIFT_LIMIT_PX}px limit. Every rect in this ` +
        'payload was measured on the clone, so the paste is off by about that much.',
    })
  }

  const envelope = h2dEnvelope(out.payload, {
    selector: cssSelector(element),
    url: typeof location !== 'undefined' ? location.href : '',
  })
  const result = {
    ...envelope,
    payload: out.payload,
    diagnostics: out.diagnostics,
    stats: out.stats,
    drift: capture.drift,
    /** The envelope as a ClipboardItem, with the empty `text/plain` half. */
    clipboardItem: () => h2dClipboardItem(envelope),
  }
  if (!options.silent) printDiagnostics({ diagnostics: out.diagnostics })
  return result
}

/**
 * One export call: take the clone the hook parked, mount it, walk it, validate
 * the document, unmount.
 *
 * @param {object} ctx  the export context snapdom builds from the capture context
 * @param {object} options
 * @returns {Promise<SVDDocument>}
 * @throws when the capture handed over no clone, when the element has nothing to
 *   capture, or when the document we assembled does not validate — the engine
 *   does not emit broken documents.
 */
async function buildDocument (ctx, options) {
  const startedAt = now()

  const { handoff, element } = openCapture(ctx, 'toVector')

  // From here on the tree being read is the CLONE. `element` is still what the
  // capture is ABOUT — its selector, its url, its position in the document — and
  // nothing below may take a measurement off it: the two trees sit ~99999px
  // apart and every coordinate is relative to its own root.
  const capture = mountClone(handoff)
  try {
    return await assemble(element, capture, options, startedAt, handoff)
  } finally {
    // Not optional and not on the happy path: without this every export leaves
    // a full copy of the user's subtree, and a <style> for it, in their page.
    capture.unmount()
  }
}

/**
 * Everything between a mounted clone and a validated document. Split out of
 * `buildDocument` for one reason: it lets the unmount live in a `finally` that
 * cannot be skipped by an early return or a throw halfway down.
 *
 * @param {Element} element  the original, for the capture header and the report
 * @param {import('./adapters/snapdom.js').CloneCapture} capture
 * @param {object} options
 * @param {number} startedAt
 * @param {object} handoff  the capture's own CSS, for `rasterFilters` — the only
 *   step here that has to RENDER the clone rather than read it
 * @param {Map<Element,string>} [elementIndex]  filled with clone element -> node id
 *   just before the back-references are dropped, for callers that have to go back
 *   from the DOM to the document (the h2d hybrid does)
 * @returns {Promise<SVDDocument>}
 */
async function assemble (element, capture, options, startedAt, handoff, elementIndex) {
  const { clone, nodeMap, drift } = capture
  const rect = element.getBoundingClientRect()

  const ctx = makeCtx(clone, options)
  const tree = buildPaintTree(clone, ctx)
  const rootNode = tree.nodes[tree.rootId]

  const doc = emptyDocument({
    url: typeof location !== 'undefined' ? location.href : '',
    selector: cssSelector(element),
    capturedAt: new Date().toISOString(),
    viewport: {
      w: typeof innerWidth === 'number' ? innerWidth : 0,
      h: typeof innerHeight === 'number' ? innerHeight : 0,
      dpr: typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
    },
    // The root's border box in DOCUMENT coordinates: `abs` is relative to it, so
    // this is what puts a capture back where it came from.
    docOrigin: {
      x: rect.left + (typeof scrollX === 'number' ? scrollX : 0),
      y: rect.top + (typeof scrollY === 'number' ? scrollY : 0),
    },
    root: { w: rootNode.abs.w, h: rootNode.abs.h },
    mode: ctx.mode,
  })
  doc.nodes = tree.nodes
  doc.root = tree.rootId
  doc.diagnostics = tree.diagnostics.slice()
  ctx.assets = doc.assets

  const st = {
    ctx,
    doc,
    dropped: new Set(),
    textStyleIds: new Map(),
    markupTextUses: [],
    /** `{id, mask}` per node whose `mask-image` layers still need a node. */
    masks: [],
    // clone node -> live node. `buildReport` needs it to tell a node snapdom
    // SYNTHESIZED (a materialised pseudo, an icon-font <img>, a scroll wrapper)
    // from one that was already in the user's DOM — that difference is the whole
    // coverage claim of walking the clone.
    nodeMap,
  }

  // Every node, one collector each. The image calls are awaited together: a card
  // with twelve icons is twelve fetches in flight, not twelve round trips.
  const pending = []
  for (const id of Object.keys(doc.nodes)) {
    const task = collectNode(st, id, doc.nodes[id])
    if (task) pending.push(task)
  }
  if (pending.length) await Promise.all(pending)

  // Background `url()` layers can only be placed once their intrinsic size is
  // known, so they are a second batch rather than part of the first.
  await resolveBackgroundAssets(st)

  applyDrops(st)
  // snapdom empties four properties on the clone ROOT so a raster capture is not
  // asked to draw outside its own bitmap; the adapter puts them back from the
  // live element because a vector export has somewhere to put them. That is a
  // repair of the input, so it is stated — a reader comparing this document to
  // the clone would otherwise find paint the clone does not have.
  if (Array.isArray(capture.restoredRootPaint) && capture.restoredRootPaint.length) {
    report(st, doc.root, 'capture.root-paint-restored', 'A',
      `snapdom strips ${capture.restoredRootPaint.join(', ')} from the capture root (and only from it, ` +
      '`stripRootShadows`): for a bitmap that paint would bleed past the edge of the image. It is read ' +
      'back off the live element and put on the clone before anything is measured, so this document ' +
      'carries the root\'s own outer paint instead of silently losing it. It paints OUTSIDE the root box ' +
      'in every case, so a backend whose canvas is that box (a standalone SVG, whose viewport is the ' +
      'root frame) still clips it; one whose frames can overflow (Figma) draws it.', 'info')
  }
  // The mount got the pseudo-suppressor and nothing else: the shadow-scoped
  // rules could not be cut out of `classCSS`. Everything under a flattened
  // shadow root is then painted by the page's cascade alone, which does not
  // reach it — so it is declared here rather than left to be read off `drift`.
  if (capture.classPrefixExact === false) {
    report(st, null, 'capture.clone-css-partial', 'A',
      'snapdom\'s shadow-scoped rules could not be separated from its per-node style snapshots ' +
      '(the anchor `classPrefixFrom` cuts on has moved in this build of snapdom), so the mounted ' +
      'clone was styled with the pseudo-element suppressor alone. Content that came out of a ' +
      'shadow root is laid out and painted without its component\'s own CSS; check `drift` before ' +
      'trusting any coordinate in this document.', 'warn')
  }
  wireMasks(st)
  padGradients(st)
  // Last of the passes that touch the clone, and the only one that RENDERS it.
  // It runs here rather than in the emitter because the emitter is synchronous
  // and DOM-free by contract (`svdToSvg`, the oracle backend, has to run in
  // Node): this is the one place that is both inside the mount and allowed to
  // wait. After it, the clone is only measured — and shortly after that, gone.
  if (options.rasterFilters) await rasterizeUnrunFilters(st, capture, handoff || {})
  // After every text style exists and before `declareFonts`, which then declares
  // only what is STILL not embedded. Inside the mount like the raster pass above,
  // because this is the other collector that is allowed to await.
  if (options.embedFonts !== false) await collectFonts(st, report)
  declareFonts(st)
  declareTracking(st)
  declareDrift(st, drift)
  declarePseudoGaps(st, nodeMap)
  declareEverything(st)
  doc.report = buildReport(st, element, clone, drift, startedAt)

  // The clone is unmounted the moment this returns, and every node holds a
  // non-enumerable `el` pointing into it. Left in place, a document nobody has
  // finished with keeps a detached copy of the whole subtree alive. Nothing
  // downstream reads it — the collectors are the last consumers.
  // The h2d hybrid needs to go from a clone element to the SVD node that describes it,
  // and `el` is the only link there is — `source.path` is a selector rebuilt from
  // classes snapdom generated, which is a string match where an identity is available.
  // It is handed over HERE because the next statement destroys it.
  if (elementIndex instanceof Map) {
    for (const id of Object.keys(doc.nodes)) {
      const el = doc.nodes[id].el
      if (el && !elementIndex.has(el)) elementIndex.set(el, id)
    }
  }

  for (const id of Object.keys(doc.nodes)) {
    const node = doc.nodes[id]
    if (node.el) node.el = null
    if (node._kids) node._kids = null
  }

  const result = validate(doc)
  if (!result.ok) {
    const shown = result.errors.slice(0, 20)
    const rest = result.errors.length - shown.length
    throw new Error(
      `toVector: the assembled SVD document is invalid (${result.errors.length} error(s)) and ` +
      'was not emitted — a document that does not validate is a bug in the engine, not in the page:\n  ' +
      shown.join('\n  ') + (rest > 0 ? `\n  …and ${rest} more` : '')
    )
  }

  if (!options.silent) printDiagnostics(doc)
  return doc
}

/**
 * A validated document through the flat SVG backend, which is the oracle the
 * rest of the pipeline is checked against. No `foreignObject`: text is `<text>`
 * with one `<tspan>` per measured visual line.
 *
 * This is what `toVectorSvg()` is: `toVector()` and then this. Already holding a
 * document? `svdToSvg(doc)` is exported and walking the clone twice is not free.
 *
 * @param {SVDDocument} doc
 * @param {object} [options]
 * @param {object} [options]
 * @param {'universal'|'figma'} [options.target='universal']  who this file is FOR.
 *   Not a style preference — the destinations disagree on things that cannot be
 *   satisfied at once, and one file cannot serve both. Today it decides exactly one
 *   choice, gradient text:
 *
 *   - `universal` — `<text fill="url(#lg)">`: plain SVG 1.1, an editable and
 *     searchable text layer, correct in every conformant renderer. **Figma's SVG
 *     importer does not resolve the reference and paints it black.**
 *   - `figma` — the same text as a `<mask>` with the gradient painted through it:
 *     the colours arrive in Figma, and the block stops being a text layer there. A
 *     renderer without `<mask>` support paints the rect unmasked and loses the text
 *     entirely, which is why this is not the default.
 *
 *   **Getting a capture INTO Figma: paste the universal SVG first (product call,
 *   Martin, 2026-08-13).** In practice the universal file pastes better into
 *   today's Figma than the h2d clipboard channel lands, so the default dev flow
 *   is `toVectorSvg()` → paste, accepting the importer's known losses (tracking
 *   dropped, gradient text black unless `target: 'figma'`, @font-face and
 *   textLength ignored — all measured, FIGMA_FINDINGS). `toVectorFigmaClipboard()`
 *   stays for when the editable text layer is worth more than paste fidelity;
 *   it does not go through the importer at all.
 * @param {boolean} [options.debugPaint=false]  tint nodes by stacking-context depth
 * @param {boolean} [options.textGradientMask]  the same choice, per-property. Wins
 *   over `target` when given, so an explicit false still means false.
 * @returns {string} SVG markup
 */
function svgFrom (doc, options = {}) {
  const out = svdToSvg(doc, {
    debugPaint: !!options.debugPaint,
    // Same destination split as the gradient: the exact chain is more faithful
    // everywhere and Figma cannot run `feMorphology`, so `target: 'figma'` gives the
    // single-primitive form back.
    exactShadows: typeof options.exactShadows === 'boolean'
      ? options.exactShadows
      : options.target !== 'figma',
    // Opt-IN since 2026-08-07: the mask is the Figma-SVG-importer branch, and Figma
    // has `toVectorFigmaClipboard()` now. See `svdToSvg` for the measurement.
    textGradientMask: typeof options.textGradientMask === 'boolean'
      ? options.textGradientMask
      : options.target === 'figma',
  })
  if (typeof out === 'string') return out

  // `svdToSvg` is moving to `{svg, diagnostics}` so its approximations — a conic
  // fanned into 128 wedges, a gradient stroke sampled on the node box, a line
  // with no measured width — stop living in an XML comment nobody opens. Both
  // shapes are accepted while that lands, and the diagnostics, when they come,
  // are merged into the document and degrade the nodes they name, exactly like
  // the ones the collectors produce.
  if (!out || typeof out.svg !== 'string') {
    throw new Error('toVectorSvg: svdToSvg returned neither markup nor {svg, diagnostics}')
  }
  const extra = Array.isArray(out.diagnostics) ? out.diagnostics : []
  for (const d of extra) {
    if (!d || typeof d !== 'object') continue
    doc.diagnostics.push(d)
    const grade = hasOwn(GRADE_RANK, d.grade) ? d.grade : 'A'
    if (typeof d.node === 'string') {
      degradeNode(doc.nodes[d.node], grade, d.message || d.note || d.code)
    }
  }
  if (extra.length && !options.silent) printDiagnostics({ diagnostics: extra })
  return out.svg
}
