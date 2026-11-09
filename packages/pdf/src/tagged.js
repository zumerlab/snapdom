/**
 * Document structure: the tree a tagged PDF exposes to assistive technology.
 *
 * This is the one thing this plugin can do cheaply that nothing starting from a
 * raster or from a layout engine can. Reading order, heading levels, table cells,
 * list items and alternative text are all facts about the DOM, and the DOM is
 * already open in front of us at the moment the text layer is measured. A tool
 * that receives a finished page of ink has to infer every one of them.
 *
 * Two decisions shape everything here.
 *
 * **The page image is an ARTIFACT, not a figure.** The raster is a picture OF the
 * same words the invisible layer carries, so tagging it as content would make a
 * screen reader announce a full-page image on top of the text it duplicates. Every
 * pixel this plugin draws — page image, repeated header, watermark, running head,
 * page number, index leader — is furniture, and PDF has a word for furniture.
 * `index.js` wraps them all in `/Artifact`; the structure below covers only the
 * text layer.
 *
 * **Only block structure is tagged.** Wrapping every `<span>` and `<em>` produces a
 * tree that is technically richer and practically unreadable, and the inline text
 * is already in reading order inside its block. The two inline exceptions carry
 * something no block can: a `/Link` node per anchor and a `/Form` node per
 * fillable control, each existing to hold the `/OBJR` that ties its annotation
 * into the tree — see the carrier-node comment in `buildStructure`.
 *
 * Nothing in this file writes PDF, and nothing in it knows how the page is
 * painted. It maps elements to structure types and hands back a tree.
 */

// `isFigure` and `semanticAlt` are exported for the text layer, which decides
// which textless objects earn a marked-content run. That decision and this one
// have to be the same decision — a run whose owner this file types differently
// ends up in whatever paragraph encloses it — so it is asked here rather than
// answered twice.

/**
 * HTML → PDF standard structure type. The writer emits PDF 1.7, so the table
 * row-group types that arrived in 1.5 — `THead`, `TBody`, `TFoot` — map
 * directly instead of staying transparent.
 */
const ROLE = {
  H1: 'H1', H2: 'H2', H3: 'H3', H4: 'H4', H5: 'H5', H6: 'H6',
  P: 'P',
  BLOCKQUOTE: 'BlockQuote',
  FIGURE: 'Figure', IMG: 'Figure', FIGCAPTION: 'Caption', CAPTION: 'Caption',
  UL: 'L', OL: 'L', DL: 'L',
  LI: 'LI', DT: 'Lbl', DD: 'LBody',
  TABLE: 'Table', TR: 'TR', TH: 'TH', TD: 'TD',
  THEAD: 'THead', TBODY: 'TBody', TFOOT: 'TFoot',
  ARTICLE: 'Art', SECTION: 'Sect', ASIDE: 'Sect', NAV: 'Sect',
  HEADER: 'Sect', FOOTER: 'Sect', MAIN: 'Sect',
  PRE: 'Code', CODE: 'Code',
}

/**
 * Types that GROUP other structure elements rather than carrying text of their
 * own. Text that lands directly on one of these gets an implicit `P` in between,
 * because "a list containing words" is not a structure any reader can use.
 */
const GROUPING = new Set(['Art', 'Sect', 'Div', 'L', 'LI', 'Table', 'TR', 'Document', 'Figure',
  'THead', 'TBody', 'TFoot'])

/** Inline boxes never become structure — see the file header. */
const INLINE = /^(inline|contents|ruby|none)/

/**
 * The flattened-tree parent, the same one the text layer places against: a
 * slotted node renders inside its slot, and a shadow root's children have no
 * `parentElement`. Structure follows the tree that is PAINTED, so reading order
 * and visual order are the same order.
 */
function up(node) {
  if (node.assignedSlot) return node.assignedSlot
  if (node.parentElement) return node.parentElement
  const root = node.getRootNode()
  return root instanceof ShadowRoot ? root.host : null
}

/** ARIA role → structure type, for the roles that name a structure PDF 1.4 has. */
const ARIA_ROLE = {
  list: 'L', listitem: 'LI', table: 'Table', row: 'TR',
  cell: 'TD', gridcell: 'TD', columnheader: 'TH', rowheader: 'TH', img: 'Figure',
}

/** The first token of `role`, which is the one that applies. */
function roleToken(el) {
  return String(el.getAttribute && el.getAttribute('role') || '')
    .trim().split(/\s+/)[0].toLowerCase()
}

/** Which axis a header cell heads, plus its spans — written as the /A table
 * attributes the writer knows how to say. */
function thAttrs(el) {
  const scopeAttr = String(el.getAttribute && el.getAttribute('scope') || '').toLowerCase()
  const scope = scopeAttr === 'row' || scopeAttr === 'rowgroup' ? 'Row'
    : scopeAttr === 'col' || scopeAttr === 'colgroup' ? 'Column'
    : (el.closest && el.closest('thead')) ? 'Column' : 'Row'
  return { scope, colSpan: el.colSpan || 1, rowSpan: el.rowSpan || 1 }
}

