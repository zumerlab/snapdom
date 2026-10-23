// Firefox copies a response's content type verbatim into the data URL it reads the response
// as. cdnjs serves fonts as `application/octet-stream; charset=utf-8`, and the space ended the
// unquoted url(data:...) of the embedded @font-face: the face was dropped and the capture fell
// back to another font (d22, Firefox). The font here comes with that same type.
import { afterEach, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'
import { snapFetch } from '../src/modules/snapFetch.js'

let host, style, url
afterEach(() => { host?.remove(); style?.remove(); if (url) URL.revokeObjectURL(url); host = style = url = null })

async function servedLikeCdnjs() {
  const bytes = await (await fetch('/demos/assets/fonts/roboto/roboto-latin.woff2')).arrayBuffer()
  return URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream; charset=utf-8' }))
}

it('reads a response with a parameterised content type into a data URL without whitespace', async () => {
  url = await servedLikeCdnjs()
  const r = await snapFetch(url, { as: 'dataURL' })
  expect(r.ok).toBe(true)
  expect(r.data.slice(0, r.data.indexOf(','))).not.toMatch(/\s/)
})

it('embeds and paints a font served that way', async () => {
  url = await servedLikeCdnjs()
  style = document.createElement('style')
  style.textContent = `@font-face{font-family:'CdnjsTyped';src:url('${url}') format('woff2')}`
  document.head.appendChild(style)
  host = document.createElement('div')
  host.style.cssText = "display:inline-block;padding:4px;font:24px 'CdnjsTyped', serif;color:#000;background:#fff"
  host.textContent = 'Wide waves of jumbled text'
  document.body.appendChild(host)
  await document.fonts.load("24px 'CdnjsTyped'")
  const live = host.getBoundingClientRect().width - 8
  const canvas = await snapdom.toCanvas(host, { dpr: 1, embedFonts: true, cache: 'disabled' })
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  let min = Infinity, max = -1
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const i = (y * canvas.width + x) * 4
    if (d[i + 3] > 200 && d[i] < 100) { min = Math.min(min, x); max = Math.max(max, x) }
  }
  expect(Math.abs(max - min - live)).toBeLessThan(6)
})
