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
 *  - `substitution` and `variationAxes`, the two pure functions behind it.
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

  console.log('\nthe count matches the page')
  // One word per run in collapsing white-space: three words a band, eight bands painted.
  assert(glyphs.report.vectorText === 6 * 3,
    `report counts ${glyphs.report.vectorText} painted runs (6 painted bands × 3 words)`)
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
