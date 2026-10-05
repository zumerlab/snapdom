/**
 * snapdom Pro — the `h2d` backend: Figma's own clipboard channel, fed from the
 * clone.
 *
 * **What this is.** Figma's official "code to canvas" extension does not convert
 * anything. It writes the DOM — tags, computed styles, boxes — into a clipboard
 * envelope, and FIGMA does the conversion on paste. `FIGMA_FINDINGS.md` §«El canal
 * h2d acepta datos propios» has the decode of a real capture from their extension
 * 1.3.24, and the verified fact this file rests on: **the channel does not check
 * who wrote the payload.** A hand-built one was pasted and imported. `demo/h2d.html`
 * is that probe.
 *
 * **What this channel does NOT buy, corrected 2026-08-07 after pasting it.** This
 * header used to say the payload arrives "with the `letter-spacing` intact", and that
 * it is what the SVG importer throws away. The first half was a guess from the payload
 * carrying the property; the second half was true of the SVG importer and irrelevant.
 * Measured on `fx-type` in real Figma, both by this channel and by their own
 * extension: **the tracking arrives at 0 either way.** Figma does not represent it on
 * import, from any source, which §«Contraste con la extensión OFICIAL» had already
 * established and this file went on contradicting. What the channel actually buys is
 * frames, semantics, editable text runs and the asset carrier the hybrid rides on —
 * not typography.
 *
 * **What this is NOT.** It is not a second SVG emitter and it shares nothing with
 * `emit/svg-flat.js`, which stays the destination-independent path. This one only
 * Figma understands. Illustrator, Penpot, a vector PDF and a sanitised SVG still
 * need the SVD.
 *
 * **The one thing that separates this from the probe: it reads the CLONE.** The
 * probe walks the live DOM, which is the cheap half. Walking snapdom's mounted
 * clone is what makes a `::before` a real element, a shadow tree light DOM, an
 * icon font an `<img>`, and a cross-origin image a data URI — all of them already
 * solved before this file runs (`adapters/snapdom.js`), and none of them
 * reachable from the live tree. The clone's boxes are measured at 0.00px of drift
 * against the live ones, so its geometry IS the page's geometry.
 *
 * **This module is browser-bound on purpose**, unlike `svdToSvg`, which is a pure
 * function of a document so the oracle can run it in Node. There is no
 * intermediate representation here to be pure about: the payload is computed
 * styles and client rects, and both only exist next to a layout engine.
 *
 * ### The format is undocumented, proprietary, and already at `version: 2`
 *
 * Figma can change it in any release, with no version negotiation, no error and no
 * way to detect it — the failure mode is that someone hits ⌘V and nothing appears.
 * A field we shape wrong does not throw either; it is ignored, in silence.
 *
 * **Two captures of their extension have been decoded, and the second one changed
 * this file substantially** (2026-08-07, `FIGMA_FINDINGS.md` §«El payload h2d,
 * decodificado sobre imágenes»). It was taken over `demo/challenges.html` → `#fx-img`,
 * the images fixture, and it carried the three things the first one did not show:
 * a non-empty `assets` map, an `<img>` reduced to `currentSrc`, and a `computedStyles`
 * with something other than `transformOrigin` in it. Everything this module now does
 * with images, with the property filter and with `computedStyles` was measured against
 * that payload — the live subtree was walked side by side with it, at the same layout
 * width, and every candidate rule scored per property over the 26 elements.
 *
 * @module emit/h2d
 */
import { isExcluded as matchesExclusion } from '../exclusion.js'

/** The payload's own version field, as decoded from their extension. */
export const H2D_VERSION = 2

/**
 * The properties their payload can carry per node, camelCase.
 *
 * **This list is transcribed, not designed** — it is the union of what two real
 * captures of their extension contained, and it is deliberately not extended: a
 * property outside it is one we would be guessing Figma reads. The first capture
 * (a card, `#fx-card`) showed 47; the images fixture showed 32 more, among them
 * `objectFit`, `overflow`, `position`, `height`, `backgroundSize`, `background
 * PositionX/Y`, `flexShrink` and the grid templates.
 *
 * That difference is the whole lesson: **a property missing from a capture is not a
 * property their extension refuses to send.** Each node only carries the properties
 * whose value is not the initial one (see `pickStyles`), so a fixture that never
 * uses `object-fit` produces a payload where `objectFit` does not exist. The old
 * version of this file read that absence as a ceiling and declared, on every
 * payload, that `overflow`, `object-fit`, `position`, flex/grid and `height` "cannot
 * arrive". They can, and now they do.
 *
 * Sending all of `getComputedStyle` instead is still not the improvement: it is
 * ~340 properties per node, megabytes on a real page, and it would not tell Figma
 * which of them it is supposed to honour.
 */
export const H2D_PROPS = [
  'alignItems',
  'backgroundAttachment', 'backgroundBlendMode', 'backgroundClip', 'backgroundColor',
  'backgroundImage', 'backgroundOrigin', 'backgroundPositionX', 'backgroundPositionY',
  'backgroundRepeat', 'backgroundSize',
  'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius',
  'borderTopColor', 'borderTopStyle', 'borderTopWidth',
  'borderRightColor', 'borderRightStyle', 'borderRightWidth',
  'borderBottomColor', 'borderBottomStyle', 'borderBottomWidth',
  'borderLeftColor', 'borderLeftStyle', 'borderLeftWidth',
  'bottom', 'boxShadow', 'boxSizing', 'color',
  'columnGap', 'columnRuleColor',
  'display', 'flexDirection', 'flexShrink',
  'fontFamily', 'fontSize', 'fontStyle', 'fontWeight',
  'gridTemplateColumns', 'gridTemplateRows',
  'height', 'justifyContent', 'left', 'letterSpacing', 'lineHeight',
  'marginBottom', 'marginLeft', 'marginRight', 'marginTop',
  'maxWidth', 'minHeight', 'minWidth', 'objectFit', 'opacity', 'outlineColor',
  'overflow', 'overflowX', 'overflowY',
  'paddingBottom', 'paddingLeft', 'paddingRight', 'paddingTop',
  'position', 'right', 'rowGap',
  'textAlign', 'textDecorationColor', 'textDecorationLine', 'textDecorationStyle',
  'textTransform', 'top', 'transform', 'transformOrigin', 'verticalAlign', 'width',
]

/**
 * The two properties their serializer sends on EVERY node and this one sends on
 * none.
 *
 * Measured on the images capture: `outlineWidth: "3px"` and `columnRuleWidth:
 * "1.5px"` on all 26 elements, byte-identical, while `getComputedStyle` on the same
 * live elements answers `0px` for both — outline-style and column-rule-style are
 * `none` there, so the used width is zero and nothing is painted. Constant across
 * every node, absent from the page: they are a default table inside their
 * extension leaking into the payload, not information about the document.
 *
 * They are dropped rather than mirrored because the failure is asymmetric. If Figma
 * ignores them, mirroring costs bytes; if Figma ever reads a width without checking
 * its style, mirroring paints a 3px stroke around every layer of the paste.
 */
