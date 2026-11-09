/**
 * Zoom a region of `<fx>.orig.png` and `<fx>.render.png` side by side, nearest
 * neighbour, so a glyph or a seam can actually be LOOKED at instead of inferred
 * from a mean.
 *
 *   node test/_zoom.mjs fx-card 40 280 200 30 [scale]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from './serve.mjs'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [fixture, X, Y, W, H, S = '4'] = process.argv.slice(2)
const server = await serve()
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(`http://localhost:${server.port}/test/fixtures/prose.html`)

const url = await page.evaluate(async ({ fixture, x, y, w, h, s }) => {
  const load = (src) => new Promise((res, rej) => {
    const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error(src)); im.src = src
  })
  const a = await load(`/out/vector/${fixture}.orig.png`)
  const b = await load(`/out/vector/${fixture}.render.png`)
  const c = document.createElement('canvas')
  c.width = w * s; c.height = h * s * 2 + 12
  const g = c.getContext('2d')
  g.imageSmoothingEnabled = false
  g.fillStyle = '#e11'; g.fillRect(0, 0, c.width, c.height)
  g.drawImage(a, x, y, w, h, 0, 0, w * s, h * s)
  g.drawImage(b, x, y, w, h, 0, h * s + 12, w * s, h * s)
  return c.toDataURL('image/png')
}, { fixture, x: +X, y: +Y, w: +W, h: +H, s: +S })

const out = path.join(ROOT, 'out/vector', `_zoom.png`)
fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'))
await browser.close()
server.close()
console.log(`${out}  (top = browser capture, bottom = PDF)`)
