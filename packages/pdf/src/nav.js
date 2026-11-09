/**
 * Navigation: internal destinations and the outline (what a viewer shows as
 * "bookmarks").
 *
 * Both are read from the laid-out DOM mounted in an isolated iframe from
 * SnapDOM's FINAL SVG artifact, in the same pass that measures the text layer. A
 * destination is a point on the page, and a point is only knowable while that
 * artifact's layout still exists. Nothing here writes PDF — it returns viewport
 * CSS px and lets `index.js`, which is the only thing that knows where the page
 * breaks fell, turn them into pages.
 *
 * The split with `text-layer.js` is deliberate. That file answers "what does the
 * raster paint, and where" and has to be exact about glyphs. This one answers
 * "what can the reader jump to", which is a question about DOCUMENT STRUCTURE and
 * has no pixels in it at all: a destination is still useful pointing at a heading
 * the reader can see, even if that heading's own runs were dropped as clipped.
 */

import { inspectTextPaint } from './text-layer.js'

/** Headings that become outline entries. ARIA's is handled separately — it carries its level. */
const HEADING_TAGS = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 }

/** Never walked into, for the same reason the text layer skips them. */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE'])

/** An outline entry nobody can read is worse than none — a runaway heading is cut. */
const TITLE_MAX = 240

/** Keep outline visibility in step with the text layer's own paint threshold. */
const ALPHA_MIN = 0.01

/** Flattened-tree parent: slots and shadow roots follow what the browser paints. */
function renderParent(node) {
  if (node.assignedSlot) return node.assignedSlot
  if (node.parentElement) return node.parentElement
  const tree = node.getRootNode && node.getRootNode()
  return tree instanceof ShadowRoot ? tree.host : null
}

function ariaHidden(el) {
  return el.getAttribute && String(el.getAttribute('aria-hidden')).trim().toLowerCase() === 'true'
}

/**
 * Whether a subtree is structurally suppressed. `ownText` additionally asks if
 * THIS element's glyph paint is safe/visible; titleOf uses that only at each text
 * node's actual parent, so a transparent wrapper does not hide a child that
 * explicitly reasserts an opaque colour or `visibility:visible`.
 */
function hiddenHeading(el, root, ownText = false) {
  let node = el
  let alpha = 1
  while (node) {
    if (ariaHidden(node)) return true
    const cs = getComputedStyle(node)
    // `visibility` is inherited but a descendant may reassert it, so the computed
    // value on the heading itself is authoritative. display:none is different: an
    // ancestor suppresses the entire subtree and cannot be reasserted below it.
    if (ownText && node === el && cs.visibility !== 'visible') return true
    if (cs.display === 'none') return true
    if (cs.display !== 'contents') {
      alpha *= parseFloat(cs.opacity) || 0
      const paint = inspectTextPaint(node, cs)
      if (paint.unmodelled || (ownText && node === el &&
          (paint.secured || paint.shadowOnly || !paint.paints))) return true
      alpha *= paint.filterAlpha
    }
    if (node === root) break
    node = renderParent(node)
  }
  return alpha < ALPHA_MIN
}

/**
 * The fragment a link points at within THIS document, or null.
 *
 * `el.href` is always absolute, so `#intro` arrives as `https://host/page#intro`
 * and telling an internal link from an external one means comparing everything
 * left of the hash. A bare `#` and `#top` are the document top by HTML's own
 * rule, and both come back as the empty string so a caller can tell "the top"
 * from "no fragment at all" (null).
 *
 * @param {string} href  an ABSOLUTE url, as `HTMLAnchorElement.href` gives it
 * @param {string} [base=location.href]
 * @returns {string|null}
 */
export function fragmentOf(href, base) {
  if (typeof href !== 'string') return null
  const here = String(base ?? location.href).split('#')[0]
  const hash = href.indexOf('#')
  if (hash < 0) return null
  if (href.slice(0, hash) !== here) return null
  const raw = href.slice(hash + 1)
  if (!raw || raw === 'top') return ''
  try { return decodeURIComponent(raw) } catch { return raw }
}

/**
 * `root.contains` stops at a shadow boundary, so a link in the light DOM pointing
 * at a captured heading would read as "outside the capture" and be dropped. This
 * climbs through hosts the way the flattened tree does.
 */
function withinRoot(el, root) {
  let node = el
  while (node) {
    if (node === root) return true
    node = node.parentNode || node.host || null
  }
  return false
}

/**
 * Where a destination points: the top-left of the target's border box, in
 * viewport CSS px. Null when the element has no box at all — `display: none`, or
 * a named anchor in a collapsed subtree — because a point that is nowhere would
 * silently become the page origin.
 */
