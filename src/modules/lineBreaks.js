/**
 * The page's own line breaks, kept in the tree the svg engine lays out under its layout zoom.
 *
 * At a devicePixelRatio other than 1, engines/svg.js lays the clone out under `zoom: <dpr>`
 * (#508). Firefox measures text in app units (1/60px) and rounds each glyph's advance at the
 * font size it lays out, so under zoom 1.25 a 12px line is shaped at 15px, and divided back a
 * line comes out up to 0.33px wider than on the page (Firefox 160). Chrome 157's zoomed text is
 * at most 0.01px wider. Either way, a line with less room to spare breaks a word early.
 *
 * Each text node's run on each live line goes into a `nowrap` element. The white space the page
 * broke at stays outside, between two of them, so the clone can only wrap where the page did;
 * a break inside a word gets a `<wbr>`, or a soft hyphen under `hyphens: auto`. White space at
 * a node's edges goes into the pin as well when the content on that side, in the same inline
 * formatting context, sits on the same live line, and so does a white-space-only node between
 * two such neighbours: otherwise every link or `<b>` in a paragraph would keep a break
 * opportunity on each side. Two pins side by side can still break between them where the
 * characters allow it, after a `/` or a hyphen, so a `<wbr>` between two such neighbours
 * becomes a word joiner (U+2060), and so does the seam where two of their text nodes meet with
 * no white space.
 *
 * A line can break on either side of an atomic inline, such as an inline-block or an image,
 * wherever its parent wraps, and Firefox took that break with a word joiner beside it too. So an
 * atom that shares a live line with what stands beside it goes into a pin of its own, and gets
 * back the wrapping the pin would pass on to its own lines.
 *
 * Not kept: text the pass cannot pair with its live node (a selection highlight, a scroll
 * wrapper, pseudo-element content). Vertical and rotated text is left alone.
 *
 * The pins go into a copy of the tree the svg engine serializes, made in a document of its own,
 * and the clone stays as the clone stage built it: burst's differential recapture splices into
 * it and serializes it again, and a pin left from an earlier frame would hold that frame's
 * breaks. That document holds no Range either: Chromium updates every live Range of a document
 * on each change to its nodes, attached or not, and a capture leaves many of them until the
 * next garbage collection.
 * Pinned by __tests__/module.lineBreaks.test.js.
 * @module lineBreaks
 */

import { getStyle } from '../utils/index.js'
import { ONE_LINE_PROP, UNBREAKABLE_TEXT, SKEWED, axesOf } from './styleFreeze.js'

const XHTML = 'http://www.w3.org/1999/xhtml'

/**
 * The whole style of a pin: an inline box that adds nothing to the text but `nowrap`. Firefox 160
 * still broke a `nowrap` span at its spaces when it inherited `word-break: break-all` or
 * `line-break: anywhere`, so those go back to their defaults, which only decide where a line may
 * break.
 */
const PIN_STYLE = `all:unset;${ONE_LINE_PROP}:nowrap;word-break:normal;line-break:auto`

/** What a pin passes on to what it holds, with the pin's own values. */
const PIN_PASSES = [[ONE_LINE_PROP, 'nowrap'], ['word-break', 'normal'], ['line-break', 'auto']]

/** U+2060 WORD JOINER: no line may break on either side of it, and it draws nothing. */
const JOINER = '\u2060'

/** Two characters with no break opportunity between them, whatever separates their nodes. */
const WORD_CHAR = /[\w\u00C0-\u024F]/

/** Displays that put an element's content on its parent's lines. */
const FLOWS_INLINE = new Set(['inline', 'contents', 'ruby', 'ruby-base', 'ruby-base-container'])

/** Elements whose content is not lines of the page's text. */
const OPAQUE = new Set(['img', 'picture', 'video', 'audio', 'canvas', 'iframe', 'object', 'embed', 'input',
  'textarea', 'select', 'script', 'style', 'template', 'noscript', 'title'])

const NO_BREAKS = Object.freeze([])

/**
 * White space a line can break at, which the break then drops or hangs: not U+00A0, U+2007 or
 * U+202F, which keep their neighbours together.
 * @param {number} c - a UTF-16 code unit
 */
function isSpace(c) {
  return c === 32 || c === 9 || c === 10 || c === 12 || c === 13 || c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a && c !== 0x2007) || c === 0x205f || c === 0x3000
}

/** Whether a text run starts (`head`) or ends with white space. */
function edgeSpace(run, head) {
  const s = run.node.data
  return isSpace(s.charCodeAt(head ? 0 : s.length - 1))
}

/** Two boxes on one line overlap by more than half the shorter one; stacked lines do not. */
function sameLine(a, b) {
  return Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > Math.min(a.height, b.height) / 2
}

