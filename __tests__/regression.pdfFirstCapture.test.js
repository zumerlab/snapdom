// Bestiary-Builder/Bestiary-Builder#150 ran every PDF export twice because "the first one
// tends to have some issues": the first export's text was invisible. The page is a dark
// theme that loads Google Fonts (a cross-origin sheet whose cssRules throw), turns the text
// black for print with `.to-print-text, .to-print-text * { color: #000 }` and draws it on a
// white page, captured with { plugins: [pdf({ breakAvoid: true })], scale: 2, quality: 1,
// backgroundColor: '#fff', fast: false, embedFonts: true } on @zumer/snapdom 3.7.1.
//
// That is the #554 shape (regression.resetUniverse.test.js): the fetched copy of the
// cross-origin sheet lands mid-capture, the base reset is built from a narrower universe than
// the snapshots were pruned by, the black child's `-webkit-text-fill-color` equals the default
// and is diffed out, and nothing restates it, so the child paints its parent's light fill.
// Light grey on a white PDF page reads as "invisible text". The afterClone hook holds the
// capture open where the copy landed under a real font request.
//
// One capture, no warm-up, and both of its outputs are read as pixels: the canvas, and the
// page pdf.js renders from the PDF, whose raster is the same capture drawn again through the
// plugin's canvas facade. The PDF's text layer is read as well, since the report is about
// the first export of a capture, not only its paint.
import { afterEach, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/build/pdf.mjs'
import { snapdom } from '../src/index.js'
import { pdf } from '../packages/pdf/src/index.js'

GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

function mount(el) { document.body.appendChild(el); mounted.push(el); return el }

async function linkCrossOriginSheet(css) {
  const href = await commands.serveCrossOriginCss(css, { cors: true })
  const link = mount(document.createElement('link'))
  link.rel = 'stylesheet'
  await new Promise((resolve, reject) => { link.onload = resolve; link.onerror = reject; link.href = href })
  expect(() => link.sheet.cssRules).toThrow() // the first scan really cannot read it
}

/**
 * Dark, light-grey and white pixels of one region. Black text on white leaves an
 * anti-aliased fringe, so a few light-grey pixels are normal; text painted in the parent's
 * #e8e8e8 leaves NO dark pixel at all, and more light than dark.
 */
function inks(data, width, box) {
  const d = data
  let dark = 0
  let light = 0
  let white = 0
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      const i = (y * width + x) * 4
      const r = d[i]; const g = d[i + 1]; const b = d[i + 2]
      if (r > 245 && g > 245 && b > 245) white++
      else if (r < 60 && g < 60 && b < 60) dark++
      else if (r >= 200 && g >= 200 && b >= 200) light++
    }
  }
  return { dark, light, white }
}

/** Bounding box of the pixels `match` accepts inside `within`, or null. */
function bboxOf(data, width, within, match) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1
  for (let y = within.y; y < within.y + within.h; y++) {
    for (let x = within.x; x < within.x + within.w; x++) {
      const i = (y * width + x) * 4
      if (!match(data[i], data[i + 1], data[i + 2])) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

function inset(box, px) { return { x: box.x + px, y: box.y + px, w: box.w - 2 * px, h: box.h - 2 * px } }

/** The white print block inside the dark theme block, found from the pixels themselves. */
function printBlockInks(canvas) {
  const width = canvas.width
  const data = canvas.getContext('2d').getImageData(0, 0, width, canvas.height).data
  const whole = { x: 0, y: 0, w: width, h: canvas.height }
  const theme = bboxOf(data, width, whole, (r, g, b) => r >= 8 && r <= 40 && g >= 8 && g <= 40 && b >= 8 && b <= 40)
  expect(theme, 'the dark theme block is in the raster').not.toBeNull()
  const block = bboxOf(data, width, theme, (r, g, b) => r > 245 && g > 245 && b > 245)
  expect(block, 'the white print block is in the raster').not.toBeNull()
  return inks(data, width, inset(block, 4))
}

it('the first capture and its first PDF paint the print text black inside a dark theme (#554 shape)', async () => {
  await linkCrossOriginSheet('.bb-google-fonts-stand-in{font-family:"Space Mono",monospace}')
  const style = mount(document.createElement('style'))
  style.textContent = '.bb-theme-dark{background:#121212;color:#e8e8e8}.to-print-text,.to-print-text *{color:#000}'
  const el = mount(document.createElement('div'))
  el.className = 'bb-theme-dark'
  el.style.cssText = 'display:inline-block;padding:16px;font:16px Arial,sans-serif'
  el.innerHTML =
    '<div class="to-print-text" style="background:#fff;padding:8px;width:360px">' +
    '<p style="margin:0;font:bold 32px Arial,sans-serif">BLACK ARIAL</p>' +
    '<p style="margin:0;font:bold 32px Georgia,serif">BLACK GEORGIA</p>' +
    '</div>'
  const hold = { name: 'bb-hold', afterClone: () => new Promise((r) => setTimeout(r, 300)) }

  const result = await snapdom(el, {
    plugins: [hold, pdf({ breakAvoid: true })],
    scale: 2, quality: 1, backgroundColor: '#fff', fast: false, embedFonts: true,
  })

  const png = printBlockInks(await result.toCanvas())

  const blob = await result.toPdf({
    page: 'a4', margin: 24,
    header: { left: 'Made with Bestiary Builder', right: 'Creature', rule: false },
  })
  const doc = await getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise
  let page
  let text
  try {
    page = await doc.getPage(1)
    const viewport = page.getViewport({ scale: 2 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    page = printBlockInks(canvas)
    text = (await (await doc.getPage(1)).getTextContent()).items.map((i) => i.str).join(' ').replace(/\s+/g, ' ')
  } finally {
    await doc.destroy()
  }
  expect(png.dark, `canvas inks ${JSON.stringify(png)}`).toBeGreaterThan(300)
  expect(png.light, `canvas inks ${JSON.stringify(png)}`).toBeLessThan(png.dark)
  expect(page.dark, `pdf page inks ${JSON.stringify(page)}`).toBeGreaterThan(300)
  expect(page.light, `pdf page inks ${JSON.stringify(page)}`).toBeLessThan(page.dark)
  expect(text).toContain('BLACK ARIAL')
  expect(text).toContain('BLACK GEORGIA')
}, 30_000)
