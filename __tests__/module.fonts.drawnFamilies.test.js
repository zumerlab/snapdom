/**
 * Under embedFonts 'auto' a webfont family the document declares but never drew is left out
 * of the capture. A later family in a stack whose earlier one covers the text is never
 * fetched by the browser, and its faces stay "unloaded"; snapdom embedded them anyway (35 KB
 * of Noto Serif SC under Songti SC in the jant#174 scene, 2 MB on Jant's own card).
 */
import { it, expect, vi, afterEach } from 'vitest'

// { spy: true } so one test can take the Safari path on every engine.
vi.mock('../src/utils/browser', { spy: true })
import * as browser from '../src/utils/browser'
import { snapdom } from '../src/api/snapdom.js'
import { documentFontFamilies } from '../src/modules/fonts.js'

const FX = '/__tests__/fixtures/fonts/'
const nodes = []
afterEach(() => { vi.restoreAllMocks(); for (const n of nodes.splice(0)) n.remove() })

function scene({ drawn = 'inter-400.woff2', idle = 'jbmono-400.woff2', css = '' } = {}) {
  const id = Math.random().toString(36).slice(2, 8)
  const fam = { drawn: `Drawn${id}`, idle: `Idle${id}` }
  const style = document.createElement('style')
  style.textContent = `@font-face { font-family: ${fam.drawn}; src: url(${FX}${drawn}); }
    @font-face { font-family: ${fam.idle}; src: url(${FX}${idle}); }`
  document.head.append(style)
  const root = document.createElement('div')
  root.style.cssText = `width:240px;background:#fff;color:#000;font:20px ${fam.drawn}, ${fam.idle}, sans-serif;${css}`
  root.textContent = 'Drawn text'
  document.body.append(root)
  nodes.push(style, root)
  return { root, fam }
}

const status = (family) => [...document.fonts].find((f) => f.family.replace(/["']/g, '') === family)?.status
const embeds = (url, family) => new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*["']?${family}`).test(decodeURIComponent(url))

it('counts a face in error as never drawn, as Safari leaves a failed local() source', () => {
  const fonts = [
    { family: 'Broken', status: 'error' },
    { family: '"Split"', status: 'error' },
    { family: 'Split', status: 'loaded' },
    { family: 'Pending', status: 'loading' },
    { family: 'Idle', status: 'unloaded' },
  ]
  const { declared, drawn } = documentFontFamilies({ fonts })
  expect([...declared].sort()).toEqual(['broken', 'idle', 'pending', 'split'])
  expect([...drawn].sort()).toEqual(['pending', 'split'])
})

it('leaves out a declared family the document never drew', async () => {
  const { root, fam } = scene()
  await document.fonts.load(`20px ${fam.drawn}`, 'Drawn text')
  expect(status(fam.idle)).toBe('unloaded')
  const { url } = await snapdom(root, { cache: 'disabled' })
  expect(embeds(url, fam.drawn)).toBe(true)
  expect(embeds(url, fam.idle)).toBe(false)
})

it('embeds the webfont of text captured the moment it was inserted', async () => {
  const { root, fam } = scene({ drawn: 'inter-700.woff2' })
  const { url } = await snapdom(root, { cache: 'disabled' })
  expect(embeds(url, fam.drawn)).toBe(true)
})

it('embeds a family drawn only inside a content-visibility subtree off screen', async () => {
  const { root, fam } = scene({ css: 'font:20px sans-serif' })
  root.textContent = ''
  const spacer = document.createElement('div')
  spacer.style.height = '4000px'
  const lazy = document.createElement('div')
  lazy.style.cssText = `content-visibility:auto;contain-intrinsic-size:auto 40px;font:20px ${fam.drawn}, ${fam.idle}`
  lazy.textContent = 'Far below'
  root.append(spacer, lazy)
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  // Chromium leaves the face unloaded until the skipped subtree is laid out, which
  // prepareClone does before the fonts phase reads it. Firefox and WebKit load it from style
  // alone, so there the case does not arise.
  if (/Chrome\//.test(navigator.userAgent)) expect(status(fam.drawn)).toBe('unloaded')
  const { url } = await snapdom(root, { cache: 'disabled' })
  expect(embeds(url, fam.drawn)).toBe(true)
  expect(embeds(url, fam.idle)).toBe(false)
})

it('does not let the Safari warm-up load a family the document never drew', async () => {
  vi.mocked(browser.isSafari).mockReturnValue(true)
  const { root, fam } = scene()
  await document.fonts.load(`20px ${fam.drawn}`, 'Drawn text')
  const { url } = await snapdom(root, { cache: 'disabled' })
  expect(status(fam.idle)).toBe('unloaded')
  expect(embeds(url, fam.idle)).toBe(false)
})
