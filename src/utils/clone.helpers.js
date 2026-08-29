/**
 * Helper utilities for DOM cloning operations
 * @module utils/clone.helpers
 */

import { debugWarn, getStyle } from './index.js'
import { cache, EvictingMap } from '../core/cache.js'
import { snapFetch } from '../modules/snapFetch.js'
import { inlineAllStyles } from '../modules/styles.js'
import { findRealUrlForPicture, pickSrcsetCandidate, findLazySrcAttr, isPlaceholderSrc } from '../modules/pictureResolver.js'

/** Add the current scope's slotted exclusion at the rightmost compound. */
function addNotSlottedRightmost(sel, scopeId) {
  sel = sel.trim()
  if (!sel) return sel
  const marker = scopeId ? `[data-sd-slotted~="${scopeId}"]` : '[data-sd-slotted]'
  if (sel.endsWith(':not([data-sd-slotted])') || sel.endsWith(`:not(${marker})`)) return sel
  return `${sel}:not(${marker})`
}

/**
 * Wrap a selector list with :where(scope ...), lowering specificity to 0.
 * Optionally excludes slotted elements on the rightmost selector.
 */
function wrapWithScope(selectorList, scopeSelector, excludeSlotted = true, scopeId) {
  return selectorList
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      // Already rewritten by THIS rewriter (it carries the scope attr): leave it alone.
      // An author's own :where() DOES need scoping; without this it leaked into the light DOM.
      if (s.startsWith(':where(') && s.includes('data-sd')) return s

      // Do not touch @rules here (the caller handles those)
      if (s.startsWith('@')) return s

      const body = excludeSlotted ? addNotSlottedRightmost(s, scopeId) : s
      // Zero specificity for the whole selector:
      return `:where(${scopeSelector} ${body})`
    })
    .join(', ')
}

/**
 * Rewrite Shadow DOM selectors to a flat, host-scoped form with specificity 0.
 * - :host(.foo)           => :where([data-sd="sN"]:is(.foo))
 * - :host                 => :where([data-sd="sN"])
 * - ::slotted(X)          => :where([data-sd="sN"] X)              (no excluye sloteados)
 * - (anything else, e.g. .button) => :where([data-sd="sN"] .button:not([data-sd-slotted~="sN"]))
 * - :host-context(Y)      => :where(:where(Y) [data-sd="sN"])      (aprox)
 */
