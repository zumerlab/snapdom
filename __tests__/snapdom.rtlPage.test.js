// On a right-to-left PAGE, baseCSS's per-tag defaults inherit `direction: rtl`, and the
// foreignObject's container is a div. Its own file because the whole runner document turns
// right-to-left for it.
import { afterAll, beforeAll, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

beforeAll(() => { document.documentElement.dir = 'rtl' })
afterAll(() => { document.documentElement.removeAttribute('dir') })

it('keeps the clone at the bleed offset when the container has room to spare', async () => {
  const el = document.createElement('div')
  el.style.cssText = 'width:100px;height:50px;background:rgb(204,204,204);box-shadow:10px 0 0 rgb(40,160,90)'
  document.body.appendChild(el)
  const res = await snapdom(el, { dpr: 1, cache: 'disabled', outerShadows: true })
  const canvas = await res.toCanvas()
  const d = canvas.getContext('2d').getImageData(0, 25, canvas.width, 1).data
  let gray = -1
  for (let x = 0; x < canvas.width; x++) if (d[x * 4] === 204 && d[x * 4 + 1] === 204 && d[x * 4 + 3] === 255) { gray = x; break }
  el.remove()
  expect(gray).toBe(res.meta.contentX)
})
