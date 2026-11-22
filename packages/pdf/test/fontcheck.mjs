/**
 * Font verification: which font FILES a page's text can be painted from, and
 * the text that must stay in the page image because no file holds its glyphs.
 *
 *   node test/fontcheck.mjs
 *
 * What it asserts, on test/fixtures/fonts.html:
 *  - A WOFF2 face embeds (it is rebuilt from behind Brotli), and painted as
 *    glyphs it lays down the same ink the page's own raster does.
 *  - A variable font is painted only at the weight its file was saved in. Any
 *    other weight stays in the page image, and the report says why.
 *  - A bold or an italic the browser faked from the regular file is not painted
 *    from that file — unless `font-synthesis` forbade the fake, in which case
 *    the regular glyphs ARE what the page shows.
 *  - A weight the family lacks but the browser does not fake (300 from a 400
 *    file) is painted: the file's glyphs are what is on the page.
 *  - Text under a translucent ancestor and outlined text are not painted;
 *    `-webkit-text-fill-color` decides the fill, not `color`.
 *  - Small caps, a soft-hyphenated word and a word the face does not cover stay
 *    in the page image.
 *  - With the page image on, a painted word is in the file ONCE: the image is
 *    drawn without its glyph fill, the underline and the shadow it carries stay,
 *    nothing is lost next to the browser's own raster, and a later export of
 *    the same capture still gets the whole image.
 *  - All of it is the default: an export with no options paints what its fonts
 *    can draw, and `vectorText: false` is how to keep every glyph in the image.
 *  - `substitution`, `variationAxes`, `withoutGlyphs` and `wrapperIsInert`, the
 *    pure functions behind it.
 *
 * "Painted" is measured, not read from a counter: every band of the page is
 * rendered by pdf.js from an image-free export, where the only ink there can be
 * is a glyph the exporter chose to paint.
 */
import { chromium } from 'playwright'
import { serve } from './serve.mjs'

let failures = 0
const fail = (msg) => { failures++; console.log(`  ✗ ${msg}`) }
const ok = (msg) => console.log(`  ✓ ${msg}`)
const assert = (cond, msg) => (cond ? ok(msg) : fail(msg))

const server = await serve()
const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1 })
await page.goto(`http://localhost:${server.port}/test/fixtures/fonts.html`)
await page.waitForFunction('window.__ready === true')

const run = (options) => page.evaluate((opts) => window.__export(opts), options)
const bands = await page.evaluate(() => window.__bands())
const inkOf = (result) => page.evaluate(([b64, b]) => window.__ink(b64, b), [result.base64, bands])
const messages = (result) => (result.report?.warnings || []).map(w => String(w.message || w))

// The page as the browser painted it: the raster alone, no glyph painted over it.
const raster = await run({ export: { vectorText: false } })
// Only what the exporter paints as glyphs: no raster beneath, so any ink is a decision.
const glyphs = await run({ export: { vectorText: true, image: false } })

