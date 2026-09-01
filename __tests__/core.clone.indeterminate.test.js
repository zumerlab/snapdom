// An indeterminate checkbox lives in a DOM PROPERTY. XMLSerializer cannot emit it, so a
// cloned native control renders as plain unchecked — the middle state silently reads as
// "off". Firefox already avoided this because it takes the SVG replacement for every
// checkbox (it paints no native control inside a foreignObject); Chromium and WebKit did not.
//
// Measured on a 30px box, dark pixels for unchecked / indeterminate / checked:
//   chromium 116 / 116 / 778   webkit 10 / 10 / 57   firefox 224 / 272 / 826
// The middle number is the bug: on two engines it equalled the unchecked one.
//
// burst:false is load-bearing here. Setting .indeterminate or .checked programmatically
// fires no event and produces no mutation record, so auto-burst — which engages after three
// captures of the same element within 2s — serves the previous state and every reading comes
// out identical.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

function checkbox() {
  const wrap = document.createElement('div')
  wrap.style.cssText = 'background:#fff;padding:4px;width:40px'
  wrap.innerHTML = '<input type="checkbox" id="c" style="width:30px;height:30px;margin:0">'
  document.body.appendChild(wrap)
  mounted.push(wrap)
  return { wrap, box: wrap.querySelector('#c') }
}

async function darkPixels(el) {
  const c = await snapdom.toCanvas(el, {
    embedFonts: false, scale: 1, dpr: 1, backgroundColor: '#fff', burst: false,
  })
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let dark = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) dark++
  }
  return dark
}

describe('an indeterminate checkbox', () => {
  it('does not capture as unchecked', async () => {
    const { wrap, box } = checkbox()
    const unchecked = await darkPixels(wrap)
    box.indeterminate = true
    const indeterminate = await darkPixels(wrap)
    // Assert the ABSOLUTE ink the dash adds, not a ratio: the unchecked baseline differs
    // hugely per engine (10 on webkit, 224 on firefox, which draws its own replacement
    // border), so a ratio calibrated on one engine fails on another for no real reason. The
    // dash is a solid bar roughly inner-width x stroke — well over 30px of ink at this size.
    expect(indeterminate - unchecked).toBeGreaterThan(30)
  })

  it('still differs from checked', async () => {
    const { wrap, box } = checkbox()
    box.indeterminate = true
    const indeterminate = await darkPixels(wrap)
    box.indeterminate = false
    box.checked = true
    const checked = await darkPixels(wrap)
    expect(checked).not.toBe(indeterminate)
  })

  it('leaves an ordinary checkbox on its native rendering', async () => {
    const { wrap } = checkbox()
    const raw = await snapdom.toRaw(wrap, { embedFonts: false, burst: false })
    const svg = decodeURIComponent(raw.split(',')[1] || '')
    // Only the indeterminate state trades the native control for the drawn one — except on
    // Firefox, which replaces every checkbox for its own reason.
    if (!/Firefox/.test(navigator.userAgent)) {
      expect(/data-snapdom-input-replacement/.test(svg)).toBe(false)
    }
  })
})
