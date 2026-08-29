/**
 * Renders the user's text selection into the clone (SEL-1, fork addition).
 *
 * A selection is paint without DOM: the browser draws the highlight and
 * restyles the selected glyphs at paint time, from state a structural clone
 * cannot carry, so a capture of selected text came out unselected. This module
 * reads the live Selection once per capture, and the clone pass wraps each
 * selected run of text in a <span> carrying the styles the browser painted it
 * with — the authored `::selection` styles where a rule matches, the UA's
 * highlight color where none does.
 *
 * A selection inside <input>/<textarea> is different again: it lives on the
 * field's selectionStart/End rather than in a Range, and the field renders its
 * own value, so there is no text node to wrap. That highlight is painted as
 * background layers on the field's clone instead — a background paints behind
 * the value, which is where the browser draws it — with the selected run's
 * rectangles measured from a hidden twin that lays the value out in the
 * field's own text styles (see inlineTextFieldSelection).
 *
 * Limitations, all inherent to what a page can observe: selections inside
 * shadow roots are not exposed on the document's Selection; an authored
 * `::selection { background: transparent }` is indistinguishable from no rule
 * at all, so it paints the UA highlight; a field's `::selection` color cannot
 * recolor part of a value the field paints itself, so only the highlight
 * behind it is rendered; and the selection API only exists on
 * text/search/url/tel/password inputs — an email or number input paints a
 * highlight the platform refuses to report (selectionStart is null even
 * mid-selection), so nothing can be rendered for it.
 *
 * Imported from @frostin/snapdom (element-mirror), where it was written as SEL-1.
 * @module selection
 */

const TRANSPARENT = new Set(['rgba(0, 0, 0, 0)', 'transparent'])

/**
 * What the UA paints behind selected text when no ::selection rule matches.
 * The clone is rasterized by the same browser, which resolves the system
 * color natively, so this tracks the platform rather than hard-coding a blue.
 */
const UA_HIGHLIGHT = 'Highlight'

/**
 * Reads the live selection once for a capture rooted at `root`.
 *
 * @param {Element} root - The capture root; ranges that do not touch it are dropped.
 * @returns {{ ranges: Range[], styles: Map<Element, string|null> } | null}
 *   The ranges that touch the root plus a per-element cache of resolved
 *   ::selection styles, or null when nothing in the root is selected.
 */
export function prepareSelectionContext(root) {
  const doc = root.ownerDocument || document
  const selection = doc.getSelection?.()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const ranges = []
  for (let i = 0; i < selection.rangeCount; i += 1) {
    const range = selection.getRangeAt(i)
    if (range.collapsed) continue
    try {
      if (range.intersectsNode(root)) ranges.push(range)
    } catch { /* a range from another tree cannot touch this root */ }
  }
  return ranges.length ? { ranges, styles: new Map() } : null
}

/**
 * The styles the browser paints this element's selected text with, as a CSS
 * declaration list — or null when it paints no highlight here at all.
 *
 * Only the spec's highlight-paintable properties are considered. A property no
 * ::selection rule set computes to the element's own value (background stays
 * transparent), so a diff against the element is what detects an authored
 * rule; an authored value equal to the element's paints identically either
 * way, so nothing is lost by reading it as unstyled.
 *
 * @param {Element} parent
 * @param {{ styles: Map<Element, string|null> }} ctx
 * @returns {string|null}
 */
