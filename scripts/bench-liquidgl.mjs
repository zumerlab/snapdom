// Three-way capture bench on liquidGL's own home page: their NaughtyDOM rasterizer vs the
// published snapdom v2.24.15 vs THIS checkout's v3 — svg engine only (no html-in-canvas,
// no flags needed). Run it on a real machine, not a container:
//
//   npm run compile && node scripts/bench-liquidgl.mjs
//
// It clones naughtyduk/liquidgl into .bench-liquidgl/ (once), downloads the published v2
// tarball via npm, serves the page locally (their CDN deps load from your network), and
// runs each arm in its OWN fresh browser (alternating arms in one browser measured 3-5x
// noise from shared caches/GC — isolated arms are the methodology). 1 warmup + 7 timed
// runs per arm, medians. HEADFUL=1 to watch it run.
import { execSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync, createReadStream, statSync } from 'node:fs'
import { join, resolve, extname } from 'node:path'
import { chromium } from 'playwright'

const ROOT = resolve(import.meta.dirname, '..')
const WORK = join(ROOT, '.bench-liquidgl')
const LGL = join(WORK, 'liquidgl')
mkdirSync(WORK, { recursive: true })

if (!existsSync(join(LGL, 'index.html'))) {
  console.log('clonando naughtyduk/liquidgl…')
  execSync(`git clone --depth 1 https://github.com/naughtyduk/liquidgl "${LGL}"`, { stdio: 'inherit' })
}

const V2_DIST = join(WORK, 'package/dist/snapdom.js')
if (!existsSync(V2_DIST)) {
  console.log('bajando @zumer/snapdom@2.24.15…')
  execSync('npm pack @zumer/snapdom@2.24.15', { cwd: WORK, stdio: 'inherit' })
  execSync('tar xzf zumer-snapdom-2.24.15.tgz package/dist/snapdom.js', { cwd: WORK })
}

const V3_DIST = join(ROOT, 'dist/snapdom.js')
if (!existsSync(V3_DIST)) {
  console.error('falta dist/snapdom.js — corré `npm run compile` primero')
  process.exit(1)
}

// Expose the private NaughtyDOM module so the bench can call rasteriseAsync directly.
const marker = 'return { measure, paint, paintChunked, rasterise, rasteriseAsync };\n  })();'
const lglSrc = readFileSync(join(LGL, 'scripts/liquidGL.js'), 'utf8')
if (!lglSrc.includes(marker)) {
  console.error('el marcador de NaughtyDOM cambió en liquidGL.js — actualizá este script')
  process.exit(1)
}
const naughtySrc = lglSrc.replace(marker, marker + '\n  window.NaughtyDOM = NaughtyDOM;')

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.gif': 'image/gif' }
const server = createServer((req, res) => {
  const p = join(LGL, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'))
  try {
    statSync(p)
    res.setHeader('content-type', MIME[extname(p)] || 'application/octet-stream')
    createReadStream(p).pipe(res)
  } catch { res.statusCode = 404; res.end() }
})
await new Promise((r) => server.listen(0, r))
const URL_ = `http://localhost:${server.address().port}/index.html`

const ARM_SRC = {
  naughty: naughtySrc,
  'v2.24.15': readFileSync(V2_DIST, 'utf8'),
  'v3 (este checkout)': readFileSync(V3_DIST, 'utf8'),
}

async function runArm (name) {
  const browser = await chromium.launch({ headless: !process.env.HEADFUL })
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  await page.goto(URL_, { waitUntil: 'load', timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(5000)
  // scroll-prime the ScrollTriggers, then freeze so every run captures the same frame
  await page.evaluate(async () => {
    const H = document.body.scrollHeight
    for (let y = 0; y <= H; y += 400) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 40)) }
    window.scrollTo(0, 0)
  })
  await page.waitForTimeout(1500)
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' })
  await page.evaluate(() => { for (const v of document.querySelectorAll('video')) { try { v.pause() } catch { /* ok */ } } })
  await page.addScriptTag({ content: ARM_SRC[name] })

  const r = await page.evaluate(async (arm) => {
    const body = document.body
    const w = Math.max(body.scrollWidth, document.documentElement.scrollWidth)
    const h = Math.max(body.scrollHeight, document.documentElement.scrollHeight)
    const ignore = (n) => (n.hasAttribute && (n.hasAttribute('data-liquid-ignore') || n.hasAttribute('data-liquidgl-hide'))) || (n.closest && !!n.closest('[data-liquid-ignore]'))
    const exclude = ['[data-liquid-ignore]', '[data-liquidgl-hide]']
    const times = []
    let size
    for (let i = 0; i < 8; i++) {
      const a = performance.now()
      const cv = arm === 'naughty'
        ? await window.NaughtyDOM.rasteriseAsync(body, { width: w, height: h, scale: 2, ignoreElements: ignore })
        : await window.snapdom.toCanvas(body, { scale: 2, dpr: 1, exclude })
      times.push(performance.now() - a)
      size = [cv.width, cv.height]
    }
    times.shift() // warmup out
    times.sort((x, y) => x - y)
    return { size, median: +times[Math.floor(times.length / 2)].toFixed(1), runs: times.map(t => +t.toFixed(0)) }
  }, name)
  await browser.close()
  return r
}

console.log(`\npágina: ${URL_} (viewport 1440x900, scale 2, brazos aislados, 1 warmup + 7 medidos)\n`)
const rows = []
for (const name of Object.keys(ARM_SRC)) {
  process.stdout.write(`corriendo ${name}… `)
  const r = await runArm(name)
  console.log(`${r.median} ms`)
  rows.push({ arm: name, salida: r.size.join('x'), 'mediana ms': r.median, corridas: r.runs.join(' ') })
}
console.log('')
console.table(rows)
server.close()
