import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index'

/**
 * An explicit `height` a descendant of the capture root receives from a STYLESHEET rule was
 * dropped by stripHeightForWrappers, while the same height written inline survived. The raster
 * came out at the right total size but every affected child collapsed to its content height and
 * the rest of the canvas stayed blank.
 *
 * Guard 2b was meant to bail out on an author-fixed height by comparing the used height against
 * `el.scrollHeight` — but scrollHeight is the padding-box height whenever the content is shorter
 * than the box, so `height: 400px` around one line of text gives scrollHeight === 400 === used
 * height and the difference is 0. It only ever caught a fixed height SMALLER than the content.
 * The guard now compares against the height the element would have with `height: auto`, measured
 * from the live layout.
 */

/** Size declaration snapdom emits for `el` in the exported SVG, or '' when absent. */
function sizeRuleFor(svg, selector) {
  const markup = svg.slice(svg.indexOf('<'))
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
  const el = doc.querySelector(`foreignObject ${selector}`)
  if (!el) return null
  const css = [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n')
  const classes = (el.getAttribute('class') || '').split(/\s+/).filter((c) => /^c\d+$/.test(c))
  for (const c of classes) {
    const rule = css.match(new RegExp(`\\.${c}\\s*\\{([^}]*)\\}`))
    if (!rule) continue
    const size = rule[1].match(/(?:^|;)\s*(?:block-size|height)\s*:\s*([^;]+)/)
    if (size) return size[1].trim()
  }
  return ''
}

/** Start row of every horizontal band of non-white ink in the canvas. */
function inkBandTops(canvas) {
  const { width, height } = canvas
  const data = canvas.getContext('2d').getImageData(0, 0, width, height).data
  const tops = []
  let inBand = false
  for (let y = 0; y < height; y++) {
    let ink = false
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (data[i + 3] === 0) continue
      if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) { ink = true; break }
    }
    if (ink && !inBand) tops.push(y)
    inBand = ink
  }
  return tops
}

const CAPTURE = { scale: 1, dpr: 1, outerShadows: false, outerTransforms: true }

describe('stripHeightForWrappers — author height from a stylesheet rule', () => {
  let root, sheet
  afterEach(() => { root?.remove(); sheet?.remove() })

  function mount(css, html) {
    sheet = document.createElement('style')
    sheet.textContent = css
    document.head.appendChild(sheet)
    root = document.createElement('div')
    root.innerHTML = html
    document.body.appendChild(root)
    return root
  }

  it('keeps a height that a descendant gets from a stylesheet rule', async () => {
    mount(
      '.sd-tall{height:400px}',
      '<div class="sd-host" style="width:300px;background:#fff;font:16px Arial">' +
      '<div class="sd-tall">ONE</div><div class="sd-tall">TWO</div><p>END</p></div>',
    )
    const host = root.querySelector('.sd-host')
    const tall = root.querySelector('.sd-tall')

    // The trap: scrollHeight equals the used height, so the old guard saw "auto".
    expect(getComputedStyle(tall).height).toBe('400px')
    expect(tall.scrollHeight).toBe(400)

    const svg = decodeURIComponent((await snapdom(host, CAPTURE)).url)
    expect(sizeRuleFor(svg, '.sd-tall')).toBe('400px')

    const canvas = await (await snapdom(host, CAPTURE)).toCanvas()
    const domTops = [...host.children].map((c) =>
      Math.round(c.getBoundingClientRect().top - host.getBoundingClientRect().top))
    expect(domTops).toEqual([0, 400, 816])
    // Each child paints its text where the live DOM puts it, not stacked at the top.
    const tops = inkBandTops(canvas)
    expect(tops.length).toBe(3)
    tops.forEach((t, i) => expect(Math.abs(t - domTops[i])).toBeLessThanOrEqual(4))
  })

  it('keeps the same height written inline (unchanged behaviour)', async () => {
    mount(
      '',
      '<div class="sd-host2" style="width:300px;background:#fff;font:16px Arial">' +
      '<div style="height:400px">ONE</div><div style="height:400px">TWO</div><p>END</p></div>',
    )
    const host = root.querySelector('.sd-host2')
    const canvas = await (await snapdom(host, CAPTURE)).toCanvas()
    const domTops = [...host.children].map((c) =>
      Math.round(c.getBoundingClientRect().top - host.getBoundingClientRect().top))
    const tops = inkBandTops(canvas)
    expect(tops.length).toBe(3)
    tops.forEach((t, i) => expect(Math.abs(t - domTops[i])).toBeLessThanOrEqual(4))
  })

  it('still strips the height of a wrapper whose height really is auto', async () => {
    // No height declared anywhere: the wrapper is a transparent flow box and dropping its
    // height is what lets margins collapse normally inside the foreignObject.
    mount(
      '.sd-auto{width:200px}.sd-auto > p{margin:20px 0}',
      '<div class="sd-auto"><p>collapsing</p></div>',
    )
    const svg = decodeURIComponent((await snapdom(root, CAPTURE)).url)
    expect(sizeRuleFor(svg, '.sd-auto')).toBe('')
  })

  it('still strips a stylesheet height that matches the content height exactly', async () => {
    // Redundant author height: the clone reflows to the same box, so removing it is a no-op
    // visually and keeps margin-collapsing working.
    mount(
      '.sd-same{width:200px;height:300px}.sd-same > .sd-inner{height:300px}',
      '<div class="sd-same"><div class="sd-inner">in flow</div></div>',
    )
    const svg = decodeURIComponent((await snapdom(root, CAPTURE)).url)
    expect(sizeRuleFor(svg, '.sd-same')).toBe('')
  })

  it('keeps a stylesheet height smaller than the content (overflowing box)', async () => {
    // The one case the scrollHeight comparison did catch — it must keep working.
    mount(
      '.sd-short{width:200px;height:20px;font:16px Arial}',
      '<div class="sd-short">one<br>two<br>three<br>four</div>',
    )
    const svg = decodeURIComponent((await snapdom(root, CAPTURE)).url)
    expect(sizeRuleFor(svg, '.sd-short')).toBe('20px')
  })

  it('keeps the height of a flex item taken from a stylesheet', async () => {
    mount(
      '.sd-flex{display:flex;width:300px}.sd-flex > .sd-item{flex:1;height:180px}',
      '<div class="sd-flex"><div class="sd-item">item</div></div>',
    )
    const svg = decodeURIComponent((await snapdom(root, CAPTURE)).url)
    expect(sizeRuleFor(svg, '.sd-item')).toBe('180px')
  })

  it('keeps the height of a scroll/overflow wrapper taken from a stylesheet', async () => {
    mount(
      '.sd-scroll{width:200px;height:120px;overflow:hidden;font:16px Arial}',
      '<div class="sd-scroll">a<br>b<br>c</div>',
    )
    const svg = decodeURIComponent((await snapdom(root, CAPTURE)).url)
    expect(sizeRuleFor(svg, '.sd-scroll')).toBe('120px')
  })

  it('keeps the height of a wrapper mixing in-flow text with an absolutely positioned child', async () => {
    // hasFlowFast passes (real text in flow) but the abspos overlay must not be counted as
    // content when deciding whether the height is "auto".
    mount(
      '.sd-mixed{position:relative;width:200px;height:200px;font:16px Arial}' +
      '.sd-mixed > .sd-overlay{position:absolute;inset:0}',
      '<div class="sd-mixed">label<div class="sd-overlay">overlay</div></div>',
    )
    const svg = decodeURIComponent((await snapdom(root, CAPTURE)).url)
    expect(sizeRuleFor(svg, '.sd-mixed')).toBe('200px')
  })
})
