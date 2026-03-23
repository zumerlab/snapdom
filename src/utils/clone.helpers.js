/**
 * Helper utilities for DOM cloning operations
 * @module utils/clone.helpers
 */

import { idle, debugWarn } from './index.js'
import { cache, EvictingMap } from '../core/cache.js'
import { snapFetch } from '../modules/snapFetch.js'
import { inlineAllStyles } from '../modules/styles.js'

/**
 * Schedule work across idle slices without relying on IdleDeadline constructor.
 * Falls back to setTimeout on browsers without requestIdleCallback.
 * @param {Node[]} childList
 * @param {(child: Node, done: () => void) => void} callback
 * @param {boolean} fast
 * @returns {Promise<(Node|null)[]>}
 */
export function idleCallback(childList, callback, fast) {
  return Promise.all(childList.map((child) => {
    return new Promise((resolve) => {
      function deal() {
        idle((deadline) => {
          // Safari iOS doesn't expose IdleDeadline constructor; duck-type it instead
          const hasIdleBudget = deadline && typeof deadline.timeRemaining === 'function'
            ? deadline.timeRemaining() > 0
            : true // setTimeout path or unknown object

          if (hasIdleBudget) {
            callback(child, resolve)
          } else {
            deal()
          }
        }, { fast })
      }
      deal()
    })
  }))
}

/**
 * Add :not([data-sd-slotted]) at the rightmost compound of a selector.
 * Very safe approximation: append at the end.
 */
function addNotSlottedRightmost(sel) {
  sel = sel.trim()
  if (!sel) return sel
  // Evitar duplicar si ya está
  if (/:not\(\s*\[data-sd-slotted\]\s*\)\s*$/.test(sel)) return sel
  return `${sel}:not([data-sd-slotted])`
}

/**
 * Wrap a selector list with :where(scope ...), lowering specificity to 0.
 * Optionally excludes slotted elements on the rightmost selector.
 */
function wrapWithScope(selectorList, scopeSelector, excludeSlotted = true) {
  return selectorList
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      // Si ya fue reescrito como :where(...), no lo toques
      if (s.startsWith(':where(')) return s

      // No toques @rules aquí (esto se hace en el caller)
      if (s.startsWith('@')) return s

      const body = excludeSlotted ? addNotSlottedRightmost(s) : s
      // Especificidad 0 para todo el selector:
      return `:where(${scopeSelector} ${body})`
    })
    .join(', ')
}

/**
 * Rewrite Shadow DOM selectors to a flat, host-scoped form with specificity 0.
 * - :host(.foo)           => :where([data-sd="sN"]:is(.foo))
 * - :host                 => :where([data-sd="sN"])
 * - ::slotted(X)          => :where([data-sd="sN"] X)              (no excluye sloteados)
 * - (resto, p.ej. .button)=> :where([data-sd="sN"] .button:not([data-sd-slotted]))
 * - :host-context(Y)      => :where(:where(Y) [data-sd="sN"])      (aprox)
 */
export function rewriteShadowCSS(cssText, scopeSelector) {
  if (!cssText) return ''

  // 1) :host(.foo) y :host
  cssText = cssText.replace(/:host\(([^)]+)\)/g, (_, sel) => {
    return `:where(${scopeSelector}:is(${sel.trim()}))`
  })
  cssText = cssText.replace(/:host\b/g, `:where(${scopeSelector})`)

  // 2) :host-context(Y)
  cssText = cssText.replace(/:host-context\(([^)]+)\)/g, (_, sel) => {
    return `:where(:where(${sel.trim()}) ${scopeSelector})`
  })

  // 3) ::slotted(X) → descendiente dentro del scope, sin excluir sloteados
  cssText = cssText.replace(/::slotted\(([^)]+)\)/g, (_, sel) => {
    return `:where(${scopeSelector} ${sel.trim()})`
  })

  // 4) Por cada bloque de selectores "suelto", envolver con :where(scope …)
  //    y excluir sloteados en el rightmost (:not([data-sd-slotted])).
  cssText = cssText.replace(/(^|})(\s*)([^@}{]+){/g, (_, brace, ws, selectorList) => {
    const wrapped = wrapWithScope(selectorList, scopeSelector, /*excludeSlotted*/ true)
    return `${brace}${ws}${wrapped}{`
  })

  return cssText
}

/**
 * Generate a unique shadow scope id for this session.
 * @param {{shadowScopeSeq?: number}} sessionCache
 * @returns {string} like "s1", "s2", ...
 */
