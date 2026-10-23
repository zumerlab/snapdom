// Right-to-left content the capture used to get wrong: a scrolled right-to-left scroller, the
// ellipsis of text running against its box's direction, and a right-to-left body capture
// whose container took the page's direction. The visual demos d-rtl-body and d-rtl-layout
// cover the same ground end to end.
import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'
import { textEllipsis } from '../src/modules/lineClamp.js'
import { isSafari } from '../src/utils/browser.js'

let host
let frame
afterEach(() => { host?.remove(); frame?.remove(); host = frame = null })

const AR = 'نص طويل جدا يجب أن يقطع بثلاث نقاط في النهاية اليسرى'
const EN = 'A very long English sentence that must be cut with an ellipsis at the end'

const firstX = (canvas, [r, g, b], y) => {
  const d = canvas.getContext('2d').getImageData(0, y, canvas.width, 1).data
  for (let x = 0; x < canvas.width; x++) {
    if (d[x * 4] === r && d[x * 4 + 1] === g && d[x * 4 + 2] === b && d[x * 4 + 3] === 255) return x
  }
  return -1
}

describe('a scrolled right-to-left scroller', () => {
  it('shows the items the page shows, in their order', async () => {
    host = document.createElement('div')
    host.innerHTML = '<div dir="rtl" style="width:300px;overflow-x:auto;white-space:nowrap;scrollbar-width:none;font-size:0">' +
      ['rgb(200,40,40)', 'rgb(250,150,40)', 'rgb(60,170,90)', 'rgb(50,110,210)', 'rgb(120,60,180)']
        .map((c) => `<span style="display:inline-block;width:90px;height:30px;background:${c}"></span>`).join('') + '</div>'
    document.body.appendChild(host)
    const scroller = host.firstChild
    scroller.scrollLeft = -100
    const box = scroller.getBoundingClientRect()
    const canvas = await snapdom.toCanvas(scroller, { dpr: 1, cache: 'disabled' })
    for (const [i, rgb] of [[1, [250, 150, 40]], [2, [60, 170, 90]], [3, [50, 110, 210]]]) {
      const r = scroller.children[i].getBoundingClientRect()
      expect(firstX(canvas, rgb, 15)).toBe(Math.max(0, Math.round(r.left - box.left)))
    }
  })
})

describe('text-overflow: ellipsis keeps the end the page keeps', () => {
  const bake = (text, dir) => {
    host = document.createElement('div')
    host.dir = dir
    host.style.cssText = 'width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font:15px Arial'
    host.textContent = text
    document.body.appendChild(host)
    textEllipsis(host)
    return host.textContent.replace('\u2026', '').replace('\u200D', '')
  }

  it('the start, when text and box run the same way', () => {
    expect(EN.startsWith(bake(EN, 'ltr'))).toBe(true)
    host.remove()
    expect(AR.startsWith(bake(AR, 'rtl'))).toBe(true)
  })

  it('the end, when the text runs against its box', () => {
    expect(AR.endsWith(bake(AR, 'ltr'))).toBe(true)
    host.remove()
    expect(EN.endsWith(bake(EN, 'rtl'))).toBe(true)
  })

  // One long word, so the cut always lands inside it.
  it('joins an Arabic letter cut mid-word, except on WebKit', () => {
    bake('مستشفياتهمواستراتيجياتهموتكنولوجياتهمومسؤولياتهم', 'rtl')
    expect(host.textContent.includes('\u200D')).toBe(!isSafari())
  })
})

describe('a right-to-left body capture', () => {
  const capture = async (css) => {
    frame = document.createElement('iframe')
    frame.style.cssText = 'width:800px;height:300px;border:0'
    frame.srcdoc = `<!doctype html><html dir="rtl"><head><style>body{background:rgb(244,241,234)}.c{height:60px;background:rgb(204,204,204)}${css}</style></head>` +
      '<body><div class="c"></div><div class="c w"></div></body></html>'
    await new Promise(resolve => { frame.onload = resolve; document.body.appendChild(frame) })
    return snapdom.toCanvas(frame.contentDocument.body, { dpr: 1, embedFonts: false, cache: 'disabled' })
  }

  // The body box is 784px wide; ink on its right makes the capture wider than the box, which is
  // where a right-to-left container right-aligned the clone.
  it('starts the body where the left spill ends, with ink on the right', async () => {
    const canvas = await capture('.c:first-child{box-shadow:6px 0 0 rgb(40,160,90)}.w{width:1000px}')
    const px = (x) => [...canvas.getContext('2d').getImageData(x, 30, 1, 1).data]
    expect(firstX(canvas, [204, 204, 204], 30)).toBe(1000 - 784)
    expect(px(1000)).toEqual([40, 160, 90, 255])
    expect(px(1005)).toEqual([40, 160, 90, 255])
    // Past the shadow only the page canvas shows (the shadow parser reserves the whole margin).
    for (let x = 1006; x < canvas.width; x++) expect(px(x)).toEqual([244, 241, 234, 255])
  })

  it('paints the page canvas colour where the body spills', async () => {
    const canvas = await capture('.w{width:1000px}')
    expect([...canvas.getContext('2d').getImageData(10, 30, 1, 1).data]).toEqual([244, 241, 234, 255])
  })
})
