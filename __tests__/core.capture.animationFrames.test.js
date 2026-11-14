// A running CSS animation or WAAPI effect changes computed styles with no mutation record,
// so the cross-capture style snapshot cache cannot see it. Every recapture of an animated
// node must paint the CURRENT frame: not the frame cached by an earlier capture, and not
// the last animated frame once the animation has ended.
//
// The animations run for 100 s with a hard switch at 50%, and each step seeks them through
// the Web Animations API (`currentTime`, `finish()`), so no timer decides what is live.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

const added = []
function mount(el, parent = document.body) { parent.appendChild(el); added.push(el); return el }
afterEach(() => { while (added.length) added.pop().remove() })

const RED = 'rgb(255, 0, 0)', BLUE = 'rgb(0, 0, 255)', GREEN = 'rgb(0, 128, 0)'
const HALF = 50000

/** The colour the capture painted at (x, y), by its dominant channel. */
async function painted(res, x = 10, y = 10) {
  const c = await res.toCanvas({ dpr: 1, scale: 1 })
  const [r, g, b, a] = c.getContext('2d').getImageData(x, y, 1, 1).data
  if (a < 200) return 'transparent'
  if (r > 200 && g < 60 && b < 60) return 'red'
  if (b > 200 && r < 60 && g < 60) return 'blue'
  if (g > 90 && r < 60 && b < 60) return 'green'
  return `rgb(${r}, ${g}, ${b})`
}

const live = (el) => {
  const c = getComputedStyle(el).backgroundColor
  return c === RED ? 'red' : c === BLUE ? 'blue' : c === GREEN ? 'green' : c
}

let n = 0
/** A green box under a capture root, with a CSS animation red -> blue at 50% on it. */
function animatedScene(fill, extra = '') {
  const name = `sdAnimFrames${++n}`
  const style = mount(document.createElement('style'))
  style.textContent =
    `@keyframes ${name}{0%,49.9%{background-color:${RED}}50%,100%{background-color:${BLUE}}}` +
    `.${name}{width:60px;height:60px;background-color:${GREEN};animation:${name} ${HALF * 2}ms linear ${fill}}`
  const host = mount(document.createElement('div'))
  host.style.cssText = 'width:120px;padding:0;margin:0'
  host.innerHTML = `<div class="${name}"></div>${extra}`
  const box = host.firstElementChild
  const [anim] = box.getAnimations()
  return { host, box, anim }
}

/** Captures before, at and after the switch; returns what each painted next to the live colour. */
async function threeFrames(fill, opts, extra) {
  const { host, box, anim } = animatedScene(fill, extra)
  anim.currentTime = 1000
  const first = await painted(await snapdom(host, opts))
  anim.currentTime = HALF + 1000
  const liveMid = live(box)
  const mid = await painted(await snapdom(host, opts))
  anim.finish()
  const liveEnd = live(box)
  const end = await painted(await snapdom(host, opts))
  return { first, mid, liveMid, end, liveEnd }
}

