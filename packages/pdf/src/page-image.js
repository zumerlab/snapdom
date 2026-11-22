/**
 * The page image without the text the export paints as glyphs.
 *
 * A run painted as real glyphs used to be painted TWICE: once by the export,
 * and once inside the raster, which is a picture of the whole page, letters
 * included. The second copy cost most of the file — antialiased text is the
 * part of a page that compresses worst — and showed as a soft fringe around
 * every crisp glyph. Here the raster is drawn from a revised copy of the
 * capture's SVG in which those text nodes keep their place and lose their fill.
 *
 * Two rules keep that honest:
 *
 * - **A word is cleared only when every glyph it paints is painted by the
 *   export.** A word the font does not cover, or one with a fragment the clip
 *   dropped, stays in the image exactly as before.
 * - **Clearing must not move anything.** The words are wrapped, not restyled: the
 *   fill is the only property that changes, layout is untouched, and whatever
 *   the element paints besides glyph fill — underline, shadow, background —
 *   stays in the image where the browser put it.
 *
 * The capture itself is never modified. Its other exports, and the crops this
 * export takes for an index line or a field's appearance, read it as captured.
 */

const XHTML = 'http://www.w3.org/1999/xhtml'
const SVG = 'http://www.w3.org/2000/svg'

/**
 * The wrapper. A name no page uses and no generated rule targets: snapdom's own
 * stylesheet styles nodes by class and by ordinary tag name, and a `span` here
 * would pick up whatever the capture's spans share.
 */
const WRAPPER = 'snapdom-pdf-glyphs'
const WRAPPER_STYLE = 'all:unset!important;-webkit-text-fill-color:transparent!important'

/** Parents whose content model or rendering an element child would change. */
const NO_ELEMENT_CHILD = new Set([
  'option', 'optgroup', 'select', 'textarea', 'title', 'script', 'style', 'noscript',
  'template', 'datalist',
])

/**
 * Whether a text node can be wrapped without changing what its parent is. SVG
 * text is left alone: an HTML element inside `<text>` renders nothing at all.
 */
export function wrappable(node) {
  const parent = node && node.parentNode
  return !!parent && parent.nodeType === 1 && parent.namespaceURI === XHTML &&
    !NO_ELEMENT_CHILD.has(parent.localName)
}

/**
 * A selector an inserted element can re-point: it changes which sibling is
 * first, last or n-th, what `:empty` and `:has()` see, and what `*`, `+` and
 * `~` reach. Deliberately coarse — an attribute selector with `*=` trips it —
 * because the only cost of a false alarm is the page image keeping its text.
 */
const STRUCTURAL = /:(?:first|last|only|nth)-|:empty|:has\(|[+~*]/

/**
 * True when no stylesheet in the measured document could react to a wrapper.
 * snapdom's generated sheet never does; author CSS that travelled with the
 * capture (a shadow sheet, a `<style>` a hook kept) might.
 *
 * @param {Document} doc the document the capture was measured in
 */
export function wrapperIsInert(doc) {
  const inert = (list) => {
    for (const rule of list) {
      if (rule.selectorText && STRUCTURAL.test(rule.selectorText)) return false
      if (rule.cssRules && !inert(rule.cssRules)) return false
    }
    return true
  }
  try {
    for (const sheet of doc.styleSheets) {
      if (!inert(sheet.cssRules)) return false
    }
  } catch {
    return false // a sheet that cannot be read cannot be vouched for
  }
  return true
}

/**
 * The capture's SVG with the given words cleared of glyph fill.
 *
 * Text nodes are addressed by their ordinal in document order under the capture
 * root, the order `collectTextLayer` numbered them in while the same SVG was
 * mounted for measuring, and words by their offsets in that node's data.
 * `total` is that pass's count of text nodes: when this parse sees a different
 * number the two trees are not the same tree, and nothing is cleared.
 *
 * Neighbouring words are cleared under one wrapper, white space between them
 * included, so a paragraph painted whole costs one element and not one per
 * word. A wrapper boundary always falls on white space or on the edge of the
 * text node — where the engine already breaks its shaping.
 *
 * @param {string} svgText
 * @param {Map<number, Array<[number, number]>>} spans  text node ordinal → the
 *   `[from, to)` spans to clear in it, ascending and disjoint
 * @param {number} total text nodes the measuring pass counted
 * @returns {string|null} the revised SVG, or null when nothing was (or could
 *   safely be) cleared — the caller then draws the capture untouched
 */
export function withoutGlyphs(svgText, spans, total) {
  if (!spans || !spans.size) return null
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const svg = doc.documentElement
  if (!svg || svg.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) return null
  const fo = svg.getElementsByTagNameNS(SVG, 'foreignObject')[0]
  const container = fo && [...fo.children].find(el => el.localName === 'div')
  const root = container && container.firstElementChild
  if (!root) return null

  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  const nodes = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node)
  if (nodes.length !== total) return null

  let cleared = 0
  for (const [at, list] of spans) {
    const node = nodes[at]
    if (!node || !wrappable(node)) continue
    const data = node.data
    // Merge spans that only white space separates, then cut from the right so
    // the offsets still to be used keep indexing the node they were measured in.
    const merged = []
    for (const [from, to] of list) {
      if (!(from >= 0 && to > from && to <= data.length)) continue
      const last = merged[merged.length - 1]
      if (last && from >= last[1] && !/\S/.test(data.slice(last[1], from))) last[1] = to
      else if (!last || from >= last[1]) merged.push([from, to])
    }
    for (let i = merged.length - 1; i >= 0; i--) {
      const [from, to] = merged[i]
      if (to < node.data.length) node.splitText(to)
      const target = from > 0 ? node.splitText(from) : node
      const wrapper = doc.createElementNS(XHTML, WRAPPER)
      wrapper.setAttribute('style', WRAPPER_STYLE)
      target.parentNode.replaceChild(wrapper, target)
      wrapper.appendChild(target)
      cleared++
    }
  }
  return cleared ? new XMLSerializer().serializeToString(doc) : null
}
