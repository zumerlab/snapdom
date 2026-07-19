/**
 * Helper utilities for DOM capture operations
 * @module utils/capture.helpers
 */

import { debugWarn, getStyle } from './index.js'
import {
  bboxWithOriginFull,
  parseTransformOriginPx,
  readIndividualTransforms
} from './transforms.helpers.js'

/**
 * Resolves the `clip` option to a rect in viewport coordinates (same space as
 * getBoundingClientRect), or null when absent/invalid.
 * @param {Element} element - capture root (its ownerDocument's window defines the viewport)
 * @param {"viewport"|{x:number,y:number,width:number,height:number}|null|undefined} clip
 * @returns {{left:number,top:number,right:number,bottom:number,width:number,height:number}|null}
 */
export function resolveClipRect(element, clip) {
  if (!clip) return null
  const doc = element.ownerDocument || document
  const win = doc.defaultView || window
  let x, y, w, h
  if (clip === 'viewport') {
    x = 0
    y = 0
    // clientWidth/Height exclude classic scrollbars; innerWidth would add a blank gutter
    w = doc.documentElement?.clientWidth || win.innerWidth
    h = doc.documentElement?.clientHeight || win.innerHeight
  } else if (typeof clip === 'object') {
    x = (Number(clip.x) || 0) - (win.scrollX || 0)
    y = (Number(clip.y) || 0) - (win.scrollY || 0)
    w = Number(clip.width)
    h = Number(clip.height)
  } else {
    return null
  }
  if (!(w > 0 && h > 0)) return null
  return { left: x, top: y, width: w, height: h, right: x + w, bottom: y + h }
}

/** Shadow-piercing parent (slot/light-tree children resolve via parentElement first). */
function composedParent(n) {
  if (n.parentElement) return n.parentElement
  const rn = n.getRootNode && n.getRootNode()
  return rn instanceof ShadowRoot ? rn.host : null
}

function composedContains(root, node) {
  for (let n = node; n; n = composedParent(n)) if (n === root) return true
  return false
}

/**
 * Nearest composed ancestor that forms a containing block for absolute/fixed boxes in the
 * clone: positioned, transformed, filtered, perspective, will-change of those, or contain.
 */
function findCBAncestor(node, root) {
  for (let a = composedParent(node); a && a !== root; a = composedParent(a)) {
    if (!(a instanceof Element)) break
    const acs = getStyle(a)
    if (acs.position !== 'static' ||
        (acs.transform && acs.transform !== 'none') ||
        (acs.filter && acs.filter !== 'none') ||
        (acs.backdropFilter && acs.backdropFilter !== 'none') ||
        (acs.perspective && acs.perspective !== 'none') ||
        /transform|perspective|filter/.test(acs.willChange || '') ||
        /layout|paint|strict|content/.test(acs.contain || '')) return a
  }
  return null
}

/**
 * Residual 2D matrix an element's clone still carries once its translation is discarded:
 * individual rotate/scale (applied before `transform`, per css-transforms-2) times the
 * computed transform. Direct composition — no DOM round-trip, and unlike reading back a
 * computed style, individual props aren't silently lost. Returns null on parse failure.
 * @param {string} baseTransform - computed transform ('' when none)
 * @param {{rotate:string, scale:any, translate:any}} ind
 * @returns {DOMMatrix|null}
 */
export function composeResidual2D(baseTransform, ind) {
  try {
    let M = new DOMMatrix()
    if (ind && ind.rotate && ind.rotate !== '0deg') M = M.multiply(new DOMMatrix(`rotate(${ind.rotate})`))
    if (ind && ind.scale) {
      const parts = String(ind.scale).trim().split(/\s+/).filter(Boolean)
      if (parts.length && parts.every(p => Number.isFinite(Number(p)))) {
        M = M.multiply(new DOMMatrix(`scale(${parts.join(',')})`))
      }
    }
    if (baseTransform) M = M.multiply(new DOMMatrix(baseTransform))
    return M
  } catch {
    return null
  }
}

