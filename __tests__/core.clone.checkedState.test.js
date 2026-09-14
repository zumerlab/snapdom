import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { isFirefox } from '../src/utils/browser.js'

let host
afterEach(() => host?.remove())
const options = { burst: false, embedFonts: false, dpr: 1, scale: 1 }

async function ink(result) {
  const canvas = await result.toCanvas()
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  let count = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] && (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200)) count++
  }
  return count
}

describe('checked attribute follows the live state through SVG serialization', () => {
  it.each(['checkbox', 'radio'])('keeps a previously checked %s unchecked', async (type) => {
    host = document.createElement('div')
    host.style.cssText = 'width:40px;background:white'
    host.innerHTML = `<input type="${type}" checked style="width:30px;height:30px">`
    document.body.appendChild(host)
    const input = host.firstChild
    input.checked = false
    const result = await snapdom(host, options)
    if (!isFirefox()) {
      const svg = new DOMParser().parseFromString(decodeURIComponent(result.url.slice(result.url.indexOf(',') + 1)), 'image/svg+xml')
      expect(svg.querySelector('input').hasAttribute('checked')).toBe(false)
      expect(svg.querySelector('input').checked).toBe(false)
    }
    // Removing a DEFAULT attribute leaves this dirty live property false. Both sources
    // paint the same control, and their exports must too (the bug painted the first on).
    const actualInk = await ink(result)
    input.removeAttribute('checked')
    expect(await ink(await snapdom(host, options))).toBe(actualInk)
    input.checked = true
    expect(await ink(await snapdom(host, options))).not.toBe(actualInk)
  })
})
