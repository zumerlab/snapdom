import { complexCardHTML, bigTableHTML, cssHeavyScenario, shadowTreeScenario, deepTreeScenario, dashboardScenario } from '/harness.js'

export const scenes = ['card', 'table', 'css', 'shadow', 'images', 'fonts', 'deep', 'dashboard']
let active
let fontsReady
const templates = new Map()
const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

export async function mount(name, stamp) {
  active?.cleanup()
  let scene
  if (name === 'css' || name === 'deep') {
    // These factories install document styles. Keep those sheets for the context's
    // lifetime: fresh means new captured nodes, not replacing the app's stylesheets.
    if (!templates.has(name)) {
      const built = name === 'css' ? cssHeavyScenario() : deepTreeScenario()
      if (name === 'deep') {
        // Eight chains retain nested flex/grid + pseudos with a bounded raster size.
        const tree = built.root.firstElementChild
        while (tree.children.length > 8) tree.lastElementChild.remove()
      }
      built.root.remove()
      templates.set(name, built.root)
    }
    const root = templates.get(name).cloneNode(true)
    document.body.appendChild(root)
    scene = { root, cleanup: () => root.remove() }
  } else if (name === 'shadow') scene = shadowTreeScenario()
  else if (name === 'dashboard') scene = dashboardScenario()
  else {
    const root = document.createElement('div')
    root.style.cssText = 'width:800px;background:white;font:14px/1.4 Arial,sans-serif'
    if (name === 'card') { root.style.width = '520px'; root.innerHTML = complexCardHTML() }
    else if (name === 'table') root.innerHTML = bigTableHTML(250)
    else if (name === 'images') {
      root.style.cssText += ';display:grid;grid-template-columns:repeat(5,1fr);gap:8px'
      root.innerHTML = Array.from({ length: 40 }, (_, i) => `<img src="/assets/images/img-${String(i).padStart(2, '0')}.png" style="width:144px;height:100px;object-fit:cover">`).join('')
    } else if (name === 'fonts') {
      if (!fontsReady) {
        const style = document.createElement('style')
        style.textContent = '@font-face{font-family:BenchInter;src:url(/assets/fonts/inter-400.woff2);font-weight:400}@font-face{font-family:BenchInter;src:url(/assets/fonts/inter-700.woff2);font-weight:700}@font-face{font-family:BenchMono;src:url(/assets/fonts/jbmono-400.woff2)}'
        document.head.appendChild(style)
        fontsReady = Promise.all(['14px BenchInter', '700 14px BenchInter', '14px BenchMono'].map(font => document.fonts.load(font)))
      }
      root.style.fontFamily = 'BenchInter'
      root.innerHTML = '<h2>Release notes</h2>' + Array.from({ length: 12 }, (_, i) => `<p><b>Change ${i + 1}.</b> This report combines regular and bold web fonts with <code style="font-family:BenchMono">capture(element)</code>.</p>`).join('')
      await fontsReady
    } else throw new Error(`Unknown scene: ${name}`)
    document.body.appendChild(root)
    scene = { root, cleanup: () => root.remove() }
  }
  const root = document.createElement('div')
  root.id = 'capture-root'
  root.style.cssText = `position:relative;width:${Math.ceil(scene.root.getBoundingClientRect().width)}px;padding-top:20px;background:white;box-sizing:content-box`
  const marker = document.createElement('div')
  marker.style.cssText = 'position:absolute;left:0;top:0;width:16px;height:16px'
  const label = document.createElement('span')
  label.style.cssText = 'position:absolute;left:24px;top:0;font:12px/16px Arial'
  root.append(marker, label, scene.root)
  document.body.appendChild(root)
  const metric = root.querySelector('.metric-v')
  let metricMarker
  if (metric) {
    metricMarker = document.createElement('div')
    metricMarker.style.cssText = 'width:12px;height:12px'
    metric.parentElement.appendChild(metricMarker)
  }
  active = { root, marker, label, metric, metricMarker, cleanup: () => { scene.cleanup(); root.remove() } }
  mutate(stamp)
  await Promise.all([...root.querySelectorAll('img')].map(image => image.decode()))
  await document.fonts.ready
  await frame()
  // Fractional CSS heights round differently in native screenshots and foreignObject
  // rasterization. Give both arms the exact same integral, unclipped output box.
  root.style.height = `${Math.ceil(root.getBoundingClientRect().height)}px`
  root.style.boxSizing = 'border-box'
  await frame()
  return root
}

export function mutate(stamp) {
  // Encode the stamp with 16 levels per channel. All stamps within one context
  // (at most 816 ticks) have distinct witnesses, so a stale third frame cannot pass.
  active.color = [0, 4, 8].map(shift => 8 + ((stamp >> shift) & 15) * 16)
  active.marker.style.backgroundColor = `rgb(${active.color.join(',')})`
  active.label.textContent = `Capture ${String(stamp).padStart(6, '0')}`
  if (active.metric) {
    active.metric.textContent = String(1000 + stamp)
    active.metricMarker.style.backgroundColor = `rgb(${active.color.join(',')})`
  }
}

