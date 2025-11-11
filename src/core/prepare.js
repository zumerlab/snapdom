/**
 * Prepares a deep clone of an element, inlining pseudo-elements and generating CSS classes.
 * @module prepare
 */

import { generateCSSClasses, stripTranslate } from '../utils/index.js'
import { deepClone } from './clone.js'
import { inlinePseudoElements } from '../modules/pseudo.js'
import { inlineExternalDefsAndSymbols } from '../modules/svgDefs.js'
import { cache } from '../core/cache.js'
import { freezeSticky } from '../modules/changeCSS.js'
import { resolveBlobUrlsInTree } from '../utils/clone.helpers.js'
import { stabilizeLayout } from '../utils/prepare.helpers.js'

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
    nodeMap: cache.session.nodeMap
  }

  let clone
  let classCSS = ''
  let shadowScopedCSS = ''

  stabilizeLayout(element)

  try {
    inlineExternalDefsAndSymbols(element)
  } catch (e) {
    console.warn('inlineExternal defs or symbol failed:', e)
  }

  try {
    clone = await deepClone(element, sessionCache, options, element)
  } catch (e) {
    console.warn('deepClone failed:', e)
    throw e
  }
  try {
    await inlinePseudoElements(element, clone, sessionCache, options)
  } catch (e) {
    console.warn('inlinePseudoElements failed:', e)
  }
  await resolveBlobUrlsInTree(clone)
  // --- Pull shadow-scoped CSS out of the clone (avoid visible CSS text) ---

  try {
    const styleNodes = clone.querySelectorAll('style[data-sd]')
    for (const s of styleNodes) {
      shadowScopedCSS += s.textContent || ''
      s.remove() // Do not leave <style> inside the visual clone
    }
  } catch { }

  const keyToClass = generateCSSClasses(sessionCache.styleMap)
  classCSS = Array.from(keyToClass.entries())
    .map(([key, className]) => `.${className}{${key}}`)
    .join('')

  // prepend shadow CSS so variables/rules are available for everything
  classCSS = shadowScopedCSS + classCSS

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

  for (const [cloneNode, originalNode] of sessionCache.nodeMap.entries()) {
    const scrollX = originalNode.scrollLeft
    const scrollY = originalNode.scrollTop
    const hasScroll = scrollX || scrollY
    if (hasScroll && cloneNode instanceof HTMLElement) {
      cloneNode.style.overflow = 'hidden'
      cloneNode.style.scrollbarWidth = 'none'
      cloneNode.style.msOverflowStyle = 'none'
      const inner = document.createElement('div')
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
  const contentRoot =
  (clone instanceof HTMLElement && clone.firstElementChild instanceof HTMLElement)
    ? clone.firstElementChild
    : clone

  // Congela header/footer: header => top = topInit + scrollTop
  //                        footer => bottom = bottomInit - scrollTop
  freezeSticky(element, contentRoot)

  if (element === sessionCache.nodeMap.get(clone)) {
    const computed = sessionCache.styleCache.get(element) || window.getComputedStyle(element)
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
  return { clone, classCSS, styleCache: sessionCache.styleCache }
}

// helpers (stabilizeLayout, resolveBlobUrlsInTree) ahora vienen de utils; bloque antiguo eliminado.
