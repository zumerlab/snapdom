/**
 * Emulates backdrop-filter in the clone.
 *
 * Chromium's svg-as-image rasterizer (the path every snapDOM export goes through)
 * doesn't composite backdrop-filter reliably: it drops it, or paints it over a
 * misplaced region when a filtered element sits in the backdrop (#457). Since the
 * capture is static, the effect can be pre-composed: copy what paints *below* the
 * element, clip it to the element's box and apply the same functions via `filter`,
 * which the rasterizer does support.
 *
 * Paint-below is approximated by tree order: the copy keeps only content that
 * precedes the element in the clone. Runs after image/background inlining so the
 * copy reuses already-inlined resources.
 *
 * @module backdropFilter
 */

import { cache } from '../core/cache.js'
import { getStyle } from '../utils'

/**
 * @param {Element} root - Original capture root (for viewport rects)
 * @param {Element} clone - Prepared clone (styles and resources already inlined)
 * @param {Map<Node, Node>} [nodeMap] - Session clone→source map; pass the capture's own
 *   reference — the global fallback can be stale after nested iframe captures.
 */
export function emulateBackdropFilters(root, clone, nodeMap = cache.session.nodeMap) {
  const targets = []
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT)
  for (let n = walker.currentNode; n; n = walker.nextNode()) {
    const orig = nodeMap.get(n)
    if (!(orig instanceof Element)) continue
    const cs = getStyle(orig)
    const bf = cs.getPropertyValue('backdrop-filter') || cs.getPropertyValue('-webkit-backdrop-filter')
    // Skip the capture root itself: its backdrop lies outside the captured subtree.
    if (bf && bf !== 'none' && n !== clone) targets.push({ cloneEl: n, orig, bf, path: pathTo(clone, n) })
  }
  if (!targets.length) return

  const rootRect = root.getBoundingClientRect()
  // Snapshot every backdrop copy from the pristine clone before any frost mutates it.
  const jobs = targets.map((t, i) => {
    const copy = clone.cloneNode(true)
    prunePayload(copy, clone, t.orig.getBoundingClientRect(), nodeMap)
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

  for (const { cloneEl, orig, bf, copy } of jobs) insertFrost(cloneEl, orig, bf, copy, rootRect)
}

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
 * rect can't reach the frost box. Structure is never removed — dropping nodes
 * could reflow the copy and misalign the visible part.
 */
function prunePayload(copy, clone, rect, nodeMap) {
  const stack = [[copy, clone]]
  while (stack.length) {
    const [c, o] = stack.pop()
    const orig = nodeMap.get(o)
    if (orig instanceof Element) {
      const r = orig.getBoundingClientRect()
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
