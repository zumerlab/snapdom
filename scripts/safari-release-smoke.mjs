// Real Safari smoke test. Start `safaridriver -p 4447` with Remote Automation enabled,
// build with `npm run compile`, then run `node scripts/safari-release-smoke.mjs`.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'

const endpoint = process.env.SAFARI_WEBDRIVER_URL || 'http://127.0.0.1:4447'
const bundle = await readFile(new URL('../dist/snapdom.mjs', import.meta.url))
const font = await readFile(new URL('../__tests__/fixtures/fonts/jbmono-400.woff2', import.meta.url))
// Serve only these plugin entrypoints and their fixed local dependencies. Request paths
// never become filesystem paths, so the smoke server cannot expose the checkout.
const pluginModules = new Map(await Promise.all([
  'redact-inputs.js', 'redact-clone.js', 'privacy-policy.js',
  'agent-map.js', 'context-export.js', 'html-export.js',
].map(async name => [`/plugins/${name}`, await readFile(new URL(`../packages/plugins/${name}`, import.meta.url))])))
const server = createServer((req, res) => {
  if (req.url.startsWith('/progress?')) {
    console.error(`[safari-smoke] ${new URL(req.url, 'http://127.0.0.1').searchParams.get('step')}`)
    res.writeHead(204)
    res.end()
    return
  }
  const asset = req.url === '/snapdom.mjs' ? [bundle, 'text/javascript']
    : req.url === '/font.woff2' ? [font, 'font/woff2']
      : pluginModules.has(req.url) ? [pluginModules.get(req.url), 'text/javascript']
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
  if (!response.ok || value?.error) throw new Error(value?.message || value?.error || response.statusText)
  return value
}

// Passed directly to WebDriver, so this function executes in Safari against the built ESM.
async function smoke() {
  const progress = step => fetch('/progress?step=' + encodeURIComponent(step)).catch(() => {})
  await progress('import core')
  const { snapdom } = await import('/snapdom.mjs')
  const results = []
  const check = (condition, name, details = {}) => {
    if (!condition) throw new Error(name + ': ' + JSON.stringify(details))
    results.push({ name, ...details })
    void progress('passed: ' + name)
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

  // Migration regressions: these must hold on the shipped bundle in real Safari as well
  // as WebKit in the browser suite. Only closure state changes between repeat captures.
  const migrationRoot = mount('<p>PUBLIC_CALLBACK_SAFARI</p><p class="private-callback">PRIVATE_CALLBACK_SAFARI</p>',
    'width:240px;background:white;color:black;font:16px Arial')
  const rawSvg = capture => decodeURIComponent(capture.toRaw().split(',').slice(1).join(','))
  let combinedRoot, callbackRoot, callbackSheet
  try {
    const original = migrationRoot.outerHTML
    combinedRoot = mount('<div class="excluded" style="height:30px">EXCLUDED_SECRET_SAFARI</div>' +
      '<div class="filtered" style="height:20px">FILTERED_SECRET_SAFARI</div>' +
      '<div class="overlap" data-capture="exclude" style="height:10px">OVERLAP_SECRET_SAFARI</div>' +
      '<div style="height:20px;background:green">Public combined</div>',
    'width:240px;background:white;color:black;font:16px Arial')
    const combinedOriginal = combinedRoot.outerHTML
    for (const [excludeMode, filterMode, expectedY] of [['hide', 'remove', 40], ['remove', 'hide', 20]]) {
      await progress(`mixed ${excludeMode}/${filterMode}: capture`)
      const capture = await snapdom(combinedRoot, {
        ...options, exclude: '.excluded', excludeMode,
        filter: el => !el.matches('.filtered, .overlap'), filterMode,
      })
      const captured = rawSvg(capture)
      await progress(`mixed ${excludeMode}/${filterMode}: canvas`)
      const canvas = await capture.toCanvas()
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      let greenY = -1
      for (let y = 0; y < canvas.height; y++) {
        const i = (y * canvas.width + canvas.width - 2) * 4
        if (pixels[i] < 30 && pixels[i + 1] > 100 && pixels[i + 2] < 30 && pixels[i + 3] > 230) {
          greenY = y
          break
        }
      }
      check(!captured.includes('_SECRET_SAFARI') && captured.includes('Public combined') &&
        greenY === expectedY && canvas.height >= expectedY + 20 && combinedRoot.outerHTML === combinedOriginal,
      `filter and exclude keep independent modes ${excludeMode}/${filterMode}`, { greenY, height: canvas.height })
    }

    let privateMode = false
    const callbackOptions = {
      ...options, exclude: el => privateMode && el.matches('.private-callback'), excludeMode: 'remove',
    }
    await snapdom(migrationRoot, callbackOptions)
    const previous = await snapdom(migrationRoot, callbackOptions)
    privateMode = true
    const current = await snapdom(migrationRoot, callbackOptions)
    check(previous !== current && rawSvg(previous).includes('PRIVATE_CALLBACK_SAFARI') &&
      !rawSvg(current).includes('PRIVATE_CALLBACK_SAFARI') && rawSvg(current).includes('PUBLIC_CALLBACK_SAFARI') &&
      migrationRoot.outerHTML === original, 'exclusion callback refreshes without a DOM change')

    callbackSheet = document.createElement('style')
    callbackSheet.textContent = '.safari-callback-spacing { letter-spacing: 7px }'
    document.head.append(callbackSheet)
    callbackRoot = mount('<span class="safari-callback-spacing">Spacing callback</span>',
      'width:240px;background:white;color:black;font:16px Arial')
    let omitSpacing = false
    const styleOptions = { ...options, excludeStyleProps: prop => omitSpacing && prop === 'letter-spacing' }
    await snapdom(callbackRoot, styleOptions)
    const previousStyle = await snapdom(callbackRoot, styleOptions)
    omitSpacing = true
    const currentStyle = await snapdom(callbackRoot, styleOptions)
    check(/letter-spacing:\s*7px\b/.test(rawSvg(previousStyle)) &&
      !/letter-spacing:\s*7px\b/.test(rawSvg(currentStyle)), 'style callback refreshes cached snapshots')
  } finally {
    migrationRoot.remove()
    combinedRoot?.remove()
    callbackRoot?.remove()
    callbackSheet?.remove()
  }

  // Exercise published-style ESM plugin modules against the built core, on real Safari.
  // This group has its own deadline so a privacy export cannot silently hang the smoke.
  const privacySmoke = async () => {
    const [{ redactInputs }, { agentMap }, { contextExport }, { htmlExport }] = await Promise.all([
      import('/plugins/redact-inputs.js'), import('/plugins/agent-map.js'),
      import('/plugins/context-export.js'), import('/plugins/html-export.js'),
    ])
    const privateRoot = mount(
      '<section class="private-region"><h2>BLOCK_SECRET_SAFARI</h2><button>PRIVATE_ACTION_SAFARI</button></section>' +
      '<button id="privacy-public" title="TITLE_SECRET_SAFARI" aria-label="LABEL_SECRET_SAFARI" data-account="DATA_SECRET_SAFARI">Public action</button>' +
      '<a id="privacy-link" href="/?token=HREF_SECRET_SAFARI">Public link</a>' +
      '<input type="email" value="email-secret@safari.test">' +
      '<div id="privacy-style" style="width:90px;height:24px;background-image:linear-gradient(red,blue)">Public style</div>',
      'width:420px;height:220px;background:white;color:black;font:16px Arial',
    )
    let hiddenRoot, hiddenStyle
    try {
      const original = privateRoot.outerHTML
      const capture = await snapdom(privateRoot, {
        ...options, reconcile: true,
        // Semantic plugins deliberately come first: policy discovery must not depend on
        // afterClone order, since their snapshots read the original source attributes.
        plugins: [contextExport(), agentMap({ image: false, fields: 'full' }), redactInputs({
          blocks: '.private-region',
          attributes: [
            { selector: '#privacy-public', names: ['title', 'aria-label', 'data-account'] },
            { selector: '#privacy-link', names: ['href'] },
            { selector: '#privacy-style', names: ['style'] },
          ],
        }), htmlExport()],
      })
      const captureSvg = decodeURIComponent((await capture.toRaw()).split(',').slice(1).join(','))
      const captureHtml = await capture.toHtml()
      const semantic = JSON.stringify({
        map: await capture.toAgentMap(),
        outline: await capture.toContext(),
        tree: await capture.toContext({ format: 'json' }),
      })
      const secrets = [
        'BLOCK_SECRET_SAFARI', 'PRIVATE_ACTION_SAFARI', 'TITLE_SECRET_SAFARI',
        'LABEL_SECRET_SAFARI', 'DATA_SECRET_SAFARI', 'HREF_SECRET_SAFARI', 'email-secret@safari.test',
      ]
      for (const [name, text] of [['SVG', captureSvg], ['HTML', captureHtml], ['semantic exports', semantic]]) {
        check(secrets.every(secret => !text.includes(secret)), `privacy ${name} omits blocks and metadata`)
      }
      check([captureSvg, captureHtml, semantic].every(text => text.includes('Public action') && text.includes('Public link')),
        'privacy public content retained')
      check(privateRoot.outerHTML === original && privateRoot.querySelector('input').value === 'email-secret@safari.test',
        'privacy source attributes and fields untouched')
      const svgDoc = new DOMParser().parseFromString(captureSvg, 'image/svg+xml')
      const htmlDoc = new DOMParser().parseFromString(captureHtml, 'text/html')
      check([svgDoc, htmlDoc].every(doc => {
        const node = doc.querySelector('#privacy-style')
        return node && !node.hasAttribute('style')
      }), 'privacy late style removal survives reconciliation')

      hiddenRoot = mount('<strong>HIDDEN_ROOT_SECRET_SAFARI</strong>', 'width:80px;height:40px;background:white')
      hiddenRoot.id = 'privacy-hidden-root'
      const hiddenImage = media.toDataURL()
      hiddenRoot.style.backgroundImage = `url("${hiddenImage}")`
      hiddenStyle = document.createElement('style')
      hiddenStyle.textContent = '#privacy-hidden-root::before{content:"HIDDEN_PSEUDO_SECRET_SAFARI"}'
      document.head.append(hiddenStyle)
      const hidden = await snapdom(hiddenRoot, {
        ...options, plugins: [redactInputs({ blocks: '#privacy-hidden-root' })],
      })
      const hiddenSvg = decodeURIComponent((await hidden.toRaw()).split(',').slice(1).join(','))
      check(!hiddenSvg.includes('HIDDEN_ROOT_SECRET_SAFARI') && !hiddenSvg.includes('HIDDEN_PSEUDO_SECRET_SAFARI') &&
        !hiddenSvg.includes(hiddenImage), 'privacy blocked root omits late resources and pseudos')
      const hiddenCanvas = await hidden.toCanvas()
      const pixels = hiddenCanvas.getContext('2d').getImageData(0, 0, hiddenCanvas.width, hiddenCanvas.height).data
      check(!pixels.some((value, i) => i % 4 === 3 && value !== 0), 'privacy blocked root paints transparent')
    } finally {
      privateRoot.remove()
      hiddenRoot?.remove()
      hiddenStyle?.remove()
    }
  }
  let privacyTimer
  try {
    await Promise.race([
      privacySmoke(),
      new Promise((_, reject) => { privacyTimer = setTimeout(() => reject(new Error('Safari privacy smoke exceeded 30 seconds')), 30000) }),
    ])
  } finally { clearTimeout(privacyTimer) }
  return {
    version: snapdom.version, userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    viewport: { width: innerWidth, height: innerHeight, visualScale: visualViewport?.scale ?? null },
    checks: results,
  }
}

let session
try {
  const created = await request('/session', 'POST', { capabilities: { alwaysMatch: { browserName: 'safari' } } })
  session = created.sessionId
  await request(`/session/${session}/timeouts`, 'POST', { script: 180000 })
  await request(`/session/${session}/url`, 'POST', { url: `http://127.0.0.1:${server.address().port}/` })
  const report = await request(`/session/${session}/execute/async`, 'POST', {
    script: `const done = arguments[arguments.length - 1]; (${smoke.toString()})().then(done, e => done({ error: [e?.name, e?.message, e?.stack].filter(Boolean).join(String.fromCharCode(10)) || String(e) }));`,
    args: [],
  })
  assert.ok(!report.error, report.error)
  console.log(JSON.stringify(report, null, 2))
} finally {
  if (session) await request(`/session/${session}`, 'DELETE').catch(() => {})
  await new Promise(resolve => server.close(resolve))
}
