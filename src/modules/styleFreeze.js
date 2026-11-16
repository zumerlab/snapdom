/**
 * Rewrites of a style snapshot that make the clone lay out like the page inside the SVG:
 * the scrollbar gutter, a border-box freeze for clipped boxes, the one-line pin, and the
 * height strip for wrappers. Called from getSnapshot and inlineAllStyles (styles.js); each
 * function carries the issue and the measurement it comes from.
 * @module styleFreeze
 */

import { getStyle, isHTMLEl, shadowHost } from '../utils/index.js'

/**
 * #498: on a content-box scroll container `getComputedStyle().width/height` leave out its
 * classic (non-overlay) scrollbars. Frozen bare, the box shrinks by the scrollbar, the content
 * no longer fits, and a vertical scrollbar the live page does not have steals width from the
 * rows. The measured gutters go back in. Border-box values already include them; overlay
 * scrollbars (macOS default) measure 0.
 * Runs once per fresh snapshot (getSnapshot): `snap` is the object the cache keeps.
 * Pinned by __tests__/snapdom.issue498.test.js and __tests__/snapdom.issue508.test.js.
 * @param {Element} source
 * @param {CSSStyleDeclaration} pre
 * @param {Record<string,string>} snap
 * @returns {boolean|undefined} true when a gutter was added
 */
export function addScrollbarGutter(source, pre, snap) {
  const ox = pre.getPropertyValue('overflow-x')
  const oy = pre.getPropertyValue('overflow-y')
  if ((ox === 'visible' || !ox) && (oy === 'visible' || !oy)) return
  if (pre.getPropertyValue('box-sizing') === 'border-box') return
  if (typeof source.clientWidth !== 'number' || !source.offsetWidth) return
  const px = (v) => parseFloat(v) || 0
  const vGutter = source.offsetWidth - source.clientWidth -
    px(pre.getPropertyValue('border-left-width')) - px(pre.getPropertyValue('border-right-width'))
  const hGutter = source.offsetHeight - source.clientHeight -
    px(pre.getPropertyValue('border-top-width')) - px(pre.getPropertyValue('border-bottom-width'))
  const bump = (prop, gutter) => {
    const v = snap[prop]
    if (!v || !v.endsWith('px')) return
    const n = parseFloat(v)
    if (Number.isFinite(n)) snap[prop] = `${Math.round((n + gutter) * 1000) / 1000}px`
  }
  // offset* and client* are integers, each rounded by under a pixel, so with no scrollbar the
  // difference still reaches 1.5: at devicePixelRatio 2.75 (borders 0.727px) a 47.636px row
  // measured 48 - 46 - 1.4545 = 0.545 and every #508 row grew by it. No classic scrollbar is
  // narrower than 2px.
  if (vGutter >= 2) { bump('width', vGutter); bump('inline-size', vGutter) }
  if (hGutter >= 2) { bump('height', hGutter); bump('block-size', hGutter) }
  return vGutter >= 2 || hGutter >= 2
}

export const BORDER_WIDTHS = ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width']
const BOX_SIZES = ['width', 'inline-size', 'height', 'block-size']

/**
 * Freeze the BORDER box of a content-box element whose borders the live page snapped to a
 * fractional CSS width.
 *
 * Browsers snap borders to whole device pixels: at devicePixelRatio 2.625 a `1px` border reads
 * `0.761905px` and `3px` reads `2.666667px` (Chrome and WebKit). The svg image lays out at 1x
 * and snaps them again, to 1px and 2px, so a frozen content-box size moves every outer edge
 * (#508: fifty stacked `border: 1px` rows grew 24px on a phone). Under border-box only the
 * content box absorbs the difference. Integer borders (all of a 1x or 2x page with ordinary
 * CSS) never enter. Chromium and Firefox also
 * lay out at the live devicePixelRatio (`layoutZoom`, engines/svg.js); this pass is what
 * keeps WebKit right.
 *
 * A twin copies a converted snapshot and re-reads its own width/height (LAYOUT_ALWAYS_RE), so
 * it converts once. Min and max sizes are not re-read for twins and change meaning under
 * border-box, so any non-neutral value leaves the element as it was.
 *
 * The content box ends up to a pixel smaller than its live content, so an `auto` scroller
 * shows a bar for that sliver (Chrome painted one under every #508 row). An axis with nothing
 * to scroll live is clipped as `hidden` instead. That depends on content, not identity, so
 * the decision is returned for the twin signature.
 * Pinned by __tests__/snapdom.issue508.test.js.
 * @param {Element} el
 * @param {CSSStyleDeclaration} style - the live computed style
 * @param {Record<string, string>} snap
 * @returns {string} the axes switched from auto to hidden ('x', 'y', 'xy'), or ''
 */