/**
 * Clip mode: re-anchor fixed and sticky clones to their painted position.
 * In the static clone their layout position wins (sticky un-sticks, fixed anchors to the
 * page origin), which is wrong when the output window is the scrolled viewport. Converts
 * them to absolute at gBCR-derived, root-relative coordinates and HOISTS them to the clone
 * root — escaping #364 scroll wrappers, ancestor overflow clipping, and CB-forming
 * ancestors in one move (every clone node carries its full computed snapshot, so
 * inheritance doesn't change). Sticky leaves an invisible in-flow placeholder so its flow
 * slot doesn't shift. Shadow-scoped clones depend on [data-sd] descendant selectors, so
 * they freeze in place relative to their composed containing-block ancestor instead.
 * @param {Element} root - original capture root
 * @param {Element} cloneRoot
 * @param {Map<Node, Node>} nodeMap - clone → original
 * @param {WeakMap<Element, CSSStyleDeclaration>} styleCache
 * @param {{x:number, y:number}} [edge] - window origin in root coords (clip window or 0,0)
 */
export function freezeViewportPositioned(root, cloneRoot, nodeMap, styleCache, edge) {
  const rootR = root.getBoundingClientRect()
  if (cloneRoot instanceof HTMLElement && getStyle(root).position === 'static') {
    cloneRoot.style.position = 'relative'
  }
  const hoisted = []
  for (const [cloneEl, orig] of nodeMap) {
    if (!(cloneEl instanceof HTMLElement) || !(orig instanceof Element)) continue
    if (orig === root || !composedContains(root, orig)) continue
    const cs = styleCache.get(orig) || getStyle(orig)
    const pos = cs.position
    if (pos !== 'fixed' && pos !== 'sticky' && pos !== '-webkit-sticky') continue
    // already frozen by freezeSticky / the scrolled-container pass (#364)
    if (cloneEl.style.position === 'absolute') continue
    const r = orig.getBoundingClientRect()
    if (!(r.width > 0 && r.height > 0)) continue
    // Freeze the EXACT fractional box. offsetWidth rounds to integers — freezing a
    // fit-content box 0.x px narrower than its content makes inner text re-wrap.
    // Only when the residual matrix scales/rotates (r = transformed box ≠ layout box)
    // fall back to the integer layout metrics.
    const baseT = cs.transform && cs.transform !== 'none' ? cs.transform : ''
    const ind = readIndividualTransforms(orig)
    const hasTransform = !!(baseT || ind.rotate !== '0deg' || ind.scale || ind.translate)
    const M = hasTransform ? composeResidual2D(baseT, ind) : null
    const identityLinear = !M || !M.is2D || (M.a === 1 && M.b === 0 && M.c === 0 && M.d === 1)
    let w = r.width, h = r.height
    if (!identityLinear) {
      w = /** @type {HTMLElement} */ (orig).offsetWidth || r.width
      h = /** @type {HTMLElement} */ (orig).offsetHeight || r.height
    }
    const inShadow = orig.getRootNode && orig.getRootNode() instanceof ShadowRoot
    let baseR = rootR, baseBL = root.clientLeft || 0, baseBT = root.clientTop || 0
    if (inShadow) {
      const cb = findCBAncestor(orig, root)
      if (cb) {
        baseR = cb.getBoundingClientRect()
        baseBL = cb.clientLeft || 0
        baseBT = cb.clientTop || 0
      }
    }
    let left = r.left - baseR.left - baseBL
    let top = r.top - baseR.top - baseBT
    // The gBCR-derived left/top already include the element's transform; the clone keeps
    // that transform via its class, so it would apply twice (e.g. the fixed-centering
    // translateX(-50%) pattern). Zero the translation and, when rotation/scale/skew
    // remain, shift by the residual matrix's bbox offset so the painted box still lands
    // exactly on the gBCR.
    if (hasTransform) {
      cloneEl.style.translate = 'none'
      cloneEl.style.rotate = 'none'
      cloneEl.style.scale = 'none'
      if (identityLinear) {
        cloneEl.style.transform = 'none'
      } else {
        cloneEl.style.transform = `matrix(${M.a},${M.b},${M.c},${M.d},0,0)`
        const { ox, oy } = parseTransformOriginPx(cs, w, h)
        const bb = bboxWithOriginFull(w, h, { a: M.a, b: M.b, c: M.c, d: M.d, e: 0, f: 0 }, ox, oy)
        left -= bb.minX
        top -= bb.minY
      }
    }
    if (pos !== 'fixed') {
      const ph = cloneEl.cloneNode(false)
      ph.setAttribute('data-snap-ph', '1')
      ph.style.position = 'static'
      ph.style.visibility = 'hidden'
      ph.style.width = `${w}px`
      ph.style.height = `${h}px`
      ph.style.boxSizing = 'border-box'
      cloneEl.parentElement?.insertBefore(ph, cloneEl)
    }
    // System fonts and emoji can't be embedded and drift ~1-2px in the SVG-image render.
    // A shrink-to-fit box frozen at its exact live width then re-wraps its text on any
    // sub-pixel of drift — 2px of slack absorbs it and is visually imperceptible.
    let boxW = w + 2, boxH = h
    // Chromium 148/149 raster bug: an absolute box whose top/left coincides EXACTLY with
    // the output window edge makes a LATER positioned sibling vanish when the SVG is
    // rasterized as an image — and a stuck sticky sits exactly there by definition.
    // Nudge 1px outside the window (the extra px is clipped away) to break the coincidence.
    if (edge) {
      if (Math.abs(top - edge.y) < 0.5) { top -= 1; boxH += 1 }
      if (Math.abs(left - edge.x) < 0.5) { left -= 1; boxW += 1 }
    }
    cloneEl.style.position = 'absolute'
    cloneEl.style.left = `${left}px`
    cloneEl.style.top = `${top}px`
    cloneEl.style.right = 'auto'
    cloneEl.style.bottom = 'auto'
    cloneEl.style.margin = '0'
    cloneEl.style.width = `${boxW}px`
    cloneEl.style.height = `${boxH}px`
    // offset* are border-box; content-box elements with padding/border would inflate
    cloneEl.style.boxSizing = 'border-box'
    if (!inShadow) hoisted.push(cloneEl)
  }
  for (const el of hoisted) cloneRoot.appendChild(el)
}