/**
 * The structure type an element carries on its own, before layout has a say.
 *
 * ARIA wins where it is set, because it is what assistive tech already reads and
 * the structure tree is the same promise made to a different reader. A role this
 * table does not know is NOT a refusal, though: `role="banner"` names no PDF
 * structure, so the tag's own meaning still stands.
 */
function structureType(el) {
  const aria = roleToken(el)
  if (aria === 'heading') {
    const n = parseInt(el.getAttribute('aria-level'), 10)
    return n >= 1 && n <= 6 ? `H${n}` : 'H1'
  }
  if (ARIA_ROLE[aria]) return ARIA_ROLE[aria]
  if (aria === 'presentation' || aria === 'none') return null
  return ROLE[el.tagName ? el.tagName.toUpperCase() : ''] || null
}

/**
 * Whether this element is a Figure — the one question the text layer has to ask
 * too, so it asks it here instead of keeping its own copy of the rule.
 */
export const isFigure = (el) => structureType(el) === 'Figure'

function roleOf(el, styleOf) {
  const role = structureType(el)
  // A semantic tag laid out inline is a phrase, not a block — `<code>` in the
  // middle of a sentence must not break the sentence into three structures.
  if (role === 'Code' && INLINE.test(styleOf(el).display)) return null
  return role
}

/** The nearest ancestor-or-self that generates a block-level box. */
function blockOf(el, root, styleOf) {
  let node = el
  while (node && node !== root) {
    if (!INLINE.test(styleOf(node).display)) return node
    node = up(node)
  }
  return root
}

/**
 * Build the structure tree for one capture.
 *
 * @param {Element} root
 * @param {Array<Element>} owners  the text layer's `owners`, parallel to its runs
 * @param {object} [options]
 * @param {string} [options.lang]  overrides the document language
 * @param {Array<Element>} [options.links]  link owners, one per link rect — the
 *   `/Link` carrier nodes come back in `ofLink`, memoised per element
 * @param {Array<Element>} [options.controls]  form control owners — the `/Form`
 *   carrier nodes come back in `ofControl`
 * @returns {{root: object, ofRun: Array<object|null>, ofLink: Array<object|null>,
 *   ofControl: Array<object|null>, lang: string|null, warnings: string[]}}
 *   `root` is a node `{ type, alt, lang, children }` — the `/Document`. `ofRun[i]`
 *   is the node run `i` belongs to, or null when the run had no owner. Nodes carry
 *   no element references outward: what leaves here is a shape, not a live DOM.
 *
 *   `children` holds BOTH child nodes and marked-content references, in one list,
 *   because reading order runs through both: a block that carries a sentence and
 *   then a nested list has to read the sentence first. The caller appends
 *   `{ mcid, page }` entries as it draws. A node has a `type`; a mark has an
 *   `mcid`.
 */
