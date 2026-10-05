/**
 * pdfmega verification: fillable fields, document identity, page labels, and
 * the structure edge — proven with pdf.js and byte inspection, not with faith.
 *
 *   node test/megacheck.mjs
 *
 * What it asserts, per export of test/fixtures/mega.html:
 *  - AcroForm fields exist with their DOM names, values, options and states;
 *    the password field exists and is EMPTY; readonly is flagged.
 *  - A field's value is extracted ONCE (from the field, not the text layer),
 *    and with fields:false it is back in the text layer and AcroForm is gone.
 *  - /Info, XMP /Metadata, trailer /ID, /PageLabels, DisplayDocTitle.
 *  - %PDF-1.7, /OBJR, /Tabs /S, THead/TBody, TH /Scope in the raw bytes.
 *  - Byte determinism: two identical exports are identical files.
 *  - A pre-aborted signal rejects with AbortError and produces nothing.
 *  - The structured report matches the file it describes.
 *  - Embedded fonts: FontFile2 streams are byte-identical to the source TTFs,
 *    survive Chromium's OTS sanitizer via new FontFace().load(), extraction is
 *    unchanged next to an unembedded export, and the PDF/UA-1 identifier is
 *    written exactly when the export earned it.
 */
import fs from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { serve } from './serve.mjs'

const require = createRequire(import.meta.url)
const pdfjs = await import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'))
pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')

let failures = 0
const fail = (msg) => { failures++; console.log(`  ✗ ${msg}`) }
const ok = (msg) => console.log(`  ✓ ${msg}`)
const assert = (cond, msg) => (cond ? ok(msg) : fail(msg))

const server = await serve()
const browser = await chromium.launch()
const page = await browser.newPage()
const consoleWarnings = []
page.on('console', m => { if (m.type() === 'warning') consoleWarnings.push(m.text()) })
await page.goto(`http://localhost:${server.port}/test/fixtures/mega.html`)
await page.waitForFunction('window.__ready === true')

const run = (options) => page.evaluate((opts) => window.__export(opts), options)
const bytesOf = (result) => Uint8Array.from(Buffer.from(result.base64, 'base64'))
const latin = (bytes) => Buffer.from(bytes).toString('latin1')

