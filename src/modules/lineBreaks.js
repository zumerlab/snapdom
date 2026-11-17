/**
 * The page's own line breaks, kept in the tree the svg engine lays out under its layout zoom.
 *
 * At a devicePixelRatio other than 1, engines/svg.js lays the clone out under `zoom: <dpr>`
 * (#508). The pass runs when that zoom is not a whole number: a whole one keeps the page's grid,
 * and no line moved at 2x in Chromium with or without it. Firefox measures text in app units (1/60px) and rounds each glyph's advance at the
 * font size it lays out, so under zoom 1.25 a 12px line is shaped at 15px, and divided back a
 * line comes out up to 0.33px wider than on the page (Firefox 160), or narrower. Chrome 157's
 * zoomed text comes out within 0.0001px of the page's, but a box width or edge lands on the
 * zoomed 1/64px grid. Either way, a line with less room to spare breaks a word early.
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
 * Only the inline formatting contexts that could break differently get pins (`judge`). A line
 * breaks a word early when the clone lays it out wider than the room it had left, and pulls the
 * next line's first word up when it lays it out narrower by more than that word missed by, and
 * Firefox's text drifts both ways. So each line's room is read from its boxes against the
 * context's content box, along with the next line's first word, and a context with a line nearer
 * either edge than the engine can drift (`lineRisk`) is pinned whole. So is one the pass cannot
 * read that way: justified or balanced text, floats beside it, text that breaks between letters
 * or in CJK, a font with an `opsz` axis in Firefox, content it cannot pair with the page. Pinning
 * every line cost Chrome 5 to 12% of a capture, part of it in drawing the larger svg.
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

import { getStyle, softensWidth } from '../utils/index.js'
import { isFirefox } from '../utils/browser.js'
import { markInternalNode } from '../utils/ownership.js'
import { ONE_LINE_PROP, UNBREAKABLE_TEXT, SKEWED, PLAIN, SCALED, axesOf } from './styleFreeze.js'

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

/** Elements that draw nothing, wherever they stand. */
const UNRENDERED = new Set(['script', 'style', 'template', 'noscript', 'title'])

const NO_BREAKS = Object.freeze([])

/**
 * Text the pass can read the words of, in both engines' line breakers (UAX #14): Latin, Greek
 * and Cyrillic letters, digits, ASCII, and common punctuation and symbols. A break can follow a
 * hyphen, a dash or a `/`; chunkEnd and the guess's checks allow for that. Not combining marks,
 * right-to-left or complex scripts, CJK, Thai, emoji, a soft hyphen, or invisible characters
 * such as the special spaces, joiners and bidi controls.
 */
const SIMPLE_TEXT = /^[ \t\n\r\f!-~\u00A0-\u00AC\u00AE-\u024F\u0370-\u03FF\u0400-\u04FF\u1E00-\u1EFF\u2010-\u2027\u2030-\u205E\u20A0-\u20CF\u2100-\u22FF\u25A0-\u25FC\u2713-\u2717]*$/

/** Characters no line breaks inside a run of: letters, digits and apostrophes. */
const LETTER = /[0-9A-Za-z_'\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u1E00-\u1EFF\u2019]/

/** Characters a line can break after but not before: a hyphen, a slash, closing punctuation. */
const BREAKS_AFTER = /[-/,.:;!?)\]}%\u2010\u2013\u201D]/

/** Case changes keep a character a character; full-width forms break like CJK. */
const CASES = new Set(['none', 'uppercase', 'lowercase', 'capitalize'])

/** Block containers whose content box is the width every line of theirs gets. */
const BLOCKS = new Set(['block', 'inline-block', 'list-item', 'flow-root', 'table-caption'])

/** Block containers that lay their content out in a box of their own making. */
const OWN_LAYOUT = new Set(['button', 'fieldset', 'legend', 'details', 'summary', 'marquee'])

/** text-align on a left-to-right line: 0 start, 1 centre, 2 end. Justified text is missing. */
const ALIGN = {
  start: 0, left: 0, '-webkit-left': 0, '-moz-left': 0,
  center: 1, '-webkit-center': 1, '-moz-center': 1,
  end: 2, right: 2, '-webkit-right': 2, '-moz-right': 2,
}

/** An item of a formatting context: a forced break, a `<br>` or a block between its lines. */
const BREAK = { forced: true }

/** Words a wrong guess may walk before liveBreaks takes over. */
const MAX_STEPS = 6

/**
 * How far right of a line's left edge a word may start and still be its first, in px: less than
 * any word and space before it could take.
 */
const EDGE = 0.25

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

const px = (v) => parseFloat(v) || 0

/**
 * Whether the clone could wrap inside `text` without the page's say: white space, CJK or any
 * other opportunity, or a word that overflow-wrap, word-break or hyphenation may split.
 * @param {string} text - a run without its edge white space
 * @param {CSSStyleDeclaration} cs - the live style the run inherits
 */
function canBreak(text, cs) {
  if (!UNBREAKABLE_TEXT.test(text) || cs.overflowWrap !== 'normal' || cs.hyphens === 'auto') return true
  const wb = cs.wordBreak
  return (wb !== 'normal' && wb !== 'keep-all') || cs.lineBreak === 'anywhere'
}

