// EXPERIMENTAL engine (engine:'canvas'): in browsers without drawElement/drawElementImage
// (all current CI engines), the option must be perfectly transparent — the normal svg
// pipeline serves the capture. Engine-active behavior is verified separately with a
// flag-enabled Chromium (see NEXT_NOTES.md).
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { detectDrawApi, tryEngineResult } from '../src/engines/htmlInCanvas.js'
import { createContext } from '../src/core/context.js'

afterEach(() => { document.body.innerHTML = '' })

function makeCard() {
  const el = document.createElement('div')
  el.style.cssText = 'width:120px;height:60px;background:#e33;color:#fff;padding:8px'
  el.textContent = 'engine test'
  document.body.appendChild(el)
  return el
}

describe("engine:'canvas' — unsupported-browser transparency", () => {
  it('falls back to the svg pipeline and produces a normal result', async () => {
    const el = makeCard()
    const res = await snapdom(el, { engine: 'canvas' })
    expect(typeof res.url).toBe('string')
    expect(res.url.startsWith('data:image/svg+xml')).toBe(true)
    const canvas = await res.toCanvas()
    const px = canvas.getContext('2d', { willReadFrequently: true })
      .getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data
    expect(px[0]).toBeGreaterThan(150) // the red card, not a blank
  })

  it('tryEngineResult returns null without the draw API', async () => {
    if (detectDrawApi()) return // flag-enabled environment: covered by the harness instead
    const el = makeCard()
    const out = await tryEngineResult(el, createContext({}), () => { throw new Error('must not run') })
    expect(out).toBeNull()
  })

  it('unsupported options return null even where the API exists', async () => {
    const el = makeCard()
    for (const opts of [{ clip: 'viewport' }, { outerShadows: true }, { width: 50 }, { plugins: [{ name: 'x' }] }]) {
      const out = await tryEngineResult(el, createContext(opts), () => { throw new Error('must not run') })
      expect(out).toBeNull()
    }
  })
})