export function buildStructure(root, owners, options = {}) {
  const styles = new WeakMap()
  const styleOf = (el) => {
    let s = styles.get(el)
    if (!s) { s = getComputedStyle(el); styles.set(el, s) }
    return s
  }

  const doc = { type: 'Document', alt: null, lang: null, children: [] }
  const byEl = new Map()
  const implicit = new Map()
  const warnings = []
  const directlyOwned = new Set(owners)

  /** aria-hidden=true on any flattened ancestor suppresses the whole subtree. */
  const hiddenCache = new WeakMap()
  const hiddenFromAT = (el) => {
    if (!el) return false
    if (hiddenCache.has(el)) return hiddenCache.get(el)
    const own = el.getAttribute &&
      String(el.getAttribute('aria-hidden')).trim().toLowerCase() === 'true'
    const hidden = !!own || (el !== root && hiddenFromAT(up(el)))
    hiddenCache.set(el, hidden)
    return hidden
  }

  /**
   * Language introduced between this node and its nearest structural ancestor.
   * Transparent layout containers disappear from the PDF tree, so a `lang` on one
   * of them must move down to the first structure node that survives the collapse.
   */
  const structuralLang = (el) => {
    let node = el
    while (node) {
      const own = langOf(node)
      if (own) return own
      if (node === root) break
      const parent = up(node)
      if (!parent || parent === root || roleOf(parent, styleOf)) break
      node = parent
    }
    return null
  }

  /**
   * The structure node an element belongs to, memoised. An element with no role
   * of its own is TRANSPARENT: it contributes nothing and its content attaches to
   * whatever encloses it, which is what keeps a page of nested layout `<div>`s
   * from becoming a page of nested structure.
   */
  const nodeFor = (el) => {
    if (!el) return doc
    if (byEl.has(el)) return byEl.get(el)
    if (hiddenFromAT(el)) { byEl.set(el, null); return null }
    const parent = el === root ? doc : nodeFor(up(el))
    if (!parent) { byEl.set(el, null); return null }
    const type = roleOf(el, styleOf)
    if (!type) { byEl.set(el, parent); return parent }
    const node = { type, alt: altOf(el), lang: el === root ? null : structuralLang(el), children: [] }
    // A textless image has no marked-content run for index.js to attach. `keep`
    // tells the byte writer that this deliberate Figure-with-Alt is still useful
    // structure rather than an empty branch to prune.
    if (type === 'Figure' && node.alt && directlyOwned.has(el)) node.keep = true
    // A header cell says which axis it heads. The attribute wins; without one,
    // a cell in a thead heads its column and any other header cell its row —
    // the same inference AT applies to the HTML.
    if (type === 'TH') node.attrs = thAttrs(el)
    parent.children.push(node)
    byEl.set(el, node)
    return node
  }

  /** Where run `i`'s glyphs belong: its own block, or an implicit paragraph. */
  const place = (owner) => {
    if (!owner || hiddenFromAT(owner)) return null
    // A synthetic whitespace marker for an image-only object belongs to the
    // Figure itself, not to an implicit paragraph around it.
    if (roleOf(owner, styleOf) === 'Figure') return nodeFor(owner)
    const block = blockOf(owner, root, styleOf)
    const node = nodeFor(block)
    if (!node) return null
    if (!GROUPING.has(node.type)) return node
    // Text sitting straight inside a grouping element. One implicit paragraph per
    // block, so consecutive words of the same sentence share it.
    const key = block
    let p = implicit.get(key)
    if (!p) {
      p = { type: 'P', alt: null, lang: structuralLang(block), children: [] }
      node.children.push(p)
      implicit.set(key, p)
    }
    return p
  }

  // Prime nodes in flattened document order, including semantic images with no
  // text owner. Merely iterating `owners` cannot see those images at all; priming
  // also keeps an empty Figure between the paragraphs that surround it instead of
  // appending every synthetic node at the end.
  const seen = new Set()
  const prime = (node) => {
    if (!node || seen.has(node)) return
    seen.add(node)
    if (node.nodeType === Node.TEXT_NODE) {
      if (/\S/.test(node.data || '')) place(up(node))
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const tag = node.tagName.toUpperCase()
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE'].includes(tag) || hiddenFromAT(node)) return
    nodeFor(node)

    let kids
    if (node.shadowRoot) kids = node.shadowRoot.childNodes
    else if (tag === 'SLOT') kids = node.assignedNodes({ flatten: true })
    else kids = node.childNodes
    for (const kid of kids) prime(kid)
  }
  prime(root)

  const ofRun = owners.map(place)

  /**
   * Persistent per-element carrier nodes for things whose CONTENT is per-export:
   * a link's annotation and a field's widget join the tree through `/OBJR`
   * entries pushed into `marksOf` at draw time, so the node itself has to exist
   * once per capture — the same tree-vs-marks split everything else obeys. A
   * node with no marks in a given export is pruned by the writer's `alive`.
   *
   * A multi-line anchor produces several link rects for ONE element, so carriers
   * memoise: all of an anchor's annotations belong to one `/Link`.
   */
  const carriers = new Map()
  const carrierFor = (el, type) => {
    if (!el || hiddenFromAT(el)) return null
    if (carriers.has(el)) return carriers.get(el)
    const parent = place(el)
    if (!parent) { carriers.set(el, null); return null }
    const node = { type, alt: null, lang: null, children: [] }
    parent.children.push(node)
    carriers.set(el, node)
    return node
  }
  const ofLink = (options.links || []).map(el => carrierFor(el, 'Link'))
  const ofControl = (options.controls || []).map(el => carrierFor(el, 'Form'))

  const lang = options.lang || langOf(root) ||
    (root.ownerDocument && root.ownerDocument.documentElement.getAttribute('lang')) || null
  if (!lang) {
    warnings.push('no `lang` on the capture or on <html> — a tagged PDF with no language ' +
      'leaves a screen reader guessing which one to pronounce. Set one, or pass `lang`.')
  }

  return { root: doc, ofRun, ofLink, ofControl, lang, warnings }
}

/**
 * The accessible name, and the fallback order a browser reads it in.
 *
 * Exported for the text layer, which needs the same answer to decide whether a
 * textless Figure is worth reaching at all.
 */
export function semanticAlt(el) {
  if (!el.getAttribute) return null
  const aria = el.getAttribute('aria-label')
  if (aria && aria.trim()) return aria.trim()
  // `alt=""` is an explicit request for a decorative image. Do not resurrect it
  // from title text and make a screen reader announce what the author suppressed.
  if (el.hasAttribute('alt')) {
    const alt = el.getAttribute('alt')
    return alt && alt.trim() ? alt.trim() : null
  }
  const title = el.getAttribute('title')
  return title && title.trim() ? title.trim() : null
}

const altOf = semanticAlt

function langOf(el) {
  const lang = el.getAttribute && el.getAttribute('lang')
  return lang && lang.trim() ? lang.trim() : null
}

// There is no `pruneStructure` here any more. Dropping a branch nothing marked is
// the byte writer's job and it already does it, by READING the tree rather than
// mutating it (`writeStructTree`'s `alive`) — which matters, because one measured
// tree is exported more than once. The copy that used to live here was called by
// nothing and still had to be patched in lockstep with the writer's version; the
// `keep` flag for a textless Figure was fixed in both on the same day.
