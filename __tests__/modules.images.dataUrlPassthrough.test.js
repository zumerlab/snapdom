// An <img> whose src is already a data: URL is carried by the clone as cloneNode copied it.
// It used to be written back twice more on the way to the payload — freezeImgSrcset re-set
// the same value, inlineImages re-assigned it through the `src` setter — and every write of
// a data: URL re-parses and re-decodes the whole payload: 26 MB of gallery sources cost
// 61 + 20 + 20 ms of a 180 ms pipeline, and the image cache kept a multi-MB key pointing at
// itself. Pinned by counting src writes on the clones and by the payload carrying the exact
// string. Proven to fail: restoring either write turns the count assertion red.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { snapdom } from '../src/index.js'

/** A real PNG from a canvas: a hand-typed one decoded on chromium and webkit and was
 *  rejected by firefox ("Invalid encoded image data"). */
function png() {
  const c = document.createElement('canvas')
  c.width = 4; c.height = 4
  const x = c.getContext('2d'); x.fillStyle = '#e00'; x.fillRect(0, 0, 4, 4)
  return c.toDataURL('image/png')
}
let el = null
afterEach(() => { el?.remove(); el = null; vi.restoreAllMocks() })

describe('inlineImages — data: sources pass through untouched', () => {
  it('writes src on no clone, and the payload carries the exact string', async () => {
    const PNG = png()
    el = document.createElement('div')
    el.innerHTML = `<img src="${PNG}" style="width:40px;height:40px"><img src="${PNG}" style="width:20px;height:20px">`
    document.body.appendChild(el)
    await Promise.all(Array.from(el.querySelectorAll('img')).map((i) => i.decode()))
    const srcSetter = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src').set
    const setAttribute = Element.prototype.setAttribute
    let writes = 0
    vi.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation(function (v) { writes++; srcSetter.call(this, v) })
    vi.spyOn(Element.prototype, 'setAttribute').mockImplementation(function (name, v) {
      if (this.tagName === 'IMG' && name === 'src') writes++
      return setAttribute.call(this, name, v)
    })
    const url = await snapdom.toRaw(el, { burst: false, compress: false })
    expect(writes).toBe(0)
    expect(decodeURIComponent(url).split(PNG).length - 1).toBe(2)
  }, 30_000)
})