/**
 * Strip shadow-like visuals on the CLONE ROOT ONLY (box/text-shadow, outline, drop-shadow()).
 * Children remain intact.
 * @param {Element} originalEl
 * @param {HTMLElement} cloneRoot
 * @param {Object} [opts] - optional { debug } for verbose logging
 */
export function stripRootShadows(originalEl, cloneRoot, opts = {}) {
  if (!originalEl || !cloneRoot || !cloneRoot.style) return
  const cs = getComputedStyle(originalEl)
  try { cloneRoot.style.boxShadow = 'none' } catch (e) { debugWarn(opts, 'stripRootShadows boxShadow', e) }
  try { cloneRoot.style.textShadow = 'none' } catch (e) { debugWarn(opts, 'stripRootShadows textShadow', e) }
  try { cloneRoot.style.outline = 'none' } catch (e) { debugWarn(opts, 'stripRootShadows outline', e) }
  // Only drop-shadow() is an outer-shadow effect; blur() is part of the element's
  // own appearance and must survive (its bleed is always included in the bbox).
  const f = cs.filter || ''
  // One nesting level: computed drop-shadow() carries an rgb()/rgba() color.
  const cleaned = f
    .replace(/\bdrop-shadow\((?:[^()]|\([^()]*\))*\)\s*/gi, '')
    .trim()
    .replace(/\s+/g, ' ')
  try { cloneRoot.style.filter = cleaned.length ? cleaned : 'none' } catch (e) {
    debugWarn(opts, 'stripRootShadows filter', e)
  }
}

/**
 * True if the element establishes a new block formatting context, which stops
 * margins from collapsing through its top/bottom edges.
 * @param {CSSStyleDeclaration} cs
 */
function establishesBFC(cs) {
  const disp = cs.display || ''
  if (disp.includes('flex') || disp.includes('grid') || disp.startsWith('table') ||
      disp === 'inline-block' || disp === 'flow-root') return true
  if (cs.position === 'absolute' || cs.position === 'fixed') return true
  if (cs.float && cs.float !== 'none') return true
  const ox = cs.overflowX || cs.overflow || 'visible'
  const oy = cs.overflowY || cs.overflow || 'visible'
  if (ox !== 'visible' || oy !== 'visible') return true
  if (cs.contain && /\b(layout|content|paint|strict)\b/.test(cs.contain)) return true
  return false
}

