// The pane template (panes.css): sidebar, reading column, and the live demo below it. Each
// page is its own URL; the sidebar links between them and the pager is written into the page.
// The .pane-read article configures the one demo panel through data attributes:
//   data-demo="capture" | "diff" | "pair" | "compare"   (absent: no demo panel)
//   data-method="toPng" | "toJpg" | "toCanvas" | "toSvg" | "download"
//   data-options='{"scale":2}'
//   data-sample="form" | "svg" | …   (else sampleFor picks one from the title and the path)
//   data-prepare="redact" | "retitle" | "filter" | "tint" | "timestamp"   official plugins that change only the captured copy
//   data-transform="ascii" | "map" | "context" | "pdf" | "vector" | "html" | "gif" | "video"   official plugin outputs
//   data-lib="html2canvas" | "html-to-image" | "dom-to-image" | "modern-screenshot"   (compare)
//   data-demo-label, data-note
// SnapDOM loads from unpkg on the first run, like demo.js, because the site is served
// from docs/ and cannot reach the repository's dist/.

import { loadSnapdom, loadPlugin, mountSample, sampleFor } from './demo-runtime.js'

// An open shadow root for the demos that show Shadow DOM capture.
customElements.define('sd-shadow-card', class extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return
    this.attachShadow({ mode: 'open' }).innerHTML = '<style>:host{display:block;margin-top:10px}p{margin:0;padding:8px 10px;border-left:3px solid #1E9F6E;background:#EFFAF5;color:#0F1E4D;font:13px Roboto, Arial}</style><p>Inside an open shadow root</p>'
  }
})

const pane = document.querySelector('[data-pane]')
const navGroups = [...pane.querySelectorAll('.pane-nav > div')]
const panel = pane.querySelector('.demo-panel')
const secOf = el => [...el.classList].find(c => c.startsWith('sec-'))
const fail = error => 'Error: ' + (error?.message || error)
const topic = pane.querySelector('.pane-read')

navGroups.forEach(g => {
  const head = g.querySelector('.pane-nav-head')
  head.addEventListener('click', () => head.setAttribute('aria-expanded', String(head.getAttribute('aria-expanded') !== 'true')))
})

pane.querySelector('.pane-filter input')?.addEventListener('input', event => {
  const q = event.target.value.trim().toLowerCase()
  navGroups.forEach(g => {
    const links = [...g.querySelectorAll('.pane-nav-items > a')]
    links.forEach(a => { a.hidden = q && !a.textContent.toLowerCase().includes(q) })
    g.hidden = links.every(a => a.hidden)
    if (q) g.querySelector('.pane-nav-head').setAttribute('aria-expanded', 'true')
  })
  pane.querySelector('.pane-filter-status').hidden = navGroups.some(g => !g.hidden)
})

// ── Demo panel ──
let card = panel?.querySelector('[data-target]')
const results = panel?.querySelector('[data-results]')
const resultLabel = panel?.querySelector('[data-result-label]')
const statusLine = panel?.querySelector('.demo-panel-status')
const note = panel?.querySelector('.demo-note')
const buttons = panel ? Object.fromEntries([...panel.querySelectorAll('[data-act]')].map(b => [b.dataset.act, b])) : {}
let baseline = null

const empty = text => {
  const box = document.createElement('div')
  box.className = 'demo-empty'
  box.textContent = text
  results.replaceChildren(box)
}

const print = (node, caption) => {
  const figure = document.createElement('figure')
  figure.className = 'demo-print'
  if (typeof node === 'string') {
    const pre = document.createElement('pre')
    pre.textContent = node
    node = pre
  } else if (node.style) {
    node.style.height = 'auto'
  }
  figure.append(node)
  if (caption) {
    const figcaption = document.createElement('figcaption')
    figcaption.textContent = caption
    figure.append(figcaption)
  }
  return figure
}

const setBusy = busy => Object.values(buttons).forEach(b => { b.disabled = busy })

const IDLE = {
  capture: ['Result', 'Edit the sample, then run a real capture.', 'Nothing captured yet'],
  diff: ['Changed pixels', '1 · Take a baseline.', 'No baseline yet'],
  pair: ['Before · After', '1 · Take a baseline.', 'No baseline yet'],
  compare: ['Results', 'Runs SnapDOM and the other library on the same element.', 'Run both to compare the output'],
}

function resetDemo() {
  const mode = topic.dataset.demo
  const [label, status, idle] = IDLE[mode]
  baseline = null
  resultLabel.textContent = label
  statusLine.textContent = mode === 'compare' ? `Runs SnapDOM and ${topic.dataset.lib} on the same element.` : status
  empty(topic.dataset.method === 'download' ? 'The file goes to your downloads' : idle)
  buttons.run.hidden = mode === 'diff' || mode === 'pair'
  buttons.run.textContent = mode === 'compare' ? 'Run both' : 'Run'
  buttons.baseline.hidden = buttons.compare.hidden = !buttons.run.hidden
  buttons.baseline.classList.add('is-primary')
  buttons.compare.classList.remove('is-primary')
  buttons.compare.disabled = true
}

