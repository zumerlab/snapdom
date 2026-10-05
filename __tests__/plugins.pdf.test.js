import { afterEach, expect, it } from 'vitest'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/build/pdf.mjs'
import { snapdom } from '../src/index.js'
import { pdf, redactInputs } from '../packages/plugins/index.js'

GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href

afterEach(() => { document.body.innerHTML = '' })

it('exports the frozen capture as a searchable PDF and preserves redaction', async () => {
  const root = document.createElement('section')
  root.style.cssText = 'width:320px;padding:20px;background:white;color:black;font:16px Arial'
  root.innerHTML = '<h2>Original report</h2><p>Invoice total 125</p><input type="email" value="private@example.com">'
  document.body.append(root)
  const capture = await snapdom(root, {
    dpr: 1, embedFonts: false,
    plugins: [redactInputs(), pdf()],
  })
  root.querySelector('h2').textContent = 'Changed after capture'
  const blob = await capture.toPdf({ page: 'a4' })
  expect(blob.type).toBe('application/pdf')
  const pdfDocument = await getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise
  try {
    expect(pdfDocument.numPages).toBeGreaterThan(0)
    const page = await pdfDocument.getPage(1)
    const text = (await page.getTextContent()).items.map(item => item.str).join(' ').replace(/\s+/g, ' ')
    expect(text).toContain('Original report')
    expect(text).toContain('Invoice total 125')
    expect(text).not.toContain('Changed after capture')
    expect(text).not.toContain('private@example.com')
  } finally {
    await pdfDocument.destroy()
  }
})
