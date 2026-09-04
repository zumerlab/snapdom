// preCache(el) seeds the burst memo: the real pipeline runs once, now, and the app's first
// snapdom(el) with the same options is served from it. Where the memo itself would refuse
// to serve (a render plugin that is not pure, a stage below render, a canvas in the subtree)
// nothing is seeded and the call captures as before.
//
// A memo hit reads no computed style: the getComputedStyle spy is the witness. Proven to
// fail: dropping `isSeeded` from the burst decision in api/snapdom.js turns the first test
// red; dropping the canvas refusal in seedCapture turns the canvas test red.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { snapdom, preCache } from '../src/index.js'

let el = null
afterEach(() => { el?.remove(); el = null; vi.restoreAllMocks() })

function mount() {
  el = document.createElement('div')
  el.style.cssText = 'width:240px;padding:12px;background:#fafafa;border:1px solid #ccc;font:14px Arial'
  el.innerHTML = '<h3 style="margin:0 0 8px;color:#1a5">Seeded card</h3><p style="margin:0">Some text with <b>bold</b> and <i>italic</i>.</p><div style="height:40px;margin-top:8px;background:linear-gradient(90deg,#e33,#33e)"></div>'
  document.body.appendChild(el)
  return el
}
const flushObservers = () => new Promise((r) => setTimeout(r, 0))

describe('preCache(el) seeds the burst memo', () => {
  it('the first snapdom(el) is a memo hit, and a mutation ends it', async () => {
    mount()
    await preCache(el)
    const reads = vi.spyOn(window, 'getComputedStyle')
    const first = await snapdom(el)
    expect(reads).not.toHaveBeenCalled()
    el.querySelector('p').textContent = 'changed'
    await flushObservers()
    const second = await snapdom(el)
    expect(reads).toHaveBeenCalled()
    expect(second.url).not.toBe(first.url)
  })

  it('serves the pixels a fresh capture paints', async () => {
    mount()
    await preCache(el)
    const served = await (await snapdom(el)).toCanvas({ scale: 1, dpr: 1 })
    const fresh = await (await snapdom(el, { burst: false })).toCanvas({ scale: 1, dpr: 1 })
    expect([served.width, served.height]).toEqual([fresh.width, fresh.height])
    const a = served.getContext('2d').getImageData(0, 0, served.width, served.height).data
    const b = fresh.getContext('2d').getImageData(0, 0, fresh.width, fresh.height).data
    let diff = 0
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++
    expect(diff).toBe(0)
  })

  it('a different options signature is not served the seed', async () => {
    mount()
    await preCache(el)
    const reads = vi.spyOn(window, 'getComputedStyle')
    await snapdom(el, { scale: 2 })
    expect(reads).toHaveBeenCalled()
  })

  it('refuses a render plugin that is not pure, and a needs:clone plugin', async () => {
    mount()
    const stamp = { name: 'stamp', afterClone() {} }
    await preCache(el, { plugins: [stamp] })
    let reads = vi.spyOn(window, 'getComputedStyle')
    await snapdom(el, { plugins: [stamp] })
    expect(reads).toHaveBeenCalled()
    vi.restoreAllMocks()
    const shallow = { name: 'shallow', needs: 'clone', pure: true }
    await preCache(el, { plugins: [shallow] })
    reads = vi.spyOn(window, 'getComputedStyle')
    await snapdom(el, { plugins: [shallow] })
    expect(reads).toHaveBeenCalled()
  })

  it('refuses a canvas-bearing element', async () => {
    mount()
    const c = document.createElement('canvas')
    c.width = 40
    c.height = 40
    c.getContext('2d').fillRect(0, 0, 40, 40)
    el.appendChild(c)
    await preCache(el)
    const reads = vi.spyOn(window, 'getComputedStyle')
    await snapdom(el)
    expect(reads).toHaveBeenCalled()
  })
})
