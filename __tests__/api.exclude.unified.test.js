// v3 exclude unification: one option accepts selectors and/or predicates (true = exclude);
// legacy filter (keep-polarity) still works and composes. The polarity flip at the alias
// boundary is the load-bearing assertion — a mistake would silently invert captures.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

function page() {
  const host = document.createElement('div')
  host.innerHTML = '<p class="keep">keep-me</p><p class="drop">drop-me</p>'
  document.body.appendChild(host)
  return host
}
const svgOf = async (el, opts) => decodeURIComponent((await snapdom(el, { cache: 'disabled', ...opts })).url.split(',')[1])

describe('unified exclude', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('selector string excludes', async () => {
    const svg = await svgOf(page(), { exclude: '.drop', excludeMode: 'remove' })
    expect(svg).toContain('keep-me')
    expect(svg).not.toContain('drop-me')
  })

  it('predicate excludes (true = exclude, matching the option name)', async () => {
    const svg = await svgOf(page(), { exclude: (el) => el.classList?.contains('drop'), excludeMode: 'remove' })
    expect(svg).toContain('keep-me')
    expect(svg).not.toContain('drop-me')
  })

  it('mixed array of selectors and predicates', async () => {
    const host = page()
    const extra = document.createElement('span')
    extra.className = 'also-drop'
    extra.textContent = 'also-me'
    host.appendChild(extra)
    const svg = await svgOf(host, { exclude: ['.drop', (el) => el.classList?.contains('also-drop')], excludeMode: 'remove' })
    expect(svg).toContain('keep-me')
    expect(svg).not.toContain('drop-me')
    expect(svg).not.toContain('also-me')
  })

  it('legacy filter keeps its KEEP polarity exactly (v2 compat)', async () => {
    const svg = await svgOf(page(), { filter: (el) => !el.classList?.contains('drop'), filterMode: 'remove' })
    expect(svg).toContain('keep-me')
    expect(svg).not.toContain('drop-me')
  })

  it('legacy filter and new exclude compose when both are passed', async () => {
    const host = page()
    const extra = document.createElement('span')
    extra.className = 'also-drop'
    extra.textContent = 'also-me'
    host.appendChild(extra)
    const svg = await svgOf(host, {
      exclude: '.drop',
      excludeMode: 'remove',
      filter: (el) => !el.classList?.contains('also-drop'),
      filterMode: 'remove',
    })
    expect(svg).toContain('keep-me')
    expect(svg).not.toContain('drop-me')
    expect(svg).not.toContain('also-me')
  })

  // 'hide' mode substitutes a layout-preserving spacer. Hardcoding it to inline-block
  // added a full line box for block-level nodes, and gave a display:none node a box it
  // never had live — both pushed everything below it down. `exclude` is the redaction
  // feature, so it is routinely pointed at selectors that also match hidden elements.
  describe('hide-mode spacer preserves layout exactly', () => {
    async function greenTop(host, opts) {
      const res = await snapdom(host, { dpr: 1, scale: 1, ...opts })
      const c = await res.toCanvas()
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      for (let y = 0; y < c.height; y++) {
        const i = (y * c.width + Math.floor(c.width / 2)) * 4
        if (d[i] < 80 && d[i + 1] > 100 && d[i + 2] < 80 && d[i + 3] > 40) return y
      }
      return -1
    }
    const scene = (piiStyle) => {
      const host = document.createElement('div')
      host.style.cssText = 'width:200px;font:16px Arial;background:#fff'
      host.innerHTML = '<div style="height:20px;background:blue"></div>' +
        `<div class="pii" style="${piiStyle}">secreto</div>` +
        '<div style="height:20px;background:green"></div>'
      document.body.appendChild(host)
      return host
    }

    it('a display:none exclusion adds no phantom box', async () => {
      const a = scene('display:none')
      const baseline = await greenTop(a)
      a.remove()
      const b = scene('display:none')
      const hidden = await greenTop(b, { exclude: ['.pii'] })
      b.remove()
      expect(hidden).toBe(baseline)
    })

    it('a visible block exclusion still holds its space (and remove still collapses it)', async () => {
      const a = scene('height:30px;background:#ccc')
      const baseline = await greenTop(a)
      a.remove()
      const b = scene('height:30px;background:#ccc')
      const hidden = await greenTop(b, { exclude: ['.pii'] })
      b.remove()
      const c = scene('height:30px;background:#ccc')
      const removed = await greenTop(c, { exclude: ['.pii'], excludeMode: 'remove' })
      c.remove()
      expect(hidden).toBe(baseline)
      expect(removed).toBeLessThan(baseline)
    })
  })
})
