/**
 * The clone step: prepare the live element, deepClone it, then run every pass that needs the
 * clone and the source side by side.
 *
 * Before the clone: layout stabilized, content-visibility forced, lazy shadow icons revealed
 * (#488). All of it is undone in a finally, so the page is as it was when this returns.
 * After the clone, in this order: svg defs, pseudo-elements, blob URLs, @media freezing,
 * shadow CSS extraction, class generation, top-layer lift, fixed/sticky re-anchoring, scroll
 * compensation, root neutralization. Several of those depend on the one before, and the
 * comment at each says which.
 * @module prepare
 */

import { generateCSSClasses, stripTranslate, debugWarn, getStyle, isShadowRoot } from '../utils/index.js'
import { deepClone } from './clone.js'
import { inlinePseudoElements } from '../modules/pseudo.js'
import { flushStyleInvalidations, invalidateHoverChanges } from '../modules/styles.js'
import { inlineExternalDefsAndSymbols } from '../modules/svgDefs.js'
import { resolveBlobUrlsInTree, resolveMediaQueries } from '../utils/clone.helpers.js'
import { stabilizeLayout, forceContentVisibility } from '../utils/prepare.helpers.js'
import { prepareSelectionContext } from '../modules/selection.js'
import { resolveClipRect, freezeViewportPositioned } from '../utils/capture.helpers.js'
import { nextFrame } from '../utils/browser.js'

/** In-flight #488 reveals, `{ root, promise }`. A concurrent capture whose root contains or
 *  sits inside one of these waits for it instead of forcing the same styles twice. */
const visibilityWarmups = new Set()

/**
 * Clone an element for capture and return the clone with everything the render step needs.
 *
 * The source is prepared and restored around deepClone (see the module header). Direct
 * callers without a session get fresh maps; captureDOM always passes its own.
 * @param {Element} element - Element to clone
 * @param {Object} [options={}] - the normalized context (createContext), plus `__session`
 * @returns {Promise<{clone: Element, classCSS: string, classPrefixCSS: string, styleCache: WeakMap<Element, CSSStyleDeclaration>, nodeMap: Map<Node, Node>, reconcileRisk: number, clipWindow: {x: number, y: number, width: number, height: number}|null}>}
 *   classCSS is the full stylesheet (prefix included); classPrefixCSS is the shadow, pseudo
 *   and suppression part alone, which burst re-prepends after a diff; clipWindow is the
 *   clip rect in the root's own layout pixels
 */
