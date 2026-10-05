// The 3-pane template (panes.css): sidebar · live demo · reading column.
// Two modes, picked by the markup:
//   topic mode  (Capabilities, Ecosystem): every topic is a .pane-topic section on one page,
//               one visible at a time, chosen by the URL hash, with a generated pager.
//   page mode   (Docs, How-to, Guides, Compare, Blog, Labs): each page is its own URL and the
//               sidebar links between them; the pager is written into the page.
// The element that carries the demo settings (the visible .pane-topic, or .pane-read in page
// mode) configures the one demo panel through data attributes:
//   data-demo="capture" | "diff" | "pair" | "compare"   (absent: no demo column)
//   data-method="toPng" | "toJpg" | "toCanvas" | "toSvg"
//   data-options='{"scale":2}'
//   data-prepare="redact" | "retitle"       changes the live card for one capture, then restores it
//   data-transform="ascii" | "map" | "context"   simulated plugin output on the core capture
//   data-lib="html2canvas" | "html-to-image" | "dom-to-image" | "modern-screenshot"   (compare)
//   data-demo-label, data-note
// Without JavaScript every topic stays visible as one long page.
// SnapDOM loads from unpkg on the first run, like demo.js, because the site is served
// from docs/ and cannot reach the repository's dist/.

let snapdomPromise = null
const loadSnapdom = () => snapdomPromise ||= import('https://unpkg.com/@zumer/snapdom@latest/dist/snapdom.mjs').then(m => m.snapdom)

// An open shadow root for the demos that show Shadow DOM capture.
customElements.define('sd-shadow-card', class extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return
    this.attachShadow({ mode: 'open' }).innerHTML = '<style>:host{display:block;margin-top:10px}p{margin:0;padding:8px 10px;border-left:3px solid #1E9F6E;background:#EFFAF5;color:#0F1E4D;font:13px Arial}</style><p>Inside an open shadow root</p>'
  }
})

const pane = document.querySelector('[data-pane]')
const topics = [...pane.querySelectorAll('.pane-topic')]
const navLinks = [...pane.querySelectorAll('.pane-nav-items a')]
const navGroups = [...pane.querySelectorAll('.pane-nav > div')]
const panel = pane.querySelector('.demo-panel')
const secOf = el => [...el.classList].find(c => c.startsWith('sec-'))
const fail = error => 'Error: ' + (error?.message || error)
let topic = topics.length ? null : pane.querySelector('.pane-read')

navGroups.forEach(g => {
  const head = g.querySelector('.pane-nav-head')
  head.addEventListener('click', () => head.setAttribute('aria-expanded', String(head.getAttribute('aria-expanded') !== 'true')))
})

pane.querySelector('.pane-filter input').addEventListener('input', event => {
  const q = event.target.value.trim().toLowerCase()
  navGroups.forEach(g => {
    const links = [...g.querySelectorAll('.pane-nav-items > a')]
    links.forEach(a => { a.hidden = q && !a.textContent.toLowerCase().includes(q) })
    g.hidden = links.every(a => a.hidden)
    if (q) g.querySelector('.pane-nav-head').setAttribute('aria-expanded', 'true')
  })
  if (!q && topics.length) show(topic.id)
})

// ── Demo panel ──
const card = panel?.querySelector('[data-target]')
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
  capture: ['Result', 'Edit the title, then run. This uses the real library from unpkg.', 'Nothing captured yet'],
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

