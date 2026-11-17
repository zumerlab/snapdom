/**
 * deepClone: a live subtree to a detached clone, each element's computed style inlined.
 * Owns what cloneNode cannot copy: exclusion and clip culling, iframe, canvas, video, audio
 * and object/embed, form-control state, shadow roots and slots.
 * Contract: every element clone goes into `sessionCache.nodeMap`, clone to source. A
 * replacement outside it is invisible to the pseudo, background and image passes; a culled
 * subtree stays out on purpose.
 * @module clone
 */

import { inlineAllStyles } from '../modules/styles.js'
import { pseudoGatesFor, svgGeometryFor, svgGeometryReaches } from '../modules/authorStyles.js'
import { observeShadowRoot } from './changes.js'
import { SHADOW_SPLIT_RE } from '../modules/styleScan.js'
import { UNSTABLE_INLINE_RE } from '../modules/styleShare.js'
import { NO_CAPTURE_TAGS } from '../utils/css.js'
import { resolveCSSVars, isInSvgTemplate } from '../modules/CSSVar.js'
import { debugWarn, getStyle, isPasswordInput, maskValue, isTag, isSVGEl } from '../utils/index.js'
import {
  rewriteShadowCSS,
  extractShadowCSS,
  injectScopedStyle,
  freezeImgSrcset,
  collectCustomPropsFromCSS,
  buildSeedCustomPropsRule,
  markSlottedSubtree,
  rasterizeIframe,
  getUnscaledDimensions,
  createCheckboxRadioReplacement,
  createRangeReplacement
} from '../utils/clone.helpers.js'
import { isFirefox, isSafari, nextFrame } from '../utils/browser.js'
import { cloneTextWithSelection, inlineTextFieldSelection } from '../modules/selection.js'
import { isInternalNode } from '../utils/ownership.js'
import { sessionWarn } from '../utils/debug.js'

// #535: what an author rule can set on an SVG shape besides paint, per tag. Shapes get no
// style snapshot (NO_DEFAULTS_TAGS keeps LeaderLine's attributes), so deepClone copies these.
const SVG_TRANSFORM_PROPS = ['transform', 'translate', 'rotate', 'scale', 'transform-origin', 'transform-box']
const SVG_GEOMETRY_BY_TAG = {
  circle: ['cx', 'cy', 'r', 'vector-effect'],
  ellipse: ['cx', 'cy', 'rx', 'ry', 'vector-effect'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'vector-effect'],
  path: ['d', 'vector-effect'],
  line: ['vector-effect'],
  polyline: ['vector-effect'],
  polygon: ['vector-effect'],
  use: ['x', 'y', 'width', 'height', 'vector-effect'],
  g: [],
  clipPath: [],
}
// Computed values that mean "nothing set" on an element without the attribute.
const SVG_GEOMETRY_INITIAL = {
  r: '0px', cx: '0px', cy: '0px', x: '0px', y: '0px', rx: 'auto', ry: 'auto', width: 'auto', height: 'auto',
  d: 'none', 'vector-effect': 'none', transform: 'none', translate: 'none', rotate: 'none', scale: 'none',
  'transform-origin': '0px 0px', 'transform-box': 'view-box',
}
const SVG_MOVERS = new Set(['transform', 'translate', 'rotate', 'scale'])
const svgGeometryLists = new WeakMap()
const SVG_GEOMETRY_ALL = new Map()

/** The properties to copy for this SVG element: its tag's list, cut to those some document
 *  rule or animation declares (styleScan's svgGeometry), memoized per scan. null when none
 *  is declared or no declaring rule matches the element (a `button:hover { transform }`
 *  page answers null for every SVG element, one matches() each). */
function svgGeometryList(node) {
  const tag = node.localName
  const own = SVG_GEOMETRY_BY_TAG[tag]
  if (!own) return null
  const gate = svgGeometryFor(node)
  if (gate && (gate.size === 0 || !svgGeometryReaches(node))) return null
  let byTag = gate ? svgGeometryLists.get(gate) : SVG_GEOMETRY_ALL
  if (!byTag) svgGeometryLists.set(gate, (byTag = new Map()))
  let list = byTag.get(tag)
  if (!list) {
    list = [...own, ...SVG_TRANSFORM_PROPS].filter((p) => !gate || gate.has(p))
    byTag.set(tag, list)
  }
  return list.length ? list : null
}

const SVG_NUMBER_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:px)?$/i
/** `5.123456789` and the `5.12346px` it computes to: the same length, up to the engine's
 *  float precision. */
function sameSvgNumber(attr, value) {
  const a = attr.trim()
  if (!SVG_NUMBER_RE.test(a) || !SVG_NUMBER_RE.test(value)) return false
  const x = parseFloat(a), y = parseFloat(value)
  return Math.abs(x - y) <= 1e-4 * Math.max(1, Math.abs(x))
}

/** The matrix of the transform attribute, multiplied out by hand: consolidate() would rewrite
 *  the live attribute. null for an empty list. */
function svgAttrMatrix(node) {
  const list = node.transform?.baseVal
  if (!list?.numberOfItems) return null
  let m = new DOMMatrix()
  for (let i = 0; i < list.numberOfItems; i++) {
    const t = list.getItem(i).matrix
    m = m.multiply(new DOMMatrix([t.a, t.b, t.c, t.d, t.e, t.f]))
  }
  return m
}

/** A transform attribute and the computed transform it produced describe the same matrix. */
function sameSvgTransform(node, value) {
  const m = svgAttrMatrix(node)
  const n = value === 'none' ? [1, 0, 0, 1, 0, 0] : value.startsWith('matrix(') ? value.slice(7, -1).split(',').map(Number) : null
  if (!n || n.length !== 6) return false
  if (!m) return n.join() === '1,0,0,1,0,0'
  const k = [m.a, m.b, m.c, m.d, m.e, m.f]
  for (let i = 0; i < 6; i++) if (Math.abs(k[i] - n[i]) > 1e-4 * Math.max(1, Math.abs(k[i]))) return false
  return true
}

/**
 * Copy the geometry/transform props in `list` that a rule set, meaning the computed value
 * differs from the attribute, or from the initial value when there is none. An
 * attribute-only SVG clones unchanged. Pinned by __tests__/core.clone.svgCssGeometry.test.js.
 */
function copySvgGeometry(node, clone, cs, list) {
  let moved = false
  for (const prop of list) {
    if (!moved && (prop === 'transform-origin' || prop === 'transform-box') && !node.hasAttribute('transform')) continue
    const v = cs.getPropertyValue(prop)
    if (!v) continue // unsupported by this engine (`d` in WebKit)
    if (SVG_MOVERS.has(prop) && v !== 'none') moved = true
    const attr = SVG_MOVERS.has(prop) && prop !== 'transform' ? null : node.getAttribute(prop)
    if (attr != null) {
      if (v === attr || v === attr + 'px') continue
      // An engine serializes the attribute's path data in its own precision (Firefox rounds
      // to single floats), and writing that back moved arcs. A rule overriding a `d` that is
      // already there is the one case this leaves out.
      if (prop === 'd') continue
      // WebKit leaves the attribute out of the computed transform: `none` there is not a
      // rule clearing it, and writing it would.
      if (prop === 'transform' && (v === 'none' || sameSvgTransform(node, v))) continue
      if (sameSvgNumber(attr, v)) continue
    } else if (v === SVG_GEOMETRY_INITIAL[prop]) continue
    clone.style.setProperty(prop, v)
  }
}

/**
 * Build a hidden spacer matching a node's unscaled box, for exclude/filter in 'hide' mode.
 * Reads getBoundingClientRect at most once.
 * @param {Element} node
 * @returns {HTMLDivElement|null}
 */
