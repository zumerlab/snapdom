/**
 * Renders a DOM clone as a serialized SVG and dataURL.
 * Extracted from captureDOM for clarity and testability.
 * @param {Element} clone - Cloned and styled DOM tree
 * @param {Element} original - Original element (for measurements)
 * @param {Object} options - Render options (baseCSS, fontsCSS, classCSS, scale, width, height, fast)
 * @returns {{svgString: string, dataURL: string}}
 */
import { isSafari } from '../utils/helpers.js';

export function renderClone(clone, original, {
  baseCSS = '',
  fontsCSS = '',
  classCSS = '',
  scale = 1,
  width,
  height,
  fast = true,
  options = {}
} = {}) {
  const rect = original.getBoundingClientRect();
  let w = rect.width;
  let h = rect.height;
  const hasW = Number.isFinite(width);
  const hasH = Number.isFinite(height);
  const hasScale = typeof scale === 'number' && scale !== 1;
  if (!hasScale) {
    const aspect = rect.width / rect.height;
    if (hasW && hasH) {
      w = width;
      h = height;
    } else if (hasW) {
      w = width;
      h = w / aspect;
    } else if (hasH) {
      h = height;
      w = h * aspect;
    }
  }
  w = Math.ceil(w);
  h = Math.ceil(h);
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  clone.style.transformOrigin = 'top left';
  if (!hasScale && (hasW || hasH)) {
    const originalW = rect.width;
    const originalH = rect.height;
    const scaleX = w / originalW;
    const scaleY = h / originalH;
    const existingTransform = clone.style.transform || '';
    const scaleTransform = `scale(${scaleX}, ${scaleY})`;
    clone.style.transform = `${scaleTransform} ${existingTransform}`.trim();
  } else if (hasScale && isSafari()) {
    clone.style.scale = `${scale}`;
  }
  const svgNS = 'http://www.w3.org/2000/svg';
  const fo = document.createElementNS(svgNS, 'foreignObject');
  fo.setAttribute('width', '100%');
  fo.setAttribute('height', '100%');
  const styleTag = document.createElement('style');
  styleTag.textContent = baseCSS + fontsCSS + 'svg{overflow:visible;}' + classCSS;
  fo.appendChild(styleTag);
  fo.appendChild(clone);
  const serializer = new XMLSerializer();
  const foString = serializer.serializeToString(fo);
  const svgHeader = `<svg xmlns="${svgNS}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  const svgFooter = '</svg>';
  const svgString = svgHeader + foString + svgFooter;
  const dataURL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
  return { svgString, dataURL };
}
