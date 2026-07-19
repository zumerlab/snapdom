// Shared live benchmark for compare pages: snapdom vs a competitor library.
// Both sides export the same element to PNG 5 times; averages are compared.
// Wire a button with:
//   class="run-benchmark-button"
//   data-lib="html-to-image" | "modern-screenshot" | "dom-to-image"
//   data-target / data-snap / data-other / data-result  (element ids)
// snapdom loads lazily on first run so the button listener binds immediately,
// even before the CDN responds.
let _snapdom = null
async function loadSnapdom() {
  if (!_snapdom) {
    _snapdom = import('https://unpkg.com/@zumer/snapdom/dist/snapdom.mjs').then((m) => m.snapdom)
  }
  return _snapdom
}

const LIBS = {
  'html-to-image': {
    name: 'html-to-image',
    async load() {
      const m = await import('https://cdn.jsdelivr.net/npm/html-to-image/+esm')
      return async (el) => m.toPng(el)
    },
  },
  'modern-screenshot': {
    name: 'modern-screenshot',
    async load() {
      const m = await import('https://cdn.jsdelivr.net/npm/modern-screenshot/+esm')
      return async (el) => m.domToPng(el)
    },
  },
  'dom-to-image': {
    name: 'dom-to-image',
    async load() {
      const m = await import('https://cdn.jsdelivr.net/npm/dom-to-image/+esm')
      const lib = m.default || m
      return async (el) => lib.toPng(el)
    },
  },
}

const RUNS = 5

function dataUrlToImg(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

function progress(box, text) {
  box.innerHTML = '<div class="progress-message"></div>'
  box.firstChild.textContent = text
}

function crash(box, name, message) {
  box.innerHTML = ''
  const wrap = document.createElement('div')
  wrap.className = 'bench-crash'
  const tag = document.createElement('div')
  tag.className = 'bench-crash-tag'
  tag.textContent = name + ' crashed'
  const msg = document.createElement('div')
  msg.className = 'bench-crash-msg'
  msg.textContent = message
  wrap.append(tag, msg)
  box.appendChild(wrap)
}

// Double rAF lets the progress message paint; the setTimeout fallback keeps the
// run moving when rAF is throttled (background/occluded tab).
const tick = () => new Promise((r) => {
  requestAnimationFrame(() => requestAnimationFrame(r))
  setTimeout(r, 150)
})

document.querySelectorAll('.run-benchmark-button').forEach((b) => {
  b.addEventListener('click', () => runBenchmark(b))
})

async function runBenchmark(btn) {
  const lib = LIBS[btn.dataset.lib]
  const el = document.getElementById(btn.dataset.target)
  const snapBox = document.getElementById(btn.dataset.snap)
  const otherBox = document.getElementById(btn.dataset.other)
  const out = document.getElementById(btn.dataset.result)
  if (!lib || !el || !snapBox || !otherBox || !out) return

  snapBox.classList.remove('winner-glow')
  otherBox.classList.remove('winner-glow')
  out.textContent = ''
  btn.disabled = true
  btn.textContent = 'Running benchmark…'

  progress(snapBox, 'Loading SnapDOM…')
  const snapdom = await loadSnapdom()

  // SnapDOM: 5 PNG exports, averaged
  let snapTotal = 0
  for (let i = 0; i < RUNS; i++) {
    progress(snapBox, 'SnapDOM: capture ' + (i + 1) + '/' + RUNS + '…')
    await tick()
    const t0 = performance.now()
    const img = await snapdom.toPng(el)
    snapTotal += performance.now() - t0
    snapBox.innerHTML = ''
    snapBox.appendChild(img)
    await tick()
  }
  const snapAvg = snapTotal / RUNS
  snapBox.insertAdjacentHTML('beforeend', '<div class="result-message">avg ' + snapAvg.toFixed(1) + ' ms</div>')

  // Competitor: same 5 PNG exports
  let otherFn = null
  let otherError = null
  progress(otherBox, 'Loading ' + lib.name + '…')
  await tick()
  try {
    otherFn = await lib.load()
  } catch (e) {
    otherError = 'failed to load from CDN: ' + (e && e.message ? e.message : String(e))
  }

  let otherTotal = 0
  if (otherFn) {
    for (let i = 0; i < RUNS; i++) {
      progress(otherBox, lib.name + ': capture ' + (i + 1) + '/' + RUNS + '…')
      await tick()
      const t0 = performance.now()
      try {
        const dataUrl = await otherFn(el)
        otherTotal += performance.now() - t0
        const img = await dataUrlToImg(dataUrl)
        otherBox.innerHTML = ''
        otherBox.appendChild(img)
      } catch (err) {
        otherError = err && err.message ? err.message : String(err)
        break
      }
      await tick()
    }
  }

  if (otherError) {
    crash(otherBox, lib.name, otherError)
    out.innerHTML = 'SnapDOM rendered this in <strong>' + snapAvg.toFixed(1) + ' ms</strong> · ' +
      '<span style="color:var(--rose,#E63946)">' + lib.name + ' did not finish</span>'
    snapBox.classList.add('winner-glow')
  } else {
    const otherAvg = otherTotal / RUNS
    otherBox.insertAdjacentHTML('beforeend', '<div class="result-message">avg ' + otherAvg.toFixed(1) + ' ms</div>')
    if (snapAvg <= otherAvg) {
      out.textContent = 'SnapDOM wins — ' + (otherAvg / snapAvg).toFixed(1) + '× faster'
      snapBox.classList.add('winner-glow')
    } else {
      out.textContent = lib.name + ' wins — ' + (snapAvg / otherAvg).toFixed(1) + '× faster'
      otherBox.classList.add('winner-glow')
    }
  }

  btn.disabled = false
  btn.textContent = 'Run benchmark again'
}
