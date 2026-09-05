// Style snapshots of open-shadow-root content.
//
// Neither the document MutationObserver nor stampSubtree crosses a shadow boundary, so a web
// component that re-rendered itself between captures moved no stamp and no epoch: its cached
// snapshots were served indefinitely. Asserting on the serialized CSS hides this — the
// re-injected shadow rule IS in the payload. It loses: rewriteShadowCSS emits shadow rules at
// specificity zero, so the stale generated class outranks it. These assert on pixels.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

async function centrePixel(el) {
  const canvas = await snapdom.toCanvas(el, { embedFonts: false, burst: false, scale: 1, dpr: 1 })
  const d = canvas.getContext('2d')
    .getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data
  return `${d[0]},${d[1]},${d[2]}`
}

function shadowHost(html) {
  const host = document.createElement('div')
  host.style.cssText = 'width:60px;height:60px'
  document.body.appendChild(host)
  mounted.push(host)
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = html
  return { host, root }
}

describe('open shadow roots invalidate their style snapshots', () => {
  // Three captures: the snapshot cache is only fully warm from the third, so mutating after
  // one capture would pass without proving anything.
  it('a class flip inside the shadow tree repaints', async () => {
    const { host, root } = shadowHost(
      '<style>.box{width:60px;height:60px;background:rgb(0,0,255)}' +
      '.box.active{background:rgb(255,0,0)}</style><div class="box"></div>')

    await centrePixel(host)
    await centrePixel(host)
    expect(await centrePixel(host)).toBe('0,0,255')

    root.querySelector('.box').classList.add('active')
    expect(await centrePixel(host)).toBe('255,0,0')
  })

  it('an inline style edit inside the shadow tree repaints', async () => {
    const { host, root } = shadowHost(
      '<style>.b{width:60px;height:60px;background:rgb(0,0,255)}</style><div class="b"></div>')

    await centrePixel(host)
    await centrePixel(host)
    expect(await centrePixel(host)).toBe('0,0,255')

    root.querySelector('.b').style.background = 'rgb(0,128,0)'
    expect(await centrePixel(host)).toBe('0,128,0')
  })

  it('a node appended into the shadow tree repaints', async () => {
    const { host, root } = shadowHost(
      '<style>.b{width:60px;height:30px;background:rgb(0,0,255)}' +
      '.c{width:60px;height:30px;background:rgb(255,255,0)}</style><div class="b"></div>')

    await centrePixel(host)
    await centrePixel(host)

    const extra = document.createElement('div')
    extra.className = 'c'
    root.appendChild(extra)
    // The new box now owns the lower half, which is where the centre sample lands.
    expect(await centrePixel(host)).toBe('255,255,0')
  })

  it('inherits a changed host color through a warm shadow snapshot', async () => {
    const { host } = shadowHost('<style>.box{width:60px;height:60px;background:currentColor}</style><div class="box"></div>')
    host.style.color = 'rgb(255,0,0)'
    expect(await centrePixel(host)).toBe('255,0,0')
    host.style.color = 'rgb(0,0,255)'
    expect(await centrePixel(host)).toBe('0,0,255')
  })

  it('inherits changed custom properties through nested shadow hosts', async () => {
    const { host, root } = shadowHost('<div class="inner"></div>')
    host.style.setProperty('--paint', 'rgb(255,0,0)')
    const inner = root.querySelector('.inner').attachShadow({ mode: 'open' })
    inner.innerHTML = '<style>.box{width:60px;height:60px;background:var(--paint)}</style><div class="box"></div>'
    expect(await centrePixel(host)).toBe('255,0,0')
    host.style.setProperty('--paint', 'rgb(0,0,255)')
    expect(await centrePixel(host)).toBe('0,0,255')
  })

  it('observes the enclosing shadow root when capturing its child directly', async () => {
    const { root } = shadowHost('<style>.box{width:60px;height:60px;background:red}.box.changed{background:blue}</style><div class="box"></div>')
    const child = root.querySelector('.box')
    expect(await centrePixel(child)).toBe('255,0,0')
    child.classList.add('changed')
    expect(await centrePixel(child)).toBe('0,0,255')
  })

  it('invalidates assigned light content when its slot changes inherited styles', async () => {
    const { host, root } = shadowHost('<style>slot{color:rgb(255,0,0)}slot.changed{color:rgb(0,0,255)}</style><slot></slot>')
    const sheet = document.createElement('style')
    sheet.textContent = '.shadow-slotted-paint{width:60px;height:60px;background:currentColor}'
    document.head.appendChild(sheet)
    mounted.push(sheet)
    const assigned = document.createElement('div')
    assigned.innerHTML = '<div class="shadow-slotted-paint"></div>'
    host.appendChild(assigned)
    expect(await centrePixel(host)).toBe('255,0,0')
    root.querySelector('slot').classList.add('changed')
    expect(await centrePixel(host)).toBe('0,0,255')
  })

  // The fix must not become "never cache shadow content": snapshots still have to survive a
  // capture where nothing changed, or every web component pays a cold pass on every frame.
  it('still caches shadow snapshots when nothing changes', async () => {
    const { host } = shadowHost(
      '<style>.box{padding:3px}</style>' + '<div class="box">row</div>'.repeat(30))

    const proto = CSSStyleDeclaration.prototype
    const real = proto.getPropertyValue
    const readsFor = async () => {
      let calls = 0
      proto.getPropertyValue = function (...a) { calls++; return real.apply(this, a) }
      try { await snapdom(host, { embedFonts: false, burst: false }); return calls } finally { proto.getPropertyValue = real }
    }

    await readsFor()
    await readsFor()
    const warm = await readsFor()
    const warmAgain = await readsFor()
    expect(warmAgain).toBeLessThan(warm * 1.5)
    expect(warmAgain).toBeLessThan(1000)
  })
})
