// PNG via rasterize; acepta Element o dataURL (SVG)
import { rasterize } from '../modules/rasterize.js'
import { captureDOM } from '../core/capture.js'

/**
 * @param {HTMLElement|string} elOrUrl
 * @param {object} opts
 * @returns {Promise<HTMLImageElement|string|HTMLCanvasElement|Blob>} según tu contrato de `rasterize`
 */
export async function toPng(elOrUrl, opts = {}) {
  /* c8 ignore start -- direct-exporter entry: the pipeline always hands these a url
     string, so the element branch is only for someone importing the exporter directly. */
  const url = typeof elOrUrl === 'string' ? elOrUrl : await captureDOM(elOrUrl, opts)
  /* c8 ignore stop */
  return rasterize(url, { ...opts, format: 'png' })
}
