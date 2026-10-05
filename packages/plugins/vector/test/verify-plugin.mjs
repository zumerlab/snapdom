/** Integration checks for the paid plugin against the locally mounted v3 build. */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from './serve.mjs'
import { loadChromium, instrument, openFixture, check, report } from './harness.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const server = await serve(0)
const browser = await (await loadChromium(ROOT)).launch()
try {
  const page = await browser.newPage()
  // toFigma() writes the clipboard, and the check reads it back.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://localhost:${server.port}` })
  const { errors } = instrument(page)
  await openFixture(page, `http://localhost:${server.port}/test/fixtures/vector.html`)
  const results = await page.evaluate(async () => {
    const { snapdom } = await import('@zumer/snapdom')
    const { vector } = await import('@zumer/snapdom-vector')
    const { validate } = await import('@zumer/svd')
    const checks = []
    const test = (name, ok, detail = '') => checks.push({ name, ok, detail })
    const style = document.createElement('style')
    style.textContent = '@font-face{font-family:VectorFixture;src:url(/demo/fonts/Inter-400.ttf)}'
    document.head.appendChild(style)
    const holder = document.createElement('div')
    holder.style.cssText = 'width:320px'
    holder.innerHTML = '<div id="plugin-target" style="box-sizing:border-box;width:100%;padding:12px;border:2px solid black;font:16px VectorFixture;background:white">' +
      '<p id="plugin-keep">Keep this sentence</p><p id="plugin-drop">Drop this sentence</p></div>'
    document.body.appendChild(holder)
    const el = holder.firstElementChild
    await document.fonts.load('16px VectorFixture')
    const textOf = (doc) => Object.values(doc.nodes).map(n => n.text?.characters || '').join('\n')
    const fontsOf = (doc) => Object.values(doc.assets).filter(a => a.kind === 'font').length
    const plugin = vector({ silent: true, embedFonts: false, exclude: '#plugin-drop' })
    const result = await snapdom(el, { plugins: [plugin], embedFonts: true })
    const doc = await result.toVector()
    test('v3 result exposes the vector exporters', ['toVector', 'toVectorSvg', 'toVectorFigmaClipboard'].every(k => typeof result[k] === 'function'))
    test('the exported document validates', validate(doc).ok)
    test('factory exclusions survive normalized core defaults', !textOf(doc).includes('Drop this sentence'))
    test('factory embedFonts:false survives core embedFonts:true', fontsOf(doc) === 0)
    test('a border-box percentage root keeps its captured width', Math.abs(doc.capture.root.w - el.getBoundingClientRect().width) < 0.1, `${doc.capture.root.w}px`)
    test('the mounted border-box clone has no geometry drift', doc.report.drift.max < 0.1, JSON.stringify(doc.report.drift))
    const svg = await result.toVectorSvg()
    test('SVG uses the same factory exclusion', !svg.includes('Drop this sentence'))
    const h2d = await result.toVectorFigmaClipboard({ vectorFallback: false })
    test('Figma clipboard uses the same factory exclusion', !h2d.json.includes('Drop this sentence'))

    const overridden = await result.toVector({ exclude: [], embedFonts: true })
    test('explicit per-export options override factory defaults', textOf(overridden).includes('Drop this sentence') && fontsOf(overridden) > 0)
    const mutated = { exclude: [] }
    const queued = result.toVector(mutated)
    mutated.exclude = '#plugin-keep'
    test('queued export options retain their call-time value', textOf(await queued).includes('Keep this sentence'))

    const hookResult = await snapdom(el, {
      plugins: [vector({ silent: true, exclude: '#plugin-drop', embedFonts: false }), {
        name: 'vector-export-options',
        beforeExport(_ctx, payload) { payload.options.exclude = '#plugin-keep'; payload.options.embedFonts = true },
      }],
      embedFonts: false,
    })
    const hooked = await hookResult.toVector()
    test('beforeExport mutations override factory defaults', !textOf(hooked).includes('Keep this sentence') && textOf(hooked).includes('Drop this sentence') && fontsOf(hooked) > 0)
    const pushedResult = await snapdom(el, {
      plugins: [vector({ silent: true, exclude: ['#plugin-drop'] }), {
        name: 'vector-export-push',
        beforeExport(_ctx, payload) { payload.options.exclude.push('#plugin-keep') },
      }],
    })
    const pushed = await pushedResult.toVector()
    test('in-place beforeExport array mutations override factory defaults', !textOf(pushed).includes('Keep this sentence') && textOf(pushed).includes('Drop this sentence'))
    // The public entry is what customers get: two exports, one option.
    const publicModule = await import('/src/public.js')
    test('the public entry exports only vector and default', JSON.stringify(Object.keys(publicModule).sort()) === '["default","vector"]')
    const pub = await snapdom(el, { plugins: [publicModule.vector({ exclude: '#plugin-drop', mode: 'replica' })] })
    test('the public plugin adds toVector and toFigma and nothing else',
      typeof pub.toVector === 'function' && typeof pub.toFigma === 'function' && pub.toVectorSvg === undefined && pub.toVectorFigmaClipboard === undefined)
    const publicSvg = await pub.toVector()
    test('toVector() returns a standalone SVG string', typeof publicSvg === 'string' && /^\s*(<\?xml[^>]*>\s*)?<svg/.test(publicSvg) && !publicSvg.includes('foreignObject'), publicSvg.slice(0, 40))
    test('toVector() keeps the text and honours the factory exclude', publicSvg.includes('Keep this sentence') && !publicSvg.includes('Drop this sentence'))
    test('a call-time exclude wins over the factory default', (await pub.toVector({ exclude: [] })).includes('Drop this sentence'))
    await pub.toFigma()
    const [item] = await navigator.clipboard.read()
    const pasted = item.types.includes('text/html') ? await (await item.getType('text/html')).text() : ''
    test('toFigma() puts Figma paste HTML on the clipboard without the excluded text', pasted.length > 100 && !pasted.includes('Drop this sentence'), `${pasted.length} chars`)

    el.querySelector('#plugin-keep').textContent = 'A later capture'
    const later = await snapdom(el, { plugins: [plugin] })
    const olderDoc = await result.toVector()
    const newerDoc = await later.toVector()
    test('a reused plugin instance keeps capture text separate', textOf(olderDoc).includes('Keep this sentence') && textOf(newerDoc).includes('A later capture'))
    const inline = document.createElement('div')
    inline.style.cssText = 'font:16px Arial'
    inline.innerHTML = '<span class="inline-drop">PRIVATE_SENTINEL</span><span>PUBLIC_SENTINEL</span>'
    holder.appendChild(inline)
    const inlineResult = await snapdom(inline, { plugins: [vector({ silent: true, exclude: '.inline-drop' })] })
    const inlineDoc = await inlineResult.toVector()
    test('inline exclusions remove text and layer names from SVD', !JSON.stringify(inlineDoc).includes('PRIVATE_SENTINEL') && textOf(inlineDoc).includes('PUBLIC_SENTINEL'))
    const inlineSvg = await inlineResult.toVectorSvg()
    test('inline exclusions remove text from SVG', !inlineSvg.includes('PRIVATE_SENTINEL') && inlineSvg.includes('PUBLIC_SENTINEL'))
    const inlineH2d = await inlineResult.toVectorFigmaClipboard({ vectorFallback: false })
    test('inline exclusions remove text from Figma clipboard', !inlineH2d.json.includes('PRIVATE_SENTINEL') && inlineH2d.json.includes('PUBLIC_SENTINEL'))
    // The text of an inline element belongs to its block's text node, so a gradient clipped to it has to reach those runs.
    const priced = document.createElement('p')
    priced.style.cssText = 'margin:0;padding:8px;font:bold 32px Arial;color:#111827;background:white'
    priced.innerHTML = 'Now <b style="background:linear-gradient(90deg,#2e4bf0,#db2777);-webkit-background-clip:text;background-clip:text;color:transparent">$89</b>'
    holder.appendChild(priced)
    const tinted = (canvas) => {
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
      let hits = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 128 && Math.max(data[i], data[i + 2]) > 120 && data[i] + data[i + 2] - 2 * data[i + 1] > 100) hits++
      }
      return hits / (canvas.width * canvas.height)
    }
    const pricedResult = await snapdom(priced, { plugins: [publicModule.vector()] })
    const live = tinted(await pricedResult.toCanvas())
    const pricedSvg = await pricedResult.toVector()
    const img = new Image()
    img.src = URL.createObjectURL(new Blob([pricedSvg], { type: 'image/svg+xml' }))
    await img.decode()
    const drawn = document.createElement('canvas')
    drawn.width = img.naturalWidth
    drawn.height = img.naturalHeight
    drawn.getContext('2d').drawImage(img, 0, 0)
    URL.revokeObjectURL(img.src)
    test('an inline background-clip:text gradient paints its glyphs in toVector()', live > 0.01 && tinted(drawn) > live * 0.5, `live ${live.toFixed(4)} svg ${tinted(drawn).toFixed(4)}`)
    test('repeated exports leave no mounted clone or stylesheet', document.querySelectorAll('[data-snapdom-vector]').length === 0)
    const { collectImage } = await import('/src/collect/image.js')
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    icon.setAttribute('width', '40'); icon.setAttribute('height', '40')
    icon.innerHTML = '<rect width="40" height="40" fill="red" style="mask-position:10px 20px;mask-size:20px 30px;mask-repeat:no-repeat"/>'
    holder.appendChild(icon)
    const markup = async () => (await collectImage(icon, getComputedStyle(icon))).asset.markup
    test('unmasked SVG omits inert mask longhands', !(await markup()).includes('mask-position'))
    icon.firstElementChild.style.maskImage = 'linear-gradient(black, transparent)'
    test('active SVG mask retains its positioning and size', (await markup()).includes('mask-position: 10px 20px') && (await markup()).includes('mask-size: 20px 30px'))
    icon.firstElementChild.style.maskImage = 'none'
    icon.insertAdjacentHTML('afterbegin', '<style>rect { mask-image:linear-gradient(black, transparent) }</style>')
    test('embedded SVG stylesheet preserves mask longhands', (await markup()).includes('mask-position: 10px 20px'))
    holder.remove()
    style.remove()
    return checks
  })
  for (const row of results) check(row.name, row.ok, row.detail)
  check('the fixture raises no page error', errors.length === 0, errors.join(' | '))
  report()
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