// Other libraries for the head-to-head pages, pinned like the compare harness pins them.
const loadScript = (src, global) => window[global] ? Promise.resolve(window[global]) : new Promise((resolve, reject) => {
  const script = document.createElement('script')
  script.src = src
  script.onload = () => window[global] ? resolve(window[global]) : reject(new Error(global + ' did not load'))
  script.onerror = () => reject(new Error('Could not load ' + src))
  document.head.append(script)
})
const LIBS = {
  'html2canvas': async el => (await (await loadScript('https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js', 'html2canvas'))(el)).toDataURL('image/png'),
  'html-to-image': async el => (await loadScript('https://unpkg.com/html-to-image@1.11.11/dist/html-to-image.js', 'htmlToImage')).toPng(el),
  'dom-to-image': async el => (await loadScript('https://unpkg.com/dom-to-image@2.6.0/dist/dom-to-image.min.js', 'domtoimage')).toPng(el),
  'modern-screenshot': async el => (await import('https://esm.sh/modern-screenshot@4')).domToPng(el),
}

async function timed(run) {
  const t0 = performance.now()
  try {
    const out = await run()
    return { out, ms: Math.round(performance.now() - t0) }
  } catch (error) {
    return { error: fail(error) }
  }
}

async function runCompare() {
  const lib = topic.dataset.lib
  const snapdom = await loadSnapdom()
  const a = await timed(() => snapdom.toPng(card))
  statusLine.textContent = `Loading ${lib}…`
  const b = await timed(() => LIBS[lib](card))
  const cell = (name, r) => {
    let node
    if (r.error) {
      node = document.createElement('div')
      node.className = 'demo-empty'
      node.textContent = r.error
    } else if (typeof r.out === 'string') {
      node = new Image()
      node.src = r.out
      node.alt = name
    } else {
      node = r.out
    }
    return print(node, `${name}${r.ms != null ? ' · ' + r.ms + ' ms' : ''}`)
  }
  results.replaceChildren(cell('SnapDOM', a), cell(lib, b))
  statusLine.textContent = `SnapDOM ${a.ms != null ? a.ms + ' ms' : 'error'} · ${lib} ${b.ms != null ? b.ms + ' ms' : 'error'}`
}

async function run() {
  if (topic.dataset.demo === 'compare') {
    setBusy(true)
    await runCompare().catch(error => { statusLine.textContent = fail(error) })
    setBusy(false)
    return
  }
  const { method = 'toPng', options, prepare, transform } = topic.dataset
  setBusy(true)
  try {
    const snapdom = await loadSnapdom()
    const opts = options ? JSON.parse(options) : {}
    const plugins = []
    // module, factory, options: the prepare plugins change only the captured copy
    const prepares = {
      redact: ['redact-inputs', 'redactInputs'],
      retitle: ['replace-text', 'replaceText', { replacements: [{ find: card.querySelector('[data-title]').textContent, replace: 'Name hidden for sharing' }] }],
      filter: ['filter', 'filter', { preset: 'grayscale' }],
      tint: ['color-tint', 'colorTint', { color: 'royalblue', opacity: 0.35 }],
      timestamp: ['timestamp-overlay', 'timestampOverlay', { position: 'top-right' }],
    }
    const prep = prepares[prepare]
    if (prep) plugins.push((await loadPlugin(prep[0]))[prep[1]](prep[2]))
    const outputs = { ascii: ['ascii-export', 'asciiExport', 'toAscii'], map: ['agent-map', 'agentMap', 'toAgentMap'], context: ['context-export', 'contextExport', 'toContext'], pdf: ['pdf', 'pdf', 'toPdf'], vector: ['vector', 'vector', 'toVector'], html: ['html-export', 'htmlExport', 'toHtml'], gif: ['gif-export', 'gifExport', 'toGif'], video: ['video-export', 'videoExport', 'toMp4'] }
    const output = outputs[transform]
    if (output) plugins.push((await loadPlugin(output[0]))[output[1]]())
    opts.plugins = plugins
    const t0 = performance.now()
    if (method === 'download') {
      await snapdom.download(card, { format: 'png', filename: 'snapdom-demo', ...opts })
      statusLine.textContent = `Downloaded snapdom-demo.png · ${Math.round(performance.now() - t0)} ms`
      return
    }
    const result = await snapdom(card, opts)
    let node
    if (output) {
      const value = await result[output[2]](transform === 'map' ? { image: 'annotated' } : transform === 'ascii' ? { width: 46 } : transform === 'gif' ? { fps: 4, duration: 1000 } : transform === 'video' ? { fps: 8, duration: 1500 } : {})
      if (transform === 'gif') {
        node = new Image(); node.src = URL.createObjectURL(value); node.alt = 'Recorded GIF'
      } else if (transform === 'video') {
        node = document.createElement('video'); node.src = URL.createObjectURL(value); node.muted = true; node.autoplay = true; node.loop = true; node.playsInline = true; node.controls = true
      } else if (transform === 'map') {
        node = new Image(); node.src = value.image; node.alt = 'Captured element map'
      } else if (transform === 'pdf') {
        node = document.createElement('a'); node.href = URL.createObjectURL(new Blob([value], { type: 'application/pdf' })); node.download = 'snapdom-demo.pdf'; node.textContent = 'Download captured PDF'
      } else if (transform === 'vector') {
        node = new Image(); node.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(value); node.alt = 'Vector artwork'
      } else node = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    } else node = await result[method === 'result' ? 'toPng' : method]()
    const ms = Math.round(performance.now() - t0)
    const w = node.naturalWidth || node.width, h = node.naturalHeight || node.height
    if (!results.querySelector('.demo-print')) results.replaceChildren()
    results.prepend(print(node, `${w ? w + ' × ' + h + ' px · ' : ''}${ms} ms`))
    results.querySelectorAll('.demo-print:nth-child(n+3)').forEach(n => n.remove())
    statusLine.textContent = `Done · ${ms} ms`
  } catch (error) {
    statusLine.textContent = fail(error)
  } finally {
    setBusy(false)
  }
}

