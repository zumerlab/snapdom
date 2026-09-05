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
import { nextFrame } from '../utils/browser.js'
import { seedUsedProps } from '../modules/styles.js'

const visibilityWarmups = new Set()

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
  // Prefer the snapshot captureDOM took synchronously at capture start — cache.session may
  // belong to a different in-flight capture by the time this runs (see capture.js).
  const session = options.__session || cache.session
  const sessionCache = {
    styleMap: session.styleMap,
    styleCache: session.styleCache,
    nodeMap: session.nodeMap,
    tagSet: new Set(),
    shadowStyleNodes: [],
    imgClones: [],
    svgImageClones: [],
    bgClones: [],
    blobNodes: [],
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

  // CSSOM fingerprint + allow-list seeding must happen at capture start, before any
  // computed-style reads, so insertRule/deleteRule/replaceSync/adoptedStyleSheets
  // changes are visible even though they do not fire MutationObserver.
  try { seedUsedProps(element) } catch {}

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
    // walk-fusion: reuse shadow style nodes collected during deepClone (avoids querySelectorAll)
    const styleNodes = (sessionCache.shadowStyleNodes && sessionCache.shadowStyleNodes.length)
      ? sessionCache.shadowStyleNodes
      : (clone.querySelectorAll ? clone.querySelectorAll('style[data-sd]') : [])
    for (const s of styleNodes) {
      shadowScopedCSS += s.textContent || ''
      try { s.remove() } catch {}
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
  if ((sessionCache.clip || element.scrollTop || element.scrollLeft) && clone?.nodeType === 1) {
    try {
      const edge = sessionCache.clip && clipWindow ? { x: clipWindow.x, y: clipWindow.y } : { x: 0, y: 0 }
      freezeViewportPositioned(element, clone, sessionCache.nodeMap, sessionCache.styleCache, edge)
    } catch (e) {
      debugWarn(sessionCache, 'freezeViewportPositioned failed', e)
    }
  }

  // Walk-fusion + O(n) fix: collect scrolled nodes once, create wrappers, then
  // adjust positioned descendants in a single tree walk (see below). Formerly
  // each scrolled node did cloneNode.querySelectorAll('*') → O(n·s).
  const _scrolledMap = new Map()
  const _scrolledNodes = []
  for (const [cloneNode, originalNode] of sessionCache.nodeMap.entries()) {
    if (sessionCache.clip && originalNode === element) continue
    const scrollX = originalNode.scrollLeft
    const scrollY = originalNode.scrollTop
    if ((scrollX || scrollY) && cloneNode?.nodeType === 1 && cloneNode.namespaceURI === 'http://www.w3.org/1999/xhtml') {
      cloneNode.style.overflow = 'hidden'
      cloneNode.style.scrollbarWidth = 'none'
      cloneNode.style.msOverflowStyle = 'none'
      _scrolledMap.set(cloneNode, { x: scrollX, y: scrollY })
      _scrolledNodes.push(cloneNode)
      const inner = document.createElement('div')
      inner.style.all = 'unset'
      inner.style.transform = `translate(${-scrollX}px, ${-scrollY}px)`
      inner.style.willChange = 'transform'
      inner.style.display = 'inline-block'
      inner.style.width = '100%'
      while (cloneNode.firstChild) inner.appendChild(cloneNode.firstChild)
      cloneNode.appendChild(inner)
    }
  }
  // Single-pass positioned fix: ONE tree walk threads a running accumulator of
  // scrolled-ancestor offsets (O(n) total) instead of querySelectorAll('*') plus
  // a per-element ancestor walk (O(n·depth)). For each fixed/absolute XHTML
  // descendant, addX/addY = sum of _scrolledMap offsets over every ancestor up to
  // and including the clone root — identical to the old ancestor walk. The clone
  // root itself is never a candidate (querySelectorAll('*') returns descendants
  // only), but its own offset seeds the accumulator so descendants include it.
  if (_scrolledMap.size && clone?.nodeType === 1) {
    try {
      const XHTML = 'http://www.w3.org/1999/xhtml'
      const rootS = _scrolledMap.get(clone)
      let startX = 0, startY = 0
      if (rootS) { startX = rootS.x; startY = rootS.y }
      const stack = []
      for (const child of clone.children) stack.push([child, startX, startY])
      while (stack.length) {
        const [node, accX, accY] = stack.pop()
        if (node.namespaceURI === XHTML) {
          const pos = node.style.position
          if (pos === 'fixed' || pos === 'absolute') {
            if (accX || accY) {
              const curTop = parseFloat(node.style.top) || 0
              const curLeft = parseFloat(node.style.left) || 0
              node.style.top = `${curTop + accY}px`
              node.style.left = `${curLeft + accX}px`
              if (pos === 'fixed') node.style.position = 'absolute'
            }
          }
        }
        const s = _scrolledMap.get(node)
        const childAccX = accX + (s ? s.x : 0)
        const childAccY = accY + (s ? s.y : 0)
        for (let i = node.children.length - 1; i >= 0; i--) {
          stack.push([node.children[i], childAccX, childAccY])
        }
      }
    } catch { /* non-blocking */ }
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
  // attach collected interest lists to clone for walk-fusion consumers (assets, etc.)
  if (clone) {
    clone._snapdomCollect = {
      imgClones: sessionCache.imgClones,
      svgImageClones: sessionCache.svgImageClones,
      bgClones: sessionCache.bgClones,
      blobNodes: sessionCache.blobNodes,
    }
  }
  return {
    clone,
    classCSS,
    styleCache: sessionCache.styleCache,
    nodeMap: sessionCache.nodeMap,
    tagSet: sessionCache.tagSet,
    imgClones: sessionCache.imgClones,
    svgImageClones: sessionCache.svgImageClones,
    bgClones: sessionCache.bgClones,
    blobNodes: sessionCache.blobNodes,
    reconcileRisk: sessionCache.reconcileRisk || 0,
    clipWindow,
  }
}

// helpers (stabilizeLayout, resolveBlobUrlsInTree) ahora vienen de utils; bloque antiguo eliminado.
