// EXPERIMENTAL engine (engine:'html-in-canvas'): in browsers without drawElement/drawElementImage
// (all current CI engines), the option must be perfectly transparent — the normal svg
// pipeline serves the capture. Engine-active behavior is verified separately with a
// flag-enabled Chromium (see NEXT_NOTES.md).
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { detectDrawApi, tryCanvasEngine } from '../src/engines/htmlInCanvas.js'
import { createContext } from '../src/core/context.js'

let restoreDrawApi = null

afterEach(() => {
  restoreDrawApi?.()
  restoreDrawApi = null
  document.body.innerHTML = ''
})

/** Simulate the origin-trial API at the same CanvasRenderingContext2D seam the engine uses.
 *  The callback paints through the real 2D context, so probes, copies and exports remain
 *  browser behavior rather than mocked return values. */
function stubDrawApi(draw) {
  const proto = Object.getPrototypeOf(document.createElement('canvas').getContext('2d'))
  const previous = Object.getOwnPropertyDescriptor(proto, 'drawElementImage')
  Object.defineProperty(proto, 'drawElementImage', {
    configurable: true,
    writable: true,
    value(...args) { return draw.apply(this, args) },
  })
  restoreDrawApi = () => {
    if (previous) Object.defineProperty(proto, 'drawElementImage', previous)
    else delete proto.drawElementImage
  }
}

function makeCard() {
  const el = document.createElement('div')
  el.style.cssText = 'box-sizing:border-box;width:120px;height:60px;background:#e33;color:#fff;padding:8px'
  el.textContent = 'engine test'
  document.body.appendChild(el)
  return el
}

describe("engine:'html-in-canvas' — unsupported-browser transparency", () => {
  it('falls back to the svg pipeline and produces a normal result', async () => {
    const el = makeCard()
    const res = await snapdom(el, { engine: 'html-in-canvas' })
    expect(typeof res.url).toBe('string')
    expect(res.url.startsWith('data:image/svg+xml')).toBe(true)
    const canvas = await res.toCanvas()
    const px = canvas.getContext('2d', { willReadFrequently: true })
      .getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data
    expect(px[0]).toBeGreaterThan(150) // the red card, not a blank
  })

  it('returns null without the draw API', async () => {
    if (detectDrawApi()) return // flag-enabled environment: covered by the harness instead
    const el = makeCard()
    const state = { element: el, clone: el.cloneNode(true) }
    expect(await tryCanvasEngine(state, createContext({}))).toBeNull()
  })

  it('bails on the geometry options whose math lives in the svg engine', async () => {
    let draws = 0
    stubDrawApi(function (_wrapper, _x, _y, width, height) {
      draws++
      this.fillRect(0, 0, width, height)
    })
    const el = makeCard()
    for (const opts of [
      { clip: 'viewport' },
      { outerShadows: true },
      { width: 50 },
      { excludeMode: 'remove' },
    ]) {
      const state = { element: el, clone: el.cloneNode(true) }
      expect(await tryCanvasEngine(state, createContext(opts))).toBeNull()
    }

    el.style.transform = 'rotate(5deg)'
    expect(await tryCanvasEngine({ element: el, clone: el.cloneNode(true) }, createContext({}))).toBeNull()
    el.style.transform = ''
    el.style.filter = 'blur(4px)'
    expect(await tryCanvasEngine({ element: el, clone: el.cloneNode(true) }, createContext({}))).toBeNull()

    const scroller = document.createElement('div')
    scroller.style.cssText = 'width:80px;height:30px;overflow:auto'
    scroller.innerHTML = '<div style="height:120px"></div>'
    document.body.appendChild(scroller)
    scroller.scrollTop = 20
    expect(await tryCanvasEngine({ element: scroller, clone: scroller.cloneNode(true) }, createContext({}))).toBeNull()

    expect(await tryCanvasEngine({ element: document.body, clone: document.body.cloneNode(true) }, createContext({}))).toBeNull()
    expect(await tryCanvasEngine({ element: document.documentElement, clone: document.documentElement.cloneNode(true) }, createContext({}))).toBeNull()
    expect(draws).toBe(0)
  })

  it('bails without a clone rather than reaching for the live element', async () => {
    // The whole point of the rewire: no clone, no capture. It must never fall back to
    // copying the live DOM, which is what made the engine pointless before.
    const el = makeCard()
    expect(await tryCanvasEngine({ element: el, clone: null }, createContext({}))).toBeNull()
  })

  it('uses SVG for transformed or zoomed ancestors instead of clipping the local clone box', async () => {
    let draws = 0
    stubDrawApi(function (_wrapper, _x, _y, width, height) {
      draws++
      this.fillRect(0, 0, width, height)
    })
    const ancestor = document.createElement('div')
    document.body.appendChild(ancestor)
    const el = makeCard()
    ancestor.appendChild(el)

    for (const css of ['transform:scale(.5)', 'zoom:.5']) {
      ancestor.style.cssText = css
      const result = await snapdom(el, {
        engine: 'html-in-canvas', burst: false, embedFonts: false, dpr: 1,
      })
      expect(result.url).toMatch(/^data:image\/svg\+xml/)
      expect(result.meta.w0).toBe(120)
      expect(result.meta.h0).toBe(60)
    }
    expect(draws).toBe(0)
  })

  it('a clone-stage plugin still runs before the engine decision', async () => {
    // Previously the engine ran BEFORE the pipeline, so it had to refuse any capture with
    // plugins. Now the plugin work is already baked into the clone it receives.
    stubDrawApi(function (_wrapper, _x, _y, width, height) {
      this.fillRect(0, 0, width, height)
    })
    const seen = []
    const el = makeCard()
    const res = await snapdom(el, {
      engine: 'html-in-canvas',
      plugins: [{ name: 'probe', pure: true, afterClone() { seen.push('afterClone') } }],
    })
    expect(seen).toEqual(['afterClone'])
    expect(res.url).toMatch(/^data:image\/png/)
  })
})