function makeHideSpacer(node) {
  // A display:none node occupies nothing, so ANY spacer shifts the layout, and an inline-block
  // spacer for a block adds a line box. `exclude` selectors often match hidden elements too.
  const style = getStyle(node)
  const display = style.display
  if (display === 'none') return null
  // Safari at fractional page zoom can report offsetHeight=31 for a 30px box.
  // Used CSS sizes preserve both fractions and pre-transform layout; offsets are only
  // a fallback. Inline text and table/ruby boxes have different sizing rules, so keep
  // their existing measurement rather than interpreting their CSS as ordinary boxes.
  const ordinaryBox = /^(block|inline-block|flow-root|flex|inline-flex|grid|inline-grid|list-item)$/.test(display)
  const px = v => parseFloat(v) || 0
  const borderBoxSize = (value, padding, border, offset, client) => {
    if (!ordinaryBox || !value?.endsWith('px')) return null
    const size = parseFloat(value)
    if (!Number.isFinite(size) || size < 0) return null
    if (style.boxSizing === 'border-box') return size
    // Blink and WebKit resolve a content-box scroller's width WITHOUT its classic scrollbar
    // (WebKit: 185px for `width:200px;overflow:scroll`), Gecko with it. Add the gutter back
    // only where the size fell short of the client box, so no engine counts it twice.
    const gutter = offset - client - border
    return size + padding + border + (gutter > 0 && size + padding < client + gutter / 2 ? gutter : 0)
  }
  // Pinned by `__tests__/api.exclude.unified.test.js`; headless Chromium hides scrollbars.
  const [ow, cw, oh, ch] = /scroll|auto/.test(style.overflow)
    ? [node.offsetWidth, node.clientWidth, node.offsetHeight, node.clientHeight] : [0, 0, 0, 0]
  let w = borderBoxSize(style.width, px(style.paddingLeft) + px(style.paddingRight),
    px(style.borderLeftWidth) + px(style.borderRightWidth), ow, cw)
  let h = borderBoxSize(style.height, px(style.paddingTop) + px(style.paddingBottom),
    px(style.borderTopWidth) + px(style.borderBottomWidth), oh, ch)
  if (w === null || h === null) {
    const { width, height } = getUnscaledDimensions(node)
    let fallbackW = width, fallbackH = height
    if ((w === null && !fallbackW) || (h === null && !fallbackH)) {
      const rect = node.getBoundingClientRect()
      fallbackW ||= rect.width || 0
      fallbackH ||= rect.height || 0
    }
    w ??= fallbackW
    h ??= fallbackH
  }
  const spacer = document.createElement('div')
  spacer.style.cssText = `display:${display === 'inline' ? 'inline-block' : display};box-sizing:border-box;width:${w}px;height:${h}px;visibility:hidden;`
  return spacer
}

/** display:none elements deepClone still clones whole (#507): see the skip in deepClone. */
const HIDDEN_CLONED_TAGS = new Set(['style', 'option', 'optgroup'])

/** Most px a box may sit outside the clip rect and still be kept: the ceiling for what its
 *  shadows, blur and overhanging glyphs can paint back into the window. Within it,
 *  inkReach decides per box (#525). */
const CLIP_CULL_MARGIN = 200

/** Replaced elements are atomic inline boxes, so a fixed-size husk holds their flow slot even
 *  at display:inline, and culling an offscreen <img>/<canvas> skips its fetch or encode. */
const CLIP_REPLACED_TAGS = new Set(['img', 'canvas', 'video', 'iframe', 'object', 'embed'])

/** Sum of every px length in a computed value: an upper bound on how far its shadows reach. */
function pxSum(v) {
  let t = 0
  for (const m of v.matchAll(/-?[\d.]+px/g)) t += Math.abs(parseFloat(m[0]))
  return t
}

/** How far a filter spreads pixels: blur() is a standard deviation, painting out to ~3x. */
function filterReach(cs) {
  const f = cs.filter
  if (!f || f === 'none') return 0
  return f.includes('url(') ? CLIP_CULL_MARGIN : 3 * pxSum(f)
}

/** Filter reach summed over the ancestors up to the clip root, which blur and drop-shadow a
 *  descendant's pixels into the window. Memoized per element for the capture. */
function ancestorFilterReach(el, clip) {
  if (!el) return 0
  const memo = clip.filterReach ||= new WeakMap()
  let r = memo.get(el)
  if (r === undefined) {
    r = filterReach(getStyle(el)) + (el === clip.root ? 0 : ancestorFilterReach(el.parentElement, clip))
    memo.set(el, r)
  }
  return r
}

/** Whether a ::before/::after whose gate the element matches actually generates a box. A
 *  matched gate alone said yes for every element under Tailwind v4's preflight
 *  (`*, ::before, ::after { box-sizing: border-box }`, no `content`), which kept 137 of 161
 *  boxes against 38 with no band at all (#525). */
function generatesPseudo(el, gate, pseudo) {
  try { if (!gate || !el.matches(gate)) return false } catch { return true }
  const c = getStyle(el, pseudo).content
  return !!c && c !== 'none' && c !== 'normal'
}

/**
 * How far the element's painting can reach outside its border box. A generated
 * ::before/::after gets the full CLIP_CULL_MARGIN, since it is not in the rect.
 * @param {Element} el
 * @param {CSSStyleDeclaration} cs
 * @param {{root: Element}} clip
 * @returns {number}
 */
function inkReach(el, cs, clip) {
  const { before, after } = pseudoGatesFor(el)
  if (before === null || after === null ||
      generatesPseudo(el, before, '::before') || generatesPseudo(el, after, '::after')) return CLIP_CULL_MARGIN
  if ((cs.borderImageSource && cs.borderImageSource !== 'none') ||
      (cs.webkitBoxReflect && cs.webkitBoxReflect !== 'none')) return CLIP_CULL_MARGIN
  const em = parseFloat(cs.fontSize) || 16
  const outline = cs.outlineStyle === 'none' ? 0 : pxSum(cs.outlineWidth) + pxSum(cs.outlineOffset)
  const own = Math.max(em * (cs.display === 'list-item' ? 3 : 1), outline,
    pxSum(cs.boxShadow), pxSum(cs.textShadow), filterReach(cs))
  return own + ancestorFilterReach(el.parentElement, clip)
}

/**
 * Whether a box's painting can reach the clip rect: inside it, or within its ink reach and
 * never beyond CLIP_CULL_MARGIN. Only boxes inside that band pay the style read.
 * @param {Element} el
 * @param {CSSStyleDeclaration|null} cs - the element's computed style when already read
 * @param {{left:number,top:number,right:number,bottom:number}} b
 * @param {{rect: {left:number,top:number,right:number,bottom:number}, root: Element}} clip
 * @returns {boolean}
 */
function reachesClip(el, cs, b, clip) {
  const rect = clip.rect
  const gap = Math.max(rect.left - b.right, b.left - rect.right, rect.top - b.bottom, b.top - rect.bottom)
  if (gap <= 0) return true
  if (gap > CLIP_CULL_MARGIN) return false
  // The escape scan revisits a subtree once per ancestor level, so the reach is memoized.
  const memo = clip.inkReach ||= new WeakMap()
  let reach = memo.get(el)
  if (reach === undefined) memo.set(el, reach = inkReach(el, cs || getStyle(el), clip))
  return gap <= reach
}

/**
 * Clip mode: true when the node and its whole subtree paint outside the window. Keeps
 * zero-sized boxes and non-replaced inlines (no fixed-size husk holds their slot), and any
 * box with a descendant that escapes into the window (fixed widgets, negative offsets).
 * @param {Element} node
 * @param {{rect: {left:number,top:number,right:number,bottom:number}, root: Element}} clip
 * @returns {boolean}
 */
function isOutsideClip(node, clip) {
  if (node === clip.root) return false
  const r = node.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return false
  const cs = getStyle(node)
  if (cs.display === 'inline' && !CLIP_REPLACED_TAGS.has((node.localName || '').toLowerCase())) return false
  // Scroll overflow grows right/down in horizontal-ltr; mirror for rtl / vertical modes.
  const sw = node.scrollWidth || 0
  const sh = node.scrollHeight || 0
  const box = {
    left: cs.direction === 'rtl' ? Math.min(r.left, r.right - sw) : r.left,
    top: r.top,
    right: Math.max(r.right, r.left + sw),
    bottom: Math.max(r.bottom, r.top + sh)
  }
  const wm = cs.writingMode || ''
  if (wm.startsWith('vertical') || wm.startsWith('sideways')) {
    box.top = Math.min(r.top, r.bottom - sh)
    box.left = Math.min(box.left, r.right - sw)
  }
  if (reachesClip(node, cs, box, clip)) return false
  // Escape scan: a descendant whose painted box reaches the window (gBCR reads only) vetoes
  // the cull; deeper levels then cull its siblings.
  const tw = (node.ownerDocument || document).createTreeWalker(node, NodeFilter.SHOW_ELEMENT)
  while (tw.nextNode()) {
    const d = /** @type {Element} */ (tw.currentNode)
    const dr = d.getBoundingClientRect()
    if ((dr.width > 0 || dr.height > 0) && reachesClip(d, null, dr, clip)) return false
  }
  return true
}

/** Stand-in for a culled subtree, the shallow clone emptied. finishClipHusks sets its box
 *  once the whole tree is cloned and its culled siblings are known. Deliberately NOT
 *  registered in sessionCache.nodeMap so the pseudo/background walkers skip the pruned
 *  subtree. */
function makeClipHusk(node, clip) {
  const husk = node.cloneNode(false)
  if (node.tagName === 'IMG') {
    husk.removeAttribute('src')
    husk.removeAttribute('srcset')
    husk.removeAttribute('sizes')
  }
  if (!clip.husks) clip.husks = new Map()
  clip.husks.set(husk, node)
  return husk
}