if (raster.error || glyphs.error) {
  fail(`export threw: ${(raster.error || glyphs.error).message}`)
} else {
  const photo = await inkOf(raster)
  const drawn = await inkOf(glyphs)
  const said = messages(glyphs)
  const ratio = (band) => drawn[band].ink / photo[band].ink
  const painted = (band, what) => assert(ratio(band) > 0.85 && ratio(band) < 1.15,
    `${what} is painted from its file at the page's own weight (ink ratio ${ratio(band).toFixed(3)})`)
  const held = (band, what) => assert(drawn[band].ink === 0 && photo[band].ink > 500,
    `${what} is not painted as glyphs (${drawn[band].ink} ink where the page has ${photo[band].ink})`)

  console.log('\nWOFF2')
  const embedded = (glyphs.report.fontsEmbedded || []).map(f => f.label)
  assert(embedded.some(l => l.includes('Packed')), `the WOFF2 face embeds (${embedded.join(', ')})`)
  assert(!messages(raster).some(m => /WOFF2/.test(m)), 'no export reports WOFF2 as unreadable')
  painted('packed', 'a WOFF2 face')

  console.log('\nvariable font')
  assert(embedded.some(l => l.includes('Ranged')), 'the variable face embeds')
  painted('ranged-default', 'a variable font at the weight its file was saved in')
  held('ranged-bold', 'a variable font at weight 700')
  held('ranged-light', 'a variable font at weight 300')
  assert(said.some(m => /left as image/.test(m) && /variable font the page draws at weight 700/.test(m) &&
    /weight 300/.test(m)), 'the report names both weights the file cannot draw')

  console.log('\nfaked bold and italic')
  painted('alone-regular', 'the regular face')
  held('alone-bold', 'a bold the browser fattened from the regular file')
  held('alone-italic', 'an italic the browser slanted from the upright file')
  painted('alone-light', 'a lighter weight the browser does not fake')
  painted('alone-nofake', 'a bold that font-synthesis forbade the browser to fake')
  assert(said.some(m => /fattens the regular/.test(m)) && said.some(m => /slants the upright/.test(m)),
    'the report says the bold and the italic were faked')

  console.log('\npaint the file cannot reproduce')
  held('alone-faded', 'text under a translucent ancestor')
  held('alone-outlined', 'outlined text')
  painted('alone-filled', 'text with its own fill colour')
  const [r, g, b] = drawn['alone-filled'].rgb
  assert(g > r && g > b, `the fill is -webkit-text-fill-color, not color (rgb sums ${r}, ${g}, ${b})`)

  console.log('\nglyphs that are not the code points')
  held('packed-caps', 'small caps')
  held('packed-hyphen', 'a word broken at a soft hyphen')
  assert(drawn['packed-mixed'].ink > 0 && ratio('packed-mixed') < 0.8,
    `a line with a word the face lacks paints the words it has and no more (ink ratio ${ratio('packed-mixed').toFixed(3)})`)

  console.log('\nthe count matches the page')
  // One word per run in collapsing white-space: seven bands painted whole at
  // three words each, and the two covered words of the mixed line.
  assert(glyphs.report.vectorText === 7 * 3 + 2,
    `report counts ${glyphs.report.vectorText} painted runs (7 painted bands × 3 words + 2)`)
}

// ——— the page image gives up the text that is painted as glyphs ————————————————
{
  console.log('\npainted once: the page image without the glyphs')
  const both = await run({ export: { vectorText: true, deflate: false } })
  if (raster.error || both.error) fail(`export threw: ${(raster.error || both.error).message}`)
  else {
    const bytes = Buffer.from(both.base64, 'base64')
    // The same file with every painted run switched to invisible: what is left
    // on the page is the image alone. `BT 0 Tr /E…` is how a painted run in an
    // embedded face opens, and the edit keeps every byte offset where it was.
    const raw = bytes.toString('latin1')
    const imageOnly = { base64: Buffer.from(raw.replaceAll('BT 0 Tr /E', 'BT 3 Tr /E'), 'latin1').toString('base64') }
    assert(raw.includes('BT 0 Tr /E') && raw.includes('/Subtype /Image'), 'the export paints glyphs AND carries a page image')
    const photo = await inkOf(raster)
    const whole = await inkOf(both)
    const image = await inkOf(imageOnly)
    const said = messages(both)

    const PAINTED = ['packed', 'ranged-default', 'alone-regular', 'alone-light', 'alone-nofake', 'alone-filled']
    const HELD = ['ranged-bold', 'ranged-light', 'alone-bold', 'alone-italic', 'alone-faded', 'alone-outlined',
      'packed-caps', 'packed-hyphen']
    const left = PAINTED.filter(b => image[b].ink > 0.02 * photo[b].ink)
    assert(left.length === 0,
      `the image holds no glyph of a painted line (${left.map(b => `${b} ${image[b].ink}/${photo[b].ink}`).join(', ') || 'all six clear'})`)
    const gone = HELD.filter(b => image[b].ink < 0.97 * photo[b].ink || image[b].ink > 1.03 * photo[b].ink)
    assert(gone.length === 0,
      `the image keeps every line that is not painted (${gone.map(b => `${b} ${image[b].ink}/${photo[b].ink}`).join(', ') || 'all eight whole'})`)
    const deco = image['packed-decorated'].ink / photo['packed-decorated'].ink
    assert(deco > 0.1 && deco < 0.9,
      `an underlined, shadowed line keeps its underline and shadow in the image and gives up its glyphs (ink ratio ${deco.toFixed(3)})`)
    const mixed = image['packed-mixed'].ink / photo['packed-mixed'].ink
    assert(mixed > 0.1 && mixed < 0.8,
      `a mixed line keeps in the image only the word the face lacks (ink ratio ${mixed.toFixed(3)})`)
    const off = Object.keys(bands).filter(b => whole[b].ink < 0.85 * photo[b].ink || whole[b].ink > 1.15 * photo[b].ink)
    assert(off.length === 0,
      `glyphs and image together lay down the page's own ink in every line (${off.map(b => `${b} ${(whole[b].ink / photo[b].ink).toFixed(3)}`).join(', ') || `${Object.keys(bands).length} lines`})`)
    assert(said.some(m => /painted as real vector glyphs/.test(m) && /left out of the page image/.test(m)),
      'the report says the painted words were left out of the page image')
    const rasterBytes = Buffer.from(raster.base64, 'base64').length
    assert(bytes.length < rasterBytes, `the file is lighter than the raster-only export (${bytes.length} B against ${rasterBytes} B)`)

    // One capture, three exports: the cleared image must not leak into an export
    // that paints nothing, nor be lost to one that paints again.
    const [first, plain, again] = await page.evaluate(() => window.__exportMany([
      { vectorText: true, deflate: false }, { vectorText: false, deflate: false }, { vectorText: true, deflate: false },
    ]))
    const plainInk = await inkOf(plain)
    const short = Object.keys(bands).filter(b => plainInk[b].ink < 0.97 * photo[b].ink)
    assert(short.length === 0,
      `an export that paints nothing gets the whole image after one that cleared it (${short.join(', ') || 'every line'})`)
    assert(first.base64 === again.base64, 'the same export twice on one capture is the same file')
    assert(messages(again).some(m => /left out of the page image/.test(m)),
      'an export served from the image cache still reports what its image holds')
  }
}

