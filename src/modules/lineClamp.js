// src/core/lineClamp.js

/**
 * Bake text truncation for the element AND all descendants that CSS would
 * truncate: multi-line `-webkit-line-clamp` and single-line
 * `text-overflow: ellipsis`. Firefox and Safari don't honour either inside a
 * `<foreignObject>`, so we resolve the ellipsis into the text up front.
 * Fixes #386 (nested clamp) and #431 (single-line ellipsis on Safari/Firefox).
 *
 * @param {Element} el - Root element (and its subtree) to process
 * @returns {() => void} Combined undo function
 */
export function lineClampTree(el) {
  if (!el) return () => {}
  const undos = []
  function walk(node) {
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
  // Guarda para restaurar
  const prevText = original

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

  // Si ya entra completo en N líneas, no hacemos nada (igual que el clamp nativo)
  if (el.scrollHeight <= targetH + 0.5) {
    return () => {}
  }

  // ==== Binary search sobre el largo del prefijo que entra con ellipsis ====
  let lo = 0, hi = original.length, best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    el.textContent = original.slice(0, mid) + '…'
    // Forzamos layout leyendo scrollHeight
    if (el.scrollHeight <= targetH + 0.5) {
      best = mid; lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  // Aplica el mejor corte (si nada entra, queda solo '…')
  el.textContent = (best >= 0 ? original.slice(0, best) : '') + '…'

  // Devuelve undo() para restaurar el DOM original tras clonar
  return () => {
    el.textContent = prevText
  }
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

  // Ya entra completo → el clamp nativo tampoco haría nada.
  if (el.scrollWidth <= el.clientWidth + 0.5) return () => {}

  const original = el.textContent ?? ''
  const prevText = original

  let lo = 0, hi = original.length, best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    el.textContent = original.slice(0, mid) + '…'
    if (el.scrollWidth <= el.clientWidth + 0.5) {
      best = mid; lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  el.textContent = (best >= 0 ? original.slice(0, best) : '') + '…'

  return () => {
    el.textContent = prevText
  }
}

/* ---------------- helpers: idénticos a tu snippet ---------------- */

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

/** Plain text container: sin hijos element, sólo nodos de texto/espacios. */
function isPlainTextContainer(el) {
  if (el.childElementCount > 0) return false
  return Array.from(el.childNodes).some(n => n.nodeType === Node.TEXT_NODE)
}
