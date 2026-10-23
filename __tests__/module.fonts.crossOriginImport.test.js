import { describe, it, expect, afterEach, vi } from 'vitest'
import { commands } from 'vitest/browser'
import { embedCustomFonts, FONT_KEY_SEP } from '../src/modules/fonts.js'

// Required-font keys written the readable way; FONT_KEY_SEP is the real separator (#542).
const key = (k) => k.replaceAll('__', FONT_KEY_SEP)

// A cross-origin font stylesheet cannot be read through CSSOM, so its text is fetched and
// every @import inside it is flattened by hand. The faces behind an @import must arrive,
// and an @import that loops back to a sheet already visited must not recurse forever.

const FACE = "@font-face{font-family:'ImportFam';src:url(data:font/woff2;base64,AAAA);font-weight:400;font-style:normal}"

describe('cross-origin font stylesheets with @import', () => {
  afterEach(() => { document.head.querySelectorAll('link[data-test-import]').forEach(l => l.remove()) })

  it('embeds the faces behind a nested @import and survives an import loop', async () => {
    const leaf = await commands.serveCrossOriginCss(FACE, { cors: true })
    // middle imports the leaf; the leaf is also imported again from the top: the second
    // visit is the loop the visited set has to stop.
    const middle = await commands.serveCrossOriginCss(`@import url("${leaf}");`, { cors: true })
    const top = await commands.serveCrossOriginCss(`@import url("${middle}");\n@import url("${leaf}");`, { cors: true })

    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = top
    link.setAttribute('data-test-import', '')
    await new Promise((resolve) => { link.onload = link.onerror = resolve; document.head.appendChild(link) })

    const css = await embedCustomFonts({
      required: new Set([key('ImportFam__400__normal__100')]),
      usedCodepoints: new Set([65]),
      // host includes the port, which is how the allow-list compares it
      fontStylesheetDomains: [new URL(top).host],
    })
    expect(css).toContain('ImportFam')
    expect(css.match(/font-family:\s*'?ImportFam/g)?.length).toBe(1)
  })

  it('stops at a sheet that imports itself back, and says so under debug', async () => {
    // The server names files by a running index, so the next two URLs are known in advance:
    // a imports b, b imports a.
    const probe = await commands.serveCrossOriginCss('')
    const n = Number(probe.match(/\/(\d+)\.css$/)[1])
    const at = (i) => probe.replace(/\d+\.css$/, `${i}.css`)
    const a = await commands.serveCrossOriginCss(`@import url("${at(n + 2)}");`, { cors: true })
    await commands.serveCrossOriginCss(`@import url("${a}");${FACE}`, { cors: true })

    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = a
    link.setAttribute('data-test-import', '')
    await new Promise((resolve) => { link.onload = link.onerror = resolve; document.head.appendChild(link) })

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const css = await embedCustomFonts({
        required: new Set([key('ImportFam__400__normal__100')]),
        usedCodepoints: new Set([65]),
        fontStylesheetDomains: [new URL(a).host],
        debug: true,
      })
      expect(css).toContain('ImportFam')
      expect(warn.mock.calls.some((args) => args.join(' ').includes('loops back'))).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })
})