/**
 * Whether the clone could wrap inside `text` without the page's say: white space, CJK or any
 * other opportunity, or a word that overflow-wrap, word-break or hyphenation may split.
 * @param {string} text - a run without its edge white space
 * @param {CSSStyleDeclaration} cs - the live style the run inherits
 */
function canBreak(text, cs) {
  return !UNBREAKABLE_TEXT.test(text) || cs.overflowWrap !== 'normal' || cs.hyphens === 'auto' ||
    (cs.wordBreak !== 'normal' && cs.wordBreak !== 'keep-all') || cs.lineBreak === 'anywhere'
}

/**
 * Where a wrapping live text node starts each line after its first, as the offset of that
 * line's first character, and the boxes of its first and last characters. Lines only move
 * forward in logical order, so a span whose two ends share a line holds no break, and a
 * bisection over character boxes finds each break in a few reads.
 * @param {Text} text
 * @param {Range} range
 * @returns {{breaks: number[], start: DOMRect, end: DOMRect}|null}
 */
function liveBreaks(text, range) {
  const s = text.data
  const pos = []
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    // A low surrogate is measured with its high half.
    if (c >= 0xdc00 && c <= 0xdfff && i > 0) continue
    if (!isSpace(c)) pos.push(i)
  }
  const boxes = new Map()
  const box = (k) => {
    let r = boxes.get(k)
    if (r === undefined) {
      const i = pos[k]
      const c = s.charCodeAt(i)
      range.setStart(text, i)
      range.setEnd(text, Math.min(s.length, i + (c >= 0xd800 && c <= 0xdbff ? 2 : 1)))
      r = range.getBoundingClientRect()
      // A zero-width joiner or a collapsed mark has no box to compare.
      if (!r.height) r = null
      boxes.set(k, r)
    }
    return r
  }
  let first = 0
  while (first < pos.length && !box(first)) first++
  if (first === pos.length) return null
  let last = pos.length - 1
  while (last > first && !box(last)) last--
  const breaks = []
  const split = (lo, hi) => {
    if (sameLine(box(lo), box(hi))) return
    // The measurable character nearest the middle, strictly between the two.
    const mid = (lo + hi) >> 1
    let m = mid > lo ? mid : hi
    while (m < hi && !box(m)) m++
    if (m === hi) {
      m = mid - 1
      while (m > lo && !box(m)) m--
    }
    // Nothing measurable in between: the line starts at hi.
    if (m <= lo) {
      breaks.push(pos[hi])
      return
    }
    split(lo, m)
    split(m, hi)
  }
  if (last > first) split(first, last)
  return { breaks, start: box(first), end: box(last) }
}

/**
 * Measure a run once, on first use: its first and last boxes on the page and, for wrapping text
 * that spans lines, where those lines start. False when the page does not lay it out.
 * @param {object} run
 * @param {Range} range
 */
function measure(run, range) {
  if (run.start !== undefined) return run.start !== null
  run.start = run.end = null
  if (run.atom) {
    const r = run.atom.getBoundingClientRect()
    if (r.height) run.start = run.end = r
    return run.start !== null
  }
  range.selectNodeContents(run.live)
  const rects = range.getClientRects()
  let first = null
  let last = null
  let lines = 1
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]
    if (!r.height) continue
    if (!first) first = r
    else if (lines === 1 && !sameLine(first, r)) lines = 2
    last = r
  }
  if (!first) return false
  if (lines > 1 && run.wraps) {
    const found = liveBreaks(run.live, range)
    if (!found) return false
    run.breaks = found.breaks
    run.start = found.start
    run.end = found.end
  } else {
    run.start = first
    run.end = last
  }
  return true
}

/**
 * The clone parent's text children, paired with the live parent's, or null when they differ
 * (a selection highlight, line-clamp text, content snapdom wrapped or replaced).
 * @param {Node} parent - clone parent
 * @param {Node|undefined} host - its live element
 * @param {WeakMap<Element, number>} axes - axesOf's memo for this pass
 */
function pairTexts(parent, host, axes) {
  if (!host || host.nodeType !== 1) return null
  const live = []
  for (let n = host.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) live.push(n)
  let i = 0
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType !== 3) continue
    if (i === live.length || live[i].data !== n.data) return null
    i++
  }
  if (i !== live.length) return null
  const cs = getStyle(host)
  // Vertical lines and lines under a rotation do not stack top to bottom on the page.
  if ((cs.writingMode || 'horizontal-tb') !== 'horizontal-tb' || axesOf(host, axes) === SKEWED) return null
  // freezeOneLine's inline pin already holds everything under a one-line box.
  const wraps = cs.textWrapMode !== 'nowrap' && parent.style?.getPropertyValue(ONE_LINE_PROP) !== 'nowrap'
  return { live, at: 0, cs, wraps }
}

