/**
 * `snapdom.preCapture()`: the capture that is ready before the click.
 *
 * Link prefetch, translated. A link declares its destination and the browser picks the
 * moment: when the user shows intent (pointer over it, focus, pointer down), 100 to 400 ms
 * before the click. A capture has no href, so the destination is learned instead: a capture
 * that runs within a second of a pointerdown (or an Enter/Space keydown) is attributed to
 * the control that was pressed, and from then on intent over that control captures its
 * element, with the options that call used. Memoization engages on an element's first
 * capture (core/burst.js), so the click that follows is served from that capture and pays
 * only the export; a changed element is invalidated or rebuilt by the diff path as always.
 *
 * Before any control is known, intent still buys the part that needs no target: the first
 * intent on the page captures the visible viewport once and discards it, which leaves the
 * style snapshots, fonts and images of everything on screen warm for whichever element is
 * asked for first (measured 2026-09-03 on the 79-demo corpus: a visible element captured
 * after such a warm runs at 1.1x its steady state, against 3.3x cold).
 *
 * No argument, no attribute, no background work: nothing runs until a human interacts. A
 * programmatic capture needs none of this, because it is its own notice: capture early,
 * and the later call is a memo hit or a diff.
 * Pinned by __tests__/api.preCapture.test.js.
 * @module api/preCapture
 */

/** The public capture entry, bound by api/snapdom.js at load: a prefetch is exactly a
 *  capture, same hooks, same burst state. Bound rather than imported, because that module
 *  imports this one. */
let capture = null
export function bindCapture(fn) { capture = fn }

/** How long after a press a capture is still attributed to the pressed control. */
const INTENT_WINDOW_MS = 1000
/** What counts as a control: the nearest of these above the node the user touched. */
const CONTROL = 'button, a[href], [role="button"], input, select, summary, label, [tabindex]'

let armed = false
/** @type {{control: Element, at: number}|null} */
let lastIntent = null
/** control -> { element, options } learned from the capture that followed a press. */
const targets = new WeakMap()
let viewportWarmed = false

/**
 * Called by every capture (api/snapdom.js): learns the control for this element when a
 * press preceded the call within the window. A `burst: false` capture cannot be served
 * from a memo, so there is nothing to learn from it; the viewport warm below is one.
 * @param {Element} element
 * @param {object} [options] the caller's own option bag, kept by reference for the prefetch
 */
export function noteCapture(element, options) {
  if (!armed || !lastIntent || (options && options.burst === false)) return
  if (performance.now() - lastIntent.at > INTENT_WINDOW_MS) return
  targets.set(lastIntent.control, { element, options })
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
  lastIntent = { control, at: performance.now() }
  onIntent(event)
}

function onIntent(event) {
  if (!capture || document.visibilityState === 'hidden') return
  const control = controlOf(event)
  if (!control) return
  const known = targets.get(control)
  if (known) {
    if (!known.element.isConnected) { targets.delete(control); return }
    capture(known.element, known.options).catch(() => {})
    return
  }
  if (!viewportWarmed) {
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
  document.addEventListener('pointerenter', onIntent, opts)
  document.addEventListener('focusin', onIntent, opts)
}