/**
 * First child element that participates in margin-collapsing through `el`'s edge.
 * Returns null when inline/text content precedes it (which opens an inline
 * formatting context and prevents collapse-through).
 * @param {Element} el
 * @param {'top'|'bottom'} side
 */
function firstInFlowBlockChild(el, side) {
  const kids = Array.from(el.childNodes)
  const ordered = side === 'top' ? kids : kids.reverse()
  for (const n of ordered) {
    if (n.nodeType === Node.TEXT_NODE) {
      if (/\S/.test(n.textContent || '')) return null // inline content → no collapse
      continue
    }
    if (n.nodeType !== Node.ELEMENT_NODE) continue
    const cs = getComputedStyle(n)
    const disp = String(cs.display || '')
    if (disp === 'none' || disp === 'contents') continue
    if (cs.position === 'absolute' || cs.position === 'fixed') continue
    if (cs.float && cs.float !== 'none') return null
    // Only block-level boxes collapse margins with the parent. Inline-level boxes
    // (inline, inline-block, inline-flex…) open an inline formatting context instead,
    // which prevents collapse-through entirely.
    if (disp.startsWith('inline')) return null
    return n
  }
  return null
}

/**
 * #426: When margins of in-flow children collapse *through* the captured root's
 * top/bottom edge, that margin lands outside the root's border box — exactly the
 * region `element.getBoundingClientRect()`/`offsetHeight` excludes. The clone,
 * isolated inside an `all:initial` wrapper, no longer collapses those margins out,
 * so the content is pushed in and the opposite edge is clipped.
 *
 * Mirror the browser: walk the collapse-through chain from each open edge and zero
 * the leading/trailing margin on the CLONE so content sits flush, matching what the
 * captured border box actually shows. Source tree drives the decision; clone tree is
 * mutated in parallel (same ordering as deepClone).
 *
 * @param {Element} originalEl
 * @param {HTMLElement} cloneRoot
 */
export function neutralizeRootMarginCollapse(originalEl, cloneRoot) {
  if (!originalEl || !cloneRoot || !cloneRoot.style) return
  const rootCS = getComputedStyle(originalEl)
  // Replaced elements and BFC roots never collapse margins with their children.
  if (establishesBFC(rootCS)) return

  for (const side of /** @type {const} */ (['top', 'bottom'])) {
    const Side = side === 'top' ? 'Top' : 'Bottom'
    // Edge must be "open": no border or padding separating root from child.
    if ((parseFloat(rootCS[`border${Side}Width`]) || 0) > 0) continue
    if ((parseFloat(rootCS[`padding${Side}`]) || 0) > 0) continue

    let src = originalEl
    let cln = cloneRoot
    // Walk the chain of first/last in-flow block children whose margins all
    // collapse together through the root edge.
    while (src && cln) {
      const childSrc = firstInFlowBlockChild(src, side)
      if (!childSrc) break
      const idx = Array.from(src.children).indexOf(childSrc)
      const childCln = idx >= 0 ? cln.children[idx] : null
      const childCS = getComputedStyle(childSrc)
      const m = parseFloat(childCS[`margin${Side}`]) || 0
      if (childCln && childCln.style && m > 0) {
        childCln.style[`margin${Side}`] = '0px'
      }
      // Collapse continues into this child only if its matching edge is also open.
      if (establishesBFC(childCS)) break
      if ((parseFloat(childCS[`border${Side}Width`]) || 0) > 0) break
      if ((parseFloat(childCS[`padding${Side}`]) || 0) > 0) break
      src = childSrc
      cln = childCln
    }
  }
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

      if (name.startsWith('*')) { el.removeAttribute(name); continue }

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

/* eslint-disable no-control-regex */
/**
 * Characters that are illegal in XML 1.0 even though browsers accept them in live HTML:
 * C0 controls except TAB (\x09), LF (\x0A), CR (\x0D), plus the noncharacters U+FFFE/U+FFFF.
 * If any survive into the serialized SVG, the data: URL fails to parse and the browser throws
 * "EncodingError: The source image cannot be decoded" at img.decode() time.
 */
const INVALID_XML_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g
/* eslint-enable no-control-regex */

/**
 * #425: strip XML-1.0-invalid characters from every attribute value AND text node in the
 * clone. clone.js already scrubs attributes during cloning, but values re-applied afterwards
 * (e.g. `input.setAttribute('value', node.value)` for form fields — ExtJS hidden inputs use
 * U+0003 as a delimiter) and text content were not covered. This runs once over the finished
 * clone, right before serialization, so no invalid char can reach the SVG.
 * @param {Element} root
 */
export function stripInvalidXMLChars(root) {
  if (!root) return
  const clean = (node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.attributes) {
        for (const attr of Array.from(node.attributes)) {
          const cv = attr.value.replace(INVALID_XML_CHARS, '')
          if (cv !== attr.value) {
            try { node.setAttribute(attr.name, cv) } catch { /* read-only attr */ }
          }
        }
      }
    } else if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
      const cv = node.data.replace(INVALID_XML_CHARS, '')
      if (cv !== node.data) node.data = cv
    }
  }
  clean(root)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  let n
  while ((n = walker.nextNode())) clean(n)
}

