import { snapdom } from '@zumer/snapdom'
import { vector, pdf, htmlExport, contextExport, agentMap, asciiExport, gifExport, videoExport } from '../packages/plugins/index.js'
import type { AgentMapResult, ContextResult } from '../packages/plugins/index.js'

async function outputs(element: Element) {
  const capture = await snapdom(element, { plugins: [vector(), pdf(), htmlExport(), contextExport(), agentMap(), asciiExport(), gifExport(), videoExport()] })
  const svg: string = await capture.toVector({ exclude: '.private' })
  const clipboard: void = await capture.toFigma()
  const pdfBlob: Blob = await capture.toPdf({ page: 'a4', download: 'report.pdf' })
  const html: string = await capture.toHtml({ lang: 'es', title: 'Informe' })
  const tree: ContextResult = await capture.toContext({ format: 'json' })
  const outline: string = await capture.toContext({ format: 'outline' })
  const map: AgentMapResult = await capture.toAgentMap({ image: false })
  const ascii: string = await capture.toAscii({ width: 80 })
  const gif: Blob = await capture.toGif({ frames: 2 })
  const video: Blob = await capture.toMp4({ duration: 1000 })
  // @ts-expect-error Export options cannot recapture with a larger semantic budget.
  await capture.toContext({ maxNodes: 2000 })
  // @ts-expect-error PDF paper size must match the supported contract.
  await capture.toPdf({ page: 'banana' })
  return [svg, clipboard, pdfBlob, html, tree, outline, map, ascii, gif, video]
}
void outputs