function selectionStyleFor(parent, ctx) {
  if (ctx.styles.has(parent)) return ctx.styles.get(parent)
  let css
  try {
    const own = getComputedStyle(parent)
    // The browser paints no highlight over unselectable content, even when a range spans it
    // in the DOM. Both spellings are read independently: WebKit answers `user-select` with
    // `auto` while carrying the authored `none` on the prefixed property, so falling through
    // a `||` chain read the wrong one and highlighted an unselectable run.
    if (own.userSelect === 'none' ||
        own.webkitUserSelect === 'none' ||
        own.getPropertyValue('-webkit-user-select') === 'none') {
      ctx.styles.set(parent, null)
      return null
    }
    const sel = getComputedStyle(parent, '::selection')
    const declarations = []
    const background = sel.backgroundColor
    const authoredBackground =
      background && !TRANSPARENT.has(background) && background !== own.backgroundColor
    declarations.push(`background-color:${authoredBackground ? background : UA_HIGHLIGHT}`)
    if (sel.color && sel.color !== own.color) {
      // -webkit-text-fill-color inherits, so gradient text (fill: transparent)
      // would swallow the authored color without its own override.
      declarations.push(`color:${sel.color}`, `-webkit-text-fill-color:${sel.color}`)
    }
    if (sel.textShadow && sel.textShadow !== own.textShadow) {
      declarations.push(`text-shadow:${sel.textShadow}`)
    }
    if (
      sel.textDecorationLine &&
      sel.textDecorationLine !== 'none' &&
      sel.textDecorationLine !== own.textDecorationLine
    ) {
      declarations.push(
        `text-decoration:${sel.textDecorationLine} ${sel.textDecorationStyle || 'solid'} ${sel.textDecorationColor || 'currentcolor'}`
      )
    }
    css = declarations.join(';')
  } catch {
    // A browser that rejects the pseudo argument still paints the highlight.
    css = `background-color:${UA_HIGHLIGHT}`
  }
  ctx.styles.set(parent, css)
  return css
}

/**
 * Clones a text node with its selected runs wrapped in highlight spans.
 *
 * Returns null when nothing in the node is selected, letting the caller fall
 * through to a plain clone. The wrapper spans are absent from the session
 * nodeMap on purpose: the style, pseudo and background walkers key off it, and
 * a highlight span has nothing for any of them to do.
 *
 * @param {Text} textNode - The SOURCE text node being cloned.
 * @param {{ ranges: Range[], styles: Map<Element, string|null> }} ctx
 * @returns {DocumentFragment|null}
 */
export function cloneTextWithSelection(textNode, ctx) {
  const text = textNode.data
  if (!text) return null
  const parent = textNode.parentElement
  if (!parent) return null

  // Ranges never overlap, so the selected runs are disjoint intervals. A
  // boundary lands mid-node only when the node is its own boundary container;
  // an element-container boundary sits between nodes, so an intersecting node
  // is covered whole on that side.
  const runs = []
  for (const range of ctx.ranges) {
    let touches = false
    try { touches = range.intersectsNode(textNode) } catch { /* foreign tree */ }
    if (!touches) continue
    const from = range.startContainer === textNode ? range.startOffset : 0
    const to = range.endContainer === textNode ? range.endOffset : text.length
    if (to > from) runs.push([from, to])
  }
  if (runs.length === 0) return null

  const css = selectionStyleFor(parent, ctx)
  if (!css) return null

  runs.sort((a, b) => a[0] - b[0])
  const doc = textNode.ownerDocument || document
  const fragment = doc.createDocumentFragment()
  let cursor = 0
  for (const [from, to] of runs) {
    if (from > cursor) fragment.append(doc.createTextNode(text.slice(cursor, from)))
    const span = doc.createElement('span')
    // `all:unset` keeps the wrapper visually transparent: inherited text
    // properties flow through it, and the deduped base CSS's `span{…}` tag
    // rule — which would reset font and spacing to UA defaults on a span that
    // carries no generated class — is outranked by the inline declaration.
    // Same trick as the scroll wrapper (#413).
    span.setAttribute('data-snapdom-selection', '')
    // Written as an attribute, not through style.cssText: Gecko's CSSOM expands `all` into
    // every longhand it knows, which serialized ~4kb of `unset` per highlighted run into the
    // SVG. The attribute is what the serializer reads, so it stays the two declarations here.
    span.setAttribute('style', `all:unset;${css}`)
    span.textContent = text.slice(from, to)
    fragment.append(span)
    cursor = to
  }
  if (cursor < text.length) fragment.append(doc.createTextNode(text.slice(cursor)))
  return fragment
}

const px = (value) => Number.parseFloat(value) || 0

