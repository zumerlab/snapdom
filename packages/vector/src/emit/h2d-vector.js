/**
 * snapdom Pro — the hybrid: the paint that Figma's own clipboard channel cannot
 * describe, generated as vector by this engine's SVD backend and carried inside the
 * same h2d payload.
 *
 * **Why this exists is a measurement, not a preference** (FIGMA_FINDINGS.md, «El
 * híbrido», 2026-08-07). The same page was pasted into Figma twice, once with our
 * payload and once with Figma's own extension, and three of the six hard cases —
 * `conic-gradient`, `filter`/`mix-blend-mode`, `clip-path` — came out broken BOTH
 * times, identically. They are not gaps in this emitter: Figma's importer does not
 * have them. No amount of work on the CSS side of the h2d channel can ever fix them,
 * and their own extension is proof, because it fails the same way.
 *
 * What CAN be fixed is how the paint arrives. In the same experiment, an
 * `image/svg+xml` asset of ours went through the channel and Figma imported it **as
 * paths inside a group** — vectors, not an image fill. Verified in Figma's own panel.
 * So a node whose paint the channel cannot spell is sent as a node whose paint is an
 * SVG this engine drew, and the layer that lands is still editable.
 *
 * **Roles, because they are the opposite of what they sound like.** Figma picks ONE
 * clipboard flavour: writing the SVG and writing the h2d envelope are mutually
 * exclusive, there is no paste that reads both. So the envelope has to be h2d, and
 * `emit/svg-flat.js` stops being a competing channel and becomes the paint generator
 * for the nodes h2d cannot describe. It is not retired — it stays the destination
 * independent output, the one Illustrator and Penpot can open — it just also feeds
 * this one now. And wrapping the WHOLE capture in one SVG asset is not the shortcut
 * it looks like: that is the SVG channel with extra steps, and it loses the
 * `letter-spacing` that this channel was adopted for.
 *
 * Nothing here modifies the SVD or `svg-flat.js`. A slice is a plain object built out
 * of an already-assembled document, and the window is moved by rewriting the emitted
 * root's `viewBox` — the coordinates inside stay exactly as that backend wrote them.
 */

import { svdToSvg } from './svg-flat.js'

/**
 * What the h2d channel cannot say, and therefore what gets drawn instead.
 *
 * Every entry was checked against `H2D_PROPS` — the property list transcribed from two
 * captures of their extension — so this is the complement of what the channel carries,
 * not a wish list. `filter`, `mix-blend-mode`, `clip-path`, `mask-image`,
 * `backdrop-filter` and `border-image` are absent from their capture entirely; a conic
 * gradient DOES travel (it is a `background-image` value) and still arrives as an
 * unfilled box, which is the one entry here that is a failure of the IMPORTER rather
 * than of the wire format.
 *
 * `-webkit-text-stroke` is deliberately NOT here. It is text, and replacing a text
 * block with a drawing costs the editable layer this whole channel exists to keep —
 * `h2d.text-stroke-dropped` declares it instead.
 */
export const FALLBACK_PROBES = [
  { code: 'conic', test: (cs) => /conic-gradient/.test(cs.backgroundImage || '') },
  { code: 'filter', test: (cs) => notNone(cs.filter) },
  { code: 'clip-path', test: (cs) => notNone(cs.clipPath || cs.webkitClipPath) },
  { code: 'mask', test: (cs) => notNone(cs.maskImage || cs.webkitMaskImage) },
  { code: 'border-image', test: (cs) => notNone(cs.borderImageSource) },
]

/**
 * The two the channel cannot say and this module cannot draw either.
 *
 * `mix-blend-mode` and `backdrop-filter` are both functions of what is UNDERNEATH the
 * element, and an asset per node has no underneath: the slice is its own document, its
 * backdrop is transparent, and multiplying against nothing is the same picture. Sent
 * through the fallback they would arrive looking exactly as they do now, having paid
 * for it with the editable layer.
 *
 * They are separated rather than quietly dropped because the first version of this
 * file DID list them, and the probe rendered `mix-blend-mode: multiply` as a flat cyan
 * square — identical to describing it as a box, which is what made the cost visible.
 * Figma has no blend on import either, so nothing is being conceded to their tool.
 */
export const BACKDROP_PROBES = [
  { code: 'blend', test: (cs) => cs.mixBlendMode && cs.mixBlendMode !== 'normal' },
  { code: 'backdrop-filter', test: (cs) => notNone(cs.backdropFilter || cs.webkitBackdropFilter) },
]

const notNone = (v) => !!v && v !== 'none' && v !== 'normal'

/**
 * Does this subtree paint any glyph?
 *
 * The whole policy turns on it. Replacing a node with a drawing replaces its children
 * too, and a paragraph that arrives as vector is a paragraph nobody can retype — which
 * is precisely what the SVG channel was abandoned for. Whitespace does not count: a
 * `\n` between two `<div>`s is not text anyone will edit.
 */
function paintsText (el) {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (t.nodeValue && t.nodeValue.trim()) return true
  }
  return false
}

