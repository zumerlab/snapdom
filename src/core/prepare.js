/**
 * The clone step: prepare the live element, deepClone it, then run every pass that needs the
 * clone and the source side by side.
 * Before the clone: content-visibility forced, lazy shadow icons revealed (#488), all undone
 * in a finally.
 * After the clone, in this order: svg defs, pseudo-elements, blob URLs, @media freezing,
 * shadow CSS extraction, class generation, top-layer lift, fixed/sticky re-anchoring, scroll
 * compensation, root neutralization. Several depend on the one before; each comment says which.
 * @module prepare
 */

import { generateCSSClasses, stripTranslate, debugWarn, getStyle, shadowHost } from '../utils/index.js'
import { deepClone, finishClipHusks } from './clone.js'
import { sessionWarn } from '../utils/debug.js'
import { createCaptureSession, createClonePass } from './session.js'
import { inlinePseudoElements } from '../modules/pseudo.js'
import { paintClippedText } from '../modules/bgClipText.js'
import { universeFor } from '../modules/authorStyles.js'
import { flushStyleInvalidations, invalidateHoverChanges } from './changes.js'
import { inlineExternalDefsAndSymbols } from '../modules/svgDefs.js'
import { resolveBlobUrlsInTree, resolveMediaQueries, freezeInflatedFontSizes } from '../utils/clone.helpers.js'
import { forceContentVisibility, FORCED_VISIBILITY } from '../utils/prepare.helpers.js'
import { prepareSelectionContext } from '../modules/selection.js'
import { resolveClipRect, freezeViewportPositioned, freezeRootPercentSizes } from '../utils/capture.helpers.js'
import { nextFrame } from '../utils/browser.js'

/** In-flight #488 reveals, `{ root, promise }`. A concurrent capture whose root contains or
 *  sits inside one of these waits for it instead of forcing the same styles twice. */
const visibilityWarmups = new Set()

/** Replaced elements are atomic inlines even at `display: inline`. */
const REPLACED_INLINE = /^(?:IMG|VIDEO|CANVAS|IFRAME|EMBED|OBJECT|SVG|svg|INPUT|SELECT|TEXTAREA|BUTTON)$/

/** #315/#512: paints ::placeholder from --sd-ph/--sd-ph-o, which deepClone sets on the input
 *  clone. Emitted only when a placeholder was cloned: its -webkit-text-fill-color, mounted in a
 *  page, joins the document's property universe and changes every later pseudo's snapshot key
 *  (__tests__/regression.pseudo.afterPosition.test.js). */
const PLACEHOLDER_RULE = '[data-sd-ph]::placeholder{color:var(--sd-ph)!important;opacity:var(--sd-ph-o)!important;-webkit-text-fill-color:var(--sd-ph)!important}'

/**
 * Clone an element and return what the render step needs. One call is one clone attempt
 * with one ClonePass (session.js); its memos die with the call.
 * @param {Element} element - Element to clone
 * @param {Object} [options={}] - the normalized context (createContext)
 * @param {import('./session.js').CaptureSession} [session] - the run's session, whose maps the clone fills
 * @returns {Promise<{clone: Element, classCSS: string, classPrefixCSS: string, shadowCSS: boolean, styleCache: WeakMap<Element, CSSStyleDeclaration>, nodeMap: Map<Node, Node>, reconcileRisk: number, clipWindow: {x: number, y: number, width: number, height: number}|null, standIns: Map<Element, Element>|null, universe: Set<string>|null}>}
 *   classPrefixCSS is what burst re-prepends after a diff; clipWindow is in the root's layout
 *   pixels; standIns maps culled sources to husks, which nodeMap leaves out
 */
