import { generateCSSClasses} from '../utils/cssTools.js';
import { deepClone } from './clone.js';
import { inlinePseudoElements } from '../modules/pseudo.js';

/**
 * Prepares a clone of an element
 * @param {Element} element - Element to clone
 * @returns {Promise<Object>} Object containing the clone, CSS, and style cache
 */

export async function prepareClone(element, compress = false) {
  const styleMap = new Map();
  const styleCache = new WeakMap();
  const nodeMap = new WeakMap();
  let clone;

  try {
    clone = deepClone(element, styleMap, styleCache, nodeMap, compress);
  } catch (e) {
    console.warn("deepClone failed:", e);
    throw e;
  }

  try {
    await inlinePseudoElements(element, clone, styleMap, styleCache, compress);
  } catch (e) {
    console.warn("inlinePseudoElements failed:", e);
  }

  const keyToClass = generateCSSClasses(styleMap);
  const classCSS = Array.from(keyToClass.entries())
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

  return { clone, classCSS, styleCache };
}
