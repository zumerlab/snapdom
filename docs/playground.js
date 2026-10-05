import { loadSnapdom, loadPlugin, mountSample } from './demo-runtime.js'
const form = document.querySelector('#capture-settings')
const source = document.querySelector('#capture-source')
const output = document.querySelector('#capture-output')
const status = document.querySelector('#capture-status')
const code = document.querySelector('#capture-code')
const presets = [
  {}, { sample: 'form', prepare: 'redact' }, { sample: 'form', exclude: true },
  { sample: 'social', export: 'jpeg' }, { sample: 'invoice', prepare: 'timestamp' },
  { sample: 'form', output: 'map' }, { sample: 'svg', output: 'ascii' },
  { sample: 'invoice', export: 'pdf' }, { sample: 'svg', export: 'vector' },
]
let card, fileURL
const settings = () => Object.fromEntries(new FormData(form))
function updateCode() {
  const s = settings(), imports = [], plugins = []
  const add = (name, factory, args = '') => { imports.push(`import { ${factory} } from '@zumer/snapdom-plugins/${name}';`); plugins.push(`${factory}(${args})`) }
  if (s.prepare === 'redact') add('redact-inputs', 'redactInputs')
  if (s.prepare === 'timestamp') add('timestamp-overlay', 'timestampOverlay')
  if (s.output === 'map') add('agent-map', 'agentMap')
  if (s.output === 'ascii') add('ascii-export', 'asciiExport', '{ width: 46 }')
  if (s.output === 'none' && s.export === 'pdf') add('pdf', 'pdf')
  if (s.output === 'none' && s.export === 'vector') add('vector', 'vector')
  const method = s.output === 'map' ? 'toAgentMap' : s.output === 'ascii' ? 'toAscii' : { png:'toPng', jpeg:'toJpg', webp:'toWebp', svg:'toSvg', canvas:'toCanvas', pdf:'toPdf', vector:'toVector' }[s.export]
  code.textContent = `import { snapdom } from '@zumer/snapdom';\n${imports.join('\n')}\n\nconst result = await snapdom(element, {\n  scale: ${s.scale},\n  backgroundColor: '${s.background}',${s.exclude ? "\n  exclude: '.demo-input'," : ''}${plugins.length ? `\n  plugins: [${plugins.join(', ')}],` : ''}\n});\nconst output = await result.${method}();`
}
function setPreset(i) {
  form.reset()
  for (const [key, value] of Object.entries(presets[i])) {
    if (key === 'exclude') form.elements[key].checked = value
    else form.elements[key].value = value
  }
  document.querySelectorAll('[data-preset]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.preset === i)))
  card = mountSample(source, settings().sample)
  output.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'Nothing captured yet.' }))
  status.textContent = 'Ready. Edit the sample before capturing.'
  updateCode()
}
document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => setPreset(+b.dataset.preset)))
form.addEventListener('change', event => {
  document.querySelectorAll('[data-preset]').forEach(b => b.setAttribute('aria-pressed', 'false'))
  if (event.target.name === 'sample') card = mountSample(source, settings().sample)
  updateCode()
})
document.querySelector('#capture-copy').addEventListener('click', async event => {
  try { await navigator.clipboard.writeText(code.textContent); event.target.textContent = 'Copied'; setTimeout(() => { event.target.textContent = 'Copy' }, 1400) }
  catch { status.textContent = 'Clipboard unavailable. Select and copy the code below.' }
})
form.addEventListener('submit', async event => {
  event.preventDefault()
  const selected = settings()
  ;[...form.elements, ...document.querySelectorAll('[data-preset]')].forEach(el => { el.disabled = true })
  status.textContent = 'Loading and capturing…'
  try {
    const s = selected, plugins = []
    const add = async (name, factory, options) => plugins.push((await loadPlugin(name))[factory](options))
    if (s.prepare === 'redact') await add('redact-inputs', 'redactInputs')
    if (s.prepare === 'timestamp') await add('timestamp-overlay', 'timestampOverlay')
    if (s.output === 'map') await add('agent-map', 'agentMap')
    if (s.output === 'ascii') await add('ascii-export', 'asciiExport', { width: 46 })
    if (s.output === 'none' && s.export === 'pdf') await add('pdf', 'pdf')
    if (s.output === 'none' && s.export === 'vector') await add('vector', 'vector')
    const snapdom = await loadSnapdom(), t0 = performance.now()
    const result = await snapdom(card, { plugins, scale: +s.scale, backgroundColor: s.background, exclude: s.exclude ? '.demo-input' : undefined })
    if (fileURL) { URL.revokeObjectURL(fileURL); fileURL = null }
    let node, label = s.output === 'none' ? s.export.toUpperCase() : s.output
    if (s.output === 'ascii') node = Object.assign(document.createElement('pre'), { textContent: await result.toAscii() })
    else if (s.output === 'map') {
      const map = await result.toAgentMap()
      node = new Image(); node.src = map.image; node.alt = 'Annotated element map'
    } else if (s.export === 'pdf') {
      fileURL = URL.createObjectURL(await result.toPdf())
      node = Object.assign(document.createElement('a'), { href: fileURL, download: 'capture.pdf', textContent: 'Download PDF' })
    } else if (s.export === 'vector') {
      const svg = await result.toVector()
      fileURL = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
      node = document.createElement('div')
      const img = new Image(); img.src = fileURL; img.alt = 'Editable vector artwork'
      node.append(img, Object.assign(document.createElement('a'), { href: fileURL, download: 'capture.svg', textContent: 'Download vector SVG' }))
    } else node = await result[{ png:'toPng', jpeg:'toJpg', webp:'toWebp', svg:'toSvg', canvas:'toCanvas' }[s.export]]()
    if (node instanceof HTMLImageElement) node.alt ||= 'Captured output'
    output.replaceChildren(node)
    status.textContent = `${label} ready · ${Math.round(performance.now() - t0)} ms`
  } catch (error) { status.textContent = `Error: ${error.message}` }
  finally { [...form.elements, ...document.querySelectorAll('[data-preset]')].forEach(el => { el.disabled = false }) }
})
setPreset(0)
