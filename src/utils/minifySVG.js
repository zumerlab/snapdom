/**
 * Removes unnecessary whitespace from SVG string
 * @param {string} svgString - SVG XML string
 * @returns {string} Minified SVG string
 */
export function minifySVG(svgString) {
  return svgString.replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').replace(/\n/g, '').trim();
}
