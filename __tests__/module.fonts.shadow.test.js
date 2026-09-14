import { afterEach, expect, it } from 'vitest'
import { snapdom } from '../src/index.js'
import { collectFontUsage } from '../src/modules/fonts.js'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

function mountShadowText() {
  const host = document.createElement('div')
  host.style.cssText = 'width:360px;height:70px;background:white;color:black'
  document.body.appendChild(host)
  mounted.push(host)
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = '<span style="font:32px ShadowAuditMono,serif">Hamburgefontsiv 123</span>'
  return { host, shadow }
}

it('collects font families and glyphs from nested shadow roots and their pseudos', () => {
  const { host, shadow } = mountShadowText()
  const nested = document.createElement('div')
  shadow.appendChild(nested)
  nested.attachShadow({ mode: 'open' }).innerHTML =
    '<style>span::before{content:"Ω";font-family:ShadowPseudoFace}</style><span>Ж</span>'
  const usage = collectFontUsage(host)
  expect([...usage.required]).toContain('ShadowAuditMono__400__normal__100')
  expect([...usage.required]).toContain('ShadowPseudoFace__400__normal__100')
  expect(usage.usedCodepoints.has('Ж'.codePointAt(0))).toBe(true)
  expect(usage.usedCodepoints.has('Ω'.codePointAt(0))).toBe(true)
})

it('embeds a document font used only inside a shadow root', async () => {
  const style = document.createElement('style')
  style.textContent = '@font-face{font-family:ShadowAuditMono;src:url("/__tests__/fixtures/fonts/jbmono-400.woff2")}'
  document.head.appendChild(style)
  mounted.push(style)
  const { host } = mountShadowText()
  await document.fonts.load('32px ShadowAuditMono')
  const raw = await snapdom.toRaw(host, { embedFonts: 'auto', burst: false })
  const svg = decodeURIComponent(raw.slice(raw.indexOf(',') + 1))
  expect(svg).toContain('@font-face')
  expect(svg).toMatch(/data:(?:font|application)\//)
}, 15000)