// ——— the full-dress export: A4, tagged, meta, toc, cover ———————————————
const META = {
  title: 'Mega Report', author: 'Ada Lovelace', subject: 'Fixture of everything',
  keywords: ['mega', 'fixture'], created: '2026-08-14T00:00:00Z',
}
const full = await run({
  export: {
    page: 'a4', meta: META, toc: true, coverSelector: '#cover',
    pageNumbers: true, deflate: false,
  },
})
if (full.error) fail(`full export threw: ${full.error.name}: ${full.error.message}`)
else {
  console.log('\nfull-dress A4 export')
  const bytes = bytesOf(full)
  const raw = latin(bytes)

  assert(raw.startsWith('%PDF-1.7'), 'header is %PDF-1.7')
  assert(/\/ID \[<[0-9A-F]{32}> <[0-9A-F]{32}>\]/.test(raw), 'trailer carries a 128-bit /ID')
  assert(raw.includes('/Info '), 'trailer carries /Info')
  assert(raw.includes('/Producer (snapdom-pdf)'), '/Producer names the exporter')
  assert(raw.includes('/Title (Mega Report)'), '/Info /Title written')
  assert(raw.includes('/CreationDate (D:20260814000000Z)'), 'CreationDate written from the given date')
  assert(raw.includes('<x:xmpmeta'), 'XMP packet present')
  assert(raw.includes('/ViewerPreferences << /DisplayDocTitle true >>'), 'DisplayDocTitle set')
  assert(raw.includes('/PageLabels'), '/PageLabels present')
  assert(raw.includes('/Tabs /S'), 'pages declare /Tabs /S')
  assert(raw.includes('/Type /OBJR'), 'annotations join the tree via /OBJR')
  assert(raw.includes('/THead'), 'THead structure written')
  assert(raw.includes('/TBody'), 'TBody structure written')
  assert(raw.includes('/Scope /Column'), 'TH scope Column written')
  assert(raw.includes('/Scope /Row'), 'TH scope Row written')
  assert(raw.includes('/AcroForm'), 'catalog carries /AcroForm')
  assert(!raw.includes('Sup3rSecretValue'), 'password value is nowhere in the file')
  assert(raw.includes('/BaseFont /AAAAAA+Inter-'), 'embedded Inter is a subset (AAAAAA+ tag) document font')
  assert((full.report.fontsEmbedded || []).length === 2,
    `report names 2 embedded faces (${JSON.stringify(full.report.fontsEmbedded)})`)
  assert(full.report.fontsEmbedded.every(f => f.subset && f.kB < 40),
    `each face is a subset under 40 kB (${full.report.fontsEmbedded.map(f => f.kB + 'kB').join(', ')})`)
  assert(/BT 0 Tr \/E\d/.test(raw), 'visible furniture text rides the embedded document face')
  assert(full.report.pdfua === false, 'mixed page (Arial island + fields) does not claim UA')
  // A non-claiming file must not even grep positive for the identifier: the
  // xmlns is gated on the claim, so triage that greps `pdfuaid` stays honest.
  assert(!raw.includes('pdfuaid'), 'no pdfuaid namespace leaks into a non-claiming file')

  const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise
  const { info } = await pdf.getMetadata()
  assert(info.Title === 'Mega Report', `pdf.js reads Title (${JSON.stringify(info.Title)})`)
  const labels = await pdf.getPageLabels()
  assert(labels && labels[0] === 'i', `front matter labelled in roman (${labels && labels.slice(0, 3)})`)
  assert(labels && labels.includes('1'), 'body starts at label 1')

  const fields = await pdf.getFieldObjects()
  const names = Object.keys(fields || {})
  assert(names.includes('fullname'), `field fullname exists (${names.length} fields)`)
  const f = (n) => fields[n] && fields[n][0]
  assert(f('fullname')?.value === 'AdaLovelace', 'fullname carries its DOM value')
  assert(f('secret') && !f('secret').value, 'password field exists and is empty')
  assert(f('updates')?.value === 'Yes', 'checked checkbox exports as Yes')
  assert(f('engine')?.value === 'webkit', 'select exports its selected option value')
  assert(f('plan') !== undefined, 'radio group exists as one field')
  assert(f('notes')?.multiline === true, 'textarea is multiline')
  assert(f('frozen')?.editable === false, 'readonly control is a read-only field')

  // The one-extraction rule: the value lives in the field, not under it.
  let text = ''
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent()
    text += tc.items.map(i => i.str || '').join(' ') + ' '
  }
  assert(!text.includes('AdaLovelace'), 'field value suppressed from the invisible layer')
  assert(text.includes('SearchableClosingWord'), 'ordinary prose still extracts')
  assert(text.includes('MegaFormHeading'), 'headings still extract')

  const annots = []
  for (let p = 1; p <= pdf.numPages; p++) {
    annots.push(...await (await pdf.getPage(p)).getAnnotations())
  }
  const widgets = annots.filter(a => a.subtype === 'Widget')
  const linkAnnots = annots.filter(a => a.subtype === 'Link')
  assert(widgets.length >= 10, `${widgets.length} widget annotations`)
  assert(linkAnnots.length >= 2, `${linkAnnots.length} link annotations`)
  assert(full.report && full.report.fields > 0, `report says ${full.report?.fields} fields`)
  assert(full.report.pages === pdf.numPages, `report pages ${full.report.pages} == file ${pdf.numPages}`)
  assert(full.report.bytes === bytes.length, 'report bytes == blob size')
  assert(full.report.warnings.every(w => typeof w.code === 'string' && w.code), 'every warning carries a code')
  assert(full.progress.includes('page') && full.progress.includes('assemble'),
    `progress phases seen: ${full.progress.join(',')}`)
  await pdf.destroy()
}

// ——— determinism ————————————————————————————————————————————————————————
{
  console.log('\ndeterminism')
  const opts = { export: { page: 'a4', meta: META, toc: true, pageNumbers: true } }
  const a = await run(opts)
  const b = await run(opts)
  if (a.error || b.error) fail(`determinism exports threw: ${a.error?.message || b.error?.message}`)
  else {
    assert(a.base64 === b.base64, 'two identical exports are byte-identical')
    assert(JSON.stringify(a.report) === JSON.stringify(b.report), 'two identical exports report identically')
  }
}