export function nextShadowScopeId(sessionCache) {
  sessionCache.shadowScopeSeq = (sessionCache.shadowScopeSeq || 0) + 1
  return `s${sessionCache.shadowScopeSeq}`
}

/**
 * Extract CSS text from a ShadowRoot: inline <style> plus adoptedStyleSheets (if readable).
 * @param {ShadowRoot} sr
 * @returns {string}
 */
export function extractShadowCSS(sr) {
  let css = ''
  try {
    sr.querySelectorAll('style').forEach(s => { css += (s.textContent || '') + '\n' })
    // adoptedStyleSheets (may throw cross-origin; guard)
    const sheets = sr.adoptedStyleSheets || []
    for (const sh of sheets) {
      try {
        if (sh && sh.cssRules) {
          for (const rule of sh.cssRules) css += rule.cssText + '\n'
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return css
}

/**
 * Inject a <style> as the first child of `hostClone` with rewritten CSS.
 * @param {Element} hostClone
 * @param {string} cssText
 * @param {string} scopeId like s1
 */
export function injectScopedStyle(hostClone, cssText, scopeId) {
  if (!cssText) return
  const style = document.createElement('style')
  style.setAttribute('data-sd', scopeId)
  style.textContent = cssText
  // prepend to ensure it wins over later subtree
  hostClone.insertBefore(style, hostClone.firstChild || null)
}

/**
 * Freeze the responsive selection of an <img> that has srcset/sizes.
 * Copies a concrete URL into `src` and removes `srcset`/`sizes` so the clone
 * doesn't need layout to resolve a candidate.
 * Works with <picture> because currentSrc reflects the chosen source.
 * @param {HTMLImageElement} original - Image in the live DOM.
 * @param {HTMLImageElement} cloned - Just-created cloned <img>.
 */
export function freezeImgSrcset(original, cloned) {
  try {
    const chosen = original.currentSrc || original.src || ''
    if (!chosen) return
    cloned.setAttribute('src', chosen)
    cloned.removeAttribute('srcset')
    cloned.removeAttribute('sizes')
    // Hint deterministic decode/load for capture
    cloned.loading = 'eager'
    cloned.decoding = 'sync'
  } catch { }
}

/**
 * Collect all custom properties referenced via var(--foo) in a CSS string.
 * @param {string} cssText
 * @returns {Set<string>} e.g. new Set(['--o-fill','--o-gray-light'])
 */
export function collectCustomPropsFromCSS(cssText) {
  const out = new Set()
  if (!cssText) return out
  const re = /var\(\s*(--[A-Za-z0-9_-]+)\b/g
  let m
  while ((m = re.exec(cssText))) out.add(m[1])
  return out
}

/**
 * Resolve the cascaded value of a custom prop for an element.
 * Falls back to documentElement if empty.
 * @param {Element} el
 * @param {string} name like "--o-fill"
 * @returns {string} resolved token string or empty if unavailable
 */
function resolveCustomProp(el, name) {
  try {
    const cs = getComputedStyle(el)
    let v = cs.getPropertyValue(name).trim()
    if (v) return v
  } catch { }
  try {
    const rootCS = getComputedStyle(document.documentElement)
    let v = rootCS.getPropertyValue(name).trim()
    if (v) return v
  } catch { }
  return ''
}

/**
 * Build a seed rule that initializes given custom props on the scope.
 * Placed before the rewritten shadow CSS so later rules (e.g. :hover) can override.
 * @param {Element} hostEl
 * @param {Iterable<string>} names
 * @param {string} scopeSelector e.g. [data-sd="s3"]
 * @returns {string} CSS rule text (or "" if nothing to seed)
 */
export function buildSeedCustomPropsRule(hostEl, names, scopeSelector) {
  const decls = []
  for (const name of names) {
    const val = resolveCustomProp(hostEl, name)
    if (val) decls.push(`${name}: ${val};`)
  }
  if (!decls.length) return ''
  return `${scopeSelector}{${decls.join('')}}\n`
}

/**
 * Mark slotted subtree with data-sd-slotted attribute
 * @param {Node} root
 */
export function markSlottedSubtree(root) {
  if (!root) return
  if (root.nodeType === Node.ELEMENT_NODE) {
    root.setAttribute('data-sd-slotted', '')
  }
  // Marcar todos los descendientes elemento
  if (root.querySelectorAll) {
    root.querySelectorAll('*').forEach(el => el.setAttribute('data-sd-slotted', ''))
  }
}

/**
 * Wait for an accessible same-origin Document for a given <iframe>.
 * @param {HTMLIFrameElement} iframe
 * @param {number} [attempts=3]
 * @returns {Promise<Document|null>}
 */
export async function getAccessibleIframeDocument(iframe, attempts = 3) {
  const probe = () => {
    try { return iframe.contentDocument || iframe.contentWindow?.document || null } catch { return null }
  }
  let doc = probe()
  let i = 0
  while (i < attempts && (!doc || (!doc.body && !doc.documentElement))) {
    await new Promise(r => setTimeout(r, 0))
    doc = probe()
    i++
  }
  return doc && (doc.body || doc.documentElement) ? doc : null
}

/**
 * Compute the content-box size of an element (client rect minus borders).
 * @param {Element} el
 * @returns {{contentWidth:number, contentHeight:number, rect:DOMRect}}
 */
function measureContentBox(el) {
  const rect = el.getBoundingClientRect()
  let bl = 0, br = 0, bt = 0, bb = 0
  try {
    const cs = getComputedStyle(el)
    bl = parseFloat(cs.borderLeftWidth) || 0
    br = parseFloat(cs.borderRightWidth) || 0
    bt = parseFloat(cs.borderTopWidth) || 0
    bb = parseFloat(cs.borderBottomWidth) || 0
  } catch { }
  const contentWidth = Math.max(0, Math.round(rect.width - (bl + br)))
  const contentHeight = Math.max(0, Math.round(rect.height - (bt + bb)))
  return { contentWidth, contentHeight, rect }
}

/**
 * Get the unscaled dimensions of an element (pre-transform layout dimensions).
 * This function returns dimensions that do NOT include ancestor CSS transforms,
 * avoiding the double-scale bug where getBoundingClientRect() returns already-scaled
 * dimensions that then get scaled again by inherited transforms.
 *
 * Priority fallback chain:
 * 1. offsetWidth/offsetHeight (pre-transform layout dimensions)
 * 2. getComputedStyle() width/height
 * 3. getAttribute() width/height
 * 4. Intrinsic dimensions (naturalWidth/naturalHeight for images)
 *
 * @param {Element} el - The element to measure
 * @returns {{width: number, height: number}} Unscaled dimensions in pixels
 */
export function getUnscaledDimensions(el) {
  let width = 0
  let height = 0

  // Priority 1: offsetWidth/offsetHeight (pre-transform layout dimensions)
  if (el.offsetWidth > 0) width = el.offsetWidth
  if (el.offsetHeight > 0) height = el.offsetHeight

  // Priority 2: getComputedStyle() if offset dimensions not available
  if (width === 0 || height === 0) {
    try {
      const cs = getComputedStyle(el)
      if (width === 0) {
        const w = parseFloat(cs.width)
        if (!isNaN(w) && w > 0) width = w
      }
      if (height === 0) {
        const h = parseFloat(cs.height)
        if (!isNaN(h) && h > 0) height = h
      }
    } catch { }
  }

  // Priority 3: getAttribute() for hardcoded dimensions
  if (width === 0 || height === 0) {
    try {
      if (width === 0) {
        const w = parseFloat(el.getAttribute('width'))
        if (!isNaN(w) && w > 0) width = w
      }
      if (height === 0) {
        const h = parseFloat(el.getAttribute('height'))
        if (!isNaN(h) && h > 0) height = h
      }
    } catch { }
  }

  // Priority 4: Intrinsic dimensions (for images)
  if ((width === 0 || height === 0) && (el.naturalWidth || el.naturalHeight)) {
    try {
      if (width === 0 && el.naturalWidth > 0) width = el.naturalWidth
      if (height === 0 && el.naturalHeight > 0) height = el.naturalHeight
    } catch { }
  }

  return { width, height }
}

/**
 * Temporarily pin the iframe's internal viewport to (w, h) CSS px.
 * Injects a <style> into the iframe doc and returns a cleanup function.
 * @param {Document} doc
 * @param {number} w
 * @param {number} h
 * @returns {() => void}
 */
function pinIframeViewport(doc, w, h) {
  const style = doc.createElement('style')
  style.setAttribute('data-sd-iframe-pin', '')
  style.textContent = `html, body {margin: 0 !important;padding: 0 !important;width: ${w}px !important;height: ${h}px !important;min-width: ${w}px !important;min-height: ${h}px !important;box-sizing: border-box !important;overflow: hidden !important;background-clip: border-box !important;}`;
  (doc.head || doc.documentElement).appendChild(style)
  return () => { try { style.remove() } catch { } }
}

/**
 * Rasterize a same-origin iframe exactly at its content-box size, as the user requested:
 * - Capture iframe.contentDocument.documentElement
 * - Force a bitmap (toPng) sized to the iframe viewport (not the content height)
 * - Wrap with a styled container that mimics the <iframe> box (borders, radius, etc.)
 *
 * @param {HTMLIFrameElement} iframe
 * @param {object} sessionCache
 * @param {object} options
 * @returns {Promise<HTMLElement>}
 */
export async function rasterizeIframe(iframe, sessionCache, options) {
  const doc = await getAccessibleIframeDocument(iframe, 3)
  if (!doc) throw new Error('iframe document not accessible/ready')

  const { contentWidth, contentHeight, rect } = measureContentBox(iframe)

  // Prefer options.snap (set by main()); fallback to window.snapdom (IIFE build)
  let snap = options?.snap
  if (!snap && typeof window !== 'undefined' && window.snapdom) {
    snap = window.snapdom
  }
  if (!snap || typeof snap.toPng !== 'function') {
    throw new Error(
      '[snapdom] iframe capture requires snapdom.toPng. Use snapdom(el) or pass options.snap. ' +
      'With ESM, assign window.snapdom = snapdom after import if using iframes.'
    )
  }

  // Avoid double scaling; parent capture decides final scale
  const nested = { ...options, scale: 1 }

  // Pin viewport so body background fills exactly content box (fixes 400x110 → 400x150)
  const unpin = pinIframeViewport(doc, contentWidth, contentHeight)
  let imgEl
  try {
    imgEl = await snap.toPng(doc.documentElement, nested)
  } finally {
    unpin()
  }

  // Build <img> (bitmap) sized to content box
  imgEl.style.display = 'block'
  imgEl.style.width = `${contentWidth}px`
  imgEl.style.height = `${contentHeight}px`

  // Wrapper that preserves the iframe box (border, radius...) and clips
  const wrapper = document.createElement('div')
  sessionCache.nodeMap.set(wrapper, iframe)
  inlineAllStyles(iframe, wrapper, sessionCache, options)
  wrapper.style.overflow = 'hidden'
  wrapper.style.display = 'block'
  if (!wrapper.style.width) wrapper.style.width = `${Math.round(rect.width)}px`
  if (!wrapper.style.height) wrapper.style.height = `${Math.round(rect.height)}px`

  wrapper.appendChild(imgEl)
  return wrapper
}

// ========== Checkbox/Radio replacement (Firefox fix) ==========

/**
 * Creates a visual replacement for checkbox/radio inputs using inline SVG.
 * Firefox does not render native form controls inside SVG foreignObject; SVG-based
 * representation avoids CSS class conflicts and renders consistently.
 * @param {HTMLInputElement} node - Source input
 * @returns {{ el: HTMLDivElement, applyVisual: () => void }}
 */
export function createCheckboxRadioReplacement(node) {
  const { width: unscaledW, height: unscaledH } = getUnscaledDimensions(node)
  const rect = node.getBoundingClientRect()
  let cs
  try { cs = window.getComputedStyle(node) } catch { }
  const parsedW = cs ? parseFloat(cs.width) : NaN
  const parsedH = cs ? parseFloat(cs.height) : NaN
  const rw = Math.round(unscaledW || rect.width || 0)
  const rh = Math.round(unscaledH || rect.height || 0)
  let w = Number.isFinite(parsedW) && parsedW > 0 ? Math.round(parsedW) : Math.max(12, rw || 16)
  let h = Number.isFinite(parsedH) && parsedH > 0 ? Math.round(parsedH) : Math.max(12, rh || 16)
  const isCheckbox = (node.type || 'text').toLowerCase() === 'checkbox'
  const checked = !!node.checked
  const indeterminate = !!node.indeterminate

  const size = Math.max(Math.min(w, h), 12)
  const s = size

  // #311: preserve original vertical-align so the replacement doesn't shift inline layout
  let vAlign = 'middle'
  try { if (cs && cs.verticalAlign) vAlign = cs.verticalAlign } catch { }

  const box = document.createElement('div')
  box.setAttribute('data-snapdom-input-replacement', node.type || 'checkbox')
  box.style.cssText = `display:inline-block;width:${s}px;height:${s}px;vertical-align:${vAlign};flex-shrink:0;line-height:0;`
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', String(s))
  svg.setAttribute('height', String(s))
  svg.setAttribute('viewBox', `0 0 ${s} ${s}`)
  box.appendChild(svg)

  function applyVisual() {
    let color = '#0a6ed1'
    try {
      if (cs) color = cs.accentColor || cs.color || color
    } catch { }
    const stroke = 2
    const pad = stroke / 2
    const inner = s - stroke
    svg.innerHTML = ''
    if (isCheckbox) {
      const rectEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      rectEl.setAttribute('x', String(pad))
      rectEl.setAttribute('y', String(pad))
      rectEl.setAttribute('width', String(inner))
      rectEl.setAttribute('height', String(inner))
      rectEl.setAttribute('rx', '2')
      rectEl.setAttribute('ry', '2')
      rectEl.setAttribute('fill', checked ? color : 'none')
      rectEl.setAttribute('stroke', color)
      rectEl.setAttribute('stroke-width', String(stroke))
      svg.appendChild(rectEl)
      if (checked) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        path.setAttribute('d', `M ${pad + 2} ${s / 2} L ${s / 2 - 1} ${s - pad - 2} L ${s - pad - 2} ${pad + 2}`)
        path.setAttribute('stroke', 'white')
        path.setAttribute('stroke-width', String(Math.max(1.5, stroke)))
        path.setAttribute('fill', 'none')
        path.setAttribute('stroke-linecap', 'round')
        path.setAttribute('stroke-linejoin', 'round')
        svg.appendChild(path)
      } else if (indeterminate) {
        const dash = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
        const dw = Math.max(6, inner - 4)
        dash.setAttribute('x', String((s - dw) / 2))
        dash.setAttribute('y', String((s - stroke) / 2))
        dash.setAttribute('width', String(dw))
        dash.setAttribute('height', String(stroke))
        dash.setAttribute('fill', color)
        dash.setAttribute('rx', '1')
        svg.appendChild(dash)
      }
    } else {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      circle.setAttribute('cx', String(s / 2))
      circle.setAttribute('cy', String(s / 2))
      circle.setAttribute('r', String((s - stroke) / 2))
      circle.setAttribute('fill', checked ? color : 'none')
      circle.setAttribute('stroke', color)
      circle.setAttribute('stroke-width', String(stroke))
      svg.appendChild(circle)
      if (checked) {
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        const r = Math.max(2, (s - stroke * 2) * 0.35)
        dot.setAttribute('cx', String(s / 2))
        dot.setAttribute('cy', String(s / 2))
        dot.setAttribute('r', String(r))
        dot.setAttribute('fill', 'white')
        svg.appendChild(dot)
      }
    }
    // Force dimensions (inlineAllStyles may copy width:0 from native input)
    box.style.setProperty('width', `${s}px`, 'important')
    box.style.setProperty('height', `${s}px`, 'important')
    box.style.setProperty('min-width', `${s}px`, 'important')
    box.style.setProperty('min-height', `${s}px`, 'important')
  }
  applyVisual()
  return { el: box, applyVisual }
}

// ========== Blob URL Helpers ==========

var _blobToDataUrlCache = new EvictingMap(80)

/**
 * Read a blob: URL and return its data URL, with memoization + shared cache.
 * - Usa snapFetch(as:'dataURL') para convertir directo.
 * - Dedupea inflight guardando la promesa en el Map.
 * - Escribe también en cache.resource para reuso cross-módulo.
 * @param {string} blobUrl
 * @returns {Promise<string>} data URL
 */
export async function blobUrlToDataUrl(blobUrl) {
  // 1) Hit en cache global compartido
  if (cache.resource?.has(blobUrl)) return cache.resource.get(blobUrl)

  // 2) Hit en memo local (puede ser promesa o string resuelto)
  if (_blobToDataUrlCache.has(blobUrl)) return _blobToDataUrlCache.get(blobUrl)

  // 3) Crear promesa inflight y guardarla para dedupe
  const p = (async () => {
    const r = await snapFetch(blobUrl, { as: 'dataURL', silent: true })
    if (!r.ok || typeof r.data !== 'string') {
      throw new Error(`[snapDOM] Failed to read blob URL: ${blobUrl}`)
    }
    cache.resource?.set(blobUrl, r.data)   // cache compartido
    return r.data
  })()

  _blobToDataUrlCache.set(blobUrl, p)
  try {
    const data = await p
    // Opcional: reemplazar promesa por string ya resuelto (menos retenciones)
    _blobToDataUrlCache.set(blobUrl, data)
    return data
  } catch (e) {
    // Si falla, limpiamos para permitir reintentos futuros
    _blobToDataUrlCache.delete(blobUrl)
    throw e
  }
}

var BLOB_URL_RE = /\bblob:[^)"'\s]+/g

async function replaceBlobUrlsInCssText(cssText) {
  if (!cssText || cssText.indexOf('blob:') === -1) return cssText
  const uniques = Array.from(new Set(cssText.match(BLOB_URL_RE) || []))
  if (uniques.length === 0) return cssText
  let out = cssText
  for (const u of uniques) {
    try {
      const d = await blobUrlToDataUrl(u)
      out = out.split(u).join(d)
    } catch { }
  }
  return out
}

function isBlobUrl(u) {
  return typeof u === 'string' && u.startsWith('blob:')
}

function parseSrcset(srcset) {
  return (srcset || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const m = item.match(/^(\S+)(\s+.+)?$/)
      return m ? { url: m[1], desc: m[2] || '' } : null
    })
    .filter(Boolean)
}

function stringifySrcset(parts) {
  return parts.map((p) => (p.desc ? `${p.url} ${p.desc.trim()}` : p.url)).join(', ')
}

export async function resolveBlobUrlsInTree(root, sessionCache = null) {
  if (!root) return
  const ctx = sessionCache

  const imgs = root.querySelectorAll ? root.querySelectorAll('img') : []
  for (const img of imgs) {
    try {
      const srcAttr = img.getAttribute('src')
      const effective = srcAttr || img.currentSrc || ''
      if (isBlobUrl(effective)) {
        const data = await blobUrlToDataUrl(effective)
        img.setAttribute('src', data)
      }
      const srcset = img.getAttribute('srcset')
      if (srcset && srcset.includes('blob:')) {
        const parts = parseSrcset(srcset)
        let changed = false
        for (const p of parts) {
          if (isBlobUrl(p.url)) {
            try {
              p.url = await blobUrlToDataUrl(p.url)
              changed = true
            } catch (e) {
              debugWarn(ctx, 'blobUrlToDataUrl for srcset item failed', e)
            }
          }
        }
        if (changed) img.setAttribute('srcset', stringifySrcset(parts))
      }
    } catch (e) {
      debugWarn(ctx, 'resolveBlobUrls for img failed', e)
    }
  }

  const svgImages = root.querySelectorAll ? root.querySelectorAll('image') : []
  for (const node of svgImages) {
    try {
      const XLINK_NS = 'http://www.w3.org/1999/xlink'
      const href = node.getAttribute('href') || node.getAttributeNS?.(XLINK_NS, 'href')
      if (isBlobUrl(href)) {
        const d = await blobUrlToDataUrl(href)
        node.setAttribute('href', d)
        node.removeAttributeNS?.(XLINK_NS, 'href')
      }
    } catch (e) {
      debugWarn(ctx, 'resolveBlobUrls for SVG image href failed', e)
    }
  }

  const styled = root.querySelectorAll ? root.querySelectorAll("[style*='blob:']") : []
  for (const el of styled) {
    try {
      const styleText = el.getAttribute('style')
      if (styleText && styleText.includes('blob:')) {
        const replaced = await replaceBlobUrlsInCssText(styleText)
        el.setAttribute('style', replaced)
      }
    } catch (e) {
      debugWarn(ctx, 'replaceBlobUrls in inline style failed', e)
    }
  }

  const styleTags = root.querySelectorAll ? root.querySelectorAll('style') : []
  for (const s of styleTags) {
    try {
      const css = s.textContent || ''
      if (css.includes('blob:')) {
        s.textContent = await replaceBlobUrlsInCssText(css)
      }
    } catch (e) {
      debugWarn(ctx, 'replaceBlobUrls in style tag failed', e)
    }
  }

  const urlAttrs = ['poster']
  for (const attr of urlAttrs) {
    const nodes = root.querySelectorAll ? root.querySelectorAll(`[${attr}^='blob:']`) : []
    for (const n of nodes) {
      try {
        const u = n.getAttribute(attr)
        if (isBlobUrl(u)) {
          n.setAttribute(attr, await blobUrlToDataUrl(u))
        }
      } catch (e) {
        debugWarn(ctx, `resolveBlobUrls for ${attr} failed`, e)
      }
    }
  }
}