export function sanitizeCloneForXHTML(root, opts = {}) {
  if (!root) return
  sanitizeAttributesForXHTML(root, opts)
  removeAllComments(root)
  stripInvalidXMLChars(root)
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
 * True if the element contributes to its parent's height (block, float, sticky, etc.).
 * Excludes only position absolute/fixed and display:none.
 * @param {Element} el
 */
function contributesToParentHeight(el) {
  const cs = getComputedStyle(el)
  if (cs.display === 'none') return false
  if (cs.position === 'absolute' || cs.position === 'fixed') return false
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
    for (const sel of options.exclude) {
    try { if (el.matches(sel)) return options.excludeMode === 'remove' } catch (e) {
      debugWarn(options, 'exclude selector match failed', e)
    }
  }
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

  // Consider only direct children; incluir floats (contribuyen a la altura del contenedor)
  const kids = Array.from(container.children)
  for (const k of kids) {
    if (willBeExcluded(k, options)) continue
    if (!contributesToParentHeight(k)) continue
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

/** Match ::-webkit-scrollbar and related pseudos (#334) */
const SCROLLBAR_PSEUDO = /::-webkit-scrollbar(-[a-z]+)?\b/i

/**
 * Recursively collect CSS rules that contain ::-webkit-scrollbar selectors.
 * Fixes #334: custom scrollbar styles now apply in capture.
 * @param {CSSRuleList} rules
 * @param {Set<string>} seen - dedupe by cssText
 * @returns {string}
 */
function collectScrollbarRulesFromRules(rules, seen = new Set()) {
  let out = ''
  if (!rules) return out
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]
    try {
      if (rule.type === CSSRule.IMPORT_RULE && rule.styleSheet) {
        out += collectScrollbarRulesFromRules(rule.styleSheet.cssRules, seen)
        continue
      }
      if (rule.type === CSSRule.MEDIA_RULE && rule.cssRules) {
        const inner = collectScrollbarRulesFromRules(rule.cssRules, seen)
        if (inner) out += `@media ${rule.conditionText}{${inner}}`
        continue
      }
      if (rule.type === CSSRule.STYLE_RULE) {
        const sel = rule.selectorText || ''
        if (SCROLLBAR_PSEUDO.test(sel)) {
          const text = rule.cssText
          if (text && !seen.has(text)) {
            seen.add(text)
            out += text
          }
        }
      }
    } catch {
      // CORS or invalid rule; skip
    }
  }
  return out
}

/**
 * Extract ::-webkit-scrollbar rules from the document's stylesheets.
 * Used so custom scrollbar styling appears in capture (#334).
 * @param {Document} doc
 * @returns {string}
 */
export function collectScrollbarCSS(doc) {
  if (!doc || !doc.styleSheets) return ''
  const seen = new Set()
  let out = ''
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      const rules = sheet.cssRules
      if (rules) out += collectScrollbarRulesFromRules(rules, seen)
    } catch {
      // Cross-origin stylesheet; cannot read cssRules
    }
  }
  return out
}
