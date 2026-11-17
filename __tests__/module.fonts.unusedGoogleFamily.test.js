// A Google Fonts <link> whose families the capture does not use is not fetched: the request
// names every family the sheet holds. snapdom.dev/showcase links Mansalva and its benchmark
// box draws Roboto; the fetch was about 100 of the 114 ms of the first capture there.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/modules/snapFetch.js', () => ({
  snapFetch: vi.fn(async (url, opts = {}) => {
    if (opts.as === 'text') return { ok: true, data: '', status: 200, url, fromCache: false }
    return { ok: true, data: 'data:font/woff2;base64,AA==', status: 200, url, fromCache: false, mime: 'font/woff2' }
  }),
}))

import { embedCustomFonts, FONT_KEY_SEP } from '../src/modules/fonts.js'
import { cache } from '../src/core/cache.js'
import { snapFetch } from '../src/modules/snapFetch.js'

const CSS2 = 'https://fonts.googleapis.com/css2?family=Mansalva&family=Roboto+Mono:wght@400;700&display=swap'
const LEGACY = 'https://fonts.googleapis.com/css?family=Mansalva|Roboto+Mono:400,700'
const required = (family) => new Set([[family, 400, 'normal', 100].join(FONT_KEY_SEP)])
const fetched = (href) => snapFetch.mock.calls.some(([url]) => url === href)

async function embed(href, family) {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
  await embedCustomFonts({ required: required(family), usedCodepoints: new Set([65]) })
  link.remove()
}

beforeEach(() => {
  cache.font?.clear?.()
  cache.resource?.clear?.()
  vi.clearAllMocks()
})

describe('a Google Fonts request for families the capture does not use', () => {
  it('is not fetched', async () => {
    await embed(CSS2, 'Roboto')
    expect(fetched(CSS2)).toBe(false)
    await embed(LEGACY, 'Roboto')
    expect(fetched(LEGACY)).toBe(false)
  })

  it('is fetched when the capture uses one of them, whatever its case', async () => {
    await embed(CSS2, 'roboto mono')
    expect(fetched(CSS2)).toBe(true)
    await embed(LEGACY, 'Mansalva')
    expect(fetched(LEGACY)).toBe(true)
  })
})
