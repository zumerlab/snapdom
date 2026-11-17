// A capture burst does not watch (here a tree with a <canvas>) has no render state to compare.
// A control written by script leaves no mutation record and no event, so what its state styles
// kept the cached snapshot and painted the old state (burst.js, refreshUnwatchedControls).
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

let host
afterEach(() => host?.remove())

async function ink() {
  const canvas = await (await snapdom(host, { scale: 1, dpr: 1, embedFonts: false })).toCanvas()
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  let red = 0, green = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 200 && data[i + 1] < 80) red++
    if (data[i + 1] > 120 && data[i] < 80) green++
  }
  return { red, green }
}

function mount(control) {
  host = document.createElement('div')
  host.style.cssText = 'position:absolute;left:0;top:0;width:300px;padding:10px;background:#fff'
  host.innerHTML = '<style>.uc label{color:rgb(0,160,0);font:bold 40px sans-serif}' +
    '.uc input:placeholder-shown + label,.uc input[type=checkbox]:checked + label{color:rgb(255,0,0)}</style>' +
    `<div class="uc">${control}<label>LBLLBL</label><canvas width="10" height="10"></canvas></div>`
  document.body.appendChild(host)
}

describe('form state written by script, outside burst', () => {
  it('a value restyles what :placeholder-shown styled', async () => {
    mount('<input placeholder="p">')
    expect((await ink()).red).toBeGreaterThan(500)
    host.querySelector('input').value = 'abc'
    const after = await ink()
    expect(after.red).toBe(0)
    expect(after.green).toBeGreaterThan(500)
  })

  it('an unchecked box restyles what :checked styled', async () => {
    mount('<input type="checkbox" checked>')
    expect((await ink()).red).toBeGreaterThan(500)
    host.querySelector('input').checked = false
    const after = await ink()
    expect(after.red).toBe(0)
    expect(after.green).toBeGreaterThan(500)
  })
})