// ——— painting text as glyphs is what happens when nobody asks ————————————————————
{
  console.log('\nthe default')
  const [byDefault, off, imageFree] = await page.evaluate(() => window.__exportMany([{}, { vectorText: false }, { image: false }]))
  assert(byDefault.report.vectorText === 7 * 3 + 2 && messages(byDefault).some(m => /left out of the page image/.test(m)),
    `an export with no options paints the text its fonts can draw and clears it from the image (${byDefault.report.vectorText} runs)`)
  assert(off.report.vectorText === 0 && !messages(off).some(m => /painted as real vector glyphs/.test(m)),
    `vectorText:false paints none and says nothing about it (${off.report.vectorText} runs)`)
  assert(Buffer.from(byDefault.base64, 'base64').length < Buffer.from(off.base64, 'base64').length,
    `the default file is the lighter one (${Buffer.from(byDefault.base64, 'base64').length} B against ${Buffer.from(off.base64, 'base64').length} B)`)
  // An image-free export that never mentioned vector text is the searchable-layer file it
  // always was: it must not start warning that text it never promised to show is not shown.
  assert(!messages(imageFree).some(m => /could not be painted as vector/.test(m)),
    'an image-free export that did not ask for painted text is not warned about text it cannot paint')
}

// ——— the revised SVG ————————————————————————————————————————————————————————
{
  console.log('\nwithoutGlyphs')
  const out = await page.evaluate(async () => {
    const { withoutGlyphs, wrapperIsInert } = await import('/src/page-image.js')
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">' +
      '<foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml"><div>' +
      '<p>alpha beta gamma</p><textarea>one two</textarea>' +
      '<svg xmlns="http://www.w3.org/2000/svg"><text>inner</text></svg><p>delta</p>' +
      '</div></div></foreignObject></svg>'
    const wrapped = (spans, total = 4) => {
      const text = withoutGlyphs(svg, new Map(spans), total)
      if (text === null) return null
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
      return {
        parses: !doc.querySelector('parsererror'),
        wrappers: [...doc.getElementsByTagName('snapdom-pdf-glyphs')].map(w => w.textContent),
        style: doc.getElementsByTagName('snapdom-pdf-glyphs')[0]?.getAttribute('style'),
        text: doc.documentElement.textContent,
      }
    }
    const sheetDoc = async (css) => {
      const frame = document.createElement('iframe')
      frame.srcdoc = `<style>${css}</style><p>x</p>`
      const loaded = new Promise(resolve => { frame.onload = resolve })
      document.body.appendChild(frame)
      await loaded
      const verdict = wrapperIsInert(frame.contentDocument)
      frame.remove()
      return verdict
    }
    return {
      neighbours: wrapped([[0, [[0, 5], [6, 10]]]]),
      apart: wrapped([[0, [[0, 5], [11, 16]]]]),
      whole: wrapped([[0, [[0, 5], [6, 10], [11, 16]]], [3, [[0, 5]]]]),
      miscount: wrapped([[0, [[0, 5]]]], 5),
      textarea: wrapped([[1, [[0, 3]]]]),
      svgText: wrapped([[2, [[0, 5]]]]),
      outOfRange: wrapped([[0, [[40, 50]]]]),
      nothing: wrapped([]),
      notSvg: withoutGlyphs('<p>plain</p>', new Map([[0, [[0, 1]]]]), 1),
      inertClass: await sheetDoc('.c1{color:red} p{margin:0} [data-x]::after{content:""}'),
      inertNested: await sheetDoc('@media screen{.c1{color:red}}'),
      firstChild: await sheetDoc('b:first-child{color:red}'),
      sibling: await sheetDoc('p + p{color:red}'),
      star: await sheetDoc('div > *{color:red}'),
      nestedEmpty: await sheetDoc('@media screen{p:empty{display:none}}'),
    }
  })
  const same = (name, got, want) => assert(JSON.stringify(got) === JSON.stringify(want), `${name} (${JSON.stringify(got)})`)
  same('neighbouring words share one wrapper, the space between them included', out.neighbours?.wrappers, ['alpha beta'])
  same('words apart get a wrapper each', out.apart?.wrappers, ['alpha', 'gamma'])
  same('a node cleared whole is wrapped whole', out.whole?.wrappers, ['alpha beta gamma', 'delta'])
  assert(out.whole?.parses && out.whole.text === 'alpha beta gammaone twoinnerdelta', 'the revised SVG parses and no text moved or changed')
  assert(/all:unset!important/.test(out.neighbours?.style || '') && /-webkit-text-fill-color:transparent!important/.test(out.neighbours.style),
    'the wrapper changes the fill and nothing else')
  same('a different text-node count clears nothing', out.miscount, null)
  same('text inside a textarea is never wrapped', out.textarea, null)
  same('SVG text is never wrapped', out.svgText, null)
  same('a span outside the node is ignored', out.outOfRange, null)
  same('nothing to clear is nothing to do', out.nothing, null)
  same('a document that is not the capture is left alone', out.notSvg, null)
  assert(out.inertClass === true && out.inertNested === true, 'class, tag and attribute rules cannot react to a wrapper')
  assert(out.firstChild === false && out.sibling === false && out.star === false && out.nestedEmpty === false,
    'a structural selector anywhere, nested rules included, vetoes wrapping')
}

