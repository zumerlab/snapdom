import { isDefault } from '../utils/cssDefaults.js';

/**
 * Retrieves default CSS property values from a temporary element
 * @returns {Object} Object containing default values for all CSS properties
 */
export function getDefaultStyles() {
  // This fx is problematic...future version shloud check real elements and
  // cache common ones.
  const defaultEl = document.createElement('div');
  document.body.appendChild(defaultEl);
  const styles = window.getComputedStyle(defaultEl);
  const defaults = {};
  for (let prop of styles) {
    defaults[prop] = styles.getPropertyValue(prop);
  }
  document.body.removeChild(defaultEl);
  return defaults;
}


/**
 * Creates a unique key from an element's computed style that differs from defaults
 * @param {CSSStyleDeclaration} style - Computed style of an element
 * @param {Object} defaults - Default CSS property values
 * @returns {string} Semi-colon separated list of non-default properties
 */


/* export function getStyleKey(style) {
  const entries = [];
  for (let prop of Array.from(style)) {
    const value = style.getPropertyValue(prop);
    if (value && !isDefault(prop, value)) {
      entries.push(`${prop}:${value}`);
    }
  }
  return entries.sort().join(";");
} */

export function getStyleKey(style, defaults, mode) {
    const entries = [];
    for (let prop of style) {
      const value = style.getPropertyValue(prop);
      if (value) {
        entries.push(`${prop}:${value}`);
      }
    }
    return entries.sort().join(";");
  }



/**
 * Generates reusable CSS classes for unique style combinations
 * @param {Map} styleMap - Map of elements to their style keys
 * @returns {Map} Map of style keys to generated class names
 */
export function generateReusableCSSClasses(styleMap) {
  const keySet = new Set(styleMap.values());
  const classMap = new Map();
  let counter = 1;
  for (const key of keySet) {
    classMap.set(key, `c${counter++}`);
  }
  return classMap;
}

