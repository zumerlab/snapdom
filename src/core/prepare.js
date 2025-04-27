import { getDefaultStyles, generateReusableCSSClasses } from '../utils/cssTools.js';
import { deepCloneWithShadow } from './clone.js';
import { inlineImages } from '../modules/images.js';
import { inlineBackgroundImages } from '../modules/background.js';
import { inlinePseudoElements } from '../modules/pseudo.js';
import { applyFontClasses } from '../modules/fonts.js';

/**
 * Prepares a clone of an element with all its styles and content
 * @param {Element} element - Element to clone
 * @returns {Promise<Object>} Object containing the clone, CSS, and style cache
 */
export async function prepareClone(element) {
  const styleMap = new Map();
  const styleCache = new WeakMap();
  const nodeMap = new WeakMap();
  let defaults;
  try {
    defaults = getDefaultStyles();
  } catch (e) {
    console.warn('getDefaultStyles failed:', e);
    defaults = {};
  }

  let clone;
  try {
    clone = deepCloneWithShadow(element, styleMap, defaults, styleCache, nodeMap);
  } catch (e) {
    console.warn('deepCloneWithShadow failed:', e);
    throw e;
  }

  try {
    await inlineImages(clone);
  } catch (e) {
    console.warn('inlineImages failed:', e);
  }

  try {
    await inlineBackgroundImages(element, clone, styleCache);
  } catch (e) {
    console.warn('inlineBackgroundImages failed:', e);
  }

  try {
    await inlinePseudoElements(element, clone);
  } catch (e) {
    console.warn('inlinePseudoElements failed:', e);
  }

  // Generate optimized CSS classes from the collected styles
  const keyToClass = generateReusableCSSClasses(styleMap);
  const classCSS = Array.from(keyToClass.entries()).map(([key, className]) => `.${className}{${key}}`).join('');

  // Apply classes to elements and remove inline styles
  for (const [node, key] of styleMap.entries()) {
    if (node.tagName === 'STYLE') continue;

    const className = keyToClass.get(key);
    if (className) {
      node.classList.add(className);
      try {
        applyFontClasses(node, nodeMap.get(node), styleCache);
      } catch (e) {
        console.warn('applyFontClasses failed for node:', node, e);
      }
    }

    // Preserve background images while removing other inline styles
    const bgImage = node.style?.backgroundImage;
    node.removeAttribute('style');
    if (bgImage && bgImage !== 'none') node.style.backgroundImage = bgImage;
  }

  return { clone, classCSS, styleCache };
}
