/**
 * Deep cloning utilities for DOM elements, including styles and shadow DOM.
 * @module clone
 */

import { inlineAllStyles } from '../modules/styles.js'
import { NO_CAPTURE_TAGS } from '../utils/css.js'
import { resolveCSSVars } from '../modules/CSSVar.js'
import {
  idleCallback,
  rewriteShadowCSS,
  nextShadowScopeId,
  extractShadowCSS,
  injectScopedStyle,
  freezeImgSrcset,
  collectCustomPropsFromCSS,
  buildSeedCustomPropsRule,
  markSlottedSubtree,
  rasterizeIframe
} from '../utils/clone.helpers.js'
import { inlinePseudoElements } from '../modules/pseudo.js'

// helper implementations moved to ../utils/clone.helpers.js

async function _deepClone(node, sessionCache, options) {
  if (!node) throw new Error('Invalid node')
  const clonedAssignedNodes = new Set()
  let pendingSelectValue = null
  let pendingTextAreaValue = null
  if (node.nodeType === Node.ELEMENT_NODE) {
    const tag = (node.localName || node.tagName || '').toLowerCase()
    if (node.id === 'snapdom-sandbox' || node.hasAttribute('data-snapdom-sandbox')) {
      return null
    }
    if (NO_CAPTURE_TAGS.has(tag)) {
      return null
    }
  }
  if (node.nodeType === Node.TEXT_NODE) {
    return node.cloneNode(true)
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return node.cloneNode(true)
  }
  if (node.getAttribute('data-capture') === 'exclude') {
    if (options.excludeMode === 'hide') {
      const spacer = document.createElement('div')
      const rect = node.getBoundingClientRect()
      spacer.style.cssText = `display:inline-block;width:${rect.width}px;height:${rect.height}px;visibility:hidden;`
      return spacer
    } else if (options.excludeMode === 'remove') {
      return null
    }
  }
  if (options.exclude && Array.isArray(options.exclude)) {
    for (const selector of options.exclude) {
      try {
        if (node.matches?.(selector)) {
          if (options.excludeMode === 'hide') {
            const spacer = document.createElement('div')
            const rect = node.getBoundingClientRect()
            spacer.style.cssText = `display:inline-block;width:${rect.width}px;height:${rect.height}px;visibility:hidden;`
            return spacer
          } else if (options.excludeMode === 'remove') {
            return null
          }
        }
      } catch (err) {
        console.warn(`Invalid selector in exclude option: ${selector}`, err)
      }
    }
  }
  if (typeof options.filter === 'function') {
    try {
      if (!options.filter(node)) {
        if (options.filterMode === 'hide') {
          const spacer = document.createElement('div')
          const rect = node.getBoundingClientRect()
          spacer.style.cssText = `display:inline-block;width:${rect.width}px;height:${rect.height}px;visibility:hidden;`
          return spacer
        } else if (options.filterMode === 'remove') {
          return null
        }
      }
    } catch (err) {
      console.warn('Error in filter function:', err)
    }
  }
  if (node.tagName === 'IFRAME') {
    let sameOrigin = false
    try { sameOrigin = !!(node.contentDocument || node.contentWindow?.document) } catch { sameOrigin = false }

    if (sameOrigin) {
      try {
        const wrapper = await rasterizeIframe(node, sessionCache, options)
        return wrapper
      } catch (err) {
        console.warn('[SnapDOM] iframe rasterization failed, fallback:', err)
        // fall through
      }
    }

    // Fallback actual (placeholder o spacer)
    if (options.placeholders) {
      const fallback = document.createElement('div')
      fallback.style.cssText =
        `width:${node.offsetWidth}px;height:${node.offsetHeight}px;` +
        'background-image:repeating-linear-gradient(45deg,#ddd,#ddd 5px,#f9f9f9 5px,#f9f9f9 10px);' +
        'display:flex;align-items:center;justify-content:center;font-size:12px;color:#555;border:1px solid #aaa;'
      inlineAllStyles(node, fallback, sessionCache, options)
      return fallback
    } else {
      const rect = node.getBoundingClientRect()
      const spacer = document.createElement('div')
      spacer.style.cssText = `display:inline-block;width:${rect.width}px;height:${rect.height}px;visibility:hidden;`
      inlineAllStyles(node, spacer, sessionCache, options)
      return spacer
    }
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
  if (node.tagName === 'CANVAS') {
    // Safari-safe snapshot: poke + rAF + retry + scratch fallback
    let url = ''
    try {
      const ctx = node.getContext('2d', { willReadFrequently: true })
      try { ctx && ctx.getImageData(0, 0, 1, 1) } catch { }
      await new Promise(r => requestAnimationFrame(r)) // deja materializar el frame

      url = node.toDataURL('image/png')

      if (!url || url === 'data:,') {
        // reintento rápido
        try { ctx && ctx.getImageData(0, 0, 1, 1) } catch { }
        await new Promise(r => requestAnimationFrame(r))
        url = node.toDataURL('image/png')

        // último recurso: copiar a un scratch-canvas y leer desde ahí
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
    } catch { }

    const img = document.createElement('img')
    try { img.decoding = 'sync'; img.loading = 'eager' } catch { }
    if (url) img.src = url

    // conservar dimensiones intrínsecas del bitmap
    img.width = node.width
    img.height = node.height

    // conservar caja CSS para no romper layout
    try {
      const cs = getComputedStyle(node)
      if (cs.width) img.style.width = cs.width
      if (cs.height) img.style.height = cs.height
    } catch { }

    sessionCache.nodeMap.set(img, node)
    inlineAllStyles(node, img, sessionCache, options)
    return img
  }

  let clone
  try {
    clone = node.cloneNode(false)
    resolveCSSVars(node, clone)
    sessionCache.nodeMap.set(clone, node)
    if (node.tagName === 'IMG') {
      freezeImgSrcset(node, clone)
      // Record original image dimensions for fallback usage when inlining fails
      try {
        const rect = node.getBoundingClientRect()
        let w = Math.round(rect.width || 0)
        let h = Math.round(rect.height || 0)
        if (!w || !h) {
          const computed = window.getComputedStyle(node)
          const cssW = parseFloat(computed.width) || 0
          const cssH = parseFloat(computed.height) || 0
          const attrW = parseInt(node.getAttribute('width') || '', 10) || 0
          const attrH = parseInt(node.getAttribute('height') || '', 10) || 0
          const propW = node.width || node.naturalWidth || 0
          const propH = node.height || node.naturalHeight || 0
          w = Math.round(w || cssW || attrW || propW || 0)
          h = Math.round(h || cssH || attrH || propH || 0)
        }
        if (w) clone.dataset.snapdomWidth = String(w)
        if (h) clone.dataset.snapdomHeight = String(h)
      } catch { }

      // Si el autor usó % o auto, o el alto/ ancho efectivos dan 0,
      // escribimos px en línea para evitar que el clon “pierda” la imagen.
      try {
        const authored = node.getAttribute('style') || ''
        const cs = window.getComputedStyle(node)
        const usesPercentOrAuto = (prop) => {
          const a = authored.match(new RegExp(`${prop}\\s*:\\s*([^;]+)`, 'i'))
          const v = a ? a[1].trim() : cs.getPropertyValue(prop)
          return /%|auto/i.test(String(v || ''))
        }

        const w = parseInt(clone.dataset.snapdomWidth || '0', 10)
        const h = parseInt(clone.dataset.snapdomHeight || '0', 10)

        const needFreezeW = usesPercentOrAuto('width') || !w
        const needFreezeH = usesPercentOrAuto('height') || !h

        if (needFreezeW && w) clone.style.width = `${w}px`
        if (needFreezeH && h) clone.style.height = `${h}px`

        // Blindaje extra: evita que una clase agregada luego anule el fix
        if (w) clone.style.minWidth = `${w}px`
        if (h) clone.style.minHeight = `${h}px`
      } catch { }

    }
  } catch (err) {
    console.error('[Snapdom] Failed to clone node:', node, err)
    throw err
  }
  if (node instanceof HTMLTextAreaElement) {
    const rect = node.getBoundingClientRect()
    clone.style.width = `${rect.width}px`
    clone.style.height = `${rect.height}px`
  }
  if (node instanceof HTMLInputElement) {
    clone.value = node.value
    clone.setAttribute('value', node.value)
    if (node.checked !== void 0) {
      clone.checked = node.checked
      if (node.checked) clone.setAttribute('checked', '')
      if (node.indeterminate) clone.indeterminate = node.indeterminate
    }
  }
  if (node instanceof HTMLSelectElement) {
    pendingSelectValue = node.value
  }
  if (node instanceof HTMLTextAreaElement) {
    pendingTextAreaValue = node.value
  }
  inlineAllStyles(node, clone, sessionCache, options)
  if (node.shadowRoot) {
    try {
      const slots = node.shadowRoot.querySelectorAll('slot')
      for (const s of slots) {
        let assigned = []
        try {
          assigned = s.assignedNodes?.({ flatten: true }) || s.assignedNodes?.() || []
        } catch {
          assigned = s.assignedNodes?.() || []
        }
        for (const an of assigned) clonedAssignedNodes.add(an)
      }
    } catch {
    }
    const scopeId = nextShadowScopeId(sessionCache)
    const scopeSelector = `[data-sd="${scopeId}"]`
    try {
      clone.setAttribute('data-sd', scopeId)
    } catch {
    }
    const rawCSS = extractShadowCSS(node.shadowRoot)
    const rewritten = rewriteShadowCSS(rawCSS, scopeSelector)
    const neededVars = collectCustomPropsFromCSS(rawCSS)
    const seed = buildSeedCustomPropsRule(node, neededVars, scopeSelector)
    injectScopedStyle(clone, seed + rewritten, scopeId)
    const shadowFrag = document.createDocumentFragment()
    function callback(child, resolve) {
      if (child.nodeType === Node.ELEMENT_NODE && child.tagName === 'STYLE') {
        return resolve(null)
      } else {
        deepClone(child, sessionCache, options).then((clonedChild) => {
          resolve(clonedChild || null)
        }).catch(() => {
          resolve(null)
        })
      }
    }

    const cloneList = await idleCallback(Array.from(node.shadowRoot.childNodes), callback, options.fast)
    shadowFrag.append(...cloneList.filter(clonedChild => !!clonedChild))
    clone.appendChild(shadowFrag)
  }
  if (node.tagName === 'SLOT') {
    const assigned = node.assignedNodes?.({ flatten: true }) || []
    const nodesToClone = assigned.length > 0 ? assigned : Array.from(node.childNodes)
    const fragment = document.createDocumentFragment()

    function callback(child, resolve) {
      deepClone(child, sessionCache, options).then((clonedChild) => {
        if (clonedChild) {
          markSlottedSubtree(clonedChild)
        }
        resolve(clonedChild || null)
      }).catch(() => {
        resolve(null)
      })
    }
    const cloneList = await idleCallback(Array.from(nodesToClone), callback, options.fast)
    fragment.append(...cloneList.filter(clonedChild => !!clonedChild))
    return fragment
  }

  function callback(child, resolve) {
    if (clonedAssignedNodes.has(child)) return resolve(null)
    deepClone(child, sessionCache, options).then((clonedChild) => {
      resolve(clonedChild || null)
    }).catch(() => {
      resolve(null)
    })
  }
  const cloneList = await idleCallback(Array.from(node.childNodes), callback, options.fast)
  clone.append(...cloneList.filter(clonedChild => !!clonedChild))

  // Adjust select value after children are cloned
  if (pendingSelectValue !== null && clone instanceof HTMLSelectElement) {
    clone.value = pendingSelectValue
    for (const opt of clone.options) {
      if (opt.value === pendingSelectValue) {
        opt.setAttribute('selected', '')
      } else {
        opt.removeAttribute('selected')
      }
    }
  }
  if (pendingTextAreaValue !== null && clone instanceof HTMLTextAreaElement) {
    clone.textContent = pendingTextAreaValue

  }
  return clone
}

export async function deepClone(node, sessionCache, options) {
  const clone = await _deepClone(node, sessionCache, options)
  if (clone) {
    try {
      await inlinePseudoElements(node, clone, sessionCache, options)
    } catch (e) {
      console.warn('inlinePseudoElements failed:', e)
    }
  }
  return clone
}