export function freezeBorderBox(el, style, snap) {
  // Runs on every node, so the gate is a string test on the snapshot: a resolved fractional
  // width always carries a '.', an integer one never does.
  if (!BORDER_WIDTHS.some((p) => snap[p]?.includes('.'))) return ''
  // box-sizing and overflow are the two values this writes, so a twin's copy may already
  // hold the converted ones: those come from the live style. Everything else in `snap` is
  // this node's own read (re-read, or identical between twins by construction).
  if (style.getPropertyValue('box-sizing') === 'border-box') return ''
  if (snap.display === 'inline') return ''
  for (const axis of ['width', 'height']) {
    const min = snap[`min-${axis}`]
    const max = snap[`max-${axis}`]
    if ((min && min !== '0px' && min !== 'auto') || (max && max !== 'none')) return ''
  }
  const px = (p) => parseFloat(snap[p]) || 0
  const extraX = px('padding-left') + px('padding-right') + px('border-left-width') + px('border-right-width')
  const extraY = px('padding-top') + px('padding-bottom') + px('border-top-width') + px('border-bottom-width')
  const vertical = (snap['writing-mode'] || 'horizontal-tb') !== 'horizontal-tb'
  for (const prop of BOX_SIZES) {
    const v = snap[prop]
    if (!v || !v.endsWith('px')) continue
    const x = prop === 'width' || (prop === 'inline-size' && !vertical) || (prop === 'block-size' && vertical)
    const extra = x ? extraX : extraY
    snap[prop] = `${Math.round((parseFloat(v) + extra) * 1000) / 1000}px`
  }
  snap['box-sizing'] = 'border-box'
  let clipped = ''
  if (style.getPropertyValue('overflow-x') === 'auto') {
    const idle = el.scrollWidth <= el.clientWidth
    snap['overflow-x'] = idle ? 'hidden' : 'auto'
    if (idle) clipped += 'x'
  }
  if (style.getPropertyValue('overflow-y') === 'auto') {
    const idle = el.scrollHeight <= el.clientHeight
    snap['overflow-y'] = idle ? 'hidden' : 'auto'
    if (idle) clipped += 'y'
  }
  return clipped
}

const INLINE_BORDER_BOX = ['box-sizing', ...BOX_SIZES, 'overflow-x', 'overflow-y']
const INLINE_BORDER_BOX_RE = /(?:box-sizing|width|height|inline-size|block-size|overflow(?:-[xy])?)\s*:/i

/**
 * Carry freezeBorderBox's values onto the clone's inline declarations of the same props.
 * The clone keeps the source's style attribute, and an inline `height:10px` outranks the
 * class: under the class's border-box it shrank each #508 row by its borders instead.
 * @param {Element} source
 * @param {Element} clone
 * @param {Record<string, string>} snap
 */
export function syncInlineBorderBox(source, clone, snap) {
  // One test on the SOURCE's attribute text, which the clone's inline style started as.
  // Seven CSSOM reads per node were 4 ms of a 107 ms capture of 6,000 bordered, inline-styled
  // nodes that declared no size, and the clone's own attribute is worse (8 ms): its style was
  // already written through CSSOM, so every read re-serializes it.
  if (!INLINE_BORDER_BOX_RE.test(source.getAttribute('style'))) return
  for (const p of INLINE_BORDER_BOX) {
    if (clone.style.getPropertyValue(p) && snap[p]) {
      clone.style.setProperty(p, snap[p], clone.style.getPropertyPriority(p))
    }
  }
}

/**
 * A box that paints or clips: a background, a vertical border or padding, or an overflow
 * other than visible.
 * @param {CSSStyleDeclaration} cs
 * @returns {boolean}
 */
function hasBox(cs) {
  if (cs.backgroundImage && cs.backgroundImage !== 'none') return true
  if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') return true
  if ((parseFloat(cs.borderTopWidth) || 0) > 0) return true
  if ((parseFloat(cs.borderBottomWidth) || 0) > 0) return true
  if ((parseFloat(cs.paddingTop) || 0) > 0) return true
  if ((parseFloat(cs.paddingBottom) || 0) > 0) return true
  const ob = cs.overflowBlock || cs.overflowY || 'visible'
  return ob !== 'visible'
}

