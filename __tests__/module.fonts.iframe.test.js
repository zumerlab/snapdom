import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { embedCustomFonts } from '../src/modules/fonts.js'
import { snapdom } from '../src/api/snapdom.js'
import { cache } from '../src/core/cache.js'

// #441: when the capture root lives inside a same-origin iframe, embedFonts must
// scan the iframe's document for @font-face sources — not the parent document.

const FAMILY = 'IframeProbeFont'
// A data: src passes through embedCustomFonts untouched (no network fetch), so it
// is a stable marker that the @font-face was actually found and inlined.
const FONT_DATA_URL = 'data:font/woff2;base64,AAAA'

function makeRequired(family, weight = '400', style = 'normal', stretchPct = 100) {
  return new Set([`${family}__${weight}__${style}__${stretchPct}`])
}

function makeUsedCodepoints(text = 'A') {
  const s = new Set()
  for (const ch of text) s.add(ch.codePointAt(0))
  return s
}

function makeIframeWithFont() {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'width:240px;height:120px;border:0'
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument
  doc.open()
  doc.write(
    '<!doctype html><html><head><style>' +
    `@font-face{font-family:'${FAMILY}';font-style:normal;font-weight:400;` +
    `src:url(${FONT_DATA_URL}) format('woff2');}` +
    '</style></head><body style="margin:0">' +
    `<div id="root" style="font-family:'${FAMILY}',sans-serif;font-size:20px">Hello iframe fonts</div>` +
    '</body></html>'
  )
  doc.close()
  return { iframe, doc }
}

describe('embedCustomFonts — same-origin iframe document (#441)', () => {
  let iframe

  beforeEach(() => {
    // The fonts result cache is keyed by required/exclude/etc. (not by document),
    // so clear it between cases to keep the parent/iframe runs independent.
    cache.font?.clear?.()
    cache.resource?.clear?.()
  })

  afterEach(() => {
    if (iframe?.parentNode) iframe.parentNode.removeChild(iframe)
    iframe = null
  })

  it('embeds the iframe @font-face when doc is the iframe document', async () => {
    const made = makeIframeWithFont()
    iframe = made.iframe

    const css = await embedCustomFonts({
      required: makeRequired(FAMILY),
      usedCodepoints: makeUsedCodepoints('Hello'),
      doc: made.doc,
    })

    expect(css).toContain(FAMILY)
    expect(css).toMatch(/data:font\/woff2/)
  })

  it('finds nothing when scanning the parent document (the pre-#441 behavior)', async () => {
    const made = makeIframeWithFont()
    iframe = made.iframe

    const css = await embedCustomFonts({
      required: makeRequired(FAMILY),
      usedCodepoints: makeUsedCodepoints('Hello'),
      // no `doc` → defaults to the parent `document`, which has no such @font-face
    })

    expect(css).not.toContain(FAMILY)
  })

  it('snapdom(root, { embedFonts: true }) inlines the iframe font into the SVG', async () => {
    const made = makeIframeWithFont()
    iframe = made.iframe
    const root = made.doc.getElementById('root')

    const url = await snapdom.toRaw(root, { embedFonts: true })
    const svg = decodeURIComponent(url.slice(url.indexOf(',') + 1))

    expect(svg).toContain('@font-face')
    expect(svg).toContain(FAMILY)
  })
})