const H2D_CONSTANT_JUNK = new Set(['outlineWidth', 'columnRuleWidth'])

/**
 * The properties whose Typed OM value their payload repeats in `computedStyles`.
 *
 * NOT the whole list, and the exclusions are measured, not assumed: on the same
 * capture `gridTemplateRows` (resolved `168.398px`, computed `none`) and the
 * avatar's `left`/`top` (resolved `-8.63px`, computed `-16%`) also differ between
 * the two APIs and are NOT in `computedStyles`. What is there is sizing and the
 * transform origin.
 */
const H2D_TYPED_EXPORT = ['width', 'height', 'transformOrigin', 'gridTemplateColumns']

/** Border sides: `{sideProp: styleProp}`. See `pickStyles` for why they are special. */
const BORDER_SIDES = {
  borderTopColor: 'borderTopStyle', borderTopWidth: 'borderTopStyle',
  borderRightColor: 'borderRightStyle', borderRightWidth: 'borderRightStyle',
  borderBottomColor: 'borderBottomStyle', borderBottomWidth: 'borderBottomStyle',
  borderLeftColor: 'borderLeftStyle', borderLeftWidth: 'borderLeftStyle',
}

/** Empty is empty. A property with no value says nothing that its absence does not. */
const EMPTY_VALUES = new Set([''])

/**
 * Attributes this engine or snapdom stamped on the clone, which describe the
 * CAPTURE and not the page. They are cut so the payload cannot be read as a
 * record of markup the user never wrote.
 */
const CAPTURE_ATTR_RE = /^data-snapdom/

/**
 * Elements whose visible text is not in the DOM at all. Their content is IDL
 * state (`input.value`), a platform-drawn popup (`<option>`) or a UA-rendered
 * bar (`<progress>`), and none of it is a text node anything can walk.
 */
const CONTROL_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'PROGRESS', 'METER'])

/** Two decimals is the precision their own payload carries (`y: 123.19`). */
function r2 (v) { return Math.round(v * 100) / 100 }

/**
 * Properties sent on every node no matter what they are worth.
 *
 * Both were measured against their payload rather than reasoned about. `display`
 * arrives as `inline` on the six inline elements of the capture — the initial value,
 * which every other property gets dropped for — and `transformOrigin` arrives on all
 * 26, always the resolved px pair.
 */
const H2D_ALWAYS = new Set(['display', 'transformOrigin'])

/**
 * Properties whose inclusion is decided on the RESOLVED value, not the computed one.
 *
 * Everything else is decided on the Typed OM value, which is the pre-layout computed
 * value and the only one that can tell `width: auto` from `width: 100%`. These four
 * families are where that reading is blind:
 *
 * - insets: a `position: relative` box has `top: auto` computed and `0px` resolved,
 *   and their payload carries the `0px`. Reading the computed value drops the four
 *   insets on every relatively-positioned node.
 * - grid templates: `grid-template-rows` computes to `none` and resolves to the
 *   track list (`168.398px`). Their payload carries the track list.
 */
const H2D_RESOLVED_DECIDES = new Set([
  'top', 'right', 'bottom', 'left', 'gridTemplateColumns', 'gridTemplateRows',
])

/** camelCase -> the dashed name the Typed OM asks for. */
function dashed (prop) { return prop.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()) }

/**
 * The Typed OM (`computedStyleMap`) value of one property, as a string, or `null`.
 *
 * **`getAll` first, `get` as the fallback.** `get` returns only the FIRST value of a
 * list-valued property, so a two-layer background reads back as `scroll` instead of
 * `scroll, scroll` — which is exactly the initial value, and the property would be
 * dropped as "unchanged" on every node that has two backgrounds. Measured: reading
 * with `get` disagreed with their payload on the whole `background-*` family.
 *
 * Typed OM is Chromium-only. A browser without it makes this return `null`, and the
 * filter falls back to the resolved value — which is the pre-2026-08-07 behaviour,
 * degraded but not broken.
 */
function typedValue (map, prop) {
  if (!map) return null
  const name = dashed(prop)
  try {
    const all = map.getAll(name)
    if (all && all.length) return all.map(String).join(', ')
  } catch { /* not a list-valued property, or not supported */ }
  try {
    const v = map.get(name)
    return v == null ? null : String(v)
  } catch { return null }
}

/** The Typed OM of an element, or null where it does not exist. */
function styleMapOf (el) {
  try { return el.computedStyleMap ? el.computedStyleMap() : null } catch { return null }
}

/**
 * The initial value of every property in `H2D_PROPS`, read off a real element rather
 * than a table: one `all: initial` div, mounted in the same document so it is laid
 * out (a `display: none` probe answers with computed values, which is a different
 * animal and would break every length).
 *
 * This is what makes the payload small: a property is only sent when its value is
 * NOT the initial one, which is the rule their extension applies and the reason two
 * captures of the same extension showed 47 and 79 properties.
 *
 * @param {Document} doc
 * @returns {{resolved: Object<string,string>, typed: Object<string,string|null>, dispose: Function}}
 */
function initialBaseline (doc) {
  const resolved = {}; const typed = {}
  let holder = null
  try {
    holder = doc.createElement('div')
    // The holder carries the offscreen placement so the probe itself can be a clean
    // `all: initial` — putting `position: absolute` on the probe blockifies it, and
    // `display` would then read `block` and be dropped on every block element.
    holder.style.cssText = 'position:absolute!important;left:-99999px!important;top:0!important;' +
      'width:400px!important;height:0!important;overflow:hidden!important;pointer-events:none!important'
    const probe = doc.createElement('div')
    probe.style.cssText = 'all: initial'
    holder.appendChild(probe)
    ;(doc.body || doc.documentElement).appendChild(holder)
    const view = doc.defaultView || (typeof window !== 'undefined' ? window : null)
    const cs = view ? view.getComputedStyle(probe) : null
    const map = styleMapOf(probe)
    for (const prop of H2D_PROPS) {
      resolved[prop] = cs ? cs[prop] : ''
      typed[prop] = typedValue(map, prop)
    }
  } catch { /* no document to probe: every value stays undefined and nothing is dropped */ }
  return { resolved, typed, dispose: () => { try { holder && holder.remove() } catch {} } }
}

/**
 * One element's `styles`: the resolved value of every property that is not at its
 * initial value.
 *
 * Three exceptions, all measured against their payload and each one a bug if it is
 * dropped — see `H2D_ALWAYS`, `H2D_RESOLVED_DECIDES` and `BORDER_SIDES`. A fourth is
 * about the VALUE and not the inclusion: when the computed value is the keyword
 * `auto`, that keyword is what travels, not the used length. Their payload carries
 * `marginLeft: "auto"` for the centred banner, where `getComputedStyle` answers
 * `7.75px` — a number that is the outcome of the centring, and that would pin the
 * image to a fixed offset on the other side.
 *
 * @param {CSSStyleDeclaration} cs  resolved styles, off the CLONE
 * @param {StyleMap|null} map  Typed OM, off the LIVE element when there is one
 * @param {{resolved:Object,typed:Object}} base
 */
