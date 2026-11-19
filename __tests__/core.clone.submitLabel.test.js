// A submit or reset button with no value shows the UA's own label. The clone wrote the empty
// live value back as `value=""`, which blanks it (found on html2pdf.js's all-tags page).
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

let host
afterEach(() => { host?.remove(); host = null })

async function serialized(html, prepare) {
  host = document.createElement('div')
  host.style.cssText = 'width:300px;background:white'
  host.innerHTML = html
  document.body.appendChild(host)
  prepare?.(host)
  const res = await snapdom(host, { cache: 'disabled' })
  return decodeURIComponent(res.url.split(',')[1])
}

const tagOf = (svg, type) => svg.match(new RegExp(`<input[^>]*type="${type}"[^>]*>`))[0]

describe('the value of a cloned input', () => {
  it('leaves a submit and a reset button their default label', async () => {
    const svg = await serialized('<input type="submit"><input type="reset">')
    expect(tagOf(svg, 'submit')).not.toContain('value=')
    expect(tagOf(svg, 'reset')).not.toContain('value=')
  })

  it('keeps a label the author emptied on purpose', async () => {
    const svg = await serialized('<input type="submit" value="">')
    expect(tagOf(svg, 'submit')).toContain('value=""')
  })

  it('still carries a typed value, and a field the user cleared', async () => {
    const svg = await serialized('<input type="text" id="typed"><input type="search" id="cleared" value="initial">', (root) => {
      root.querySelector('#typed').value = 'typed'
      root.querySelector('#cleared').value = ''
    })
    expect(tagOf(svg, 'text')).toContain('value="typed"')
    expect(tagOf(svg, 'search')).toContain('value=""')
  })

  it('paints the default label', async () => {
    host = document.createElement('div')
    host.style.cssText = 'display:inline-block;background:white'
    host.innerHTML = '<input type="submit" style="font:20px sans-serif;border:0;background:white;color:rgb(0,0,0);padding:8px">'
    document.body.appendChild(host)
    const canvas = await (await snapdom(host, { cache: 'disabled', dpr: 1, scale: 1 })).toCanvas()
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let ink = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] < 90 && d[i + 3] > 200) ink++
    expect(ink).toBeGreaterThan(20)
  })
})
