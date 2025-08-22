import { cache } from "../core/cache"

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
  if (cache.defaultStyle.has(tagName)) {
    return cache.defaultStyle.get(tagName);
  }

  const skipTags = new Set(['script', 'style', 'meta', 'link', 'noscript', 'template']);
  if (skipTags.has(tagName)) {
    const empty = {};  
    cache.defaultStyle.set(tagName, empty);  
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
  cache.defaultStyle.set(tagName, defaults);
  return defaults;
}

// === Solo excluir lo que seguro no pinta el frame ===

// tokens "animation"/"transition" en cualquier parte del nombre (con límites por guiones)
const NO_PAINT_TOKEN = /(?:^|-)(animation|transition)(?:-|$)/i;

// prefijos que no afectan el pixel del frame
const NO_PAINT_PREFIX = /^(--|view-timeline|scroll-timeline|offset-|app-region|interactivity|box-decoration-break|-webkit-locale)/i;

function shouldIgnoreProp(prop /*, tag */) {
  const p = String(prop).toLowerCase();
  if (NO_PAINT_PREFIX.test(p)) return true; // --*, view/scroll-timeline*, offset-*, hints UA
  if (NO_PAINT_TOKEN.test(p)) return true;  // …-animation…, …-transition… (incluye caret-animation, animation-trigger-*)
  return false;
}

export function getStyleKey(snapshot, tagName) {
  const entries = [];
  const defaults = getDefaultStyleForTag(tagName);
  for (let [prop, value] of Object.entries(snapshot)) {
    if (shouldIgnoreProp(prop)) continue;
    const def = defaults[prop];
    if (value && value !== def) entries.push(`${prop}:${value}`);
  }
  entries.sort();
  return entries.join(';');
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
    const styles = cache.defaultStyle.get(tagName);
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

/**
 * Gets the computed style for an element or pseudo-element, with caching.
 *
 * @param {Element} el - The element
 * @param {string|null} [pseudo=null] - The pseudo-element
 * @returns {CSSStyleDeclaration} The computed style
 */
export function getStyle(el, pseudo = null) {
  if (!(el instanceof Element)) {
    return window.getComputedStyle(el, pseudo);
  }

  let map = cache.computedStyle.get(el);
  if (!map) {
    map = new Map();
    cache.computedStyle.set(el, map);
  }

  if (!map.has(pseudo)) {
    const st = window.getComputedStyle(el, pseudo);
    map.set(pseudo, st);
  }

  return map.get(pseudo);
}

/**
 * Parses the CSS content property value, handling unicode escapes.
 *
 * @param {string} content - The CSS content value
 * @returns {string} The parsed content
 */
export function parseContent(content) {
  let clean = content.replace(/^['"]|['"]$/g, "");
  if (clean.startsWith("\\")) {
    try {
      return String.fromCharCode(parseInt(clean.replace("\\", ""), 16));
    } catch {
      return clean;
    }
  }
  return clean;
}

/**
 *
 *
 * @export
 * @param {*} style
 * @return {*} 
 */
export function snapshotComputedStyle(style) {
  const snap = {};
  for (let prop of style) {
    snap[prop] = style.getPropertyValue(prop);
  }
  return snap;
}

/**
 *
 *
 * @export
 * @param {*} style
 * @return {*} 
 */

export function splitBackgroundImage(bg) {
  const parts = [];
  let depth = 0;
  let lastIndex = 0;
  for (let i = 0; i < bg.length; i++) {
    const char = bg[i];
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      parts.push(bg.slice(lastIndex, i).trim());
      lastIndex = i + 1;
    }
  }
  parts.push(bg.slice(lastIndex).trim());
  return parts;
}
