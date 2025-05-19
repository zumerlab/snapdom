/**
 * Utilities for working with CSS styles, defaults, and class generation.
 * @module cssTools
 */

import { defaultStylesCache } from "../core/cache"

const commonTags = [
  'div', 'span', 'p', 'a', 'img', 'ul', 'li', 'button', 'input',
  'select', 'textarea', 'label', 'section', 'article', 'header',
  'footer', 'nav', 'main', 'aside', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'svg', 'path', 'circle', 'rect', 'line', 'g', 'table', 'thead', 'tbody', 'tr', 'td', 'th'
];

export function precacheCommonTags() {
  for (let tag of commonTags) {
    getDefaultStyleForTag(tag);
  }
}
/**
 * Retrieves default CSS property values from a temporary element.
 *
 * @param {string} tagName - The tag name to get default styles for
 * @returns {Object} Object containing default values for all CSS properties
 */
export function getDefaultStyleForTag(tagName) {
  if (defaultStylesCache.has(tagName)) {
    return defaultStylesCache.get(tagName);
  }

  const skipTags = new Set(['script', 'style', 'meta', 'link', 'noscript', 'template']);
  if (skipTags.has(tagName)) {
    const empty = {};  
    defaultStylesCache.set(tagName, empty);  
    return empty;
  }

  let sandbox = document.getElementById('snapdom-sandbox');
  if (!sandbox) {
    sandbox = document.createElement('div');
    sandbox.id = 'snapdom-sandbox';
    sandbox.style.position = 'absolute';
    sandbox.style.left = '-9999px';
    sandbox.style.top = '-9999px';
    sandbox.style.width = '0';
    sandbox.style.height = '0';
    sandbox.style.overflow = 'hidden';
    document.body.appendChild(sandbox);
  }

  const el = document.createElement(tagName);
  el.style.all = 'initial';
  sandbox.appendChild(el);

  const styles = getComputedStyle(el);
  const defaults = {};
  for (let prop of styles) {
    defaults[prop] = styles.getPropertyValue(prop);
  }

  sandbox.removeChild(el);
  defaultStylesCache.set(tagName, defaults);
  return defaults;
}

/**
 * Creates a unique key from an element's computed style that differs from defaults.
 *
 * @param {Object} snapshot - Computed style snapshot
 * @param {string} tagName - The tag name of the element
 * @param {boolean} [compress=false] - Whether to compress style keys
 * @returns {string} Semi-colon separated list of non-default properties
 */

export function getStyleKey(snapshot, tagName, compress = false) {
  const entries = [];
  const defaultStyles = getDefaultStyleForTag(tagName);
  for (let [prop, value] of Object.entries(snapshot)) {
    if (!compress) {
      if (value) {
        entries.push(`${prop}:${value}`);
      }
    } else {
      const defaultValue = defaultStyles[prop];
      if (value && value !== defaultValue) {
        entries.push(`${prop}:${value}`);
      }
    }
  }

  return entries.sort().join(";");
}

/**
 * Collects all unique tag names used in the DOM tree rooted at the given node.
 *
 * @param {Node} root - The root node to search
 * @returns {string[]} Array of unique tag names
 */
export function collectUsedTagNames(root) {
  const tagSet = new Set();
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    return [];
  }
  if (root.tagName) {
    tagSet.add(root.tagName.toLowerCase());
  }
  if (typeof root.querySelectorAll === 'function') {
    root.querySelectorAll("*").forEach(el => tagSet.add(el.tagName.toLowerCase()));
  }
  return Array.from(tagSet);
}

/**
 * Generates deduplicated base CSS for the given tag names.
 *
 * @param {string[]} usedTagNames - Array of tag names
 * @returns {string} CSS string
 */
export function generateDedupedBaseCSS(usedTagNames) {
  const groups = new Map();

  for (let tagName of usedTagNames) {
    const styles = defaultStylesCache.get(tagName);
    if (!styles) continue;

    // Creamos la "firma" del bloque CSS para comparar
    const key = Object.entries(styles)
      .map(([k, v]) => `${k}:${v};`)
      .sort()
      .join('');

    // Agrupamos por firma
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(tagName);
  }

  // Ahora generamos el CSS optimizado
  let css = '';
  for (let [styleBlock, tagList] of groups.entries()) {
    css += `${tagList.join(',')} { ${styleBlock} }\n`;
  }

  return css;
}
/**
 * Generates CSS classes from a style map.
 *
 * @param {Map} styleMap - Map of elements to style keys
 * @returns {Map} Map of style keys to class names
 */
export function generateCSSClasses(styleMap) {
  const keySet = new Set(styleMap.values());
  const classMap = new Map();
  let counter = 1;
  for (const key of keySet) {
    classMap.set(key, `c${counter++}`);
  }
  return classMap;
}
