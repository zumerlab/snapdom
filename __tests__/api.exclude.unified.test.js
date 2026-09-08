// Exclusion (true = omit) and filtering (truthy = keep) coexist with independent modes.
// Exclusion wins on overlaps, preserving the public v2 traversal contract.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { contextExport } from '../packages/plugins/context-export.js'
import { agentMap } from '../packages/plugins/agent-map.js'
import { htmlExport } from '../packages/plugins/html-export.js'

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

  it.each([null, undefined, false, 0, ''])('ignores non-function filters (%s) without dropping valid exclusions', async absent => {
    const svg = await svgOf(page(), { filter: absent, filterMode: absent, exclude: '.drop' })
    expect(svg).toContain('keep-me')
    expect(svg).not.toContain('drop-me')
  })

  it.each(['hide', 'remove'])('filter coexists with exclusion selectors (%s)', async filterMode => {
    const host = page()
    const extra = document.createElement('span')
    extra.className = 'also-drop'
    extra.textContent = 'also-me'
    host.appendChild(extra)
    const keep = (el) => !el.classList?.contains('also-drop')
    const svg = await svgOf(host, {
      exclude: ['.drop'], excludeMode: 'hide', filter: keep, filterMode,
    })
    expect(svg).toContain('keep-me')
    expect(svg).not.toContain('drop-me')
    expect(svg).not.toContain('also-me')
  })

  it.each([false, undefined, null, 0, '', NaN])('filter omits every falsy v2 keep result (%s)', async keepResult => {
    // The published v2 pipeline checked `!filter(node)`, not `filter(node) === false`.
    const keep = el => el.classList?.contains('drop') ? keepResult : 'truthy-keep'
    const svg = await svgOf(page(), { filter: keep, filterMode: 'remove' })
    expect(svg).toContain('keep-me')
    expect(svg).not.toContain('drop-me')
  })

  it.each(['selector', 'predicate', 'attribute'])('exclude short-circuits filter before resolveNode (%s)', async kind => {
    const host = page()
    const secret = host.querySelector('.drop')
    if (kind === 'attribute') secret.setAttribute('data-capture', 'exclude')
    const filter = vi.fn(el => el !== secret)
    const resolveNode = vi.fn()
    const exclude = kind === 'selector' ? '.drop' : kind === 'predicate' ? el => el === secret : []
    const svg = await svgOf(host, {
      exclude, excludeMode: 'hide', filter, filterMode: 'remove',
      plugins: [{ name: 'node-observer', resolveNode }],
    })
    expect(svg).not.toContain('drop-me')
    expect(filter.mock.calls.some(([node]) => node === secret)).toBe(false)
    expect(resolveNode.mock.calls.some(([node]) => node === secret)).toBe(false)
  })

  it('shares both policies with HTML and semantic exports, including beforeSnap changes', async () => {
    const host = page()
    host.querySelector('.keep').outerHTML = '<button class="keep">keep-me</button>'
    const extra = document.createElement('button')
    extra.className = 'filtered'
    extra.textContent = 'filtered-secret'
    host.append(extra)
    const original = host.outerHTML
    const result = await snapdom(host, {
      exclude: '.drop', excludeMode: 'hide',
      plugins: [{
        name: 'configure-filter',
        beforeSnap(ctx) { ctx.filter = el => !el.matches('.filtered'); ctx.filterMode = 'remove' },
        afterClone(ctx) {
          expect(ctx.shouldExclude(host.querySelector('.drop'))).toBe(true)
          expect(ctx.shouldExclude(extra)).toBe(true)
          expect(ctx.shouldExclude(host.querySelector('.keep'))).toBe(false)
        },
      }, htmlExport(), contextExport(), agentMap({ image: false })],
    })
    const outputs = [decodeURIComponent(result.url.split(',')[1]), await result.toHtml(),
      JSON.stringify(await result.toContext()), JSON.stringify(await result.toAgentMap())]
    for (const output of outputs) {
      expect(output).not.toContain('drop-me')
      expect(output).not.toContain('filtered-secret')
      expect(output).toContain('keep-me')
    }
    expect(host.outerHTML).toBe(original)
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
