import { afterEach, describe, expect, it } from 'vitest'
import { snapdom as source } from '../src/index.js'
import { snapdom as bundle } from '../dist/snapdom.mjs'

const mounted = []
afterEach(() => { while (mounted.length) mounted.pop().remove() })

function mount(html) {
  const root = document.createElement('div')
  root.style.cssText = 'width:160px;background:white;font:16px Arial'
  root.innerHTML = html
  document.body.appendChild(root)
  mounted.push(root)
  return root
}

const svg = result => decodeURIComponent(result.url.split(',')[1])
const base = { embedFonts: false, dpr: 1 }

// Exercise the shipped ESM as well as the source: function identity does not tell us
// whether a callback's closure changed between captures of an unchanged DOM tree.
describe.each([['source', source], ['bundle', bundle]])('%s capture callbacks', (_name, snapdom) => {
  it.each([undefined, true])('reevaluates filter while preserving independent exclusion (burst=%s)', async burst => {
    const root = mount('<p>PUBLIC-MARKER</p><p class="secret">PRIVATE-MARKER</p><p class="always">ALWAYS-EXCLUDED</p>')
    const original = root.outerHTML
    let privateMode = false
    const options = {
      ...base, burst,
      filter: el => !privateMode || !el.matches('.secret'),
      filterMode: 'remove',
      exclude: '.always',
      excludeMode: 'hide',
      plugins: [{ name: 'deterministic-filter-hook', pure: true, beforeSnap() {} }],
    }
    await snapdom(root, options)
    const previous = await snapdom(root, options)
    expect(svg(previous)).toContain('PRIVATE-MARKER')
    expect(svg(previous)).not.toContain('ALWAYS-EXCLUDED')

    privateMode = true
    const hidden = await snapdom(root, options)
    expect(svg(hidden)).not.toContain('PRIVATE-MARKER')
    expect(svg(hidden)).not.toContain('ALWAYS-EXCLUDED')
    expect(svg(hidden)).toContain('PUBLIC-MARKER')
    expect(hidden).not.toBe(previous)

    privateMode = false
    expect(svg(await snapdom(root, options))).toContain('PRIVATE-MARKER')
    expect(root.outerHTML).toBe(original)
  })

  it.each([undefined, true])('reevaluates exclusion after external state changes (burst=%s)', async burst => {
    const root = mount('<p>PUBLIC-MARKER</p><p class="secret">PRIVATE-MARKER</p>')
    const original = root.outerHTML
    let privateMode = false
    const options = { ...base, burst, exclude: el => privateMode && el.matches('.secret'), excludeMode: 'remove' }
    await snapdom(root, options)
    const previous = await snapdom(root, options)
    expect(svg(previous)).toContain('PRIVATE-MARKER')

    privateMode = true
    const hidden = await snapdom(root, options)
    expect(svg(hidden)).not.toContain('PRIVATE-MARKER')
    expect(svg(hidden)).toContain('PUBLIC-MARKER')
    expect(hidden).not.toBe(previous)

    privateMode = false
    expect(svg(await snapdom(root, options))).toContain('PRIVATE-MARKER')
    expect(root.outerHTML).toBe(original)
  })

  it('reevaluates predicates mixed with selectors even with a pure plugin', async () => {
    const root = mount('<p>PUBLIC-MARKER</p><p class="secret">PRIVATE-MARKER</p><p class="always">ALWAYS-EXCLUDED</p>')
    let privateMode = false
    const options = {
      ...base,
      exclude: ['.always', el => privateMode && el.matches('.secret')],
      plugins: [{ name: 'deterministic-hook', pure: true, beforeSnap() {} }],
    }
    await snapdom(root, options)
    const previous = await snapdom(root, options)
    expect(svg(previous)).toContain('PRIVATE-MARKER')
    expect(svg(previous)).not.toContain('ALWAYS-EXCLUDED')
    privateMode = true
    const hidden = await snapdom(root, options)
    expect(svg(hidden)).not.toContain('PRIVATE-MARKER')
    expect(svg(hidden)).not.toContain('ALWAYS-EXCLUDED')
    expect(svg(hidden)).toContain('PUBLIC-MARKER')
  })

  it.each([undefined, false])('refreshes callback-dependent style snapshots (burst=%s)', async burst => {
    const sheet = document.createElement('style')
    sheet.textContent = '.callback-spacing { letter-spacing: 7px }'
    document.head.appendChild(sheet)
    mounted.push(sheet)
    const root = mount('<span class="callback-spacing">Spacing</span>')
    let omitSpacing = false
    const options = { ...base, burst, excludeStyleProps: prop => omitSpacing && prop === 'letter-spacing' }
    await snapdom(root, options)
    const previous = await snapdom(root, options)
    expect(svg(previous)).toContain('letter-spacing:7px')

    omitSpacing = true
    const omitted = await snapdom(root, options)
    expect(omitted).not.toBe(previous)
    expect(svg(omitted)).not.toContain('letter-spacing:7px')
    omitSpacing = false
    expect(svg(await snapdom(root, options))).toContain('letter-spacing:7px')
  })

  it('uses the current fallback callback when the original image is unavailable', async () => {
    const root = mount('<img width="20" height="20">')
    const img = root.firstElementChild
    const broken = URL.createObjectURL(new Blob(['not an image'], { type: 'image/png' }))
    const failed = new Promise(resolve => { img.onerror = resolve })
    img.src = broken
    await failed
    URL.revokeObjectURL(broken)

    function colorUrl(color) {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 20
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 20, 20)
      return canvas.toDataURL()
    }
    let replacement = colorUrl('red')
    const options = { ...base, fallbackURL: () => replacement }
    await snapdom(root, options)
    const previous = await snapdom(root, options)
    replacement = colorUrl('blue')
    const current = await snapdom(root, options)
    const oldCanvas = await previous.toCanvas()
    const newCanvas = await current.toCanvas()
    const pixel = canvas => [...canvas.getContext('2d').getImageData(10, 10, 1, 1).data]
    expect(pixel(oldCanvas)).toEqual([255, 0, 0, 255])
    expect(pixel(newCanvas)).toEqual([0, 0, 255, 255])
  })

  it('keeps automatic reuse for selector-only captures', async () => {
    const root = mount('<p>PUBLIC-MARKER</p><p class="secret">PRIVATE-MARKER</p>')
    const options = { ...base, exclude: '.secret', excludeMode: 'remove' }
    const first = await snapdom(root, options)
    expect(await snapdom(root, options)).toBe(first)
    expect(svg(first)).not.toContain('PRIVATE-MARKER')
  })
})
