/**
 * Prepares a deep clone of an element, inlining pseudo-elements and generating CSS classes.
 * @module prepare
 */

import { generateCSSClasses, stripTranslate, debugWarn, getStyle } from '../utils/index.js'
import { deepClone } from './clone.js'
import { inlinePseudoElements } from '../modules/pseudo.js'
import { flushStyleInvalidations } from '../modules/styles.js'
import { inlineExternalDefsAndSymbols } from '../modules/svgDefs.js'
import { resolveBlobUrlsInTree, resolveMediaQueries } from '../utils/clone.helpers.js'
import { stabilizeLayout, forceContentVisibility } from '../utils/prepare.helpers.js'
import { resolveClipRect, freezeViewportPositioned } from '../utils/capture.helpers.js'

/**
 * Prepares a clone of an element for capture, inlining pseudo-elements and generating CSS classes.
 *
 * @param {Element} element - Element to clone
 * @param {boolean} [embedFonts=false] - Whether to embed custom fonts
 * @param {Object} [options={}] - Capture options
 * @param {string[]} [options.exclude] - CSS selectors for elements to exclude
 * @param {Function} [options.filter] - Custom filter function
 * @returns {Promise<Object>} Object containing the clone, generated CSS, style cache, and the session clone→source nodeMap
 */

export async function prepareClone(element, options = {}) {
  // Same-tick DOM/style mutations otherwise reach the clone against a stale epoch
  // (MutationObserver delivery is a microtask) — drain them before any epoch-scoped
  // memo (universe, pseudo gates, isInSvgTemplate) is read.
  flushStyleInvalidations()
  // captureDOM always provides its own session (createCaptureSession). Direct callers
  // (tests, embedders) get fresh isolated maps.
  const session = options.__session || { styleMap: new Map(), styleCache: new WeakMap(), nodeMap: new Map() }
  const sessionCache = {
    styleMap: session.styleMap,
    styleCache: session.styleCache,
    nodeMap: session.nodeMap,
    options
  }

  let clipWindow = null
  if (options.clip) {
    const rect = resolveClipRect(element, options.clip)
    if (rect) {
      sessionCache.clip = { rect, root: element }
      // Freeze the window in element-local coords NOW, at the same instant culling reads
      // gBCRs — re-deriving it from a fresh gBCR at render time races user scroll.
      const elR = element.getBoundingClientRect()
      clipWindow = {
        x: rect.left - elR.left,
        y: rect.top - elR.top,
        width: rect.width,
        height: rect.height
      }
    }
  }

  let clone
  let classCSS = ''
  let shadowScopedCSS = ''

  const undoStabilizeLayout = stabilizeLayout(element)

  // #281: Force content-visibility:visible so Safari/Chromium don't skip offscreen elements.
  // Clip mode skips this O(page) walk: on-screen cv:auto content is already rendered by the
  // browser, and offscreen content gets culled anyway (cv's placeholder box culls correctly).
  const undoContentVisibility = sessionCache.clip ? () => {} : forceContentVisibility(element)

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
  try {
    inlineExternalDefsAndSymbols(clone)
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
  if (element === sessionCache.nodeMap.get(clone)) {
    const computed = sessionCache.styleCache.get(element) || getStyle(element)
    sessionCache.styleCache.set(element, computed)
    const transform = stripTranslate(computed.transform)
    clone.style.margin = '0'
    // clone.style.position = "static";
    clone.style.top = 'auto'
    clone.style.left = 'auto'
    clone.style.right = 'auto'
    clone.style.bottom = 'auto'
    //clone.style.zIndex = "auto";
    clone.style.animation = 'none'
    clone.style.transition = 'none'
    clone.style.willChange = 'auto'
    clone.style.float = 'none'
    clone.style.clear = 'none'
    clone.style.transform = transform || ''
  }

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

/** See call site: replicates top-layer paint order + ::backdrop for open modals/popovers. */
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

// helpers (stabilizeLayout, resolveBlobUrlsInTree) ahora vienen de utils; bloque antiguo eliminado.

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
  if (node.getRootNode && node.getRootNode() instanceof ShadowRoot) {
    node.setAttribute('style', key.replace(/;/g, '; '))
    return
  }

  // Fuera de Shadow DOM: aplica clase generada para compresión
  const className = keyToClass.get(key)
  if (className) node.classList.add(className)

  // Reaplica backgroundImage para evitar que se pierda (si existe)
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
