/**
 * Native MathML regression checks through the source engine and public plugin.
 * Run: node test/verify-mathml.mjs [--browser=chromium|firefox|webkit] [--only=matrix]
 *
 * Math structure, content and absence of raster fallback are assertions. Native
 * screenshots and rendered SVGs are retained for visual review; pixel differences
 * are observations, never promoted to mathematical correctness or a new baseline.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { chromium, firefox, webkit } from 'playwright'
import { serve, snapdomBuildProblem, ENGINES } from './serve.mjs'
import { instrument, openFixture, check, near, setFixture, results, report } from './harness.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const options = { browser: 'chromium', only: '' }
for (const argument of process.argv.slice(2)) {
  const matched = /^--(browser|only)=(.*)$/.exec(argument)
  if (!matched) throw new Error(`Unknown argument: ${argument}`)
  options[matched[1]] = matched[2]
}
const engines = { chromium, firefox, webkit }
if (!engines[options.browser]) throw new Error(`Unknown browser: ${options.browser}`)
const buildProblem = snapdomBuildProblem('v3')
if (buildProblem) throw new Error(buildProblem)
const out = path.join(root, 'out', 'mathml', options.browser)
await fs.mkdir(out, { recursive: true })
const provenance = {
  capturedAt: new Date().toISOString(), browser: options.browser, engine: ENGINES.v3.dir,
  pixelPolicy: 'Native browser screenshot versus actual public SVG at intrinsic size. No resampling, acceptance threshold or baseline update.',
  cases: [],
}
const server = await serve(0)
let browser
try {
  browser = await engines[options.browser].launch()
  provenance.browserVersion = browser.version()
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1 })
  page.setDefaultTimeout(60000)
  const { errors } = instrument(page)
  await openFixture(page, `http://localhost:${server.port}/test/fixtures/mathml.html`)
  const cases = (await page.evaluate(() => window.mathmlCases)).filter(item => !options.only || item.id.includes(options.only))
  if (!cases.length) throw new Error(`No cases match ${options.only}`)
  for (const fixture of cases) {
    setFixture(fixture.id)
    const errorStart = errors.length
    const dir = path.join(out, fixture.id)
    await fs.mkdir(dir, { recursive: true })
    console.log(`\n── native MathML: ${fixture.id} (${options.browser})`)
    try {
      const selector = await page.evaluate(id => window.showMathmlCase(id), fixture.id)
      const live = await page.locator(selector).screenshot({ path: path.join(dir, 'live.png') })
      const captured = await page.evaluate(async ({ selector, fixture, reference }) => {
        const [{ snapdom }, { vector }, publicPlugin, { validate }] = await Promise.all([
          import('@zumer/snapdom'), import('@zumer/snapdom-vector'),
          import('/src/public.js'), import('@zumer/svd'),
        ])
        const target = document.querySelector(selector)
        const rootBox = target.getBoundingClientRect()
        const localBox = element => {
          const rect = element.getBoundingClientRect()
          return { x: rect.left - rootBox.left, y: rect.top - rootBox.top, width: rect.width, height: rect.height }
        }
        const source = {
          box: { width: rootBox.width, height: rootBox.height },
          tokens: [...target.querySelectorAll('[data-token]')].map(element => ({ id: element.dataset.token, text: element.textContent, box: localBox(element), font: getComputedStyle(element).fontFamily, size: parseFloat(getComputedStyle(element).fontSize), color: getComputedStyle(element).color, textTransform: getComputedStyle(element).textTransform, mathvariant: element.getAttribute('mathvariant') })),
          rules: [...target.querySelectorAll('[data-rule]')].map(element => ({ id: element.dataset.rule, box: localBox(element), numerator: localBox(element.children[0]), denominator: localBox(element.children[1]) })),
          radicals: [...target.querySelectorAll('[data-radical]')].map(element => ({ id: element.dataset.radical, box: localBox(element) })),
          stretch: [...target.querySelectorAll('[data-stretch]')].map(element => ({ id: element.dataset.stretch, text: element.textContent, box: localBox(element) })),
        }
        const before = { html: target.outerHTML, head: document.head.innerHTML, bodyChildren: document.body.children.length, nodes: [...target.querySelectorAll('*')] }
        const engineCapture = await snapdom(target, { plugins: [vector({ silent: true, exclude: fixture.exclude })], scale: 1, dpr: 1, backgroundColor: '#fff' })
        const svd = await engineCapture.toVector()
        const publicCapture = await snapdom(target, { plugins: [publicPlugin.vector({ exclude: fixture.exclude })], scale: 1, dpr: 1, backgroundColor: '#fff' })
        const svg = await publicCapture.toVector()
        // Repeated exports exercise the clone mount's finally path and caches.
        await publicCapture.toVector()
        await publicCapture.toVector()
        const afterNodes = [...target.querySelectorAll('*')]
        const untouched = {
          targetMarkup: before.html === target.outerHTML,
          targetNodes: before.nodes.length === afterNodes.length && before.nodes.every((node, index) => node === afterNodes[index]),
          headMarkup: before.head === document.head.innerHTML,
          bodyChildren: before.bodyChildren === document.body.children.length,
          mounts: document.querySelectorAll('[data-snapdom-vector]').length,
        }
        const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
        const xmlError = parsed.querySelector('parsererror')?.textContent || null
        const normalized = value => value.normalize('NFKC').replace(/[\s\u200b-\u200f\u2060-\u2064\ufeff]/gu, '')
        const nativeText = [...parsed.querySelectorAll('text')].map(element => element.textContent).join('')
        const counts = { text: parsed.querySelectorAll('text').length, image: parsed.querySelectorAll('image').length, foreignObject: parsed.querySelectorAll('foreignObject').length }
        // Inspect emitted SVG geometry in a shadow tree so its styles cannot leak
        // into the source. Positions are SVG-root-relative, not screenshot guesses.
        const holder = document.createElement('div')
        holder.style.cssText = 'position:fixed;left:-10000px;top:-10000px;pointer-events:none'
        const shadow = holder.attachShadow({ mode: 'open' })
        const mounted = document.importNode(parsed.documentElement, true)
        shadow.append(mounted)
        document.body.append(holder)
        let svgTokens, geometry
        try {
          await document.fonts.ready
          const rect = mounted.getBoundingClientRect()
          const boxOf = element => {
            const box = element.getBoundingClientRect()
            return { x: box.left - rect.left, y: box.top - rect.top, width: box.width, height: box.height }
          }
          const textElements = [...mounted.querySelectorAll('text')]
          svgTokens = source.tokens.concat(source.stretch).map(token => {
            const candidates = textElements.filter(element => normalized(element.textContent) === normalized(token.text))
            return { id: token.id, source: token, matches: candidates.map(element => ({ text: element.textContent, box: boxOf(element), style: { family: getComputedStyle(element).fontFamily, size: parseFloat(getComputedStyle(element).fontSize), fill: getComputedStyle(element).fill, italic: getComputedStyle(element).fontStyle, weight: getComputedStyle(element).fontWeight } })) }
          })
          geometry = [...mounted.querySelectorAll('path,line,polyline,polygon,rect')].filter(element => !element.closest('defs')).map(element => ({ tag: element.localName, box: boxOf(element), fill: getComputedStyle(element).fill, stroke: getComputedStyle(element).stroke })).filter(item => item.fill !== 'none' || item.stroke !== 'none')
        } finally { holder.remove() }
        const rasterize = async src => {
          const image = new Image(); image.src = src
          await image.decode()
          const canvas = document.createElement('canvas')
          canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
          const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0)
          return { canvas, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data }
        }
        const live = await rasterize(reference)
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
        let rendered
        try { rendered = await rasterize(url) } finally { URL.revokeObjectURL(url) }
        const dimensions = { source: [live.canvas.width, live.canvas.height], svg: [rendered.canvas.width, rendered.canvas.height] }
        const comparable = dimensions.source.every((value, index) => value === dimensions.svg[index])
        let metrics = { comparable, dimensions }
        if (comparable) {
          let total = 0, over32 = 0
          for (let offset = 0; offset < live.pixels.length; offset += 4) {
            const delta = Math.max(...[0, 1, 2].map(channel => Math.abs(live.pixels[offset + channel] - rendered.pixels[offset + channel])))
            total += delta; if (delta > 32) over32++
          }
          metrics = { ...metrics, meanMaxChannelDelta: total / (live.pixels.length / 4), percentPixelsOver32: 100 * over32 / (live.pixels.length / 4) }
        }
        return { svg, svd, source, untouched, validation: validate(svd), xmlError, nativeText, counts, geometry, svgTokens, metrics, intentionalReferenceDifference: fixture.exclude ? `Vector excludes ${fixture.exclude}; the live reference intentionally includes that content.` : null, png: rendered.canvas.toDataURL('image/png') }
      }, { selector, fixture, reference: `data:image/png;base64,${live.toString('base64')}` })
      const { svg, svd, png, ...measurement } = captured
      const normalized = value => value.normalize('NFKC').replace(/[\s\u200b-\u200f\u2060-\u2064\ufeff]/gu, '')
      const characterCounts = value => [...normalized(value)].sort().join('')
      check('SVD validates', captured.validation.ok, captured.validation.errors.join(' | '))
      check('public SVG is well-formed XML', !captured.xmlError, captured.xmlError || '')
      check('all visible mathematical characters occur exactly once as authored', characterCounts(captured.nativeText) === characterCounts(fixture.expected), `expected ${normalized(fixture.expected)}; found ${normalized(captured.nativeText)}`)
      check('math is emitted as native SVG text', captured.counts.text > 0, `${captured.counts.text} text elements`)
      check('no SVG raster image or foreignObject fallback', captured.counts.image === 0 && captured.counts.foreignObject === 0, JSON.stringify(captured.counts))
      check('no SVD raster fallback', Object.values(svd.nodes).every(node => node.type !== 'image' && !['R', 'RH'].includes(node.fidelity?.grade)))
      check('source markup, node identities and head styles survive repeated exports', captured.untouched.targetMarkup && captured.untouched.targetNodes && captured.untouched.headMarkup, JSON.stringify(captured.untouched))
      check('repeated public exports leave no mounted clone', captured.untouched.mounts === 0 && captured.untouched.bodyChildren, JSON.stringify(captured.untouched))
      near('capture width equals live source', svd.capture.root.w, captured.source.box.width, 0.01, 'px')
      near('capture height equals live source', svd.capture.root.h, captured.source.box.height, 0.01, 'px')
      check('public SVG has the same intrinsic pixel dimensions', captured.metrics.comparable, JSON.stringify(captured.metrics.dimensions))
      const nonBackgroundGeometry = captured.geometry.filter(item => item.tag !== 'rect' || item.box.height < 10)
      if (fixture.minimumGeometry) check('fraction and radical geometry is present', nonBackgroundGeometry.length >= fixture.minimumGeometry, `${nonBackgroundGeometry.length} primitives, at least ${fixture.minimumGeometry} required`)
      for (const rule of captured.source.rules) {
        const hits = captured.geometry.filter(item => {
          const box = item.box, middle = box.y + box.height / 2
          return box.height <= 4 && box.width >= rule.box.width / 2 && box.x >= rule.box.x - 4 && box.x + box.width <= rule.box.x + rule.box.width + 4 && middle >= rule.numerator.y + rule.numerator.height - 4 && middle <= rule.denominator.y + 4
        })
        check(`fraction ${rule.id} has a horizontal vector rule between numerator and denominator`, hits.length > 0, `source ${JSON.stringify(rule)}; rules ${JSON.stringify(captured.geometry.filter(item => item.box.height <= 4))}`)
      }
      for (const radical of captured.source.radicals) {
        const hits = nonBackgroundGeometry.filter(item => item.tag === 'path' && item.box.width >= radical.box.width / 2 && item.box.height >= radical.box.height / 2 && item.box.x >= radical.box.x - 4 && item.box.x <= radical.box.x + radical.box.width / 2 && item.box.y <= radical.box.y + radical.box.height / 2)
        check(`radical ${radical.id} has vector hook/bar geometry in its live region`, hits.length > 0, `source ${JSON.stringify(radical.box)}`)
      }
      const token = id => captured.svgTokens.find(item => item.id === id)?.matches[0]
      for (const [a, b] of fixture.above || []) {
        const one = token(a), two = token(b)
        check(`${a} stays above ${b}`, one && two && one.box.y + one.box.height / 2 < two.box.y + two.box.height / 2, JSON.stringify({ [a]: one?.box, [b]: two?.box }))
      }
      for (const [a, b] of fixture.leftOf || []) {
        const one = token(a), two = token(b)
        check(`${a} stays left of ${b}`, one && two && one.box.x + one.box.width / 2 < two.box.x + two.box.width / 2, JSON.stringify({ [a]: one?.box, [b]: two?.box }))
      }
      for (const stretched of captured.source.stretch) {
        const actual = token(stretched.id)
        check(`delimiter ${stretched.id} remains stretched to the live operator height`, actual && actual.box.height >= stretched.box.height - 4, `live ${stretched.box.height}px; SVG ${actual?.box.height}px`)
      }
      if (fixture.forbidden) {
        check('phantom, hidden and annotation payloads are not painted', fixture.forbidden.every(value => !captured.nativeText.includes(value)), captured.nativeText)
        check('unpainted semantic annotations do not receive unsupported-element diagnostics', !(svd.diagnostics || []).some(item => item.code === 'collect.mathml-unsupported'))
      }
      if (fixture.fontStyle) {
        const styled = token('styled'), green = token('green')
        check('MathML mtext preserves its declared family, weight and italic style', styled && /Courier New/i.test(styled.style.family) && Number(styled.style.weight) >= 700 && styled.style.italic === 'italic', JSON.stringify(styled?.style))
        near('MathML mtext preserves its declared font size', styled?.style.size, 24, 0.1, 'px')
        check('MathML token colors survive independently', styled?.style.fill === 'rgb(156, 36, 102)' && green?.style.fill === 'rgb(25, 112, 64)', JSON.stringify({ styled: styled?.style, green: green?.style }))
      }
      if (fixture.webfont) {
        const fonts = Object.values(svd.assets).filter(asset => asset.kind === 'font')
        check('a font used only inside MathML is embedded into SVD and standalone SVG', fonts.length > 0 && /@font-face/.test(svg) && /MathFixture/.test(svg), `${fonts.length} embedded font asset(s)`)
        check('MathML text keeps its webfont family', /MathFixture/.test(token('local-font')?.style.family || ''), JSON.stringify(token('local-font')?.style))
      }
      if (fixture.glyphPolicy) {
        const automatic = captured.source.tokens.find(item => item.id === 'default-identifier')
        if (automatic.textTransform === 'math-auto') check('computed math-auto selects the mathematical italic identifier glyph', token('default-identifier')?.text === '𝑥', token('default-identifier')?.text)
        check('mathvariant normal retains the upright identifier codepoint', token('normal-identifier')?.text === 'y', token('normal-identifier')?.text)
        if (options.browser === 'chromium') check('explicit text-transform none retains its authored identifier codepoint', token('untransformed-identifier')?.text === 'z', token('untransformed-identifier')?.text)
      }
      for (const id of fixture.positionTokens || []) {
        const actual = token(id), expected = captured.source.tokens.find(item => item.id === id)
        near(`transformed token ${id} retains its horizontal visual center`, actual?.box.x + actual?.box.width / 2, expected.box.x + expected.box.width / 2, 3, 'px')
      }
      const unsupported = (svd.diagnostics || []).filter(item => item.code === 'collect.mathml-unsupported')
      if (fixture.unsupported) check('unsupported visible MathML is declared with an omission diagnostic', unsupported.some(item => item.grade === 'O' || svd.nodes[item.node]?.fidelity?.grade === 'O'), JSON.stringify(unsupported))
      else check('supported MathML does not silently use an omission diagnostic', !unsupported.length, JSON.stringify(unsupported))
      await Promise.all([
        fs.writeFile(path.join(dir, 'vector.svg'), svg),
        fs.writeFile(path.join(dir, 'vector.png'), Buffer.from(png.split(',')[1], 'base64')),
        fs.writeFile(path.join(dir, 'document.svd.json'), JSON.stringify(svd, null, 2) + '\n'),
        fs.writeFile(path.join(dir, 'report.json'), JSON.stringify(measurement, null, 2) + '\n'),
      ])
      provenance.cases.push({ id: fixture.id, metrics: captured.metrics, diagnostics: svd.diagnostics, svgSha256: createHash('sha256').update(svg).digest('hex') })
    } catch (error) { check('capture and inspect fixture', false, error.stack || String(error)) }
    check('fixture raises no page error', errors.length === errorStart, errors.slice(errorStart).join(' | '))
  }
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
const summary = report(results, { scope: `${provenance.cases.length} native MathML fixtures in ${options.browser}` })
await fs.writeFile(path.join(out, 'summary.json'), JSON.stringify({ ...provenance, checks: summary }, null, 2) + '\n')
