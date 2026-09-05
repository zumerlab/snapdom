import { it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'
import { embedCustomFonts } from '../src/modules/fonts.js'
import { cache } from '../src/core/cache.js'
import { invalidateStyleCaches } from '../src/modules/styles.js'

const mounted = []
const originalAdopted = document.adoptedStyleSheets
afterEach(() => {
  while (mounted.length) mounted.pop().remove()
  document.adoptedStyleSheets = originalAdopted
  cache.resource.clear()
  invalidateStyleCaches()
})
function style(css) {
  const node = document.createElement('style')
  node.textContent = css
  document.head.appendChild(node)
  mounted.push(node)
  return node
}
const required = (family) => ({ required: new Set([`${family}__400__normal__100`]), usedCodepoints: new Set([65]) })

it('reassembles font CSS after a same-task stylesheet edit without discarding resource bytes', async () => {
  const sheet = style('@font-face{font-family:"EnvironmentFace";src:local("Arial")}')
  cache.resource.set('untouched-font-url', 'cached bytes')
  expect(await embedCustomFonts(required('EnvironmentFace'))).toContain('Arial')
  sheet.textContent = '@font-face{font-family:"EnvironmentFace";src:local("Georgia")}'
  const css = await embedCustomFonts(required('EnvironmentFace'))
  expect(css).toContain('Georgia')
  expect(css).not.toContain('Arial')
  expect(cache.resource.get('untouched-font-url')).toBe('cached bytes')
})

it('includes localFonts stretchPct in the emitted CSS cache key', async () => {
  const face = { family: 'LocalStretchFace', src: 'data:font/woff2;base64,AAAA', stretchPct: 75 }
  const first = await embedCustomFonts({ ...required(face.family), localFonts: [face] })
  const second = await embedCustomFonts({ ...required(face.family), localFonts: [{ ...face, stretchPct: 125 }] })
  expect(first).toContain('font-stretch:75%')
  expect(second).toContain('font-stretch:125%')
})

it('reassembles face CSS after a CSSOM edit with explicit invalidation', async () => {
  const sheet = style('@font-face{font-family:"CssomFontFace";src:local("Arial")}')
  expect(await embedCustomFonts(required('CssomFontFace'))).toContain('Arial')
  // Gecko exposes a read-only CSSFontFaceRule declaration; replacing the rule is the
  // portable CSSOM edit, and keeping its rule count unchanged exercises explicit invalidation.
  sheet.sheet.deleteRule(0)
  sheet.sheet.insertRule('@font-face{font-family:"CssomFontFace";src:local("Georgia")}', 0)
  invalidateStyleCaches()
  const css = await embedCustomFonts(required('CssomFontFace'))
  expect(css).toContain('Georgia')
  expect(css).not.toContain('Arial')
})

it('excludes inactive media and supports faces while descending through layers', async () => {
  style('@media not all{@font-face{font-family:"ConditionalFace";src:local("Georgia")}}' +
    '@supports (display:unknown-audit-display){@font-face{font-family:"ConditionalFace";src:local("Times")}}' +
    '@layer font-audit{@font-face{font-family:"ConditionalFace";src:local("Arial")}}')
  const css = await embedCustomFonts(required('ConditionalFace'))
  expect(css).toContain('Arial')
  expect(css).not.toContain('Georgia')
  expect(css).not.toContain('Times')
})

it.each(['nested groups', 'adopted'])('captures %s font faces with the same glyphs as a top-level face', async (kind) => {
  const family = kind === 'adopted' ? 'AdoptedAuditMono' : 'GroupedAuditMono'
  const face = `@font-face{font-family:"${family}";src:url("/__tests__/fixtures/fonts/jbmono-400.woff2")}`
  let sheet
  if (kind === 'adopted') {
    const adopted = new CSSStyleSheet()
    adopted.replaceSync(face)
    document.adoptedStyleSheets = [...originalAdopted, adopted]
  } else {
    sheet = style(`@media all{@supports (display:block){${face}}}`)
  }
  const root = document.createElement('div')
  root.style.cssText = `width:380px;height:70px;background:white;color:black;font:32px "${family}",serif;white-space:nowrap`
  root.textContent = 'Hamburgefontsiv 123'
  document.body.appendChild(root)
  mounted.push(root)
  await document.fonts.load(`32px "${family}"`, root.textContent)
  await document.fonts.ready
  const opts = { embedFonts: true, burst: false, scale: 1, dpr: 1 }
  const actual = await snapdom.toCanvas(root, opts)
  if (sheet) sheet.textContent = face
  else {
    document.adoptedStyleSheets = originalAdopted
    style(face)
  }
  await document.fonts.load(`32px "${family}"`, root.textContent)
  invalidateStyleCaches()
  const reference = await snapdom.toCanvas(root, opts)
  expect([actual.width, actual.height]).toEqual([reference.width, reference.height])
  const pixels = (canvas) => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  const a = pixels(actual), b = pixels(reference)
  let different = 0
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 4) different++
  expect(different / a.length).toBeLessThan(0.001)
}, 15000)
