import { prepareClone } from './prepare.js';
import { inlineFonts } from '../modules/fonts.js';
import { minifySVG } from '../utils/minifySVG.js';

/**
 * Captures an HTML element as an SVG data URL
 * @param {Element} element - DOM element to capture
 * @param {Object} [options={}] - Capture options
 * @param {number} [options.scale=1] - Scale factor for the output image
 * @returns {Promise<string>} Promise that resolves to SVG data URL
 */

export async function capture(element, options = {}) {
  const { scale = 1} = options;
  let clone, classCSS, styleCache;
  try {
    ({ clone, classCSS, styleCache } = await prepareClone(element));
  } catch (e) {
    console.error("prepareClone failed:", e);
    throw e;
  }
  const rect = element.getBoundingClientRect();
  const w = rect.width * scale;
  const h = rect.height * scale;
  let fonts = "";
  try {
    fonts = await inlineFonts(styleCache);
  } catch (e) {
    console.warn("inlineFonts failed:", e);
  }
   // Create SVG container
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  // Create foreignObject to contain HTML content
  const fo = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
  fo.setAttribute("width", "100%");
  fo.setAttribute("height", "100%");
  // Create container for HTML content
  const div = document.createElement("div");
  div.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  div.setAttribute("style", `width:${w}px;height:${h}px;`);
  // Add style and content to the container
  const styleTag = document.createElement("style");
  styleTag.textContent = fonts + "svg{overflow:visible}" + classCSS;
  div.appendChild(styleTag);
  div.appendChild(clone);
  fo.appendChild(div);
  svg.appendChild(fo);
  try {
     // Serialize and encode SVG
    const svgStr = new XMLSerializer().serializeToString(svg);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(minifySVG(svgStr))}`;
  } catch (e) {
    console.error("SVG serialization failed:", e);
    throw e;
  }
}
