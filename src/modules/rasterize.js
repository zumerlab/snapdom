// src/exporters/rasterize.js
import { toCanvas } from '../exporters/toCanvas.js'

/**
 * Converts to an HTMLImageElement with raster format.
 * @param {string} url
 * @param {{ format:'png'|'jpeg'|'webp', dpr:number, quality?:number, backgroundColor?:string }} options
 * @returns {Promise<HTMLImageElement>}
 */
export async function rasterize(url, options) {
  const canvas = await toCanvas(url, options) // backgroundColor ya aplicado si existe

  const img = new Image()
  img.src = canvas.toDataURL(`image/${options.format}`, options.quality)
  await img.decode()

  img.style.width = `${canvas.width / options.dpr}px`
  img.style.height = `${canvas.height / options.dpr}px`
  return img
}