/** A pin: the text of one live line, or of one stretch of white space no line breaks at. */
function pin(doc, text) {
  const el = doc.createElementNS(XHTML, 'span')
  // An attribute, not style.cssText: Gecko's CSSOM expands `all` into every longhand.
  el.setAttribute('style', PIN_STYLE)
  el.textContent = text
  return el
}

/**
 * Replace a run's copy with its pins: one per live line, with what each line broke at between them.
 * @param {object} run
 * @param {Text} node - the run's text node in the copy
 * @returns {Node} the last node in its place
 */
function pinRun(run, node) {
  const { breaks } = run
  const s = node.data
  const doc = node.ownerDocument
  const frag = doc.createDocumentFragment()
  for (let k = 0; k <= breaks.length; k++) {
    const from = k ? breaks[k - 1] : 0
    const to = k < breaks.length ? breaks[k] : s.length
    const last = k === breaks.length
    let a = from
    while (a < to && isSpace(s.charCodeAt(a))) a++
    let b = to
    while (b > a && isSpace(s.charCodeAt(b - 1))) b--
    // A soft hyphen the page broke at must stay a break opportunity, so it stays out.
    if (!last && b === to && s.charCodeAt(b - 1) === 0xad) b--
    const lo = !k && run.before ? from : a
    const hi = last && run.after ? to : b
    if (lo > from) frag.append(s.slice(from, lo))
    frag.append(pin(doc, s.slice(lo, hi)))
    if (hi < to) frag.append(s.slice(hi, to))
    else if (!last) {
      // The page broke inside a word: where hyphenation drew a hyphen, or where word-break,
      // overflow-wrap or the script allow a break.
      const hyphen = run.cs.hyphens === 'auto' && !/[-\u2010]/.test(s[b - 1])
      frag.append(hyphen ? '\u00ad' : doc.createElementNS(XHTML, 'wbr'))
    }
  }
  const tail = frag.lastChild
  node.replaceWith(frag)
  return tail
}

/** Per live document, one with no live ranges, where changing nodes costs nothing extra. */
const inertDocs = new WeakMap()

/** @param {Document} liveDoc */
function inertDocument(liveDoc) {
  let doc = inertDocs.get(liveDoc)
  if (!doc) inertDocs.set(liveDoc, doc = liveDoc.implementation.createHTMLDocument(''))
  return doc
}

/**
 * The copies of `nodes` in `copy`, a deep copy of `root`.
 * @param {Node} root
 * @param {Node} copy
 * @param {Set<Node>} nodes - nodes under `root`
 * @returns {Map<Node, Node>}
 */
function copiesOf(root, copy, nodes) {
  const twins = new Map()
  const a = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ALL)
  const b = copy.ownerDocument.createTreeWalker(copy, NodeFilter.SHOW_ALL)
  for (let x = root, y = copy; x && twins.size < nodes.size; x = a.nextNode(), y = b.nextNode()) {
    if (nodes.has(x)) twins.set(x, y)
  }
  if (twins.size < nodes.size) throw new Error('a node to pin is not in the serialized tree')
  return twins
}

/**
 * A copy of `fo` that keeps the live page's line breaks, or null when no line needs keeping.
 * The clone itself is only read.
 * @param {Element} fo - the foreignObject the svg engine serializes, with the clone in it
 * @param {Element} clone - the clone root
 * @param {Map<Node, Node>} nodeMap - clone element to live element
 * @param {Document} liveDoc - the captured element's document
 * @returns {Element|null}
 */
