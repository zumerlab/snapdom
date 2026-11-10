import { snapdom } from '@zumer/snapdom'
import { jxl } from '../packages/plugins/jxl.js'

async function jpegXl(el: Element) {
  // The README's snippet.
  const result = await snapdom(el, { plugins: [jxl()] })
  const img: HTMLImageElement = await result.toJxl({ quality: 0.8 })
  const blob: Blob = await result.toBlob({ format: 'jxl' })
  await result.download({ format: 'jxl', filename: 'card' })
  await jxl({ effort: 5 }).close()
  // Core's own formats keep their strict union.
  const png: Blob = await result.toBlob({ format: 'png' })
  // @ts-expect-error Only the formats core or a plugin writes.
  await result.toBlob({ format: 'gif' })
  // @ts-expect-error Effort is 1-9.
  jxl({ effort: 10 })
  void img; void blob; void png
}
void jpegXl
