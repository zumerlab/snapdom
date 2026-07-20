/**
 * Prepares a deep clone of an element, inlining pseudo-elements and generating CSS classes.
 * @module prepare
 */

import { generateCSSClasses, stripTranslate, debugWarn, getStyle } from '../utils/index.js'
import { deepClone } from './clone.js'
import { inlinePseudoElements } from '../modules/pseudo.js'
import { inlineExternalDefsAndSymbols } from '../modules/svgDefs.js'
import { cache } from '../core/cache.js'
import { resolveBlobUrlsInTree } from '../utils/clone.helpers.js'
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
 * @returns {Promise<Object>} Object containing the clone, generated CSS, and style cache
 */

export async function prepareClone(element, options = {}) {
  const sessionCache = {
    styleMap: cache.session.styleMap,
    styleCache: cache.session.styleCache,
    nodeMap: cache.session.nodeMap,
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
  // prepend shadow CSS so variables/rules are available for everything
  classCSS = shadowScopedCSS + PSEUDO_SUPPRESS + classCSS

  for (const [node, key] of sessionCache.styleMap.entries()) {
    if (node.tagName === 'STYLE') continue
    /* c8 ignore next 4 */
    if (node.getRootNode && node.getRootNode() instanceof ShadowRoot) {
      node.setAttribute('style', key.replace(/;/g, '; '))
      continue
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

  // Re-anchor fixed/sticky clones to their painted position — in clip mode (the window is
  // what the user sees) and whenever the capture root is itself scrolled (stuck stickies
  // must freeze where they're stuck: header/footer/left-sidebar, horizontal included).
  // Must run after class application (the sticky placeholder inherits the twin's class)
  // and BEFORE the scrolled-container wrapper below — its fixed/absolute adjustment
  // (+scrollY) is what cancels the wrapper's translate for these now-absolute elements.
  if ((sessionCache.clip || element.scrollTop || element.scrollLeft) && clone instanceof Element) {
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
    const scrollX = originalNode.scrollLeft
    const scrollY = originalNode.scrollTop
    const hasScroll = scrollX || scrollY
    if (hasScroll && cloneNode instanceof HTMLElement) {
      cloneNode.style.overflow = 'hidden'
      cloneNode.style.scrollbarWidth = 'none'
      cloneNode.style.msOverflowStyle = 'none'

      // #364: Before wrapping with translate, adjust fixed/absolute descendants
      // so they don't shift when the translate wrapper creates a new containing block.
      try {
        const positioned = cloneNode.querySelectorAll('*')
        for (const child of positioned) {
          if (!(child instanceof HTMLElement)) continue
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
  return { clone, classCSS, styleCache: sessionCache.styleCache, clipWindow }
}

// helpers (stabilizeLayout, resolveBlobUrlsInTree) ahora vienen de utils; bloque antiguo eliminado.
