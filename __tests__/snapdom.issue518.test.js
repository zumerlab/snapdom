import { afterEach, describe, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'

let host
afterEach(() => host?.remove())

function fixture(position = 'position:relative;', offsets = 'top:150px;left:120px;') {
  host = document.createElement('div')
  host.style.cssText = 'position:relative;width:400px;height:300px;background:white'
  host.innerHTML = `<div id="pane" style="${position}width:300px;height:200px;overflow:auto;background:white">
    <div style="width:1000px;height:1000px"></div>
    <div id="box" style="position:absolute;${offsets}width:100px;height:40px;background:red">
      <span id="label" style="position:absolute;top:0;left:10px;width:30px;height:20px;background:blue"></span>
    </div>
  </div>`
  document.body.appendChild(host)
  const pane = host.querySelector('#pane')
  pane.scrollTop = 100
  pane.scrollLeft = 100
  return pane
}

async function check(root, options = {}) {
  const canvas = await snapdom.toCanvas(root, { dpr: 1, embedFonts: false, burst: false, ...options })
  const ctx = canvas.getContext('2d')
  const rootRect = root.getBoundingClientRect()
  for (const [id, color] of [['box', [255, 0, 0]], ['label', [0, 0, 255]]]) {
    const rect = host.querySelector(`#${id}`).getBoundingClientRect()
    const x = Math.round(rect.left - rootRect.left + 5)
    const y = Math.round(rect.top - rootRect.top + 25 * (id === 'box') + 5)
    expect(Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3), id).toEqual(color)
  }
}

describe('positioned descendants in scrolled containers (#518)', () => {
  it('keeps nested absolute boxes at their live position on both axes', async () => {
    await check(fixture())
  })
  it('resolves percentages against the positioned scroller, not the tall wrapper', async () => {
    await check(fixture('position:relative;', 'top:75%;left:40%;'))
  })
  it('preserves compensation for an external containing block', async () => {
    fixture('')
    await check(host)
  })
  it('recognizes a transformed containing block', async () => {
    await check(fixture('transform:translate(0);'))
  })
  it('keeps fixed boxes relative to their transformed ancestor', async () => {
    fixture('transform:translate(0);')
    host.querySelector('#box').style.position = 'fixed'
    await check(host)
  })
  it('preserves painted coordinates of hoisted fixed boxes and their labels', async () => {
    const pane = fixture()
    const box = host.querySelector('#box')
    const rect = pane.getBoundingClientRect()
    box.style.position = 'fixed'
    box.style.top = `${rect.top + 50}px`
    box.style.left = `${rect.left + 20}px`
    await check(pane)
  })
  it('handles positions supplied by a stylesheet', async () => {
    const pane = fixture()
    const box = host.querySelector('#box')
    box.style.removeProperty('position')
    box.style.removeProperty('top')
    box.style.removeProperty('left')
    const style = document.createElement('style')
    style.textContent = '#box{position:absolute;top:150px;left:120px}'
    host.appendChild(style)
    await check(pane)
  })
  it('does not compensate again for an inner scroller', async () => {
    const pane = fixture()
    const inner = document.createElement('div')
    inner.style.cssText = 'position:relative;width:500px;height:400px;overflow:auto'
    while (pane.firstChild) inner.appendChild(pane.firstChild)
    pane.appendChild(inner)
    inner.scrollTop = 20
    inner.scrollLeft = 10
    pane.scrollTop = 100
    pane.scrollLeft = 100
    await check(pane)
  })
  it('compensates an ordinary scrolled capture root in clip mode', async () => {
    const pane = fixture()
    const r = pane.getBoundingClientRect()
    await check(pane, { clip: { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height } })
  })
  it('keeps nested scrollers correct when capturing their ancestor with clip', async () => {
    fixture()
    const r = host.getBoundingClientRect()
    await check(host, { clip: { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height } })
  })
})