/** Parents whose children stack in one horizontal block flow, where a run of them is a
 *  single span of fixed height. */
const FOLD_PARENT_DISPLAY = /^(block|flow-root|list-item|inline-block)$/
/** Block-level boxes a run may hold. A list-item numbers the markers after it, which
 *  re-render natively in the clone. */
const FOLD_DISPLAY = /^(block|flow-root|flex|grid|table)$/

/** Whether a parent stacks its children in one horizontal, single-column block flow. */
function stacksBlocks(parent) {
  if (!parent) return false
  const ps = getStyle(parent)
  return FOLD_PARENT_DISPLAY.test(ps.display) && ps.writingMode === 'horizontal-tb' &&
    ps.columnCount === 'auto' && ps.columnWidth === 'auto'
}

/** Whether a culled element is an in-flow block whose box tells the layout after it nothing
 *  but its extent. No float or clearance, no counters, not a fieldset's legend or a details'
 *  summary. */
function foldsIntoRun(el) {
  if (el.localName === 'summary' || el.localName === 'legend') return false
  const cs = getStyle(el)
  return FOLD_DISPLAY.test(cs.display) && cs.float === 'none' && cs.clear === 'none' &&
    (cs.position === 'static' || cs.position === 'relative') &&
    cs.counterReset === 'none' && cs.counterIncrement === 'none' && (cs.counterSet || 'none') === 'none'
}

/** Whether getBoundingClientRect reads the element where layout put it. Not display:contents
 *  (no box) or sticky (painted where the scroll left it), no relative offset or transform of
 *  its own, and no ancestor scale (its box agrees with its offset size). */
function rectIsLayout(el, r) {
  const cs = getStyle(el)
  return cs.display !== 'contents' && (cs.position === 'static' || (cs.position === 'relative' && cs.top === '0px')) &&
    (cs.transform === 'none' || cs.transform === 'matrix(1, 0, 0, 1, 0, 0)') &&
    (cs.translate || 'none') === 'none' && (cs.rotate || 'none') === 'none' && (cs.scale || 'none') === 'none' &&
    Math.abs(r.width - el.offsetWidth) < 1 && Math.abs(r.height - el.offsetHeight) < 1
}

/** Whether `b` is the next box after `a` in flow, with only display:none elements between. */
function nextInFlow(a, b) {
  for (let el = a.nextElementSibling; el; el = el.nextElementSibling) {
    if (el === b) return true
    if (getStyle(el).display !== 'none') return false
  }
  return false
}

/** The live collapsed margin to the previous (dir -1) or next (dir 1) in-flow sibling. null
 *  across a line box or when the sibling's rect is not its layout box: a stuck sticky panel
 *  gave a culled toolbar a 463px margin on a page scrolled 549px. */
function siblingGap(el, r, dir) {
  let sib = dir < 0 ? el.previousSibling : el.nextSibling
  for (; sib; sib = dir < 0 ? sib.previousSibling : sib.nextSibling) {
    if (sib.nodeType === 3 && !/^[ \t\n\r\f]*$/.test(sib.data)) return null
    if (sib.nodeType !== 1) continue
    const cs = getStyle(sib)
    if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed' || cs.float !== 'none') continue
    if (cs.display.startsWith('inline')) return null
    break
  }
  if (!sib) return null
  const s = sib.getBoundingClientRect()
  if (!rectIsLayout(sib, s)) return null
  const g = dir < 0 ? r.top - s.bottom : s.top - r.bottom
  return g >= 0 ? g : null
}

/**
 * Fold each run of culled block siblings into one spacer as tall as the live run. The spacer
 * is a plain block whatever rule matches it: an author `overflow:hidden` made it dodge a float
 * and dropped the window one float lower. Shells keep sibling selectors matching.
 * @param {Element} parent - a clone parent of husks
 * @param {Map<Element, Element>} husks - husk to culled source; folded husks are removed
 * @param {boolean} shells - keep the folded husks as display:none shells
 * @param {Map<Element, Element>} standIns - gets first and last member to spacer
 */
function foldClipRuns(parent, husks, shells, standIns) {
  const kids = [...parent.childNodes]
  for (let i = 0; i < kids.length; i++) {
    const head = husks.get(kids[i])
    if (!head || !stacksBlocks(head.parentElement) || !foldsIntoRun(head)) continue
    const members = [kids[i]]
    let end = i
    let last = head
    for (let j = i + 1; j < kids.length; j++) {
      const node = husks.get(kids[j])
      if (node) {
        if (!foldsIntoRun(node) || !nextInFlow(last, node)) break
        members.push(kids[j])
        last = node
        end = j
      } else if (kids[j].nodeType !== 8 && (kids[j].nodeType !== 3 || !/^[ \t\n\r\f]*$/.test(kids[j].data))) break
    }
    if (members.length < 2) continue
    const a = head.getBoundingClientRect()
    const b = last.getBoundingClientRect()
    if (rectIsLayout(head, a) && rectIsLayout(last, b)) {
      // As wide as the widest member's margin box, the horizontal extent their husks kept.
      let width = 0
      for (const h of members) {
        const node = husks.get(h)
        const cs = getStyle(node)
        width = Math.max(width, node.offsetWidth + (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0))
        husks.delete(h)
      }
      standIns.set(head, members[0]).set(last, members[0])
      const height = b.bottom - a.top
      const top = siblingGap(head, a, -1) ?? (parseFloat(getStyle(head).marginTop) || 0)
      const bottom = siblingGap(last, b, 1) ?? (parseFloat(getStyle(last).marginBottom) || 0)
      members[0].style.cssText = 'display:block;position:static;float:none;box-sizing:border-box;padding:0;border:0;' +
        `width:${width}px;min-width:${width}px;max-width:${width}px;` +
        `height:${height}px;min-height:${height}px;max-height:${height}px;` +
        `margin:${top}px 0 ${bottom}px;overflow:visible;contain:none;clear:none;visibility:hidden`
      for (let k = 1; k < members.length; k++) {
        if (shells) members[k].style.cssText = 'display:none!important'
        else members[k].remove()
      }
      for (let k = i + 1; k < end; k++) if (kids[k].nodeType !== 1) kids[k].remove()
    }
    i = end
  }
}

/**
 * Give every husk its layout slot once the tree is cloned. Runs fold into one live-measured
 * spacer (#549: 800 cards in __tests__/clip.benchmark.js, 19.6 to 7.8 ms), which also keeps
 * the fractions offset sizes drop (200 culled 30.4px blocks moved the window 80px).
 * Pinned by __tests__/core.clip.test.js.
 * @param {Element|null} clone - the root clone
 * @param {Object} sessionCache
 * @param {Object} options
 * @returns {Map<Element, Element>|null} culled source to the husk or spacer standing in for it
 */
export function finishClipHusks(clone, sessionCache, options) {
  const husks = sessionCache.clip?.husks
  if (!husks) return null
  const shells = !!clone?.querySelector?.('style')
  const standIns = new Map()
  const parents = new Set()
  for (const husk of husks.keys()) if (husk.parentNode) parents.add(husk.parentNode)
  for (const parent of parents) foldClipRuns(parent, husks, shells, standIns)
  for (const [husk, node] of husks) {
    dressClipHusk(husk, node, sessionCache, options)
    standIns.set(node, husk)
  }
  husks.clear()
  return standIns
}

/** Displays whose box an empty, frozen husk reproduces from its outer display alone. */
const PLAIN_HUSK_DISPLAY = /^(block|flow-root|list-item|flex|grid|inline-block|inline-flex|inline-grid|inline)$/

/**
 * A frozen, hidden box. A plain in-flow box gets only what places it, not its full computed
 * style: a Zumly board window (47 culled tiles) went from 5.9 ms to 3.5 ms, pixel-identical
 * on all three engines. Pinned by __tests__/core.clip.test.js.
 * @param {Element} husk
 * @param {Element} node
 * @param {Object} sessionCache
 * @param {Object} options
 */
