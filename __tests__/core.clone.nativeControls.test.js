// Native controls that no engine paints inside a foreignObject (imported from
// @frostin/snapdom, element-mirror). Measured on v3 before the change: a Firefox and a WebKit
// capture of a slider carried 0 pixels of its accent colour, a WebKit colour well painted its
// hex value as text, and a date field kept its machine value.
import { describe, it, expect, afterEach } from 'vitest'
import { deepClone } from '../src/core/clone.js'
import { createRangeReplacement } from '../src/utils/clone.helpers.js'
import { isFirefox, isSafari } from '../src/utils/browser.js'
import { snapdom } from '../src/index.js'

const session = () => ({
  styleMap: new Map(), styleCache: new WeakMap(), nodeMap: new Map(),
})

let mounted
afterEach(() => { mounted?.remove(); mounted = null })

function mount(html) {
  mounted = document.createElement('div')
  mounted.style.cssText = 'background:white;padding:8px;width:240px'
  mounted.innerHTML = html
  document.body.appendChild(mounted)
  return mounted.firstElementChild
}

/** The replacement's own SVG geometry, as numbers. */
function thumbOf(el) {
  const circle = el.querySelector('circle')
  return { cx: parseFloat(circle.getAttribute('cx')), fill: circle.getAttribute('fill') }
}

describe('createRangeReplacement', () => {
  it('places the thumb by value, between min and max', () => {
    const at = (value) => {
      const input = mount(`<input type="range" min="0" max="100" value="${value}" style="width:100px">`)
      const { el } = createRangeReplacement(input)
      const cx = thumbOf(el).cx
      mounted.remove(); mounted = null
      return cx
    }
    const low = at(0), mid = at(50), high = at(100)
    expect(low).toBeLessThan(mid)
    expect(mid).toBeLessThan(high)
    // The thumb stays inside the control at either extreme, as the native one does.
    expect(low).toBeGreaterThan(0)
    expect(high).toBeLessThan(100)
  })

  it('honours a non-zero min and a non-default max', () => {
    const input = mount('<input type="range" min="10" max="20" value="15" style="width:100px">')
    const { el } = createRangeReplacement(input)
    const { cx } = thumbOf(el)
    // Halfway: the thumb centre sits at the middle of its travel.
    expect(cx).toBeGreaterThan(40)
    expect(cx).toBeLessThan(60)
  })

  it('paints the authored accent colour, and never the `auto` keyword', () => {
    const input = mount('<input type="range" value="70" style="accent-color:rgb(255,0,102)">')
    const { el } = createRangeReplacement(input)
    expect(thumbOf(el).fill).toBe('rgb(255, 0, 102)')

    const plain = mount('<input type="range" value="70">')
    const { el: plainEl } = createRangeReplacement(plain)
    expect(thumbOf(plainEl).fill).not.toBe('auto')
    expect(CSS.supports('color', thumbOf(plainEl).fill)).toBe(true)
  })

  it('dims a disabled slider and keeps the control box', () => {
    const input = mount('<input type="range" value="50" disabled style="width:120px;height:20px">')
    const { el } = createRangeReplacement(input)
    expect(el.querySelector('svg').getAttribute('opacity')).toBe('0.5')
    expect(el.style.getPropertyValue('width')).toBe('120px')
    expect(el.style.getPropertyPriority('width')).toBe('important')
  })
})

describe('control clones per engine', () => {
  const replacesRange = isFirefox() || isSafari()

  it('clones a range as a replacement only where the engine needs it', async () => {
    const input = mount('<input type="range" value="70">')
    const clone = await deepClone(input, session(), {})
    if (replacesRange) {
      expect(clone.getAttribute('data-snapdom-input-replacement')).toBe('range')
      expect(clone.querySelector('circle')).not.toBeNull()
    } else {
      expect(clone.tagName).toBe('INPUT')
      expect(clone.getAttribute('type')).toBe('range')
    }
  })

  it('clones a colour well as a swatch on WebKit, untouched elsewhere', async () => {
    const input = mount('<input type="color" value="#ff0066">')
    const clone = await deepClone(input, session(), {})
    if (isSafari()) {
      // WebKit normalizes the inline hex to rgb() when reading it back.
      expect(clone.style.getPropertyValue('background-color').replace(/\s/g, ''))
        .toMatch(/^(#ff0066|rgb\(255,0,102\))$/)
      expect(clone.style.getPropertyValue('-webkit-text-fill-color')).toBe('transparent')
      expect(clone.hasAttribute('value')).toBe(false)
    } else {
      expect(clone.getAttribute('value')).toBe('#ff0066')
    }
  })

  it('clones a date field as its formatted text where the engine paints none', async () => {
    const input = mount('<input type="date" value="2026-08-29">')
    const clone = await deepClone(input, session(), {})
    if (isFirefox() || isSafari()) {
      expect(clone.getAttribute('type')).toBe('text')
      // Locale-formatted, so no assertion on the separator order — but never the raw value.
      expect(clone.getAttribute('value')).not.toBe('2026-08-29')
      expect(clone.getAttribute('value')).toMatch(/2026/)
    } else {
      expect(clone.getAttribute('type')).toBe('date')
      expect(clone.getAttribute('value')).toBe('2026-08-29')
    }
  })

  it('carries a time field through the same path', async () => {
    const input = mount('<input type="time" value="14:30">')
    const clone = await deepClone(input, session(), {})
    if (isFirefox() || isSafari()) {
      expect(clone.getAttribute('type')).toBe('text')
      expect(clone.getAttribute('value')).toBe('14:30')
    } else {
      expect(clone.getAttribute('type')).toBe('time')
    }
  })
})

describe('the raster carries the control', () => {
  const accentHits = (canvas, [r, g, b]) => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let hits = 0
    for (let i = 0; i < data.length; i += 4) {
      if (Math.abs(data[i] - r) < 40 && Math.abs(data[i + 1] - g) < 40 && Math.abs(data[i + 2] - b) < 40) hits++
    }
    return hits
  }

  it('paints the slider accent on every engine', async () => {
    mount('<input type="range" min="0" max="100" value="70" style="accent-color:rgb(255,0,102);width:180px">')
    const canvas = await snapdom.toCanvas(mounted, { dpr: 1, embedFonts: false })
    expect(accentHits(canvas, [255, 0, 102])).toBeGreaterThan(100)
  })

  it('paints the colour well on every engine', async () => {
    mount('<input type="color" value="#ff0066">')
    const canvas = await snapdom.toCanvas(mounted, { dpr: 1, embedFonts: false })
    expect(accentHits(canvas, [255, 0, 102])).toBeGreaterThan(100)
  })
})
