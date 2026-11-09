/**
 * Rasterize each vector PDF and put it side by side with the browser's own
 * capture of the same element (`*.orig.png`), so the emitter is judged against
 * the page it came from and not against a memory of it.
 *
 * Writes, per fixture, into out/vector/:
 *   <fx>.render.png   the PDF at the ORIGINAL's pixel size
 *   <fx>.diff.png     |render − orig| amplified, plus the numbers
 *   <fx>.compare.png  orig | render | diff, one strip
 *
 * pdf.js renders in a real browser here rather than in Node because the Node
 * build has no canvas — and because a browser is where the file will be opened.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from './serve.mjs'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'out/vector')
const FIXTURES = ['fx-card', 'fx-type', 'fx-ui', 'fx-table', 'fx-z']
const only = process.argv.slice(2).filter(a => !a.startsWith('-'))
const list = only.length ? FIXTURES.filter(f => only.some(o => f.startsWith(o))) : FIXTURES

const server = await serve()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
page.on('pageerror', e => console.log('PAGEERROR', String(e.message || e)))

await page.goto(`http://localhost:${server.port}/test/fixtures/prose.html`, { waitUntil: 'load' })
await page.addScriptTag({ url: '/node_modules/pdfjs-dist/build/pdf.min.mjs', type: 'module' })
await page.evaluate(async (port) => {
  const mod = await import('/node_modules/pdfjs-dist/build/pdf.min.mjs')
  mod.GlobalWorkerOptions.workerSrc = `http://localhost:${port}/node_modules/pdfjs-dist/build/pdf.worker.min.mjs`
  window.pdfjsLib = mod
}, server.port)

const rows = []
for (const fixture of list) {
  const result = await page.evaluate(async ({ fixture }) => {
    const load = (src) => new Promise((res, rej) => {
      const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src
    })
    const orig = await load(`/out/vector/${fixture}.orig.png`)
    const doc = await window.pdfjsLib.getDocument({ url: `/out/vector/${fixture}.pdf` }).promise
    const p = await doc.getPage(1)

    // Match the ORIGINAL's pixel grid exactly: any other scale makes every
    // antialiased edge a difference and the comparison says nothing.
    const base = p.getViewport({ scale: 1 })
    const scale = orig.naturalWidth / base.width
    const vp = p.getViewport({ scale })
    const c = document.createElement('canvas')
    c.width = Math.round(vp.width); c.height = Math.round(vp.height)
    const ctx = c.getContext('2d')
    // White under it: the capture has its own background, and a transparent PDF
    // over a transparent canvas would diff against the PNG's white for free.
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
    await p.render({ canvasContext: ctx, viewport: vp }).promise

    const W = Math.min(c.width, orig.naturalWidth)
    const H = Math.min(c.height, orig.naturalHeight)
    const oc = document.createElement('canvas')
    oc.width = orig.naturalWidth; oc.height = orig.naturalHeight
    const octx = oc.getContext('2d')
    octx.fillStyle = '#fff'; octx.fillRect(0, 0, oc.width, oc.height)
    octx.drawImage(orig, 0, 0)

    const a = ctx.getImageData(0, 0, W, H).data
    const b = octx.getImageData(0, 0, W, H).data
    const dc = document.createElement('canvas')
    dc.width = W; dc.height = H
    const dctx = dc.getContext('2d')
    const out = dctx.createImageData(W, H)
    let sum = 0, over8 = 0, over32 = 0, over96 = 0, worst = 0
    // Where the differences are, not just how many: a column profile finds a
    // whole shifted block, which a single mean hides.
    const cols = new Float64Array(W), rowsP = new Float64Array(H)
    for (let i = 0, px = 0; i < a.length; i += 4, px++) {
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]))
      sum += d
      if (d > 8) over8++
      if (d > 32) over32++
      if (d > 96) over96++
      if (d > worst) worst = d
      cols[px % W] += d; rowsP[(px / W) | 0] += d
      const v = Math.min(255, d * 3)
      out.data[i] = v > 8 ? 255 : 255 - v
      out.data[i + 1] = 255 - v
      out.data[i + 2] = 255 - v
      out.data[i + 3] = 255
    }
    dctx.putImageData(out, 0, 0)

    const strip = document.createElement('canvas')
    strip.width = W * 3 + 24; strip.height = H
    const sctx = strip.getContext('2d')
    sctx.fillStyle = '#222'; sctx.fillRect(0, 0, strip.width, strip.height)
    sctx.drawImage(oc, 0, 0)
    sctx.drawImage(c, W + 12, 0)
    sctx.drawImage(dc, W * 2 + 24, 0)

    const band = (arr, n) => {
      // The n worst bands, as percentages of the axis, so a report can say WHERE.
      const size = Math.max(1, Math.floor(arr.length / 20))
      const bands = []
      for (let i = 0; i < arr.length; i += size) {
        let s = 0
        for (let j = i; j < Math.min(arr.length, i + size); j++) s += arr[j]
        bands.push({ at: Math.round((i / arr.length) * 100), s })
      }
      return bands.sort((x, y) => y.s - x.s).slice(0, n).map(x => `${x.at}%`)
    }

    return {
      pdfW: c.width, pdfH: c.height, origW: orig.naturalWidth, origH: orig.naturalHeight,
      mean: sum / (W * H), worst,
      p8: (over8 / (W * H)) * 100, p32: (over32 / (W * H)) * 100, p96: (over96 / (W * H)) * 100,
      worstCols: band(cols, 3), worstRows: band(rowsP, 3),
      render: c.toDataURL('image/png'),
      diff: dc.toDataURL('image/png'),
      compare: strip.toDataURL('image/png'),
    }
  }, { fixture })

  const write = (name, dataUrl) =>
    fs.writeFileSync(path.join(OUT, `${fixture}.${name}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'))
  write('render', result.render)
  write('diff', result.diff)
  write('compare', result.compare)
  delete result.render; delete result.diff; delete result.compare
  rows.push({ fixture, ...result })
}

await browser.close()
server.close()

console.log('\n| fixture  | pdf px    | orig px   | mean Δ | worst | >8   | >32  | >96  | worst rows      | worst cols      |')
console.log('|----------|-----------|-----------|--------|-------|------|------|------|-----------------|-----------------|')
for (const r of rows) {
  const p = (s, n) => String(s).padEnd(n)
  console.log(`| ${p(r.fixture, 8)} | ${p(`${r.pdfW}×${r.pdfH}`, 9)} | ${p(`${r.origW}×${r.origH}`, 9)} | ` +
    `${p(r.mean.toFixed(2), 6)} | ${p(r.worst, 5)} | ${p(r.p8.toFixed(1) + '%', 4)} | ` +
    `${p(r.p32.toFixed(1) + '%', 4)} | ${p(r.p96.toFixed(1) + '%', 4)} | ` +
    `${p(r.worstRows.join(' '), 15)} | ${p(r.worstCols.join(' '), 15)} |`)
}