function dressClipHusk(husk, node, sessionCache, options) {
  const cs = getStyle(node)
  if (!isSVGEl(node) && node.localName !== 'legend' && PLAIN_HUSK_DISPLAY.test(cs.display) &&
      cs.float === 'none' && cs.clear === 'none' && cs.position !== 'absolute' && cs.position !== 'fixed' &&
      cs.writingMode === 'horizontal-tb' && cs.counterReset === 'none' && cs.counterIncrement === 'none' &&
      (cs.counterSet || 'none') === 'none' && (cs.anchorName || 'none') === 'none' && (cs.zoom || '1') === '1') {
    // A zero side stays zero: auto would let a src-less <img> take its broken-image size.
    let css = `display:${cs.display};width:0;height:0;margin:${cs.marginTop} ${cs.marginRight} ${cs.marginBottom} ${cs.marginLeft};padding:0;border:0;`
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') css += `overflow:${cs.overflowX} ${cs.overflowY};`
    if (cs.contain !== 'none') css += `contain:${cs.contain};`
    if (cs.columnCount !== 'auto' || cs.columnWidth !== 'auto') css += `columns:${cs.columnWidth} ${cs.columnCount};`
    if (cs.verticalAlign !== 'baseline') css += `vertical-align:${cs.verticalAlign};`
    if (cs.order !== '0') css += `order:${cs.order};`
    if (cs.alignSelf !== 'auto') css += `align-self:${cs.alignSelf};`
    if (cs.justifySelf !== 'auto') css += `justify-self:${cs.justifySelf};`
    const area = `${cs.gridRowStart} / ${cs.gridColumnStart} / ${cs.gridRowEnd} / ${cs.gridColumnEnd}`
    if (area !== 'auto / auto / auto / auto') css += `grid-area:${area};`
    husk.style.cssText = css
  } else {
    inlineAllStyles(node, husk, sessionCache, options)
  }
  const { width, height } = getUnscaledDimensions(node)
  if (width > 0) {
    husk.style.width = `${width}px`
    husk.style.minWidth = `${width}px`
    husk.style.maxWidth = `${width}px`
  }
  if (height > 0) {
    husk.style.height = `${height}px`
    husk.style.minHeight = `${height}px`
    husk.style.maxHeight = `${height}px`
  }
  husk.style.visibility = 'hidden'
  // Do NOT add overflow:hidden: a BFC un-collapses margins, and 68 husks moved deep-scroll
  // Wikipedia +812px.
  // An empty husk loses the child margins that collapsed through it (16px per Wikipedia
  // <section>), so block-flow husks take the LIVE gap on both edges.
  const parentDisplay = node.parentElement ? getStyle(node.parentElement).display : ''
  if (!/flex|grid|table/.test(parentDisplay) && !cs.display.startsWith('inline') && cs.float === 'none' &&
      (cs.position === 'static' || cs.position === 'relative')) {
    const r = node.getBoundingClientRect()
    const top = siblingGap(node, r, -1)
    if (top !== null) husk.style.marginTop = `${top}px`
    const bottom = siblingGap(node, r, 1)
    if (bottom !== null) husk.style.marginBottom = `${bottom}px`
  }
  // offset* are border-box; content-box elements with padding/border would inflate
  husk.style.boxSizing = 'border-box'
}

/**
 * Clone one node and its subtree, inlining each element's computed style. Returns null for a
 * dropped node, a spacer or husk for one that keeps only its box, a DocumentFragment for a
 * <slot>. A child whose clone throws is dropped.
 * @param {Node} node
 * @param {object} sessionCache - the per-capture maps, built by prepareClone
 * @param {object} options - the capture context
 * @returns {Promise<Node|null>}
 */
