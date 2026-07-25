// Auto-burst: with no explicit `burst` option, repeated captures of the same element in a
// short window enable memoization automatically. Explicit false disables; canvas-bearing
// elements never auto-enable (their pixel draws are invisible to MutationObserver).
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'

afterEach(() => { document.body.innerHTML = '' })

function makeCard(text = 'auto') {
  const el = document.createElement('div')
  el.style.cssText = 'width:120px;height:40px;background:#eef;padding:4px'
  el.textContent = text
  document.body.appendChild(el)
  return el
}

describe('auto-burst', () => {
  it('kicks in after repeated captures and still reflects mutations', async () => {
    const el = makeCard()
    const urls = []
    for (let i = 0; i < 5; i++) urls.push((await snapdom(el)).url)
    // memoized repeats return byte-identical output
    expect(urls[4]).toBe(urls[3])

    // a real mutation must invalidate the memo
    el.textContent = 'changed'
    await new Promise((r) => setTimeout(r, 0)) // let the observer deliver
    const after = (await snapdom(el)).url
    expect(after).not.toBe(urls[4])
    expect(decodeURIComponent(after.split(',')[1])).toContain('changed')
  })

  it('burst:false disables auto mode', async () => {
    const el = makeCard('noauto')
    for (let i = 0; i < 5; i++) await snapdom(el, { burst: false })
    // No memoization: mutating between captures without waiting for observer delivery
    // still yields fresh output (there is no observer at all).
    el.textContent = 'fresh'
    const url = (await snapdom(el, { burst: false })).url
    expect(decodeURIComponent(url.split(',')[1])).toContain('fresh')
  })

  it('never auto-enables on canvas-bearing elements', async () => {
    const wrap = document.createElement('div')
    const canvas = document.createElement('canvas')
    canvas.width = 20
    canvas.height = 20
    wrap.appendChild(canvas)
    document.body.appendChild(wrap)
    const ctx = canvas.getContext('2d')

    ctx.fillStyle = '#ff0000'
    ctx.fillRect(0, 0, 20, 20)
    for (let i = 0; i < 4; i++) await snapdom(wrap)

    // Canvas pixel draw with NO DOM mutation: auto mode must still capture it fresh
    ctx.fillStyle = '#00ff00'
    ctx.fillRect(0, 0, 20, 20)
    const png = await (await snapdom(wrap)).toCanvas()
    const px = png.getContext('2d', { willReadFrequently: true })
      .getImageData(10, 10, 1, 1).data
    expect(px[1]).toBeGreaterThan(200) // green — not the stale red frame
  })
})
