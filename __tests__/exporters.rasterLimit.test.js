// The decode/canvas clamp used to be WebKit's 16384 for every engine, so a tall capture on a
// real page came back silently DOWNSCALED — a live 640x17298 element rendered 606x16384, while
// domlens and html2canvas returned it at full size. Chromium decodes an svg data URL at
// 640x32768 and backs a 640x17298 canvas (probed), and the clamp path is not free either: it
// decodes the whole payload, rewrites the header, re-encodes and resamples at a fractional
// scale — 5.2 ms/Mpx through it against 3.1 ms/Mpx just under it.
import { describe, test, expect, afterEach } from 'vitest'
import { server } from '@vitest/browser/context'
import { snapdom } from '../src/index'

const ENGINE = server?.browser || 'unknown'
let mounted = []
afterEach(() => { for (const el of mounted) el.remove(); mounted = [] })

describe(`raster size limit [${ENGINE}]`, () => {
  // WebKit really does cap at 16384, so the assertion is Chromium/Gecko's to make.
  test.skipIf(ENGINE === 'webkit')('a capture taller than 16384px is not downscaled', async () => {
    const el = document.createElement('div')
    el.style.cssText = 'width:80px;height:17300px;background:linear-gradient(#000,#fff)'
    document.body.appendChild(el)
    mounted.push(el)
    const canvas = await snapdom.toCanvas(el, { scale: 1, dpr: 1, burst: false })
    expect(canvas.height).toBe(17300)
    expect(canvas.width).toBe(80)
  }, 60_000)
})