function pickStyles (cs, map, base) {
  const styles = {}
  for (const prop of H2D_PROPS) {
    if (H2D_CONSTANT_JUNK.has(prop)) continue
    const value = cs[prop]
    if (value == null || EMPTY_VALUES.has(value)) continue
    const sideStyle = BORDER_SIDES[prop]
    // A side with no border still has a colour and a width, and their payload sends
    // neither. Both are `currentColor`/`medium` resolved against a box that paints
    // nothing, so they describe the text colour, not a border anybody drew.
    if (sideStyle && cs[sideStyle] === 'none') continue

    const typed = H2D_RESOLVED_DECIDES.has(prop) ? null : typedValue(map, prop)
    if (!H2D_ALWAYS.has(prop)) {
      const mine = typed != null ? typed : value
      const initial = typed != null ? base.typed[prop] : base.resolved[prop]
      if (initial !== undefined && mine === initial) continue
    }
    styles[prop] = typed === 'auto' ? 'auto' : normalizeValue(prop, value)
  }
  return styles
}

/**
 * `computedStyles`: the Typed OM value where it says something the resolved one
 * cannot.
 *
 * **This is the fill/hug signal.** `width: 100%` resolves to `229px`, and a payload
 * that only carries the px describes a fixed-width layer; the percentage is what says
 * the box was sized by its parent. Their capture carries exactly four properties this
 * way — `width`, `height`, `transformOrigin` and `gridTemplateColumns` — and NOT the
 * others that also differ between the two APIs (`gridTemplateRows`, and the avatar's
 * `left`/`top` at `-16%`/`-12%`), which is why this list is transcribed and not
 * derived. `auto` is excluded: it differs from the resolved length on almost every
 * node and their payload never carries it.
 *
 * It is read from the LIVE element, never from the clone: snapdom resolves the
 * author's `100%` into a px on the clone, so the clone cannot answer this question.
 */
function pickComputedStyles (cs, map) {
  const out = {}
  for (const prop of H2D_TYPED_EXPORT) {
    const typed = typedValue(map, prop)
    if (typed == null || typed === 'auto') continue
    if (typed !== cs[prop]) out[prop] = typed
  }
  return out
}

/**
 * The value as their payload writes it.
 *
 * `font-family` is the one that is not verbatim: `getComputedStyle` quotes any family
 * with a space (`"Segoe UI"`) and their payload does not. It is the string Figma
 * matches a font against, so the difference is not cosmetic.
 */