export function rewriteShadowCSS(cssText, scopeSelector, scopeId) {
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

  // 3) ::slotted(X) -> a descendant inside the scope, without excluding slotted nodes
  cssText = cssText.replace(/::slotted\(([^)]+)\)/g, (_, sel) => {
    return `:where(${scopeSelector} ${sel.trim()})`
  })

  // 4) For every "loose" selector block, wrap it in :where(scope …) and exclude only the
  //    slotted nodes of THIS scope on the rightmost compound.
  cssText = cssText.replace(/(^|})(\s*)([^@}{]+){/g, (_, brace, ws, selectorList) => {
    const wrapped = wrapWithScope(selectorList, scopeSelector, /*excludeSlotted*/ true, scopeId)
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
 * Resolve @media at capture time: the serialized SVG is its own tiny viewport, so a
 * passed-through condition re-evaluates against the IMAGE size, not the page. Matching
 * blocks inline unwrapped (recursively), non-matching blocks drop — the capture freezes
 * the media state the user was seeing. @supports keeps its wrapper (its condition is
 * viewport-independent); @container/@keyframes/@font-face/etc. pass through verbatim
 * (@container evaluates against ancestor containers, which the foreignObject preserves —
 * it must be matched by TYPE, since it shares conditionText with @supports).
 * @param {CSSRuleList} rules
 * @returns {string}
 */
export function resolveMediaQueries(rules) {
  let out = ''
  for (const rule of rules) {
    if (rule.media && rule.cssRules) { // CSSMediaRule
      let matches = false
      try { matches = window.matchMedia(rule.conditionText || rule.media.mediaText).matches } catch { }
      if (matches) out += resolveMediaQueries(rule.cssRules)
    } else if (rule instanceof CSSSupportsRule) {
      out += `@supports ${rule.conditionText}{${resolveMediaQueries(rule.cssRules)}}`
    } else if (rule.cssRules && rule.cssRules.length && /@media/i.test(rule.cssText)) {
      // Any other rule that can NEST (a CSS-nesting style rule, @scope, @container): passing
      // its cssText through verbatim would carry an inner @media into the SVG, where the
      // condition re-evaluates against the image box instead of the page. Rebuild it so the
      // inner rules go through this same resolution.
      const head = rule.cssText.slice(0, rule.cssText.indexOf('{') + 1)
      out += head + (rule.style ? rule.style.cssText : '') + resolveMediaQueries(rule.cssRules) + '}'
    } else {
      out += rule.cssText + '\n'
    }
  }
  return out
}

/**
 * Extract CSS text from a ShadowRoot: inline <style> plus adoptedStyleSheets (if readable),
 * with @media resolved against the live viewport (see resolveMediaQueries).
 * @param {ShadowRoot} sr
 * @returns {string}
 */
export function extractShadowCSS(sr) {
  let css = ''
  try {
    sr.querySelectorAll('style').forEach(s => {
      let rules = null
      try { rules = s.sheet && s.sheet.cssRules } catch { /* unreadable */ }
      css += (rules ? resolveMediaQueries(rules) : (s.textContent || '')) + '\n'
    })
    // adoptedStyleSheets (may throw cross-origin; guard)
    const sheets = sr.adoptedStyleSheets || []
    for (const sh of sheets) {
      try {
        if (sh && sh.cssRules) css += resolveMediaQueries(sh.cssRules)
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
 * Works with <picture> because currentSrc reflects the chosen source — except
 * currentSrc resolves eagerly/synchronously in WebKit but is deferred past this point in
 * Chromium (confirmed: 5/5 runs froze the wrong, non-selected source under fast:true — the
 * default). Inside a <picture>, resolve the winning source explicitly via the same
 * media-query matching logic pictureResolver already uses instead of trusting an
 * unresolved currentSrc.
 * @param {HTMLImageElement} original - Image in the live DOM.
 * @param {HTMLImageElement} cloned - Just-created cloned <img>.
 */
export function freezeImgSrcset(original, cloned, options = {}) {
  try {
    // Element-level `content: url(...)` replaces the <img>'s rendered image and out-ranks
    // src/srcset in the browser's own resolution. The style snapshot neutralizes non-data
    // content URLs, so freeze the replacement image as the clone's src here.
    let contentUrl = null
    const rawContent = getStyle(original).content
    if (rawContent && rawContent.includes('url(')) {
      const m = rawContent.match(/url\(["']?([^"')]+)["']?\)/)
      if (m) contentUrl = m[1]
    }
    const picture = original.closest?.('picture')
    let chosen = contentUrl ||
      (picture ? findRealUrlForPicture(original, picture) : original.currentSrc) ||
      original.src ||
      // Chromium/Firefox leave currentSrc empty until the selected candidate has loaded,
      // so a srcset-only img would reach inlineImages source-less (srcset gets stripped
      // there). Pick a candidate explicitly, like the <picture> branch does.
      pickSrcsetCandidate(original.getAttribute('srcset'), original) || ''
    // Lazy-load placeholders (tiny data:/blob src with the real URL parked in data-src…):
    // resolve on the CLONE. The old live-DOM resolver swapped the user's element and
    // undid it afterwards — visible flicker and an undo dance for something inlineImages
    // fetches from the clone just as well.
    if ((!chosen || isPlaceholderSrc(chosen)) && options.resolvePicturePlaceholders !== false) {
      const lazy = findLazySrcAttr(original)
      if (lazy) chosen = lazy
    }
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
 * Mark a flattened slotted subtree with this shadow scope's token. Tokens compose when
 * nested slots are flattened, so parent CSS cannot pierce a child shadow tree while the
 * child's own CSS still applies to its internals (#488).
 * @param {Node} root
 * @param {string} [scopeId]
 */
export function markSlottedSubtree(root, scopeId) {
  if (!root) return
  const mark = (el) => {
    const value = el.getAttribute('data-sd-slotted') || ''
    if (!scopeId) {
      el.setAttribute('data-sd-slotted', value)
    } else if (!(` ${value} `).includes(` ${scopeId} `)) {
      el.setAttribute('data-sd-slotted', value ? `${value} ${scopeId}` : scopeId)
    }
  }
  if (root.nodeType === Node.ELEMENT_NODE) mark(root)
  root.querySelectorAll?.('*').forEach(mark)
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
 *
 * #393: `overflow: hidden` clamps the iframe's root scroll position to 0. Removing
 * the style later doesn't restore it, so the live iframe ends up scrolled to (0,0).
 * Snapshot scroll state before pinning and restore it after unpinning.
 *
 * #448: pinning body to (w, h) is what makes its background fill the content box
 * (the browser propagates body background to the viewport). But hard-zeroing body
 * margin/padding drops the content inset. Instead fold the original body margin into
 * its padding: body still fills the box (background propagation preserved) while the
 * content keeps its live offset from the viewport edge.
 *
 * @param {Document} doc
 * @param {number} w
 * @param {number} h
 * @returns {() => void}
 */
export function pinIframeViewport(doc, w, h) {
  const win = doc.defaultView
  const sx = win ? win.scrollX : 0
  const sy = win ? win.scrollY : 0
  const bsl = doc.body ? doc.body.scrollLeft : 0
  const bst = doc.body ? doc.body.scrollTop : 0
  const hsl = doc.documentElement ? doc.documentElement.scrollLeft : 0
  const hst = doc.documentElement ? doc.documentElement.scrollTop : 0

  // Fold body margin into padding so content keeps its live inset while body fills the box.
  let pt = 0, pr = 0, pb = 0, pl = 0
  try {
    const cs = win && doc.body ? win.getComputedStyle(doc.body) : null
    if (cs) {
      pt = (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.paddingTop) || 0)
      pr = (parseFloat(cs.marginRight) || 0) + (parseFloat(cs.paddingRight) || 0)
      pb = (parseFloat(cs.marginBottom) || 0) + (parseFloat(cs.paddingBottom) || 0)
      pl = (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.paddingLeft) || 0)
    }
  } catch { }

  // #449: flags the doc as viewport-pinned so captureDOM skips its full-page (scrollHeight) expansion
  try { doc.documentElement.setAttribute('data-sd-pinned', '') } catch { }

  const style = doc.createElement('style')
  style.setAttribute('data-sd-iframe-pin', '')
  style.textContent = `html {margin: 0 !important;padding: 0 !important;width: ${w}px !important;height: ${h}px !important;min-width: ${w}px !important;min-height: ${h}px !important;box-sizing: border-box !important;overflow: hidden !important;background-clip: border-box !important;}` +
    `body {margin: 0 !important;padding: ${pt}px ${pr}px ${pb}px ${pl}px !important;width: ${w}px !important;height: ${h}px !important;min-width: ${w}px !important;min-height: ${h}px !important;box-sizing: border-box !important;overflow: hidden !important;background-clip: border-box !important;}`;
  (doc.head || doc.documentElement).appendChild(style)

  // Pinning sets overflow:hidden on html/body, which resets the scroll offset — so a frame
  // the user had scrolled was captured from the top of its document instead of from what
  // they were looking at. Put the recorded offset back on whichever box now scrolls; the
  // nested capture's existing scrolled-root handling takes it from there.
  if (sx || sy) {
    try {
      if (doc.body) { doc.body.scrollLeft = sx; doc.body.scrollTop = sy }
      if (doc.documentElement) {
        if (!doc.documentElement.scrollLeft) doc.documentElement.scrollLeft = sx
        if (!doc.documentElement.scrollTop) doc.documentElement.scrollTop = sy
      }
    } catch { }
  }

  return () => {
    try { style.remove() } catch { }
    try { doc.documentElement.removeAttribute('data-sd-pinned') } catch { }
    try {
      if (win && typeof win.scrollTo === 'function') win.scrollTo(sx, sy)
      if (doc.body) { doc.body.scrollLeft = bsl; doc.body.scrollTop = bst }
      if (doc.documentElement) { doc.documentElement.scrollLeft = hsl; doc.documentElement.scrollTop = hst }
    } catch { }
  }
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

  // main() threads the capture entrypoints on the context (context.snap) — no global
  // window.snapdom dependency anymore. Direct captureDOM/deepClone callers must pass it.
  const snap = options?.snap
  if (!snap || typeof snap.toPng !== 'function') {
    throw new Error('[snapdom] iframe capture requires the snapdom entrypoints on options.snap — capture through snapdom(el) (set automatically) or pass options.snap.')
  }

  // Avoid double scaling; parent capture decides final scale. Drop clip: a visible iframe
  // is captured whole (offscreen ones were already culled), and 'viewport' would re-resolve
  // against the iframe's own window.
  const nested = { ...options, scale: 1, clip: null }

  // Pin viewport so body background fills exactly content box (fixes 400x110 → 400x150)
  const unpin = pinIframeViewport(doc, contentWidth, contentHeight)
  // Every capture owns its session from its first synchronous tick (createCaptureSession),
  // so the nested capture can't disturb this one's maps — no save/restore needed.
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
 * - Also writes to cache.resource so other modules can reuse it.
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

/**
 * querySelectorAll never matches the element it's called on, so a capture root that IS one of
 * these tags/attrs (e.g. `snapdom(imgEl)` where imgEl.src is a blob: URL) was silently skipped
 * — the early resolveBlobUrlsInTree pass missed it, and only the later idle-scheduled
 * inlineImages/inlineBackgroundImages passes picked it up, losing the race if the caller
 * revokes the object URL synchronously right after calling snapdom (see #461 for the same
 * shape in images.js).
 * @param {Element} root
 * @param {string} selector
 * @returns {Element[]}
 */
function selfAndDescendants(root, selector) {
  const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll(selector)) : []
  if (root.matches?.(selector)) nodes.unshift(root)
  return nodes
}

export async function resolveBlobUrlsInTree(root, sessionCache = null) {
  if (!root) return
  const ctx = sessionCache

  const imgs = selfAndDescendants(root, 'img')
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

  const svgImages = selfAndDescendants(root, 'image')
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

  const styled = selfAndDescendants(root, "[style*='blob:']")
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
    const nodes = selfAndDescendants(root, `[${attr}^='blob:']`)
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
