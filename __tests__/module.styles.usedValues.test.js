// A cached style snapshot holds used values, and layout reaches further than the cascade:
// a node no selector connects to the mutated one can still move or resize with it. Each
// scene mutates one node, then checks a COUSIN of it (a sibling of one of its ancestors)
// against the live page, under `burst: false` (the snapshot cache alone) and under default
// options (the differential path over the retained clone).
import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'
import { snapshotFor } from '../src/modules/styles.js'
import { markInternalNode } from '../src/utils/ownership.js'
import { __diffStats } from '../src/core/diff.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

function mount(css, html, sheet) {
  if (sheet) {
    const style = document.createElement('style')
    style.textContent = sheet
    document.head.appendChild(style)
    mounted.push(style)
  }
  // Away from the pointer, which rests at the page's corner: a box that grows under it
  // changes the :hover chain, and that alone re-reads the tree.
  const host = document.createElement('div')
  host.style.cssText = 'position:absolute;left:300px;top:200px'
  const root = document.createElement('div')
  root.style.cssText = `background:rgb(255,255,255);font:14px/20px Arial,sans-serif;${css}`
  root.innerHTML = html
  host.appendChild(root)
  document.body.appendChild(host)
  mounted.push(host)
  return root
}

/** Where `rgb` first paints: the row along column `x`, or the column along row `y`. */
async function firstPaint(res, rgb, { x, y }) {
  const canvas = await res.toCanvas({ dpr: 1, scale: 1 })
  const { data, width, height } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  const hit = (px, py) => { const i = (py * width + px) * 4; return data[i] === rgb[0] && data[i + 1] === rgb[1] && data[i + 2] === rgb[2] }
  if (x !== undefined) { for (let py = 0; py < height; py++) if (hit(x, py)) return py } else { for (let px = 0; px < width; px++) if (hit(px, y)) return px }
  return -1
}

const edge = (el, root, side) => Math.round(el.getBoundingClientRect()[side] - root.getBoundingClientRect()[side])
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const RED = [255, 0, 0]
const BLUE = [0, 0, 255]

for (const [mode, opts] of [['burst: false', { burst: false }], ['default options', {}]]) {
  describe(`used values of a cousin, ${mode}`, () => {
    it('a footer pinned with bottom: 0 follows the text that grows above it', async () => {
      const root = mount('position:relative;width:200px;padding:10px 10px 40px',
        '<div><p style="margin:0">one</p></div><div class="foot" style="position:absolute;left:0;bottom:0;width:100%;height:20px;background:rgb(255,0,0)"></div>')
      for (let i = 0; i < 4; i++) await snapdom(root, opts)
      expect(await firstPaint(await snapdom(root, opts), RED, { x: 20 })).toBe(50)
      root.querySelector('p').innerHTML = 'one<br>two<br>three'
      await tick()
      const top = edge(root.querySelector('.foot'), root, 'top')
      expect(top).toBe(90)
      expect(await firstPaint(await snapdom(root, opts), RED, { x: 20 })).toBe(top)
    })

    // Centred by a rule: an inline `margin: 0 auto` is re-resolved on every capture anyway.
    it('a block centred with auto margins follows its shrink-to-fit container', async () => {
      const root = mount('display:inline-block;padding:4px',
        '<div><div class="wide" style="width:100px;height:20px;background:rgb(0,160,0)"></div></div><div class="mid uv-mid"></div>',
        '.uv-mid{width:60px;height:20px;margin:0 auto;background:rgb(0,0,255)}')
      for (let i = 0; i < 4; i++) await snapdom(root, opts)
      root.querySelector('.wide').style.width = '300px'
      await tick()
      const left = edge(root.querySelector('.mid'), root, 'left')
      expect(left).toBe(124)
      expect(await firstPaint(await snapdom(root, opts), BLUE, { y: 34 })).toBe(left)
    })

    it('an absolutely positioned box with no offsets follows the flow it sits in', async () => {
      const root = mount('width:200px;height:120px', '<div><div><span class="text">ab</span></div><span class="badge" style="position:absolute;background:rgb(255,0,0)">badge</span></div>')
      for (let i = 0; i < 4; i++) await snapdom(root, opts)
      root.querySelector('.text').innerHTML = 'ab<br>cd<br>ef'
      await tick()
      const top = edge(root.querySelector('.badge'), root, 'top')
      expect(top).toBe(60)
      expect(await firstPaint(await snapdom(root, opts), RED, { x: 4 })).toBe(top)
    })

    it('a flex item pushed by an auto margin follows the item that grows beside it', async () => {
      const root = mount('width:300px',
        '<div style="display:flex"><div><div class="grow" style="width:50px;height:20px;background:rgb(0,160,0)"></div></div><div class="uv-push"></div></div>',
        '.uv-push{margin-left:auto;width:40px;height:20px;background:rgb(0,0,255)}')
      for (let i = 0; i < 4; i++) await snapdom(root, opts)
      expect(await firstPaint(await snapdom(root, opts), BLUE, { y: 10 })).toBe(260)
      // The pushed item stays put and keeps its box: only its used margin changes.
      root.querySelector('.grow').style.width = '150px'
      await tick()
      expect(getComputedStyle(root.querySelector('.uv-push')).marginLeft).toBe('110px')
      expect(await firstPaint(await snapdom(root, opts), BLUE, { y: 10 })).toBe(260)
    })
  })
}

