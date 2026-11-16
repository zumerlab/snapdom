/**
 * Emulates backdrop-filter in the clone.
 *
 * Chromium's svg-as-image rasterizer (every export goes through it) drops backdrop-filter, or
 * paints it over a misplaced region when a filtered element sits in the backdrop (#457). The
 * capture is static, so the effect is pre-composed: copy what paints *below* the element (by
 * tree order: content that precedes it), clip it to the box and apply the same functions as
 * `filter`, which the rasterizer supports. Runs after image and background inlining, so the
 * copy reuses the inlined resources.
 *
 * @module backdropFilter
 */

import { getStyle } from '../utils'

/**
 * Pre-compose every backdrop-filter in the clone as a frost layer.
 *
 * Each target gets its own copy of the clone, taken before any frost goes in, pruned to what
 * can reach its box and cut at the target in tree order. The capture root (its backdrop is
 * outside the capture) and replaced elements are skipped. Pinned by the frosted-vs-control
 * pixel check in __tests__/core.capture.diff.test.js and __tests__/audit.tier5.fidelity.test.js.
 * @param {Element} root - Original capture root (for viewport rects)
 * @param {Element} clone - Prepared clone (styles and resources already inlined)
 * @param {Map<Node, Node>} [nodeMap] - Session clone-to-source map; pass the capture's own
 *   reference, since the global fallback can be stale after nested iframe captures.
 */
export function emulateBackdropFilters(root, clone, nodeMap = new Map()) {
  const targets = []
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT)
  for (let n = walker.currentNode; n; n = walker.nextNode()) {
    const orig = nodeMap.get(n)
    if ((orig?.nodeType !== 1)) continue
    const cs = getStyle(orig)
    const bf = cs.getPropertyValue('backdrop-filter') || cs.getPropertyValue('-webkit-backdrop-filter')
    // Skip the capture root itself: its backdrop lies outside the captured subtree.
    if (bf && bf !== 'none' && n !== clone) targets.push({ cloneEl: n, orig, bf, path: pathTo(clone, n) })
  }
  if (!targets.length) return

  const rootRect = root.getBoundingClientRect()
  // Snapshot every backdrop copy from the pristine clone before any frost mutates it.
  // The live layout is untouched until the frost loop, so a source rect repeats across targets.
  const rects = targets.length > 1 ? new Map() : null
  const jobs = targets.map((t, i) => {
    const copy = clone.cloneNode(true)
    prunePayload(copy, clone, t.orig.getBoundingClientRect(), nodeMap, rects)
    removeSelfAndFollowing(nodeAtPath(copy, t.path))
    // Earlier bf elements survive inside this copy (they precede in tree order);
    // kill their raw backdrop-filter so the rasterizer can't smear it (#457).
    for (let j = 0; j < i; j++) {
      const prev = nodeAtPath(copy, targets[j].path)
      if (prev) {
        prev.style.setProperty('backdrop-filter', 'none', 'important')
        prev.style.setProperty('-webkit-backdrop-filter', 'none', 'important')
      }
    }
    return { ...t, copy }
  })

  for (const { cloneEl, orig, bf, copy } of jobs) {
    // A replaced element renders no children, so the prepended layers never paint, while
    // insertFrost wipes its own background with !important. An <input>, <textarea> or <img>
    // lost its background for nothing; leaving it alone loses only the blur.
    if (REPLACED_ELEMENTS.has(cloneEl.tagName)) continue
    insertFrost(cloneEl, orig, bf, copy, rootRect)
  }
}

/** Elements whose children are not rendered, so a prepended layer cannot paint inside them. */
const REPLACED_ELEMENTS = new Set([
  'IMG', 'INPUT', 'TEXTAREA', 'SELECT', 'CANVAS', 'VIDEO', 'AUDIO', 'IFRAME',
  'EMBED', 'OBJECT', 'PROGRESS', 'METER', 'HR', 'BR',
])

/**
 * Mount the backdrop copy under the element as two layers: the filtered copy at z -2, the
 * element's own background at z -1, content on top. The copy is positioned so the element's
 * box lands on the same spot of the copy it occupies in the live page.
 * @param {HTMLElement} cloneEl
 * @param {Element} orig - the live element, for its rect and computed background
 * @param {string} bf - the backdrop-filter value, applied as `filter` on the copy
 * @param {HTMLElement} copy - the pruned clone copy, from emulateBackdropFilters
 * @param {DOMRect} rootRect
 */