function normalizeValue (prop, value) {
  if (prop === 'fontFamily') return value.replace(/"/g, '')
  return value
}

/**
 * @typedef {object} H2DResult
 * @property {Array<object>} payload  the document array, ready to serialise
 * @property {Array<{code:string,severity:string,message:string}>} diagnostics
 * @property {{nodes:number,textNodes:number,skipped:number,truncated:boolean,
 *   fonts:number,dataUriAttrs:number}} stats
 */

/**
 * Walk a MOUNTED clone into the h2d payload.
 *
 * Coordinates: every rect is measured on the clone and then re-expressed in the
 * live page's document coordinates — the clone's own root origin is subtracted
 * (which cancels the ~-99999px offscreen mount) and `docOrigin` is added back.
 * The result is byte-identical in meaning to what the probe produced off the live
 * DOM, which is the shape Figma is known to accept.
 *
 * @param {Element} clone  the mounted clone root
 * @param {object} opts
 * @param {{x:number,y:number}} opts.docOrigin  the LIVE root's document position
 * @param {{width:number,height:number}} opts.rootSize  the LIVE root's border box
 * @param {Map<Node,Node>} [opts.nodeMap]  clone node -> live node, for the authored
 *   sizing the clone no longer has. Without it every node loses `computedStyles`.
 * @param {string} [opts.documentTitle]
 * @param {number} [opts.devicePixelRatio=1]
 * @param {string|Function|Array} [opts.exclude]
 * @param {number} [opts.maxNodes=20000]
 * @returns {H2DResult}
 */
export function cloneToH2d (clone, opts = {}) {
  const docOrigin = opts.docOrigin || { x: 0, y: 0 }
  const rootSize = opts.rootSize || { width: 0, height: 0 }
  const maxNodes = Number.isFinite(opts.maxNodes) && opts.maxNodes > 0 ? opts.maxNodes : 20000
  /** Clone element -> `data:image/svg+xml` for its paint. @see emit/h2d-vector.js */
  const paintOverrides = opts.paintOverrides instanceof Map ? opts.paintOverrides : null
  const exclude = [].concat(opts.exclude || []).filter((r) => typeof r === 'string' || typeof r === 'function')

  const cloneRoot = clone.getBoundingClientRect()
  // Clone viewport coords -> live document coords. Both trees are measured
  // against their OWN root, so the offscreen offset cancels; what is left is the
  // 0.00px-drift geometry the mount is verified to reproduce.
  const dx = docOrigin.x - cloneRoot.left
  const dy = docOrigin.y - cloneRoot.top
  const place = (rect) => ({
    x: r2(rect.left + dx), y: r2(rect.top + dy),
    width: r2(rect.width), height: r2(rect.height),
  })

  const styleCache = new WeakMap()
  const styleOf = (el) => {
    let cs = styleCache.get(el)
    if (!cs) { cs = getComputedStyle(el); styleCache.set(el, cs) }
    return cs
  }

  const diagnostics = []
  const nodeMap = opts.nodeMap
  const doc = clone.ownerDocument || (typeof document !== 'undefined' ? document : null)
  const base = doc ? initialBaseline(doc) : { resolved: {}, typed: {}, dispose: () => {} }
  const state = {
    n: 0, elements: 0, textNodes: 0, skipped: 0, truncated: false,
    dataUriAttrs: 0, excluded: 0, inlineStyles: 0, fonts: new Map(), controls: new Set(),
    measure: makeMeasurer(), base, mapped: 0, unmapped: 0,
    assets: new Map(), assetBytes: 0, remoteAssets: new Set(), imageRefs: 0, svgAssets: 0,
    textStroke: 0, textStrokeSample: null, vectorPaint: 0, whitespaceNodes: 0,
    liveOf: (el) => (nodeMap && typeof nodeMap.get === 'function' ? nodeMap.get(el) : null),
  }

  const isExcluded = (el) => matchesExclusion(el, exclude)

  /**
   * One element. Returns null for an element that generates no box at all —
   * `<style>`, `<script>`, `<defs>` and everything under it, an `<option>` the
   * platform draws itself, a `display:none` subtree. Their rect is the all-zero
   * rect, and a node placed at the document origin with no size is not a
   * degraded version of that element: it is a frame the person pasting has to
   * find and delete.
   */
  const walk = (el) => {
    if (state.n >= maxNodes) { state.truncated = true; return null }
    if (isExcluded(el)) { state.excluded++; return null }
    const rect = el.getBoundingClientRect()
    const boxed = rect.width || rect.height || rect.left || rect.top ||
      (el.getClientRects && el.getClientRects().length > 0)
    if (!boxed) { state.skipped++; return null }

    if (CONTROL_TAGS.has(el.tagName)) state.controls.add(el.tagName)
    const cs = styleOf(el)
    // The clone answers what the box LOOKS like; the live element answers what the
    // author WROTE. `width: 100%` only exists on the second one — snapdom resolves it
    // into a px on the clone — and it is the difference between a layer that fills its
    // parent in Figma and one pinned to 229px. Nodes snapdom invented (a `::before`
    // made real, a flattened shadow tree) have no live twin and lose only this.
    const live = state.liveOf(el)
    if (live) state.mapped++; else state.unmapped++
    const map = styleMapOf(live || el)
    // An inline <svg> is the one element this channel cannot describe as a box, and
    // the one Figma vectorises when it arrives as an asset (see `inlineSvgDataUri`).
    // The node keeps its place, its size and its styles; only its INSIDE changes hands.
    // The zero-area <svg> is snapdom's own `inline-defs-container`, and any other one
    // paints nothing either: as an asset it would be an empty image, and it is the
    // holder the defs are pulled OUT of, not a drawing.
    let svgUri = el.localName === 'svg' && opts.inlineSvgAsAsset !== false &&
      rect.width >= 1 && rect.height >= 1
      ? inlineSvgDataUri(el, clone)
      : ''
    // The hybrid. `paintOverrides` is filled by `emit/h2d-vector.js` with the nodes
    // whose paint this channel cannot spell at all — a conic gradient, a filter, a
    // clip-path — drawn as vector by the SVD backend. It wins over the inline-<svg>
    // rule because a filtered <svg> needs the filter, not the markup.
    const override = paintOverrides && paintOverrides.get ? paintOverrides.get(el) : null
    if (override) { svgUri = override; state.vectorPaint++ }
    const node = {
      nodeType: 1,
      id: `h2d-node-${++state.n}`,
      tag: svgUri ? 'IMG' : el.tagName,
      attributes: svgUri ? svgImgAttributes(el, rect, svgUri) : attributesOf(el, state),
      styles: pickStyles(cs, map, state.base),
      rect: place(rect),
      childNodes: [],
      computedStyles: pickComputedStyles(cs, map),
    }
    collectAssets(el, node, state)
    state.elements++
    // Its children are the asset's contents now. Sending them as well would paint the
    // drawing twice — once as vectors and once as the empty frames this replaced.
    if (svgUri) { if (!override) state.svgAssets++; return node }

    let sawText = false
    for (const child of el.childNodes) {
      if (child.nodeType === 3) {
        const t = textNode(child, state, place, maxNodes)
        if (t) { node.childNodes.push(t); sawText = true }
      } else if (child.nodeType === 1) {
        const sub = walk(child)
        if (sub) node.childNodes.push(sub)
      }
    }
    // Fonts are collected only where text actually is. A family listed for a
    // wrapper that paints no glyph is a font Figma may go looking for.
    if (sawText) {
      collectFont(state, cs)
      // `-webkit-text-stroke` is outside the property list and cannot be added to it:
      // it is not in their capture, so what Figma does with it is unknown and sending
      // it is guessing. What is NOT acceptable is losing it in silence — an outlined
      // headline whose fill was chosen to be invisible without the stroke arrives as
      // blank space, and no other diagnostic here would mention it.
      const sw = parseFloat(cs.webkitTextStrokeWidth || cs.WebkitTextStrokeWidth || '0')
      if (sw > 0) {
        state.textStroke++
        if (!state.textStrokeSample) {
          state.textStrokeSample = { fill: cs.color, stroke: cs.webkitTextStrokeColor || '', width: `${sw}px` }
        }
      }
    }
    return node
  }

  // `finally`, for the same reason the clone is unmounted in one: the baseline is a
  // real element in the user's document, and a throw between here and its removal
  // would leave it there.
  let root
  try { root = walk(clone) } finally { base.dispose() }
  if (!root) {
    throw new Error(
      'toVectorFigmaClipboard: the clone root generates no box, so there is nothing to paste. ' +
      'This is the same condition `toVector` refuses on, reached one step later.'
    )
  }

  const payload = [{
    documentTitle: opts.documentTitle || '',
    root,
    // As in the probe: the capture's own box at the origin, while the node rects
    // are document coordinates. The two disagree, and that is the shape that was
    // verified to import — Figma places the tree from `root.rect`. Left alone
    // rather than "fixed" into a shape nobody has pasted.
    documentRect: { x: 0, y: 0, width: Math.round(rootSize.width), height: Math.round(rootSize.height) },
    viewportRect: { x: 0, y: 0, width: rootSize.width, height: rootSize.height },
    devicePixelRatio: Number.isFinite(opts.devicePixelRatio) ? opts.devicePixelRatio : 1,
    version: H2D_VERSION,
    assets: Object.fromEntries(state.assets),
    fonts: Object.fromEntries(state.fonts),
  }]

  declare(diagnostics, state, payload[0])

  return {
    payload,
    diagnostics,
    stats: {
      nodes: state.elements,
      textNodes: state.textNodes,
      skipped: state.skipped,
      excluded: state.excluded,
      truncated: state.truncated,
      fonts: state.fonts.size,
      dataUriAttrs: state.dataUriAttrs,
      inlineStyles: state.inlineStyles,
      assets: state.assets.size,
      svgAssets: state.svgAssets,
      vectorPaint: state.vectorPaint,
      whitespaceNodes: state.whitespaceNodes,
      assetBytes: state.assetBytes,
      mapped: state.mapped,
      unmapped: state.unmapped,
    },
  }
}

/**
 * A text node, with its own box. Measured with a `Range`, like their payload:
 * a text node is not an element and has no `getBoundingClientRect` of its own,
 * and `lineCount` is the number of client rects the range produces — one per
 * visual line, which is how Figma knows a paragraph wrapped.
 *
 * The whitespace test is on the RECTS, not on `trim()`: the single space between
 * two inline elements is a real box the page paints, while the newline and
 * indentation between two block tags collapse to nothing. Trimming drops both,
 * and the first one closes up a gap the page has.
 */
function textNode (child, state, place, maxNodes) {
  if (state.n >= maxNodes) { state.truncated = true; return null }
  const text = child.textContent
  if (!text) return null
  const range = child.ownerDocument.createRange()
  range.selectNodeContents(child)
  const rects = [...range.getClientRects()]
  const painted = rects.some((r) => r.width > 0 && r.height > 0)
  if (!painted) {
    // Whitespace between two block elements paints nothing, and this backend used to
    // drop it. Their extension does NOT: measured on the images capture, their payload
    // carries 42 text nodes where ours carried 16, and the 26 extra are exactly these —
    // `"\n      "` with an all-zero rect and `lineCount: 0`. It was the last structural
    // difference left between the two payloads, and a consumer that assembles a
    // paragraph out of child nodes is a consumer whose input we should not be editing.
    // Kept as its own branch, and out of `textNodes`, because it is not text anyone
    // reads — it is shape.
    if (!text.trim()) {
      state.whitespaceNodes++
      return { nodeType: 3, id: `h2d-node-${++state.n}`, text, rect: { x: 0, y: 0, width: 0, height: 0 }, lineCount: 0 }
    }
    state.skipped++
    return null
  }
  state.textNodes++
  return {
    nodeType: 3,
    id: `h2d-node-${++state.n}`,
    text,
    rect: place(range.getBoundingClientRect()),
    lineCount: rects.length,
  }
}

/**
 * The URL an `<img>` actually painted, and the key its pixels are filed under.
 *
 * `currentSrc` is an IDL property, not an attribute — it does not appear in
 * `el.attributes` and no amount of copying markup produces it. Their payload puts it
 * INTO the attributes map, in place of `src`, and files the bytes in `assets` under
 * that same string. It is also the only correct answer for `srcset`: the browser
 * already chose a candidate against the viewport and the DPR, and `src`/`srcset`
 * describe the choice rather than the result.
 *
 * **It asks the LIVE element first, and that is not a detail.** snapdom re-rasterises
 * raster images while cloning, at something near their painted size: measured on the
 * images fixture (2026-08-07), a 720×480 PNG that the page holds as a data URI comes
 * back off the clone at 435 px wide — the same picture, 63 kB instead of 77 kB, and
 * 40% of the pixels gone. That is the right trade for snapdom, whose output is a
 * bitmap of a known size. It is the wrong one here: the paste is meant to be EDITED,
 * and the first person to scale that layer up in Figma is looking at a blur. Their
 * extension ships the full 720×480 because it reads the live DOM and never had a
 * downscaled copy to choose from.
 *
 * The live source is preferred only when it is a `data:` URI, i.e. only when it is
 * bytes this file can actually use. When the page points at a remote URL that snapdom
 * fetched and inlined, the clone's copy is the ONLY reachable one — `addAsset` is
 * synchronous and cannot go fetch anything — so in that case the downscale is kept
 * rather than trading real pixels for a URL Figma may not be allowed to load.
 */
function imageSource (el, state) {
  if (el.tagName !== 'IMG') return ''
  const own = (() => {
    try { return el.currentSrc || el.getAttribute('src') || '' } catch { return '' }
  })()
  const live = state && state.liveOf ? state.liveOf(el) : null
  if (live && live.tagName === 'IMG') {
    try {
      const src = live.currentSrc || live.getAttribute('src') || ''
      if (src.startsWith('data:')) return src
    } catch { /* a cross-origin or detached live node just leaves `own` in place */ }
  }
  return own
}

/**
 * The element's attributes, minus the capture's own bookkeeping.
 *
 * They travel because this is the channel's whole idea — Figma reads the DOM. Their
 * extension is stricter than this (its capture carries `id`, `alt` and `currentSrc`
 * and drops even `class`), and the one place that strictness is copied is the image
 * candidates: `src`, `srcset` and `sizes` are cut on an `<img>` because snapdom has
 * already inlined the pixels into `src` as a data URI, and keeping it would put the
 * same bytes in the payload a fourth time — they already travel as `currentSrc`, as
 * the `assets` key, and as the blob.
 */
function attributesOf (el, state) {
  const out = {}
  const src = imageSource(el, state)
  if (src) out.currentSrc = src
  if (!el.attributes) return out
  for (const attr of el.attributes) {
    if (CAPTURE_ATTR_RE.test(attr.name)) continue
    if (attr.name === 'data-vector-exclude') continue
    if (src && (attr.name === 'src' || attr.name === 'srcset' || attr.name === 'sizes')) continue
    // `style` is CUT, and it is the one attribute that is not the page's.
    // snapdom writes its own normalisation onto every clone node — measured on
    // `demo/vector.html`'s fx-card, 18 of 18 nodes carry
    // `margin:0;inset:auto;animation:…;transition:none;will-change:auto;float:none;
    // clear:none;box-shadow:…;filter:none;background-position:…`, 4 727 of the
    // payload's 31 094 bytes. Nothing is lost by dropping it: every declaration in
    // it is already resolved into the computed values in `styles`, which is the
    // channel Figma's own payload uses. Passing it on would put a reset
    // (`margin:0`, `float:none`) next to those values for an importer that may
    // read either, and would describe the user's markup as something it is not.
    if (attr.name === 'style') { state.inlineStyles++; continue }
    out[attr.name] = attr.value
    if (attr.value.startsWith('data:')) state.dataUriAttrs++
  }
  return out
}

/**
 * Every `url(...)` in a value, unquoted.
 *
 * Hand-scanned instead of `/url\((['"]?)(.*?)\1\)/`, because a regex like that reads
 * an inlined SVG wrong: snapdom's `data:image/svg+xml,…` payloads contain `url(%23t)`
 * for their own gradient references, so the first `)` inside the data URI ends the
 * match early and the engine files a fragment — or, worse, matches the INNER `url(`
 * and reports `%23t` as an image it could not fetch. Measured on `#im-hero`, whose
 * two-layer background produced four regex hits and one usable URL.
 */
function urlsIn (value) {
  const out = []
  let i = 0
  while ((i = value.indexOf('url(', i)) !== -1) {
    let j = i + 4
    while (j < value.length && /\s/.test(value[j])) j++
    const quote = value[j] === '"' || value[j] === "'" ? value[j] : ''
    if (quote) {
      const end = value.indexOf(quote, j + 1)
      if (end === -1) break
      out.push(value.slice(j + 1, end))
      i = end + 1
    } else {
      // Unquoted: balance the parens, so the `url(%23t)` inside an inlined SVG closes
      // its own bracket instead of this one.
      let depth = 1; let k = j
      for (; k < value.length; k++) {
        if (value[k] === '(') depth++
        else if (value[k] === ')' && --depth === 0) break
      }
      out.push(value.slice(j, k).trim())
      i = k + 1
    }
  }
  return out
}

/**
 * Every image this node paints, into the payload's `assets` map.
 *
 * **The shape is no longer a guess.** A capture of their extension over the images
 * fixture (2026-08-07) carries it, and it is a flat map keyed by the URL string
 * exactly as the node spells it — `attributes.currentSrc` for an `<img>`, the inside
 * of `url(...)` for a background:
 *
 * ```json
 * "assets": { "<url>": { "url": "<the same url>",
 *   "blob": { "type": "image/png", "base64Blob": "data:application/octet-stream;base64,…" } } }
 * ```
 *
 * `base64Blob` is the RAW bytes, base64'd, under a generic media type: for a
 * `data:image/png;base64,…` source it is the same base64 back, and for a
 * percent-encoded SVG it is the decoded markup. Verified byte for byte on all four
 * assets of that capture. Two `<img>`s pointing at one URL share one entry.
 *
 * The cost is real and worth saying out loud: with snapdom having inlined everything,
 * one 77 kB PNG travels three times in this payload — the `currentSrc`, the key, and
 * the blob. Their own capture is 560 kB of JSON for a 713×420 box, and 309 kB of that
 * is one photograph repeated.
 */
/**
 * An inline `<svg>` re-carried as an `image/svg+xml` asset instead of as a tree of
 * CSS boxes.
 *
 * **Measured in Figma, 2026-08-07, `demo/hybrid-probe.html` pasted three ways.** Sent
 * the way every other element is sent — `svg`, `circle` and `path` as nodes with their
 * attributes and their rects — Figma imports an EMPTY FRAME. Their own extension gets
 * the same drawing to arrive, and an SVG asset of ours arrives too, **as vectors**:
 * paths inside a group, not an image fill. So the fix is not to send the subtree
 * better, it is to stop sending it as a subtree.
 *
 * The `<defs>` pass is DEFENSIVE, not measured. snapdom keeps an `inline-defs-container`
 * of its own next to the drawing, so a paint server can end up outside the `<svg>` that
 * references it, and serialising the element alone would then produce markup whose
 * `fill="url(#hg2)"` points at nothing. On the probe it did not happen — the gradient
 * stayed inside and resolved on its own — so what is verified is that the pass costs
 * nothing when there is nothing to fix, not that it rescues a case that was observed.
 * Ids are resolved out of the clone transitively, because a gradient can reference
 * another, and capped, because a circular reference must not hang a clipboard write.
 *
 * @param {Element} el   the `<svg>` on the clone
 * @param {Node}    root the clone, where the hoisted defs live
 * @returns {string} a `data:image/svg+xml` URI, or '' if it could not be serialised
 */
function inlineSvgDataUri (el, root) {
  let markup = ''
  try { markup = new XMLSerializer().serializeToString(el) } catch { return '' }
  if (!markup.startsWith('<svg')) return ''

  const REFS = /url\(#([^)"']+)\)|(?:xlink:)?href="#([^"]+)"/g
  const defs = []
  const taken = new Set()
  // Transitive, capped: a gradient can reference a gradient. Three passes is well past
  // anything a page produces, and a cap is what keeps a circular reference from hanging
  // a clipboard write.
  for (let pass = 0; pass < 3; pass++) {
    const pending = []
    const scope = markup + defs.join('')
    for (const m of scope.matchAll(REFS)) {
      const id = m[1] || m[2]
      if (!id || taken.has(id)) continue
      if (new RegExp(`id="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(scope)) continue
      pending.push(id)
    }
    if (!pending.length) break
    for (const id of pending) {
      taken.add(id)
      let found = null
      const sel = `[id="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id}"]`
      try { found = (root && root.querySelector && root.querySelector(sel)) || null } catch { found = null }
      if (!found) { try { found = el.ownerDocument.getElementById(id) } catch { /* detached */ } }
      if (found) { try { defs.push(new XMLSerializer().serializeToString(found)) } catch { /* skip */ } }
    }
  }
  if (defs.length) markup = markup.replace(/^(<svg\b[^>]*>)/, `$1<defs>${defs.join('')}</defs>`)

  if (!/\sxmlns=/.test(markup)) {
    markup = markup.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"')
  }
  // Without an intrinsic size a data URI in an <img> is rendered at the UA default,
  // not at the box it occupied on the page.
  if (!/\swidth=/.test(markup.slice(0, markup.indexOf('>')))) {
    const r = el.getBoundingClientRect()
    markup = markup.replace(/^<svg\b/, `<svg width="${Math.round(r.width)}" height="${Math.round(r.height)}"`)
  }
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup)
}

/**
 * The `<img>` attributes for an inline `<svg>` carried as an asset. Same shape their
 * extension gives a real image — `currentSrc` and not `src` — so nothing downstream
 * has to know this node was something else on the page.
 */
function svgImgAttributes (el, rect, uri) {
  const attrs = { currentSrc: uri, width: String(Math.round(rect.width)), height: String(Math.round(rect.height)) }
  for (const name of ['id', 'class', 'role']) {
    const v = el.getAttribute && el.getAttribute(name)
    if (v) attrs[name] = v
  }
  const label = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))
  if (label) attrs.alt = label
  return attrs
}

function collectAssets (el, node, state) {
  const src = node.attributes && node.attributes.currentSrc
  if (src) {
    state.imageRefs++
    if (src.startsWith('data:')) state.dataUriAttrs++
    addAsset(state, src)
  }
  const bg = node.styles && node.styles.backgroundImage
  if (bg && bg.includes('url(')) {
    for (const url of urlsIn(bg)) { state.imageRefs++; addAsset(state, url) }
  }
}

/**
 * One entry, or a recorded reason there is none.
 *
 * A URL that is not a data URI cannot be turned into bytes from here: this function
 * is synchronous, the payload has to be on the clipboard inside the user gesture that
 * asked for it, and fetching would need both a round trip and CORS permission the page
 * may not have. It should not happen — snapdom inlines every image it can reach before
 * this backend runs — so when it does it is recorded and declared rather than silently
 * shipped as a live URL that Figma may or may not go and fetch.
 */
function addAsset (state, url) {
  if (!url || state.assets.has(url)) return
  if (!url.startsWith('data:')) { state.remoteAssets.add(url.slice(0, 120)); return }
  const comma = url.indexOf(',')
  if (comma < 0) return
  const head = url.slice(5, comma)
  const body = url.slice(comma + 1)
  const isB64 = /;base64$/i.test(head)
  const type = head.replace(/;base64$/i, '').split(';')[0] || 'application/octet-stream'
  let base64
  try {
    base64 = isB64 ? body.replace(/\s+/g, '') : b64(decodeURIComponent(body))
  } catch { return }
  state.assets.set(url, {
    url,
    blob: { type, base64Blob: `data:application/octet-stream;base64,${base64}` },
  })
  state.assetBytes += base64.length
}

/**
 * `fontBoundingBoxAscent/Descent` per exact font string, cached on that string
 * and never on the family: Chromium rounds those to integers per size, so an
 * ascent scaled from another size can be a whole pixel out. Same rule as
 * `makeCtx.measureFont` in `index.js`.
 */
function makeMeasurer () {
  const cache = new Map()
  let ctx = null
  try { ctx = document.createElement('canvas').getContext('2d') } catch { ctx = null }
  return (fontCss) => {
    if (cache.has(fontCss)) return cache.get(fontCss)
    let out = null
    if (ctx) {
      ctx.font = fontCss
      // A shorthand the context refuses leaves the PREVIOUS font in place, and
      // the numbers would then describe some other face.
      if (ctx.font) {
        const m = ctx.measureText('Hxg')
        if (Number.isFinite(m.fontBoundingBoxAscent)) {
          out = {
            fontBoundingBoxAscent: Math.round(m.fontBoundingBoxAscent),
            fontBoundingBoxDescent: Math.round(m.fontBoundingBoxDescent),
          }
        }
      }
    }
    cache.set(fontCss, out)
    return out
  }
}

/**
 * One element's typography into the `fonts` map: family -> `{familyName, faces,
 * usages}`, one usage per distinct size/weight/style/stretch.
 *
 * `faces` is empty and stays empty: this engine embeds no font bytes on any
 * backend. The family travels by NAME and the destination substitutes what it
 * has — the same trade `assets.font-not-embedded` declares on the SVD path.
 */
function collectFont (state, cs) {
  const stack = cs.fontFamily
  if (!stack) return
  const key = stack.split(',')[0].replace(/["']/g, '').trim()
  if (!key) return
  let entry = state.fonts.get(key)
  if (!entry) { entry = { familyName: key, faces: [], usages: [] }; state.fonts.set(key, entry) }
  const usage = {
    fontWeight: cs.fontWeight, fontStyle: cs.fontStyle,
    fontStretch: cs.fontStretch, fontSize: cs.fontSize,
  }
  for (const u of entry.usages) {
    if (u.fontSize === usage.fontSize && u.fontWeight === usage.fontWeight &&
        u.fontStyle === usage.fontStyle && u.fontStretch === usage.fontStretch) return
  }
  // Measured against the STACK, not the family alone: the stack is what the page
  // laid out with, and the first family may not be the one that won.
  const metrics = state.measure(`${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${stack}`)
  if (metrics) usage.metrics = metrics
  entry.usages.push(usage)
}

/**
 * What this payload does not carry. Every one of these is a silent loss on the
 * other side — an undocumented format does not reject a field, it ignores it —
 * so the only defence is saying it here, on every capture.
 */
export const H2D_ASSETS_NOTE =
  '`assets` is filled from a DECODED capture of their extension (2026-08-07, the images fixture), not ' +
  'from documentation: a flat map keyed by the URL the node spells, each entry `{url, blob:{type, ' +
  'base64Blob}}` with the raw bytes base64\'d under `data:application/octet-stream;base64,`. Verified ' +
  'byte for byte against their four assets. What is NOT verified is what Figma does with it — whether ' +
  'it reads pixels from here, from `currentSrc`, or from either — because nobody has pasted a payload ' +
  'with one and not the other. The bytes are the page\'s own whenever the live node still spells a ' +
  'data URI (`imageSource`, via `nodeMap`): snapdom re-rasterises while cloning — the same fixture\'s ' +
  '720x480 PNG comes off the clone at 435x290, right for a bitmap export and wrong for a paste meant ' +
  'to be edited. Where the page points at a remote URL snapdom inlined, the clone\'s downscaled copy ' +
  'is the only one reachable from a synchronous clipboard write, and that one IS below source size.'

function declare (diagnostics, state, doc) {
  const push = (code, severity, message) => diagnostics.push({ code, severity, message })

  push('h2d.proprietary-format', 'warn',
    'This payload is Figma\'s own clipboard format: proprietary, undocumented, already at ' +
    `version ${H2D_VERSION}, and reverse-engineered from ONE decoded capture of their extension ` +
    '(FIGMA_FINDINGS.md, «El canal h2d acepta datos propios»). Figma can change it in any release ' +
    'with no version negotiation and no error: the only symptom is that a paste does nothing. ' +
    'It is also Figma-only — no other tool opens it, which is why the SVG backend is not retired.')

  // Only when this capture HAS images. "No assets" on a fixture with no image is not a
  // finding, and a warning that fires on every text-only capture is a warning nobody reads.
  if (state.imageRefs) {
    push('h2d.assets', state.assets.size ? 'info' : 'warn', H2D_ASSETS_NOTE +
      (state.assets.size
        ? ` This payload carries ${state.assets.size} asset(s), ${Math.round(state.assetBytes / 1024)} kB of ` +
          'base64. Each one is in here THREE times — the node\'s `currentSrc` or `url(…)`, the map key, and ' +
          'the blob — because that is the shape their extension produces.'
        : ` ${state.imageRefs} image reference(s) in this capture produced NO asset, so nothing in it can ` +
          'arrive from that side.'))
  }

  if (state.textStroke) {
    const s = state.textStrokeSample || {}
    push('h2d.text-stroke-dropped', 'warn',
      `${state.textStroke} text block(s) paint their glyphs with \`-webkit-text-stroke\`, which this ` +
      'channel does not send: it is not in their extension\'s capture either, so what Figma reads is ' +
      'unknown and sending it would be a guess. The glyphs arrive with their FILL only. Where the fill ' +
      'was chosen on the assumption that the outline is doing the work, the text arrives unreadable — ' +
      `measured on \`demo/challenges.html\` → fx-type: fill ${s.fill}, outline ${s.width} ${s.stroke}, ` +
      'over a white card, so that line pastes as blank space. This is the one place in this payload ' +
      'where text can vanish without the box vanishing with it.')
  }

  if (state.svgAssets) {
    push('h2d.inline-svg-as-asset', 'info',
      `${state.svgAssets} inline <svg> element(s) were re-carried as image/svg+xml assets instead of as ` +
      'trees of CSS boxes. Measured in Figma (2026-08-07, demo/hybrid-probe.html): sent as nodes the ' +
      'drawing imports as an EMPTY FRAME — a <path> has no CSS box for the channel to describe — and ' +
      'sent as an asset it imports AS VECTORS, paths in a group, not an image fill. Their own extension ' +
      'gets the drawing to arrive too, so this is parity, not an extra. What is lost is the DOM shape: ' +
      'the individual <path>/<circle> are no longer nodes in this payload, and any CSS the page applied ' +
      'to them from outside the <svg> is only in the asset if it reached the clone as a presentation ' +
      'attribute. Turn it off with `inlineSvgAsAsset: false` to get the old empty frames back.')
  }

  push('h2d.style-subset', 'info',
    `Each node carries, of the ${H2D_PROPS.length} properties transcribed from two captures of their ` +
    'extension, the ones whose value is not the initial one — the same filter theirs applies, which is ' +
    'why a property missing from a node is a property that was at its default. `outline-width` and ' +
    '`column-rule-width` are the two this engine deliberately does NOT send: their serializer emits a ' +
    'constant 3px/1.5px on every node while the page resolves both to 0px, and a width with no style is ' +
    'a stroke waiting to be drawn. Anything outside the list — `mix-blend-mode`, `filter`, `z-index`, ' +
    '`gap` shorthands — is not sent, because sending it means guessing what Figma reads.')

  if (state.unmapped) {
    push('h2d.unmapped-nodes', 'info',
      `${state.unmapped} of ${state.unmapped + state.mapped} node(s) exist only on the clone — a ` +
      'pseudo-element made real, a flattened shadow tree, an icon font turned into an <img> — so there ' +
      'is no live element to read the AUTHORED sizing off. Their `styles` are complete; what they lose ' +
      'is `computedStyles`, the `width: 100%` that tells Figma the layer fills its parent instead of ' +
      'being pinned to the px it happens to measure.')
  }

  if (state.remoteAssets.size) {
    push('h2d.remote-assets', 'warn',
      `${state.remoteAssets.size} image URL(s) are not data URIs and could not be turned into bytes ` +
      'from inside a synchronous clipboard write, so they are NOT in `assets`: ' +
      `${[...state.remoteAssets].slice(0, 3).join(', ')}. snapdom inlines every image it can reach, so ` +
      'this means one it could not — a CORS-blocked host, or a source added after the clone was taken.')
  }

  push('h2d.no-variable-bindings', 'info',
    'Their payload can carry `variableStyles` (a property -> `--custom-property` map) and this one ' +
    'never does. snapdom RESOLVES custom properties into the clone (`resolveCSSVars`, clone.js:348) — ' +
    'which is what makes every value here final and correct — and a computed value cannot be traced ' +
    'back to the variable that produced it. Colours and sizes arrive right; they arrive unbound, so ' +
    'they will not follow a Figma variable afterwards.')

  push('h2d.fonts-by-name', 'info',
    `${state.fonts.size} font ${state.fonts.size === 1 ? 'family' : 'families'} travel by NAME with ` +
    'their canvas metrics and an empty `faces` array: no backend of this engine embeds font bytes. ' +
    '`styles.fontFamily` carries the whole CSS stack, exactly as their own extension sends it, and ' +
    'which face Figma resolves out of it is Figma\'s decision (FIGMA_FINDINGS.md §5 measured the SVG ' +
    'importer falling to Inter; this channel is not that importer and was not measured the same way).')

  if (state.skipped) {
    push('h2d.boxless-nodes-skipped', 'info',
      `${state.skipped} node(s) generate no box on the clone and were left out: <style>, <script>, SVG ` +
      'paint-server elements, an <option> the platform draws, a display:none subtree. An all-zero rect ' +
      'is not a degraded box — it would land as a sizeless frame at the document origin.')
  }
  if (state.excluded) {
    push('h2d.excluded', 'info',
      `${state.excluded} subtree(s) were dropped by \`exclude\` or by a capture-exclude attribute, the ` +
      'same rules `paint.js` applies on the SVD path.')
  }
  if (state.truncated) {
    push('h2d.node-budget', 'warn',
      `The walk hit its \`maxNodes\` ceiling and STOPPED: this payload is a prefix of the subtree, not ` +
      'all of it. Raise `maxNodes` or capture a smaller element.')
  }
  if (state.controls.size) {
    push('h2d.form-control-text', 'warn',
      `This capture contains ${[...state.controls].join(', ')}, and the TEXT a form control shows is ` +
      'not in the DOM: an input\'s value and placeholder are IDL state, an `<option>` is drawn by the ' +
      'platform\'s own popup, a `<progress>` is drawn by the UA. Measured on `demo/challenges.html` → ' +
      'fx-form: 13 words of the live element\'s textContent — the whole option list of its <select> — ' +
      'are not in this payload, because those <option>s generate no box and were skipped. The control ' +
      'boxes arrive; they arrive EMPTY. It is the same hole the SVD path has (`collect.box.form-control`).')
  }
  if (state.inlineStyles) {
    push('h2d.inline-style-dropped', 'info',
      `The \`style\` attribute was cut from ${state.inlineStyles} node(s): on the clone it is snapdom's ` +
      'own normalisation, not the page\'s markup, and every declaration in it is already resolved into ' +
      'the computed values this payload sends. It is dropped so an importer that reads inline style ' +
      'cannot see a reset that contradicts them.')
  }
  if (state.dataUriAttrs) {
    push('h2d.inline-assets', 'info',
      `${state.dataUriAttrs} attribute(s) carry a data URI inlined by snapdom (images past CORS, ` +
      'resolved icon fonts). They are the whole of the pixel payload while `assets` is empty, and they ' +
      'are why this envelope can be megabytes.')
  }
  const textish = countText(doc.root)
  if (!textish) {
    push('h2d.no-text', 'warn',
      'Not one text node in this payload has a painted box. Either the capture really has no text, or ' +
      'the clone was measured before layout — the second one produces a paste of empty frames.')
  }
}

function countText (node) {
  if (!node) return 0
  if (node.nodeType === 3) return 1
  let n = 0
  for (const c of node.childNodes || []) n += countText(c)
  return n
}

/**
 * The clipboard envelope, verbatim from `h2d_toolbar.js` of their extension
 * 1.3.24: two `<span>`s, each carrying a base64 JSON blob between literal
 * markers, inside an HTML comment inside an attribute.
 *
 * It is written as **`text/html`** with **`text/plain` empty**, which is why a
 * copy made this way looks like an empty clipboard in a text editor. The
 * conversion is triggered by this envelope and by nothing else: pasting raw HTML
 * into Figma was tried and does not import (FIGMA_FINDINGS.md).
 *
 * @param {Array<object>} payload  what `cloneToH2d` returned
 * @param {object} [meta]  the `figmeta` half; source/timestamp, not the drawing
 * @returns {{html: string, plain: string, json: string, bytes: number}}
 */
export function h2dEnvelope (payload, meta = {}) {
  const json = JSON.stringify(payload)
  const metaJson = JSON.stringify({
    dataType: 'h2d',
    source: 'snapdom-vector',
    capturedAtIso: new Date().toISOString(),
    ...meta,
  })
  const html =
    `<span data-metadata="<!--(figmeta)${b64(metaJson)}(/figmeta)-->"></span>` +
    `<span data-h2d="<!--(figh2d)${b64(json)}(/figh2d)-->"></span>`
  return { html, plain: '', json, bytes: json.length }
}

/**
 * UTF-8 -> base64, in chunks.
 *
 * `String.fromCharCode(...bytes)` is the one-liner every probe uses and it blows
 * the argument limit somewhere around 100 kB — which is one inlined screenshot.
 * A payload that throws at exactly the size that makes this backend worth using
 * is not a corner case.
 */
function b64 (s) {
  const bytes = new TextEncoder().encode(s)
  let out = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(out)
}

/**
 * The envelope as a `ClipboardItem`, with the empty `text/plain` half that the
 * channel requires. Kept here because it is the one part that is easy to get
 * silently wrong: a non-empty `text/plain` is what a paste target prefers, and
 * Figma would then receive text instead of a document.
 *
 * Must be called from a user gesture, like any clipboard write.
 *
 * @param {{html: string}} envelope
 * @returns {ClipboardItem}
 */
export function h2dClipboardItem (envelope) {
  return new ClipboardItem({
    'text/html': new Blob([envelope.html], { type: 'text/html' }),
    'text/plain': new Blob([''], { type: 'text/plain' }),
  })
}

export default cloneToH2d