// ——— the two pure functions ———————————————————————————————————————————————
{
  console.log('\nsubstitution')
  const verdicts = await page.evaluate(async () => {
    const { substitution, variationAxes } = await import('/src/mega/fonts.js')
    const wght = [{ tag: 'wght', min: 100, def: 400, max: 900 }]
    const key = (over) => ({ weight: 400, italic: false, stretch: 100, tuned: false, fakeBold: true, fakeItalic: true, ...over })
    const why = (rule, fk, axes) => substitution({ weight: '', style: '', ...rule }, key(fk), axes) || ''
    const bytes = new Uint8Array(await (await fetch('/test/fixtures/fonts/Roboto-variable-latin.woff2')).arrayBuffer())
    const { sfntFromBytes } = await import('/src/writer/font.js')
    const variable = await sfntFromBytes(bytes)
    const plain = await sfntFromBytes(new Uint8Array(await (await fetch('/demo/fonts/Inter-400.ttf')).arrayBuffer()))
    return {
      staticExact: why({ weight: '400' }, {}, []),
      staticBold: why({ weight: '400' }, { weight: 700 }, []),
      staticSemibold: why({ weight: '400' }, { weight: 600 }, []),
      staticMedium: why({ weight: '400' }, { weight: 500 }, []),
      boldFromBold: why({ weight: '700' }, { weight: 900 }, []),
      undeclaredBold: why({}, { weight: 700 }, []),
      noFakeBold: why({ weight: '400' }, { weight: 700, fakeBold: false }, []),
      italicFaked: why({ weight: '400' }, { italic: true }, []),
      italicReal: why({ weight: '400', style: 'italic' }, { italic: true }, []),
      noFakeItalic: why({ weight: '400' }, { italic: true, fakeItalic: false }, []),
      varDefault: why({ weight: '100 900' }, {}, wght),
      varBold: why({ weight: '100 900' }, { weight: 700 }, wght),
      varClampedByRule: why({ weight: '400' }, { weight: 300 }, wght),
      varClampedByAxis: why({ weight: '1 1000' }, { weight: 950 }, [{ tag: 'wght', min: 100, def: 900, max: 900 }]),
      varUndeclaredBold: why({}, { weight: 700 }, wght),
      varTuned: why({ weight: '100 900' }, { tuned: true }, wght),
      varOptical: why({ weight: '100 900' }, {}, [...wght, { tag: 'opsz', min: 14, def: 14, max: 32 }]),
      varWidth: why({ weight: '100 900' }, { stretch: 75 }, [...wght, { tag: 'wdth', min: 75, def: 100, max: 100 }]),
      varWidthDefault: why({ weight: '100 900' }, {}, [...wght, { tag: 'wdth', min: 75, def: 100, max: 100 }]),
      varSlant: why({ weight: '100 900' }, { italic: true }, [...wght, { tag: 'slnt', min: -10, def: 0, max: 0 }]),
      pinnedAxis: why({ weight: '400' }, { tuned: true }, [{ tag: 'wght', min: 400, def: 400, max: 400 }]),
      axesOfVariable: variable.error || variationAxes(variable.sfnt),
      axesOfStatic: plain.error || variationAxes(plain.sfnt),
      axesOfTruncated: variationAxes(variable.sfnt.subarray(0, 64)),
    }
  })
  const exact = (name) => assert(verdicts[name] === '', `${name}: the file's glyphs are the page's`)
  const off = (name, pattern) => assert(pattern.test(verdicts[name]), `${name}: ${verdicts[name] || 'NOT REFUSED'}`)
  exact('staticExact')
  off('staticBold', /fattens/)
  off('staticSemibold', /fattens/)
  exact('staticMedium')
  exact('boldFromBold')
  off('undeclaredBold', /fattens/)
  exact('noFakeBold')
  off('italicFaked', /slants the upright/)
  exact('italicReal')
  exact('noFakeItalic')
  exact('varDefault')
  off('varBold', /weight 700.*\(400\)/)
  exact('varClampedByRule')
  exact('varClampedByAxis')
  off('varUndeclaredBold', /fattens/)
  off('varTuned', /font-variation-settings/)
  off('varOptical', /optical-size/)
  off('varWidth', /another width/)
  exact('varWidthDefault')
  off('varSlant', /slants along an axis/)
  exact('pinnedAxis')
  assert(JSON.stringify(verdicts.axesOfVariable) === JSON.stringify([{ tag: 'wght', min: 100, def: 400, max: 900 }]),
    `the variable file declares one weight axis (${JSON.stringify(verdicts.axesOfVariable)})`)
  assert(Array.isArray(verdicts.axesOfStatic) && verdicts.axesOfStatic.length === 0, 'a static file declares no axes')
  assert(Array.isArray(verdicts.axesOfTruncated) && verdicts.axesOfTruncated.length === 0,
    'a truncated file reads as no axes instead of throwing')
}

await browser.close()
server.close()

if (failures) {
  console.log(`\n${failures} FAILURE(S)`)
  process.exitCode = 1
} else {
  console.log('\nAll font assertions passed.')
}
