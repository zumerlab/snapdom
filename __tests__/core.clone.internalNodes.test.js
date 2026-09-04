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

  it('keeps author content that happens to use the public data attribute', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'width:40px;height:40px;background:white'
    const authored = document.createElement('div')
    authored.setAttribute('data-snapdom-internal', '')
    authored.style.cssText = 'width:40px;height:40px;background:rgb(255,0,0)'
    host.appendChild(authored)
    document.body.appendChild(host)

    let mapped = null
    const result = await snapdom(host, {
      burst: false,
      embedFonts: false,
      plugins: [{
        name: 'spy',
        afterClone(ctx) { mapped = [...ctx.nodeMap.values()].includes(authored) },
      }],
    })
    expect(mapped).toBe(true)

    const canvas = await result.toCanvas({ scale: 1, dpr: 1 })
    const pixel = canvas.getContext('2d').getImageData(20, 20, 1, 1).data
    expect([...pixel]).toEqual([255, 0, 0, 255])
  })

  it('keeps author content that uses the legacy sandbox id and attribute', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'width:40px;height:40px;background:white'
    const authored = document.createElement('div')
    authored.id = 'snapdom-sandbox'
    authored.setAttribute('data-snapdom-sandbox', 'true')
    authored.style.cssText = 'width:40px;height:40px;background:rgb(0,128,0)'
    host.appendChild(authored)
    document.body.appendChild(host)

    let mapped = null
    const result = await snapdom(host, {
      burst: false,
      embedFonts: false,
      plugins: [{
        name: 'spy',
        afterClone(ctx) { mapped = [...ctx.nodeMap.values()].includes(authored) },
      }],
    })
    expect(mapped).toBe(true)

    const canvas = await result.toCanvas({ scale: 1, dpr: 1 })
    const pixel = canvas.getContext('2d').getImageData(20, 20, 1, 1).data
    expect([...pixel]).toEqual([0, 128, 0, 255])
  })
})
