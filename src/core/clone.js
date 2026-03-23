/**
 * Deep cloning utilities for DOM elements, including styles and shadow DOM.
 * @module clone
 */

import { inlineAllStyles } from '../modules/styles.js'
import { NO_CAPTURE_TAGS } from '../utils/css.js'
import { resolveCSSVars } from '../modules/CSSVar.js'
import { debugWarn } from '../utils/index.js'
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
  rasterizeIframe,
  getUnscaledDimensions,
  createCheckboxRadioReplacement
} from '../utils/clone.helpers.js'
import { isFirefox } from '../utils/browser.js'

// helper implementations moved to ../utils/clone.helpers.js

export async function deepClone(node, sessionCache, options) {
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
      const { width, height } = getUnscaledDimensions(node)
      const w = width || node.getBoundingClientRect().width || 0
      const h = height || node.getBoundingClientRect().height || 0
      spacer.style.cssText = `display:inline-block;width:${w}px;height:${h}px;visibility:hidden;`
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
            const { width, height } = getUnscaledDimensions(node)
            const w = width || node.getBoundingClientRect().width || 0
            const h = height || node.getBoundingClientRect().height || 0
            spacer.style.cssText = `display:inline-block;width:${w}px;height:${h}px;visibility:hidden;`
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
          const { width, height } = getUnscaledDimensions(node)
          const w = width || node.getBoundingClientRect().width || 0
          const h = height || node.getBoundingClientRect().height || 0
          spacer.style.cssText = `display:inline-block;width:${w}px;height:${h}px;visibility:hidden;`
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
    try { sameOrigin = !!(node.contentDocument || node.contentWindow?.document) } catch (e) {
      debugWarn(sessionCache, 'iframe same-origin probe failed', e)
    }

    if (sameOrigin) {
      try {
        const wrapper = await rasterizeIframe(node, sessionCache, options)
        return wrapper
      } catch (err) {
        console.warn('[SnapDOM] iframe rasterization failed, fallback:', err)
        // fall through
      }
    }

    // NEW-7: warn that this iframe was skipped so callers can react
    if (!sameOrigin) {
      console.warn('[snapdom] cross-origin <iframe> skipped (cannot access content). Use options.placeholders to show a placeholder instead.', node)
    }

    // Fallback actual (placeholder o spacer)
    if (options.placeholders) {
      const { width, height } = getUnscaledDimensions(node)
      const fallback = document.createElement('div')
      fallback.style.cssText =
        `width:${width}px;height:${height}px;` +
        'background-image:repeating-linear-gradient(45deg,#ddd,#ddd 5px,#f9f9f9 5px,#f9f9f9 10px);' +
        'display:flex;align-items:center;justify-content:center;font-size:12px;color:#555;border:1px solid #aaa;'
      inlineAllStyles(node, fallback, sessionCache, options)
      return fallback
    } else {
      const { width, height } = getUnscaledDimensions(node)
      const spacer = document.createElement('div')
      spacer.style.cssText = `display:inline-block;width:${width}px;height:${height}px;visibility:hidden;`
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
    } catch (e) {
      debugWarn(sessionCache, 'Canvas toDataURL failed, using empty/fallback', e)
    }

    const img = document.createElement('img')
    try { img.decoding = 'sync'; img.loading = 'eager' } catch (e) {
      debugWarn(sessionCache, 'img decoding/loading hints failed', e)
    }
    if (url) img.src = url

    // conservar dimensiones intrínsecas del bitmap
    img.width = node.width
    img.height = node.height

    // conservar caja CSS para no romper layout usando dimensiones pre-transform
    const { width, height } = getUnscaledDimensions(node)
    if (width > 0) img.style.width = `${width}px`
    if (height > 0) img.style.height = `${height}px`

    sessionCache.nodeMap.set(img, node)
    inlineAllStyles(node, img, sessionCache, options)
    return img
  }

  if (node.tagName === 'VIDEO') {
    let url = ''
    try {
      const canvas = document.createElement('canvas')
      canvas.width = node.videoWidth || node.offsetWidth || 320
      canvas.height = node.videoHeight || node.offsetHeight || 240
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(node, 0, 0, canvas.width, canvas.height)
        url = canvas.toDataURL('image/png')
        // blank canvas = cross-origin or no frame loaded
        if (!url || url === 'data:,') url = ''
      }
    } catch (e) {
      debugWarn(sessionCache, 'Video frame capture failed, using poster fallback', e)
    }

    const img = document.createElement('img')
    try { img.decoding = 'sync'; img.loading = 'eager' } catch {}
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
    img.style.objectFit = 'contain'

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
      // Record original image dimensions (pre-transform) for fallback usage when inlining fails
      try {
        const { width, height } = getUnscaledDimensions(node)
        const w = Math.round(width || 0)
        const h = Math.round(height || 0)
        if (w) clone.dataset.snapdomWidth = String(w)
        if (h) clone.dataset.snapdomHeight = String(h)
      } catch (e) {
        debugWarn(sessionCache, 'getUnscaledDimensions for IMG failed', e)
      }

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

        // #337: Preserve object-fit and object-position for correct image proportions
        const objectFit = cs.getPropertyValue('object-fit')
        const objectPosition = cs.getPropertyValue('object-position')
        if (objectFit && objectFit !== 'fill') {
          clone.style.objectFit = objectFit
          if (objectPosition) clone.style.objectPosition = objectPosition
          // When object-fit is active, minWidth/minHeight can distort the image
          // Only set min dimensions if no object-fit override is in play
        } else {
          // Blindaje extra: evita que una clase agregada luego anule el fix
          if (w) clone.style.minWidth = `${w}px`
          if (h) clone.style.minHeight = `${h}px`
        }
      } catch (e) {
        debugWarn(sessionCache, 'IMG dimension freeze failed', e)
      }

    }
  } catch (err) {
    console.error('[Snapdom] Failed to clone node:', node, err)
    throw err
  }
  let applyInputVisual = null
  if (node instanceof HTMLTextAreaElement) {
    const { width, height } = getUnscaledDimensions(node)
    const w = width || node.getBoundingClientRect().width || 0
    const h = height || node.getBoundingClientRect().height || 0
    if (w) clone.style.width = `${w}px`
    if (h) clone.style.height = `${h}px`
  }
  if (node instanceof HTMLInputElement) {
    const type = (node.type || 'text').toLowerCase()
    const isCheckboxOrRadio = type === 'checkbox' || type === 'radio'
    if (isCheckboxOrRadio && isFirefox()) {
      const { el: replacement, applyVisual } = createCheckboxRadioReplacement(node)
      sessionCache.nodeMap.set(replacement, node)
      applyInputVisual = applyVisual
      clone = replacement
    } else {
      clone.value = node.value
      clone.setAttribute('value', node.value)
      if (node.checked !== void 0) {
        clone.checked = node.checked
        if (node.checked) clone.setAttribute('checked', '')
        if (node.indeterminate) clone.indeterminate = node.indeterminate
      }
    }
  }
  // #315: Preserve ::placeholder color for inputs/textareas showing placeholder text
  if ((node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) && !node.value && node.placeholder) {
    try {
      const phStyle = window.getComputedStyle(node, '::placeholder')
      const phColor = phStyle && phStyle.color
      if (phColor && phColor !== 'rgba(0, 0, 0, 0)') {
        const uid = 'snapdom-ph-' + (Math.random() * 1e6 | 0)
        clone.classList.add(uid)
        const styleEl = document.createElement('style')
        styleEl.textContent = `.${uid}::placeholder{color:${phColor}!important;opacity:${phStyle.opacity || '1'}!important;}`
        clone.prepend(styleEl)
      }
    } catch { /* non-blocking */ }
  }
  if (node instanceof HTMLSelectElement) {
    pendingSelectValue = node.value
  }
  if (node instanceof HTMLTextAreaElement) {
    pendingTextAreaValue = node.value
  }
  inlineAllStyles(node, clone, sessionCache, options)
  if (applyInputVisual) { applyInputVisual() }
  // #365: SVG painting elements — CSS rules override presentation attributes but aren't captured
  // via the class-based mechanism (NO_DEFAULTS_TAGS returns '' key). Copy key SVG presentation
  // properties from computed style as inline styles to ensure CSS-driven fills/strokes survive.
  if (node instanceof SVGElement) {
    const SVG_PAINT_PROPS = [
      'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset',
      'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'opacity',
      'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule',
      'marker', 'marker-start', 'marker-mid', 'marker-end', 'visibility', 'display'
    ]
    try {
      const cs = window.getComputedStyle(node)
      for (const prop of SVG_PAINT_PROPS) {
        const val = cs.getPropertyValue(prop)
        if (val) clone.style.setProperty(prop, val)
      }
    } catch { }
  }
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
