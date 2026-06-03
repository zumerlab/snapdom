// #425 — the real ExtJS cause: XML-1.0-invalid control characters (e.g. U+0003, which
// ExtJS hidden inputs use as a value delimiter) survive into the serialized SVG and make
// the data: URL unparseable → toCanvas throws "EncodingError: The source image cannot be
// decoded". snapdom must strip these before serialization.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { snapdom } from '../src/index'

const ETX = String.fromCharCode(3) // U+0003, illegal in XML 1.0

// True if the string carries any XML-1.0-illegal char (C0 controls except TAB/LF/CR).
function hasInvalidXMLChar(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if ((c >= 0x00 && c <= 0x08) || c === 0x0b || c === 0x0c || (c >= 0x0e && c <= 0x1f) ||
        c === 0xfffe || c === 0xffff) return true
  }
  return false
}

describe('#425 invalid XML chars', () => {
  let host
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host) })
  afterEach(() => host.remove())

  it('does not throw EncodingError when an input value contains U+0003', async () => {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.value = ETX + '0' + ETX + '0' + ETX // ExtJS-style delimiter
    host.appendChild(input)
    const visible = document.createElement('div')
    visible.textContent = 'cell' + ETX + 'value' // control char in text content too
    host.appendChild(visible)

    // Would throw "EncodingError" without the fix.
    const canvas = await snapdom.toCanvas(host, { scale: 1, dpr: 1 })
    expect(canvas).toBeInstanceOf(HTMLCanvasElement)
  })

  it('produces an SVG free of XML-invalid control characters', async () => {
    const input = document.createElement('input')
    input.value = 'a' + ETX + 'b' + ETX + 'c'
    host.appendChild(input)
    host.appendChild(document.createTextNode('x' + ETX + 'y'))

    const raw = await snapdom.toRaw(host)
    const svg = decodeURIComponent(raw.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''))
    expect(hasInvalidXMLChar(svg)).toBe(false)
  })

  it('keeps valid whitespace (tab/newline) intact', async () => {
    host.appendChild(document.createTextNode('keep\ttab\nand newline'))
    const raw = await snapdom.toRaw(host)
    const svg = decodeURIComponent(raw.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''))
    expect(svg).toMatch(/keep\ttab\nand newline/)
  })
})