export async function deepClone(node, sessionCache, options) {
  if (!node) throw new Error('[SnapDOM] The element cannot be null or undefined.')
  // fast: false | 'auto' (#503), at entry so paused nodes resume in order. A loop, not an if:
  // concurrent siblings share one wait and resume in one task, so each checks the slice again
  // (3000 sibling spans at 4x CPU: longest task 132 ms to 58). Pinned by core.capture.fast.test.js.
  while (sessionCache.slicer?.due()) await sessionCache.slicer.pause()
  let pendingSelectedOptions = null
  let pendingTextAreaValue = null
  if (node.nodeType === Node.ELEMENT_NODE) {
    const tag = (node.localName || node.tagName || '').toLowerCase()
    const internal = isInternalNode(node)
    // The default-style sandbox is never capture content, even if passed as the root. Its
    // public id/attribute alone prove nothing; only the private registration authorizes this.
    if (internal && (node.id === 'snapdom-sandbox' || node.hasAttribute('data-snapdom-sandbox'))) {
      return null
    }
    // snapdom's own scaffolding below the root: a <body> capture reached toCanvas's decode
    // <iframe> and rasterized it with a nested toPng (+10 ms per warm capture on liquidGL's
    // home). The root is exempt: fromString captures its own marked mount on purpose.
    // Pinned by `__tests__/core.clone.internalNodes.test.js`.
    if (node !== options.element && internal) {
      return null
    }
    if (NO_CAPTURE_TAGS.has(tag)) {
      return null
    }
    // A foreignObject cannot nest in another, and the capture already wraps everything in
    // one, so browsers would skip it silently.
    if (tag === 'foreignobject' && node.parentElement?.closest?.('foreignObject')) {
      debugWarn(sessionCache, 'Skipped a nested <foreignObject>; it can\'t be captured.')
      return null
    }
    // A <picture>'s <source> out-ranks the <img> src and keeps an external URL, which
    // svg-as-image will not load: the picture rasterizes blank. The <img> is already frozen to
    // the live choice (freezeImgSrcset), so drop the sources.
    if (tag === 'source' && node.parentElement?.localName === 'picture') {
      return null
    }
  }
  if (node.nodeType === Node.TEXT_NODE) {
    // Selected text is cloned with its highlight painted in: the selection itself is paint
    // state, not DOM, so a structural clone cannot carry it.
    if (sessionCache.selection) {
      const highlighted = cloneTextWithSelection(node, sessionCache.selection)
      if (highlighted) return highlighted
    }
    return node.cloneNode(true)
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return node.cloneNode(true)
  }
  if (node.getAttribute('data-capture') === 'exclude') {
    if (options.excludeMode === 'hide') {
      return makeHideSpacer(node)
    } else if (options.excludeMode === 'remove') {
      return null
    }
  }
  if (options.exclude && Array.isArray(options.exclude)) {
    for (const selector of options.exclude) {
      try {
        if (node.matches?.(selector)) {
          if (options.excludeMode === 'hide') {
            return makeHideSpacer(node)
          } else if (options.excludeMode === 'remove') {
            return null
          }
        }
      } catch {
        debugWarn(options, `Invalid exclude selector "${selector}"; ignored.`)
      }
    }
  }
  // Exclude predicates ((el) => true excludes), split from selectors once in createContext.
  if (options.excludePredicates) {
    for (const pred of options.excludePredicates) {
      try {
        if (pred(node)) {
          if (options.excludeMode === 'remove') return null
          return makeHideSpacer(node)
        }
      } catch (err) {
        debugWarn(options, 'Your exclude function threw; the element was kept.', err)
      }
    }
  }
  // Preserve v2's independent keep predicate and mode. Exclusions above take precedence,
  // so filter is never asked to override a node already hidden or removed by exclude.
  if (typeof options.filter === 'function') {
    try {
      if (!options.filter(node)) {
        if (options.filterMode === 'hide') return makeHideSpacer(node)
        if (options.filterMode === 'remove') return null
      }
    } catch (err) {
      debugWarn(options, 'Your filter function threw; the element was kept.', err)
    }
  }
  // #507: nothing under display:none paints (800 hidden menu items: 40.4 ms to 5.8 ms). The
  // shell keeps :nth-child matching and its <style> clones. Exempt: <style> (display:none in
  // every UA sheet), <option> (a hidden selected one is its <select>'s label) and SVG (an
  // emptied def breaks svgDefs).
  // Pinned by `__tests__/core.clone.hiddenSubtree.test.js`.
  if (node !== options.element && !HIDDEN_CLONED_TAGS.has(node.localName) && !isSVGEl(node) &&
      getStyle(node).display === 'none') {
    const shell = node.cloneNode(false)
    if (node.tagName === 'IMG') {
      shell.removeAttribute('src')
      shell.removeAttribute('srcset')
    }
    shell.style.setProperty('display', 'none', 'important')
    for (const style of node.querySelectorAll('style')) {
      const kept = await deepClone(style, sessionCache, options)
      if (kept) shell.appendChild(kept)
    }
    return shell
  }
  // Clip mode: prune subtrees painting entirely outside the window, before any plugin hook or
  // tag handler spends work on them.
  if (sessionCache.clip && isOutsideClip(node, sessionCache.clip)) {
    return makeClipHusk(node, sessionCache.clip)
  }
  // Per-node plugin hook: the first plugin whose resolveNode returns a value wins
  // (Node = finished replacement clone, null = skip node, undefined = continue).
  // Hooks are collected once per capture in captureDOM; zero cost when unused.
  if (sessionCache.resolveNodeHooks) {
    for (const hook of sessionCache.resolveNodeHooks) {
      let out
      try { out = await hook(node, options) } catch (e) {
        debugWarn(sessionCache, 'A plugin\'s resolveNode hook threw; ignored it.', e)
      }
      if (out === null) return null
      if (out?.nodeType) {
        if (out.nodeType === Node.ELEMENT_NODE) {
          // Same treatment as built-in tag handlers: map to the source and carry its box
          // styles so the replacement keeps the original layout.
          sessionCache.nodeMap.set(out, node)
          inlineAllStyles(node, /** @type {Element} */ (out), sessionCache, options)
        }
        return out
      }
    }
  }

  // An <iframe> goes to its handler even as a placeholder: its plain clone renders an empty frame.
  const handler = tagHandlers.get(node.tagName)
  if (handler && (node.tagName === 'IFRAME' || node.getAttribute('data-capture') !== 'placeholder')) {
    const handled = await handler(node, sessionCache, options)
    if (handled !== undefined) return handled
  }

  if (node.getAttribute('data-capture') === 'placeholder') {
    const clone2 = node.cloneNode(false)
    sessionCache.nodeMap.set(clone2, node)
    inlineAllStyles(node, clone2, sessionCache, options)
    const placeholder = document.createElement('div')
    placeholder.textContent = node.getAttribute('data-placeholder-text') || ''
    placeholder.style.cssText = 'color:#666;font-size:12px;text-align:center;line-height:1.4;padding:0.5em;box-sizing:border-box;'
    clone2.appendChild(placeholder)
    return clone2
  }

  let clone
  try {
    clone = node.cloneNode(false)
    resolveCSSVars(node, clone)
    sessionCache.nodeMap.set(clone, node)
    if (node.tagName === 'IMG') {
      freezeImgSrcset(node, clone, options)
      // Record the pre-transform size, the fallback when inlining fails. #498: keep it
      // fractional: a `min-width` rounded up (25.6px to 26px) beats the frozen `width` and wraps
      // the last word after the image. The computed style carries the used size at 1/1000px;
      // offset/attribute/natural sizes are only the fallback.
      try {
        const cs = window.getComputedStyle(node)
        let width = parseFloat(cs.width)
        let height = parseFloat(cs.height)
        if (!(width > 0) || !(height > 0)) {
          // getUnscaledDimensions is the BORDER box; width/height and min-* are the CONTENT box
          // unless box-sizing is border-box. Uncorrected, 20px padding and a 5px border scaled
          // the picture inside a box too large (18-34% of pixels off the live element).
          const dims = getUnscaledDimensions(node)
          const px = (p) => parseFloat(cs.getPropertyValue(p)) || 0
          const bb = cs.getPropertyValue('box-sizing') === 'border-box'
          if (!(width > 0)) {
            width = dims.width -
              (bb ? 0 : px('padding-left') + px('padding-right') + px('border-left-width') + px('border-right-width'))
          }
          if (!(height > 0)) {
            height = dims.height -
              (bb ? 0 : px('padding-top') + px('padding-bottom') + px('border-top-width') + px('border-bottom-width'))
          }
        }
        const w = Math.round((width || 0) * 1000) / 1000
        const h = Math.round((height || 0) * 1000) / 1000
        if (w) clone.dataset.snapdomWidth = String(w)
        if (h) clone.dataset.snapdomHeight = String(h)
      } catch (e) {
        debugWarn(sessionCache, 'Couldn\'t measure an image; kept its own size.', e)
      }

      // When the author used % or auto, or the effective width/height resolve to 0,
      // write px inline so the clone does not "lose" the image.
      try {
        const authored = node.getAttribute('style') || ''
        const cs = window.getComputedStyle(node)
        const usesPercentOrAuto = (prop) => {
          const a = authored.match(new RegExp(`${prop}\\s*:\\s*([^;]+)`, 'i'))
          const v = a ? a[1].trim() : cs.getPropertyValue(prop)
          return /%|auto/i.test(String(v || ''))
        }

        const w = parseFloat(clone.dataset.snapdomWidth || '0') || 0
        const h = parseFloat(clone.dataset.snapdomHeight || '0') || 0

        const needFreezeW = usesPercentOrAuto('width') || !(w > 0)
        const needFreezeH = usesPercentOrAuto('height') || !(h > 0)

        if (needFreezeW && w > 0) clone.style.width = `${w}px`
        if (needFreezeH && h > 0) clone.style.height = `${h}px`

        // #337: Preserve object-fit and object-position for correct image proportions
        const objectFit = cs.getPropertyValue('object-fit')
        const objectPosition = cs.getPropertyValue('object-position')
        if (objectFit && objectFit !== 'fill') {
          clone.style.objectFit = objectFit
          if (objectPosition) clone.style.objectPosition = objectPosition
          // When object-fit is active, minWidth/minHeight can distort the image
          // Only set min dimensions if no object-fit override is in play
        } else {
          // Stops a class added later from overriding the fix. Content-box values, as above.
          if (w > 0) clone.style.minWidth = `${w}px`
          if (h > 0) clone.style.minHeight = `${h}px`
        }
      } catch (e) {
        debugWarn(sessionCache, 'Couldn\'t fix the size of an image.', e)
      }

    }
  } catch (err) {
    debugWarn(options, 'Couldn\'t copy this element:', [node, err])
    throw err
  }
  let applyInputVisual = null
  // The raw localName, as isTag compared it: an XHTML element named 'INPUT' is not an input.
  const ln = node.localName
  const isInput = ln === 'input'
  const isTextarea = ln === 'textarea'
  const isField = isInput || isTextarea || ln === 'select'
  if (isTextarea) {
    const { width, height } = getUnscaledDimensions(node)
    const w = width || node.getBoundingClientRect().width || 0
    const h = height || node.getBoundingClientRect().height || 0
    if (w) clone.style.width = `${w}px`
    if (h) clone.style.height = `${h}px`
    // Those are border-box sizes; on a content-box textarea the padding and border were
    // added again and the field wrapped out of a tight row (#528).
    if (w || h) clone.style.boxSizing = 'border-box'
  }
  if (isInput) {
    const type = (node.type || 'text').toLowerCase()
    const isCheckboxOrRadio = type === 'checkbox' || type === 'radio'
    // Firefox paints no native control inside a foreignObject. The replacement is also the only
    // way to show an INDETERMINATE checkbox anywhere: the state is a DOM property XMLSerializer
    // cannot emit, so a native clone paints unchecked (dark pixels on a 30px box, unchecked /
    // indeterminate: chromium 116 / 116, webkit 10 / 10).
    if (isCheckboxOrRadio && (isFirefox() || node.indeterminate)) {
      const { el: replacement, applyVisual } = createCheckboxRadioReplacement(node)
      sessionCache.nodeMap.set(replacement, node)
      applyInputVisual = applyVisual
      clone = replacement
    } else if (type === 'range' && (isFirefox() || isSafari())) {
      // Firefox paints no native slider in a foreignObject, and WebKit paints it without its
      // accent (0 accent-coloured pixels on both), so WebKit joins the fork's Firefox gate.
      const { el: replacement, applyVisual } = createRangeReplacement(node)
      sessionCache.nodeMap.set(replacement, node)
      applyInputVisual = applyVisual
      clone = replacement
    } else if (type === 'color' && isSafari()) {
      /* c8 ignore start -- WebKit only; coverage runs on chromium */
      // WebKit paints a cloned colour well as a text field showing the hex value. The value
      // painted as a swatch is closer to the control than the value spelled out; !important
      // so the styles inlined from the (natively rendered) source cannot put the text back.
      const swatch = /** @type {HTMLInputElement} */ (clone)
      const colorValue = node.value || '#000000'
      applyInputVisual = () => {
        swatch.style.setProperty('background-color', colorValue, 'important')
        swatch.style.setProperty('color', 'transparent', 'important')
        swatch.style.setProperty('-webkit-text-fill-color', 'transparent', 'important')
        swatch.style.setProperty('appearance', 'none', 'important')
        swatch.style.setProperty('-webkit-appearance', 'none', 'important')
      }
      swatch.removeAttribute('value')
      /* c8 ignore stop */
    } else if (
      (type === 'date' || type === 'time' || type === 'datetime-local') &&
      (isFirefox() || isSafari())
    ) {
      /* c8 ignore start -- Firefox and WebKit only; coverage runs on chromium */
      // The formatted text of these controls lives in UA shadow content that neither engine
      // paints inside a foreignObject: WebKit shows the raw machine value, Firefox nothing at
      // all. A text clone carrying the locale-formatted value reads like the control instead.
      clone.setAttribute('type', 'text')
      let shown = node.value
      if (type === 'date' && node.valueAsDate) {
        shown = node.valueAsDate.toLocaleDateString(undefined, { timeZone: 'UTC' })
      }
      clone.value = shown
      clone.setAttribute('value', shown)
      /* c8 ignore stop */
    } else {
      // Password only, because the mask is fidelity-NEUTRAL (see isPasswordInput). Plain-text
      // values are captured as-is; redacting them is the `redactInputs` plugin's job.
      const safeValue = isPasswordInput(node) ? maskValue(node.value) : node.value
      clone.value = safeValue
      clone.setAttribute('value', safeValue)
      if (node.checked !== void 0) {
        clone.checked = node.checked
        if (node.checked) clone.setAttribute('checked', '')
        // cloneNode carries the DEFAULT attribute even after the user unchecks the input.
        // The property alone is lost in XML, so mirror both directions before serialization.
        else clone.removeAttribute('checked')
        if (node.indeterminate) clone.indeterminate = node.indeterminate
      }
    }
  }

  // #315: keep the ::placeholder colour. #512: a <style> child of the void <input> left
  // Safari's SVG unclosed, so colour and opacity ride as custom properties that
  // PLACEHOLDER_RULE (prepare.js) paints. On pseudoCSS the rule would bail the diff path on
  // every recapture (diffCapture, diff.js).
  if ((isInput || isTextarea) && !node.value && node.placeholder) {
    try {
      const phStyle = window.getComputedStyle(node, '::placeholder')
      const phColor = phStyle && phStyle.color
      if (phColor && phColor !== 'rgba(0, 0, 0, 0)') {
        sessionCache.usesPlaceholder = true
        clone.setAttribute('data-sd-ph', '')
        clone.style.setProperty('--sd-ph', phColor)
        clone.style.setProperty('--sd-ph-o', phStyle.opacity || '1')
      }
    } catch { /* non-blocking */ }
  }

  if (ln === 'select') {
    // Values need not be unique, and excluded options change positional indices. Retain
    // source identity so the selected labels survive both cases and multiple selections.
    pendingSelectedOptions = new Set(Array.from(node.options).filter(option => option.selected))
  }
  if (isTextarea) {
    pendingTextAreaValue = node.value
  }
  // Copy form validation/state attributes so :disabled, :required, :read-only,
  // :invalid, :in-range/:out-of-range pseudo-class styles render correctly in the capture.
  if (isField) {
    if (node.disabled) clone.setAttribute('disabled', '')
    if (node.required) clone.setAttribute('required', '')
    if ((/** @type {HTMLInputElement|HTMLTextAreaElement} */ (node)).readOnly) clone.setAttribute('readonly', '')
    const inputNode = /** @type {HTMLInputElement} */ (node)
    if (inputNode.min !== undefined && inputNode.min !== '') clone.setAttribute('min', inputNode.min)
    if (inputNode.max !== undefined && inputNode.max !== '') clone.setAttribute('max', inputNode.max)
    if (inputNode.pattern !== undefined && inputNode.pattern !== '') clone.setAttribute('pattern', inputNode.pattern)
    // Reflect aria-invalid to surface :invalid visual state in the snapshot
    const ariaInvalid = node.getAttribute('aria-invalid')
    if (ariaInvalid !== null) clone.setAttribute('aria-invalid', ariaInvalid)
  }
  // #408: descendants of <symbol>/<defs>/etc. are templates rendered via <use>/url(#…).
  // Snapshotting their computed style here would freeze var() to the (dead) fallback.
  if (!isInSvgTemplate(node)) {
    inlineAllStyles(node, clone, sessionCache, options)
  }
  if (applyInputVisual) { applyInputVisual() }
  // A text field's selection lives on selectionStart/End rather than in a document Range, and
  // the field renders its own value, so the highlight is painted as background layers on the
  // clone instead of wrapped in a span.
  if (
    options.captureSelection &&
    (isInput || isTextarea)
  ) {
    try {
      inlineTextFieldSelection(node, clone)
    } catch (e) {
      debugWarn(sessionCache, 'Couldn\'t copy the selection of a text field.', e)
    }
  }
  // #365: SVG shapes get no class snapshot (NO_DEFAULTS_TAGS returns '' key), so the paint
  // properties a rule sets are copied inline. #408: not inside <use> templates (<symbol>,
  // shapes in <defs>), whose var() must resolve at the <use> site.
  if (isSVGEl(node) && !isInSvgTemplate(node)) {
    const SVG_PAINT_PROPS = [
      'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset',
      'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'opacity',
      'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule',
      'marker', 'marker-start', 'marker-mid', 'marker-end', 'visibility', 'display',
      // fill/stroke: currentColor resolves against inherited color, which SVG children
      // without a style snapshot would otherwise lose (was resolveCSSVars' part 3).
      'color'
    ]
    try {
      const cs = window.getComputedStyle(node)
      for (const prop of SVG_PAINT_PROPS) {
        const val = cs.getPropertyValue(prop)
        if (val) clone.style.setProperty(prop, val)
      }
      // #515: a stop's color set by a stylesheet rule reaches the clone only here.
      if (node.localName === 'stop') {
        clone.style.setProperty('stop-color', cs.getPropertyValue('stop-color'))
        clone.style.setProperty('stop-opacity', cs.getPropertyValue('stop-opacity'))
      }
      // #535: geometry, transforms and vector-effect from a rule, the same way.
      const geometry = svgGeometryList(node)
      if (geometry) copySvgGeometry(node, clone, cs, geometry)
    } catch { }
  }
  const shadow = node.shadowRoot
  let assignedToSlot = null
  if (shadow) {
    assignedToSlot = new Set()
    // Wire this root into the style-snapshot invalidation. Nothing else can see inside it:
    // the document observer stops at the boundary, so without this a component that
    // re-renders between captures keeps serving its previous frame's snapshots.
    observeShadowRoot(shadow)
    for (const s of shadow.querySelectorAll('slot')) {
      // Must NOT flatten: this set is checked against the host's *direct* childNodes.
      // flatten:true resolves nested slots away, so when a light-DOM child is itself a
      // <slot> (a component inside a component) it never lands here and gets cloned twice.
      for (const an of s.assignedNodes?.() || []) assignedToSlot.add(an)
    }
    const scopes = sessionCache.shadowScopes ||= new WeakMap()
    // #558: roots with the same sheet share one rewritten copy, a group token in `data-sd`
    // (sixteen components on a 5,000-rule sheet: 116 ms to 9). Only hosts at the same depth
    // share, so prepare.js's shallow-first order holds and group members never nest.
    // Pinned by __tests__/core.clone.issue558.test.js.
    let depth = 0
    for (let p = node; (p = p.assignedSlot || p.parentNode || (p.nodeType === 11 ? p.host : null));) {
      if (p.shadowRoot && scopes.has(p.shadowRoot)) depth++
    }
    const ownId = `s${sessionCache.shadowScopeSeq = (sessionCache.shadowScopeSeq || 0) + 1}`
    const rawCSS = extractShadowCSS(shadow, sessionCache.shadowSheets ||= new WeakMap())
    const groups = (sessionCache.shadowGroups ||= [])[depth] ||= new Map()
    let group = rawCSS && groups.get(rawCSS)
    let rewritten = ''
    if (!group) {
      group = { id: ownId, vars: collectCustomPropsFromCSS(rawCSS), share: !SHADOW_SPLIT_RE.test(rawCSS), unstable: UNSTABLE_INLINE_RE.test(rawCSS) }
      if (rawCSS) groups.set(rawCSS, group)
      // The pseudo gates read only the DOCUMENT's sheets, so a page whose only ::after lives
      // in a shadow root skipped the pass.
      if (!sessionCache.shadowPseudo && /::?(?:before|after|first-l|marker)|counter/.test(rawCSS)) sessionCache.shadowPseudo = true
      rewritten = rewriteShadowCSS(rawCSS, `[data-sd~="${ownId}"]`, ownId)
    }
    const hostId = group.id === ownId ? ownId : `${ownId} ${group.id}`
    scopes.set(shadow, group.id)
    // Roots of one group hold the same rules, so their content can share reads (styleShare.js),
    // re-reading margins and paddings when the text gives one a value that follows the box.
    if (group.share) (sessionCache.shadowShare ||= new WeakMap()).set(shadow, group.unstable)
    clone.setAttribute('data-sd', hostId)
    const seed = buildSeedCustomPropsRule(node, group.vars, `[data-sd="${hostId}"]`)
    injectScopedStyle(clone, seed + rewritten, depth)
    // Children clone concurrently (sibling iframe/canvas work overlaps); a failed child
    // resolves to null and is dropped. A leaf is cloned in place, as in the light-DOM loop below.
    const list = []
    let pending = false
    for (const child of Array.from(shadow.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE && child.tagName === 'STYLE') continue
      if (child.nodeType !== Node.ELEMENT_NODE && (child.nodeType !== Node.TEXT_NODE || !sessionCache.selection)) {
        list.push(child.cloneNode(true))
        continue
      }
      list.push(deepClone(child, sessionCache, options).catch(() => null))
      pending = true
    }
    for (const c of pending ? await Promise.all(list) : list) if (c) clone.appendChild(c)
  }
  if (node.tagName === 'SLOT') {
    const scopeId = sessionCache.shadowScopes?.get(node.getRootNode())
    const directAssigned = node.assignedNodes?.() || []
    const assigned = directAssigned.length ? node.assignedNodes?.({ flatten: true }) || directAssigned : []
    const nodesToClone = assigned.length ? assigned : Array.from(node.childNodes)
    const fragment = document.createDocumentFragment()
    const cloneList = await Promise.all(nodesToClone.map((child) =>
      deepClone(child, sessionCache, options).then((clonedChild) => {
        // Only real assignments carry a scope token; a slot's own fallback content belongs to
        // the shadow tree itself and must keep matching that tree's rules.
        if (clonedChild && directAssigned.length) markSlottedSubtree(clonedChild, scopeId)
        return clonedChild || null
      }).catch(() => null)
    ))
    fragment.append(...cloneList.filter(clonedChild => !!clonedChild))
    return fragment
  }

  // A shadow host's light DOM paints only through slots: a child no slot accepted would show
  // content the page never shows. The array snapshot stays: a resolveNode hook may mutate the
  // source.
  const list = []
  let pending = false
  for (const child of Array.from(node.childNodes)) {
    if (shadow && (assignedToSlot.has(child) || !child.assignedSlot)) continue
    if (child.nodeType !== Node.ELEMENT_NODE && (child.nodeType !== Node.TEXT_NODE || !sessionCache.selection)) {
      list.push(child.cloneNode(true))
      continue
    }
    list.push(deepClone(child, sessionCache, options).catch(() => null))
    pending = true
  }
  for (const c of pending ? await Promise.all(list) : list) if (c) clone.appendChild(c)

  // Adjust select value after children are cloned
  if (pendingSelectedOptions && isTag(clone, 'select')) {
    let hasSelectedOption = false
    for (const opt of clone.options) {
      const selected = pendingSelectedOptions.has(sessionCache.nodeMap.get(opt))
      opt.selected = selected
      if (selected) opt.setAttribute('selected', '')
      else opt.removeAttribute('selected')
      hasSelectedOption ||= selected
    }
    if (!hasSelectedOption && !clone.multiple) {
      // selectedIndex=-1 is a property with no HTML attribute. Without a selected
      // placeholder, parsing the SVG chooses the first real option and paints its label.
      const empty = clone.ownerDocument.createElement('option')
      empty.hidden = true
      empty.style.setProperty('display', 'none', 'important')
      empty.setAttribute('selected', '')
      empty.value = ''
      clone.appendChild(empty)
    }
  }
  // Must stay AFTER the children append: a textarea's child nodes ARE its default value, and
  // assigning here replaces them with the live value. Moved up beside the other textarea code,
  // it shows the content twice (core.clone.textarea.test.js: "expected 2 to be 1").
  // Test against null: '' is a real value, and `if (value)` leaks the default back.
  if (pendingTextAreaValue !== null && isTag(clone, 'textarea')) {
    clone.textContent = pendingTextAreaValue
  }
  return clone
}