/** Whether the clone could wrap inside a run without the page's say (canBreak), read once. */
function looseOf(run) {
  if (run.loose === undefined) {
    const s = run.node.data
    let a = 0
    while (a < s.length && isSpace(s.charCodeAt(a))) a++
    let b = s.length
    while (b > a && isSpace(s.charCodeAt(b - 1))) b--
    run.loose = canBreak(s.slice(a, b), run.cs)
  }
  return run.loose
}

/**
 * Whether text in this style breaks only at its collapsible white space, and the room a line has
 * left therefore says where it breaks.
 * @param {CSSStyleDeclaration} cs
 */
function plainBreaks(cs) {
  // One read per property: each CSSOM getter call is a read of its own.
  let collapse = cs.whiteSpaceCollapse
  if (!collapse) {
    const ws = cs.whiteSpace
    collapse = ws === 'normal' || ws === 'nowrap' ? 'collapse' : ''
  }
  const wb = collapse === 'collapse' && cs.wordBreak
  return (wb === 'normal' || wb === 'keep-all') && cs.overflowWrap === 'normal' &&
    cs.lineBreak !== 'anywhere' && cs.hyphens !== 'auto' && CASES.has(cs.textTransform || 'none') &&
    cs.direction === 'ltr'
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
      // The character's own rect is the last one with ink. Chromium 157 puts the hyphen of
      // `hyphens: auto` in the rects of the letter after it, so their union spans two lines
      // and reads as the same line as both. A zero-width joiner or a collapsed mark has none.
      const rects = range.getClientRects()
      r = null
      for (let n = rects.length - 1; n >= 0 && !r; n--) if (rects[n].width && rects[n].height) r = rects[n]
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
 * A run's line boxes on the page, one read: its client rects with ink, merged per line. The
 * white space a line breaks at hangs there with no width, in Chrome 157 and Firefox 160 alike,
 * and a run's leading space can sit at the end of the line before, so rects with no width are
 * left out.
 * @param {object} run
 * @param {Range} range
 * @returns {Array<{top: number, bottom: number, height: number, left: number, right: number}>}
 */
function runLines(run, range) {
  if (run.rl) return run.rl
  range.selectNodeContents(run.live)
  const rects = range.getClientRects()
  const rl = []
  let line = null
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]
    if (!r.width || !r.height) continue
    if (line && sameLine(line, r)) {
      line.left = Math.min(line.left, r.left)
      line.right = Math.max(line.right, r.right)
    } else rl.push(line = { top: r.top, bottom: r.bottom, height: r.height, left: r.left, right: r.right })
  }
  return (run.rl = rl)
}

/**
 * The box of text[i, j) on the page, when it sits on one line. WebKit gives a character just
 * after a break with no space before it a second, empty rect at the end of the line before, so
 * only rects with width count.
 * @param {Text} text
 * @param {number} i
 * @param {number} j
 * @param {Range} range
 */
function textBox(text, i, j, range) {
  range.setStart(text, i)
  range.setEnd(text, j)
  const rects = range.getClientRects()
  let box = null
  for (let k = rects.length - 1; k >= 0; k--) {
    const r = rects[k]
    if (!r.width || !r.height) continue
    if (!box) box = { top: r.top, bottom: r.bottom, height: r.height, left: r.left, right: r.right }
    else if (sameLine(box, r)) box.left = Math.min(box.left, r.left)
    else return null
  }
  return box
}

/** The index of a line box that `box` sits on, or -1. */
function lineIndex(box, rl) {
  if (box) for (let i = 0; i < rl.length; i++) if (sameLine(box, rl[i])) return i
  return -1
}

/** The end of the word that starts at `k`: the next white space, or the end of the text. */
function wordEnd(s, k) {
  while (k < s.length && !isSpace(s.charCodeAt(k))) k++
  return k
}

/**
 * The end of the first piece of the word at `k` that no line breaks inside, or of less: one
 * ends after a hyphen, a dash, a `/` or closing punctuation, and before any other character
 * that is not a letter, which a break may precede. Less is safe: a shorter first word needs less
 * room to be pulled up.
 */
function chunkEnd(s, k) {
  const e = wordEnd(s, k)
  for (let i = k; i < e; i++) {
    if (LETTER.test(s[i])) continue
    return BREAKS_AFTER.test(s[i]) ? i + 1 : Math.max(i, k + 1)
  }
  return e
}

/** The last character before the white space that precedes `k`. */
function lastBefore(s, k) {
  k--
  while (k >= 0 && isSpace(s.charCodeAt(k))) k--
  return k
}

/** The first character of the word that holds `i`. */
function wordStart(s, i) {
  while (i > 0 && !isSpace(s.charCodeAt(i - 1))) i--
  return i
}

/** Whether a word starts at `k`. */
function startsWord(s, k) {
  return !isSpace(s.charCodeAt(k)) && isSpace(s.charCodeAt(k - 1))
}

/** The word start nearest to `g` strictly between `lo` and `hi`, or -1. */
function nearestStart(s, g, lo, hi) {
  g = Math.min(Math.max(g, lo + 1), hi - 1)
  for (let d = 0; g - d > lo || g + d < hi; d++) {
    if (g + d < hi && startsWord(s, g + d)) return g + d
    if (g - d > lo && startsWord(s, g - d)) return g - d
  }
  return -1
}