function anchorPoint(el) {
  const rects = el.getClientRects()
  const rect = rects.length ? rects[0] : el.getBoundingClientRect()
  if (!rect.width && !rect.height && !rect.top && !rect.left) return null
  // The whole box, not just the corner: a generated index that cannot paint a
  // heading's script has to be able to CROP that heading out of the raster
  // instead, and a point is not a crop.
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
}

/**
 * The visible/accessibility title, not raw textContent: otherwise an aria-hidden
 * span (or an opacity-zero one) becomes public bookmark/TOC text.
 */
function titleOf(el) {
  const parts = []
  const read = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = renderParent(node)
      if (parent && !hiddenHeading(parent, el, true)) parts.push(node.data)
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const tag = node.tagName.toUpperCase()
    if (SKIP_TAGS.has(tag) || (node !== el && hiddenHeading(node, el, false))) return

    let kids
    if (node.shadowRoot) kids = node.shadowRoot.childNodes
    else if (tag === 'SLOT') kids = node.assignedNodes({ flatten: true })
    else kids = node.childNodes
    for (const kid of kids) read(kid)
  }
  read(el)
  const text = parts.join('').replace(/\s+/g, ' ').trim()
  return text.length > TITLE_MAX ? text.slice(0, TITLE_MAX - 1) + '…' : text
}

/**
 * The heading's own level. An `aria-level` on a `role="heading"` is authoritative
 * where it exists, because that is the level assistive tech reads and the outline
 * is the same promise made to a sighted reader.
 */
function levelOf(el, tag) {
  if (el.getAttribute && el.getAttribute('role') === 'heading') {
    const n = parseInt(el.getAttribute('aria-level'), 10)
    if (n >= 1 && n <= 6) return n
  }
  return HEADING_TAGS[tag] || 0
}

/**
 * Flattened-tree walk, with the same dedup rule the text layer relies on: a
 * host's light children are reached through their slot and never as children of
 * the host, so a slotted heading produces ONE outline entry.
 */
function walk(node, S) {
  if (node.nodeType !== Node.ELEMENT_NODE) return
  const tag = node.tagName.toUpperCase()
  if (SKIP_TAGS.has(tag) || ariaHidden(node)) return

  const level = levelOf(node, tag)
  if (level && !hiddenHeading(node, S.root, false)) {
    const at = anchorPoint(node)
    const title = titleOf(node)
    if (at && title) S.headings.push({ level, title, box: at, el: node })
  }

  let kids
  if (node.shadowRoot) {
    if (!S.shadow) return
    kids = node.shadowRoot.childNodes
  } else if (tag === 'SLOT') {
    kids = node.assignedNodes({ flatten: true })
  } else {
    kids = node.childNodes
  }
  for (const kid of kids) walk(kid, S)
}

/**
 * Read everything a reader can jump to.
 *
 * @param {Element} root
 * @param {object} [options]
 * @param {Array<{href: string}>} [options.links=[]]  the text layer's links, which
 *   is where the set of destinations worth resolving comes from: resolving every
 *   `id` on the page would cost a `getClientRects` per element for destinations
 *   nothing points at.
 * @param {boolean} [options.shadow=true]   enter open shadow roots
 * @param {boolean} [options.outline=true]  collect headings
 * @param {string}  [options.headings]      selector overriding `h1`–`h6`. Levels
 *   then come from the tag or `aria-level`; an element the selector matches that
 *   is neither gets level 1.
 * @returns {{dests: Map<string, {x:number, y:number}>,
 *            outline: Array<{level:number, title:string, dest:string}>,
 *            warnings: string[]}}
 *   `dests` is keyed by the NAME a link's fragment resolves to; the empty string
 *   is the document top and is present whenever something points at it. Every
 *   `outline[i].dest` is a key of `dests`.
 */