describe('recaptures paint the current animation frame', () => {
  it('burst: false, fill forwards: the frame after the switch and the held end frame', async () => {
    const r = await threeFrames('forwards', { burst: false })
    expect(r.liveMid).toBe('blue')
    expect(r.liveEnd).toBe('blue')
    expect(r.first).toBe('red')
    expect(r.mid).toBe('blue')
    expect(r.end).toBe('blue')
  })

  it('burst: false, no fill: the frame after the switch, then the static colour once it ends', async () => {
    const r = await threeFrames('', { burst: false })
    expect(r.liveMid).toBe('blue')
    expect(r.liveEnd).toBe('green')
    expect(r.first).toBe('red')
    expect(r.mid).toBe('blue')
    expect(r.end).toBe('green')
  })

  it('default options, no fill: the diff-served last frame does not outlive the animation', async () => {
    const r = await threeFrames('', {})
    expect(r.liveEnd).toBe('green')
    expect(r.first).toBe('red')
    expect(r.mid).toBe('blue')
    expect(r.end).toBe('green')
  })

  it('default options, a canvas sibling (memo bypassed, full pipeline per frame)', async () => {
    const r = await threeFrames('', {}, '<canvas width="10" height="10"></canvas>')
    expect(r.liveEnd).toBe('green')
    expect(r.first).toBe('red')
    expect(r.mid).toBe('blue')
    expect(r.end).toBe('green')
  })

  // getAnimations({ subtree: true }) does not cross a shadow boundary on any engine, and
  // burst sends a shadow target to the full pipeline, so both rows depend on captureDOM.
  for (const [label, opts] of [['burst: false', { burst: false }], ['default options', {}]]) {
    it(`${label}, an animated node inside an open shadow root`, async () => {
      const host = mount(document.createElement('div'))
      host.style.cssText = 'width:120px'
      const root = host.attachShadow({ mode: 'open' })
      root.innerHTML =
        `<style>@keyframes k{0%,49.9%{background-color:${RED}}50%,100%{background-color:${BLUE}}}` +
        `.b{width:60px;height:60px;background-color:${GREEN};animation:k ${HALF * 2}ms linear}</style><div class="b"></div>`
      const box = root.querySelector('.b')
      const [anim] = box.getAnimations()
      anim.currentTime = 1000
      expect(await painted(await snapdom(host, opts))).toBe('red')
      anim.currentTime = HALF + 1000
      expect(live(box)).toBe('blue')
      expect(await painted(await snapdom(host, opts))).toBe('blue')
      anim.finish()
      expect(live(box)).toBe('green')
      expect(await painted(await snapdom(host, opts))).toBe('green')
    })
  }

  it('a clone-only capture does not leave its animated frame behind', async () => {
    const { host, box, anim } = animatedScene('')
    anim.currentTime = 1000
    await snapdom(host, { burst: false, plugins: [{ name: 'clone-only', needs: 'clone' }] })
    anim.finish()
    expect(live(box)).toBe('green')
    expect(await painted(await snapdom(host, { burst: false }))).toBe('green')
  })

  it('burst: false, a WAAPI animation started after a capture cached the static frame', async () => {
    // The green comes from a sheet here; the style attribute has its own tests below.
    mount(document.createElement('style')).textContent =
      `.sdAnimWaapi{width:60px;height:60px;background-color:${GREEN}}`
    const host = mount(document.createElement('div'))
    host.style.cssText = 'width:120px'
    const box = mount(document.createElement('div'), host)
    box.className = 'sdAnimWaapi'
    expect(await painted(await snapdom(host, { burst: false }))).toBe('green')
    const anim = box.animate([{ backgroundColor: BLUE }, { backgroundColor: BLUE }], { duration: HALF * 2 })
    try {
      expect(live(box)).toBe('blue')
      expect(await painted(await snapdom(host, { burst: false }))).toBe('blue')
    } finally {
      anim.cancel()
    }
  })
})

