// EXPERIMENTAL engine (engine:'canvas'): in browsers without drawElement/drawElementImage
// (all current CI engines), the option must be perfectly transparent — the normal svg
// pipeline serves the capture. Engine-active behavior is verified separately with a
// flag-enabled Chromium (see NEXT_NOTES.md).
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { detectDrawApi, tryCanvasEngine } from '../src/engines/htmlInCanvas.js'
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

  it('returns null without the draw API', async () => {
    if (detectDrawApi()) return // flag-enabled environment: covered by the harness instead
    const el = makeCard()
    const state = { element: el, clone: el.cloneNode(true) }
    expect(await tryCanvasEngine(state, createContext({}))).toBeNull()
  })

  it('bails on the geometry options whose math lives in the svg engine', async () => {
    const el = makeCard()
    // These are the ONLY bails left. plugins / exclude / reconcile used to be here too,
    // because the engine copied the live element and skipped the passes that implement
    // them; consuming the finished clone means they already happened.
    for (const opts of [{ clip: 'viewport' }, { outerShadows: true }, { width: 50 }]) {
      const state = { element: el, clone: el.cloneNode(true) }
      expect(await tryCanvasEngine(state, createContext(opts))).toBeNull()
    }
  })

  it('bails without a clone rather than reaching for the live element', async () => {
    // The whole point of the rewire: no clone, no capture. It must never fall back to
    // copying the live DOM, which is what made the engine pointless before.
    const el = makeCard()
    expect(await tryCanvasEngine({ element: el, clone: null }, createContext({}))).toBeNull()
  })

  it('a plugin capture through engine:\'canvas\' still runs every plugin hook', async () => {
    // Previously the engine ran BEFORE the pipeline, so it had to refuse any capture with
    // plugins. Now the plugin work is already baked into the clone it receives.
    const seen = []
    const el = makeCard()
    const res = await snapdom(el, {
      engine: 'canvas',
      plugins: [{ name: 'probe', pure: true, afterClone() { seen.push('afterClone') } }],
    })
    expect(seen).toEqual(['afterClone'])
    expect(typeof res.url).toBe('string')
  })
})
