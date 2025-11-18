/**
 * Helper utilities for DOM capture operations
 * @module utils/capture.helpers
 */

/**
 * Strip shadow-like visuals on the CLONE ROOT ONLY (box/text-shadow, outline, blur()/drop-shadow()).
 * Children remain intact.
 * @param {Element} originalEl
 * @param {HTMLElement} cloneRoot
 */
export function stripRootShadows(originalEl, cloneRoot) {
  if (!originalEl || !cloneRoot || !cloneRoot.style) return
  const cs = getComputedStyle(originalEl)
  try { cloneRoot.style.boxShadow = 'none' } catch { }
  try { cloneRoot.style.textShadow = 'none' } catch { }
  try { cloneRoot.style.outline = 'none' } catch { }
  const f = cs.filter || ''
  const cleaned = f
    .replace(/\bblur\([^()]*\)\s*/gi, '')
    .replace(/\bdrop-shadow\([^()]*\)\s*/gi, '')
    .trim()
    .replace(/\s+/g, ' ')
  try { cloneRoot.style.filter = cleaned.length ? cleaned : 'none' } catch { }
}

/** Remove all HTML comments (prevents invalid XML like "--") */
export function removeAllComments(root) {
  const it = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT)
  const toRemove = []
  while (it.nextNode()) toRemove.push(it.currentNode)
  for (const n of toRemove) n.remove()
}

/**
 * Sanitize attributes to produce valid XHTML inside foreignObject.
 * - Drop "@", unknown ":" prefixes
 * - Drop common framework directives (x-*, v-*, :*, on:*, bind:*, let:*, class:*)
 */
export function sanitizeAttributesForXHTML(root, opts = {}) {
  const { stripFrameworkDirectives = true } = opts
  const ALLOWED_PREFIXES = new Set(['xml', 'xlink'])

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  while (walker.nextNode()) {
    const el = walker.currentNode
    // Copy first—NamedNodeMap is live
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name

      // "@": never valid in XML attribute names
      if (name.includes('@')) { el.removeAttribute(name); continue }

      // ":" requires a declared namespace (xml:, xlink:)
      if (name.includes(':')) {
        const prefix = name.split(':', 1)[0]
        if (!ALLOWED_PREFIXES.has(prefix)) { el.removeAttribute(name); continue }
      }

      if (!stripFrameworkDirectives) continue

      // Common framework directives that break XHTML
      if (
        name.startsWith('x-') ||     // Alpine
        name.startsWith('v-') ||     // Vue
        name.startsWith(':') ||      // Vue/Alpine shorthand
        name.startsWith('on:') ||    // Svelte
        name.startsWith('bind:') ||  // Svelte
        name.startsWith('let:') ||   // Svelte
        name.startsWith('class:')    // Svelte
      ) {
        el.removeAttribute(name)
        continue
      }
    }
  }
}

export function sanitizeCloneForXHTML(root, opts = {}) {
  if (!root) return
  sanitizeAttributesForXHTML(root, opts)
  removeAllComments(root)
}

/**
 * Returns true if the author explicitly set any size inline on the source element.
 * We avoid overriding author-intended sizing.
 * @param {Element} el
 */
function authorHasExplicitSize(el) {
  try {
    const s = el.getAttribute?.('style') || ''
    return /\b(height|width|block-size|inline-size)\s*:/.test(s)
  } catch { return false }
}

/**
 * Replaced elements (img, canvas, video, iframe, svg, object, embed) have intrinsic sizing;
 * we do not auto-shrink them here.
 * @param {Element} el
 */
function isReplacedElement(el) {
  return el instanceof HTMLImageElement ||
    el instanceof HTMLCanvasElement ||
    el instanceof HTMLVideoElement ||
    el instanceof HTMLIFrameElement ||
    el instanceof SVGElement ||
    el instanceof HTMLObjectElement ||
    el instanceof HTMLEmbedElement
}

/**
 * Minimal heuristic: shrink only "normal flow" boxes without explicit author sizing,
 * avoiding fragile layouts (flex/grid/absolute/fixed/sticky/transformed).
 * @param {Element} srcEl
 * @param {CSSStyleDeclaration} cs
 */
function shouldShrinkBox(srcEl, cs) {
  if (!(srcEl instanceof Element)) return false
  if (authorHasExplicitSize(srcEl)) return false
  if (isReplacedElement(srcEl)) return false

  const pos = cs.position
  if (pos === 'absolute' || pos === 'fixed' || pos === 'sticky') return false

  const disp = cs.display || ''
  if (disp.includes('flex') || disp.includes('grid') || disp.startsWith('table')) return false

  if (cs.transform && cs.transform !== 'none') return false

  return true
}

