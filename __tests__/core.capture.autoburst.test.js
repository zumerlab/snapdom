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

describe('image loads invalidate the memo (no DOM mutation involved)', () => {
  it('a memo taken while an img was loading is dropped when the load lands', async () => {
    const wrap = document.createElement('div')
    const img = document.createElement('img')
    img.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><rect width="30" height="30" fill="navy"/></svg>')
    // Simulate a still-loading image so the tracker attaches (load timing is async and racy
    // in a unit test; the mechanism is what must hold).
    Object.defineProperty(img, 'complete', { configurable: true, get: () => false })
    wrap.appendChild(img)
    document.body.appendChild(wrap)

    const results = []
    for (let i = 0; i < 5; i++) results.push(await snapdom(wrap))
    expect(results[4]).toBe(results[3]) // memo engaged while "loading"

    img.dispatchEvent(new Event('load')) // the load arrives — layout/paint changed, no mutation
    const after = await snapdom(wrap)
    expect(after).not.toBe(results[4]) // memo dropped, fresh capture
  })
})

describe('scroll invalidates the memo (no DOM mutation involved)', () => {
  it('a scrolled descendant drops the memo and the next capture reflects the new position', async () => {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'width:220px;padding:6px;background:#fff'
    const scroller = document.createElement('div')
    scroller.style.cssText = 'width:200px;height:100px;overflow:auto'
    for (const c of ['red', 'lime', 'blue']) {
      const line = document.createElement('div')
      line.style.cssText = `height:100px;background:${c}`
      scroller.appendChild(line)
    }
    wrap.appendChild(scroller)
    document.body.appendChild(wrap)
    void scroller.offsetHeight

    const results = []
    for (let i = 0; i < 5; i++) results.push(await snapdom(wrap))
    expect(results[4]).toBe(results[3]) // memo engaged

    scroller.scrollTop = 100 // fires a scroll event, produces no mutation record
    scroller.dispatchEvent(new Event('scroll')) // programmatic scroll may defer the event
    const after = await snapdom(wrap)
    expect(after).not.toBe(results[4])
    expect(decodeURIComponent(after.url.split(',')[1])).toMatch(/translate\(0px,\s*-(9[5-9]|10[0-5])(\.\d+)?px\)/)
  })
})

describe('running animations disable the memo (frames repaint with no mutations)', () => {
  it('an animating element never serves a memo, and pre-animation memos are dropped', async () => {
    const el = document.createElement('div')
    el.style.cssText = 'width:120px;height:40px;background:#3af;color:#fff;padding:4px'
    el.textContent = 'dancer'
    document.body.appendChild(el)

    // Static: memo engages normally.
    const statics = []
    for (let i = 0; i < 4; i++) statics.push(await snapdom(el))
    expect(statics[3]).toBe(statics[2])

    // Animation starts — NO DOM mutation involved.
    const anim = el.animate(
      [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
      { duration: 100000, iterations: Infinity }
    )
    try {
      const a1 = await snapdom(el)
      const a2 = await snapdom(el)
      expect(a1).not.toBe(statics[3]) // pre-animation memo dropped, not served
      expect(a2).not.toBe(a1)         // every animated capture is fresh
    } finally {
      anim.cancel()
    }

    // Animation over: memoization resumes from a FRESH post-animation capture.
    const b1 = await snapdom(el)
    expect(b1).not.toBe(statics[3])
    const b2 = await snapdom(el)
    expect(b2).toBe(b1)
  })

  // Three inputs that change what renders while producing NO mutation record inside the
  // captured subtree. Each one used to be served stale forever once auto-burst engaged.
  describe('invalidation inputs the scoped observer cannot see', () => {
    const svgOf = (r) => decodeURIComponent(r.url.split(',')[1])

    it('a typed form value invalidates the memo', async () => {
      const host = document.createElement('div')
      host.innerHTML = '<label>Nombre <input id="nm" value=""></label><p>estático</p>'
      document.body.appendChild(host)
      const input = host.querySelector('#nm')
      for (let i = 0; i < 4; i++) await snapdom(host)

      input.value = 'Ada Lovelace'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 0))

      expect(svgOf(await snapdom(host))).toContain('Ada Lovelace')
    })

    it('a theme attribute set ABOVE the captured element invalidates the memo', async () => {
      const style = document.createElement('style')
      style.textContent = ':root{--zzbg:rgb(255,255,255)} :root[data-zzt="dark"]{--zzbg:rgb(11,18,32)}' +
        '.zzc{background:var(--zzbg);width:80px;height:40px}'
      document.head.appendChild(style)
      const host = document.createElement('div')
      host.innerHTML = '<div class="zzc">card</div>'
      document.body.appendChild(host)
      for (let i = 0; i < 4; i++) await snapdom(host)

      document.documentElement.setAttribute('data-zzt', 'dark')
      await new Promise((r) => setTimeout(r, 0))
      try {
        expect(svgOf(await snapdom(host))).toContain('rgb(11, 18, 32)')
      } finally {
        document.documentElement.removeAttribute('data-zzt')
        style.remove()
      }
    })

    it('content updated inside an open shadow root invalidates the memo', async () => {
      const host = document.createElement('div')
      const comp = document.createElement('div')
      const sr = comp.attachShadow({ mode: 'open' })
      sr.innerHTML = '<p id="t">ORIGINAL-TEXT</p>'
      host.appendChild(comp)
      document.body.appendChild(host)
      for (let i = 0; i < 4; i++) await snapdom(host)

      sr.getElementById('t').textContent = 'UPDATED-TEXT'
      await new Promise((r) => setTimeout(r, 0))
      expect(svgOf(await snapdom(host))).toContain('UPDATED-TEXT')
    })

    it('a shadow root attached AFTER the memo was taken invalidates it', async () => {
      const host = document.createElement('div')
      const comp = document.createElement('div')
      host.appendChild(comp)
      document.body.appendChild(host)
      for (let i = 0; i < 4; i++) await snapdom(host)

      // attachShadow produces no mutation record anywhere, so this is found by scanning.
      comp.attachShadow({ mode: 'open' }).innerHTML = '<p>LATE-SHADOW</p>'
      await new Promise((r) => setTimeout(r, 0))
      expect(svgOf(await snapdom(host))).toContain('LATE-SHADOW')
    })

    it('a <canvas> behind a shadow boundary still blocks auto-burst', async () => {
      const { shouldAutoBurst } = await import('../src/core/burst.js')
      const host = document.createElement('div')
      const comp = document.createElement('div')
      comp.attachShadow({ mode: 'open' }).innerHTML = '<canvas width="40" height="20"></canvas>'
      host.appendChild(comp)
      document.body.appendChild(host)

      shouldAutoBurst(host)
      shouldAutoBurst(host)
      expect(shouldAutoBurst(host)).toBe(false)
    })
  })
})