describe("engine:'html-in-canvas' — simulated native happy path", () => {
  it('publishes canonical meta/artifacts, releases capture state and applies scale*dpr once', async () => {
    stubDrawApi(function (_wrapper, _x, _y, width, height) {
      this.fillStyle = 'rgb(220,30,20)'
      this.fillRect(0, 0, width, height)
    })

    let seen = null
    const el = makeCard()
    const result = await snapdom(el, {
      engine: 'html-in-canvas',
      burst: false,
      cache: 'disabled',
      scale: 2,
      dpr: 2,
      plugins: [{
        name: 'canvas-contract',
        defineExports(ctx) {
          seen = {
            meta: ctx.meta,
            artifacts: ctx.artifacts,
            clone: ctx.clone,
            nodeMap: ctx.nodeMap,
            styleCache: ctx.styleCache,
            svgString: ctx.svgString,
          }
          return {}
        },
      }],
    })

    expect(result.url).toMatch(/^data:image\/png/)
    const rawImage = new Image()
    rawImage.src = result.url
    await rawImage.decode()
    expect([rawImage.naturalWidth, rawImage.naturalHeight]).toEqual([480, 240])
    expect(Object.isFrozen(result.meta)).toBe(true)
    expect(result.meta).toEqual({
      w0: 120, h0: 60, vbW: 120, vbH: 60,
      targetW: 120, targetH: 60, contentX: 0, contentY: 0, clip: null,
    })
    expect(seen.meta).toBe(result.meta)
    expect(() => { result.meta = null }).toThrow(TypeError)
    expect(seen.artifacts).toMatchObject({
      classCSS: expect.any(String),
      fontsCSS: expect.any(String),
      baseCSS: expect.any(String),
      scrollbarCSS: expect.any(String),
    })
    expect([seen.clone, seen.nodeMap, seen.styleCache, seen.svgString]).toEqual([null, null, null, null])
    expect(document.querySelector('canvas[layoutsubtree]')).toBeNull()
    expect(document.querySelector('#snapdom-sandbox[data-snapdom-sandbox="true"]')).toBeNull()

    const canvas = await result.toCanvas()
    expect([canvas.width, canvas.height]).toEqual([480, 240])
    expect([canvas.style.width, canvas.style.height]).toEqual(['240px', '120px'])
    const pixel = canvas.getContext('2d', { willReadFrequently: true }).getImageData(240, 120, 1, 1).data
    expect(pixel[0]).toBeGreaterThan(180)
    expect(pixel[1]).toBeLessThan(60)

    for (const image of [await result.toImg(), await result.toSvg()]) {
      expect([image.naturalWidth, image.naturalHeight]).toEqual([480, 240])
      expect([image.style.width, image.style.height]).toEqual(['240px', '120px'])
      expect(image.src).toMatch(/^data:image\/png/)
    }

    const blob = await result.toBlob()
    expect(blob.type).toBe('image/png')
    expect(blob.size).toBeGreaterThan(0)
    await expect(result.toBlob({ format: 'svg' })).rejects.toThrow(/raster capture/)
  })

  it('preserves fractional root geometry before applying scale and dpr', async () => {
    stubDrawApi(function (_wrapper, _x, _y, width, height) {
      this.fillStyle = '#09f'
      this.fillRect(0, 0, width, height)
    })
    const el = makeCard()
    el.style.width = '120.5px'
    el.style.height = '60.25px'
    const rect = el.getBoundingClientRect()

    const result = await snapdom(el, {
      engine: 'html-in-canvas', burst: false, embedFonts: false, compress: false,
      scale: 2, dpr: 2,
    })
    expect(result.meta.w0).toBeCloseTo(rect.width, 4)
    expect(result.meta.h0).toBeCloseTo(rect.height, 4)

    const raw = new Image()
    raw.src = result.url
    await raw.decode()
    expect([raw.naturalWidth, raw.naturalHeight]).toEqual([
      Math.round(rect.width * 4),
      Math.round(rect.height * 4),
    ])
  })

  it('uses SVG when render-boundary hooks exist, so each hook runs exactly once', async () => {
    let draws = 0
    stubDrawApi(function () { draws++ })
    const seen = []
    const result = await snapdom(makeCard(), {
      engine: 'html-in-canvas',
      burst: false,
      plugins: [{
        name: 'render-boundary',
        pure: true,
        beforeRender() { seen.push('beforeRender') },
        afterRender() { seen.push('afterRender') },
      }],
    })

    expect(draws).toBe(0)
    expect(seen).toEqual(['beforeRender', 'afterRender'])
    expect(result.url).toMatch(/^data:image\/svg\+xml/)
  })

  it('falls back when native draw returns a fully blank background-only frame', async () => {
    let draws = 0
    stubDrawApi(function () { draws++ })
    const el = makeCard()
    el.textContent = ''

    const result = await snapdom(el, { engine: 'html-in-canvas', burst: false, dpr: 1, scale: 1 })
    expect(draws).toBe(1)
    expect(result.url).toMatch(/^data:image\/svg\+xml/)
    const canvas = await result.toCanvas({ dpr: 1, scale: 1 })
    const pixel = canvas.getContext('2d', { willReadFrequently: true }).getImageData(60, 30, 1, 1).data
    expect(pixel[0]).toBeGreaterThan(150)
  })

  it('turns an exception from the experimental API into an SVG fallback', async () => {
    stubDrawApi(function () { throw new Error('experimental API rejected drawable') })
    const result = await snapdom(makeCard(), { engine: 'html-in-canvas', burst: false })
    expect(result.url).toMatch(/^data:image\/svg\+xml/)
  })
})