export async function prepareClone(element, options = {}) {
  // Same-tick DOM/style mutations otherwise reach the clone against a stale epoch
  // (MutationObserver delivery is a microtask) — drain them before any epoch-scoped
  // memo (universe, pseudo gates, isInSvgTemplate) is read.
  flushStyleInvalidations()
  // :hover leaves no record and no event: asked here, once per capture.
  invalidateHoverChanges(element.ownerDocument || document)
  // captureDOM always provides its own session (createCaptureSession). Direct callers
  // (tests, embedders) get fresh isolated maps.
  const session = options.__session || { styleMap: new Map(), styleCache: new WeakMap(), nodeMap: new Map() }
  const sessionCache = {
    styleMap: session.styleMap,
    styleCache: session.styleCache,
    nodeMap: session.nodeMap,
    options,
    // On the session, not read from options: diff.js clones through a context whose
    // __slicer belongs to an earlier capture.
    slicer: options.__slicer || null
  }

  let clipWindow = null
  let clipRect = null
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
      debugWarn(sessionCache, 'prepareSelectionContext failed', e)
    }
  }

  let clone
  let classCSS = ''
  let shadowScopedCSS = ''

  // #488: Calcite icons defer their SVG path fetch until IntersectionObserver says
  // their open shadow tree is visible. Reveal only offscreen roots that actually contain an
  // unresolved shadow SVG, then wait (bounded) for its paint data before cloning. The source
  // styles are restored first, and concurrent captures share the same warmup.
  if (visibilityWarmups.size) {
    const containsComposed = (root, child) => {
      for (let node = child; node; node = node.assignedSlot || node.parentElement || node.getRootNode()?.host) {
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

  const undoStabilizeLayout = stabilizeLayout(element)

  // #281: Force content-visibility:visible so Safari/Chromium don't skip offscreen elements.
  // Clip mode prunes the walk to the window instead of skipping it: a clip rect far from the
  // real viewport lands on UNRENDERED cv:auto placeholders (blank bands in the capture),
  // while content outside the window still gets culled at its placeholder box.
  const undoContentVisibility = forceContentVisibility(element, clipRect)

  if (clipRect) {
    // Freeze the window in element-local coords NOW — after cv forcing (which can relayout),
    // at the same instant culling reads gBCRs. Re-deriving it from a fresh gBCR at render
    // time races user scroll.
    const elR = element.getBoundingClientRect()
    // gBCR is in PAGE pixels — it carries every ancestor transform — while the viewBox that
    // consumes this window is in the root's own LAYOUT pixels. The two were mixed, so under
    // a scaled ancestor the capture showed the wrong region at the wrong extent: a
    // zoom-to-fit editor at scale(0.5) asking for the right half of a slide got the left
    // half, half as wide. Convert with the element's own visual-to-layout ratio. The
    // sub-pixel guard keeps the untransformed path (every ordinary capture) byte-identical,
    // since offsetWidth is integer-rounded and elR.width is not.
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
  } catch (e) {
    console.warn('deepClone failed:', e)
    throw e
  } finally {
    undoContentVisibility()
    undoStabilizeLayout()
  }

  // Inline external <defs>/<symbol> into the CLONE, not the live source. Operating on the
  // source mutated the user's DOM (a hidden <svg> was inserted as firstChild and never
  // removed) and shifted :first-child/nth-child matches while deepClone read computed
  // styles. The clone is detached; external refs are still resolved from the live document.
  if (sessionCache.slicer?.due()) await sessionCache.slicer.pause()
  try {
    inlineExternalDefsAndSymbols(clone, undefined, element)
  } catch (e) {
    console.warn('inlineExternal defs or symbol failed:', e)
  }
  try {
    await inlinePseudoElements(element, clone, sessionCache, options)
  } catch (e) {
    console.warn('inlinePseudoElements failed:', e)
  }
  await resolveBlobUrlsInTree(clone, sessionCache)

  // Kept light-DOM <style> clones travel into the SVG, whose own tiny viewport would
  // re-evaluate their @media conditions — freeze them to the live viewport's state now.
  for (const [cloneNode, srcNode] of sessionCache.nodeMap.entries()) {
    if (srcNode?.tagName === 'STYLE' && cloneNode?.tagName === 'STYLE' && !cloneNode.hasAttribute('data-sd')) {
      try {
        const rules = srcNode.sheet && srcNode.sheet.cssRules
        if (rules && /@media/i.test(cloneNode.textContent || '')) {
          cloneNode.textContent = resolveMediaQueries(rules)
        }
      } catch { /* unreadable sheet → leave verbatim */ }
    }
  }

  // --- Pull shadow-scoped CSS out of the clone (avoid visible CSS text) ---

  try {
    const styleNodes = clone.querySelectorAll('style[data-sd]')
    for (const s of styleNodes) {
      shadowScopedCSS += s.textContent || ''
      s.remove() // Do not leave <style> inside the visual clone
    }
  } catch (e) {
    debugWarn(sessionCache, 'Failed to extract shadow CSS from style[data-sd]', e)
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
  const classPrefixCSS = shadowScopedCSS + PSEUDO_SUPPRESS + (sessionCache.__pseudoCSS || '')
  classCSS = classPrefixCSS + classCSS

  for (const [node, key] of sessionCache.styleMap.entries()) {
    applyStyleClass(node, key, keyToClass)
  }

  // Top layer: an open modal <dialog> / popover paints above everything with a ::backdrop,
  // but its clone renders in tree order with no backdrop box. Re-append matching clones at
  // the end of the root (document order approximates top-layer order) with a synthesized
  // backdrop div. Zero cost when nothing matches; runs after class application so frozen
  // styles survive the move.
  try {
    liftTopLayerClones(element, clone, sessionCache.nodeMap)
  } catch (e) {
    debugWarn(sessionCache, 'top-layer lift failed', e)
  }

  // Re-anchor fixed/sticky clones to their painted position — in clip mode (the window is
  // what the user sees) and whenever the capture root is itself scrolled (stuck stickies
  // must freeze where they're stuck: header/footer/left-sidebar, horizontal included).
  // Must run after class application (the sticky placeholder inherits the twin's class)
  // and BEFORE the scrolled-container wrapper below — its fixed/absolute adjustment
  // (+scrollY) is what cancels the wrapper's translate for these now-absolute elements.
  if ((sessionCache.clip || element.scrollTop || element.scrollLeft) && clone?.nodeType === 1) {
    try {
      const edge = sessionCache.clip && clipWindow ? { x: clipWindow.x, y: clipWindow.y } : { x: 0, y: 0 }
      freezeViewportPositioned(element, clone, sessionCache.nodeMap, sessionCache.styleCache, edge)
    } catch (e) {
      debugWarn(sessionCache, 'freezeViewportPositioned failed', e)
    }
  }

  for (const [cloneNode, originalNode] of sessionCache.nodeMap.entries()) {
    // Clip mode: the window is derived from gBCRs, which already encode the root's own
    // scroll — un-scrolling the root here would compensate twice (blank output when
    // capturing a scrolled documentElement).
    if (sessionCache.clip && originalNode === element) continue
    wrapScrolledClone(cloneNode, originalNode)
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
    clone.style.transform = transform || ''
    // Individual translate is separate from computed transform. Like its matrix e/f,
    // its page placement has already been discarded by the root's bbox compensation.
    clone.style.translate = 'none'
  }

  // #75: a <pre>'s top margin pushed its last line out of the capture box.
  for (const [cloneNode, originalNode] of sessionCache.nodeMap.entries()) {
    if (originalNode.tagName === 'PRE') {
      cloneNode.style.marginTop = '0'
      cloneNode.style.marginBlockStart = '0'
    }
  }
  return {
    clone,
    classCSS,
    classPrefixCSS,
    styleCache: sessionCache.styleCache,
    nodeMap: sessionCache.nodeMap,
    reconcileRisk: sessionCache.reconcileRisk || 0,
    clipWindow,
  }
}

/**
 * Move the clones of open modal dialogs and popovers to the end of the root, each with a
 * synthesized ::backdrop, so they paint above everything the way the top layer does.
 * Pinned by __tests__/core.toplayer.test.js.
 * @param {Element} element - source root
 * @param {Element} clone - clone root
 * @param {Map<Node, Node>} nodeMap - clone -> source
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
    // Synthesized ::backdrop — fixed inset:0 resolves against the svg viewport inside the
    // foreignObject, dimming the whole capture like the live backdrop dims the page.
    // backdrop-filter can't ride along (#457 + no source element for emulation): the rgba
    // dim is the faithful-and-portable part.
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
    } catch { /* no ::backdrop support → just the lift */ }
    z += 1
    topClone.style.zIndex = String(z)
    clone.appendChild(topClone) // move to end: paints above the rest, out-of-flow so layout keeps
    z += 1
  }
}

