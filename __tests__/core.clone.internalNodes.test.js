// snapdom's own scaffolding must not be captured.
//
// toCanvas keeps a hidden decode <iframe data-snapdom-internal> in document.body for the
// lifetime of the page (see exporter.toCanvas.decodeFrame.test.js). deepClone only knew the
// sandbox marker, so a later capture of <body> or any ancestor reached that iframe through
// cloneIframe and rasterized it with a NESTED snapdom.toPng of snapdom's own empty document.
// On liquidGL's home (2026-09-03) that was every hook firing twice per capture, 27.5k of the
// 30.8k getPropertyValue calls, +10 ms on every warm capture and +140 ms on the second one.
import { describe, it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/index.js'

afterEach(() => { document.body.innerHTML = '' })

describe('deepClone — data-snapdom-internal', () => {
  it('a capture after a toCanvas neither clones the decode frame nor runs a nested pipeline', async () => {
    const box = document.createElement('div')
    box.style.cssText = 'width:20px;height:20px;background:red'
    document.body.appendChild(box)
    await (await snapdom(box, { embedFonts: false })).toCanvas()

    // The setup is real: the frame is still in the body when the next capture starts.
    const frame = document.querySelector('iframe[data-snapdom-internal]')
    expect(frame).not.toBeNull()

    let snaps = 0
    let mapped = null
    await snapdom(document.body, {
      embedFonts: false,
      plugins: [{
        name: 'spy',
        beforeSnap() { snaps++ },
        afterClone(ctx) { mapped = [...ctx.nodeMap.values()].includes(frame) },
      }],
    })
    // A nested capture inherits the plugins, so a second beforeSnap is the nested pipeline.
    expect(snaps).toBe(1)
    expect(mapped).toBe(false)
  })
})
