import { it, expect, afterEach } from 'vitest'
import { snapdom } from '../src/api/snapdom.js'
import { __diffStats } from '../src/core/diff.js'
import { isSafari } from '../src/utils/browser.js'

const roots = []
afterEach(() => { for (const root of roots.splice(0)) root.remove() })
const options = { embedFonts: false, dpr: 1 }

async function scene() {
  const raster = document.createElement('canvas')
  raster.width = raster.height = 400
  const ctx = raster.getContext('2d')
  for (let x = 0; x < 400; x++) {
    ctx.fillStyle = x % 2 ? 'white' : 'black'
    ctx.fillRect(x, 0, 1, 400)
  }
  const root = document.createElement('div')
  root.style.cssText = 'width:100px;height:120px;background:white'
  root.innerHTML = '<section><span style="display:block;width:100px;height:20px">One</span></section><section><img style="display:block;width:100px;height:100px"></section>'
  root.querySelector('img').src = raster.toDataURL()
  document.body.append(root)
  roots.push(root)
  await root.querySelector('img').decode()
  return root
}

function expectSamePixels(actual, expected) {
  expect([actual.width, actual.height]).toEqual([expected.width, expected.height])
  const a = actual.getContext('2d').getImageData(0, 0, actual.width, actual.height).data
  const b = expected.getContext('2d').getImageData(0, 0, expected.width, expected.height).data
  let difference = 0
  for (let i = 0; i < a.length; i++) difference += Math.abs(a[i] - b[i])
  expect(difference).toBe(0)
}

it('preserves frozen originals after the live image and its layout change', async () => {
  const root = await scene()
  const captured = await snapdom(root, options)
  const control = await snapdom(root, { ...options, compress: false, burst: false })
  root.querySelector('img').src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="red"/></svg>')
  root.style.width = '200px'
  expectSamePixels(await captured.toCanvas({ width: 400 }), await control.toCanvas({ width: 400 }))
})

it('resolves a larger export against the crop window', async () => {
  const root = await scene()
  const captured = await snapdom(root, options)
  const control = await snapdom(root, { ...options, compress: false, burst: false })
  const exportOptions = { crop: { x: 25, y: 45, width: 50, height: 50 }, width: 400 }
  expectSamePixels(await captured.toCanvas(exportOptions), await control.toCanvas(exportOptions))
})

it('uses intrinsic SVG size if a later export removes the initial absolute width', async () => {
  const root = await scene()
  const captured = await snapdom(root, { ...options, width: 200 })
  const control = await snapdom(root, { ...options, width: 200, compress: false, burst: false })
  const exportOptions = { width: undefined, scale: 3 }
  expectSamePixels(await captured.toCanvas(exportOptions), await control.toCanvas(exportOptions))
})

it('preserves intrinsic density in scaled crop exports after clearing capture dimensions', async () => {
  const root = await scene()
  const captured = await snapdom(root, { ...options, width: 200 })
  const control = await snapdom(root, { ...options, width: 200, compress: false, burst: false })
  // Safari keeps an unscaled SVG header; scale 3 is needed there to exceed capture density.
  const exportOptions = { width: undefined, scale: isSafari() ? 3 : 2, crop: { x: 0, y: 20, width: 50, height: 50 } }
  expectSamePixels(await captured.toCanvas(exportOptions), await control.toCanvas(exportOptions))
})

it('accounts for both intrinsic densities in a width-only crop of a stretched capture', async () => {
  const root = await scene()
  const captured = await snapdom(root, { ...options, width: 150, height: 300 })
  const control = await snapdom(root, { ...options, width: 150, height: 300, compress: false, burst: false })
  const exportOptions = { width: isSafari() ? 150 : 100, height: undefined, crop: { x: 0, y: 20, width: 50, height: 50 } }
  expectSamePixels(await captured.toCanvas(exportOptions), await control.toCanvas(exportOptions))
})

it('restores resolution through the silent core exporter facade used by plugins', async () => {
  const root = await scene()
  const plugin = { name: 'resolution-detail', pure: true, defineExports: ctx => ({ detail: () => ctx.exports.canvas({ scale: 4 }) }) }
  const captured = await snapdom(root, { ...options, plugins: [plugin] })
  const control = await snapdom(root, { ...options, compress: false, burst: false })
  expectSamePixels(await captured.to('detail'), await control.toCanvas({ scale: 4 }))
})

it('keeps old result originals independent from the next differential result', async () => {
  const root = await scene()
  const old = await snapdom(root, options)
  const oldControl = await snapdom(root, { ...options, compress: false, burst: false })
  const served = __diffStats.served
  root.querySelector('span').firstChild.data = 'Two'
  const next = await snapdom(root, options)
  expect(__diffStats.served).toBeGreaterThan(served)
  const nextControl = await snapdom(root, { ...options, compress: false, burst: false })
  expectSamePixels(await next.toCanvas({ scale: 4 }), await nextControl.toCanvas({ scale: 4 }))
  expectSamePixels(await old.toCanvas({ scale: 4 }), await oldControl.toCanvas({ scale: 4 }))
})
