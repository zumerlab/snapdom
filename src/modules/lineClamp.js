// src/core/lineClamp.js

/**
 * Apply line-clamp to element AND all descendants that have -webkit-line-clamp.
 * Fixes #386: ellipsis now renders for nested elements, not just the root.
 *
 * @param {Element} el - Root element (and its subtree) to process
 * @returns {() => void} Combined undo function
 */
export function lineClampTree(el) {
  if (!el) return () => {}
  const undos = []
  function walk(node) {
    const undo = lineClamp(node)
    if (undo) undos.push(undo)
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
 * @returns {() => void} undo function (no-op if nothing changed)
 */
export function lineClamp(el) {
  if (!el) return () => {}

  const lines = getClamp(el)
  if (lines <= 0) return () => {}

  if (!isPlainTextContainer(el)) return () => {}

  const cs = getComputedStyle(el)
  const targetH = Math.round(usedLineHeightPx(cs) * lines + vpad(cs))

  const original = el.textContent ?? ''
  // Guarda para restaurar
  const prevText = original

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

/* ---------------- helpers: idénticos a tu snippet ---------------- */

function getClamp(el) {
  const cs = getComputedStyle(el)
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