/**
 * Every node on the clone whose paint has to be drawn rather than described.
 *
 * @param {Element} clone      the MOUNTED clone — computed styles are the whole input
 * @param {object}  [opts]
 * @param {'design'|'replica'} [opts.mode='design'] what to do when the node has text
 *   inside. `design` keeps the text editable and lets the effect go, and says so;
 *   `replica` buys the effect with the text. One engine, a policy per node — which is
 *   the shape the modes were specified with from the start.
 * @param {(el: Element) => boolean} [opts.isExcluded]
 * @returns {{targets: Map<Element, {codes: string[]}>, withheld: Array<{codes: string[], tag: string}>,
 *   backdrop: string[]}}
 */
export function findFallbackTargets (clone, opts = {}) {
  const mode = opts.mode === 'replica' ? 'replica' : 'design'
  const isExcluded = typeof opts.isExcluded === 'function' ? opts.isExcluded : () => false
  const targets = new Map()
  const withheld = []
  const backdrop = []
  const view = clone.ownerDocument && clone.ownerDocument.defaultView
  if (!view) return { targets, withheld, backdrop }

  const visit = (el) => {
    if (isExcluded(el)) return
    // A node already inside a target is inside the drawing that replaces it: probing it
    // would produce a second asset for pixels the first one already carries.
    let cs = null
    try { cs = view.getComputedStyle(el) } catch { cs = null }
    if (cs) {
      for (const probe of BACKDROP_PROBES) {
        try { if (probe.test(cs)) backdrop.push(probe.code) } catch { /* unreadable is not a finding */ }
      }
      const codes = []
      for (const probe of FALLBACK_PROBES) {
        try { if (probe.test(cs)) codes.push(probe.code) } catch { /* a property this engine cannot read is not a finding */ }
      }
      if (codes.length) {
        const r = el.getBoundingClientRect()
        if (r.width >= 1 && r.height >= 1) {
          if (mode === 'replica' || !paintsText(el)) { targets.set(el, { codes }); return }
          withheld.push({ codes, tag: el.tagName })
        }
      }
    }
    // Not into an inline <svg>. Its whole subtree travels as one asset built from the
    // markup (`inlineSvgDataUri`), so a `clip-path` on a `<rect>` in there is already
    // carried — and those elements have no SVD node of their own, which showed up as
    // `h2d.vector-paint-unresolved` on fx-svg: the engine accusing itself of a bug that
    // was really this walk going somewhere it had no business being.
    if (el.localName === 'svg') return
    for (const child of el.children) visit(child)
  }
  visit(clone)
  return { targets, withheld, backdrop }
}

/**
 * One node of an assembled SVD, on its own, as an `image/svg+xml` data URI.
 *
 * The slice is a shallow document over the same node objects — nothing is copied and
 * nothing is mutated, so the caller's document is still the one it assembled. Two
 * things make the window right without touching the emitter:
 *
 * 1. `capture.root` is set to the node's own box, which is what `svdToSvg` reads for
 *    the root `width`/`height`;
 * 2. the emitted `viewBox` is rewritten from `0 0 w h` to the node's FRAME.
 *
 * That second point is the one that had to be measured rather than reasoned about. A
 * node is written as `<g transform="translate(fx fy)">` with its geometry at the local
 * origin, and `frame` is that offset — relative to the PARENT, not to the capture. The
 * first version of this used `abs` and every asset came out blank: `.sp-clip` was
 * drawn at (98,10) while the window had been put at (504,536). `abs` is what the
 * schema carries for the deltas between nodes; `frame` is where the emitter actually
 * puts the pen. Moving the window is one attribute; translating the geometry would be
 * a rewrite of coordinates this module has no business knowing the shape of.
 *
 * @param {object} doc  an assembled SVD document
 * @param {string} id   the node to isolate
 * @returns {{uri: string, bytes: number, diagnostics: object[]}|null}
 */
export function svdSliceToDataUri (doc, id) {
  const node = doc && doc.nodes && doc.nodes[id]
  if (!node || !node.abs) return null

  const nodes = {}
  const take = (nid) => {
    const n = doc.nodes[nid]
    if (!n || nodes[nid]) return
    nodes[nid] = n
    for (const kid of n.children || []) take(kid)
    // A mask lives outside the child list and is emitted by reference; dropping it
    // turns a masked node into an unmasked one, which is a silent change of paint.
    if (n.clip && n.clip.maskNode) take(n.clip.maskNode)
  }
  take(id)

  const frame = (node.frame && Number.isFinite(node.frame.w) ? node.frame : node.abs)
  const sliced = {
    ...doc,
    root: id,
    nodes,
    capture: { ...(doc.capture || {}), root: { w: frame.w, h: frame.h } },
    // The slice is not the capture, and a report that describes 60 nodes on a document
    // that has 3 is worse than no report.
    report: undefined,
    diagnostics: [],
  }

  let out
  try { out = svdToSvg(sliced) } catch { return null }
  if (!out || !out.svg) return null

  const svg = out.svg.replace(/^(<svg\b[^>]*\bviewBox=")[^"]*(")/,
    `$1${round(frame.x)} ${round(frame.y)} ${round(frame.w)} ${round(frame.h)}$2`)
  const uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  return { uri, bytes: svg.length, diagnostics: out.diagnostics || [] }
}

const round = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0)