// Called after timing: output dimensions and a changing painted witness catch stale memo
// hits, blank images and partial exports. Full native/capture comparisons run separately.
export function validate(canvas) {
  const rect = active.root.getBoundingClientRect()
  if (canvas.width !== rect.width || canvas.height !== rect.height) {
    throw new Error(`Output ${canvas.width}x${canvas.height}, DOM ${rect.width}x${rect.height}`)
  }
  const points = [[8, 8]]
  if (active.metricMarker) {
    const marker = active.metricMarker.getBoundingClientRect()
    points.push([Math.round(marker.x - rect.x + 6), Math.round(marker.y - rect.y + 6)])
  }
  for (const [x, y] of points) {
    const pixel = canvas.getContext('2d').getImageData(x, y, 1, 1).data
    if (active.color.some((value, i) => Math.abs(pixel[i] - value) > 3) || pixel[3] !== 255) {
      throw new Error(`Stale/blank capture at ${x},${y}: marker ${[...pixel]}, expected ${active.color}`)
    }
  }
  return { width: canvas.width, height: canvas.height }
}

export async function run(snapdom, { scene, mode, samples, round, delayMs = 0 }) {
  const base = { scale: 1, dpr: 1, embedFonts: scene === 'fonts' }
  if (mode === 'recapture') base.burst = false
  const warmups = mode === 'first' ? 0 : 2
  const ticks = mode.startsWith('poll-') ? 8 : 1
  const count = mode === 'first' ? 1 : samples
  await mount(scene, round * 1000)
  const results = []
  for (let sample = -warmups; sample < count; sample++) {
    let captureMs = 0, canvasMs = 0, encodeMs = 0
    let canvas, png
    for (let tick = 0; tick < ticks; tick++) {
      const stamp = round * 1000 + (sample + warmups) * ticks + tick
      if (mode === 'fresh') await mount(scene, stamp)
      else if (mode === 'recapture' || (mode === 'poll-mutating' && tick % 4 === 0)) mutate(stamp)
      // Layout/fixture construction are outside the stopwatch. No waits on memo-only ticks.
      if (!mode.startsWith('poll-') || tick % 4 === 0) await frame()
      const start = performance.now()
      const result = await snapdom(active.root, base)
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs))
      const captured = performance.now()
      canvas = await result.toCanvas()
      const rasterized = performance.now()
      png = canvas.toDataURL('image/png')
      const encoded = performance.now()
      captureMs += captured - start
      canvasMs += rasterized - captured
      encodeMs += encoded - rasterized
      validate(canvas)
    }
    if (sample >= 0) results.push({
      captureMs, canvasMs, encodeMs, totalMs: captureMs + canvasMs + encodeMs,
      ticks, ...validate(canvas), dataUrlCharacters: png.length,
    })
    window.lastBenchmarkPng = png
  }
  return results
}

export async function oracle(snapdom, scene, mode) {
  await mount(scene, 0)
  const options = { scale: 1, dpr: 1, embedFonts: scene === 'fonts' }
  if (mode === 'recapture') options.burst = false
  let canvas = await snapdom.toCanvas(active.root, options)
  if (mode === 'fresh') await mount(scene, 1)
  else if (mode !== 'first' && mode !== 'poll-static') mutate(1)
  if (mode !== 'first') canvas = await snapdom.toCanvas(active.root, options)
  validate(canvas)
  return canvas.toDataURL('image/png')
}

export async function difference(leftUrl, rightUrl, stableNative, candidateNative) {
  const urls = stableNative ? [leftUrl, rightUrl, stableNative, candidateNative] : [leftUrl, rightUrl]
  const images = await Promise.all(urls.map(async src => {
    const image = new Image()
    image.src = src
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data }
  }))
  const [a, b] = images
  if (a.width !== b.width || a.height !== b.height) return { dimensionMismatch: true, left: [a.width, a.height], right: [b.width, b.height] }
  if (images.some(image => image.width !== a.width || image.height !== a.height)) return { dimensionMismatch: true }
  let different = 0, newlyWrong = 0
  for (let i = 0; i < a.data.length; i += 4) {
    let changed = false, stableWrong = false, candidateWrong = false
    for (let channel = 0; channel < 4; channel++) {
      const index = i + channel
      if (Math.abs(a.data[index] - b.data[index]) > 20) changed = true
      if (stableNative) {
        if (Math.abs(a.data[index] - images[2].data[index]) > 20) stableWrong = true
        if (Math.abs(b.data[index] - images[3].data[index]) > 20) candidateWrong = true
      }
    }
    if (changed) different++
    if (candidateWrong && !stableWrong) newlyWrong++
  }
  return { dimensionMismatch: false, fraction: different / (a.width * a.height), ...(stableNative ? { newlyWrongFraction: newlyWrong / (a.width * a.height) } : {}), width: a.width, height: a.height }
}
