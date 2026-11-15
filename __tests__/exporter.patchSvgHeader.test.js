// patchSvgHeader rewrites the root <svg> tag inside a data URL without decoding the payload.
// A scaled toImg or toSvg and a cropped or oversized toCanvas go through it off WebKit: on a
// 1.2 MB capture toImg({ scale: 2 }) took 6.0 ms through decode, replace and encode, and takes
// 2.2 ms through the patch (Chromium). The contract is byte equality with that slow path.
import { describe, it, expect } from 'vitest'
import { snapdom } from '../src/index.js'
import { patchSvgHeader, decodeSvgFromDataURL, encodeSvgToDataURL, cropSvgText } from '../src/exporters/svgText.js'
import { isSafari } from '../src/utils/browser.js'

const mounted = []
function capture() {
  const el = document.createElement('div')
  // Multi-byte text, a percent sign and a shadow: what percent-encoding has to get right.
  el.style.cssText = 'width:200px;padding:8px;font:14px Arial;box-shadow:0 2px 6px rgba(0,0,0,.4)'
  el.textContent = '100% ñandú 日本語 😀 <tag> & "quotes"'
  document.body.appendChild(el)
  mounted.push(el)
  return snapdom(el, { dpr: 1, scale: 1, burst: false })
}
const slow = (url, fn) => {
  const svg = decodeSvgFromDataURL(url)
  const head = svg.match(/<svg\b[^>]*>/i)[0]
  return encodeSvgToDataURL(svg.replace(head, fn(head)))
}

describe('patchSvgHeader', () => {
  it('gives the URL that decoding, replacing the tag and encoding gives', async () => {
    const { url } = await capture()
    const widen = (head) => head.replace(/\bwidth="[^"]*"/i, 'width="999"')
    expect(patchSvgHeader(url, widen)).toBe(slow(url, widen))
    const crop = (head) => cropSvgText(head, { x: 4, y: 2, width: 50, height: 20 }, { shiftContent: false })
    expect(patchSvgHeader(url, crop)).toBe(slow(url, crop))
    // The identity leaves the URL as it was.
    expect(patchSvgHeader(url, (head) => head)).toBe(url)
    while (mounted.length) mounted.pop().remove()
  })

  it('answers null when the payload does not start with its root tag, encoded as snapdom writes it', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"/>'
    const same = (head) => head
    // A prolog before the tag, a base64 payload, and an encoding that escapes less.
    expect(patchSvgHeader('data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<?xml version="1.0"?>' + svg), same)).toBeNull()
    expect(patchSvgHeader('data:image/svg+xml;base64,' + btoa(svg), same)).toBeNull()
    expect(patchSvgHeader('data:image/svg+xml;charset=utf-8,' + encodeURI(svg), same)).toBeNull()
    expect(patchSvgHeader('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), same)).not.toBeNull()
  })

  // WebKit sizes a scaled toImg through zoomSvgText, which rewrites the body as well.
  it.skipIf(isSafari())('a scaled toImg carries the patched tag and the same body', async () => {
    const result = await capture()
    const img = await result.toImg({ scale: 2 })
    const head = decodeSvgFromDataURL(result.url).match(/<svg\b[^>]*>/i)[0]
    const w = Number(head.match(/\bwidth="([\d.]+)"/i)[1])
    const scaled = decodeSvgFromDataURL(img.src), plain = decodeSvgFromDataURL(result.url)
    expect(scaled.match(/<svg\b[^>]*>/i)[0]).toContain(`width="${Math.round(w * 2)}"`)
    expect(scaled.slice(scaled.indexOf('>'))).toBe(plain.slice(plain.indexOf('>')))
    while (mounted.length) mounted.pop().remove()
  })
})
