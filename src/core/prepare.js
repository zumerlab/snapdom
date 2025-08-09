/**
 * Prepares a deep clone of an element, inlining pseudo-elements and generating CSS classes.
 * @module prepare
 */

import { generateCSSClasses} from '../utils/cssTools.js';
import { stripTranslate} from '../utils/helpers.js';
import { deepClone } from './clone.js';
import { inlinePseudoElements } from '../modules/pseudo.js';
import { inlineExternalDefsAndSymbols} from '../modules/svgDefs.js';
import { cache } from '../core/cache.js';

/**
 * Prepares a clone of an element for capture, inlining pseudo-elements and generating CSS classes.
 *
 * @param {Element} element - Element to clone
 * @param {boolean} [compress=false] - Whether to compress style keys
 * @param {boolean} [embedFonts=false] - Whether to embed custom fonts
 * @param {Object} [options={}] - Capture options
 * @param {string[]} [options.exclude] - CSS selectors for elements to exclude
 * @param {Function} [options.filter] - Custom filter function
 * @returns {Promise<Object>} Object containing the clone, generated CSS, and style cache
 */

export async function prepareClone(element, compress = false, embedFonts = false, options = {}) {
  let clone
  let classCSS = '';
  
  stabilizeLayout(element)

  try {
    inlineExternalDefsAndSymbols(element)
  } catch (e) {
    console.warn("inlineExternal defs or symbol failed:", e);
  }


  try {
    clone = deepClone(element, compress, options, element);
  } catch (e) {
    console.warn("deepClone failed:", e);
    throw e;
  }
  try {
    await inlinePseudoElements(element, clone, compress, embedFonts, options.useProxy);
  } catch (e) {
    console.warn("inlinePseudoElements failed:", e);
  }
  if (compress) {
  const keyToClass = generateCSSClasses();
  classCSS = Array.from(keyToClass.entries())
    .map(([key, className]) => `.${className}{${key}}`)
    .join("");
  
  for (const [node, key] of cache.preStyleMap.entries()) {
    if (node.tagName === "STYLE") continue;

    // Detecta si el nodo está dentro de Shadow DOM
    if (node.getRootNode && node.getRootNode() instanceof ShadowRoot) {
      // Dentro de Shadow DOM: aplica estilos inline completos (sin clases)
      node.setAttribute("style", key.replace(/;/g, "; "));
      continue;
    }

    // Fuera de Shadow DOM: aplica clase generada para compresión
    const className = keyToClass.get(key);
    if (className) node.classList.add(className);

    // Reaplica backgroundImage para evitar que se pierda (si existe)
    const bgImage = node.style?.backgroundImage;
    const hasIcon = node.dataset?.snapdomHasIcon;
    if (bgImage && bgImage !== "none") node.style.backgroundImage = bgImage;
    if (hasIcon) {
      node.style.verticalAlign = "middle";
      node.style.display = "inline";
    }
  }
} else {
  // Sin compresión: siempre estilos inline completos
  for (const [node, key] of cache.preStyleMap.entries()) {
    if (node.tagName === "STYLE") continue;
    node.setAttribute("style", key.replace(/;/g, "; "));
  }
}

  for (const [cloneNode, originalNode] of cache.preNodeMap.entries()) {
    const scrollX = originalNode.scrollLeft;
    const scrollY = originalNode.scrollTop;
    const hasScroll = scrollX || scrollY;
    if (hasScroll && cloneNode instanceof HTMLElement) {
      cloneNode.style.overflow = "hidden";
      cloneNode.style.scrollbarWidth = "none";
      cloneNode.style.msOverflowStyle = "none";
      const inner = document.createElement("div");
      inner.style.transform = `translate(${-scrollX}px, ${-scrollY}px)`;
      inner.style.willChange = "transform";
      inner.style.display = "inline-block";
      inner.style.width = "100%";
      while (cloneNode.firstChild) {
        inner.appendChild(cloneNode.firstChild);
      }
      cloneNode.appendChild(inner);
    }
  }
  if (element === cache.preNodeMap.get(clone)) {
    const computed = cache.preStyle.get(element) || window.getComputedStyle(element);
    cache.preStyle.set(element, computed);
    const transform = stripTranslate(computed.transform);
    clone.style.margin = "0";
    clone.style.position = "static";
    clone.style.top = "auto";
    clone.style.left = "auto";
    clone.style.right = "auto";
    clone.style.bottom = "auto";
    clone.style.zIndex = "auto";
    clone.style.float = "none";
    clone.style.clear = "none";
    clone.style.transform = transform || "";
  }
  for (const [cloneNode, originalNode] of cache.preNodeMap.entries()) {
    if (originalNode.tagName === "PRE") {
      cloneNode.style.marginTop = "0";
      cloneNode.style.marginBlockStart = "0";
    }
  }
  return { clone, classCSS };
}

function stabilizeLayout(element) {
  const style = getComputedStyle(element);
  const outlineStyle = style.outlineStyle;
  const outlineWidth = style.outlineWidth;
  const borderStyle = style.borderStyle;
  const borderWidth = style.borderWidth;

  const outlineVisible = outlineStyle !== 'none' && parseFloat(outlineWidth) > 0;
  const borderAbsent = (borderStyle === 'none' || parseFloat(borderWidth) === 0);

  if (outlineVisible && borderAbsent) {
    element.style.border = `${outlineWidth} solid transparent`;
  }
}

