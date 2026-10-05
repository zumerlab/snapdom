import { loadSnapdom, loadPlugin, mountSample } from './demo-runtime.js'
const panel = document.querySelector('[data-export-demo]')
const format = panel.dataset.exportDemo
const form = panel.querySelector('[data-export-settings]')
const source = panel.querySelector('[data-export-source]')
const output = panel.querySelector('[data-pdf-output]')
const status = panel.querySelector('[data-export-status]')
const file = panel.querySelector('[data-export-file]')
const code = panel.querySelector('[data-export-code]')
const pages = panel.querySelector('[data-pdf-pages]')
const figma = panel.querySelector('[data-figma]')
let card, fileURL, pdfDocument, pageNumber = 1, lastResult, generation = 0
const options = () => ({ sample:form.elements.sample.value, page:form.elements.page?.value, text:form.elements.text?.checked, fields:form.elements.fields?.checked })
const heading = (kicker, title) => `<div class="sample-card-kicker">${kicker}</div><h2 data-title contenteditable="true" aria-label="Edit document title" style="font:700 21px Arial;margin:10px 0">${title}</h2>`
function updateCode() {
  const s = options()
  code.textContent = `import { snapdom } from '@zumer/snapdom';\nimport { ${format} } from '@zumer/snapdom-plugins/${format}';\n\nconst result = await snapdom(element, {\n  plugins: [${format}()],\n  dpr: 1\n});\n${format === 'pdf' ? `const blob = await result.toPdf({\n  page: '${s.page}',\n  text: ${s.text},\n  fields: ${s.fields}\n});` : 'const svg = await result.toVector();'}`
}
function clearOutput() {
  generation++
  if (fileURL) { URL.revokeObjectURL(fileURL); fileURL = null }
  pdfDocument?.destroy(); pdfDocument = null
  lastResult = null
  if (figma) figma.disabled = true
  output.replaceChildren(Object.assign(document.createElement('p'), { textContent:'Nothing generated yet.' }))
  file.replaceChildren(); pages.hidden = true
}
function setSample() {
  const s = options()
  if (format === 'vector') card = mountSample(source, s.sample)
  else {
    const samples = {
      report: heading('North Studio · October', 'Delivery report') + '<p contenteditable="true" aria-label="Edit report paragraph">Three interface screens shipped, reviewed and ready for implementation.</p><table><tr><th>Milestone</th><th>Status</th></tr><tr><td>Navigation</td><td>Approved</td></tr><tr><td>Capture demos</td><td>In review</td></tr></table><p><a href="https://github.com/zumerlab/snapdom">Read the project source</a></p>',
      ledger: heading('Ledger · A4 pagination', 'Project time ledger') + '<table><thead><tr><th>Item</th><th>Hours</th><th>Amount</th></tr></thead><tbody>' + Array.from({length:60},(_,i)=>`<tr><td>Design task ${i+1}</td><td>${2+i%5}</td><td>$${(2+i%5)*70}</td></tr>`).join('') + '</tbody></table>',
      scripts: heading('Multilingual document', 'Text across scripts') + '<p lang="zh">你好，世界</p><p lang="ru">Привет, мир</p><p lang="el">Γεια σου κόσμε</p><p lang="ar" dir="rtl">مرحباً بالعالم</p><p lang="he" dir="rtl">שלום עולם</p><p>Español · Français · 日本語 · 🌍</p>',
      controls: heading('Form values → PDF fields', 'Contact details') + '<label class="demo-input">Full name<input name="name" value="Ana Ruiz"></label><label class="demo-input">Email<input type="email" name="email" value="ana@example.com"></label><label class="demo-input">Password<input type="password" name="password" value="demo-password"></label><p><label><input type="checkbox" name="notify" checked> Send updates</label></p><label class="demo-input">Message<textarea name="message">Please send the document.</textarea></label>',
    }
    if (s.sample === 'transparent') { card = mountSample(source,'svg'); card.style.background = 'transparent'; card.style.border = '0' }
    else { source.innerHTML = `<div class="sample-card">${samples[s.sample]}</div>`; card = source.firstElementChild }
    if (s.sample === 'ledger') form.elements.page.value = 'a4'
  }
  clearOutput()
  status.textContent = `Edit the source, then generate ${format === 'pdf' ? 'a PDF' : 'vector artwork'}.`
  updateCode()
}
form.addEventListener('change',event => {
  if (event.target.name === 'sample') setSample()
  else { clearOutput(); updateCode(); status.textContent = 'Settings changed. Generate again to see the new output.' }
})
source.addEventListener('input', () => { status.textContent = 'Source changed. Generate again to capture these edits.' })
document.querySelectorAll('.pane-nav-head').forEach(button => button.addEventListener('click',() => button.setAttribute('aria-expanded', String(button.getAttribute('aria-expanded') !== 'true'))))
async function renderPage(pdfjs, token) {
  const current = await pdfDocument.getPage(pageNumber)
  const base = current.getViewport({ scale:1 })
  const width = output.clientWidth - 24
  const viewport = current.getViewport({ scale:width/base.width })
  const canvas = document.createElement('canvas'), density = devicePixelRatio || 1
  canvas.width = Math.ceil(viewport.width*density); canvas.height = Math.ceil(viewport.height*density)
  const preview = document.createElement('div'); preview.className = 'plugin-demo-preview'
  preview.style.width = viewport.width+'px'; preview.style.height = viewport.height+'px'
  preview.style.setProperty('--scale-factor',viewport.scale)
  preview.append(canvas)
  await current.render({ canvasContext:canvas.getContext('2d'), viewport, transform:[density,0,0,density,0,0] }).promise
  const layer = document.createElement('div'); layer.className = 'textLayer'; preview.append(layer)
  await new pdfjs.TextLayer({ textContentSource:await current.getTextContent(), container:layer, viewport }).render()
  if (token !== generation) return
  output.replaceChildren(preview)
  panel.querySelector('[data-pdf-page]').textContent = `${pageNumber} / ${pdfDocument.numPages}`
  panel.querySelector('[data-pdf-prev]').disabled = pageNumber === 1
  panel.querySelector('[data-pdf-next]').disabled = pageNumber === pdfDocument.numPages
  pages.hidden = pdfDocument.numPages === 1
}
let pdfjsPromise
function loadReader() {
  return pdfjsPromise ||= import(new URL('./pro/pdf/assets/pdfjs/pdf.mjs',import.meta.url).href).then(pdfjs => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pro/pdf/assets/pdfjs/pdf.worker.mjs',import.meta.url).href
    return pdfjs
  })
}
for (const [selector, delta] of [['[data-pdf-prev]',-1],['[data-pdf-next]',1]]) {
  panel.querySelector(selector).addEventListener('click',async () => {
    if (!pdfDocument) return
    pages.querySelectorAll('button').forEach(b => { b.disabled = true })
    pageNumber += delta
    try { await renderPage(await loadReader(),generation) }
    catch(error) { status.textContent = `Preview error: ${error.message}` }
  })
}
form.addEventListener('submit',async event => {
  event.preventDefault()
  const s = options()
  clearOutput()
  const token = generation
  Array.from(form.elements).forEach(control => { control.disabled = true })
  status.textContent = `Loading ${format} and capturing…`
  try {
    const snapdom = await loadSnapdom(), plugin = (await loadPlugin(format))[format]()
    const result = await snapdom(card,{ plugins:[plugin], dpr:1, backgroundColor:null })
    lastResult = result
    const value = format === 'pdf' ? await result.toPdf({ page:s.page, text:s.text, fields:s.fields, pageNumbers:s.page !== 'fit' }) : await result.toVector()
    const blob = format === 'pdf' ? value : new Blob([value],{type:'image/svg+xml'})
    fileURL = URL.createObjectURL(blob)
    const link = document.createElement('a'); link.href = fileURL; link.download = `${s.sample}.${format === 'pdf' ? 'pdf' : 'svg'}`
    link.textContent = `Download ${format === 'pdf' ? 'PDF' : 'SVG'} · ${(blob.size/1024).toFixed(1)} KB`
    file.replaceChildren(link)
    if (format === 'pdf') {
      const pdfjs = await loadReader()
      pdfDocument = await pdfjs.getDocument({ data:new Uint8Array(await blob.arrayBuffer()) }).promise
      pageNumber = 1
      try { await renderPage(pdfjs,token) }
      catch(error) { output.textContent = `PDF ready to download. Preview unavailable: ${error.message}` }
      status.textContent = `PDF generated · ${pdfDocument.numPages} ${pdfDocument.numPages === 1 ? 'page' : 'pages'} · ${s.text ? 'selectable text enabled' : 'image-only output'}${s.sample === 'controls' && s.fields ? ' · download to edit the form fields' : ''}`
    } else {
      const image = new Image(); image.src = fileURL; image.alt = 'Generated vector artwork'
      output.replaceChildren(image); figma.disabled = false
      status.textContent = 'SVG generated. Open the file in a vector editor or copy the capture to Figma.'
    }
  } catch(error) { status.textContent = `Error: ${error.message}` }
  finally { Array.from(form.elements).forEach(control => { control.disabled = false }) }
})
figma?.addEventListener('click',async () => {
  figma.disabled = true
  try { await lastResult.toFigma(); status.textContent = 'Copied. Paste into Figma.' }
  catch(error) { status.textContent = `Clipboard error: ${error.message}` }
  finally { figma.disabled = !lastResult }
})
window.addEventListener('pagehide',() => { if (fileURL) URL.revokeObjectURL(fileURL); pdfDocument?.destroy() })
setSample()