/**
 * Where a run of plain text starts each line after its first, and the box of each such line's
 * first word. A line holds the run's characters about in proportion to its width, so each break
 * is guessed from the run's line boxes, moved to the nearest word start and checked with a read
 * of the word: one at the left edge of the line below starts it. Otherwise a second read, of the
 * character before the white space, says which side of the break the guess is on, and a wrong
 * guess walks a word per read. Past MAX_STEPS words, or on anything a break at white space
 * cannot explain, null hands the run to liveBreaks.
 * @param {object} run - wraps, plain text, its line boxes in run.rl
 * @param {Range} range
 * @returns {{breaks: number[], words: Array<object>}|null}
 */
function guessBreaks(run, range) {
  const rl = run.rl
  const t = run.live
  const s = t.data
  let a = 0
  while (a < s.length && isSpace(s.charCodeAt(a))) a++
  let b = s.length
  while (b > a && isSpace(s.charCodeAt(b - 1))) b--
  let total = 0
  for (const l of rl) total += l.right - l.left
  const breaks = []
  const words = []
  let from = a
  let done = 0
  for (let j = 1; j < rl.length; j++) {
    done += rl[j - 1].right - rl[j - 1].left
    let k = nearestStart(s, a + Math.round((b - a) * done / total), from, b)
    if (k < 0) return null
    let p = -1
    let pl = -1
    let kl = -1
    let word = null
    for (let step = 0; ; step++) {
      if (step > MAX_STEPS) return null
      if (kl < 0) {
        word = textBox(t, k, wordEnd(s, k), range)
        kl = lineIndex(word, rl)
        // A word at the run's left edge on line j starts that line: in left-to-right text,
        // nothing of the run sits before it there, and the line above holds the word before.
        if (kl === j && word.left - rl[j].left < EDGE) break
      }
      if (pl < 0) {
        p = lastBefore(s, k)
        pl = lineIndex(textBox(t, p, p + 1, range), rl)
      }
      if (pl < 0 || kl < 0) return null
      if (pl === j - 1 && kl === j) break
      if (kl < j) {
        // The word at k is still on a line above: the break comes after it.
        const e = wordEnd(s, k)
        let n = e
        while (n < b && isSpace(s.charCodeAt(n))) n++
        if (n >= b) return null
        p = e - 1
        pl = kl
        k = n
        kl = -1
      } else if (pl >= j) {
        // The word before k is already below: the break comes before that word.
        const w = wordStart(s, p)
        if (w <= from) return null
        kl = pl
        word = null
        k = w
        pl = -1
      } else return null
    }
    if (!word) {
      word = textBox(t, k, wordEnd(s, k), range)
      if (lineIndex(word, rl) !== j) return null
    }
    breaks.push(k)
    words.push(word)
    from = k
  }
  return { breaks, words }
}

/**
 * A wrapping run of simple text's line starts, guessed or else bisected, and kept on the run;
 * null when the page lays none of its characters out.
 * @param {object} run - with run.rl
 * @param {Range} range
 * @returns {{breaks: number[], words: Array<object>|null}|null}
 */
