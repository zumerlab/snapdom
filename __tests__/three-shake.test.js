import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { snapdom } from '../src/index'

describe('snapdom API (lazy exporters + plugins)', () => {
  let el

  beforeEach(() => {
    el = document.createElement('div')
    el.style.width = '120px'
    el.style.height = '60px'
    el.style.background = 'linear-gradient(90deg, red, blue)'
    el.textContent = 'snapdom'
    document.body.appendChild(el)
  })

  afterEach(() => {
    document.body.removeChild(el)
    el = null
  })

  // -------- Core: básicos --------

  it('toRaw devuelve un data URL SVG', async () => {
    const url = await snapdom.toRaw(el)
    expect(url).toMatch(/^data:image\/svg\+xml/)
  })

  it('toImg devuelve HTMLImageElement con data:image/svg+xml', async () => {
    const img = await snapdom.toImg(el)
    expect(img).toBeInstanceOf(HTMLImageElement)
    expect(img.src).toMatch(/^data:image\/svg\+xml/)
  })

  it('toCanvas devuelve HTMLCanvasElement', async () => {
    const canvas = await snapdom.toCanvas(el)
    expect(canvas).toBeInstanceOf(HTMLCanvasElement)
    expect(canvas.width).toBeGreaterThan(0)
    expect(canvas.height).toBeGreaterThan(0)
  })

  // -------- Exportadores raster (lazy) --------

  it('toPng devuelve HTMLImageElement con data:image/png', async () => {
    const img = await snapdom.toPng(el)
    expect(img).toBeInstanceOf(HTMLImageElement)
    expect(img.src).toMatch(/^data:image\/png/)
  })

  it('toJpg devuelve HTMLImageElement con data:image/jpeg', async () => {
    const img = await snapdom.toJpg(el)
    expect(img).toBeInstanceOf(HTMLImageElement)
    expect(img.src).toMatch(/^data:image\/jpeg/)
  })

  it('toWebp devuelve HTMLImageElement con data:image/webp', async () => {
    const img = await snapdom.toWebp(el)
    expect(img).toBeInstanceOf(HTMLImageElement)
    expect(img.src).toMatch(/^data:image\/webp/)
  })

  it('toBlob con { type: "svg" } devuelve Blob image/svg+xml', async () => {
    const blob = await snapdom.toBlob(el, { type: 'svg' })
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('image/svg+xml')
  })

  // -------- Runner .to(type) y helpers dinámicos --------

  it('result.to("png") funciona y sólo expone helpers para exports existentes', async () => {
    const result = await snapdom(el)
    const png = await result.to('png')
    expect(png).toBeInstanceOf(HTMLImageElement)

    // pedir un tipo desconocido debe fallar con mensaje claro
    await expect(result.to('doesNotExist')).rejects.toThrow(/Unknown export type/i)
  })

  // -------- Plugins: defineExports() agrega helpers dinámicos --------

  it('plugin via defineExports agrega un helper dinámico (p.ej., toAscii)', async () => {
    // Plugin mínimo que define un exportador "ascii"
    const asciiPlugin = {
      name: 'ascii-export',
      async defineExports(ctx) {
        return {
          // demo: retorna un string simple; en tu real devolverías Blob/URL/etc.
          ascii: async () => {
            // acceso a ctx.export.url si te sirve (SVG data URL)
            const url = ctx?.export?.url
            expect(url).toMatch(/^data:image\/svg\+xml/)
            return 'ASCII_OK'
          }
        }
      }
    }

    // Registro local-first (sólo para esta captura)
    const result = await snapdom(el, { plugins: [asciiPlugin] })

    // El helper se crea dinámicamente: toAscii()
    expect(typeof result.toAscii).toBe('function')
    const asciiOut = await result.toAscii()
    expect(asciiOut).toBe('ASCII_OK')
  })
})