/** The longhand that stops wrapping without touching white-space collapsing, where supported. */
export const ONE_LINE_PROP = typeof CSS !== 'undefined' && CSS.supports?.('text-wrap-mode', 'nowrap') ? 'text-wrap-mode' : 'white-space'

/**
 * Keep a shrink-to-fit box on one line in the clone when its text is on one line live.
 *
 * #516: the box is frozen at the width of its own text, so a capture that lays the text out a
 * hair wider wraps it (Firefox at devicePixelRatio 2.727, by under 1/60px: "aa bb" broke and
 * every box below slid out of its frozen parent). Do not widen the box instead: across a row
 * in a shrink-to-fit parent that accumulates (#491), and a 1/60px nudge wrapped rows of two.
 * With no soft wrap live, `nowrap` is faithful and the drift can only overflow sub-pixel, the
 * #474 trade. Every element under a pinned box gets its own inline pin, unmeasured: inheriting
 * it is not enough, because the base reset restates `white-space:normal` per tag
 * (ALWAYS_PROPS) and "Home" in a pinned row broke into "Hom / e" (conciv-dev/conciv#764).
 * Pinned by __tests__/snapdom.issue516.test.js and
 * __tests__/regression.oneLinePinDescendants.test.js.
 * @param {Element} source
 * @param {Element} clone
 * @param {Record<string,string>} snap
 * @param {boolean} flexItem
 * @param {object} session - the capture's sessionCache
 */
export function freezeOneLine(source, clone, snap, flexItem, session) {
  const mode = snap['text-wrap-mode'] || snap['white-space'] || ''
  const noWrap = mode === 'nowrap' || mode === 'pre' || (ONE_LINE_PROP === 'white-space' && mode !== 'normal')
  const pinned = session.oneLine ||= new WeakSet()
  // Parents are cloned before their children, so the parent alone says whether the box is
  // under a pin. A box that cannot wrap live carries its own mode in its class rule.
  if (pinned.has(source.parentElement)) {
    pinned.add(source)
    if (!noWrap && clone.style) clone.style.setProperty(ONE_LINE_PROP, 'nowrap')
    return
  }
  const display = snap.display || ''
  if (!flexItem && !display.startsWith('inline-') && (snap.float || 'none') === 'none' &&
    snap.position !== 'absolute' && snap.position !== 'fixed') return
  if (noWrap) return
  if ((snap['writing-mode'] || 'horizontal-tb') !== 'horizontal-tb' || !clone.style) return
  if (!textOnOneLine(source, snap, session)) return
  pinned.add(source)
  clone.style.setProperty(ONE_LINE_PROP, 'nowrap')
}

/**
 * Whether every text run under `el` sits on one line box. False on whatever it cannot vouch
 * for: a <br>, a textarea, a shadow root, more than 64 runs, no text, or a content box taller
 * than two runs, which holds something the runs do not show (a second line of images, an
 * authored height). Under a rotation only a box holding one bare text node can vouch: the
 * node returns one rect per line it spans at any angle (the rotated chip of the site's
 * compare scene wrapped at zero slack).
 * @param {Element} el
 * @param {Record<string,string>} snap
 * @param {object} session - the capture's sessionCache
 * @returns {boolean}
 */
function textOnOneLine(el, snap, session) {
  const content = el.clientHeight - (parseFloat(snap['padding-top']) || 0) - (parseFloat(snap['padding-bottom']) || 0)
  // Three lines' worth of its own font already rules out one line: skips the walk under a
  // branch of a deep tree, which would read 64 runs to learn as much.
  if (content > 3 * (parseFloat(snap['font-size']) || 16)) return false
  // Letters, digits and plain punctuation hold no break opportunity: nothing to pin, nothing
  // to read. Most single-word labels and every number end here.
  if (snap['word-break'] === 'normal' && snap['overflow-wrap'] === 'normal' &&
    /^[\w\u00C0-\u024F.,:;!?'"()%]*$/.test(el.textContent.trim())) return false
  const doc = el.ownerDocument || document
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  const range = doc.createRange()
  let first = null
  let tall = 0
  let runs = 0
  let rects = 0
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 1) {
      if (n.shadowRoot || n.localName === 'br' || n.localName === 'textarea') return false
      continue
    }
    if (!/\S/.test(n.data)) continue
    if (++runs > 64) return false
    range.selectNodeContents(n)
    for (const r of range.getClientRects()) {
      if (!r.height) continue
      rects++
      first ||= r
      // Runs on one line (mixed sizes, sub/sup) overlap by more than half; stacked lines do not.
      if (Math.min(first.bottom, r.bottom) - Math.max(first.top, r.top) < Math.min(first.height, r.height) / 2) return false
      tall = Math.max(tall, r.height)
    }
  }
  if (!first) return false
  const axes = axesOf(el, session.axes ||= new WeakMap())
  if (axes === SKEWED) return runs === 1 && rects === 1 && !el.childElementCount
  // Runs are measured in page pixels, the content box in layout pixels.
  const scale = axes === SCALED && el.offsetHeight ? el.getBoundingClientRect().height / el.offsetHeight : 1
  return content * scale <= 2 * tall
}