// ——— fields:false — yesterday's file, exactly ————————————————————————————
{
  console.log('\nfields:false')
  const off = await run({ export: { page: 'a4', deflate: false, fields: false } })
  if (off.error) fail(`fields:false threw: ${off.error.message}`)
  else {
    const raw = latin(bytesOf(off))
    assert(!raw.includes('/AcroForm'), 'no /AcroForm written')
    const pdf = await pdfjs.getDocument({ data: bytesOf(off) }).promise
    let text = ''
    for (let p = 1; p <= pdf.numPages; p++) {
      const tc = await (await pdf.getPage(p)).getTextContent()
      text += tc.items.map(i => i.str || '').join(' ') + ' '
    }
    assert(text.includes('AdaLovelace'), 'value back in the invisible layer')
    assert(!text.includes('Sup3rSecretValue'), 'password still bullets, never the value')
    await pdf.destroy()
  }
}

// ——— page:'fit' keeps fields too ————————————————————————————————————————
{
  console.log("\npage:'fit'")
  const fit = await run({ export: { deflate: false } })
  if (fit.error) fail(`fit export threw: ${fit.error.message}`)
  else {
    const pdf = await pdfjs.getDocument({ data: bytesOf(fit) }).promise
    const fields = await pdf.getFieldObjects()
    assert(fields && Object.keys(fields).includes('fullname'), 'fit page carries fields')
    assert(pdf.numPages === 1, 'fit is one page')
    await pdf.destroy()
  }
}