// Simulated plugin steps, applied to the live card or to the core result.
const prepares = {
  redact(el) {
    const fields = [...el.querySelectorAll('input')]
    const values = fields.map(f => f.value)
    fields.forEach(f => { f.value = '•'.repeat(f.value.length) })
    return () => fields.forEach((f, i) => { f.value = values[i] })
  },
  retitle(el) {
    const title = el.querySelector('[data-title]')
    const text = title.textContent
    title.textContent = 'Name hidden for sharing'
    return () => { title.textContent = text }
  },
}
const transforms = {
  ascii(canvas) {
    const cols = 46, ramp = ' .:-=+*#%@'
    const { width: w, height: h } = canvas
    const rows = Math.round(cols * h / w * 0.5), cw = w / cols, ch = h / rows
    const data = canvas.getContext('2d').getImageData(0, 0, w, h).data
    let text = ''
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const k = (Math.floor(y * ch + ch / 2) * w + Math.floor(x * cw + cw / 2)) * 4
        const light = (data[k] * 0.3 + data[k + 1] * 0.59 + data[k + 2] * 0.11) / 255
        text += ramp[Math.min(ramp.length - 1, Math.floor((1 - light) * ramp.length))]
      }
      text += '\n'
    }
    return text
  },
  map(img, el) {
    const box = el.getBoundingClientRect()
    const wrap = document.createElement('div')
    wrap.className = 'demo-map'
    img.style.height = 'auto'
    wrap.append(img)
    el.querySelectorAll('input, button, a').forEach((node, i) => {
      const r = node.getBoundingClientRect()
      const mark = document.createElement('span')
      mark.style.cssText = `left:${(r.left - box.left) / box.width * 100}%;top:${(r.top - box.top) / box.height * 100}%;width:${r.width / box.width * 100}%;height:${r.height / box.height * 100}%`
      const badge = document.createElement('b')
      badge.textContent = i + 1
      mark.append(badge)
      wrap.append(mark)
    })
    return wrap
  },
  context(_, el) {
    return JSON.stringify({
      title: el.querySelector('[data-title]').textContent,
      fields: [...el.querySelectorAll('input')].map(i => ({ label: 'Owner email', value: i.value })),
      actions: ['Approve', 'View details'],
    }, null, 2)
  },
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
  const restore = prepare ? prepares[prepare](card) : null
  try {
    const snapdom = await loadSnapdom()
    const opts = options ? JSON.parse(options) : undefined
    const t0 = performance.now()
    if (method === 'download') {
      await snapdom.download(card, { format: 'png', filename: 'snapdom-demo', ...opts })
      statusLine.textContent = `Downloaded snapdom-demo.png · ${Math.round(performance.now() - t0)} ms`
      return
    }
    const out = method === 'result' ? await (await snapdom(card, opts)).toPng() : await snapdom[method](card, opts)
    const ms = Math.round(performance.now() - t0)
    const w = out.naturalWidth || out.width, h = out.naturalHeight || out.height
    const node = transform ? transforms[transform](out, card) : out
    if (!results.querySelector('.demo-print')) results.replaceChildren()
    results.prepend(print(node, `${w} × ${h} px · ${ms} ms`))
    results.querySelectorAll('.demo-print:nth-child(n+3)').forEach(n => n.remove())
    statusLine.textContent = `Done · ${ms} ms`
  } catch (error) {
    statusLine.textContent = fail(error)
  } finally {
    restore?.()
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
  pane.classList.toggle('no-demo', !topic.dataset.demo)
  if (!topic.dataset.demo) return
  panel.classList.remove(secOf(panel))
  panel.classList.add(secOf(topic))
  panel.querySelector('.demo-panel-title').textContent = topic.dataset.demoLabel || topic.dataset.title
  note.textContent = topic.dataset.note || ''
  resetDemo()
}

if (panel) {
  buttons.run.addEventListener('click', run)
  buttons.baseline.addEventListener('click', takeBaseline)
  buttons.compare.addEventListener('click', compare)
  buttons.reset.addEventListener('click', resetDemo)
}

// ── Topic mode ──
const baseTitle = document.title
const pager = document.createElement('nav')
pager.className = 'pager'
pager.setAttribute('aria-label', 'Pages')

function renderPager(i) {
  pager.replaceChildren()
  for (const [label, t, cls] of [['Previous', topics[i - 1], ''], ['Next', topics[i + 1], 'is-next']]) {
    if (!t) continue
    const a = document.createElement('a')
    a.href = '#' + t.id
    if (cls) a.className = cls
    const small = document.createElement('span')
    small.textContent = label
    const strong = document.createElement('strong')
    strong.textContent = t.dataset.title
    a.append(small, strong)
    pager.append(a)
  }
  topics[i].append(pager)
}

function show(id, scroll) {
  const i = Math.max(0, topics.findIndex(t => t.id === id))
  topic = topics[i]
  topics.forEach(t => { t.hidden = t !== topic })
  navLinks.forEach(a => {
    if (a.hash === '#' + topic.id) a.setAttribute('aria-current', 'page')
    else a.removeAttribute('aria-current')
  })
  const group = navLinks.find(a => a.hash === '#' + topic.id)?.closest('.pane-nav > div')
  navGroups.forEach(g => g.querySelector('.pane-nav-head').setAttribute('aria-expanded', String(g === group)))
  renderPager(i)
  document.title = i ? `${topic.dataset.title} · ${baseTitle}` : baseTitle
  configureDemo()
  // The topic's id is also an anchor; land at the top of the page, not on the section.
  if (scroll) window.scrollTo({ top: 0, behavior: 'instant' })
}

if (topics.length) {
  window.addEventListener('hashchange', () => show(location.hash.slice(1), true))
  show(location.hash.slice(1), true)
  // The browser scrolls to the fragment again once the page has loaded.
  window.addEventListener('load', () => requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'instant' })), { once: true })
} else {
  configureDemo()
}