export async function prepareClone(element, options = {}, session = createCaptureSession(options)) {
  // MutationObserver delivers in a microtask, so same-tick mutations would meet a stale epoch.
  // Drain them before any epoch-scoped memo (universe, pseudo gates, isInSvgTemplate) is read.
  flushStyleInvalidations()
  // :hover leaves no record and no event: asked here, once per capture.
  invalidateHoverChanges(element.ownerDocument || document)
  const sessionCache = createClonePass(session, options, session.nodeMap)

  let clipWindow = null
  let clipRect = null
  let standIns = null
  if (options.clip) {
    clipRect = resolveClipRect(element, options.clip)
    if (clipRect) sessionCache.clip = { rect: clipRect, root: element }
  }

  // Read the live selection once per capture; the clone pass wraps the selected runs of text
  // it finds inside these ranges.
  if (options.captureSelection) {
    try {
      sessionCache.selection = prepareSelectionContext(element)
    } catch (e) {
      debugWarn(sessionCache, 'Couldn\'t read the text selection.', e)
    }
  }

  let clone
  let classCSS = ''
  let shadowScopedCSS = ''

  // #488: Calcite icons fetch their SVG path only once IntersectionObserver sees their shadow
  // tree. Reveal an offscreen root that holds an unresolved shadow SVG, wait (bounded) for the
  // paths, restore the styles. Concurrent captures share the warmup.
  if (visibilityWarmups.size) {
    const containsComposed = (root, child) => {
      for (let node = child; node; node = node.assignedSlot || node.parentElement || shadowHost(node)) {
        if (node === root) return true
      }
      return false
    }
    while (true) {
      const activeWarmups = [...visibilityWarmups].filter(({ root }) =>
        containsComposed(root, element) || containsComposed(element, root),
      ).map(({ promise }) => promise.catch(() => {}))
      if (!activeWarmups.length) break
      await Promise.all(activeWarmups)
    }
  }
  if (!sessionCache.clip && element.isConnected && element.ownerDocument?.visibilityState !== 'hidden') {
    try {
      const rect = element.getBoundingClientRect()
      const view = element.ownerDocument?.defaultView || window
      const offscreen = rect.right <= 0 || rect.bottom <= 0 ||
        rect.left >= view.innerWidth || rect.top >= view.innerHeight

      const pendingIcons = []
      const collectPendingShadowIcons = () => {
        const roots = []
        if (element.shadowRoot) roots.push(element.shadowRoot)
        for (const child of element.querySelectorAll('*')) {
          if (child.shadowRoot) roots.push(child.shadowRoot)
        }
        while (roots.length) {
          const root = roots.pop()
          const iconRoot = root.host?.localName === 'calcite-icon'
          for (const child of root.querySelectorAll('*')) {
            if (child.shadowRoot) roots.push(child.shadowRoot)
            if (!iconRoot || child.localName !== 'svg') continue
            const paths = child.querySelectorAll('path')
            if (!paths.length || [...paths].some(path => path.getAttribute('d')?.trim())) continue
            const box = child.getBoundingClientRect()
            if (box.width && box.height) pendingIcons.push(child)
          }
        }
      }
      if (offscreen) collectPendingShadowIcons()

      if (pendingIcons.length) {
        const warmup = (async () => {
          const style = element.style
          const hadStyle = element.hasAttribute('style')
          const touched = new Map()
          const force = (property, value) => {
            if (!touched.has(property)) {
              touched.set(property, {
                value: style.getPropertyValue(property),
                priority: style.getPropertyPriority(property),
              })
            }
            style.setProperty(property, value, 'important')
            const saved = touched.get(property)
            saved.forcedValue = style.getPropertyValue(property)
            saved.forcedPriority = style.getPropertyPriority(property)
          }
          try {
            force('left', '0')
            force('top', '0')
            force('right', 'auto')
            force('bottom', 'auto')
            force('margin-top', '0')
            force('margin-right', '0')
            force('margin-bottom', '0')
            force('margin-left', '0')
            force('transform', 'none')
            force('translate', 'none')
            force('opacity', '0')
            force('pointer-events', 'none')

            const moved = element.getBoundingClientRect()
            if (moved.right <= 0 || moved.bottom <= 0 ||
                moved.left >= view.innerWidth || moved.top >= view.innerHeight) {
              const parent = element.parentElement?.getBoundingClientRect()
              const left = parent && parent.right > 0 && parent.left < view.innerWidth ? Math.max(0, parent.left) : 0
              const top = parent && parent.bottom > 0 && parent.top < view.innerHeight ? Math.max(0, parent.top) : 0
              force('position', 'fixed')
              force('left', `${left}px`)
              force('top', `${top}px`)
            }

            await nextFrame(100)
            const deadline = Date.now() + 1500
            const stillPending = () => pendingIcons.some((svg) => {
              if ([...svg.querySelectorAll('path')].some(path => path.getAttribute('d')?.trim())) return false
              const box = svg.getBoundingClientRect()
              return box.width && box.height && box.right > 0 && box.bottom > 0 &&
                box.left < view.innerWidth && box.top < view.innerHeight
            })
            while (Date.now() < deadline && stillPending()) {
              await new Promise(resolve => setTimeout(resolve, 25))
            }
            await nextFrame(100)
          } finally {
            for (const [property, saved] of touched) {
              if (style.getPropertyValue(property) !== saved.forcedValue ||
                  style.getPropertyPriority(property) !== saved.forcedPriority) continue
              if (saved.value) style.setProperty(property, saved.value, saved.priority)
              else style.removeProperty(property)
            }
            if (!hadStyle && !style.length) element.removeAttribute('style')
            await nextFrame(100)
          }
        })()
        const entry = { root: element, promise: warmup }
        visibilityWarmups.add(entry)
        try { await warmup } finally { visibilityWarmups.delete(entry) }
      }
    } catch { /* non-blocking */ }
  }

  // #281: force content-visibility:visible so Safari/Chromium do not skip offscreen boxes.
  // Clip mode prunes the walk, it does not skip it: a clip far from the viewport lands on
  // UNRENDERED cv:auto placeholders and paints blank bands.
  const undoContentVisibility = forceContentVisibility(element, clipRect)

  if (clipRect) {
    // Freeze the window in element-local coords NOW, after cv forcing relayouts and as culling
    // reads gBCRs. A fresh gBCR at render time races user scroll.
    const elR = element.getBoundingClientRect()
    // gBCR is in PAGE pixels (ancestor transforms included), the viewBox in the root's LAYOUT
    // pixels: under scale(0.5) the right half of a slide came out as the left half, half as
    // wide. The >= 1 guard keeps untransformed captures byte-identical, since offsetWidth is
    // integer-rounded and elR.width is not.
    const lw = element.offsetWidth || elR.width
    const lh = element.offsetHeight || elR.height
    const sx = (elR.width && Math.abs(lw - elR.width) >= 1) ? lw / elR.width : 1
    const sy = (elR.height && Math.abs(lh - elR.height) >= 1) ? lh / elR.height : 1
    clipWindow = {
      x: (clipRect.left - elR.left) * sx,
      y: (clipRect.top - elR.top) * sy,
      width: clipRect.width * sx,
      height: clipRect.height * sy
    }
  }

  try {
    clone = await deepClone(element, sessionCache, options)
    // Inside the try, ahead of the undo, so the husks measure the layout the cull read.
    standIns = finishClipHusks(clone, sessionCache, options)
  } catch (e) {
    debugWarn(sessionCache, 'Capture failed while copying the element.', e)
    throw e
  } finally {
    // The root's box while its content-visibility:auto boxes are still visible, for the
    // engine: once restored, a box the engine is not rendering (off screen, or not laid out
    // again until the next frame) is empty, and the root measured 40px for a 140px clone.
    // Pinned by __tests__/core.capture.diff.contentVisibility.test.js.
    if (session) {
      session.rootBox = element.matches(FORCED_VISIBILITY) || element.querySelector(FORCED_VISIBILITY)
        ? [element.offsetWidth, element.offsetHeight] : null
    }
    undoContentVisibility()
  }
  freezeInflatedFontSizes(sessionCache.nodeMap, element.ownerDocument || document)

  // Inline external <defs>/<symbol> into the CLONE: in the source, the inserted <svg> stayed in
  // the user's DOM and shifted :first-child/nth-child matches. Refs resolve from the live page.
  if (sessionCache.slicer?.due()) await sessionCache.slicer.pause()
  try {
    inlineExternalDefsAndSymbols(clone, undefined, element)
  } catch (e) {
    sessionWarn(session, 'svg-defs-failed', 'external <use> references failed to inline', e)
    debugWarn(sessionCache, 'Couldn\'t copy external SVG icons; some may be missing.', e)
  }
  try {
    await inlinePseudoElements(element, clone, sessionCache, options)
  } catch (e) {
    sessionWarn(session, 'pseudo-failed', '::before/::after pass failed', e)
    debugWarn(sessionCache, 'Couldn\'t copy ::before/::after content; some decorations may be missing.', e)
  }
  // Firefox gradient text (#530): last of the node passes, since the overlay it inserts is a
  // clone child with no live counterpart.
  if (sessionCache.bgClipText) paintClippedText(sessionCache.bgClipText)
  await resolveBlobUrlsInTree(clone, sessionCache)

  // Kept light-DOM <style> clones travel into the SVG. The differential path never splices
  // one (HEAVY_SUBTREE, diff.js).
  for (const [cloneNode, srcNode] of sessionCache.nodeMap.entries()) {
    if (srcNode?.tagName === 'STYLE' && cloneNode?.tagName === 'STYLE' && !cloneNode.hasAttribute('data-sd')) {
      let css = cloneNode.textContent || ''
      try {
        const rules = srcNode.sheet && srcNode.sheet.cssRules
        // The SVG's tiny viewport would re-evaluate @media: freeze it to the live viewport.
        if (rules && /@media/i.test(css)) css = resolveMediaQueries(rules)
      } catch { /* unreadable sheet: leave verbatim */ }
      // #562: below the class CSS, or `.card` ties the card's generated class and wins by
      // coming later. @import and @namespace are invalid in a layer.
      // Pinned by `__tests__/snapdom.issue562.test.js`.
      if (!/@(?:import|namespace)\b/i.test(css)) css = `@layer{${css}}`
      cloneNode.textContent = css
    }
  }

  // Pull shadow-scoped CSS out of the clone, so it does not render as text.

  try {
    // Shallow first (#558): a group's one copy must follow every scope above any member and
    // precede every scope below one. Same-depth scopes never cover one element, so their order
    // is free. The sort is stable, so with no sharing the only blocks it moves against the
    // document order it replaced are ones whose subtrees never meet.
    const styleNodes = [...clone.querySelectorAll('style[data-sd]')].sort((a, b) => a.getAttribute('data-sd') - b.getAttribute('data-sd'))
    for (const s of styleNodes) {
      shadowScopedCSS += s.textContent || ''
      s.remove() // Do not leave <style> inside the visual clone
    }
  } catch (e) {
    debugWarn(sessionCache, 'Couldn\'t copy shadow DOM styles.', e)
  }

  if (sessionCache.slicer?.due()) await sessionCache.slicer.pause()
  const keyToClass = generateCSSClasses(sessionCache.styleMap)
  classCSS = Array.from(keyToClass.entries())
    .map(([key, className]) => `.${className}{${key}}`)
    .join('')

  // #359: suppress native ::before/::after on elements where we inlined them (avoids double render from cloned <style>)
  const PSEUDO_SUPPRESS = '[data-snapdom-has-after]::after,[data-snapdom-has-before]::before{content:none!important;display:none!important}'
  // prepend shadow CSS so variables/rules are available for everything; scoped
  // ::marker/::first-line rules (emitScopedPseudoRule) ride along with it
  const classPrefixCSS = shadowScopedCSS + PSEUDO_SUPPRESS + (sessionCache.usesPlaceholder ? PLACEHOLDER_RULE : '') + (sessionCache.pseudoCSS || '')
  classCSS = classPrefixCSS + classCSS

  for (const [node, key] of sessionCache.styleMap.entries()) {
    applyStyleClass(node, key, keyToClass)
  }

  // An open modal <dialog> or popover paints in the top layer with a ::backdrop; its clone
  // would paint in tree order. Move it to the end of the root (document order approximates
  // top-layer order) after class application, so frozen styles survive the move.
  try {
    liftTopLayerClones(element, clone, sessionCache.nodeMap)
  } catch (e) {
    debugWarn(sessionCache, 'Couldn\'t bring an open dialog or popover into the capture.', e)
  }

  // Re-anchor fixed/sticky clones where they paint, in clip mode and when the root itself is
  // scrolled (stuck stickies freeze where stuck, horizontal included). After class application
  // (the sticky placeholder inherits the twin's class) and BEFORE the scroll wrapper below,
  // whose +scrollY on fixed/absolute boxes cancels its translate for them.
  if ((sessionCache.clip || element.scrollTop || element.scrollLeft) && clone?.nodeType === 1) {
    try {
      const edge = sessionCache.clip && clipWindow ? { x: clipWindow.x, y: clipWindow.y } : { x: 0, y: 0 }
      freezeViewportPositioned(element, clone, sessionCache.nodeMap, sessionCache.styleCache, edge)
    } catch (e) {
      debugWarn(sessionCache, 'Couldn\'t keep fixed-position elements in place.', e)
    }
  }

  for (const [cloneNode, originalNode] of sessionCache.nodeMap.entries()) {
    // The document's scrolling element as the root is the whole page: its scroll is the
    // viewport's, which a clip rect already encodes and a full capture does not show (the top
    // of the page went missing and the bottom came out blank). Other roots need their wrapper.
    if (originalNode === element && element === element.ownerDocument.scrollingElement) continue
    wrapScrolledClone(cloneNode, originalNode, sessionCache.nodeMap, sessionCache.styleCache)
  }
  // #505: html/body overflow can apply to the viewport, not their own (possibly
  // zero-height) box. Inside foreignObject they lose that special treatment.
  // Freeze the used value; retain body clipping when html owns the overflow or
  // containment disables propagation (CSS Overflow 3, viewport propagation).
  const doc = element.ownerDocument
  if ((element === doc.body || element === doc.documentElement) && doc.documentElement.localName === 'html') {
    const htmlStyle = sessionCache.styleCache.get(doc.documentElement) || getStyle(doc.documentElement)
    if (element === doc.documentElement) clone.style.overflow = 'visible'
    const bodyClone = element === doc.body ? clone : clone.querySelector('body')
    if (bodyClone && htmlStyle.overflowX === 'visible' && htmlStyle.overflowY === 'visible' &&
        htmlStyle.contain === 'none' && !htmlStyle.containerType?.includes('size') &&
        htmlStyle.contentVisibility !== 'auto' && htmlStyle.contentVisibility !== 'hidden') {
      const bodyStyle = sessionCache.styleCache.get(doc.body) || getStyle(doc.body)
      if (bodyStyle.contain === 'none' && !bodyStyle.containerType?.includes('size') &&
          bodyStyle.contentVisibility !== 'auto' && bodyStyle.contentVisibility !== 'hidden' &&
          bodyStyle.display !== 'none') bodyClone.style.overflow = 'visible'
    }
  }
  // The root clone is the foreignObject's content now, so whatever placed it in the page
  // (margin, inset offsets, float) is zeroed and its transform keeps scale/skew only. The
  // inlined computed values already hold the current animation frame; animation:none keeps
  // the svg from replaying it from the start.
  if (element === sessionCache.nodeMap.get(clone)) {
    const computed = sessionCache.styleCache.get(element) || getStyle(element)
    sessionCache.styleCache.set(element, computed)
    const transform = stripTranslate(computed.transform)
    clone.style.margin = '0'
    clone.style.top = 'auto'
    clone.style.left = 'auto'
    clone.style.right = 'auto'
    clone.style.bottom = 'auto'
    clone.style.animation = 'none'
    clone.style.transition = 'none'
    clone.style.willChange = 'auto'
    clone.style.float = 'none'
    clone.style.clear = 'none'
    // Chromium aligns a block-level box by justify-self, and an absolutely positioned one by
    // align-self too, inside the container, which is wider than the root under a clip or a
    // bleed. A 400px root its grid centred drew x=150 at the left edge of a clip from x=100
    // (#548). Pinned by __tests__/core.prepare.rootAlign.test.js.
    clone.style.placeSelf = 'normal'
    clone.style.transform = transform || ''
    // Individual translate is separate from computed transform. Like its matrix e/f,
    // its page placement has already been discarded by the root's bbox compensation.
    clone.style.translate = 'none'
    // An atomic inline (input, button, inline-block) aligns its baseline with the container's
    // 16px default strut, not the page's: a captured <input> landed 1px low, 414 pixels off its
    // in-page render in Chromium. Top-align it.
    // Pinned by __tests__/core.prepare.inlineRoot.test.js.
    if (/^inline-/.test(computed.display) || (computed.display === 'inline' && REPLACED_INLINE.test(element.tagName))) {
      clone.style.verticalAlign = 'top'
    }
    // Its containing block stayed in the page too: a percentage min/max size would resolve
    // against the foreignObject instead. No-op unless one of them holds a `%`.
    freezeRootPercentSizes(element, clone, computed)
    // So did its language, which picks default fonts per script: under <html lang="zh">
    // Firefox set d42's heading in sans-serif. Firefox and WebKit honour it in the svg;
    // Chromium's svg images do not (13.8px off either way). Pinned by
    // __tests__/core.prepare.lang.test.js.
    if (!clone.hasAttribute('lang')) {
      const lang = element.closest?.('[lang]')?.getAttribute('lang') ?? element.ownerDocument?.documentElement?.getAttribute('lang')
      if (lang) clone.setAttribute('lang', lang)
    }
  }

  return {
    clone,
    classCSS,
    classPrefixCSS,
    shadowCSS: !!shadowScopedCSS,
    styleCache: sessionCache.styleCache,
    nodeMap: sessionCache.nodeMap,
    reconcileRisk: sessionCache.reconcileRisk || 0,
    clipWindow,
    standIns,
    // What the snapshots were pruned by, for the base reset (assembleCaptureCSS): this pass's
    // scan, or the shadow union for a root in a shadow root. Read by the reset alone, the scan
    // could be a later one (#554), and under a shadow root a black text fill painted every glyph.
    universe: universeFor(element, sessionCache),
  }
}