/* Built-in tag handlers */

/** A same-origin iframe is rasterized to an <img>. A cross-origin one keeps its box as a
 *  striped placeholder, or an invisible spacer with `placeholders: false`. */
async function cloneIframe(node, sessionCache, options) {
  let sameOrigin = false
  try { sameOrigin = !!(node.contentDocument || node.contentWindow?.document) } catch (e) {
    debugWarn(sessionCache, 'Couldn\'t tell if an iframe is same-origin; treated it as cross-origin.', e)
  }

  if (sameOrigin) {
    try {
      return await rasterizeIframe(node, sessionCache, options)
    } catch (err) {
      sessionWarn(sessionCache, 'iframe-failed', 'same-origin iframe failed to rasterize', err)
      debugWarn(options, 'Couldn\'t capture an iframe, so it was left out.', err)
      // fall through
    }
  }

  // Warn that this iframe was skipped so callers can react. `placeholders` is on by default,
  // so what lands in the capture is the striped placeholder below; only mention the opt-out,
  // never suggest enabling an option that is already on.
  if (!sameOrigin) {
    sessionWarn(sessionCache, 'iframe-cross-origin', `cross-origin iframe replaced by ${options.placeholders ? 'a placeholder' : 'a spacer'}`, node)
    debugWarn(options, options.placeholders
      ? 'Can\'t capture a cross-origin iframe; showing a placeholder. Set placeholders: false to hide it.'
      : 'Can\'t capture a cross-origin iframe; left it out.', node)
  }

  // Placeholder or spacer, both sized to the frame's box.
  const { width, height } = getUnscaledDimensions(node)
  const box = document.createElement('div')
  box.style.cssText = options.placeholders
    ? `width:${width}px;height:${height}px;` +
      'background-image:repeating-linear-gradient(45deg,#ddd,#ddd 5px,#f9f9f9 5px,#f9f9f9 10px);' +
      'display:flex;align-items:center;justify-content:center;font-size:12px;color:#555;border:1px solid #aaa;'
    : `display:inline-block;width:${width}px;height:${height}px;visibility:hidden;`
  inlineAllStyles(node, box, sessionCache, options)
  return box
}

