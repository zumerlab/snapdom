// __tests__/regression.svgGradientVar.test.js – #515: var() inside a paint server resolves in place
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

let outer
afterEach(() => { outer?.remove(); document.getElementById('sd515-style')?.remove() })

/** Mounts the #515 scene: the custom properties live ABOVE the capture root, as on :root. */
function mount(stopMarkup) {
  outer = document.createElement('div')
  outer.style.cssText = '--g-start:rgb(255,0,0);--g-end:rgb(255,0,0)'
  const host = document.createElement('div')
  host.style.cssText = 'width:100px;background:#fff'
  host.innerHTML = `<svg width="100" height="100" viewBox="0 0 100 100" style="display:block">
    <defs><linearGradient id="sd515">${stopMarkup}</linearGradient></defs>
    <rect width="100" height="100" fill="url(#sd515)"/></svg>`
  outer.appendChild(host)
  document.body.appendChild(outer)
  return host
}

/** Share of pixels that paint as pure-ish red. */
async function redShare(el) {
  const canvas = await (await snapdom(el, { cache: 'disabled', scale: 1 })).toCanvas()
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  let red = 0
  for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] < 60) red++
  return red / (data.length / 4)
}

describe('#515 gradient stops with var()', () => {
  it('paints a stop-color attribute that reads a custom property', async () => {
    const el = mount('<stop offset="0" stop-color="var(--g-start)"/><stop offset="1" stop-color="var(--g-end)"/>')
    expect(await redShare(el)).toBeGreaterThan(0.9)
  })

  it('paints a stop-color set by a stylesheet rule through var()', async () => {
    const style = document.createElement('style')
    style.id = 'sd515-style'
    style.textContent = '.sd515-a{stop-color:var(--g-start)}.sd515-b{stop-color:var(--g-end)}'
    document.head.appendChild(style)
    const el = mount('<stop offset="0" class="sd515-a"/><stop offset="1" class="sd515-b"/>')
    expect(await redShare(el)).toBeGreaterThan(0.9)
  })
})