/**
 * Post-clone "shrink pass": for parents that lost children due to excludeMode:"remove",
 * override snapshot sizes so they can collapse naturally.
 *
 * It writes inline overrides on the CLONE (never the real DOM):
 *   - height/width: auto
 *   - remove logical sizes (block-size/inline-size)
 *   - relax min/max to allow collapse
 *
 * @param {Element} sourceRoot - original subtree root (for reading computed styles)
 * @param {HTMLElement} cloneRoot - cloned subtree root (to write overrides)
 * @param {Map<Element, CSSStyleDeclaration>} styleCache - optional cache you already build
 */
export function shrinkAutoSizeBoxes(sourceRoot, cloneRoot, styleCache = new Map()) {
  /**
   * @param {Element} src
   * @param {Element} cln
   */
  function walk(src, cln) {
    if (!(src instanceof Element) || !(cln instanceof Element)) return

    // If the clone lost children relative to the source, it's a good candidate to shrink.
    const lostKids = src.childElementCount > cln.childElementCount

    const cs = styleCache.get(src) || getComputedStyle(src)
    if (!styleCache.has(src)) styleCache.set(src, cs)

    if (lostKids && shouldShrinkBox(src, cs)) {
      // Inline overrides beat generated classes -> safe, local to the clone.
      if (!cln.style.height) cln.style.height = 'auto'
      if (!cln.style.width) cln.style.width = 'auto'

      cln.style.removeProperty('block-size')
      cln.style.removeProperty('inline-size')

      if (!cln.style.minHeight) cln.style.minHeight = '0'
      if (!cln.style.minWidth) cln.style.minWidth = '0'
      if (!cln.style.maxHeight) cln.style.maxHeight = 'none'
      if (!cln.style.maxWidth) cln.style.maxWidth = 'none'

      // Ensure the box can actually reveal its new size
      // (only when author didn't lock overflow intentionally)
      const oy = cs.overflowY || cs.overflowBlock || 'visible'
      const ox = cs.overflowX || cs.overflowInline || 'visible'
      if (oy !== 'visible' || ox !== 'visible') {
        cln.style.overflow = 'visible'
      }
    }

    // Walk element children in order (pseudo wrappers are already inlined elsewhere)
    const sKids = Array.from(src.children)
    const cKids = Array.from(cln.children)
    for (let i = 0; i < Math.min(sKids.length, cKids.length); i++) {
      walk(sKids[i], cKids[i])
    }
  }

  walk(sourceRoot, cloneRoot)
}

/**
 * True if the element is in normal flow (we ignore abs/fixed/sticky/float/transformed).
 * @param {Element} el
 */
function isInNormalFlow(el) {
  const cs = getComputedStyle(el)
  if (cs.display === 'none') return false
  if (cs.position === 'absolute' || cs.position === 'fixed' || cs.position === 'sticky') return false
  if ((cs.cssFloat || cs.float || 'none') !== 'none') return false
  if (cs.transform && cs.transform !== 'none') return false
  return true
}

/**
 * Mirrors the removal logic used later so we can know what remains.
 * Extend to honor filterMode:"remove" if needed.
 * @param {Element} el
 * @param {any} options
 */
function willBeExcluded(el, options) {
  if (!(el instanceof Element)) return false
  if (el.getAttribute('data-capture') === 'exclude' && options?.excludeMode === 'remove') return true
  if (Array.isArray(options?.exclude)) {
    for (const sel of options.exclude) { try { if (el.matches(sel)) return options.excludeMode === 'remove' } catch { } }
  }
  return false
}

/**
 * Compute the kept-children vertical span inside container's content box.
 * We take the min(top) and max(bottom) of included, in-flow children,
 * then add container paddings and borders to rebuild total height.
 * This avoids double-counting collapsed margins.
 * @param {Element} container
 * @param {any} options
 * @returns {number} estimated outerHeight (border+padding+content)
 */
export function estimateKeptHeight(container, options) {
  const csC = getComputedStyle(container)
  const rC = container.getBoundingClientRect()

  let minTop = Infinity
  let maxBottom = -Infinity
  let found = false

  // Consider only direct children; es lo más estable para layout en flujo normal
  const kids = Array.from(container.children)
  for (const k of kids) {
    if (willBeExcluded(k, options)) continue
    if (!isInNormalFlow(k)) continue
    const rk = k.getBoundingClientRect()
    // usar coordenadas relativas al contenedor
    const top = rk.top - rC.top
    const bottom = rk.bottom - rC.top
    if (bottom <= top) continue
    if (top < minTop) minTop = top
    if (bottom > maxBottom) maxBottom = bottom
    found = true
  }

  // content span de lo que queda
  const contentSpan = found ? Math.max(0, maxBottom - minTop) : 0

  // reconstruir altura outer: border + padding + contenido
  const bt = parseFloat(csC.borderTopWidth) || 0
  const bb = parseFloat(csC.borderBottomWidth) || 0
  const pt = parseFloat(csC.paddingTop) || 0
  const pb = parseFloat(csC.paddingBottom) || 0

  return bt + bb + pt + pb + contentSpan
}

export const limitDecimals = (v, n = 3) =>
  Number.isFinite(v) ? Math.round(v * 10 ** n) / 10 ** n : v