export function freezeLineBreaks(fo, clone, nodeMap, liveDoc) {
  if (ONE_LINE_PROP !== 'text-wrap-mode' || !fo || !clone || !nodeMap || !liveDoc) return null
  const range = liveDoc.createRange()
  const axes = new WeakMap()
  /** Per inline formatting context: the last thing on its lines, and white space since. */
  const chains = new Map()
  /** Clone parent to its paired text children. */
  const pairs = new Map()
  const runs = []
  const gaps = []
  /** Text runs whose last character meets the next run's on one live line. */
  const seams = []
  /** Atomic inlines that share a live line with what stands beside them. */
  const holds = new Set()

  const link = (ifc, run) => {
    let chain = chains.get(ifc)
    if (!chain) chains.set(ifc, chain = { last: null, gap: [] })
    const prev = chain.last
    if (prev) {
      // A line can break at white space or a `<wbr>` between the two, where two text nodes meet
      // at a character that allows a break (a `/`, a hyphen, CJK), or beside an atom. Only then
      // is the page asked.
      const apart = chain.gap.length || (prev.wraps && edgeSpace(prev, false)) || (run.wraps && edgeSpace(run, true))
      const seam = !apart && prev.node && run.node && (prev.wraps || run.wraps) && !(
        WORD_CHAR.test(prev.node.data[prev.node.data.length - 1]) && WORD_CHAR.test(run.node.data[0]))
      if ((apart || seam || prev.atom || run.atom) && measure(prev, range) && measure(run, range) && sameLine(prev.end, run.start)) {
        prev.after = true
        run.before = true
        for (const g of chain.gap) gaps.push(g)
        if (seam) seams.push(prev)
        if (prev.atom) holds.add(prev)
        if (run.atom) holds.add(run)
      }
      chain.gap.length = 0
    }
    chain.last = run
  }

  // Document order, so each formatting context sees its content in the order it lays it out.
  const stack = [clone, null]
  while (stack.length) {
    const ifc = stack.pop()
    const node = stack.pop()
    if (node.nodeType === 3) {
      const parent = node.parentNode
      let pair = pairs.get(parent)
      if (pair === undefined) pairs.set(parent, pair = pairTexts(parent, nodeMap.get(parent), axes))
      if (!pair) continue
      const live = pair.live[pair.at++]
      const s = node.data
      let a = 0
      while (a < s.length && isSpace(s.charCodeAt(a))) a++
      if (a === s.length) {
        if (pair.wraps && chains.get(ifc)?.last) chains.get(ifc).gap.push(node)
        continue
      }
      const run = { node, live, cs: pair.cs, wraps: pair.wraps, breaks: NO_BREAKS, start: undefined, end: null }
      link(ifc, run)
      if (run.wraps) runs.push(run)
      continue
    }
    if (node.nodeType !== 1) continue
    let inner = ifc
    const live = nodeMap.get(node)
    if (live) {
      const cs = getStyle(live)
      const display = cs.display || ''
      if (display === 'none') continue
      const inlineLevel = display !== 'contents' && (FLOWS_INLINE.has(display) || display.startsWith('inline') || display === 'math')
      if (live.namespaceURI !== XHTML || OPAQUE.has(live.localName)) {
        if (inlineLevel) link(ifc, { atom: live, el: node, cs, start: undefined, end: null })
        continue
      }
      if (live.localName === 'wbr') {
        if (chains.get(ifc)?.last) chains.get(ifc).gap.push(node)
        continue
      }
      if (!FLOWS_INLINE.has(display)) {
        // An inline-block and the like is an atom on its parent's line and lays out lines of its own.
        if (inlineLevel) link(ifc, { atom: live, el: node, cs, start: undefined, end: null })
        inner = live
      }
    }
    // A clone element with no live node (a wrapper snapdom added) lays out in its parent's lines.
    for (let c = node.lastChild; c; c = c.previousSibling) stack.push(c, inner)
  }

  const todo = []
  for (const run of runs) {
    const s = run.node.data
    let a = 0
    while (a < s.length && isSpace(s.charCodeAt(a))) a++
    let b = s.length
    while (b > a && isSpace(s.charCodeAt(b - 1))) b--
    const edges = (run.before && a > 0) || (run.after && b < s.length)
    if (!edges && !canBreak(s.slice(a, b), run.cs)) continue
    if (measure(run, range)) todo.push(run)
  }
  if (!todo.length && !gaps.length && !seams.length && !holds.size) return null

  const doc = inertDocument(liveDoc)
  const copy = doc.importNode(fo, true)
  const twin = copiesOf(fo, copy, new Set([...todo.map((run) => run.node), ...gaps, ...seams.map((run) => run.node),
    ...[...holds].map((a) => a.el)]))
  for (const run of todo) run.tail = pinRun(run, twin.get(run.node))
  for (const node of gaps) {
    const t = twin.get(node)
    // White space between two pieces of one line goes in a pin; a `<wbr>` there becomes a joiner.
    if (t.nodeType === 1) t.replaceWith(JOINER)
    else {
      const stand = pin(doc, '')
      t.replaceWith(stand)
      stand.append(t)
    }
  }
  for (const run of seams) (run.tail || twin.get(run.node)).after(JOINER)
  for (const a of holds) {
    // A line can break on either side of an atomic inline, white space or not, wherever its
    // parent wraps: Gecko took that break even with a joiner beside it. Inside a pin it cannot,
    // and the atom gets back what the pin would pass on to its own lines.
    const t = twin.get(a.el)
    const stand = pin(doc, '')
    t.replaceWith(stand)
    stand.append(t)
    for (const [p, pinned] of PIN_PASSES) {
      const v = a.cs.getPropertyValue(p)
      if (v && v !== pinned) t.style?.setProperty(p, v)
    }
  }
  return copy
}