/**
 * Applies a node's deduped style class (or the shadow-scoped style attribute) plus the
 * per-node fixups that must survive class generation. Shared by prepareClone and burst's
 * differential recapture, which re-derives keyToClass after splicing dirty subtrees.
 * @param {Element} node - clone node (styleMap key)
 * @param {string} key - style signature
 * @param {Map<string,string>} keyToClass
 */
export function applyStyleClass(node, key, keyToClass) {
  if (node.tagName === 'STYLE') return
  /* c8 ignore next 4 */
  if (node.getRootNode && isShadowRoot(node.getRootNode())) {
    node.setAttribute('style', key.replace(/;/g, '; '))
    return
  }

  // Outside shadow DOM: apply the generated class for compression
  const className = keyToClass.get(key)
  if (className) node.classList.add(className)

  // Re-apply backgroundImage so it is not lost, when there is one
  const bgImage = node.style?.backgroundImage
  const hasIcon = node.dataset?.snapdomHasIcon
  if (bgImage && bgImage !== 'none') node.style.backgroundImage = bgImage
  /* c8 ignore next 4 */
  if (hasIcon) {
    node.style.verticalAlign = 'middle'
    node.style.display = 'inline'
  }
}

/**
 * Scroll compensation for one clone/source pair: hides scrollbars and wraps the clone's
 * children in a translate(-scrollX,-scrollY) inner div, adjusting fixed/absolute
 * descendants first (#364). No-op for unscrolled sources. Shared by prepareClone's
 * whole-map pass and burst's differential recapture (delta entries only).
 * @param {Element} cloneNode
 * @param {Element} originalNode
 */
export function wrapScrolledClone(cloneNode, originalNode) {
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
      const pos = child.style.position
      if (pos === 'fixed' || pos === 'absolute') {
        const curTop = parseFloat(child.style.top) || 0
        const curLeft = parseFloat(child.style.left) || 0
        child.style.top = `${curTop + scrollY}px`
        child.style.left = `${curLeft + scrollX}px`
        if (pos === 'fixed') child.style.position = 'absolute'
      }
    }
  } catch { /* non-blocking */ }

  const inner = document.createElement('div')
  // #413: baseCSS emits a `div{white-space:normal;font-family:…}` rule (from the tag's
  // all:initial defaults) that directly targets this wrapper and overrides the inherited
  // text formatting of the scrolled element (e.g. a <pre>'s pre-wrap/monospace). `all:unset`
  // lets inherited props flow from the parent again (inline style beats the type selector)
  // while keeping non-inherited props at initial, so the wrapper stays visually transparent.
  inner.style.all = 'unset'
  inner.style.transform = `translate(${-scrollX}px, ${-scrollY}px)`
  inner.style.willChange = 'transform'
  inner.style.display = 'inline-block'
  inner.style.width = '100%'
  while (cloneNode.firstChild) {
    inner.appendChild(cloneNode.firstChild)
  }
  cloneNode.appendChild(inner)
}
