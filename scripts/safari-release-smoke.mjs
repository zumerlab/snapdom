// Real Safari smoke test. Start `safaridriver -p 4447` with Remote Automation enabled,
// build with `npm run compile`, then run `node scripts/safari-release-smoke.mjs`.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'

const endpoint = process.env.SAFARI_WEBDRIVER_URL || 'http://127.0.0.1:4447'
const bundle = await readFile(new URL('../dist/snapdom.mjs', import.meta.url))
const font = await readFile(new URL('../__tests__/fixtures/fonts/jbmono-400.woff2', import.meta.url))
const server = createServer((req, res) => {
  const asset = req.url === '/snapdom.mjs' ? [bundle, 'text/javascript']
    : req.url === '/font.woff2' ? [font, 'font/woff2']
      : req.url === '/' ? ['<!doctype html><meta charset="utf-8"><title>SnapDOM Safari release check</title>', 'text/html'] : null
  res.writeHead(asset ? 200 : 404, { 'content-type': asset?.[1] || 'text/plain' })
  res.end(asset?.[0] || 'Not found')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

async function request(path, method = 'GET', body) {
  const response = await fetch(endpoint + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  })
  const { value } = await response.json()
  if (!response.ok || value?.error) throw new Error(value?.message || response.statusText)
  return value
}

// Passed directly to WebDriver, so this function executes in Safari against the built ESM.
async function smoke() {
  const { snapdom } = await import('/snapdom.mjs')
  const results = []
  const check = (condition, name, details = {}) => {
    if (!condition) throw new Error(name + ': ' + JSON.stringify(details))
    results.push({ name, ...details })
  }
  const mount = (html, css) => {
    const node = document.createElement('div')
    node.style.cssText = css || 'width:240px;height:100px;background:rgb(0,0,255)'
    node.innerHTML = html
    document.body.append(node)
    return node
  }
  const colorShare = (canvas, red, green, blue) => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let count = 0
    for (let i = 0; i < pixels.length; i += 4) {
      if (Math.abs(pixels[i] - red) < 25 && Math.abs(pixels[i + 1] - green) < 25 &&
          Math.abs(pixels[i + 2] - blue) < 25 && pixels[i + 3] > 230) count++
    }
    return count / (pixels.length / 4)
  }
  const options = { dpr: 1, scale: 1, embedFonts: false }
  const box = mount('')
  for (let i = 0; i < 5; i++) {
    const canvas = await snapdom.toCanvas(box, { ...options, invalidate: true })
    check(colorShare(canvas, 0, 0, 255) > 0.99, `fresh solid capture ${i + 1}`)
  }
  const media = document.createElement('canvas')
  media.width = 240; media.height = 100
  box.replaceChildren(media)
  for (const [name, color] of [['red', [255, 0, 0]], ['green', [0, 255, 0]], ['blue', [0, 0, 255]]]) {
    const context = media.getContext('2d')
    context.fillStyle = `rgb(${color.join(',')})`
    context.fillRect(0, 0, 240, 100)
    check(colorShare(await snapdom.toCanvas(media, options), ...color) > 0.99, `canvas freshness ${name}`)
  }
  const thin = mount('', 'width:100px;height:1px;background:blue')
  const result = await snapdom(thin, options)
  for (const method of ['toPng', 'toSvg']) {
    const image = await result[method]({ scale: 0.1 })
    check(image.naturalWidth > 0 && image.naturalHeight > 0, `thin ${method}`)
  }
  const blob = await result.toBlob({ scale: 0.1, format: 'png' })
  check(blob instanceof Blob && blob.size > 0, 'thin PNG blob')
  const tall = mount('', 'width:400px;height:3000px;background:rgb(0,0,255)')
  const tallCanvas = await snapdom.toCanvas(tall, options)
  check(tallCanvas.width === 400 && tallCanvas.height === 3000 && colorShare(tallCanvas, 0, 0, 255) > 0.99, 'large raster dimensions and pixels')
  const sheet = document.createElement('style')
  sheet.textContent = '@font-face{font-family:SafariReview;src:url(/font.woff2)}'
  document.head.append(sheet)
  const host = mount('', 'width:360px;height:70px;background:white;color:black')
  host.attachShadow({ mode: 'open' }).innerHTML = '<span style="font:32px SafariReview">Shadow fonts 123</span>'
  await document.fonts.load('32px SafariReview')
  const shadowResult = await snapdom(host, { ...options, embedFonts: 'auto' })
  const svg = decodeURIComponent((await shadowResult.toRaw()).split(',').slice(1).join(','))
  check(svg.includes('@font-face') && /data:(font|application)\//.test(svg), 'shadow font embedded')
  const shadowCanvas = await shadowResult.toCanvas()
  check(colorShare(shadowCanvas, 255, 255, 255) < 0.99, 'shadow text paints on first export')
  const mixed = await snapdom.fromString('Before <strong>inside</strong> after', options)
  const mixedRaw = decodeURIComponent((await mixed.toRaw()).split(',').slice(1).join(','))
  check(['Before', 'inside', 'after'].every(text => mixedRaw.includes(text)), 'mixed fragment text retained')
  return { version: snapdom.version, userAgent: navigator.userAgent, checks: results }
}

let session
try {
  const created = await request('/session', 'POST', { capabilities: { alwaysMatch: { browserName: 'safari' } } })
  session = created.sessionId
  await request(`/session/${session}/timeouts`, 'POST', { script: 180000 })
  await request(`/session/${session}/url`, 'POST', { url: `http://127.0.0.1:${server.address().port}/` })
  const report = await request(`/session/${session}/execute/async`, 'POST', {
    script: `const done = arguments[arguments.length - 1]; (${smoke.toString()})().then(done, e => done({ error: e.stack || String(e) }));`,
    args: [],
  })
  assert.ok(!report.error, report.error)
  console.log(JSON.stringify(report, null, 2))
} finally {
  if (session) await request(`/session/${session}`, 'DELETE').catch(() => {})
  await new Promise(resolve => server.close(resolve))
}
