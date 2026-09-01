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
    // Cheap guard BEFORE the expensive getComputedStyle (hot path).
    //
    // Both passes can only ever act on a *plain text container*: lineClamp()
    // and textEllipsis() each bail out early via isPlainTextContainer(el),
    // which requires `childElementCount === 0` AND at least one text node.
    // So any element with element children — or with no text at all — cannot
    // possibly be clamped, and reading its computed style is pure waste.
    // That is the overwhelming majority of nodes in a real DOM, and it is a
    // strict superset check: nothing that could be clamped is ever skipped,
    // so behaviour is bit-for-bit identical.
    //
    // Note the guard is deliberately structural, NOT `el.style.*`-based:
    // class-driven clamping (`-webkit-line-clamp` from a stylesheet, or
    // text-overflow via a utility class) leaves no trace in the inline style,
    // so an inline-only guard would silently drop real ellipsis.
    if (isPlainTextContainerFast(node)) {
      // One computed-style read per node, shared by both passes (hot path).
      const cs = getComputedStyle(node)
      const u1 = lineClamp(node, cs)
      if (u1) undos.push(u1)
      const u2 = textEllipsis(node, cs)
      if (u2) undos.push(u2)
    }
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

  // Mutates the live element's text nodes in place (never textContent, #485).
  const text = textNodeWriter(el)
  const original = text.text

  // Measure the REAL rendered line height instead of guessing from CSS.
  // `line-height: normal` is font-metric dependent, and inside a -webkit-box the
  // line box never shrinks below the font strut, so a value smaller than the
  // glyph height (e.g. line-height:18px on 20px text) still lays out taller. A
  // fs*1.2 / raw-CSS guess mis-sizes targetH and clamps to the wrong line count (#443).
  const pad = vpad(cs)
  text.write('X')
  const perLine = el.scrollHeight - pad
  text.restore()
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
    text.write(original.slice(0, mid) + '…')
    // Forzamos layout leyendo scrollHeight
    if (el.scrollHeight <= targetH + 0.5) {
      best = mid; lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  // Aplica el mejor corte (si nada entra, queda solo '…')
  text.write((best >= 0 ? original.slice(0, best) : '') + '…')

  // Devuelve undo() para restaurar el DOM original tras clonar
  return () => {
    text.restore()
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

  // Mutates the live element's text nodes in place (never textContent, #485).
  const text = textNodeWriter(el)
  const original = text.text

  let lo = 0, hi = original.length, best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    text.write(original.slice(0, mid) + '…')
    if (el.scrollWidth <= el.clientWidth + 0.5) {
      best = mid; lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  text.write((best >= 0 ? original.slice(0, best) : '') + '…')

  return () => {
    text.restore()
  }
}

/**
 * Rewrites an element's text WITHOUT replacing its text nodes.
 *
 * `el.textContent = value` is destructive: the browser drops every child node and inserts a fresh
 * text node. Frameworks that keep a reference to the original node (React fibers, Vue vnodes,
 * Svelte blocks) then fail on their next update with
 * `NotFoundError: Failed to execute 'removeChild'` — long after the capture, which makes it very
 * hard to trace back (#485). Writing `node.data` mutates the same node in place, exactly what
 * React itself does for a single-text-child update, so node identity survives the measurement.
 *
 * Callers are gated by isPlainTextContainer(), so the element has no element children: writing
 * the whole string into the first text node and blanking the rest lays out identically to a
 * textContent write, and restore() puts every original chunk back where it was.
 *
 * @param {Element} el
 * @returns {{text: string, write: (value: string) => void, restore: () => void}}
 */
function textNodeWriter(el) {
  const nodes = []
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === Node.TEXT_NODE) nodes.push(n)
  }
  const original = nodes.map((n) => n.data)
  return {
    text: original.join(''),
    write(value) {
      nodes[0].data = value
      for (let i = 1; i < nodes.length; i++) nodes[i].data = ''
    },
    restore() {
      for (let i = 0; i < nodes.length; i++) nodes[i].data = original[i]
    },
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

/**
 * Allocation-free, side-effect-free version of isPlainTextContainer().
 *
 * Same predicate, but walks childNodes with a plain for-loop instead of
 * `Array.from(...).some(...)` — no intermediate array per element — and
 * short-circuits on the first text node.
 *
 * Used as the hot-path guard in lineClampTree(): it must stay *exactly*
 * equivalent to isPlainTextContainer(), otherwise elements that would clamp
 * stop clamping (or vice-versa).
 *
 * @param {Element} el
 * @returns {boolean}
 */
function isPlainTextContainerFast(el) {
  if (el.childElementCount > 0) return false
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === Node.TEXT_NODE) return true
  }
  return false
}
