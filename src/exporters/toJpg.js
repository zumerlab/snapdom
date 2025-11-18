import { rasterize } from '../modules/rasterize.js'
import { captureDOM } from '../core/capture.js'

export async function toJpg(elOrUrl, opts = {}) {
  // El normalizador de JPEG→fondo blanco ya corre en snapdom.capture(),
  // pero por si alguien llama directo al exporter:
  const next = { backgroundColor: '#ffffff', ...opts }
  const url = typeof elOrUrl === 'string' ? elOrUrl : await captureDOM(elOrUrl, next)
  return rasterize(url, { ...next, format: 'jpeg' })
}
