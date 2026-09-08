/** Local consumer smoke against exact tarballs. No source aliases, CDN, or publishing. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox, webkit } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const options = {}
for (let i = 0; i < args.length; i += 2) {
  const key = args[i]
  if (!['--core', '--plugins', '--out'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--') || options[key]) {
    throw new Error('Usage: node scripts/smoke-packed-consumer.mjs --core CORE.tgz --plugins PLUGINS.tgz --out NEW_DIRECTORY')
  }
  options[key] = resolve(args[i + 1])
}
assert.ok(options['--core'] && options['--plugins'] && options['--out'], 'core, plugins and out are required')
assert.ok(!existsSync(options['--out']), 'output directory must not exist')
const out = options['--out']
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const artifacts = ['core', 'plugins'].map(role => {
  const path = options[`--${role}`]
  const bytes = readFileSync(path)
  return { role, path, bytes: bytes.length, sha256: hash(bytes) }
})
const work = mkdtempSync(join(tmpdir(), 'snapdom-consumer-smoke-'))
let server, browser
const report = { startedAt: new Date().toISOString(), scope: 'local installed-tarball consumer smoke; not external adoption', artifacts, browsers: [] }
mkdirSync(dirname(out), { recursive: true })
mkdirSync(out)

try {
  writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'snapdom-release-consumer', version: '1.0.0', private: true, type: 'module' }))
  execFileSync('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false',
    options['--core'], options['--plugins']], { cwd: work, stdio: 'pipe', timeout: 60000 })
  const installedCore = join(work, 'node_modules/@zumer/snapdom')
  const installedPlugins = join(work, 'node_modules/@zumer/snapdom-plugins')
  const corePackage = JSON.parse(readFileSync(join(installedCore, 'package.json')))
  const pluginsPackage = JSON.parse(readFileSync(join(installedPlugins, 'package.json')))
  assert.equal(corePackage.name, '@zumer/snapdom')
  assert.equal(pluginsPackage.name, '@zumer/snapdom-plugins')
  report.packages = { core: corePackage.version, plugins: pluginsPackage.version }
  const assets = new Map([
    ['/', ['<!doctype html><meta charset="utf-8"><title>Local packed SnapDOM consumer</title><script type="importmap">' +
      JSON.stringify({ imports: { '@zumer/snapdom': '/core.mjs', '@zumer/snapdom/plugins': '/core.mjs',
        '@zumer/snapdom-plugins': '/plugins/index.js', '@zumer/snapdom-plugins/': '/plugins/' } }) + '</script>', 'text/html']],
    ['/core.mjs', [readFileSync(join(installedCore, 'dist/snapdom.mjs')), 'text/javascript']],
    ['/snapdom.js', [readFileSync(join(installedCore, 'dist/snapdom.js')), 'text/javascript']],
    ['/fixtures/font.woff2', [readFileSync(join(root, '__tests__/fixtures/fonts/jbmono-400.woff2')), 'font/woff2']],
    ['/fixtures/tile.svg', ['<svg xmlns="http://www.w3.org/2000/svg" width="96" height="80"><path fill="#e00000" d="M0 0h48v80H0z"/><path fill="#00b000" d="M48 0h48v80H48z"/></svg>', 'image/svg+xml']],
  ])
  for (const name of readdirSync(installedPlugins).filter(name => name.endsWith('.js'))) {
    assets.set(`/plugins/${name}`, [readFileSync(join(installedPlugins, name)), 'text/javascript'])
  }
  server = createServer((req, res) => {
    const asset = assets.get(req.url)
    res.writeHead(asset ? 200 : 404, { 'content-type': asset?.[1] || 'text/plain', 'cache-control': 'no-store' })
    res.end(asset?.[0] || 'Not found')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`

  for (const engine of [chromium, firefox, webkit]) {
    browser = await engine.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 1 })
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    await page.goto(origin)
    await page.addScriptTag({ url: origin + '/snapdom.js' })
    const result = await page.evaluate(async expectedVersion => {
      const { snapdom } = await import('@zumer/snapdom')
      const { htmlExport, contextExport, agentMap, redactInputs } = await import('@zumer/snapdom-plugins')
      const checks = []
      const check = (condition, name) => { if (!condition) throw new Error(name); checks.push(name) }
      const mount = (id, html, css) => {
        const el = document.createElement('section')
        el.id = id; el.innerHTML = html; el.style.cssText = css
        document.body.appendChild(el)
        return el
      }
      const rawText = async result => decodeURIComponent((await result.toRaw()).split(',').slice(1).join(','))
      const pixel = (canvas, x, y) => Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data)
      const base = { dpr: 1, scale: 1, embedFonts: false }
      check(snapdom.version === expectedVersion && window.snapdom.version === expectedVersion, 'ESM and script-tag resolve the installed core version')

      const simple = mount('simple', '<h2 style="margin:0">Export receipt</h2><p>Order 1042</p>',
        'width:320px;height:160px;background:rgb(0,80,180);color:white;padding:20px;box-sizing:border-box;font:16px Arial')
      const simpleResult = await window.snapdom(simple, base)
      const simpleCanvas = await simpleResult.toCanvas()
      const simpleImage = await simpleResult.toPng()
      const simpleBlob = await simpleResult.toBlob({ format: 'png' })
      check(simpleCanvas.width === 320 && simpleCanvas.height === 160, 'simple script-tag canvas dimensions')
      check(simpleImage.naturalWidth === 320 && simpleImage.naturalHeight === 160 && simpleBlob.size > 0, 'simple PNG and Blob decode')
      check(pixel(simpleCanvas, 300, 140)[2] > 150, 'simple output paints its background')

      const style = document.createElement('style')
      style.textContent = '@font-face{font-family:ReleaseDashboard;src:url(/fixtures/font.woff2);font-weight:400}'
      document.head.appendChild(style)
      const dashboard = mount('dashboard', '<h2 style="margin:0;font-weight:400">Daily dashboard</h2><p>Revenue 1240</p>' +
        '<img src="/fixtures/tile.svg" style="position:absolute;left:360px;top:24px;width:96px;height:80px">',
        'position:relative;width:480px;height:200px;background:white;color:#17244f;font:20px ReleaseDashboard;padding:24px;box-sizing:border-box')
      await document.fonts.load('20px ReleaseDashboard')
      await dashboard.querySelector('img').decode()
      const dashboardResult = await snapdom(dashboard, { ...base, embedFonts: true })
      const dashboardRaw = await rawText(dashboardResult)
      const dashboardCanvas = await dashboardResult.toCanvas()
      check(/data:(?:font|application)\//.test(dashboardRaw) && dashboardRaw.includes('@font-face'), 'dashboard local webfont embedded')
      check(!dashboardRaw.includes('src="/fixtures/tile.svg"'), 'dashboard image resource inlined')
      check(pixel(dashboardCanvas, 380, 40)[0] > 180 && pixel(dashboardCanvas, 430, 40)[1] > 120, 'dashboard exported image paints both colored halves')
      check(dashboardCanvas.width === 480 && dashboardCanvas.height === 200, 'dashboard dimensions preserved')

      const privateFixture = mount('plugins', '<h2 style="margin:0">Public order</h2><div class="private">PRIVATE_RELEASE_TOKEN</div>' +
        '<input type="email" value="secret-release@example.test"><button>Public action</button>',
        'width:420px;height:150px;background:white;color:#17244f;font:16px Arial')
      let hidePrivate = false
      const settings = { ...base, exclude: el => hidePrivate && el.classList.contains('private'),
        plugins: [htmlExport(), contextExport(), agentMap({ image: false, fields: 'full' }), redactInputs()] }
      const before = await snapdom(privateFixture, settings)
      const beforeHtml = await before.toHtml()
      hidePrivate = true
      const after = await snapdom(privateFixture, settings)
      const afterSvg = await rawText(after)
      const afterHtml = await after.toHtml()
      const semantic = JSON.stringify({ context: await after.toContext(), map: await after.toAgentMap() })
      check(beforeHtml.includes('PRIVATE_RELEASE_TOKEN'), 'plugins initial export contains allowed subtree')
      check([afterSvg, afterHtml, semantic].every(text => !text.includes('PRIVATE_RELEASE_TOKEN') && !text.includes('secret-release@example.test')), 'plugins re-evaluate callback exclusion and redact fields in SVG HTML and semantics')
      check([afterSvg, afterHtml, semantic].every(text => text.includes('Public action')), 'plugins retain public content')
      check((await before.toHtml()) === beforeHtml, 'plugins earlier HTML result stays frozen')
      check(privateFixture.querySelector('.private').textContent === 'PRIVATE_RELEASE_TOKEN' && privateFixture.querySelector('input').value === 'secret-release@example.test', 'plugins leave source DOM and values intact')
      const mixed = mount('mixed', '<div class="exclude-only" style="height:30px">EXCLUDE_ONLY_SECRET</div>' +
        '<div class="filter-only" style="height:30px">FILTER_ONLY_SECRET</div>' +
        '<div class="overlap" style="height:30px">OVERLAP_SECRET</div>' +
        '<button style="display:block;width:420px;height:30px;padding:0;border:0;background:rgb(0,180,0)">Visible control</button>',
        'width:420px;background:white;color:#17244f;font:16px Arial')
      let excludedFilterCalls = 0
      const mixedResult = await snapdom(mixed, { ...base,
        exclude: ['.exclude-only', '.overlap'], excludeMode: 'hide', filterMode: 'remove',
        filter: el => {
          if (el.matches('.exclude-only,.overlap')) excludedFilterCalls++
          return !el.matches('.filter-only,.overlap')
        },
        plugins: [htmlExport(), contextExport(), agentMap({ image: false, fields: 'full' })],
      })
      const mixedOutputs = [await rawText(mixedResult), await mixedResult.toHtml(),
        JSON.stringify({ context: await mixedResult.toContext(), map: await mixedResult.toAgentMap() })]
      check(mixedOutputs.every(text => ['EXCLUDE_ONLY_SECRET', 'FILTER_ONLY_SECRET', 'OVERLAP_SECRET'].every(secret => !text.includes(secret))), 'independent filter and exclude omit both groups from SVG HTML and semantics')
      check(mixedOutputs.every(text => text.includes('Visible control')), 'independent filter and exclude retain public content')
      check(excludedFilterCalls === 0, 'exclude wins overlap before filter is called')
      const mixedCanvas = await mixedResult.toCanvas()
      let greenY = -1
      for (let y = 0; y < mixedCanvas.height; y++) {
        const color = pixel(mixedCanvas, 400, y)
        if (color[0] < 40 && color[1] > 140 && color[1] < 220 && color[2] < 40) { greenY = y; break }
      }
      check(mixed.offsetHeight === 120 && greenY === 60, 'exclude hide preserves space while filter remove moves the public marker up by its own 30px')
      return { checks, userAgent: navigator.userAgent, images: { simple: simpleCanvas.toDataURL(), dashboard: dashboardCanvas.toDataURL(), plugins: (await after.toCanvas()).toDataURL(), mixed: mixedCanvas.toDataURL() } }
    }, corePackage.version)
    for (const [name, url] of Object.entries(result.images)) {
      writeFileSync(join(out, `${engine.name()}-${name}-snapdom.png`), Buffer.from(url.split(',')[1], 'base64'))
      await page.locator(`#${name}`).screenshot({ path: join(out, `${engine.name()}-${name}-native.png`) })
    }
    report.browsers.push({ engine: engine.name(), version: browser.version(), userAgent: result.userAgent, checks: result.checks })
    console.log(`${engine.name()} ${browser.version()}: ${result.checks.length} consumer checks passed`)
    await browser.close(); browser = null
  }
  report.success = true
} catch (error) {
  report.success = false
  report.error = error.stack || String(error)
  throw error
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  rmSync(work, { recursive: true, force: true })
  report.finishedAt = new Date().toISOString()
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
}