function foundOf(run, range) {
  if (run.found === undefined) {
    run.found = guessBreaks(run, range)
    if (!run.found) {
      const lb = liveBreaks(run.live, range)
      run.found = lb && { breaks: lb.breaks, words: null }
    }
  }
  return run.found
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
  if (run.simple) {
    const rl = runLines(run, range)
    if (!rl.length) return false
    if (rl.length > 1 && run.wraps) {
      const found = foundOf(run, range)
      if (!found) return false
      run.breaks = found.breaks
    }
    run.start = rl[0]
    run.end = rl[rl.length - 1]
    return true
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
  if ((cs.writingMode || 'horizontal-tb') !== 'horizontal-tb' || textAxes(host, cs, axes) === SKEWED) return null
  // freezeOneLine's inline pin already holds everything under a one-line box.
  const wraps = cs.textWrapMode !== 'nowrap' && parent.style?.getPropertyValue(ONE_LINE_PROP) !== 'nowrap'
  return { live, at: 0, cs, wraps, plain: plainBreaks(cs) }
}

/**
 * axesOf for an element that holds text, in two reads where axesOf takes up to seven: a
 * transform does not apply to an inline box, which is only scaled by its own `zoom`.
 * @param {Element} el
 * @param {CSSStyleDeclaration} cs - its style
 * @param {WeakMap<Element, number>} memo - axesOf's
 */
function textAxes(el, cs, memo) {
  let v = memo.get(el)
  if (v !== undefined) return v
  const parent = el.parentElement
  if (!parent || cs.display !== 'inline') return axesOf(el, memo)
  v = axesOf(parent, memo)
  const zoom = cs.zoom
  if (v === PLAIN && zoom && zoom !== '1') v = SCALED
  memo.set(el, v)
  return v
}

/**
 * How far the clone's lines may drift from the page's, per engine, as the room a line must keep
 * on either side of a break. `early(n, edges)`: the least room a line may have left; `pull(n,
 * edges)`: the least a next line's first word may miss it by, or null when the engine never
 * pulls one up. `n` counts what rounds on the line: its characters, inline box edges and atoms;
 * `edges` the box edges and atoms alone. `starts`: the policy needs each line's characters and
 * first word; `optical`: fonts with an `opsz` axis drift past it.
 *
 * Gecko rounds each glyph advance, letter-spacing step and box edge to 1/60px on the page, and to
 * 1/60px of the zoomed clone, 1/(60z) of a page pixel. A line of n such values moves by at most
 * n(z+1)/(120z), with a tenth more for safety, and the frozen box width rounds once more. In
 * Zen 1.24 (Firefox 160) at 1.25x, a five-letter "Month" in the shot came out 0.067px wider than
 * on the page, 4/5 of that bound and twice n/(120z), and no text node of four test pages passed
 * the bound. An `opsz` font follows the zoomed size there: Segoe UI Variable Text at 24px came
 * out 4.15px narrower over 110 characters.
 *
 * Blink shapes the zoomed text at the page's device size, and every text node of the same pages
 * came out within 0.0001px of its live width at 1.25x and 2x. What moves is a box width or edge
 * that lands on the zoomed clone's 1/64px grid, and 3.7.6 broke no line that had 0 to 4/64px
 * left or whose next word missed by 1 to 4/64px. So only nearly full lines count.
 * @param {number} zoom - the layout zoom
 * @param {'gecko'|'blink'} [engine]
 */
export function lineRisk(zoom, engine = isFirefox() ? 'gecko' : 'blink') {
  if (engine === 'gecko') {
    const q = 1.1 * (zoom + 1) / (120 * zoom)
    const base = 1 / (60 * zoom) + 0.01
    const room = (n) => base + n * q
    return { zoom, starts: true, optical: true, early: room, pull: room }
  }
  const q = 1 / (64 * zoom)
  return { zoom, starts: false, optical: false, early: (n, edges) => 0.05 + edges * q, pull: null }
}

/** The width a space takes in this style, at least, from a canvas: 0 when it cannot tell. */
function spaceWidth(cs, c) {
  let w = c.spaceMemo.get(cs)
  if (w !== undefined) return w
  const font = cs.font || `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
  const key = `${font}|${cs.wordSpacing}|${cs.letterSpacing}`
  w = c.spaceMemo.get(key)
  if (w === undefined) {
    w = 0
    try {
      const ctx = c.ctx || (c.ctx = c.doc.createElement('canvas').getContext('2d'))
      ctx.font = '1px serif'
      ctx.font = font
      // A font the canvas cannot parse leaves the last one set.
      if (ctx.font !== '1px serif') {
        w = ctx.measureText('x x').width - ctx.measureText('xx').width + px(cs.wordSpacing) + px(cs.letterSpacing)
        w = Math.max(0, w - 0.05)
      }
    } catch { w = 0 }
    c.spaceMemo.set(key, w)
  }
  c.spaceMemo.set(cs, w)
  return w
}

/**
 * The face a run is shaped with, as far as an `opsz` axis cares (any size), or '' when its
 * optical size cannot follow the font size. Read once per style in a pass.
 * @param {CSSStyleDeclaration} cs
 * @param {object} c - the pass
 */
function faceKey(cs, c) {
  let key = c.faces.get(cs)
  if (key === undefined) {
    const vs = cs.fontOpticalSizing === 'auto' ? cs.fontVariationSettings || '' : 'opsz'
    key = /opsz/.test(vs) ? '' : `${cs.fontStyle}|${cs.fontWeight}|${cs.fontStretch}|${cs.fontFamily}|${vs}`
    c.faces.set(cs, key)
  }
  return key
}

/**
 * The faces of these contexts with an `opsz` axis that follows the font size, which Gecko sets
 * from the zoomed size in the clone, so the clone's text can come out percents wider or
 * narrower. One probe shapes a sample in each face twice, with `opsz` held at either end of any
 * range, and a face whose two widths differ has the axis. That holds at any size and zoom, so a
 * face is probed once per document while its fonts stay as they are: one layout, of the probe
 * alone, on a capture that meets new faces.
 * @param {Array<object>} ctxs - formatting contexts to judge
 * @param {object} c - the pass
 * @returns {Set<string>} faceKey of each such face
 */
function opticalFonts(ctxs, c) {
  const doc = c.doc
  const out = new Set()
  // Not while fonts load: a face that has not loaded yet is a fallback's.
  const stamp = fontStamp(doc)
  let memo = stamp === null ? null : opticalMemo.get(doc)
  if (stamp !== null && memo?.stamp !== stamp) opticalMemo.set(doc, memo = { stamp, faces: new Map() })
  const faces = new Map()
  for (const ifc of ctxs) {
    if (ifc.why) continue
    for (const it of ifc.items) {
      if (!it.node) continue
      const cs = it.cs
      const key = faceKey(cs, c)
      if (!key) continue
      const known = memo?.faces.get(key)
      if (known !== undefined) {
        if (known) out.add(key)
      } else if (!faces.has(key)) faces.set(key, { cs, text: `${SAMPLE} ${it.node.data.trim().slice(0, 40).trim()}` })
    }
  }
  if (!faces.size) return out
  const probe = markInternalNode(doc.createElement('div'))
  probe.style.cssText = 'all:initial;position:absolute!important;left:-99999px!important;top:0!important;' +
    'visibility:hidden!important;white-space:nowrap!important;pointer-events:none!important;font-size:16px'
  const shaped = []
  for (const [key, { cs, text }] of faces) {
    const vs = cs.fontVariationSettings && cs.fontVariationSettings !== 'normal' ? `${cs.fontVariationSettings}, ` : ''
    const pair = []
    for (const opsz of ['"opsz" 1', '"opsz" 1000']) {
      const span = doc.createElement('span')
      // Important, as the page's own rules may be: anything else is the same in both.
      const st = span.style
      st.setProperty('font-style', cs.fontStyle, 'important')
      st.setProperty('font-weight', cs.fontWeight, 'important')
      st.setProperty('font-stretch', cs.fontStretch, 'important')
      st.setProperty('font-family', cs.fontFamily, 'important')
      st.setProperty('font-variation-settings', vs + opsz, 'important')
      span.textContent = text
      // A line each: no kerning or white space where the two meet.
      probe.append(span, doc.createElement('br'))
      pair.push(span)
    }
    shaped.push([key, pair])
  }
  ;(doc.body || doc.documentElement).appendChild(probe)
  try {
    for (const [key, [a, b]] of shaped) {
      const optical = Math.abs(a.getBoundingClientRect().width - b.getBoundingClientRect().width) > 0.001
      if (optical) out.add(key)
      memo?.faces.set(key, optical)
    }
  } finally {
    probe.remove()
  }
  return out
}

/** Text for the opsz probe, ahead of the page's own: an axis shows in most letters. */
const SAMPLE = 'Hamburgefonstiv 0123456789'

/** Per document, opticalFonts' answer for each face, and the fonts it holds for. */
const opticalMemo = new WeakMap()

/**
 * The document's fonts as far as the opsz probe cares: how many faces it has, and how many of
 * them have loaded. Null while any load.
 * @param {Document} doc
 * @returns {string|null}
 */
function fontStamp(doc) {
  const set = doc.fonts
  if (!set) return ''
  if (set.status !== 'loaded') return null
  let n = 0
  set.forEach((f) => {
    if (f.status === 'loaded') n++
  })
  return `${set.size}|${n}`
}

/**
 * Why an inline formatting context's lines could break differently in the clone, or '' when
 * every line keeps more room on both sides of its break than the engine can drift. The reason
 * names a fallback (the context cannot be read that way) or 'early' / 'pull'.
 *
 * One read per text node, atom, inline box with edges and the root: a line's right edge, and its
 * room against the root's content box for its alignment. Under a policy with `starts`, each
 * text node's breaks as well (guessBreaks), for the characters on each line and the next line's
 * first word.
 * @param {object} ifc
 * @param {object} c - the pass
 * @returns {string}
 */
function judge(ifc, c) {
  if (ifc.why) return ifc.why
  const root = ifc.root
  if (!root) return 'root'
  const cs = getStyle(root)
  const display = cs.display || ''
  // A content-sized box (a table cell, a <span> made a block) can come out wider or narrower in
  // the clone; a button or a fieldset lays its lines out in an inner box.
  if (!BLOCKS.has(display) || OWN_LAYOUT.has(root.localName) || softensWidth(root.localName, display)) return 'box'
  if ((cs.writingMode || 'horizontal-tb') !== 'horizontal-tb' || cs.direction !== 'ltr') return 'direction'
  const align = ALIGN[cs.textAlign]
  const last = cs.textAlignLast
  if (align === undefined || (last && last !== 'auto' && ALIGN[last] !== align)) return 'align'
  const wrapStyle = cs.textWrapStyle
  if (wrapStyle === 'balance' || wrapStyle === 'pretty') return 'balance'
  const cc = cs.columnCount
  const cw = cs.columnWidth
  if ((cc && cc !== 'auto') || (cw && cw !== 'auto')) return 'columns'
  // Centred and end-aligned lines are read from both edges, and an indent or a marker inside
  // takes room the line boxes do not show.
  if (align && (px(cs.textIndent) || (display === 'list-item' && cs.listStylePosition === 'inside'))) return 'indent'
  if (axesOf(root, c.axes) !== PLAIN) return 'scaled'
  for (const it of ifc.items) {
    if (!it.node) continue
    if (!it.plain || (it.wraps && !it.simple)) return 'text'
    if (c.optical?.size && c.optical.has(faceKey(it.cs, c))) return 'optical'
  }

  const own = root.getClientRects()
  if (own.length !== 1) return 'fragmented'
  const box = own[0]
  const bl = px(cs.borderLeftWidth)
  const br = px(cs.borderRightWidth)
  const clip = (v) => v === 'visible' || v === 'clip'
  // The clone may not draw the same scrollbar, and a scrolled box moves its lines.
  if ((!clip(cs.overflowX) || !clip(cs.overflowY)) && (root.scrollLeft || root.offsetWidth - root.clientWidth - bl - br >= 2)) return 'scrollbar'
  const cl = box.left + bl + px(cs.paddingLeft)
  const cr = box.right - br - px(cs.paddingRight)
  for (const f of c.floats) {
    if (f === root || f.contains(root)) continue
    let r = c.floatBoxes.get(f)
    if (!r) {
      const b = f.getBoundingClientRect()
      const fs = getStyle(f)
      c.floatBoxes.set(f, r = { top: b.top - px(fs.marginTop), bottom: b.bottom + px(fs.marginBottom),
        left: b.left - px(fs.marginLeft), right: b.right + px(fs.marginRight) })
    }
    if (r.bottom > box.top && r.top < box.bottom && r.right > box.left && r.left < box.right) return 'float'
  }

  const starts = c.risk.starts
  /** Lines in order, top to bottom, with their edges, what rounds on them and how each starts. */
  const lines = []
  let cur = null
  let spaces = []
  let forced = false
  let prev = null
  for (const it of ifc.items) {
    if (it === BREAK) {
      forced = true
      continue
    }
    if (it.space) {
      spaces.push(it.space)
      continue
    }
    let frags
    if (it.atom) {
      const r = it.atom.getBoundingClientRect()
      it.start = it.end = r.height ? r : null
      if (!r.width || !r.height) continue
      frags = [{ top: r.top, bottom: r.bottom, height: r.height,
        left: r.left - px(it.cs.marginLeft), right: r.right + px(it.cs.marginRight) }]
    } else {
      frags = runLines(it, c.range)
      if (!frags.length) continue
      if (starts && it.wraps && frags.length > 1 && !foundOf(it, c.range)) return 'unmeasured'
      if (edgeSpace(it, true)) spaces.push(it.cs)
    }
    if (prev && prev.node && edgeSpace(prev, false)) spaces.push(prev.cs)
    for (let r = 0; r < frags.length; r++) {
      const f = frags[r]
      if (!cur || !sameLine(cur, f)) {
        // Content in order only moves down the lines.
        if (cur && f.top < cur.top) return 'order'
        lines.push(cur = { top: f.top, bottom: f.bottom, height: f.height, left: f.left, right: f.right,
          n: 0, edges: 0, first: it, at: r, spaces: r ? [it.cs] : spaces, forced: !r && forced })
      } else {
        cur.top = Math.min(cur.top, f.top)
        cur.bottom = Math.max(cur.bottom, f.bottom)
        cur.height = cur.bottom - cur.top
        cur.left = Math.min(cur.left, f.left)
        cur.right = Math.max(cur.right, f.right)
      }
      // Only a policy that reads line starts counts characters.
      if (it.atom) {
        if (starts) cur.n += atomCount(it)
        cur.edges++
      } else if (starts) cur.n += charCount(it, r)
    }
    spaces = []
    forced = false
    prev = it
  }
  // An inline box's start edge sits on the line it starts, its end edge on the line it ends.
  for (const bx of ifc.boxes) {
    const rects = bx.el.getClientRects()
    let a = null
    let z = null
    for (let i = 0; i < rects.length; i++) if (rects[i].height) { a ||= rects[i]; z = rects[i] }
    if (!a) continue
    for (const [r, side] of [[a, 0], [z, 1]]) {
      if (!(side ? bx.end : bx.start)) continue
      const L = lines.find((l) => sameLine(l, r))
      if (!L) return 'order'
      if (side) L.right = Math.max(L.right, r.right + bx.mr)
      else L.left = Math.min(L.left, r.left - bx.ml)
      L.n++
      L.edges++
    }
  }

  for (const L of lines) {
    L.room = align === 0 ? cr - L.right : align === 2 ? L.left - cl : cr - cl - (L.right - L.left)
    if (L.room < c.risk.early(L.n, L.edges)) return 'early'
  }
  if (!c.risk.pull) return ''
  for (let i = 0; i + 1 < lines.length; i++) {
    const L = lines[i]
    const M = lines[i + 1]
    if (M.forced) continue
    // M's first word, at least, and the space before it.
    const it = M.first
    let word
    let n
    let joined = false
    if (it.atom) {
      word = it.start.width + px(it.cs.marginLeft) + px(it.cs.marginRight)
      n = atomCount(it)
    } else if (!it.wraps) {
      word = it.rl[M.at].right - it.rl[M.at].left
      n = it.node.data.length
    } else {
      const s = it.node.data
      let k
      let box = null
      if (M.at) {
        const found = foundOf(it, c.range)
        if (!found) return 'unmeasured'
        k = found.breaks[M.at - 1]
        box = found.words ? found.words[M.at - 1] : null
      } else {
        k = 0
        while (k < s.length && isSpace(s.charCodeAt(k))) k++
      }
      const e = chunkEnd(s, k)
      if (e !== wordEnd(s, k)) box = null
      // A break after a hyphen or a `/` leaves no white space to the next line.
      if (M.at && !isSpace(s.charCodeAt(k - 1))) joined = true
      if (!box) {
        let z = s.length
        while (z > e && isSpace(s.charCodeAt(z - 1))) z--
        // A run that is one word on one line is its own first word: no read.
        box = !M.at && it.rl.length === 1 && e === z ? it.rl[0] : textBox(it.live, k, e, c.range)
      }
      if (!box) return 'unmeasured'
      word = box.right - box.left
      n = e - k
    }
    // The white space before the word only adds to the miss, so it is measured only when the
    // word alone comes too close.
    const miss = word - L.room
    const least = c.risk.pull(L.n + 1 + n, L.edges)
    if (miss >= least) continue
    let space = Infinity
    if (!joined) for (const sc of M.spaces) space = Math.min(space, spaceWidth(sc, c))
    if (space === Infinity) space = 0
    if (space + miss < least) return 'pull'
  }
  return ''
}

/** What rounds on run line `r`: its characters, again for letter- and word-spacing. */
function charCount(run, r) {
  const s = run.node.data
  const breaks = run.found ? run.found.breaks : NO_BREAKS
  const from = r && breaks.length >= r ? breaks[r - 1] : 0
  const to = r < breaks.length ? breaks[r] : s.length
  if (run.k === undefined) run.k = 1 + (px(run.cs.letterSpacing) ? 1 : 0) + (px(run.cs.wordSpacing) ? 1 : 0)
  return (to - from) * run.k
}

/**
 * What rounds across an atom: its two edges, and the text of one whose width follows its content
 * in the clone (getStyleKey softens the width of a <span> or <code> made an inline-block).
 */
function atomCount(atom) {
  if (atom.n === undefined) {
    atom.n = 2 + (softensWidth(atom.atom.localName, atom.cs.display || '') ? atom.atom.textContent.length : 0)
  }
  return atom.n
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

/** Whether a relatively positioned box sits away from where its line put it. */
function shifted(cs, position = cs.position) {
  if (position !== 'relative' && position !== 'sticky') return false
  for (const side of [cs.left, cs.right, cs.top, cs.bottom]) if (side !== 'auto' && px(side)) return true
  return false
}

/**
 * A copy of `fo` that keeps the live page's line breaks, or null when no line needs keeping.
 * The clone itself is only read.
 * @param {Element} fo - the foreignObject the svg engine serializes, with the clone in it
 * @param {Element} clone - the clone root
 * @param {Map<Node, Node>} nodeMap - clone element to live element
 * @param {Document} liveDoc - the captured element's document
 * @param {object|null} [risk] - lineRisk's policy: pin only the contexts it finds at risk. Without
 *   one, every line is pinned.
 * @returns {Element|null}
 */
export function freezeLineBreaks(fo, clone, nodeMap, liveDoc, risk = null) {
  if (ONE_LINE_PROP !== 'text-wrap-mode' || !fo || !clone || !nodeMap || !liveDoc) return null
  const range = liveDoc.createRange()
  const axes = new WeakMap()
  /** Per inline formatting context, keyed by its live root (null for none). */
  const ifcs = new Map()
  /** Clone parent to its paired text children. */
  const pairs = new Map()
  /** Floated elements, which take room from the lines beside them. */
  const floats = []

  const at = (root) => {
    let ifc = ifcs.get(root)
    if (!ifc) {
      ifcs.set(root, ifc = { root, items: [], links: [], runs: [], boxes: [], last: null, gap: [], why: '' })
    }
    return ifc
  }
  const mark = (root, why) => {
    const ifc = at(root)
    if (!ifc.why) ifc.why = why
  }

  // The last thing on a context's lines and the white space since; a line can break at white
  // space or a `<wbr>` between the two, or where two text nodes meet at a character that allows
  // a break (a `/`, a hyphen, CJK). Those pairs are read once the context is known to need pins.
  const link = (ifc, run) => {
    const prev = ifc.last
    if (prev) {
      const apart = ifc.gap.length || (prev.wraps && edgeSpace(prev, false)) || (run.wraps && edgeSpace(run, true))
      const seam = !apart && prev.node && run.node && (prev.wraps || run.wraps) && !(
        WORD_CHAR.test(prev.node.data[prev.node.data.length - 1]) && WORD_CHAR.test(run.node.data[0]))
      if (apart || seam || prev.atom || run.atom) ifc.links.push({ prev, run, gap: ifc.gap.slice(), seam })
      ifc.gap.length = 0
    }
    ifc.last = run
    ifc.items.push(run)
  }
  const atom = (ifc, live, cs, el) => {
    const tf = cs.transform
    const tr = cs.translate
    if (shifted(cs) || (tf && tf !== 'none') || (tr && tr !== 'none')) mark(ifc.root, 'shifted')
    if (px(cs.marginLeft) < 0 || px(cs.marginRight) < 0) mark(ifc.root, 'margin')
    link(ifc, { atom: live, el, cs, start: undefined, end: null })
  }

  // Document order, so each formatting context sees its content in the order it lays it out.
  const stack = [clone, null]
  while (stack.length) {
    const root = stack.pop()
    const node = stack.pop()
    if (node.nodeType === 3) {
      const parent = node.parentNode
      let pair = pairs.get(parent)
      if (pair === undefined) pairs.set(parent, pair = pairTexts(parent, nodeMap.get(parent), axes))
      const s = node.data
      let a = 0
      while (a < s.length && isSpace(s.charCodeAt(a))) a++
      if (!pair) {
        // Text on these lines that the pass cannot read.
        if (a < s.length) mark(root, 'unpaired')
        continue
      }
      const live = pair.live[pair.at++]
      const ifc = at(root)
      if (a === s.length) {
        if (pair.wraps && ifc.last) {
          ifc.gap.push(node)
          ifc.items.push({ space: pair.cs })
        }
        continue
      }
      const run = { node, live, cs: pair.cs, wraps: pair.wraps, plain: pair.plain, simple: pair.plain && SIMPLE_TEXT.test(s),
        loose: undefined, breaks: NO_BREAKS, start: undefined, end: null }
      link(ifc, run)
      if (run.wraps) ifc.runs.push(run)
      continue
    }
    if (node.nodeType !== 1) continue
    let inner = root
    const live = nodeMap.get(node)
    if (live) {
      const cs = getStyle(live)
      const display = cs.display || ''
      if (display === 'none') continue
      const inlineLevel = display !== 'contents' && (FLOWS_INLINE.has(display) || display.startsWith('inline') || display === 'math')
      const position = cs.position
      const out = position === 'absolute' || position === 'fixed'
      // A floated box is a block: no inline-level one floats.
      const float = inlineLevel ? '' : cs.float
      if (float && float !== 'none') floats.push(live)
      else if (!inlineLevel && !out && display !== 'contents' && ifcs.has(root)) {
        // A block in a run of lines ends them: nothing below it moves up past it.
        ifcs.get(root).items.push(BREAK)
      }
      if (live.namespaceURI !== XHTML || OPAQUE.has(live.localName)) {
        if (inlineLevel) atom(at(root), live, cs, node)
        continue
      }
      if (live.localName === 'wbr') {
        if (ifcs.get(root)?.last) ifcs.get(root).gap.push(node)
        continue
      }
      if (live.localName === 'br') {
        if (ifcs.has(root)) ifcs.get(root).items.push(BREAK)
        continue
      }
      if (!FLOWS_INLINE.has(display)) {
        // An inline-block and the like is an atom on its parent's line and lays out lines of its own.
        if (inlineLevel) atom(at(root), live, cs, node)
        // A box as wide as its own text, with that text on one line, cannot wrap in the clone:
        // its width follows the same text there. Every cell of a data table ends here
        // (250 rows of 6 on a 1.25x Chromium grid: the pass cost 8.1 ms, now 0.9).
        if (!live.childElementCount && softensWidth(live.localName, display) &&
          live.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom) < 1.5 * (px(cs.lineHeight) || 1.2 * px(cs.fontSize))) continue
        inner = live
      } else if (display === 'inline') {
        // Padding, borders and margins at an inline box's ends take room on its first and last lines.
        if (cs.direction !== 'ltr') mark(root, 'direction')
        if (shifted(cs, position)) mark(root, 'shifted')
        const ml = px(cs.marginLeft)
        const mr = px(cs.marginRight)
        if (ml < 0 || mr < 0) mark(root, 'margin')
        const start = ml + px(cs.paddingLeft) + px(cs.borderLeftWidth)
        const end = mr + px(cs.paddingRight) + px(cs.borderRightWidth)
        if (start || end) {
          if (cs.boxDecorationBreak === 'clone' || cs.webkitBoxDecorationBreak === 'clone') mark(root, 'clone')
          at(root).boxes.push({ el: live, start: start > 0, end: end > 0, ml, mr })
        }
      } else if (display !== 'contents') mark(root, 'ruby')
    } else if (UNRENDERED.has(node.localName)) continue
    else {
      // A clone element with no live node: pseudo-element content, or a wrapper snapdom added.
      // Either lays out in its parent's lines, where the pass cannot read it, unless it is out
      // of the flow.
      const pseudo = node.getAttribute?.('data-snapdom-pseudo')
      const host = pseudo && nodeMap.get(node.parentNode)
      const ps = host ? getStyle(host, pseudo) : null
      if (!ps || (ps.position !== 'absolute' && ps.position !== 'fixed')) mark(root, pseudo ? 'pseudo' : 'wrapper')
    }
    for (let c = node.lastChild; c; c = c.previousSibling) stack.push(c, inner)
  }

  // The contexts that hold anything to pin, and the ones of those that need it.
  const todoCtx = []
  for (const ifc of ifcs.values()) if (ifc.links.length || ifc.runs.some(looseOf)) todoCtx.push(ifc)
  const c = { risk, range, axes, floats, floatBoxes: new Map(), doc: liveDoc, ctx: null, spaceMemo: new Map(), faces: new Map(), optical: null }
  if (risk && risk.optical) c.optical = opticalFonts(todoCtx, c)
  const gaps = []
  /** Text runs whose last character meets the next run's on one live line. */
  const seams = []
  /** Atomic inlines that share a live line with what stands beside them. */
  const holds = new Set()
  const todo = []
  for (const ifc of todoCtx) {
    if (risk && !judge(ifc, c)) continue
    for (const { prev, run, gap, seam } of ifc.links) {
      if (measure(prev, range) && measure(run, range) && sameLine(prev.end, run.start)) {
        prev.after = true
        run.before = true
        for (const g of gap) gaps.push(g)
        if (seam) seams.push(prev)
        if (prev.atom) holds.add(prev)
        if (run.atom) holds.add(run)
      }
    }
    for (const run of ifc.runs) {
      const s = run.node.data
      let a = 0
      while (a < s.length && isSpace(s.charCodeAt(a))) a++
      let b = s.length
      while (b > a && isSpace(s.charCodeAt(b - 1))) b--
      const edges = (run.before && a > 0) || (run.after && b < s.length)
      if (!edges && !looseOf(run)) continue
      if (measure(run, range)) todo.push(run)
    }
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