// ——— embedded fonts and the earned UA claim ——————————————————————————————
{
  console.log('\nembedded fonts')
  const uaOpts = {
    capture: { exclude: ['.arial'] },
    export: { page: 'a4', fields: false, meta: META },
  }
  const ua = await run(uaOpts)
  if (ua.error) fail(`ua export threw: ${ua.error.message}`)
  else {
    const bytes = bytesOf(ua)
    const raw = latin(bytes)
    assert((ua.report.fontsEmbedded || []).length === 2,
      `two faces embedded (${JSON.stringify(ua.report.fontsEmbedded)})`)
    assert(ua.report.pdfua === true, 'report claims PDF/UA-1')
    assert(raw.includes('<pdfuaid:part>1</pdfuaid:part>'), 'XMP carries pdfuaid part 1')
    assert(raw.includes('/CIDToGIDMap /Identity'), 'CIDToGIDMap is Identity (CID = GID by construction)')

    // The XMP stream is a real UTF-8 packet: the required U+FEFF is EF BB BF,
    // not a Latin-1-truncated lone 0xFF that a strict validator would reject
    // inside the very stream carrying the UA claim.
    const mObj = raw.indexOf('/Subtype /XML')
    const sStart = raw.indexOf('stream\n', mObj) + 'stream\n'.length
    const sEnd = raw.indexOf('\nendstream', sStart)
    const xmp = bytes.subarray(sStart, sEnd)
    // The xpacket's U+FEFF (inside begin="…") is a proper UTF-8 EF BB BF, not a
    // Latin-1-truncated lone 0xFF.
    const hasBom = xmp.some((b, i) => b === 0xEF && xmp[i + 1] === 0xBB && xmp[i + 2] === 0xBF)
    assert(hasBom, 'XMP carries the U+FEFF as UTF-8 (EF BB BF)')
    assert(!xmp.includes(0xFF), 'no lone 0xFF anywhere in the XMP stream')
    let utf8ok = true
    try { new TextDecoder('utf-8', { fatal: true }).decode(xmp) } catch { utf8ok = false }
    assert(utf8ok, 'the XMP stream decodes as strict UTF-8')

    // Each FontFile2 is a SUBSET: much smaller than its source, re-parses to a
    // valid sfnt, its advances match the original font through the renumber, and
    // Chromium's OTS sanitizer accepts it via FontFace().
    const { sfntFromBytes, parseFont } = await import(new URL('../src/writer/font.js', import.meta.url))
    const sources = {
      Regular: parseFont((await sfntFromBytes(new Uint8Array(fs.readFileSync(new URL('../demo/fonts/Inter-400.ttf', import.meta.url))))).sfnt),
      Bold: parseFont((await sfntFromBytes(new Uint8Array(fs.readFileSync(new URL('../demo/fonts/Inter-700.ttf', import.meta.url))))).sfnt),
    }
    const streams = []
    const streamRe = /\/FontFile2 (\d+) 0 R/g
    for (let m; (m = streamRe.exec(raw));) streams.push(Number(m[1]))
    assert(streams.length === 2, `${streams.length} FontFile2 stream refs`)
    for (const id of streams) {
      const at = raw.indexOf(`\n${id} 0 obj\n`)
      const dictEnd = raw.indexOf('stream\n', at)
      const dict = raw.slice(at, dictEnd)
      const start = dictEnd + 'stream\n'.length
      const end = raw.indexOf('\nendstream', start)
      const body = bytes.subarray(start, end)
      const sfnt = zlib.inflateSync(body)
      const len1 = Number((/\/Length1 (\d+)/.exec(dict) || [])[1])
      assert(sfnt.length === len1, `object ${id}: /Length1 ${len1} == inflated ${sfnt.length}`)
      const sub = parseFont(new Uint8Array(sfnt))
      assert(!sub.error && sub.numGlyphs > 1 && sub.numGlyphs < 200,
        `object ${id}: subset re-parses to a small valid font (${sub.numGlyphs} glyphs)`)
      // Advance fidelity: the subset carries OS/2 through, so its weight names the
      // source; for each code point the subset maps, the advance must equal what
      // that exact weight gives — the renumber moved the id, never the metric.
      const orig = sub.weightClass >= 600 ? sources.Bold : sources.Regular
      let advMatch = true; let checked = 0
      for (const [cp, gid] of sub.cmap) {
        if (!orig.cmap.has(cp)) continue
        if (sub.advanceOf(gid) !== orig.advanceOf(orig.cmap.get(cp))) advMatch = false
        checked++
      }
      assert(advMatch && checked > 5,
        `object ${id}: every subset advance matches its source weight ${sub.weightClass} (${checked} glyphs)`)
      const otsOk = await page.evaluate(async (b64) => {
        const bin = atob(b64)
        const buf = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
        try {
          await new FontFace('OtsProbe', buf.buffer).load()
          return true
        } catch {
          return false
        }
      }, Buffer.from(sfnt).toString('base64'))
      assert(otsOk, `object ${id}: FontFace().load() — Chromium's OTS accepts the subset`)
    }

    // pdf.js parses every page's operators without a single font complaint.
    const grumbles = []
    const origWarn = console.warn
    console.warn = (...a) => grumbles.push(a.join(' '))
    const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise
    for (let p = 1; p <= pdf.numPages; p++) await (await pdf.getPage(p)).getOperatorList()
    console.warn = origWarn
    const fontGrumbles = grumbles.filter(g => /font/i.test(g))
    assert(fontGrumbles.length === 0, `pdf.js parses embedded fonts silently (${fontGrumbles[0] || 'clean'})`)

    // Extraction is invariant under embedding: same fixture, embedFonts:false.
    const textOf = async (data) => {
      const doc = await pdfjs.getDocument({ data }).promise
      let text = ''
      for (let p = 1; p <= doc.numPages; p++) {
        const tc = await (await doc.getPage(p)).getTextContent()
        text += tc.items.map(i => i.str || '').join(' ') + ' '
      }
      await doc.destroy()
      return text.replace(/\s+/g, ' ').trim()
    }
    const plain = await run({
      ...uaOpts, export: { ...uaOpts.export, embedFonts: false },
    })
    if (plain.error) fail(`embedFonts:false threw: ${plain.error.message}`)
    else {
      assert(plain.report.pdfua === false, 'embedFonts:false cannot claim UA')
      assert((plain.report.fontsEmbedded || []).length === 0, 'embedFonts:false embeds nothing')
      const t1 = await textOf(bytes.slice())
      const t2 = await textOf(bytesOf(plain))
      assert(t1 === t2 && t1.includes('SearchableClosingWord'),
        'extraction is byte-for-byte the same with and without embedding')
    }

    // The subset draws the SAME glyphs as embedding the whole file: render page 1
    // of both through pdf.js onto a real canvas IN THE BROWSER and compare. Any
    // renumber or outline error would move ink; a mean per-pixel delta near zero
    // proves it did not. Done in-page because that is where a canvas that rasters
    // glyphs actually lives.
    const whole = await run({ ...uaOpts, export: { ...uaOpts.export, embedFonts: 'full' } })
    if (whole.error) fail(`embedFonts:'full' threw: ${whole.error.message}`)
    else {
      assert((whole.report.fontsEmbedded || []).every(f => !f.subset),
        "embedFonts:'full' embeds whole faces, not subsets")
      const meanDelta = await page.evaluate(async ([subB64, wholeB64]) => {
        const pdfjsLib = await import('/node_modules/pdfjs-dist/build/pdf.mjs')
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs'
        const toBytes = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u }
        const raster = async (b64) => {
          const doc = await pdfjsLib.getDocument({ data: toBytes(b64) }).promise
          const pg = await doc.getPage(1)
          const vp = pg.getViewport({ scale: 1.5 })
          const canvas = new OffscreenCanvas(Math.ceil(vp.width), Math.ceil(vp.height))
          const ctx = canvas.getContext('2d')
          await pg.render({ canvasContext: ctx, viewport: vp }).promise
          const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data
          await doc.destroy()
          return px
        }
        const a = await raster(subB64)
        const b = await raster(wholeB64)
        if (a.length !== b.length) return -1
        let sum = 0
        for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
        return sum / a.length
      }, [ua.base64, whole.base64])
      assert(meanDelta >= 0 && meanDelta < 0.5,
        `subset renders identically to the whole font (mean pixel delta ${meanDelta.toFixed(4)})`)
    }
    await pdf.destroy()
  }
}

