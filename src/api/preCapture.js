/**
 * `snapdom.preCapture()`: the capture that is ready before the click.
 *
 * Link prefetch, translated: capture on intent (pointer over, focus), before the click. The
 * destination is learned: a capture begun in the same event task as a press belongs to the
 * pressed control, and later intent over it recaptures that element, so the click is a memo
 * hit (core/burst.js) and pays only the export.
 *
 * Before any control is known, the first intent warms the visible viewport once (79-demo
 * corpus, 2026-09-03: a visible element then captures at 1.1x its steady state, 3.3x cold).
 * Nothing runs until an intent event.
 * Pinned by __tests__/api.preCapture.test.js.
 * @module api/preCapture
 */

/** The public capture entry, bound by api/snapdom.js (which imports this module), so a
 *  prefetch is exactly a capture: same hooks, same burst state. */
let capture = null
export function bindCapture(fn) { capture = fn }

/** What counts as a control: the nearest of these above the node the user touched. */
const CONTROL = 'button, a[href], [role="button"], input, select, summary, label, [tabindex]'

let armed = false
/** @type {{control: Element}|null} */
let lastIntent = null
/** Control to { element, options }, learned from the capture that followed a press. */
const targets = new WeakMap()
let viewportWarmed = false

/**
 * Learn the control for `element` when a press preceded this capture in the same event task.
 * A `burst: false` capture is never served from a memo, so nothing is learned from it (the
 * viewport warm below is one).
 * @param {Element} element
 * @param {object} [options] the caller's option bag; top-level values are snapshotted
 */
export function noteCapture(element, options) {
  if (!armed || !lastIntent || (options && options.burst === false)) return
  targets.set(lastIntent.control, {
    element,
    options: options && typeof options === 'object' ? { ...options } : options,
  })
}

function openIntent(control) {
  const intent = { control }
  lastIntent = intent
  // Event handlers and their microtasks can attribute a capture. A timer/network callback is
  // a new task and may be unrelated; the old one-second window falsely learned those.
  setTimeout(() => { if (lastIntent === intent) lastIntent = null }, 0)
}

function controlOf(event) {
  const t = event.target
  const el = t && (t.nodeType === 1 ? t : t.parentElement)
  return el && el.closest ? el.closest(CONTROL) : null
}

function onPress(event) {
  if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return
  const control = controlOf(event)
  if (!control) return
  openIntent(control)
  // A press is late intent: prefetch a known target, but do not start the broad viewport warm
  // where it would compete with the click handler that is about to request its own capture.
  onIntent(event, false)
}

function onClick(event) {
  const control = controlOf(event)
  if (control) openIntent(control)
}

function onIntent(event, allowViewportWarm = true) {
  if (!capture || document.visibilityState === 'hidden') return
  const control = controlOf(event)
  if (!control) return
  // pointerenter fires again for every descendant crossed; only the control's own counts, or
  // <button><span>...</span> launches two prefetches.
  if (event.type === 'pointerenter' && event.target !== control) return
  const known = targets.get(control)
  if (known) {
    if (!known.element.isConnected) { targets.delete(control); return }
    capture(known.element, known.options).catch(() => {})
    return
  }
  if (allowViewportWarm && !viewportWarmed) {
    viewportWarmed = true
    capture(document.body, { clip: 'viewport', burst: false }).catch(() => {})
  }
}

/**
 * Arm it once, at setup. Capture-phase listeners on the document, so `pointerenter`, which
 * does not bubble, is still seen for every control. Idempotent, and a no-op without a DOM.
 */
export function preCapture() {
  if (armed || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return
  armed = true
  const opts = { capture: true, passive: true }
  document.addEventListener('pointerdown', onPress, opts)
  document.addEventListener('keydown', onPress, opts)
  document.addEventListener('click', onClick, opts)
  document.addEventListener('pointerenter', onIntent, opts)
  document.addEventListener('focusin', onIntent, opts)
}
