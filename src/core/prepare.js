/**
 * Prepara un clon profundo de un elemento, inlinando pseudo-elementos y generando CSS de clases.
 * No se encarga de imágenes, backgrounds ni fuentes.
 * @module prepare
 */

import { generateCSSClasses } from '../utils/cssTools.js';
import { stripTranslate } from '../utils/helpers.js';
import { deepClone } from './clone.js';
import { inlinePseudoElements } from '../modules/pseudo.js';

/**
 * @typedef {Object} PreparedClone
 * @property {Element} clone - Árbol DOM clonado y estilizado (listo para renderizar)
 * @property {string} classCSS - CSS de clases generado (si compress=true)
 * @property {WeakMap} styleCache - Cache de estilos computados
 */

/**
 * Prepara un clon de un elemento para captura, inlinando pseudo-elementos y generando CSS de clases.
 * No procesa imágenes, backgrounds ni fuentes.
 *
 * @param {Element} element - Elemento a clonar
 * @param {boolean} [compress=false] - Si se debe comprimir el CSS
 * @param {boolean} [embedFonts=false] - (Ignorado aquí, solo se pasa a inlinePseudoElements)
 * @returns {Promise<PreparedClone>} Objeto con el clon, CSS de clases y styleCache
 */
export async function prepareClone(element, compress = false, embedFonts = false) {
  const styleMap = new Map();
  const styleCache = new WeakMap();
  const nodeMap = new Map();
  let clone;
  try {
    clone = deepClone(element, styleMap, styleCache, nodeMap, compress);
  } catch (e) {
    console.warn("deepClone failed:", e);
    throw e;
  }
  try {
    await inlinePseudoElements(element, clone, styleMap, styleCache, compress, embedFonts);
  } catch (e) {
    console.warn("inlinePseudoElements failed:", e);
  }
  let classCSS = "";
  if (compress) {
    const keyToClass = generateCSSClasses(styleMap);
    classCSS = Array.from(keyToClass.entries())
      .map(([key, className]) => `.${className}{${key}}`)
      .join("");
    for (const [node, key] of styleMap.entries()) {
      if (node.tagName === "STYLE") continue;
      const className = keyToClass.get(key);
      if (className) node.classList.add(className);
      const bgImage = node.style?.backgroundImage;
      node.removeAttribute("style");
      if (bgImage && bgImage !== "none") node.style.backgroundImage = bgImage;
    }
  } else {
    for (const [node, key] of styleMap.entries()) {
      if (node.tagName === "STYLE") continue;
      node.setAttribute("style", key.replace(/;/g, "; "));
    }
  }
  applyScrollToClones(nodeMap);
  normalizeRootCloneStyles(clone, element, nodeMap, styleCache);
  return { clone, classCSS, styleCache };
}

function applyScrollToClones(nodeMap) {
  for (const [cloneNode, originalNode] of nodeMap.entries()) {
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
}

function normalizeRootCloneStyles(clone, element, nodeMap, styleCache) {
  if (element === nodeMap.get(clone)) {
    const computed = styleCache.get(element) || window.getComputedStyle(element);
    styleCache.set(element, computed);
    const transform = stripTranslate(computed.transform);
    clone.style.margin = '0';
    clone.style.position = 'static';
    clone.style.top = 'auto';
    clone.style.left = 'auto';
    clone.style.right = 'auto';
    clone.style.bottom = 'auto';
    clone.style.zIndex = 'auto';
    clone.style.float = 'none';
    clone.style.clear = 'none';
    clone.style.transform = transform || "";
  }
}