/**
 * Whether nothing has been drawn into this canvas yet (fully transparent). Sampled through a
 * small scratch canvas, O(1) at any size. drawImage FROM the source binds no context to it,
 * which is what lets cloneCanvas decide whether probing the source is safe.
 * @param {HTMLCanvasElement} node
 * @returns {boolean}
 */
export function isBlankCanvas(node) {
  try {
    const w = Math.max(1, Math.min(32, node.width))
    const h = Math.max(1, Math.min(32, node.height))
    const scratch = document.createElement('canvas')
    scratch.width = w
    scratch.height = h
    const sctx = scratch.getContext('2d', { willReadFrequently: true })
    if (!sctx) return false
    sctx.drawImage(node, 0, 0, w, h)
    const data = sctx.getImageData(0, 0, w, h).data
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return false
    return true
  } catch {
    return false
  }
}

/** JPEG quality for an opaque video frame: on a 1280x720 VP9 frame, mean error 1.6 levels
 *  against PNG, where the codec had already moved it 21. */
const FRAME_QUALITY = 0.95

/**
 * Whether every pixel of a drawn frame is opaque. A downscaled probe can lose a small
 * transparent island, so the scan is exact: 0.9-1 ms at 1280x720 on all three engines, paid
 * only when freezing a video frame, so lossy JPEG never erases real alpha.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @returns {boolean}
 */
function frameIsOpaque(ctx, width, height) {
  try {
    const data = ctx.getImageData(0, 0, width, height).data
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return false
    return true
  } catch {
    return false
  }
}

/**
 * Whether a canvas that reads as drawn holds a WebGL buffer cleared after every composite.
 * Asked only of a canvas with content, which has a context, so getContext creates nothing.
 * Pinned by __tests__/core.clone.webglOpaque.test.js.
 */
function clearsEachFrame(node) {
  try {
    const gl = node.getContext('webgl2') || node.getContext('webgl')
    return !!gl && !gl.getContextAttributes()?.preserveDrawingBuffer
  } catch {
    return false
  }
}

/** <canvas> to <img>. The read order is the point: pixels before any context, so an
 *  uninitialized canvas keeps its mode, and a WebGL frame inside the frame that drew it (#480). */