describe('used values and the cache', () => {
  // The first check after a read compares the two strings; once an edit that moved nothing
  // has taken that check, the next one compares the rectangle.
  for (const settled of [false, true]) {
    it(`a container query follows a container that an edit elsewhere resized${settled ? ', after an edit that moved nothing' : ''}`, async () => {
      const root = mount('width:400px',
        '<div class="uv-row"><div class="uv-side"><div class="uv-inner"></div></div><div class="uv-cont"><div style="width:100px"><div class="uv-box"></div></div></div></div>' +
        '<div><p class="near" style="margin:0">one</p></div>',
        '.uv-row{display:flex;height:40px}.uv-side{flex:none}.uv-inner{width:100px;height:40px;background:rgb(0,160,0)}' +
        '.uv-cont{flex:1 1 0;min-width:0;container-type:inline-size}.uv-box{width:80px;height:20px;background:rgb(0,0,255)}' +
        '@container (max-width:200px){.uv-box{background:rgb(255,0,0)}}')
      await snapdom(root, { burst: false })
      if (settled) {
        root.querySelector('.near').textContent = 'two'
        await tick()
        await snapdom(root, { burst: false })
      }
      root.querySelector('.uv-inner').style.width = '250px'
      await tick()
      // Firefox answers a colour without laying the container out again: ask for a box first.
      void root.offsetWidth
      expect(getComputedStyle(root.querySelector('.uv-box')).backgroundColor).toBe('rgb(255, 0, 0)')
      const res = await snapdom(root, { burst: false })
      expect(await firstPaint(res, RED, { y: 10 })).toBe(250)
      expect(await firstPaint(res, BLUE, { y: 10 })).toBe(-1)
    })
  }

  it('a container query on the height follows a container that only grew taller', async () => {
    const root = mount('width:400px',
      '<div class="uv-row2"><div><div class="tall uv-tall"></div></div><div class="uv-cont2"><div style="width:100px"><div class="uv-box2"></div></div></div></div>',
      '.uv-row2{display:flex}.uv-tall{width:100px;height:40px;background:rgb(0,160,0)}.uv-cont2{flex:1 1 0;min-width:0;container-type:size}' +
      '.uv-box2{width:80px;height:20px;background:rgb(0,0,255)}@container (min-height:100px){.uv-box2{background:rgb(255,0,0)}}')
    for (let i = 0; i < 4; i++) await snapdom(root, { burst: false })
    root.querySelector('.tall').style.height = '120px'
    await tick()
    void root.offsetWidth
    expect(getComputedStyle(root.querySelector('.uv-box2')).backgroundColor).toBe('rgb(255, 0, 0)')
    const res = await snapdom(root, { burst: false })
    expect(await firstPaint(res, RED, { y: 10 })).toBe(100)
    expect(await firstPaint(res, BLUE, { y: 10 })).toBe(-1)
  })

  it('an absolutely positioned box centred by auto margins follows the box it is pinned to', async () => {
    const root = mount('position:relative;width:200px;padding:10px', '<div><p style="margin:0">one</p></div><div class="uv-abs"></div>',
      '.uv-abs{position:absolute;top:0;bottom:0;left:0;margin:auto 0;width:20px;height:10px;background:rgb(255,0,0)}')
    for (let i = 0; i < 4; i++) await snapdom(root, { burst: false })
    expect(await firstPaint(await snapdom(root, { burst: false }), RED, { x: 5 })).toBe(15)
    root.querySelector('p').innerHTML = 'one<br>two<br>three'
    await tick()
    const top = edge(root.querySelector('.uv-abs'), root, 'top')
    expect(top).toBe(35)
    expect(await firstPaint(await snapdom(root, { burst: false }), RED, { x: 5 })).toBe(top)
  })

  it('a block centred inside a cousin follows the width that cousin was left with', async () => {
    const root = mount('width:400px',
      '<div style="display:flex"><div style="flex:none"><div class="inner" style="width:100px;height:20px;background:rgb(0,160,0)"></div></div>' +
      '<div style="flex:1 1 0;min-width:0"><div class="uv-mid"></div></div></div>',
      '.uv-mid{width:60px;height:20px;margin:0 auto;background:rgb(0,0,255)}')
    for (let i = 0; i < 4; i++) await snapdom(root, { burst: false })
    root.querySelector('.inner').style.width = '250px'
    await tick()
    const left = edge(root.querySelector('.uv-mid'), root, 'left')
    expect(left).toBe(295)
    expect(await firstPaint(await snapdom(root, { burst: false }), BLUE, { y: 10 })).toBe(left)
  })

  // Under a vertical writing mode the inline axis runs down the page: the height is what
  // percentages and auto margins resolve against.
  it('a block centred down a vertical line follows the height its container was left with', async () => {
    const root = mount('width:300px',
      '<div style="display:flex"><div><div class="tall" style="width:50px;height:40px;background:rgb(0,160,0)"></div></div><div class="uv-vert"><div class="uv-vmid"></div></div></div>',
      '.uv-vert{writing-mode:vertical-rl;width:100px}.uv-vmid{inline-size:20px;block-size:60px;margin-inline:auto;background:rgb(0,0,255)}')
    for (let i = 0; i < 2; i++) await snapdom(root, { burst: false })
    expect(await firstPaint(await snapdom(root, { burst: false }), BLUE, { x: 120 })).toBe(10)
    root.querySelector('.tall').style.height = '120px'
    await tick()
    const top = edge(root.querySelector('.uv-vmid'), root, 'top')
    expect(top).toBe(50)
    expect(await firstPaint(await snapdom(root, { burst: false }), BLUE, { x: 120 })).toBe(top)
  })

  it('a block centred inside a shadow root follows the width its host was left with', async () => {
    const root = mount('width:400px',
      '<div style="display:flex"><div style="flex:none"><div class="inner" style="width:100px;height:20px;background:rgb(0,160,0)"></div></div>' +
      '<div class="host" style="flex:1 1 0;min-width:0"></div></div>')
    const shadow = root.querySelector('.host').attachShadow({ mode: 'open' })
    shadow.innerHTML = '<style>.mid{width:60px;height:20px;margin:0 auto;background:rgb(0,0,255)}</style><div class="mid"></div>'
    for (let i = 0; i < 4; i++) await snapdom(root, { burst: false })
    root.querySelector('.inner').style.width = '250px'
    await tick()
    const left = edge(shadow.querySelector('.mid'), root, 'left')
    expect(left).toBe(295)
    expect(await firstPaint(await snapdom(root, { burst: false }), BLUE, { y: 10 })).toBe(left)
  })

  it('a block centred in a slot follows the width of the box that holds the slot', async () => {
    const root = mount('width:400px',
      '<div class="host"><div slot="a"><div class="inner" style="width:100px;height:20px;background:rgb(0,160,0)"></div></div><div slot="b" class="uv-mid"></div></div>',
      '.uv-mid{width:60px;height:20px;margin:0 auto;background:rgb(0,0,255)}')
    root.querySelector('.host').attachShadow({ mode: 'open' }).innerHTML =
      '<div style="display:flex"><div style="flex:none"><slot name="a"></slot></div><div style="flex:1 1 0;min-width:0"><slot name="b"></slot></div></div>'
    for (let i = 0; i < 4; i++) await snapdom(root, { burst: false })
    root.querySelector('.inner').style.width = '250px'
    await tick()
    const left = edge(root.querySelector('.uv-mid'), root, 'left')
    expect(left).toBe(295)
    expect(await firstPaint(await snapdom(root, { burst: false }), BLUE, { y: 10 })).toBe(left)
  })

  // The item keeps its border box, its offsets and its margins: only its percentage padding
  // follows the area the grid gives it.
  it('a percentage padding follows the grid area that an edit elsewhere resized', async () => {
    const root = mount('width:420px',
      '<div class="uv-gp"><div><div class="inner" style="width:50px;height:20px;background:rgb(0,160,0)"></div></div><div class="uv-gpb"><div class="uv-gpi"></div></div></div>',
      '.uv-gp{display:grid;grid-template-columns:auto 1fr;width:400px}.uv-gpb{box-sizing:border-box;width:200px;padding-left:20%;height:20px}' +
      '.uv-gpi{height:20px;background:rgb(0,0,255)}')
    for (let i = 0; i < 4; i++) await snapdom(root, { burst: false })
    expect(await firstPaint(await snapdom(root, { burst: false }), BLUE, { y: 10 })).toBe(120)
    root.querySelector('.inner').style.width = '150px'
    await tick()
    const left = edge(root.querySelector('.uv-gpi'), root, 'left')
    expect(left).toBe(200)
    expect(await firstPaint(await snapdom(root, { burst: false }), BLUE, { y: 10 })).toBe(left)
  })

  it('a relative box offset by a percentage follows the height of the box around it', async () => {
    const root = mount('position:relative;width:200px;padding:10px',
      '<div><p style="margin:0">one</p></div><div class="uv-over"><div class="dot uv-dot"></div></div>',
      '.uv-over{position:absolute;top:0;right:0;bottom:0;left:0}.uv-dot{position:relative;top:50%;width:20px;height:10px;background:rgb(255,0,0)}')
    for (let i = 0; i < 4; i++) await snapdom(root, { burst: false })
    root.querySelector('p').innerHTML = 'one<br>two<br>three'
    await tick()
    const top = edge(root.querySelector('.dot'), root, 'top')
    expect(top).toBe(40)
    expect(await firstPaint(await snapdom(root, { burst: false }), RED, { x: 5 })).toBe(top)
  })

  // Against a box with no height every percentage reads 0px, which the record leaves out.
  it('a percentage offset follows a box that had no height when it was read', async () => {
    const root = mount('width:200px;padding:10px',
      '<div class="uv-rel"><div><p style="margin:0"></p></div><div class="uv-over"><div class="dot uv-dot"></div></div></div><div style="height:60px"></div>',
      '.uv-rel{position:relative}.uv-over{position:absolute;top:0;right:0;bottom:0;left:0}.uv-dot{position:relative;top:50%;width:20px;height:10px;background:rgb(255,0,0)}')
    for (let i = 0; i < 4; i++) await snapdom(root, { burst: false })
    root.querySelector('p').innerHTML = 'one<br>two'
    await tick()
    const top = edge(root.querySelector('.dot'), root, 'top')
    expect(top).toBe(30)
    expect(await firstPaint(await snapdom(root, { burst: false }), RED, { x: 15 })).toBe(top)
  })

  // Typed OM keeps the keyword where it exists. Firefox reads 0px and has to ask again.
  it('an auto margin that had no room gets its share when the line frees some', async () => {
    const root = mount('width:300px',
      '<div style="display:flex"><div><div class="fill" style="width:260px;height:20px;background:rgb(0,160,0)"></div></div><div class="uv-push"></div></div>',
      '.uv-push{margin-left:auto;width:40px;height:20px;background:rgb(0,0,255)}')
    for (let i = 0; i < 4; i++) await snapdom(root, { burst: false })
    root.querySelector('.fill').style.width = '100px'
    await tick()
    expect(await firstPaint(await snapdom(root, { burst: false }), BLUE, { y: 10 })).toBe(260)
  })

  it('still serves the cached snapshot of every node nothing moved', async () => {
    const root = mount('position:relative;width:300px;padding:10px 10px 40px',
      '<div><p class="near" style="margin:0">one</p></div>' +
      '<div class="k" style="position:absolute;left:0;bottom:0;width:100%;height:20px"></div>' +
      '<div class="k" style="display:flex"><div class="k" style="width:50px">a</div><div class="k uv-push">b</div></div>' +
      '<div class="k" style="display:grid;grid-template-columns:1fr 1fr"><div class="k" style="margin:auto;width:20px">c</div><div class="k" style="margin:2px 5%">d</div></div>' +
      '<div class="k" style="position:relative;top:5px">e</div>' +
      '<div class="k" style="position:sticky;top:0">f</div>' +
      '<div class="k uv-mid"></div>' +
      '<span class="k" style="position:absolute;right:3px;top:calc(50% - 3px)">g</span>' +
      '<table class="k"><tr class="k"><td class="k">h</td><td class="k" style="width:33.333%">i</td></tr></table>',
      '.uv-push{margin-left:auto;width:40px}.uv-mid{width:60px;height:20px;margin:0 auto}')
    await snapdom(root, { burst: false })
    const nodes = Array.from(root.querySelectorAll('.k'))
    for (let i = 0; i < 3; i++) {
      const kept = nodes.map((el) => snapshotFor(el))
      expect(kept.every(Boolean)).toBe(true)
      root.querySelector('.near').textContent = 'two' + i
      await tick()
      await snapdom(root, { burst: false })
      expect(nodes.filter((el, n) => snapshotFor(el) !== kept[n]).map((el) => el.outerHTML.slice(0, 60))).toEqual([])
    }
  })

  // A height that changes moves what is pinned to it, and each of those reads its own
  // offsets. Re-reading every box under the one that grew cost 61 to 139% a recapture.
  it('a box that grows does not send the boxes beside it back to a full read', async () => {
    const root = mount('width:300px',
      '<div><p class="grow" style="margin:0">one</p></div>' +
      '<section class="k"><div class="k">a</div><div class="k" style="width:50%">b</div><p class="k" style="margin:4px 0">c</p></section>')
    await snapdom(root, { burst: false })
    const nodes = Array.from(root.querySelectorAll('.k'))
    const kept = nodes.map((el) => snapshotFor(el))
    const height = root.getBoundingClientRect().height
    root.querySelector('.grow').innerHTML = 'one<br>two<br>three'
    await tick()
    expect(root.getBoundingClientRect().height).toBe(height + 40)
    await snapdom(root, { burst: false })
    expect(nodes.filter((el, n) => snapshotFor(el) !== kept[n]).map((el) => el.outerHTML.slice(0, 60))).toEqual([])
  })

  it('a property excludeStyleProps takes does not send its node back to a full read', async () => {
    const opts = { burst: false, excludeStyleProps: /^(top|margin-left|height)$/ }
    const root = mount('position:relative;width:300px',
      '<div><p class="near" style="margin:0">one</p></div><div class="k" style="position:absolute;left:10px;top:10px;width:50px"></div>' +
      '<div style="display:flex"><p class="k" style="margin:auto">a</p><span class="k" style="margin:5%">b</span></div>')
    await snapdom(root, opts)
    const nodes = Array.from(root.querySelectorAll('.k'))
    for (let i = 0; i < 2; i++) {
      const kept = nodes.map((el) => snapshotFor(el))
      root.querySelector('.near').textContent = 'two' + i
      await tick()
      await snapdom(root, opts)
      expect(nodes.filter((el, n) => snapshotFor(el) !== kept[n]).map((el) => el.outerHTML.slice(0, 60))).toEqual([])
    }
  })

  it('a recapture reads no box while nothing has happened on the page', async () => {
    const root = mount('width:300px',
      '<div><p class="near" style="margin:0">one</p></div><section><div class="k" style="width:50px;height:10px"></div><div class="k" style="width:60px;height:10px"></div></section>')
    const nodes = new Set(root.querySelectorAll('.k'))
    const read = Element.prototype.getBoundingClientRect
    let reads = 0
    Element.prototype.getBoundingClientRect = function () {
      if (nodes.has(this)) reads++
      return read.call(this)
    }
    try {
      await snapdom(root, { burst: false })
      reads = 0
      await snapdom(root, { burst: false })
      expect(reads).toBe(0)
      root.querySelector('.near').textContent = 'two'
      await tick()
      await snapdom(root, { burst: false })
      expect(reads).toBe(nodes.size)
      await snapdom(root, { burst: false })
      expect(reads).toBe(nodes.size)
    } finally {
      Element.prototype.getBoundingClientRect = read
    }
  })

  // WebKit's paint probe is an <img> the exporter mounts in the document on every export.
  it('a load of one of snapdom\'s own nodes leaves the clock alone', async () => {
    const root = mount('width:300px', '<section><div class="k" style="width:50px;height:10px"></div><div class="k" style="width:60px;height:10px"></div></section>')
    const nodes = new Set(root.querySelectorAll('.k'))
    const read = Element.prototype.getBoundingClientRect
    let reads = 0
    Element.prototype.getBoundingClientRect = function () {
      if (nodes.has(this)) reads++
      return read.call(this)
    }
    const own = markInternalNode(document.createElement('img'))
    try {
      for (let i = 0; i < 2; i++) await snapdom(root, { burst: false })
      reads = 0
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 4
      const loaded = new Promise((resolve) => own.addEventListener('load', resolve, { once: true }))
      own.src = canvas.toDataURL()
      document.body.appendChild(own)
      await loaded
      await tick()
      await snapdom(root, { burst: false })
      expect(reads).toBe(0)
    } finally {
      Element.prototype.getBoundingClientRect = read
      own.remove()
    }
  })

  // An animation held at one end and moved by hand: boxes change with no record and no timer.
  it('a box an animation pushes is read again on the next frame', async () => {
    const root = mount('width:400px',
      '<div style="display:flex"><div class="a" style="flex:none;width:50px;height:20px;background:rgb(0,160,0)"></div>' +
      '<div style="flex:1 1 0;min-width:0"><div class="uv-mid"></div></div></div>',
      '.uv-mid{width:60px;height:20px;margin:0 auto;background:rgb(0,0,255)}')
    const animation = root.querySelector('.a').animate([{ width: '50px' }, { width: '200px' }], { duration: 1000, fill: 'both' })
    animation.pause()
    for (let i = 0; i < 2; i++) await snapdom(root, { burst: false })
    animation.currentTime = 1000
    const left = edge(root.querySelector('.uv-mid'), root, 'left')
    expect(left).toBe(270)
    expect(await firstPaint(await snapdom(root, { burst: false }), BLUE, { y: 10 })).toBe(left)
  })

  it('a grid keeps up with the tracks an animation gives it', async () => {
    const root = mount('width:400px', '<div class="uv-g"><div class="a" style="width:50px;height:20px;background:rgb(0,160,0)"></div><div class="uv-b"></div></div>',
      '.uv-g{display:grid;grid-template-columns:auto 1fr;width:300px}.uv-b{height:20px;background:rgb(0,0,255)}')
    const animation = root.querySelector('.a').animate([{ width: '50px' }, { width: '200px' }], { duration: 1000, fill: 'both' })
    animation.pause()
    for (let i = 0; i < 2; i++) await snapdom(root, { burst: false })
    animation.currentTime = 1000
    expect(getComputedStyle(root.querySelector('.uv-g')).gridTemplateColumns).toBe('200px 100px')
    expect(await firstPaint(await snapdom(root, { burst: false }), BLUE, { y: 10 })).toBe(200)
  })

  // A lazy image loads when it scrolls into view: neither the scroll nor the load is a record.
  // It sits beside the captured box, not in it: a capture fetches the images it clones.
  it('an image that loads between two captures moves the box beside it', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 60
    canvas.height = 20
    canvas.getContext('2d').fillRect(0, 0, 60, 20)
    const url = URL.createObjectURL(await new Promise((resolve) => canvas.toBlob(resolve)))
    const outer = mount('width:300px',
      '<div class="scroller" style="height:60px;overflow:hidden"><div style="height:30000px"></div>' +
      `<div style="display:flex;height:40px"><div style="flex:none;line-height:0"><img loading="lazy" src="${url}"></div>` +
      '<div class="target" style="flex:1 1 0;min-width:0;background:rgb(255,255,255)"><div class="uv-mid"></div></div></div></div>',
      '.uv-mid{width:60px;height:20px;margin:0 auto;background:rgb(0,0,255)}')
    const img = outer.querySelector('img')
    const target = outer.querySelector('.target')
    try {
      for (let i = 0; i < 2; i++) await snapdom(target, { burst: false })
      expect(img.naturalWidth).toBe(0)
      const loaded = new Promise((resolve, reject) => {
        img.addEventListener('load', resolve, { once: true })
        setTimeout(() => reject(new Error('the lazy image never loaded')), 5000)
      })
      const scroller = outer.querySelector('.scroller')
      scroller.scrollTop = scroller.scrollHeight
      await loaded
      await tick()
      const left = edge(outer.querySelector('.uv-mid'), target, 'left')
      expect(left).toBe(90)
      expect(await firstPaint(await snapdom(target, { burst: false }), BLUE, { y: 10 })).toBe(left)
    } finally {
      URL.revokeObjectURL(url)
    }
  })

  it('the differential path follows the tracks of a grid whose item was edited', async () => {
    const root = mount('width:400px', '<div class="uv-g2"><div></div><div class="uv-t"><span class="t">ab</span></div><div class="uv-b"></div></div>',
      '.uv-g2{display:grid;grid-template-columns:20px auto 1fr;width:300px}.uv-t{white-space:nowrap;background:rgb(0,160,0)}.uv-b{height:20px;background:rgb(0,0,255)}')
    for (let i = 0; i < 4; i++) await snapdom(root)
    const served = __diffStats.served
    root.querySelector('.t').textContent = 'abcdefghijklmnop'
    await tick()
    const res = await snapdom(root)
    expect(__diffStats.served).toBe(served + 1)
    const left = edge(root.querySelector('.uv-b'), root, 'left')
    expect(left).toBeGreaterThan(100)
    expect(await firstPaint(res, BLUE, { y: 10 })).toBe(left)
  })

  it('the differential path serves the frame it repaired', async () => {
    const root = mount('position:relative;width:200px;padding:10px 10px 40px',
      '<div><p style="margin:0">one</p></div><div class="foot" style="position:absolute;left:0;bottom:0;width:100%;height:20px;background:rgb(255,0,0)"></div>')
    for (let i = 0; i < 4; i++) await snapdom(root)
    const served = __diffStats.served
    root.querySelector('p').innerHTML = 'one<br>two'
    await tick()
    const res = await snapdom(root)
    expect(__diffStats.served).toBe(served + 1)
    expect(await firstPaint(res, RED, { x: 20 })).toBe(edge(root.querySelector('.foot'), root, 'top'))
  })
})