/** Text-layout properties the hidden twin must share with the field it measures. */
const TEXT_LAYOUT_PROPS = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant',
  'font-stretch',
  'letter-spacing',
  'word-spacing',
  'text-transform',
  'text-indent',
  'text-align',
  'line-height',
  'tab-size',
  'direction',
]

/**
 * The color the browser paints behind this field's selected text: the authored
 * ::selection background where a rule matches, the UA highlight where none does.
 * @param {HTMLInputElement|HTMLTextAreaElement} field
 * @param {CSSStyleDeclaration} own
 * @returns {string}
 */
function textFieldSelectionBackground(field, own) {
  try {
    const sel = getComputedStyle(field, '::selection')
    const background = sel.backgroundColor
    if (background && !TRANSPARENT.has(background) && background !== own.backgroundColor) {
      return background
    }
  } catch { /* the pseudo argument may be rejected; the UA color still paints */ }
  return UA_HIGHLIGHT
}

/**
 * Paints an <input>/<textarea>'s own selection onto its clone (SEL-1).
 *
 * The field renders its value itself, so the selected run cannot be wrapped;
 * instead the highlight is painted as background layers on the clone — a
 * background paints behind the value, which is exactly where the browser
 * draws it. The run's rectangles are measured from a hidden twin that lays
 * the value out in the field's own text styles, which is the only way to know
 * where a wrapped or scrolled run paints.
 *
 * Does nothing unless the field is focused: the browser keeps an unfocused
 * field's selection but paints no highlight for it.
 *
 * @param {HTMLInputElement|HTMLTextAreaElement} field - The SOURCE field.
 * @param {Element} clone - Its clone, already carrying the field's styles.
 */
export function inlineTextFieldSelection(field, clone) {
  const doc = field.ownerDocument || document
  if (doc.activeElement !== field) return
  let start = null
  let end = null
  try {
    start = field.selectionStart
    end = field.selectionEnd
  } catch {
    return // an input type without a selection API (number, email…)
  }
  if (start == null || end == null || start === end) return

  let value = field.value || ''
  // A password field paints mask characters, so the mask is what gets measured.
  if (field.localName === 'input' && field.type === 'password') {
    value = '\u2022'.repeat(value.length)
  }
  if (!value) return

  const own = getComputedStyle(field)
  const isTextArea = field.localName === 'textarea'
  const paddingLeft = px(own.paddingLeft)
  const paddingTop = px(own.paddingTop)
  // clientWidth excludes borders and any scrollbar, which is the space the
  // value actually lays out in.
  const contentWidth = field.clientWidth - paddingLeft - px(own.paddingRight)
  const contentHeight = field.clientHeight - paddingTop - px(own.paddingBottom)

  const twin = doc.createElement('div')
  twin.style.cssText =
    'position:absolute;top:0;left:-99999px;visibility:hidden;margin:0;border:0;padding:0;box-sizing:content-box;'
  for (const prop of TEXT_LAYOUT_PROPS) {
    twin.style.setProperty(prop, own.getPropertyValue(prop))
  }
  if (isTextArea) {
    // How the UA lays a <textarea>'s value out: wrapped at the content width,
    // breaking words where it must.
    twin.style.whiteSpace = 'pre-wrap'
    twin.style.overflowWrap = 'break-word'
    twin.style.width = `${Math.max(0, contentWidth)}px`
  } else {
    twin.style.whiteSpace = 'pre'
  }
  const run = doc.createElement('span')
  run.textContent = value.slice(start, end)
  twin.append(doc.createTextNode(value.slice(0, start)), run, doc.createTextNode(value.slice(end)))
  doc.body.appendChild(twin)

  const rects = []
  try {
    const base = twin.getBoundingClientRect()
    let dx = -field.scrollLeft
    let dy = -field.scrollTop
    if (!isTextArea) {
      // A single-line input aligns its one line box within the content area —
      // vertically centered, horizontally by text-align once the value is
      // shorter than the field — while the twin's line sits at its own
      // top-left, shrink-to-fit.
      dy += Math.max(0, (contentHeight - base.height) / 2)
      const rtl = own.direction === 'rtl'
      let align = own.textAlign
      if (align === 'start') align = rtl ? 'right' : 'left'
      else if (align === 'end') align = rtl ? 'left' : 'right'
      const slack = contentWidth - base.width
      if (slack > 0) {
        if (align === 'right') dx += slack
        else if (align === 'center') dx += slack / 2
      }
    }
    for (const rect of run.getClientRects()) {
      if (rect.width <= 0 || rect.height <= 0) continue
      rects.push({
        x: paddingLeft + (rect.left - base.left) + dx,
        y: paddingTop + (rect.top - base.top) + dy,
        width: rect.width,
        height: rect.height,
      })
    }
  } finally {
    twin.remove()
  }
  if (rects.length === 0) return

  const background = textFieldSelectionBackground(field, own)
  // One layer per line box, sized in px against the padding box (which is
  // what background-position measures from). STASHED rather than written:
  // the background-inline pass rewrites a field's background longhands from
  // the source's computed style wholesale, so layers written now would be
  // overwritten — applyTextFieldSelectionLayers composes them after that
  // pass has run.
  clone.__snapdomFieldSelection = {
    images: rects.map(() => `linear-gradient(${background},${background})`),
    positions: rects.map((rect) => `${rect.x}px ${rect.y}px`),
    sizes: rects.map((rect) => `${rect.width}px ${rect.height}px`),
    repeats: rects.map(() => 'no-repeat'),
    origins: rects.map(() => 'padding-box'),
    clips: rects.map(() => 'padding-box'),
    base: {
      image: own.backgroundImage,
      position: own.backgroundPosition,
      size: own.backgroundSize,
      repeat: own.backgroundRepeat,
      origin: own.backgroundOrigin,
      clip: own.backgroundClip,
    },
  }
}