async function capture() {
  const snapdom = await loadSnapdom()
  const img = await snapdom.toPng(card)
  await img.decode?.()
  return img
}

function diffImages(a, b) {
  const w = a.naturalWidth, h = a.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(a, 0, 0)
  const A = ctx.getImageData(0, 0, w, h).data
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(b, 0, 0, w, h)
  const B = ctx.getImageData(0, 0, w, h).data
  const out = ctx.createImageData(w, h)
  let changed = 0
  for (let i = 0; i < A.length; i += 4) {
    const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2])
    if (d > 40) {
      changed++
      out.data.set([230, 57, 70, 255], i)
    } else {
      out.data.set([A[i], A[i + 1], A[i + 2], 50], i)
    }
  }
  ctx.putImageData(out, 0, 0)
  return { canvas, pct: (changed / (w * h) * 100).toFixed(2) }
}

async function takeBaseline() {
  setBusy(true)
  try {
    baseline = await capture()
    empty('Baseline stored. Change something and compare.')
    statusLine.textContent = '2 · Edit the card title, then compare.'
    buttons.baseline.classList.remove('is-primary')
    buttons.compare.classList.add('is-primary')
  } catch (error) {
    statusLine.textContent = fail(error)
  } finally {
    setBusy(false)
    buttons.compare.disabled = !baseline
  }
}

async function compare() {
  setBusy(true)
  try {
    const t0 = performance.now()
    const after = await capture()
    if (topic.dataset.demo === 'diff') {
      const diff = diffImages(baseline, after)
      results.replaceChildren(print(diff.canvas))
      statusLine.textContent = `${diff.pct}% of pixels changed · ${Math.round(performance.now() - t0)} ms`
    } else {
      const pair = document.createElement('div')
      pair.className = 'demo-pair'
      pair.append(print(baseline.cloneNode(), 'Before'), print(after, 'After'))
      results.replaceChildren(pair)
      statusLine.textContent = 'Before / after pair ready for review'
    }
  } catch (error) {
    statusLine.textContent = fail(error)
  } finally {
    setBusy(false)
  }
}

function configureDemo() {
  if (!topic.dataset.demo) return
  panel.classList.remove(secOf(panel))
  panel.classList.add(secOf(topic))
  if (!card.querySelector('sd-shadow-card') && !card.classList.contains('tricky-card')) {
    const holder = document.createElement('div')
    const next = mountSample(holder, topic.dataset.sample || sampleFor(topic.dataset.title, location.pathname), topic.dataset.title)
    card.replaceWith(next); card = next
  }
  panel.querySelector('.demo-panel-sub').textContent = topic.dataset.demoLabel || topic.dataset.title
  note.textContent = topic.dataset.note || (location.pathname.includes('/guides/') ? 'Live DOM example. The article shows how to mount and capture it in your framework.' : '')
  resetDemo()
}

if (panel) {
  buttons.run.addEventListener('click', run)
  buttons.baseline.addEventListener('click', takeBaseline)
  buttons.compare.addEventListener('click', compare)
  buttons.reset.addEventListener('click', resetDemo)
}

configureDemo()

// ?embed shows only a lab's live demo, for the showcase to frame. Siblings on the way up
// are hidden rather than the demo moved, so the lab's own selectors and scripts still match.
// Fixed siblings stay: they take no room and are the demo's own layers. Hiding the shatter
// lab's full-screen WebGL canvas left the card vanishing with nothing drawn in its place.
if (new URLSearchParams(location.search).has('embed')) {
  const demo = document.querySelector('.pane-content [class^="lab-"]')
  if (demo) {
    for (let el = demo; el !== document.body; el = el.parentElement) {
      for (const sib of el.parentElement.children) {
        if (sib === el || sib.tagName === 'SCRIPT' || sib.tagName === 'STYLE' || getComputedStyle(sib).position === 'fixed') continue
        sib.style.display = 'none'
      }
      if (el !== demo) el.style.cssText += ';display:block;margin:0;padding:0;max-width:none;border:0'
    }
    document.documentElement.style.cssText += ';background:transparent'
    document.body.style.cssText += ';margin:0;padding:0;background:transparent'
  }
}
