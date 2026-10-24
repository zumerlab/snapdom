import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

const hosts = []
afterEach(() => hosts.splice(0).forEach(h => h.remove()))

async function crop(res, w, h, sx = 0, sy = 0) {
  const img = new Image()
  img.src = res.url
  await img.decode()
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.getContext('2d').drawImage(img, -sx, -sy)
  return c.getContext('2d').getImageData(0, 0, w, h).data
}

// An atomic inline captured on its own must paint what the same element paints inside its
// parent's capture: the root sits on the svg container's line, whose strut is not the page's.
describe('atomic inline capture roots', () => {
  it.each([
    ['input', '<input style="width:120px;background:#fff;color:#000;border:0;font:13.3333px Arial" value="typed text">'],
    ['button', '<button style="background:#fff;color:#000;border:1px solid #000;font:13px Arial;padding:2px 8px">Send now</button>'],
    ['inline-block', '<span style="display:inline-block;background:#fff;color:#000;font:14px Arial;padding:2px 6px">Badge</span>'],
  ])('a captured %s matches its in-page render', async (_, html) => {
    const host = document.createElement('div')
    host.style.cssText = 'padding:10px;background:#1e293b;width:240px'
    host.innerHTML = html
    document.body.append(host)
    hosts.push(host)
    const el = host.firstElementChild
    const r = el.getBoundingClientRect(), hr = host.getBoundingClientRect()
    const w = Math.round(r.width), h = Math.round(r.height)
    const o = { dpr: 1, embedFonts: false }
    const solo = await crop(await snapdom(el, o), w, h)
    const inPage = await crop(await snapdom(host, o), w, h, r.left - hr.left, r.top - hr.top)
    let bad = 0
    for (let i = 0; i < solo.length; i += 4) {
      if (Math.max(Math.abs(solo[i] - inPage[i]), Math.abs(solo[i + 1] - inPage[i + 1]), Math.abs(solo[i + 2] - inPage[i + 2])) > 32) bad++
    }
    expect(bad).toBe(0)
  })
})
