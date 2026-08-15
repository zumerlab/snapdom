// src/core/lineClamp.js

/**
 * Bake text truncation for the element AND all descendants that CSS would
 * truncate: multi-line `-webkit-line-clamp` and single-line
 * `text-overflow: ellipsis`. Firefox and Safari don't honour either inside a
 * `<foreignObject>`, so we resolve the ellipsis into the text up front.
 * Fixes #386 (nested clamp) and #431 (single-line ellipsis on Safari/Firefox).
 *
 * @param {Element} el - Root element (and its subtree) to process
 * @param {{left:number,top:number,right:number,bottom:number}|null} [clipRect] - Clip mode:
 *   prune subtrees painting entirely outside this viewport-coords window (their clamp work
 *   is discarded with the culled clone anyway).
 * @returns {() => void} Combined undo function
 */
export function lineClampTree(el, clipRect) {
  if (!el) return () => {}
  const undos = []
  const M = 200
  function walk(node) {
    if (clipRect) {
      const r = node.getBoundingClientRect()
      if (r.width > 0 || r.height > 0) {
        const right = Math.max(r.right, r.left + (node.scrollWidth || 0))
        const bottom = Math.max(r.bottom, r.top + (node.scrollHeight || 0))
        if (right < clipRect.left - M || r.left > clipRect.right + M ||
            bottom < clipRect.top - M || r.top > clipRect.bottom + M) return
      }
    }
    // One computed-style read per node, shared by both passes (hot path).
    const cs = getComputedStyle(node)
    const u1 = lineClamp(node, cs)
    if (u1) undos.push(u1)
    const u2 = textEllipsis(node, cs)
    if (u2) undos.push(u2)
    for (const child of node.children || []) walk(child)
  }
  walk(el)
  return () => undos.forEach((u) => u())
}

/**
 * Apply a multi-line ellipsis ONLY if the target element declares
 * -webkit-line-clamp/line-clamp. Uses the real layout (scrollHeight) and
 * mutates the ORIGINAL node briefly (binary search on text + '…'),
 * then returns an undo() that restores everything right after cloning.
 *
 * @param {Element} el
 * @param {CSSStyleDeclaration} [cs]
 * @returns {() => void} undo function (no-op if nothing changed)
 */
export function lineClamp(el, cs) {
  if (!el) return () => {}
  cs = cs || getComputedStyle(el)

  const lines = getClamp(cs)
  if (lines <= 0) return () => {}

  if (!isPlainTextContainer(el)) return () => {}

  const original = el.textContent ?? ''

  // Measure the REAL rendered line height instead of guessing from CSS.
  // `line-height: normal` is font-metric dependent, and inside a -webkit-box the
  // line box never shrinks below the font strut, so a value smaller than the
  // glyph height (e.g. line-height:18px on 20px text) still lays out taller. A
  // fs*1.2 / raw-CSS guess mis-sizes targetH and clamps to the wrong line count (#443).
  const pad = vpad(cs)
  el.textContent = 'X'
  const perLine = el.scrollHeight - pad
  el.textContent = original
  const lineH = perLine > 0 ? perLine : usedLineHeightPx(cs)
  const targetH = Math.round(lineH * lines + pad)

  // Already fits in N lines: do nothing, same as the native clamp
  if (el.scrollHeight <= targetH + 0.5) {
    return () => {}
  }

  // ==== Binary search over the prefix length that fits with an ellipsis ====
  let lo = 0, hi = original.length, best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    el.textContent = original.slice(0, safeCut(original, mid)) + '…'
    // Forzamos layout leyendo scrollHeight
    if (el.scrollHeight <= targetH + 0.5) {
      best = mid; lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  // Apply the best cut (when nothing fits, only the ellipsis is left)
  const written = (best >= 0 ? original.slice(0, safeCut(original, best)) : '') + '…'
  el.textContent = written

  // Return undo() so the original DOM is restored after cloning
  return undoText(el, written, original)
}

/**
 * Bake a single-line `text-overflow: ellipsis`. Same strategy as lineClamp but
 * on the horizontal axis: only when the element is a nowrap, overflow-clipped
 * plain-text container whose content overflows. Firefox/Safari skip this in a
 * <foreignObject>, so we resolve it here for every engine (#431).
 *
 * @param {Element} el
 * @param {CSSStyleDeclaration} [cs]
 * @returns {() => void} undo function (no-op if nothing changed)
 */
export function textEllipsis(el, cs) {
  if (!el) return () => {}
  cs = cs || getComputedStyle(el)

  if (cs.textOverflow !== 'ellipsis') return () => {}
  // Single-line ellipsis: content must not wrap and must be clipped.
  if (cs.whiteSpace !== 'nowrap' && cs.whiteSpace !== 'pre') return () => {}
  if (cs.overflowX !== 'hidden' && cs.overflowX !== 'clip') return () => {}

  if (!isPlainTextContainer(el)) return () => {}

  // It already fits, so the native clamp would do nothing either.
  if (el.scrollWidth <= el.clientWidth + 0.5) return () => {}

  const original = el.textContent ?? ''

  let lo = 0, hi = original.length, best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    el.textContent = original.slice(0, safeCut(original, mid)) + '…'
    if (el.scrollWidth <= el.clientWidth + 0.5) {
      best = mid; lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  const written = (best >= 0 ? original.slice(0, safeCut(original, best)) : '') + '…'
  el.textContent = written

  return undoText(el, written, original)
}

/* ---------------- helpers ---------------- */

/** Restore the pre-clamp text — unless the page changed it while the capture was running.
 *  This is the one place the pipeline writes to the LIVE tree: the ellipsis is baked into
 *  the real node, the clone is taken, and the text is put back. `prepareClone` is awaited
 *  in between, which is long enough for the caller's own code to write new text into the
 *  same node. A blind `el.textContent = original` then reverted that write — the capture
 *  being stale would have been forgivable, silently undoing the application's update was
 *  not. If what we wrote is no longer there, the node has a new owner: leave it. */
function undoText(el, written, original) {
  return () => {
    if (el.textContent === written) el.textContent = original
  }
}

/** A cut index that never lands between the two halves of a surrogate pair. Slicing an
 *  emoji in half leaves a lone surrogate, and the serialized SVG then fails
 *  encodeURIComponent — rejecting the WHOLE capture with "URIError: URI malformed",
 *  not just mangling one glyph. Must be applied to the emitted slice too, not only the
 *  probes: the last probe is not necessarily the one that wins. */
function safeCut(text, n) {
  if (n <= 0 || n >= text.length) return n
  const c = text.charCodeAt(n - 1)
  return c >= 0xd800 && c <= 0xdbff ? n - 1 : n
}

function getClamp(cs) {
  let v = cs.getPropertyValue('-webkit-line-clamp') || cs.getPropertyValue('line-clamp')
  v = (v || '').trim()
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function usedLineHeightPx(cs) {
  const lh = (cs.lineHeight || '').trim()
  const fs = parseFloat(cs.fontSize) || 16
  if (!lh || lh === 'normal') return Math.round(fs * 1.2)
  if (lh.endsWith('px')) return parseFloat(lh)
  if (/^\d+(\.\d+)?$/.test(lh)) return Math.round(parseFloat(lh) * fs)
  if (lh.endsWith('%')) return Math.round((parseFloat(lh) / 100) * fs)
  return Math.round(fs * 1.2)
}

function vpad(cs) {
  return (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
}

/** Plain text container: no element children, only text nodes and whitespace. */
function isPlainTextContainer(el) {
  if (el.childElementCount > 0) return false
  return Array.from(el.childNodes).some(n => n.nodeType === Node.TEXT_NODE)
}
