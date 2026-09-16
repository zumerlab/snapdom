// #502: a meter styled with `appearance: none` and its ::-webkit-meter-* parts exported with the
// browser's default meter. The part rules are carried by collectScrollbarCSS (pinned in
// utils.capture.helpers.test.js and, against the live element, visual.fidelity.livedom.test.js).
//
// This file pins the second half of the fix, found when the slider test in
// core.clone.nativeControls.test.js passed alone and failed next to its siblings. The base
// reset is memoized per tag set, but its content is pruned by the property universe, and the
// universe grows when CSS arrives. A capture that ran before any rule mentioned `appearance`
// left a reset without `appearance:none`; the class diff omits the value because it equals the
// tag default, so every later capture of those tags painted the native control. Code-split CSS
// in a single-page app reaches exactly this order.
//
// A checkbox is the witness because it ignores its background under `appearance: auto`. The
// report's meter is not: with an authored background every engine drops the native meter on
// its own, and it painted flat from the stale reset too. Firefox is skipped because it always
// paints the checkbox replacement from clone.js.

import { it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { isFirefox } from '../src/utils/browser.js'
import { universeFor, notifyStyleEpoch } from '../src/modules/styles.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

/** Share of pixels painted in the authored fill, #7fd8bd. */
function fillShare(canvas) {
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  let hits = 0
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - 0x7f) < 12 && Math.abs(data[i + 1] - 0xd8) < 12 && Math.abs(data[i + 2] - 0xbd) < 12) hits++
  }
  return hits / (data.length / 4)
}

it.skipIf(isFirefox())('keeps appearance:none from CSS that arrived after an earlier capture of the same tags', async () => {
  const box = document.createElement('input')
  box.type = 'checkbox'
  box.style.cssText = 'display:block;width:24px;height:24px;margin:0'
  document.body.appendChild(box)
  mounted.push(box)

  // No rule anywhere mentions `appearance` yet: this capture memoizes the `input` reset.
  await snapdom.toCanvas(box, { dpr: 1, burst: false })

  const style = document.createElement('style')
  style.textContent = 'input[type=checkbox]{appearance:none;-webkit-appearance:none;border:0;background:#7fd8bd}'
  document.head.appendChild(style)
  mounted.push(style)

  const canvas = await snapdom.toCanvas(box, { dpr: 1, burst: false })
  expect(fillShare(canvas)).toBeGreaterThan(0.9)
})

// The memo above is keyed on the universe's identity, and any DOM mutation bumps the epoch that
// re-scans it. Without keeping the Set when the props are the same, every capture of a live page
// rebuilt the reset (0.12-0.65 ms for 5-20 tags, measured on all three engines).
it('keeps the universe Set across a re-scan that finds the same props', () => {
  const before = universeFor(document.body)
  expect(before).toBeInstanceOf(Set)
  notifyStyleEpoch()
  expect(universeFor(document.body)).toBe(before)

  const style = document.createElement('style')
  style.textContent = '.u502{scroll-snap-stop:always}'
  document.head.appendChild(style)
  mounted.push(style)
  notifyStyleEpoch()
  const after = universeFor(document.body)
  expect(after).not.toBe(before)
  expect(after.has('scroll-snap-stop')).toBe(true)
})
