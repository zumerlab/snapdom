import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { embedCustomFonts } from '../src/modules/fonts.js'
import { createContext } from '../src/core/context.js'
import { compileIconFontMatchers } from '../src/modules/iconFonts.js'

/**
 * `iconFonts` used to live in a module-level array that every capture overwrote at its
 * start, which meant two concurrent captures with different lists read each other's
 * matchers through the await points. It is compiled once in createContext now and passed
 * explicitly, so this checks the wiring end to end: the option must still reach the embed
 * pass, and it must reach it as a VALUE that another capture cannot replace.
 *
 * Observable behaviour: a family recognized as an icon font is skipped by the embed pass,
 * so its @font-face never lands in the emitted CSS.
 */

const FAMILY = 'AcmeBrandFace'
let styleEl

beforeEach(() => {
  styleEl = document.createElement('style')
  // A data: src keeps the test offline; the point under test is the skip decision.
  styleEl.textContent = `@font-face{font-family:'${FAMILY}';src:url(data:font/woff2;base64,AAAA) format('woff2');font-weight:400;font-style:normal;}`
  document.head.appendChild(styleEl)
})

afterEach(() => {
  styleEl?.remove()
})

const required = new Set([`${FAMILY}__400__normal__100`])

describe('iconFonts reaches the embed pass per capture', () => {
  it('embeds the family when no iconFonts option names it', async () => {
    const css = await embedCustomFonts({ required, iconMatchers: [] })
    expect(css).toContain(FAMILY)
  })

  it('skips the family when this capture names it as an icon font', async () => {
    const css = await embedCustomFonts({
      required,
      iconMatchers: compileIconFontMatchers(FAMILY),
    })
    expect(css).not.toContain(FAMILY)
  })

  it('createContext compiles the option into the matchers the pipeline passes', async () => {
    const ctx = createContext({ iconFonts: FAMILY })
    expect(ctx.__iconMatchers).toHaveLength(1)
    const css = await embedCustomFonts({ required, iconMatchers: ctx.__iconMatchers })
    expect(css).not.toContain(FAMILY)
  })

  it('one capture naming it cannot make ANOTHER capture skip it', async () => {
    // This is the concurrency bug: with the old module-level list, building the second
    // context replaced the first one's matchers, so a capture that never passed the option
    // started skipping the family mid-flight.
    const withOption = createContext({ iconFonts: FAMILY })
    const withoutOption = createContext({})
    expect(withOption.__iconMatchers).toHaveLength(1)
    expect(withoutOption.__iconMatchers).toHaveLength(0)

    const [skipped, embedded] = await Promise.all([
      embedCustomFonts({ required, iconMatchers: withOption.__iconMatchers }),
      embedCustomFonts({ required, iconMatchers: withoutOption.__iconMatchers }),
    ])
    expect(skipped).not.toContain(FAMILY)
    expect(embedded).toContain(FAMILY)
  })
})