function insertFrost(cloneEl, orig, bf, copy, rootRect) {
  const r = orig.getBoundingClientRect()
  if (!r.width || !r.height) return
  const cs = getStyle(orig)

  // The copy re-applies the transforms it contains, and the element's ancestor
  // transforms scale it again. Counter-scale so the frost content lands 1:1;
  // the accumulated ancestor scale falls out of rect vs layout width.
  const s = orig.offsetWidth ? r.width / orig.offsetWidth : 1
  const k = Math.abs(s - 1) > 0.001 ? 1 / s : 1
  copy.style.position = 'absolute'
  copy.style.left = `${(rootRect.left - r.left) * k}px`
  copy.style.top = `${(rootRect.top - r.top) * k}px`
  copy.style.width = `${rootRect.width}px`
  copy.style.height = `${rootRect.height}px`
  copy.style.margin = '0'
  copy.style.filter = bf
  if (k !== 1) {
    copy.style.transform = `scale(${k})`
    copy.style.transformOrigin = 'top left'
  }

  const frost = document.createElement('div')
  frost.style.cssText = 'position:absolute;inset:0;overflow:hidden;border-radius:inherit;z-index:-2'
  frost.appendChild(copy)

  // The element's own background paints ABOVE its backdrop: move it to a layer
  // between the frost and the content. Inlined data-URL backgrounds live on the
  // clone's inline style; gradients/colors only in the computed style.
  const bg = document.createElement('div')
  bg.style.cssText = 'position:absolute;inset:0;border-radius:inherit;z-index:-1'
  bg.style.backgroundColor = cs.backgroundColor
  bg.style.backgroundImage = cloneEl.style.backgroundImage || cs.backgroundImage
  for (const p of ['background-size', 'background-position', 'background-repeat', 'background-origin', 'background-clip']) {
    bg.style.setProperty(p, cs.getPropertyValue(p))
  }
  cloneEl.style.setProperty('background-color', 'transparent', 'important')
  cloneEl.style.setProperty('background-image', 'none', 'important')
  cloneEl.style.setProperty('backdrop-filter', 'none', 'important')
  cloneEl.style.setProperty('-webkit-backdrop-filter', 'none', 'important')
  if (cs.position === 'static') cloneEl.style.position = 'relative'
  // Stacking context so the negative-z layers stay inside this element
  cloneEl.style.isolation = 'isolate'
  cloneEl.prepend(bg)
  cloneEl.prepend(frost)
}

// Blur samples pixels from outside the element's box; keep payload within this bleed.
const PRUNE_MARGIN = 128

/**
 * Empties heavy payload (img src, background-image) on copy nodes whose original
 * rect can't reach the frost box. Structure is never removed: dropping nodes
 * could reflow the copy and misalign the visible part.
 */
function prunePayload(copy, clone, rect, nodeMap, rects) {
  const stack = [[copy, clone]]
  while (stack.length) {
    const [c, o] = stack.pop()
    const orig = nodeMap.get(o)
    if (orig?.nodeType === 1) {
      let r = rects?.get(orig)
      if (!r) { r = orig.getBoundingClientRect(); rects?.set(orig, r) }
      if (r.left > rect.right + PRUNE_MARGIN || r.right < rect.left - PRUNE_MARGIN ||
          r.top > rect.bottom + PRUNE_MARGIN || r.bottom < rect.top - PRUNE_MARGIN) {
        if (c.tagName === 'IMG') c.setAttribute('src', 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=')
        if (c.style) c.style.backgroundImage = 'none'
      }
    }
    const cc = c.children, oc = o.children
    for (let i = 0; i < cc.length; i++) stack.push([cc[i], oc[i]])
  }
}

/** Child-index path from root to node (both in the same tree). */
function pathTo(root, node) {
  const path = []
  for (let n = node; n !== root; n = n.parentElement) {
    if (!n?.parentElement) return null
    path.push([...n.parentElement.children].indexOf(n))
  }
  return path.reverse()
}

/** The node a pathTo() path points at inside another tree of the same shape. */
function nodeAtPath(root, path) {
  if (!path) return null
  let n = root
  for (const i of path) {
    n = n.children[i]
    if (!n) return null
  }
  return n
}

/** Removes node and everything after it in tree order (approximates "painted above"). */
function removeSelfAndFollowing(node) {
  if (!node) return
  for (let n = node; n && n.parentNode;) {
    const parent = n.parentNode
    while (n.nextSibling) n.nextSibling.remove()
    if (n === node) n.remove()
    n = parent
  }
}