// ——— vector text: real glyphs, a tiny file, still searchable ——————————————
{
  console.log('\nvector text (image:false)')
  const vec = await run({
    capture: { exclude: ['.arial'] },
    export: { page: 'a4', fields: false, image: false, vectorText: true, deflate: false, meta: { title: 'Vector Report', author: 'Ada' } },
  })
  if (vec.error) fail(`vectorText export threw: ${vec.error.message}`)
  else {
    const bytes = bytesOf(vec)
    const raw = latin(bytes)
    assert(vec.report.vectorText > 20, `report counts ${vec.report.vectorText} vector-painted runs`)
    assert(bytes.length < 60000, `image-free vector PDF is tiny (${(bytes.length / 1024).toFixed(0)} kB)`)
    assert(!raw.includes('/Subtype /Image'), 'no page image XObject in an image:false export')
    // Real fill glyphs on the page: a Tr 0 text-showing op in an embedded face.
    assert(/BT 0 Tr \/E\d/.test(raw), 'text is painted (Tr 0) in an embedded face, not left invisible')
    assert(vec.report.pdfua === true, 'a fully vector-painted page still claims PDF/UA-1')

    // Text still extracts — painting did not cost searchability.
    const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise
    let text = ''
    for (let p = 1; p <= pdf.numPages; p++) {
      const tc = await (await pdf.getPage(p)).getTextContent()
      text += tc.items.map(i => i.str || '').join(' ') + ' '
    }
    assert(text.includes('MegaFormHeading') && text.includes('SearchableClosingWord'),
      'painted text is still selectable and searchable')
    await pdf.destroy()

    // The glyphs are really on the page: render page 1 and confirm ink is present
    // (an all-white page would mean the text never painted).
    const inkFraction = await page.evaluate(async (b64) => {
      const pdfjsLib = await import('/node_modules/pdfjs-dist/build/pdf.mjs')
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs'
      const bin = atob(b64); const u = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
      const doc = await pdfjsLib.getDocument({ data: u }).promise
      const pg = await doc.getPage(1)
      const vp = pg.getViewport({ scale: 1.5 })
      const canvas = new OffscreenCanvas(Math.ceil(vp.width), Math.ceil(vp.height))
      const ctx = canvas.getContext('2d')
      await pg.render({ canvasContext: ctx, viewport: vp }).promise
      const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let dark = 0
      for (let i = 0; i < px.length; i += 4) if (px[i] < 128) dark++
      await doc.destroy()
      return dark / (px.length / 4)
    }, vec.base64)
    assert(inkFraction > 0.002, `the page carries painted ink (${(inkFraction * 100).toFixed(2)}% dark pixels)`)

    // Letter-spacing must ride Tc, not Tz: a tracked heading painted as vector
    // carries the SAME ink weight as the raster, not the 15–31% fattening a
    // Tz-folded tracking would add. Inject 3px tracking and compare ink coverage
    // over the heading band, vector vs raster.
    await page.evaluate(() => { document.querySelector('#target h1').style.letterSpacing = '3px' })
    const ratio = await page.evaluate(async () => {
      const exp = (o) => window.__export({ capture: { exclude: ['.arial'] },
        export: { page: 'a4', fields: false, meta: { title: 'V' }, ...o } })
      const v = await exp({ image: false, vectorText: true })
      const r = await exp({ image: true, vectorText: false })
      const L = await import('/node_modules/pdfjs-dist/build/pdf.mjs')
      L.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs'
      const by = s => { const x = atob(s); const u = new Uint8Array(x.length); for (let i = 0; i < x.length; i++) u[i] = x.charCodeAt(i); return u }
      const ink = async (s) => {
        const d = await L.getDocument({ data: by(s) }).promise
        const pg = await d.getPage(1); const vp = pg.getViewport({ scale: 2 })
        const c = new OffscreenCanvas(Math.ceil(vp.width), Math.ceil(vp.height))
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height)
        await pg.render({ canvasContext: x, viewport: vp }).promise
        const px = x.getImageData(0, 0, c.width, c.height).data
        let dark = 0
        for (let y = 180; y < 360; y++) for (let xx = 0; xx < c.width; xx++) { if (px[(y * c.width + xx) * 4] < 100) dark++ }
        await d.destroy(); return dark
      }
      return (await ink(v.base64)) / (await ink(r.base64))
    })
    await page.evaluate(() => { document.querySelector('#target h1').style.letterSpacing = '' })
    assert(ratio > 0.9 && ratio < 1.1,
      `a letter-spaced heading paints at raster weight, not Tz-fattened (ink ratio ${ratio.toFixed(3)})`)
  }
}

