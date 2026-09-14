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

    it.each(['exclude', 'filter'])('ignores zoom-rounded offsets when %s hides a block', async policy => {
      const host = scene('height:30px;background:#ccc')
      const baseline = await greenTop(host)
      const secret = host.querySelector('.pii')
      // Safari at page zoom 85% reports 31 for this actual 30px CSS box. Simulating
      // that browser measurement keeps this regression deterministic in every engine.
      Object.defineProperty(secret, 'offsetHeight', { configurable: true, value: 31 })
      const opts = policy === 'exclude' ? { exclude: '.pii' } : { filter: el => el !== secret }
      expect(await greenTop(host, opts)).toBe(baseline)
      expect(host.querySelector('.pii')).toBe(secret)
    })

    const flexRow = (piiStyle) => {
      const host = document.createElement('div')
      host.style.cssText = 'display:flex;width:300px;height:40px;background:white'
      host.innerHTML = '<div style="width:20px;background:blue"></div>' +
        `<div class="pii" style="${piiStyle}">secret</div>` +
        '<div style="width:20px;background:green"></div>'
      document.body.append(host)
      return host
    }
    const greenLeft = async (host, opts) => {
      const canvas = await (await snapdom(host, { dpr: 1, embedFonts: false, ...opts })).toCanvas()
      const row = canvas.getContext('2d').getImageData(0, 10, canvas.width, 1).data
      for (let x = 0; x < canvas.width; x++) {
        const i = x * 4
        if (row[i] < 80 && row[i + 1] > 100 && row[i + 2] < 80 && row[i + 3] > 40) return x
      }
      return -1
    }

    it('does not move a flex sibling when offsetWidth rounds up', async () => {
      const host = flexRow('width:30px;background:#ccc')
      const baseline = await greenLeft(host)
      Object.defineProperty(host.querySelector('.pii'), 'offsetWidth', { configurable: true, value: 31 })
      expect(await greenLeft(host, { exclude: '.pii' })).toBe(baseline)
      expect(baseline).toBe(50)
    })

    // Blink and WebKit resolve the `width` of a content-box scroller WITHOUT its classic
    // scrollbar, while offsetWidth spans it; the spacer built from the used value lost the
    // gutter and pulled the sibling left (WebKit: 205 for 220). A border-box scroller's
    // used width already spans the scrollbar, so it guards against counting it twice.
    it.each(['content-box', 'border-box'])('keeps the scrollbar gutter of an overflow:scroll %s in its spacer', async boxSizing => {
      const host = flexRow(`box-sizing:${boxSizing};width:200px;overflow:scroll;background:#ccc`)
      const pii = host.querySelector('.pii')
      // A styled scrollbar is never overlay in WebKit, so the gutter exists even where the
      // system setting hides scrollbars until scrolled (macOS). Playwright's headless
      // Chromium runs with --hide-scrollbars, where every scrollbar measures 0.
      host.prepend(Object.assign(document.createElement('style'), { textContent: '.pii::-webkit-scrollbar{width:15px;height:15px}' }))
      if (pii.offsetWidth - pii.clientWidth <= 0) {
        console.log('no scrollbar gutter on this engine (overlay or hidden scrollbars): assertion skipped')
        return
      }
      const baseline = await greenLeft(host)
      expect(baseline).toBe(220)
      expect(await greenLeft(host, { exclude: '.pii' })).toBe(baseline)
    })

    it('does not add a gutter the resolved width already spans', async () => {
      const host = flexRow('width:200px;overflow:scroll;background:#ccc')
      const pii = host.querySelector('.pii')
      const baseline = await greenLeft(host)
      expect(baseline).toBe(220)
      // Gecko resolves `width` to 200px with a 15px classic scrollbar inside it, so offset
      // minus client is the scrollbar alone. Faked, because no engine paints a classic
      // scrollbar on a headless macOS run and the spacer reads exactly these three values.
      Object.defineProperty(pii, 'offsetWidth', { configurable: true, value: 200 })
      Object.defineProperty(pii, 'clientWidth', { configurable: true, value: 185 })
      expect(await greenLeft(host, { exclude: '.pii' })).toBe(baseline)
    })

    it('keeps fractional block sizes instead of accumulating integer rounding', async () => {
      const host = scene('height:10.25px;background:#ccc')
      const secret = host.querySelector('.pii')
      secret.after(secret.cloneNode(true), secret.cloneNode(true))
      const baseline = await greenTop(host)
      expect(await greenTop(host, { exclude: '.pii' })).toBe(baseline)
      expect(baseline).toBe(51)
    })

    it.each(['content-box', 'border-box'])('uses the complete %s size under an ancestor transform', async boxSizing => {
      const cssHeight = boxSizing === 'content-box' ? 20 : 32
      const host = scene(`box-sizing:${boxSizing};height:${cssHeight}px;padding:4px;border:2px solid black;background:#ccc`)
      host.style.transform = 'scale(2)'
      host.style.transformOrigin = 'top left'
      const baseline = await greenTop(host)
      Object.defineProperty(host.querySelector('.pii'), 'offsetHeight', { configurable: true, value: 33 })
      expect(await greenTop(host, { exclude: '.pii' })).toBe(baseline)
      // The exporter pads transformed capture bounds; compare its actual baseline
      // while verifying the scale really applied, rather than assuming a zero inset.
      expect(baseline).toBeGreaterThan(100)
    })

    it.each(['hide', 'remove'])('filter and existing selectors preserve %s layout', async filterMode => {
      const host = scene('height:30px;background:#ccc')
      const extra = document.createElement('div')
      extra.className = 'also-pii'
      extra.style.cssText = 'height:15px;background:#ccc'
      extra.textContent = 'also-secret'
      host.insertBefore(extra, host.lastElementChild)
      const baseline = await greenTop(host)
      const keep = el => !el.matches('.also-pii')
      const opts = { exclude: ['.pii'], excludeMode: 'hide', filter: keep, filterMode }
      const svg = await svgOf(host, opts)
      expect(svg).not.toContain('secreto')
      expect(svg).not.toContain('also-secret')
      expect(await greenTop(host, opts)).toBe(filterMode === 'hide' ? baseline : baseline - 15)
    })

    it.each([
      ['hide', 'hide', 60], ['hide', 'remove', 40],
      ['remove', 'hide', 20], ['remove', 'remove', 0],
    ])('independent modes preserve overlap precedence (%s/%s)', async (excludeMode, filterMode, greenY) => {
      const host = document.createElement('div')
      host.style.cssText = 'width:200px;background:white;font:16px Arial'
      host.innerHTML = '<div class="excluded" style="height:30px">excluded-secret</div>' +
        '<div class="filtered" style="height:20px">filtered-secret</div>' +
        '<div class="overlap" data-capture="exclude" style="height:10px">overlap-secret</div>' +
        '<div style="height:20px;background:green">Public</div>'
      document.body.append(host)
      const original = host.outerHTML
      const opts = { exclude: '.excluded', excludeMode, filter: el => !el.matches('.filtered, .overlap'), filterMode }
      const result = await snapdom(host, { ...opts, dpr: 1, embedFonts: false })
      const svg = decodeURIComponent(result.url.split(',')[1])
      expect(svg).not.toContain('-secret')
      expect(svg).toContain('Public')
      // Existing canvas bounds may retain trailing space; remove must collapse the flow
      // position of the public marker without clipping it out of the export.
      expect((await result.toCanvas()).height).toBeGreaterThanOrEqual(greenY + 20)
      expect(await greenTop(host, opts)).toBe(greenY)
      expect(host.outerHTML).toBe(original)
    })
  })
})