/**
 * Composes stashed field-selection layers onto their clones (SEL-1).
 *
 * Runs at the end of the asset phase, after the background-inline pass: that
 * pass rewrites a field's background longhands from the source's computed
 * style, and a url() background it inlines has to end up UNDER the highlight
 * as a data: URL the rasterizer can draw. The pass leaves its final values
 * inline on the clone whenever the field has a background of its own; where
 * it wrote nothing, the values stashed at measure time fill in.
 *
 * @param {Map<Node, Node>} nodeMap - The session clone→source map.
 */
export function applyTextFieldSelectionLayers(nodeMap) {
  for (const clone of nodeMap.keys()) {
    const stash = clone.__snapdomFieldSelection
    if (!stash) continue
    delete clone.__snapdomFieldSelection
    const { images, positions, sizes, repeats, origins, clips, base } = stash
    const image = clone.style.backgroundImage || base.image
    if (image && image !== 'none') {
      // The highlight layers paint first (on top), the field's own background
      // under them — still behind the value, where the real highlight draws.
      images.push(image)
      positions.push(clone.style.backgroundPosition || base.position)
      sizes.push(clone.style.backgroundSize || base.size)
      repeats.push(clone.style.backgroundRepeat || base.repeat)
      origins.push(clone.style.backgroundOrigin || base.origin)
      clips.push(clone.style.backgroundClip || base.clip)
    } else {
      // No background image of its own: a final transparent layer carries the
      // field's origin/clip, because background-color clips to the LAST
      // layer's background-clip and must keep doing what it did.
      images.push('linear-gradient(transparent,transparent)')
      positions.push('0% 0%')
      sizes.push('auto')
      repeats.push('repeat')
      origins.push(base.origin || 'padding-box')
      clips.push(base.clip || 'border-box')
    }
    clone.style.backgroundImage = images.join(',')
    clone.style.backgroundPosition = positions.join(',')
    clone.style.backgroundSize = sizes.join(',')
    clone.style.backgroundRepeat = repeats.join(',')
    clone.style.backgroundOrigin = origins.join(',')
    clone.style.backgroundClip = clips.join(',')
  }
}
