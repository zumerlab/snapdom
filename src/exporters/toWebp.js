import { rasterize } from '../modules/rasterize.js'
import { captureDOM } from '../core/capture.js'

export async function toWebp(elOrUrl, opts = {}) {
  const url = typeof elOrUrl === 'string' ? elOrUrl : await captureDOM(elOrUrl, opts)
  return rasterize(url, { ...opts, format: 'webp' })
}