/** axesOf results: rotated or skewed somewhere up the chain, untouched, scaled or zoomed. */
const SKEWED = 0
const PLAIN = 1
const SCALED = 2

/**
 * How `el` and its ancestors transform it, memoized per capture since siblings share every
 * ancestor (the uncached walk was 4.2 of 64 ms on the deep-tree scene). Under a rotation, lines
 * stacked in layout can overlap on the page's vertical axis and pass for one.
 * @param {Element} el
 * @param {WeakMap<Element, number>} memo
 * @returns {number} SKEWED, PLAIN or SCALED
 */
function axesOf(el, memo) {
  let v = memo.get(el)
  if (v !== undefined) return v
  const cs = getStyle(el)
  const t = cs.transform
  const m = t && t !== 'none' ? t.slice(t.indexOf('(') + 1, -1).split(',').map(parseFloat) : null
  // matrix(a, b, c, d, e, f) / matrix3d: b and c (m12, m21) are the rotation and skew terms.
  if ((cs.rotate && cs.rotate !== 'none') || (m && (t.startsWith('matrix3d') ? m[1] || m[4] : m[1] || m[2]))) v = SKEWED
  else {
    const parent = el.parentElement || shadowHost(el)
    v = parent ? axesOf(parent, memo) : PLAIN
    if (v === PLAIN && ((cs.scale && cs.scale !== 'none') || (cs.zoom && cs.zoom !== '1') ||
      (m && (t.startsWith('matrix3d') ? m[0] !== 1 || m[5] !== 1 : m[0] !== 1 || m[3] !== 1)))) v = SCALED
  }
  memo.set(el, v)
  return v
}

/**
 * Flex/grid item (reads the parent's display, one getComputedStyle).
 * @param {Element} el
 */
export function isFlexOrGridItem(el) {
  const p = el.parentElement
  if (!p) return false
  // getStyle memoizes in cache.computedStyle; raw getComputedStyle forced a fresh resolution
  // per node on every capture (even on snapshot-cache hits).
  const pd = getStyle(p).display || ''
  return pd.includes('flex') || pd.includes('grid')
}

/**
 * Whether the element has in-flow content of its own: a direct non-empty text node (no
 * layout), an immediate <br>, or an in-flow element child.
 *
 * Neither `textContent` nor scrollHeight can answer it: `textContent` sees text inside
 * absolutely positioned descendants, and scrollHeight is floored at clientHeight. Trusting
 * either let stripHeightForWrappers drop the height of a wrapper whose children are all out of
 * flow; it collapsed to 0 in the foreignObject and every later section shifted up over it.
 * @param {Element} el
 */
function hasFlowFast(el) {
  // Only direct text nodes belong to this element's flow.
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3 && /\S/.test(n.nodeValue)) return true
  }
  const f = el.firstElementChild, l = el.lastElementChild
  if ((f && f.tagName === 'BR') || (l && l.tagName === 'BR')) return true

  // An element child contributes flow content only when it is itself in flow. getStyle
  // memoizes per node, and this runs only after the cheap text/<br> paths miss.
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    const s = getStyle(c)
    if (s.display === 'none') continue
    const pos = s.position
    if (pos !== 'absolute' && pos !== 'fixed') return true
  }
  return false
}

/**
 * Height this block would take with `height: auto`, measured from the live layout, or NaN
 * when nothing in flow could be measured.
 *
 * Called only after every other guard in stripHeightForWrappers passed, so the element is a
 * plain block with no vertical padding/border and `overflow: visible`: its content top is its
 * border top and its children's margins collapse through it. The auto height is the distance
 * from its top edge to the lowest in-flow bottom edge; absolute, fixed and floated children do
 * not count. Direct text nodes are measured with a Range, which leaves the DOM alone.
 *
 * @param {Element} el
 * @returns {number}
 */