// ——— the sfnt parser is hostile-input safe ———————————————————————————————
{
  console.log('\nsfnt parser hardening')
  const { parseFont } = await import(new URL('../src/writer/font.js', import.meta.url))
  const u16 = v => [(v >> 8) & 255, v & 255]
  const u32 = v => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]
  const put16 = (a, at, v) => { a[at] = (v >> 8) & 255; a[at + 1] = v & 255 }
  const puti16 = (a, at, v) => { v &= 0xffff; a[at] = (v >> 8) & 255; a[at + 1] = v & 255 }
  const put32 = (a, at, v) => { v >>>= 0; a[at] = (v >>> 24) & 255; a[at + 1] = (v >>> 16) & 255; a[at + 2] = (v >>> 8) & 255; a[at + 3] = v & 255 }
  // An sfnt whose only cmap is a format-12 with `groups` (each [start,end,gid]).
  // `truncate` drops the group bytes, so a big declared count maps out of bounds.
  const buildFmt12 = (groups, { declaredGroups, truncate = false } = {}) => {
    const head = new Array(54).fill(0); put16(head, 18, 1000)
    puti16(head, 36, -10); puti16(head, 38, -20); put16(head, 40, 1000); put16(head, 42, 900)
    const hhea = new Array(36).fill(0); puti16(hhea, 4, 800); puti16(hhea, 6, -200); put16(hhea, 34, 1)
    const hmtx = [...u16(500), ...u16(0)]
    const maxp = new Array(32).fill(0); put32(maxp, 0, 0x00010000); put16(maxp, 4, 10)
    const glyf = [0, 0, 0, 0]
    const n = declaredGroups ?? groups.length
    const fmt12 = [...u16(12), ...u16(0), ...u32(16 + groups.length * 12), ...u32(0), ...u32(n)]
    if (!truncate) for (const [s, e, g] of groups) fmt12.push(...u32(s), ...u32(e), ...u32(g))
    const cmap = [...u16(0), ...u16(1), ...u16(3), ...u16(10), ...u32(12), ...fmt12]
    const tables = [['head', head], ['hhea', hhea], ['hmtx', hmtx], ['maxp', maxp], ['glyf', glyf], ['cmap', cmap]]
    let offset = 12 + tables.length * 16
    const recs = tables.map(([tag, data]) => { const r = { tag, off: offset, len: data.length, data }; let p = data.length; while (p % 4) p++; offset += p; return r })
    const out = [...u32(0x00010000), ...u16(tables.length), ...u16(0), ...u16(0), ...u16(0)]
    for (const r of recs) { const t = r.tag.padEnd(4, ' '); out.push(t.charCodeAt(0), t.charCodeAt(1), t.charCodeAt(2), t.charCodeAt(3), ...u32(0), ...u32(r.off), ...u32(r.len)) }
    for (const r of recs) { out.push(...r.data); while (out.length % 4) out.push(0) }
    return new Uint8Array(out)
  }

  // A billion declared groups with no group bytes must not spin: bounded by
  // the file, it returns quickly with no cmap rather than iterating 1e9 times.
  const t0 = Date.now()
  const dos = parseFont(buildFmt12([], { declaredGroups: 0xffffffff, truncate: true }))
  const spent = Date.now() - t0
  assert(spent < 250, `format-12 with 4.3e9 declared groups returns in ${spent}ms, not minutes`)
  assert(!!dos.error, 'the malicious subtable yields an error, not a hang')

  // A legitimate format-12 still reads, and a glyph id past 0xFFFF — unreachable
  // through two-byte Identity-H CIDs — is dropped rather than written corrupt.
  const good = parseFont(buildFmt12([[0x41, 0x42, 3], [0x1f600, 0x1f600, 0x1ffff]]))
  assert(!good.error && good.cmap.get(0x41) === 3 && good.cmap.get(0x42) === 4,
    'a valid format-12 maps its groups (A->3, B->4)')
  assert(good.cmap.get(0x1f600) === undefined, 'a glyph id above 0xFFFF is dropped, not written past the CID width')
}

