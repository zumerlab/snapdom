// PNG via rasterize; acepta Element o dataURL (SVG)
import { rasterize } from '../modules/rasterize.js'
import { captureDOM } from '../core/capture.js'

/**
 * @param {HTMLElement|string} elOrUrl
 * @param {object} opts
 * @returns {Promise<HTMLImageElement|string|HTMLCanvasElement|Blob>} según tu contrato de `rasterize`
 */
export async function toPng(elOrUrl, opts = {}) {
  const url = typeof elOrUrl === 'string' ? elOrUrl : await captureDOM(elOrUrl, opts)
  return rasterize(url, { ...opts, format: 'png' })
}