/**
 * Move the clones of open modal dialogs and popovers to the end of the root, each with a
 * synthesized ::backdrop, so they paint above everything the way the top layer does.
 * Pinned by __tests__/core.toplayer.test.js.
 * @param {Element} element - source root
 * @param {Element} clone - clone root
 * @param {Map<Node, Node>} nodeMap - clone to source
 */
function liftTopLayerClones(element, clone, nodeMap) {
  const tops = []
  for (const sel of [':modal', ':popover-open']) {
    // Each selector separately: an unsupported one must not kill the other.
    try { tops.push(...element.querySelectorAll(sel)) } catch { }
  }
  if (!tops.length) return
  const srcToClone = new Map()
  for (const [c, s] of nodeMap.entries()) srcToClone.set(s, c)
  let z = 2147480000
  for (const top of tops) {
    const topClone = srcToClone.get(top)
    if (!topClone || topClone === clone || topClone.parentNode == null) continue
    // Synthesized ::backdrop: fixed inset:0 resolves against the svg viewport and dims the
    // whole capture. Only the rgba dim travels; backdrop-filter cannot (#457, and there is no
    // source element to emulate it from).
    try {
      const bd = getComputedStyle(top, '::backdrop')
      const bg = bd.backgroundColor
      const bgImg = bd.backgroundImage
      const paints = (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') || (bgImg && bgImg !== 'none')
      if (paints) {
        const bdiv = document.createElement('div')
        bdiv.setAttribute('data-sd-backdrop', '')
        bdiv.style.cssText = `position:fixed;inset:0;z-index:${z};background-color:${bg};` +
          (bgImg && bgImg !== 'none' && bgImg.includes('data:') ? `background-image:${bgImg};` : '')
        clone.appendChild(bdiv)
      }
    } catch { /* no ::backdrop support: just the lift */ }
    z += 1
    topClone.style.zIndex = String(z)
    clone.appendChild(topClone) // move to end: paints above the rest, out-of-flow so layout keeps
    z += 1
  }
}

/**
 * Applies a node's deduped style class plus the per-node fixups that must survive class
 * generation. Shared by prepareClone and burst's differential recapture, which re-derives
 * keyToClass after splicing dirty subtrees.
 * @param {Element} node - clone node (styleMap key)
 * @param {string} key - style signature
 * @param {Map<string,string>} keyToClass
 */
export function applyStyleClass(node, key, keyToClass) {
  if (node.tagName === 'STYLE') return
  const className = keyToClass.get(key)
  if (className) node.classList.add(className)

  // Re-apply backgroundImage so it is not lost, when there is one
  const bgImage = node.style?.backgroundImage
  if (bgImage && bgImage !== 'none') node.style.backgroundImage = bgImage
}

/** Container properties a grid or flex scroller hands to its scroll wrapper. */
const SCROLLER_LAYOUT = ['grid-template-columns', 'grid-template-rows', 'grid-template-areas',
  'grid-auto-columns', 'grid-auto-rows', 'grid-auto-flow', 'row-gap', 'column-gap',
  'align-items', 'justify-items', 'align-content', 'justify-content', 'flex-direction', 'flex-wrap']

/**
 * Scroll compensation for one clone/source pair: the children move into a translated wrapper,
 * and positioned descendants with outside containing blocks are compensated (#364/#518).
 * Also run by differential recapture. Pinned by __tests__/snapdom.issue518.test.js and
 * __tests__/regression.scrolledLayout.test.js.
 * @param {Element} cloneNode
 * @param {Element} originalNode
 * @param {Map<Node, Node>} nodeMap - clone to source
 * @param {WeakMap<Element, CSSStyleDeclaration>} styleCache
 */
export function wrapScrolledClone(cloneNode, originalNode, nodeMap, styleCache) {
  const scrollX = originalNode.scrollLeft
  const scrollY = originalNode.scrollTop
  const hasScroll = scrollX || scrollY
  // Realm-safe HTML check: iframe-realm clones are not instances of this window's
  // HTMLElement, but their scroll still needs compensating.
  if (!hasScroll || cloneNode?.nodeType !== 1 || cloneNode.namespaceURI !== 'http://www.w3.org/1999/xhtml') return
  cloneNode.style.overflow = 'hidden'
  cloneNode.style.scrollbarWidth = 'none'
  cloneNode.style.msOverflowStyle = 'none'

  // #364: Before wrapping with translate, adjust fixed/absolute descendants
  // so they don't shift when the translate wrapper creates a new containing block.
  try {
    const positioned = cloneNode.querySelectorAll('*')
    for (const child of positioned) {
      if (child.nodeType !== 1 || child.namespaceURI !== 'http://www.w3.org/1999/xhtml') continue
      const source = nodeMap?.get(child)
      const cs = source && (styleCache?.get(source) || getStyle(source))
      const pos = child.style.position || cs?.position
      if (pos !== 'fixed' && pos !== 'absolute') continue
      // Frozen fixed/sticky clones carry painted coordinates: retain their cancellation
      // of the wrapper translation. Ordinary boxes scroll with an internal CB (#518).
      const frozen = cs && cs.position !== 'absolute' && pos === 'absolute'
      let cb = null
      if (source && !frozen) {
        for (let ancestor = source.parentElement || shadowHost(source); ancestor;
          ancestor = ancestor.parentElement || shadowHost(ancestor)) {
          const acs = styleCache?.get(ancestor) || getStyle(ancestor)
          if ((pos === 'absolute' && acs.position !== 'static') ||
              (acs.transform && acs.transform !== 'none') ||
              (acs.translate && acs.translate !== 'none') ||
              (acs.rotate && acs.rotate !== 'none') ||
              (acs.scale && acs.scale !== 'none') ||
              (acs.filter && acs.filter !== 'none') ||
              (acs.backdropFilter && acs.backdropFilter !== 'none') ||
              (acs.perspective && acs.perspective !== 'none') ||
              /transform|perspective|filter/.test(acs.willChange || '') ||
              /layout|paint|strict|content/.test(acs.contain || '')) {
            cb = ancestor
            break
          }
          if (ancestor === originalNode) break
        }
      }
      if (cb) {
        // The new wrapper replaces the scroller as CB. Freeze used offsets so %
        // insets don't resolve against the wrapper's content height instead.
        if (cb === originalNode) {
          child.style.top = cs.top
          child.style.left = cs.left
          child.style.right = cs.right
          child.style.bottom = cs.bottom
        }
        continue
      }
      const curTop = parseFloat(child.style.top || cs?.top) || 0
      const curLeft = parseFloat(child.style.left || cs?.left) || 0
      child.style.top = `${curTop + scrollY}px`
      child.style.left = `${curLeft + scrollX}px`
      if (pos === 'fixed') child.style.position = 'absolute'
    }
  } catch { /* non-blocking */ }

  const inner = document.createElement('div')
  // #413: baseCSS's `div{white-space:normal;font-family:…}` hits this wrapper and overrides
  // what the scroller passes down (a <pre>'s pre-wrap and monospace). `all:unset` inline lets
  // inherited props flow again and keeps the rest at initial.
  inner.style.all = 'unset'
  // `all` leaves `direction` alone, so baseCSS's `div{direction:ltr}` won over the
  // scroller's: a right-to-left scroller lost its order and the translate pushed its
  // content the wrong way, leaving a blank band where the page shows the scrolled items.
  inner.style.direction = 'inherit'
  inner.style.transform = `translate(${-scrollX}px, ${-scrollY}px)`
  inner.style.willChange = 'transform'
  // A grid or flex scroller lays its children out itself: as its only item, an inline-block
  // wrapper stacked them as blocks in the first track (Zumly's flatten, 2026-10-28). The
  // wrapper takes the layout over and the scroller becomes a plain box around it.
  const display = (styleCache?.get(originalNode) || getStyle(originalNode)).display
  const layout = display.includes('grid') ? 'grid' : display.includes('flex') ? 'flex' : ''
  if (layout) {
    cloneNode.style.display = display.startsWith('inline') ? 'inline-block' : 'block'
    inner.style.display = layout
    for (const prop of SCROLLER_LAYOUT) inner.style.setProperty(prop, 'inherit')
  } else {
    inner.style.display = 'inline-block'
  }
  inner.style.width = '100%'
  while (cloneNode.firstChild) {
    inner.appendChild(cloneNode.firstChild)
  }
  cloneNode.appendChild(inner)
}