// ——— the subsetter preserves a monospaced tail glyph's side bearing ————————
{
  console.log('\nsubset monospaced-tail lsb')
  const { subsetTrueType } = await import(new URL('../src/writer/subset.js', import.meta.url))
  const u16 = v => [(v >> 8) & 255, v & 255]
  const u32 = v => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]
  const put16 = (a, at, v) => { a[at] = (v >> 8) & 255; a[at + 1] = v & 255 }
  const puti16 = (a, at, v) => { v &= 0xffff; a[at] = (v >> 8) & 255; a[at + 1] = v & 255 }
  const put32 = (a, at, v) => { v >>>= 0; a[at] = (v >>> 24) & 255; a[at + 1] = (v >>> 16) & 255; a[at + 2] = (v >>> 8) & 255; a[at + 3] = v & 255 }
  // numberOfHMetrics (4) < numGlyphs (6): glyphs 4,5 share the last advance and
  // keep their own lsb in the leftSideBearings[] array — 77 and 88 here.
  const head = new Array(54).fill(0); put16(head, 18, 1000); put16(head, 50, 1)
  puti16(head, 36, -10); puti16(head, 38, -20); put16(head, 40, 1000); put16(head, 42, 900)
  const hhea = new Array(36).fill(0); puti16(hhea, 4, 800); puti16(hhea, 6, -200); put16(hhea, 34, 4)
  const maxp = new Array(32).fill(0); put32(maxp, 0, 0x00010000); put16(maxp, 4, 6)
  const hmtx = []; for (let i = 0; i < 4; i++) hmtx.push(...u16(500), ...u16(10 + i))
  hmtx.push(...u16(77), ...u16(88))
  const loca = []; for (let i = 0; i <= 6; i++) loca.push(...u32(0))
  const cmap = [...u16(0), ...u16(1), ...u16(3), ...u16(1), ...u32(12),
    ...u16(4), ...u16(24), ...u16(0), ...u16(2), ...u16(2), ...u16(0), ...u16(0),
    ...u16(0xffff), ...u16(0), ...u16(0), ...u16(0xffff), ...u16(1), ...u16(0), ...u16(0)]
  const tables = [['head', head], ['hhea', hhea], ['hmtx', hmtx], ['maxp', maxp], ['glyf', []], ['loca', loca], ['cmap', cmap]]
  let off = 12 + tables.length * 16; const recs = []
  for (const [tag, d] of tables) { recs.push({ tag, off, len: d.length, d }); let p = d.length; while (p % 4) p++; off += p }
  const out = [...u32(0x00010000), ...u16(tables.length), ...u16(0), ...u16(0), ...u16(0)]
  for (const r of recs) { const t = r.tag.padEnd(4, ' '); out.push(t.charCodeAt(0), t.charCodeAt(1), t.charCodeAt(2), t.charCodeAt(3), ...u32(0), ...u32(r.off), ...u32(r.len)) }
  for (const r of recs) { out.push(...r.d); while (out.length % 4) out.push(0) }
  const sub = subsetTrueType(new Uint8Array(out), new Map([[0, 0], [4, 1], [5, 2]]), new Map())
  const dir = (b, tag) => { const n = (b[4] << 8) | b[5]; for (let i = 0; i < n; i++) { const a = 12 + i * 16; if (String.fromCharCode(b[a], b[a + 1], b[a + 2], b[a + 3]) === tag) return ((b[a + 8] << 24) | (b[a + 9] << 16) | (b[a + 10] << 8) | b[a + 11]) >>> 0 } }
  const h = dir(sub.sfnt, 'hmtx')
  const lsb1 = (sub.sfnt[h + 6] << 8) | sub.sfnt[h + 7]
  const lsb2 = (sub.sfnt[h + 10] << 8) | sub.sfnt[h + 11]
  assert(lsb1 === 77 && lsb2 === 88, `tail-glyph lsb survives subsetting (${lsb1}, ${lsb2}; want 77, 88)`)
}

