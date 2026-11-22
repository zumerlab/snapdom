import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { clearPlugins } from '../src/core/plugins.js'

/**
 * `editSvg` on the plugin export facade (PLUGIN_SPEC.md): a plugin export may rasterize a
 * revised copy of the capture's SVG. The pdf plugin uses it to take out of the page image
 * the text it paints as glyphs. Pinned here: the revision reaches the pixels, the capture is
 * left as captured, and the public to*() exports never take the function.
 */

const RED = 'rgb(255, 0, 0)'
const BLUE = 'rgb(0, 0, 255)'

function makeEl() {
  const el = document.createElement('div')
  el.style.cssText = `width:40px;height:40px;background:${RED}`
  document.body.appendChild(el)
  return el
}

/** The colour of the canvas' centre pixel, as `r,g,b`. */
function centre(canvas) {
  const d = canvas.getContext('2d').getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data
  return `${d[0]},${d[1]},${d[2]}`
}

/** A plugin that exposes the facade's canvas export as `toProbe(opts)`. */
const probe = () => ({
  name: 'edit-svg-probe',
  defineExports: (ctx) => ({ probe: (_, opts) => ctx.exports.canvas({ scale: 1, dpr: 1, ...opts }) }),
})

const toBlue = (svg) => svg.split(RED).join(BLUE)

describe('ctx.exports editSvg', () => {
  afterEach(() => {
    clearPlugins()
    document.body.innerHTML = ''
  })

  it('draws the revised svg', async () => {
    const result = await snapdom(makeEl(), { plugins: [probe()] })
    expect(centre(await result.toProbe())).toBe('255,0,0')
    let seen = ''
    const canvas = await result.toProbe({ editSvg: (svg) => { seen = svg; return toBlue(svg) } })
    expect(seen.startsWith('<svg')).toBe(true)
    expect(seen).toContain(RED)
    expect(centre(canvas)).toBe('0,0,255')
  })

  it('awaits an async revision', async () => {
    const result = await snapdom(makeEl(), { plugins: [probe()] })
    const canvas = await result.toProbe({ editSvg: async (svg) => { await Promise.resolve(); return toBlue(svg) } })
    expect(centre(canvas)).toBe('0,0,255')
  })

  it('leaves the capture as captured for every later export', async () => {
    const result = await snapdom(makeEl(), { plugins: [probe()] })
    const url = result.url
    await result.toProbe({ editSvg: toBlue })
    expect(result.url).toBe(url)
    expect(centre(await result.toProbe())).toBe('255,0,0')
    expect(centre(await result.toCanvas({ scale: 1, dpr: 1 }))).toBe('255,0,0')
  })

  it('draws the capture untouched when the revision returns nothing usable', async () => {
    const result = await snapdom(makeEl(), { plugins: [probe()] })
    for (const out of [null, undefined, '', 0, {}]) {
      expect(centre(await result.toProbe({ editSvg: () => out }))).toBe('255,0,0')
    }
  })

  it('applies the crop to the revised svg', async () => {
    const el = makeEl()
    el.style.width = '80px'
    const result = await snapdom(el, { plugins: [probe()] })
    const crop = { x: 40, y: 0, width: 40, height: 40 }
    const plain = await result.toProbe({ crop })
    const canvas = await result.toProbe({ editSvg: toBlue, crop })
    // Whatever size a crop comes out at, the revision does not change it.
    expect([canvas.width, canvas.height]).toEqual([plain.width, plain.height])
    expect(plain.width).toBeLessThan((await result.toProbe()).width)
    expect(centre(plain)).toBe('255,0,0')
    expect(centre(canvas)).toBe('0,0,255')
  })

  it('says on the facade that it is honoured, without becoming an export', async () => {
    let facade = null
    const result = await snapdom(makeEl(), { plugins: [{ name: 'peek', defineExports: (ctx) => { facade = ctx.exports; return {} } }] })
    expect(facade.editSvg).toBe(true)
    expect(Object.keys(facade)).not.toContain('editSvg')
    expect(result.toEditSvg).toBeUndefined()
  })

  it('is not an option of the public exports', async () => {
    const result = await snapdom(makeEl(), { plugins: [probe()] })
    let called = false
    const edit = (svg) => { called = true; return toBlue(svg) }
    expect(centre(await result.toCanvas({ scale: 1, dpr: 1, editSvg: edit }))).toBe('255,0,0')
    await result.toPng({ editSvg: edit })
    await result.toBlob({ editSvg: edit })
    expect(called).toBe(false)
  })
})
