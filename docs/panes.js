// The 3-pane template (panes.css): one topic visible at a time, chosen by the URL hash,
// a filterable sidebar, a Previous/Next pager, and one live demo panel that each topic
// reconfigures through data attributes:
//   data-demo="capture" | "diff" | "pair"   (absent: the overview, no demo column)
//   data-method="toPng" | "toCanvas" | "toSvg"
//   data-options='{"exclude":[".demo-input"]}'
//   data-prepare="redact" | "retitle"       changes the live card for one capture, then restores it
//   data-transform="ascii" | "map" | "context"   simulated plugin output on the core capture
//   data-demo-label, data-note
// Without JavaScript every topic stays visible as one long page.
// SnapDOM loads from unpkg on the first run, like demo.js, because the site is served
// from docs/ and cannot reach the repository's dist/.

let snapdomPromise = null
const loadSnapdom = () => snapdomPromise ||= import('https://unpkg.com/@zumer/snapdom@latest/dist/snapdom.mjs').then(m => m.snapdom)

const pane = document.querySelector('[data-pane]')
const topics = [...pane.querySelectorAll('.pane-topic')]
const navLinks = [...pane.querySelectorAll('.pane-nav-items a')]
const navGroups = [...pane.querySelectorAll('.pane-nav > div')]
const panel = pane.querySelector('.demo-panel')
const card = panel.querySelector('.sample-card')
const results = panel.querySelector('[data-results]')
const resultLabel = panel.querySelector('[data-result-label]')
const statusLine = panel.querySelector('.demo-panel-status')
const note = panel.querySelector('.demo-note')
const buttons = Object.fromEntries([...panel.querySelectorAll('[data-act]')].map(b => [b.dataset.act, b]))
const pager = document.createElement('nav')
pager.className = 'pager'
pager.setAttribute('aria-label', 'Pages')

const secOf = el => [...el.classList].find(c => c.startsWith('sec-'))
const baseTitle = document.title
let topic = null
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

function resetDemo() {
  const mode = topic.dataset.demo
  baseline = null
  results.replaceChildren()
  if (mode === 'capture') {
    resultLabel.textContent = 'Result'
    statusLine.textContent = 'Edit the title, then run. This uses the real library from unpkg.'
    empty('Nothing captured yet')
  } else {
    resultLabel.textContent = mode === 'diff' ? 'Changed pixels' : 'Before · After'
    statusLine.textContent = '1 · Take a baseline.'
    empty('No baseline yet')
  }
  buttons.run.hidden = mode !== 'capture'
  buttons.baseline.hidden = buttons.compare.hidden = mode === 'capture'
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

async function run() {
  const { method = 'toPng', options, prepare, transform } = topic.dataset
  setBusy(true)
  const restore = prepare ? prepares[prepare](card) : null
  try {
    const snapdom = await loadSnapdom()
    const t0 = performance.now()
    const out = await snapdom[method](card, options ? JSON.parse(options) : undefined)
    const ms = Math.round(performance.now() - t0)
    const w = out.naturalWidth || out.width, h = out.naturalHeight || out.height
    const node = transform ? transforms[transform](out, card) : out
    if (!results.querySelector('.demo-print')) results.replaceChildren()
    results.prepend(print(node, `${w} × ${h} px · ${ms} ms`))
    results.querySelectorAll('.demo-print:nth-child(n+3)').forEach(n => n.remove())
    statusLine.textContent = `Done · ${ms} ms`
  } catch (error) {
    statusLine.textContent = 'Error: ' + (error?.message || error)
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
    statusLine.textContent = 'Error: ' + (error?.message || error)
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
    statusLine.textContent = 'Error: ' + (error?.message || error)
  } finally {
    setBusy(false)
  }
}

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

  pane.classList.toggle('no-demo', !topic.dataset.demo)
  if (topic.dataset.demo) {
    panel.classList.remove(secOf(panel))
    panel.classList.add(secOf(topic))
    panel.querySelector('.demo-panel-title').textContent = topic.dataset.demoLabel || topic.dataset.title
    note.textContent = topic.dataset.note || ''
    resetDemo()
  }
  // The topic's id is also an anchor; land at the top of the page, not on the section.
  if (scroll) window.scrollTo({ top: 0, behavior: 'instant' })
}

navGroups.forEach(g => {
  const head = g.querySelector('.pane-nav-head')
  head.addEventListener('click', () => head.setAttribute('aria-expanded', String(head.getAttribute('aria-expanded') !== 'true')))
})

pane.querySelector('.pane-filter input').addEventListener('input', event => {
  const q = event.target.value.trim().toLowerCase()
  navGroups.forEach(g => {
    const links = [...g.querySelectorAll('.pane-nav-items a')]
    links.forEach(a => { a.hidden = q && !a.textContent.toLowerCase().includes(q) })
    g.hidden = links.every(a => a.hidden)
    if (q) g.querySelector('.pane-nav-head').setAttribute('aria-expanded', 'true')
  })
  if (!q) show(topic.id)
})

buttons.run.addEventListener('click', run)
buttons.baseline.addEventListener('click', takeBaseline)
buttons.compare.addEventListener('click', compare)
buttons.reset.addEventListener('click', resetDemo)
window.addEventListener('hashchange', () => show(location.hash.slice(1), true))
show(location.hash.slice(1), true)
// The browser scrolls to the fragment again once the page has loaded.
window.addEventListener('load', () => requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'instant' })), { once: true })
