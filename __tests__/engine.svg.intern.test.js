// Inline-style interning (svg engine): repeated author inline styles are deduped into
// [data-sdi] attribute rules at serialize time. These gates pin the three claims the
// optimization stands on: bytes shrink, pixels do not move, and author <style> text is
// never rewritten. (On Safari the pass is off — fixSafariShadows rewrites style attrs.)
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index'
import { isSafari } from '../src/utils/browser.js'

let host
afterEach(() => { host?.remove(); host = null })

// 80 rows, not 40: the pass runs only past 2048 saved bytes, and what a row's attribute
// weighs in the markup is per engine. Firefox keeps the 42-byte authored text verbatim
// (40 rows saved 1512 bytes and the pass stayed off); Chromium re-serializes it to ~105
// bytes because the background pass writes the layout longhands and Blink rewrites the
// attribute on a same-value write. 80 verbatim rows save 3276 bytes on every engine.
const ROWS = 80

function repetitiveFixture(rows = ROWS) {
  host = document.createElement('div')
  host.style.cssText = 'width:300px;background:#fff'
  let html = ''
  for (let i = 0; i < rows; i++) {
    html += `<div style="height:10px;background:${i % 2 ? '#e00000' : '#0000e0'};margin:1px"></div>`
  }
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}

const svgTextOf = (url) => decodeURIComponent(url.split(',').slice(1).join(','))

describe('svg engine: inline-style interning', () => {
  it('dedupes repeated style attributes into [data-sdi] rules and keeps pixels', async () => {
    const el = repetitiveFixture()
    const res = await snapdom(el, { burst: false })
    const svgText = svgTextOf(res.url)

    if (!isSafari()) {
      // byte gate: the rows collapse to 2 rules (red rows / blue rows)
      const rules = svgText.match(/\[data-sdi="[^"]+"\]\{/g) || []
      expect(rules.length).toBeGreaterThanOrEqual(2)
      const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
      expect(doc.querySelector('parsererror')).toBeNull()
      // a couple of rows can carry a node-specific byte (edge normalization) and stay
      // inline — the pass only interns EXACT duplicates
      expect(doc.querySelectorAll('[data-sdi]').length).toBeGreaterThanOrEqual(ROWS - 4)
    }

    // pixel gate (both engines/paths): the rows must actually paint
    const canvas = await res.toCanvas()
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    let red = 0, blue = 0
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 180 && d[i + 2] < 80) red++
      if (d[i + 2] > 180 && d[i] < 80) blue++
    }
    expect(red).toBeGreaterThan(3000)
    expect(blue).toBeGreaterThan(3000)
  })

  it('never rewrites author <style> text, even when it contains the attribute pattern', async () => {
    const el = repetitiveFixture()
    const trap = document.createElement('style')
    // the literal sequence ` style="` inside CSS text — a selector no real node matches
    trap.textContent = 'div[ style="never-matches"]{outline:1px solid lime}'
    el.prepend(trap)
    const res = await snapdom(el, { burst: false })
    const svgText = svgTextOf(res.url)
    // the pass must have run, or the trap below proves nothing
    if (!isSafari()) expect(svgText).toContain(' data-sdi="')
    expect(svgText).toContain('div[ style="never-matches"]')
    expect(svgText).not.toContain('div[ data-sdi=')
  })

  it('leaves low-repetition captures untouched (threshold)', async () => {
    host = document.createElement('div')
    host.style.cssText = 'width:120px;height:40px;background:#0a0'
    host.innerHTML = '<span style="color:#fff">hi</span>'
    document.body.appendChild(host)
    const res = await snapdom(host, { burst: false })
    expect(svgTextOf(res.url)).not.toContain('data-sdi')
  })
})