async function cloneCanvas(node, sessionCache, options) {
  // Safari-safe snapshot: poke + rAF + retry + scratch fallback
  let url = ''
  try {
    // Read the canvas BEFORE asking for a context: getContext('2d') on an uninitialized canvas
    // CREATES one and fixes its mode, so the page's later getContext('webgl') returns null.
    // isBlankCanvas reads through a scratch canvas, which binds nothing. A canvas with content
    // already has a context, so getContext is then safe: the 2d one, or null for WebGL/WebGPU.
    let blank = isBlankCanvas(node)
    if (blank) {
      // A WebGL/WebGPU canvas with preserveDrawingBuffer:false is cleared once the frame
      // composites, so a read from a click handler is transparent; rAF resumes inside the
      // frame, after the app renders, with the buffer intact (#480). A canvas nobody drew into
      // stays blank and never gets the poke that would lock it.
      await nextFrame()
      blank = isBlankCanvas(node)
    } else if (clearsEachFrame(node)) {
      // The same frame, for an opaque one: a WebGL canvas made with alpha:false clears to
      // opaque black, not to transparent, so it read as drawn and the capture took the black
      // (d-plugin-webgl-live-dom's WebGL panel, Chromium and Firefox).
      await nextFrame()
    }
    // WebKit needs a frame for the 2D poke to materialize the backing store. Elsewhere
    // toDataURL is synchronous, and a frame (>=16ms) per canvas would cost N frames for N charts.
    let ctx = null
    if (!blank) {
      ctx = node.getContext('2d', { willReadFrequently: true })
      try { ctx && ctx.getImageData(0, 0, 1, 1) } catch { }
      if (isSafari()) await nextFrame()
    }

    url = node.toDataURL('image/png')

    if (!url || url === 'data:,') {
      // quick retry
      try { ctx && ctx.getImageData(0, 0, 1, 1) } catch { }
      await nextFrame()
      url = node.toDataURL('image/png')

      // last resort: copy into a scratch canvas and read from there
      if (!url || url === 'data:,') {
        const scratch = document.createElement('canvas')
        scratch.width = node.width
        scratch.height = node.height
        const sctx = scratch.getContext('2d')
        if (sctx) {
          sctx.drawImage(node, 0, 0)
          url = scratch.toDataURL('image/png')
        }
      }
    }
  } catch (e) {
    // A canvas that drew a non-CORS image (an OpenLayers map's tiles) is tainted and renders
    // blank. Warn: a throw failed the whole capture in 1.9.8, and quiet it reads as our bug.
    sessionWarn(sessionCache, 'canvas-tainted', 'a canvas tainted by cross-origin images cannot be read; it renders blank', node)
    debugWarn(sessionCache, 'Couldn\'t read the pixels of a canvas; used its fallback content.', e)
  }

  // #486: a capture before the canvas's first draw serializes a valid, empty PNG and seems to
  // fail silently. Say so under debug.
  if (options && options.debug && url && isBlankCanvas(node)) {
    debugWarn(sessionCache, 'Empty canvas; capture after its first frame', node)
  }

  const img = document.createElement('img')
  img.decoding = 'sync'
  img.loading = 'eager'
  if (url) img.src = url

  // keep the bitmap's intrinsic dimensions
  img.width = node.width
  img.height = node.height

  // Keep the CSS box, from pre-transform dimensions. They are border-box sizes: on a
  // content-box canvas the border and padding were added again, as on a textarea (#528).
  const { width, height } = getUnscaledDimensions(node)
  if (width > 0) img.style.width = `${width}px`
  if (height > 0) img.style.height = `${height}px`
  img.style.boxSizing = 'border-box'
  // compress sizes the bitmap from these: the content box it is drawn into. From the border
  // box it was downsampled to one size and scaled to another, and every edge moved.
  const cs = getStyle(node)
  const px = (v) => parseFloat(v) || 0
  img.dataset.snapdomWidth = String(width - px(cs.paddingLeft) - px(cs.paddingRight) - px(cs.borderLeftWidth) - px(cs.borderRightWidth))
  img.dataset.snapdomHeight = String(height - px(cs.paddingTop) - px(cs.paddingBottom) - px(cs.borderTopWidth) - px(cs.borderBottomWidth))

  sessionCache.nodeMap.set(img, node)
  inlineAllStyles(node, img, sessionCache, options)
  return img
}

/** <video> to <img>: the current frame drawn through a canvas, or the poster while the
 *  element is still showing it. */
async function cloneVideo(node, sessionCache, options) {
  let url = ''
  // The screen shows the poster until first playback or a seek (the "show poster flag"),
  // whatever is decoded: drawImage would paint frame 0 on Chromium/Firefox and nothing on
  // WebKit, over the poster. Read the flag from what it leaves behind.
  const showPoster = node.poster && node.paused && !node.currentTime && !node.played.length
  const img = document.createElement('img')
  try { img.decoding = 'sync'; img.loading = 'eager' } catch {}
  if (!showPoster) {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = node.videoWidth || node.offsetWidth || 320
      canvas.height = node.videoHeight || node.offsetHeight || 240
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(node, 0, 0, canvas.width, canvas.height)
        // An opaque frame goes out as JPEG (1280x720 VP9 frame: 153 KB against 709 KB).
        // Pinned by __tests__/core.clone.videoFrame.test.js.
        // Synchronous, not in the compress pool or toBlob: on a page with its own render loop
        // each reply waits a frame (liquidGL's home: 48 ms idle per capture).
        url = canvas.toDataURL(frameIsOpaque(ctx, canvas.width, canvas.height) ? 'image/jpeg' : 'image/png', FRAME_QUALITY)
        if (!url || url === 'data:,') url = '' // 'data:,' is a 0x0 canvas
      }
    } catch (e) {
      debugWarn(sessionCache, 'Couldn\'t capture a video frame; used its poster.', e)
    }
  }

  if (url) {
    img.src = url
  } else if (node.poster) {
    img.src = node.poster
  }

  img.width = node.videoWidth || node.offsetWidth || 0
  img.height = node.videoHeight || node.offsetHeight || 0

  const { width, height } = getUnscaledDimensions(node)
  if (width > 0) img.style.width = `${width}px`
  if (height > 0) img.style.height = `${height}px`
  img.style.boxSizing = 'border-box'
  img.style.objectFit = 'contain'

  sessionCache.nodeMap.set(img, node)
  inlineAllStyles(node, img, sessionCache, options)
  return img
}

async function cloneAudio(node, sessionCache, options) {
  // The native <audio controls> UI cannot be serialized and clones blank, so draw a player
  // sized to the element (#444). Without `controls` it is display:none: generic clone.
  if (!node.controls) return undefined
  const { width, height } = getUnscaledDimensions(node)
  const w = Math.round(width || node.offsetWidth || 300)
  const h = Math.round(height || node.offsetHeight || 54)
  const cy = h / 2
  const tri = Math.max(4, h * 0.16)
  const px = h * 0.34
  const rTime = w - h * 0.34
  const trackX = px + tri + h * 0.55
  const trackW = Math.max(0, rTime - h * 0.7 - trackX)
  const fs = Math.max(9, Math.round(h * 0.24))
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" rx="${Math.min(h / 2, 10)}" fill="#f1f3f4"/>` +
    `<path d="M ${px} ${cy - tri} L ${px + tri} ${cy} L ${px} ${cy + tri} Z" fill="#5f6368"/>` +
    `<rect x="${trackX}" y="${cy - 1.5}" width="${trackW}" height="3" rx="1.5" fill="#bdc1c6"/>` +
    `<circle cx="${trackX}" cy="${cy}" r="${Math.max(3, h * 0.09)}" fill="#5f6368"/>` +
    `<text x="${rTime}" y="${cy}" fill="#5f6368" font-family="sans-serif" font-size="${fs}" text-anchor="end" dominant-baseline="central">0:00</text>` +
    '</svg>'
  const img = document.createElement('img')
  try { img.decoding = 'sync'; img.loading = 'eager' } catch {}
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  img.width = w
  img.height = h
  img.style.width = `${w}px`
  img.style.height = `${h}px`
  sessionCache.nodeMap.set(img, node)
  inlineAllStyles(node, img, sessionCache, options)
  return img
}

/** <object>/<embed>: svg-as-image blocks their external data/src, so they render blank or
 *  paint their FALLBACK children. An image type becomes an <img> for inlineImages; a
 *  same-origin document goes through the iframe rasterizer; the rest take the generic clone,
 *  where the fallback children are the honest output. */
async function cloneObjectEmbed(node, sessionCache, options) {
  const url = node.getAttribute('data') || node.getAttribute('src') || ''
  const type = (node.getAttribute('type') || '').toLowerCase()
  const looksImage = /^image\//.test(type) || /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)(\?|#|$)/i.test(url)
  if (url && looksImage) {
    const img = document.createElement('img')
    try { img.decoding = 'sync'; img.loading = 'eager' } catch { }
    img.src = url
    const { width, height } = getUnscaledDimensions(node)
    if (width > 0) img.style.width = `${width}px`
    if (height > 0) img.style.height = `${height}px`
    img.style.boxSizing = 'border-box'
    sessionCache.nodeMap.set(img, node)
    inlineAllStyles(node, img, sessionCache, options)
    return img // fallback children dropped on purpose, or both would paint
  }
  // A same-origin embedded document (a text/html object) rasterizes like an iframe.
  let doc = null
  try { doc = node.contentDocument } catch { /* cross-origin */ }
  if (doc) {
    try {
      const out = await rasterizeIframe(node, sessionCache, options)
      if (out) return out
    } catch { /* fall through */ }
  }
  if (url) {
    sessionWarn(sessionCache, 'embed-fallback', `<${node.localName}> not capturable, using its fallback content: ${url}`)
    debugWarn(options, `Couldn't capture <${node.localName}>${type ? ` (${type})` : ''}; showing its fallback content.`)
  }
  return undefined // generic clone: fallback children render, matching the no-plugin browser behavior
}

/** Clone strategies for tags whose content cannot be cloned structurally. A handler returns
 *  the finished clone, null to skip the node, or undefined for the generic clone path.
 *  @type {Map<string, (node: Element, sessionCache: object, options: object) => Promise<Node|null|undefined>>} */
const tagHandlers = new Map([['IFRAME', cloneIframe], ['CANVAS', cloneCanvas], ['VIDEO', cloneVideo],
  ['AUDIO', cloneAudio], ['OBJECT', cloneObjectEmbed], ['EMBED', cloneObjectEmbed]])