// Since 3.0.0 an inline declaration is copied as authored unless something can outrank it.
// An animation or a transition does: the clone kept the inline value and painted that.
describe('an animated property that is also set in the style attribute', () => {
  /** The capture's pixel next to the live computed colour, as [r, g, b] each. */
  async function frame(host, el, opts) {
    const c = await (await snapdom(host, opts)).toCanvas({ dpr: 1, scale: 1 })
    return {
      shot: Array.from(c.getContext('2d').getImageData(10, 10, 1, 1).data).slice(0, 3),
      now: getComputedStyle(el).backgroundColor.match(/\d+/g).slice(0, 3).map(Number),
    }
  }
  const close = ({ shot, now }) => shot.every((v, i) => Math.abs(v - now[i]) <= 2)

  function inlineBox(style, cls = '') {
    const host = mount(document.createElement('div'))
    host.style.cssText = 'width:120px'
    host.innerHTML = `<div class="${cls}" style="width:60px;height:60px;${style}"></div>`
    return { host, el: host.firstElementChild }
  }

  for (const [label, opts] of [['burst: false', { burst: false }], ['default options', {}]]) {
    it(`${label}, a transition started through el.style paints the frames in between`, async () => {
      const { host, el } = inlineBox(`background-color:${RED};transition:background-color ${HALF * 2}ms linear`)
      getComputedStyle(el).backgroundColor
      el.style.backgroundColor = BLUE
      getComputedStyle(el).backgroundColor
      const [transition] = el.getAnimations()
      transition.currentTime = HALF
      const half = await frame(host, el, opts)
      expect(half.now[0]).toBeGreaterThan(100)
      expect(half.now[2]).toBeGreaterThan(100)
      expect(close(half)).toBe(true)
      // Under default options the second frame is served by the differential path.
      transition.currentTime = HALF * 1.5
      const later = await frame(host, el, opts)
      expect(later.now[2]).toBeGreaterThan(half.now[2] + 30)
      expect(close(later)).toBe(true)
    })

    it(`${label}, a WAAPI effect over an inline colour`, async () => {
      const { host, el } = inlineBox(`background-color:${GREEN}`)
      const anim = el.animate([{ backgroundColor: BLUE }, { backgroundColor: BLUE }], { duration: HALF * 2 })
      try {
        const shown = await frame(host, el, opts)
        expect(shown.now).toEqual([0, 0, 255])
        expect(close(shown)).toBe(true)
      } finally {
        anim.cancel()
      }
    })

    it(`${label}, a CSS animation over an inline colour`, async () => {
      mount(document.createElement('style')).textContent =
        `@keyframes sdAnimInline{from,to{background-color:${BLUE}}}.sdAnimInline{animation:sdAnimInline ${HALF * 2}ms linear}`
      const { host, el } = inlineBox(`background-color:${GREEN}`, 'sdAnimInline')
      const shown = await frame(host, el, opts)
      expect(shown.now).toEqual([0, 0, 255])
      expect(close(shown)).toBe(true)
    })
  }

  // Re-resolving every inline declaration of an animated node wrote used sizes over the
  // authored ones: the item below came out 67px wide, its twin 133px.
  for (const [label, opts] of [['burst: false', { burst: false }], ['default options', {}]]) {
    it(`${label}, an animated flex item keeps the width it was authored with`, async () => {
      const host = mount(document.createElement('div'))
      host.style.cssText = 'display:flex;width:200px'
      host.innerHTML =
        `<div style="width:200px;height:40px;background-color:${RED}"></div>` +
        `<div style="width:200px;height:40px;background-color:${BLUE}"></div>`
      const anim = host.firstElementChild.animate([{ opacity: 1 }, { opacity: 1 }], { duration: HALF * 2, fill: 'both' })
      try {
        for (const step of ['running', 'finished']) {
          if (step === 'finished') anim.finish()
          const res = await snapdom(host, opts)
          expect(await painted(res, 90, 20)).toBe('red')
          expect(await painted(res, 110, 20)).toBe('blue')
        }
      } finally {
        anim.cancel()
      }
    })
  }

  it('an animation on its ::before leaves a flex item its authored width', async () => {
    mount(document.createElement('style')).textContent =
      '@keyframes sdAnimPseudo{from{width:1px}to{width:2px}}' +
      `.sdAnimPseudo::before{content:"";position:absolute;height:1px;animation:sdAnimPseudo ${HALF * 2}ms linear}`
    const host = mount(document.createElement('div'))
    host.style.cssText = 'display:flex;width:200px'
    host.innerHTML =
      `<div class="sdAnimPseudo" style="position:relative;width:200px;height:40px;background-color:${RED}"></div>` +
      `<div style="width:200px;height:40px;background-color:${BLUE}"></div>`
    expect(host.firstElementChild.getAnimations({ subtree: true }).length).toBe(1)
    const res = await snapdom(host, { burst: false })
    expect(await painted(res, 90, 20)).toBe('red')
    expect(await painted(res, 110, 20)).toBe('blue')
  })

  it('an animated table cell keeps the width it was authored with', async () => {
    const host = mount(document.createElement('div'))
    host.innerHTML =
      '<table style="width:600px;border-collapse:collapse"><tr>' +
      `<td style="width:200px;height:30px;padding:0;background-color:${RED}"></td>` +
      `<td style="width:200px;height:30px;padding:0;background-color:${BLUE}"></td></tr></table>`
    const anim = host.querySelector('td').animate([{ opacity: 1 }, { opacity: 1 }], { duration: HALF * 2 })
    try {
      const res = await snapdom(host.firstElementChild, { burst: false })
      expect(await painted(res, 290, 15)).toBe('red')
      expect(await painted(res, 310, 15)).toBe('blue')
    } finally {
      anim.cancel()
    }
  })

  it('a script-made effect given a shorthand re-resolves its longhands', async () => {
    const { host, el } = inlineBox(`background-color:${GREEN}`)
    const anim = el.animate([{ background: BLUE }, { background: BLUE }], { duration: HALF * 2 })
    try {
      const shown = await frame(host, el, { burst: false })
      expect(shown.now).toEqual([0, 0, 255])
      expect(close(shown)).toBe(true)
    } finally {
      anim.cancel()
    }
  })
})
