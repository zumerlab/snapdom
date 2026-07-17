// Shared "try it live" widget for guides and how-to pages.
// Wire a button with:
//   data-demo-action="png" | "svg" | "canvas" | "download" | "blob"
//   data-demo-target="<id of element to capture>"
//   data-demo-output="<id of output container>"
//   data-demo-options='{"scale":2}'   (optional, JSON)
//   data-demo-filename="card"        (optional, download only)
// snapdom loads lazily on first click so button listeners bind immediately,
// even before the CDN responds.
let _snapdom = null
async function loadSnapdom() {
  if (!_snapdom) {
    _snapdom = import('https://unpkg.com/@zumer/snapdom/dist/snapdom.mjs').then((m) => {
      window.snapdom = m.snapdom
      return m.snapdom
    })
  }
  return _snapdom
}

function hint(output, text, isError) {
  output.innerHTML = ''
  const span = document.createElement('span')
  span.className = 'demo-hint' + (isError ? ' demo-error' : '')
  span.textContent = text
  output.appendChild(span)
}

function show(output, result, note) {
  output.innerHTML = ''
  output.appendChild(result)
  const span = document.createElement('span')
  span.className = 'demo-hint'
  span.textContent = note
  output.appendChild(span)
}

document.querySelectorAll('[data-demo-action]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const target = document.getElementById(btn.dataset.demoTarget)
    const output = document.getElementById(btn.dataset.demoOutput)
    if (!target || !output) return

    let options = {}
    try { options = btn.dataset.demoOptions ? JSON.parse(btn.dataset.demoOptions) : {} } catch { /* ignore */ }

    const label = btn.textContent
    btn.disabled = true
    btn.textContent = 'Capturing…'

    try {
      const snapdom = await loadSnapdom()
      const action = btn.dataset.demoAction
      if (action === 'download') {
        const filename = btn.dataset.demoFilename || 'snapdom-demo'
        const format = btn.dataset.demoFormat || 'png'
        const result = await snapdom(target, options)
        await result.download({ format, filename })
        hint(output, 'Downloaded ' + filename + '.' + format + ' — check your downloads folder.')
      } else if (action === 'blob') {
        const t0 = performance.now()
        const blob = await snapdom.toBlob(target, { ...options, type: 'png' })
        const ms = performance.now() - t0
        const img = new Image()
        img.src = URL.createObjectURL(blob)
        await img.decode()
        const dpr = window.devicePixelRatio || 1
        img.style.width = (img.naturalWidth / dpr) + 'px'
        img.style.height = (img.naturalHeight / dpr) + 'px'
        show(output, img, 'Blob · ' + blob.type + ' · ' + (blob.size / 1024).toFixed(1) + ' KB · ' + ms.toFixed(0) + ' ms — ready to append to FormData and upload.')
      } else if (action === 'svg') {
        const t0 = performance.now()
        const img = await snapdom.toSvg(target, options)
        const ms = performance.now() - t0
        show(output, img, 'snapdom.toSvg — scalable SVG foreignObject · ' + ms.toFixed(0) + ' ms')
      } else if (action === 'canvas') {
        const t0 = performance.now()
        const canvas = await snapdom.toCanvas(target, options)
        const ms = performance.now() - t0
        canvas.style.maxWidth = '100%'
        canvas.style.height = 'auto'
        show(output, canvas, 'snapdom.toCanvas — ' + ms.toFixed(0) + ' ms · ' + canvas.width + '×' + canvas.height + ' px')
      } else {
        const t0 = performance.now()
        const img = await snapdom.toPng(target, options)
        const ms = performance.now() - t0
        show(output, img, 'snapdom.toPng — ' + ms.toFixed(0) + ' ms · ' + img.naturalWidth + '×' + img.naturalHeight + ' px')
      }
    } catch (err) {
      hint(output, 'Capture failed: ' + (err && err.message ? err.message : String(err)), true)
    } finally {
      btn.disabled = false
      btn.textContent = label
    }
  })
})
