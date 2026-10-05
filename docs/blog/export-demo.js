import { buttonState } from '../demo-feedback.js'
import { loadSnapdom, loadPlugin } from '../demo-runtime.js'
const panel = document.querySelector('[data-blog-demo]')
const kind = panel.dataset.blogDemo
panel.innerHTML = `<form><label>Client / product name <input name="title" value="North Studio" maxlength="80"></label><div data-artwork style="padding:24px;margin:16px 0;border:1px solid #ccd5e5;border-radius:12px;background:#fff;color:#172747;font:16px Arial;box-shadow:0 8px 20px #17274715"><div style="font-size:12px;color:#4262a5">${kind === 'pdf' ? 'INVOICE INV-1042' : 'PRODUCT / TEAM PLAN'}</div><h3 data-title style="font-size:28px;margin:12px 0">North Studio</h3><div style="height:10px;background:linear-gradient(90deg,#2d5bff,#9cbbff);border-radius:6px"></div><p>${kind === 'pdf' ? 'Interface design · $840<br>Implementation · $560' : 'Collaborate on shipped interfaces.<br>Unlimited reviews · Shared components'}</p><strong>Total USD · $1,400</strong><p><a href="https://snapdom.dev/">Project details</a></p></div><div class="sample-card-actions">${kind === 'pdf' ? '<button type="button" data-export="snap">SnapDOM PDF</button><button type="button" data-export="bitmap">html2canvas + jsPDF</button><button type="button" data-export="text">jsPDF layout</button>' : '<button type="button" data-export="vector">Export editable SVG</button><button type="button" data-copy-figma disabled>Copy to Figma</button>'}</div></form><div data-downloads></div><p role="status" aria-live="polite">Edit the name, then export.</p>`
const source = panel.querySelector('[data-artwork]')
const status = panel.querySelector('[role=status]')
const buttons = [...panel.querySelectorAll('[data-export]')]
const copy = panel.querySelector('[data-copy-figma]')
const labels = new Map(buttons.map(button => [button, button.textContent]))
const urls = []
let lastResult
panel.querySelector('form').addEventListener('submit', e => e.preventDefault())
panel.querySelector('input').addEventListener('input', e => {
  source.querySelector('[data-title]').textContent = e.target.value
  lastResult = null
  buttons.forEach(button => buttonState(button, 'idle', labels.get(button)))
  buttonState(copy, 'idle', 'Copy to Figma')
  if (copy) copy.disabled = true
})
async function jspdf() {
  return (await import('https://esm.sh/jspdf@3.0.3')).jsPDF
}
async function offer(blob, name, evidence) {
  if (blob.type === 'application/pdf') {
    const pdfjs = await import('../pro/pdf/assets/pdfjs/pdf.mjs')
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../pro/pdf/assets/pdfjs/pdf.worker.mjs', import.meta.url).href
    const document = await pdfjs.getDocument({ data:new Uint8Array(await blob.arrayBuffer()) }).promise
    let textItems = 0, links = 0
    for (let i = 1; i <= document.numPages; i++) {
      const page = await document.getPage(i)
      textItems += (await page.getTextContent()).items.filter(item => item.str?.trim()).length
      links += (await page.getAnnotations()).filter(item => item.subtype === 'Link').length
    }
    evidence += `; parsed ${document.numPages} page(s), ${textItems} text items, ${links} links`
    await document.destroy()
  }
  const url = URL.createObjectURL(blob); urls.push(url)
  const row = document.createElement('p')
  const a = Object.assign(document.createElement('a'), { href:url, download:name, textContent:`Download ${name}` })
  row.append(a, document.createTextNode(` · ${blob.size.toLocaleString()} bytes · ${evidence}`))
  panel.querySelector('[data-downloads]').append(row)
}
buttons.forEach(button => button.addEventListener('click', async () => {
  buttons.forEach(b => { b.disabled = true }); if (copy) copy.disabled = true
  buttonState(button, 'busy', kind === 'pdf' ? 'Generating PDF…' : 'Exporting SVG…')
  panel.querySelector('input').disabled = true
  status.textContent = 'Generating…'
  try {
    await document.fonts.ready
    const route = button.dataset.export
    if (route === 'snap' || route === 'vector') {
      const snapdom = await loadSnapdom()
      const plugin = await loadPlugin(route === 'snap' ? 'pdf' : 'vector')
      const result = await snapdom(source, { plugins:[route === 'snap' ? plugin.pdf() : plugin.vector()], dpr:1 })
      if (route === 'snap') {
        const blob = await result.toPdf({ page:'a4', margin:36 })
        await offer(blob, 'snapdom-invoice.pdf', 'Capture image + searchable text layer')
        status.textContent = 'PDF generated. Download and search for the client name.'
      } else {
        const svg = await result.toVector()
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
        if (doc.querySelector('parsererror')) throw new Error('The exporter returned invalid SVG')
        await offer(new Blob([svg], { type:'image/svg+xml' }), 'product-card.svg', `${doc.querySelectorAll('text').length} text elements; ${doc.querySelectorAll('foreignObject').length} foreignObject elements`)
        lastResult = result; copy.disabled = false
        status.textContent = 'SVG generated. Inspect the text in your editor; Copy to Figma is now ready.'
      }
    } else {
      const JsPDF = await jspdf(); const doc = new JsPDF({ unit:'pt', format:'a4' })
      if (route === 'bitmap') {
        const html2canvas = (await import('https://esm.sh/html2canvas@1.4.1')).default
        const canvas = await html2canvas(source, { scale:1, backgroundColor:'#fff' })
        const width = doc.internal.pageSize.getWidth() - 72
        doc.addImage(canvas.toDataURL('image/png'), 'PNG', 36, 36, width, canvas.height * width / canvas.width)
      } else {
        doc.setFontSize(12); doc.text('INVOICE INV-1042',36,48)
        doc.setFontSize(24); doc.text(doc.splitTextToSize(source.querySelector('[data-title]').textContent,500),36,84)
        doc.setFontSize(14); doc.text('Interface design: $840\nImplementation: $560\n\nTotal USD: $1,400',36,180)
        doc.textWithLink('Project details',36,280,{ url:'https://snapdom.dev/' })
      }
      await offer(doc.output('blob'), route === 'bitmap' ? 'bitmap-invoice.pdf' : 'jspdf-layout.pdf', route === 'bitmap' ? 'Image only: this recipe adds no searchable text' : 'PDF text and link; independent document layout')
      status.textContent = 'PDF generated. Download and compare selection, links and layout.'
    }
    buttonState(button, 'success', kind === 'pdf' ? `${labels.get(button)} ready ✓ · Regenerate` : 'SVG ready ✓ · Export again')
  } catch (error) { buttonState(button, 'error', `${labels.get(button)} failed · Retry`); status.textContent = `Export failed: ${error.message}` }
  finally { panel.querySelector('input').disabled = false; buttons.forEach(b => { b.disabled = false }); if (copy) copy.disabled = !lastResult }
}))
copy?.addEventListener('click', () => {
  copy.disabled = true
  panel.querySelector('input').disabled = true
  buttons.forEach(button => { button.disabled = true })
  buttonState(copy, 'busy', 'Copying to Figma…')
  status.textContent = 'Copying artwork to the clipboard…'
  lastResult.toFigma().then(() => { buttonState(copy, 'success', 'Copied ✓ · Copy again'); status.textContent = 'Copied to clipboard. Now paste into Figma with Ctrl+V / ⌘V.' }, error => { buttonState(copy, 'error', 'Copy failed · Retry'); status.textContent = `Clipboard failed: ${error.message}` }).finally(() => { copy.disabled = !lastResult; panel.querySelector('input').disabled = false; buttons.forEach(button => { button.disabled = false }) })
})
window.addEventListener('pagehide', () => { urls.forEach(url => URL.revokeObjectURL(url)) })
