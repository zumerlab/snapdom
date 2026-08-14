// v3 exclude unification: ONE option accepts selectors and/or predicates (true = exclude).
// v2's keep-polarity `filter` is removed rather than aliased, so the polarity assertions
// here are load-bearing: getting them backwards would silently invert what a capture hides.
import { describe, it, expect, afterEach, vi } from 'vitest'
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

  // v3 removed `filter`/`filterMode`: one decision, one door. Ignoring them QUIETLY would be
  // the worst outcome for a redaction option (the capture would just stop hiding what the
  // caller asked to hide), so the removal has to be audible.
  it('legacy filter is NOT applied, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const svg = await svgOf(page(), { filter: (el) => !el.classList?.contains('drop'), filterMode: 'remove' })
    expect(warn).toHaveBeenCalled()
    expect(String(warn.mock.calls[0][0])).toContain('exclude')
    // Nothing was excluded: the caller has to migrate, and now knows it.
    expect(svg).toContain('keep-me')
    expect(svg).toContain('drop-me')
    warn.mockRestore()
  })

  it('the migration is a polarity flip: filter(keep) becomes exclude(!keep)', async () => {
    const host = page()
    const extra = document.createElement('span')
    extra.className = 'also-drop'
    extra.textContent = 'also-me'
    host.appendChild(extra)
    const keep = (el) => !el.classList?.contains('also-drop')
    const svg = await svgOf(host, {
      exclude: ['.drop', (el) => !keep(el)],
      excludeMode: 'remove',
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