export function collectNav(root, options = {}) {
  const { links = [], shadow = true, outline = true, headings = null } = options
  const doc = root.ownerDocument || document
  const dests = new Map()
  const warnings = []
  let unresolved = 0
  let offRoot = 0

  // The document top is a destination without an element: page 1, top edge. It is
  // added only when something points at it, so a file with no `#top` link carries
  // no name tree entry for it.
  const wanted = new Set()
  for (const link of links) {
    const name = fragmentOf(link.href)
    if (name !== null) wanted.add(name)
  }

  for (const name of wanted) {
    if (name === '') { dests.set('', { x: 0, y: 0, top: true }); continue }
    // getElementById first, then the legacy `<a name>` HTML still honours.
    const el = doc.getElementById(name) ||
      (doc.getElementsByName ? doc.getElementsByName(name)[0] : null)
    if (!el) { unresolved++; continue }
    if (!withinRoot(el, root)) { offRoot++; continue }
    const at = anchorPoint(el)
    if (!at) { unresolved++; continue }
    // A destination is a POINT — `/XYZ` takes nothing else. The rest of the rect
    // is what an outline entry needs for its crop, and it travels on the entry.
    dests.set(name, { x: at.x, y: at.y })
  }

  const S = { headings: [], shadow, root }
  if (outline) {
    if (headings) {
      // An explicit selector is the caller's tree, in document order. It cannot
      // see into shadow roots — `querySelectorAll` never does — and says so.
      let matches = null
      try {
        matches = root.querySelectorAll(headings)
      } catch (error) {
        warnings.push(`invalid outline selector \`${headings}\` — no outline written` +
          (error && error.message ? `: ${error.message}` : '.'))
      }
      for (const el of matches || []) {
        if (hiddenHeading(el, root, false)) continue
        const at = anchorPoint(el)
        const title = titleOf(el)
        if (!at || !title) continue
        S.headings.push({ level: levelOf(el, el.tagName.toUpperCase()) || 1, title, box: at, el })
      }
      // Only when something IS actually out of reach. `querySelectorAll` never
      // enters a shadow root, but a slotted heading lives in the light DOM and is
      // found perfectly well — warning on the mere presence of a shadow root
      // would fire on most design systems and lose nothing, which is how a
      // warning stops being read.
      const missed = matches && shadow ? shadowMatches(root, headings) : 0
      if (missed) {
        warnings.push(`${missed} heading(s) matching \`${headings}\` live inside a shadow root, ` +
          'which a selector cannot enter — they are not in the outline. The default h1–h6 walk ' +
          'goes through the flattened tree and does reach them.')
      }
    } else {
      walk(root, S)
    }
  }

  // A heading needs a name to be jumped to. Its own `id` is the one a reader may
  // already be linking to from outside the file, so it wins; the generated
  // fallback is namespaced and checked, because colliding with a real id would
  // silently retarget somebody's cross-reference.
  const tree = []
  for (let i = 0; i < S.headings.length; i++) {
    const h = S.headings[i]
    let name = h.el.id || ''
    if (!name || (dests.has(name) && dests.get(name).y !== h.box.y)) name = ''
    if (!name) {
      name = `sd-h${i}`
      while (dests.has(name) || doc.getElementById(name)) name += '_'
    }
    dests.set(name, { x: h.box.x, y: h.box.y })
    // The box travels with the entry: it is what lets a generated index show a
    // heading whose script the plugin's base-14 text cannot paint.
    tree.push({ level: h.level, title: h.title, dest: name, box: h.box })
  }

  if (unresolved) {
    warnings.push(`${unresolved} internal link(s) point at a fragment this document has no element for — ` +
      'written as no annotation at all rather than a link that goes nowhere')
  }
  if (offRoot) {
    warnings.push(`${offRoot} internal link(s) point outside the captured element, which is not in the ` +
      'file — the annotation is dropped')
  }
  return { dests, outline: tree, warnings }
}

/**
 * How many elements matching `selector` are inside an open shadow root under
 * `root` — the headings a `querySelectorAll` on the light tree cannot reach.
 * Counts only what is genuinely lost, so the warning it feeds means something.
 */
function shadowMatches(root, selector) {
  let n = 0
  const stack = [root]
  while (stack.length) {
    const el = stack.pop()
    if (el.shadowRoot) {
      n += el.shadowRoot.querySelectorAll(selector).length
      for (const kid of el.shadowRoot.children) stack.push(kid)
    }
    for (const kid of el.children) stack.push(kid)
  }
  return n
}

/**
 * Turn the flat, level-tagged list into the nested shape PDF outlines are.
 *
 * A document that starts at `h2`, or jumps `h1` → `h3`, is normal HTML and must
 * not produce an empty top level: a level is nested under the closest PREVIOUS
 * entry with a strictly smaller level, whatever the numeric gap is. That is also
 * what a screen reader does with the same markup.
 *
 * @param {Array<{level:number, title:string, dest:string}>} flat
 * @returns {Array<{title:string, dest:string, children:Array}>}
 */
export function outlineTree(flat) {
  const roots = []
  /** @type {Array<{level:number, node:{children:Array}}>} */
  const stack = []
  for (const item of flat) {
    const node = { title: item.title, dest: item.dest, box: item.box || null, children: [] }
    while (stack.length && stack[stack.length - 1].level >= item.level) stack.pop()
    if (stack.length) stack[stack.length - 1].node.children.push(node)
    else roots.push(node)
    stack.push({ level: item.level, node })
  }
  return roots
}