function autoContentHeight(el) {
  const top = el.getBoundingClientRect().top
  let bottom = -Infinity
  let range = null
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3) {
      if (!/\S/.test(n.nodeValue || '')) continue
      range = range || document.createRange()
      range.selectNode(n)
      const r = range.getBoundingClientRect()
      if (r.width || r.height) bottom = Math.max(bottom, r.bottom)
      continue
    }
    if (n.nodeType !== 1) continue
    const s = getStyle(n)
    if (s.display === 'none') continue
    const pos = s.position
    if (pos === 'absolute' || pos === 'fixed') continue
    if (s.float && s.float !== 'none') continue
    bottom = Math.max(bottom, n.getBoundingClientRect().bottom)
  }
  return bottom === -Infinity ? NaN : bottom - top
}

const WRAPPER_TAGS = new Set(['div', 'section', 'article', 'main', 'aside', 'header', 'footer', 'nav'])
/**
 * Best-effort: drop height/block-size on transparent flow wrappers so margin collapsing
 * still works, without breaking KaTeX, Orbit, or layouts with an explicit height.
 * Pinned by __tests__/module.styles.stripHeightForWrappers.test.js, stylesheet-height and
 * abspos-wrapper.
 *
 * @param {Element} el
 * @param {CSSStyleDeclaration} cs
 * @param {Record<string, any>} snap
 */
export function stripHeightForWrappers(el, cs, snap) {
  // 1) Only div/section/article/main/aside/header/footer/nav (no ol/ul/li: list layout).
  // Before the inline-height read: the tag test is a string compare, the read two DOM calls.
  // toLowerCase, not localName: an XHTML `<DIV>` keeps its uppercase localName.
  if (!el.tagName || !WRAPPER_TAGS.has(el.tagName.toLowerCase())) return

  // 2) Respect an author inline height
  if (isHTMLEl(el) && el.style && el.style.height) return

  // 2c) aspect-ratio derives the height from the width; keep it
  if (cs.aspectRatio && cs.aspectRatio !== 'none' && cs.aspectRatio !== 'auto') return

  // 3) Orbit: leave the height alone when the element is a flex/grid container
  const disp = cs.display || ''
  if (disp.includes('flex') || disp.includes('grid')) return

  // 4) Positioned, transformed, painted, or a flex/grid item: leave it. No replaced-element
  // guard: the tag allow-list in (1) admits no img/canvas/video/iframe/svg/object/embed.

  const pos = cs.position
  if (pos === 'absolute' || pos === 'fixed' || pos === 'sticky') return
  if (cs.transform !== 'none') return
  if (hasBox(cs)) return
  if (isFlexOrGridItem(el)) return

  // 5) Leave hiding / accessibility wrappers alone (KaTeX, screen-reader hacks, and so on)
  const overflowX = cs.overflowX || cs.overflow || 'visible'
  const overflowY = cs.overflowY || cs.overflow || 'visible'
  if (overflowX !== 'visible' || overflowY !== 'visible') return

  const clip = cs.clip
  if (clip && clip !== 'auto' && clip !== 'rect(auto, auto, auto, auto)') return

  if (cs.visibility === 'hidden' || cs.opacity === '0') return

  // 6) Only wrappers with in-flow content of their own
  if (!hasFlowFast(el)) return

  // 6b) Last filter: drop the height only when it equals what `height: auto` would give.
  // Otherwise the author set it, wherever it came from (stylesheet, <style>, CSSOM, inline),
  // and it stays. Not `el.scrollHeight`: it returns the padding-box height when the content
  // is shorter, so a `height: 400px` around one line of text read as auto, was dropped, and
  // the rest of the canvas came out blank. Last on purpose: hasBox has ruled out vertical
  // padding/border and overflow, which makes autoContentHeight valid, and only the few nodes
  // that clear every guard pay for the measurement.
  const usedH = parseFloat(cs.height)
  const autoH = autoContentHeight(el)
  const TOL = 2
  if (Number.isFinite(usedH) && Number.isFinite(autoH) && Math.abs(usedH - autoH) > TOL) return

  // 7) Now drop height and block-size from the snapshot. Assigned, not deleted: a twin's
  // snapshot inherits from its identity's (getSnapshot), and a delete would uncover that one.
  snap.height = undefined
  snap['block-size'] = undefined
}
