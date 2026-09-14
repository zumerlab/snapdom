/** Verify official image exports against captured pixels and v3 export options. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearPlugins, snapdom } from '../src/index.js'
import { asciiExport } from '../packages/plugins/ascii-export.js'
import { pdfImage } from '../packages/plugins/pdf-image.js'

const mounted = []
afterEach(() => {
  mounted.splice(0).forEach(el => el.remove())
  clearPlugins()
  vi.restoreAllMocks()
})

function box(css = '') {
  const el = document.createElement('div')
  el.style.cssText = `width:80px;height:40px;${css}`
  document.body.append(el)
  mounted.push(el)
  return el
}

async function pdf(result) {
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const url = await result.toPdfImage()
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
  URL.revokeObjectURL(url)
  const text = new TextDecoder('latin1').decode(bytes)
  const header = /\/Subtype \/Image \/Width (\d+) \/Height (\d+)[^]*?\/Length (\d+) >>\nstream\n/.exec(text)
  expect(header).not.toBeNull()
  const start = header.index + header[0].length
  const image = new Image()
  image.src = URL.createObjectURL(new Blob([bytes.slice(start, start + Number(header[3]))], { type: 'image/jpeg' }))
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  canvas.getContext('2d').drawImage(image, 0, 0)
  URL.revokeObjectURL(image.src)
  return { bytes, text, canvas }
}

describe('official ASCII export on v3', () => {
  it('keeps character width independent of capture width and maps dark pixels to dense characters', async () => {
    const result = await snapdom(box('background:linear-gradient(to right, black 50%, white 50%)'), {
      width: 160, dpr: 1, embedFonts: false, plugins: [asciiExport({ width: 8, charset: ' @' })],
    })
    expect(await result.toAscii()).toBe('@@@@    \n'.repeat(2))
    expect(await result.toAscii({ width: 4, invert: true })).toBe('  @@\n')
  })

  it('keeps one row for a wide capture and treats transparency as the light background', async () => {
    const result = await snapdom(box('width:1000px;height:1px'), {
      dpr: 1, embedFonts: false, plugins: [asciiExport({ width: 4, charset: ' @' })],
    })
    expect(await result.toAscii()).toBe('    \n')
  })

  it('exports frozen pixels repeatedly without entering image export hooks', async () => {
    const el = box('background:black')
    const seen = []
    const result = await snapdom(el, { dpr: 1, embedFonts: false, plugins: [
      asciiExport({ width: 4, charset: ' @' }),
      { name: 'observe', beforeExport(_ctx, { format }) { seen.push(format) } },
    ] })
    el.style.background = 'white'
    expect(await result.toAscii()).toBe('@@@@\n')
    expect(await result.toAscii()).toBe('@@@@\n')
    expect(seen).toEqual(['ascii', 'ascii'])
  })
})

describe('official PDF image export on v3', () => {
  it('uses capture scale and dpr and puts transparent content on a white PDF page', async () => {
    const result = await snapdom(box(), {
      scale: 2, dpr: 2, embedFonts: false, plugins: [pdfImage()],
    })
    const { canvas } = await pdf(result)
    expect([canvas.width, canvas.height]).toEqual([320, 160])
    expect([...canvas.getContext('2d').getImageData(10, 10, 1, 1).data]).toEqual([255, 255, 255, 255])
  })

  it('writes a valid PDF cross-reference table and honors the constructor orientation and filename', async () => {
    const result = await snapdom(box('background:red'), {
      dpr: 1, embedFonts: false, plugins: [pdfImage({ orientation: 'landscape', filename: 'report.pdf' })],
    })
    let filename
    vi.spyOn(HTMLAnchorElement.prototype, 'download', 'set').mockImplementation(value => { filename = value })
    const { text, bytes } = await pdf(result)
    expect(text).toContain('/MediaBox [0 0 841.89 595.28]')
    expect(filename).toBe('report.pdf')
    const xref = Number(/startxref\n(\d+)/.exec(text)[1])
    expect(new TextDecoder().decode(bytes.slice(xref, xref + 4))).toBe('xref')
    const entries = text.slice(xref).match(/\d{10} 00000 n /g)
    expect(entries).toHaveLength(5)
    entries.forEach((entry, i) => {
      const offset = Number(entry.slice(0, 10))
      expect(new TextDecoder().decode(bytes.slice(offset, offset + 7))).toBe(`${i + 1} 0 obj`)
    })
  })
})
