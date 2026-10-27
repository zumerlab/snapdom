import { it, expect, vi, afterEach } from 'vitest'

// { spy: true } so the capture below can take the Safari path on every engine.
vi.mock('../src/utils/browser', { spy: true })
import * as browser from '../src/utils/browser'
import { fontsSettled } from '../src/utils/browser'
import { snapdom } from '../src/api/snapdom.js'

const never = new Promise(() => {})
/** The set Safari 27.0.1 left behind in the jant#174 scene: "loading", `ready` pending forever. */
const stuckSet = (faces) => ({ status: 'loading', ready: never, [Symbol.iterator]: () => faces[Symbol.iterator]() })
const within = (p, ms) => Promise.race([p.then(() => 'settled'), new Promise((r) => setTimeout(() => r('pending'), ms))])

afterEach(() => { vi.restoreAllMocks(); delete document.fonts })

it('returns on a stuck set with no face loading', async () => {
  expect(await within(fontsSettled({ fonts: stuckSet([{ status: 'loaded' }]) }), 200)).toBe('settled')
})

it('waits for a face that is really loading', async () => {
  let finish
  const face = { status: 'loading', loaded: new Promise((r) => { finish = r }) }
  const wait = fontsSettled({ fonts: stuckSet([face]) })
  expect(await within(wait, 100)).toBe('pending')
  face.status = 'loaded'
  finish(face)
  expect(await within(wait, 200)).toBe('settled')
})

it('finishes a Safari capture whose font set is stuck', async () => {
  vi.mocked(browser.isSafari).mockReturnValue(true)
  const face = new FontFace('SnapdomStuckSet', 'url(/__tests__/fixtures/fonts/inter-400.woff2)')
  Object.defineProperty(document, 'fonts', { configurable: true, get: () => stuckSet([face]) })
  const root = document.createElement('div')
  root.style.cssText = 'width:200px;height:40px;font:20px SnapdomStuckSet, sans-serif;background:white'
  root.textContent = 'Stuck set'
  document.body.append(root)
  try {
    expect(await within(snapdom(root, { embedFonts: 'auto', cache: 'disabled' }), 5000)).toBe('settled')
  } finally {
    root.remove()
  }
})
