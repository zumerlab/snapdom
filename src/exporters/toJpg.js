import { rasterize } from '../modules/rasterize.js'
import { captureDOM } from '../core/capture.js'

export async function toJpg(elOrUrl, opts = {}) {
  // El normalizador de JPEG→fondo blanco ya corre en snapdom.capture(),
  // pero por si alguien llama directo al exporter:
  const next = { backgroundColor: '#ffffff', ...opts }
  /* c8 ignore start -- direct-exporter entry: the pipeline always hands these a url
     string, so the element branch is only for someone importing the exporter directly. */
  const url = typeof elOrUrl === 'string' ? elOrUrl : await captureDOM(elOrUrl, next)
  /* c8 ignore stop */
  return rasterize(url, { ...next, format: 'jpeg' })
}