// ——— abort ———————————————————————————————————————————————————————————————
{
  console.log('\nabort')
  const aborted = await run({ export: { page: 'a4' }, abort: true })
  assert(aborted.error?.name === 'AbortError', `pre-aborted signal rejects with AbortError (${aborted.error?.name})`)
}

// ——— forms:false capture-time ————————————————————————————————————————————
{
  console.log('\nforms:false (capture-time)')
  const off = await run({ plugin: { forms: false }, export: { page: 'a4', deflate: false } })
  if (off.error) fail(`forms:false threw: ${off.error.message}`)
  else {
    assert(!latin(bytesOf(off)).includes('/AcroForm'), 'nothing measured, nothing written')
  }
}

// An image nobody named has no /Alt to hand a screen reader, so a file that
// carries one cannot claim PDF/UA-1. `alt=""` is the author saying "decorative"
// and must not block; a real alternative must not block either.
{
  console.log('\nimages and the UA claim')
  const uaOpts = { capture: { exclude: ['.arial'] }, export: { page: 'a4', fields: false, meta: META } }
  const exportWithImage = async (alt) => {
    await page.evaluate(async (alt) => {
      const img = document.createElement('img')
      img.id = 'ua-image'
      img.width = 48
      img.height = 48
      img.src = 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#2e4bf0"/></svg>')
      if (alt !== null) img.setAttribute('alt', alt)
      document.getElementById('target').append(img)
      await img.decode()
    }, alt)
    try { return await run(uaOpts) } finally {
      await page.evaluate(() => document.getElementById('ua-image').remove())
    }
  }
  const withheld = (result) => (result.report?.warnings || []).map(w => w.message).find(m => /PDF\/UA-1 claim withheld/.test(m)) || ''

  const unnamed = await exportWithImage(null)
  if (unnamed.error) fail(`unnamed-image export threw: ${unnamed.error.message}`)
  else {
    assert(unnamed.report.pdfua === false, 'an image without alt text withholds the claim')
    assert(/image/.test(withheld(unnamed)), `the blocker names the image (${withheld(unnamed) || 'no blocker reported'})`)
    assert(!latin(bytesOf(unnamed)).includes('pdfuaid'), 'no pdfuaid identifier is written')
  }
  const decorative = await exportWithImage('')
  if (decorative.error) fail(`decorative-image export threw: ${decorative.error.message}`)
  else assert(decorative.report.pdfua === true, `alt="" is decorative and keeps the claim (${withheld(decorative) || 'claimed'})`)
  const named = await exportWithImage('A blue square')
  if (named.error) fail(`named-image export threw: ${named.error.message}`)
  else assert(named.report.pdfua === true, `an image with alt text keeps the claim (${withheld(named) || 'claimed'})`)
}

await browser.close()
server.close()

if (failures) {
  console.log(`\n${failures} FAILURE(S)`)
  process.exitCode = 1
} else {
  console.log('\nAll pdfmega assertions passed.')
}
