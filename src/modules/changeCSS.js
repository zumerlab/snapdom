/**
 * Freeze sticky elements by converting them to absolutely-positioned overlays.
 * Also creates an invisible absolute placeholder behind each sticky (lower z-index).
 *
 * Robust against sibling-index drift:
 * - Placeholders are marked data-snap-ph="1".
 * - Path resolution in the clone ignores those placeholders to keep indices aligned.
 *
 * Only processes real vertical stickies (numeric top OR bottom).
 *
 * @param {HTMLElement} originalRoot
 * @param {HTMLElement} cloneRoot
 */
export function freezeSticky(originalRoot, cloneRoot) {
  if (!originalRoot || !cloneRoot) return

  const scrollTop = originalRoot.scrollTop || 0
  // Avoid touching layout if nothing is actually stuck yet
  if (!scrollTop) return

  // Ensure clone is a containing block
  if (getComputedStyle(cloneRoot).position === 'static') {
    cloneRoot.style.position = 'relative'
  }

  const rootRect = originalRoot.getBoundingClientRect()
  const viewportH = originalRoot.clientHeight
  const PH_ATTR = 'data-snap-ph'

  const walker = document.createTreeWalker(originalRoot, NodeFilter.SHOW_ELEMENT)
  while (walker.nextNode()) {
    const el = /** @type {HTMLElement} */ (walker.currentNode)
    const cs = getComputedStyle(el)

    // Hard filter: only sticky
    const pos = cs.position
    if (pos !== 'sticky' && pos !== '-webkit-sticky') continue

    // Must have a vertical anchor
    const topInit = _toPx(cs.top)
    const bottomInit = _toPx(cs.bottom)
    if (topInit == null && bottomInit == null) continue

    // Resolve twin BEFORE mutating siblings; resolution ignores placeholders
    const path = _pathOf(el, originalRoot)
    const cloneEl = _findByPathIgnoringPlaceholders(cloneRoot, path, PH_ATTR)
    if (!cloneEl) continue

    // Measure on original
    const elRect = el.getBoundingClientRect()
    const widthPx = elRect.width
    const heightPx = elRect.height
    const leftPx = elRect.left - rootRect.left
    if (!(widthPx > 0 && heightPx > 0)) continue
    if (!Number.isFinite(leftPx)) continue

    // Compute absolute top for frozen state
    const topAbsPx = topInit != null
      ? topInit + scrollTop
      : scrollTop + (viewportH - heightPx - /** bottomInit non-null */ bottomInit)
    if (!Number.isFinite(topAbsPx)) continue

    // Layering
    const zParsed = Number.parseInt(cs.zIndex, 10)
    const hasZ = Number.isFinite(zParsed)
    const overlayZ = hasZ ? Math.max(zParsed, 1) + 1 : 2
    const placeholderZ = hasZ ? zParsed - 1 : 0

    // 1) Absolute, invisible placeholder (behind). Mark it to ignore in future path resolutions.
    const ph = cloneEl.cloneNode(false)
    ph.setAttribute(PH_ATTR, '1')
    ph.style.position = 'sticky'
    ph.style.left = `${leftPx}px`
    ph.style.top = `${topAbsPx}px`
    ph.style.width = `${widthPx}px`
    ph.style.height = `${heightPx}px`
    ph.style.visibility = 'hidden'
    ph.style.zIndex = String(placeholderZ)
    ph.style.overflow = 'hidden'
    ph.style.background = 'transparent'
    ph.style.boxShadow = 'none'
    ph.style.filter = 'none'

    cloneEl.parentElement?.insertBefore(ph, cloneEl)

    // 2) Turn the clone twin into visible absolute overlay (do NOT mark it)
    cloneEl.style.position = 'absolute'
   // cloneEl.style.width = `${widthPx}px`;
   // cloneEl.style.height = `${heightPx}px`;
    cloneEl.style.left = `${leftPx}px`
    cloneEl.style.top = `${topAbsPx}px`
    cloneEl.style.bottom = 'auto'
    cloneEl.style.zIndex = String(overlayZ)
    cloneEl.style.pointerEvents = 'none'
  }
}

function _toPx(v) {
  if (!v || v === 'auto') return null
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : null
}

function _pathOf(el, root) {
  const path = []
  for (let cur = el; cur && cur !== root; ) {
    const p = cur.parentElement
    if (!p) break
    path.push(Array.prototype.indexOf.call(p.children, cur))
    cur = p
  }
  return path.reverse()
}

/**
 * Resolve a node in the clone by path of element indices, but ignoring any
 * children marked as placeholders (data-snap-ph="1") that were injected later.
 * This keeps indices aligned with the original DOM structure.
 *
 * @param {HTMLElement} root
 * @param {number[]} path
 * @param {string} phAttr
 * @returns {HTMLElement|null}
 */
function _findByPathIgnoringPlaceholders(root, path, phAttr) {
  let cur = root
  for (let i = 0; i < path.length; i++) {
    const kids = _childrenWithoutPlaceholders(cur, phAttr)
    cur = /** @type {HTMLElement|undefined} */ (kids[path[i]])
    if (!cur) return null
  }
  return cur instanceof HTMLElement ? cur : null
}

/**
 * @param {Element} el
 * @param {string} phAttr
 * @returns {Element[]}
 */
function _childrenWithoutPlaceholders(el, phAttr) {
  const out = []
  const ch = el.children
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i]
    if (!c.hasAttribute(phAttr)) out.push(c)
  }
  return out
}
