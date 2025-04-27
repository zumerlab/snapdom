import { inlineAllStyles } from '../modules/styles.js';

/**
 * Creates a deep clone of an element with all its styles and shadow DOM content
 * @param {Node} node - Node to clone
 * @param {Map} styleMap - Map to store element-to-style-key mappings
 * @param {Object} defaults - Default CSS property values
 * @param {WeakMap} styleCache - Cache of computed styles
 * @param {WeakMap} nodeMap - Map to track original-to-clone node relationships
 * @returns {Node} Cloned node with styles and shadow DOM content
 */
export function deepCloneWithShadow(node, styleMap, defaults, styleCache, nodeMap) {
  // Handle elements marked for exclusion
  if (node.nodeType === Node.ELEMENT_NODE && node.getAttribute('data-capture') === 'exclude') {
    const spacer = document.createElement('div');
    const rect = node.getBoundingClientRect();
    spacer.style.cssText = `display: inline-block; width: ${rect.width}px; height: ${rect.height}px; visibility: hidden;`;
    return spacer;
  }
  if (node.tagName === 'IFRAME') {
    const fallback = document.createElement('div');
    fallback.textContent = '';
    fallback.style.cssText = `width: ${node.offsetWidth}px; height: ${node.offsetHeight}px; background: repeating-linear-gradient(45deg, #ddd, #ddd 5px, #f9f9f9 5px, #f9f9f9 10px);display: flex;align-items: center;justify-content: center;font-size: 12px;color: #555; border: 1px solid #aaa;`;
    return fallback;
  }
  // Handle elements marked for placeholder replacement
  if (node.nodeType === Node.ELEMENT_NODE && node.getAttribute('data-capture') === 'placeholder') {
    const clone = node.cloneNode(false);
    nodeMap.set(clone, node); // Store the relationship
    inlineAllStyles(node, clone, styleMap, defaults, styleCache);
    const placeholder = document.createElement('div');
    placeholder.textContent = node.getAttribute('data-placeholder-text') || '';
    placeholder.style.cssText = `color: #666;font-size: 12px;text-align: center;line-height: 1.4;padding: 0.5em;box-sizing: border-box;`;
    clone.appendChild(placeholder);
    return clone;
  }

  // Handle canvas elements
  if (node.tagName === 'CANVAS') {
    const dataURL = node.toDataURL();
    const img = document.createElement('img');
    img.src = dataURL;
    img.width = node.width;
    img.height = node.height;
    return img;
  }

  // Handle text nodes
  if (node.nodeType === Node.TEXT_NODE) {
    const trimmed = node.textContent.trim();
    if (!trimmed) return null;
    if (node.parentElement?.shadowRoot) {
      const tag = node.parentElement.tagName.toLowerCase();
      if (customElements.get(tag)) return null;
    }
    return node.cloneNode(true);
  }

  // Handle other non-element nodes
  if (node.nodeType !== Node.ELEMENT_NODE) return node.cloneNode(true);

  // Clone the element
  const clone = node.cloneNode(false);
  nodeMap.set(clone, node); // Store the relationship

  // Record styles for the element
  inlineAllStyles(node, clone, styleMap, defaults, styleCache);

  // Clone children
  const frag = document.createDocumentFragment();
  node.childNodes.forEach(child => {
    const clonedChild = deepCloneWithShadow(child, styleMap, defaults, styleCache, nodeMap);
    if (clonedChild) frag.appendChild(clonedChild);
  });
  clone.appendChild(frag);

  // Handle shadow DOM content
  if (node.shadowRoot) {
    const shadowContent = Array.from(node.shadowRoot.children)
      .filter(el => el.tagName !== 'STYLE')
      .map(el => deepCloneWithShadow(el, styleMap, defaults, styleCache, nodeMap))
      .filter(Boolean);

    const shadowFrag = document.createDocumentFragment();
    shadowContent.forEach(child => shadowFrag.appendChild(child));
    clone.appendChild(shadowFrag);
  }
  
  // Remove style attribute from style tags
  clone.querySelectorAll('style').forEach(tag => tag.removeAttribute('style'));
  if (clone.tagName === 'STYLE') clone.removeAttribute('style');

  return clone;
}
