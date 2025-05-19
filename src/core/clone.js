/**
 * Deep cloning utilities for DOM elements, including styles and shadow DOM.
 * @module clone
 */

import { inlineAllStyles } from '../modules/styles.js';

/**
 * Creates a deep clone of a DOM node, including styles, shadow DOM, and special handling for excluded/placeholder/canvas nodes.
 *
 * @param {Node} node - Node to clone
 * @param {Map} styleMap - Map to store element-to-style-key mappings
 * @param {WeakMap} styleCache - Cache of computed styles
 * @param {WeakMap} nodeMap - Map to track original-to-clone node relationships
 * @param {boolean} compress - Whether to compress style keys
 * @returns {Node|null} Cloned node with styles and shadow DOM content, or null for empty text nodes
 */
export function deepClone(node, styleMap, styleCache, nodeMap, compress) {
  if (node.nodeType === Node.ELEMENT_NODE && node.getAttribute("data-capture") === "exclude") {
    const spacer = document.createElement("div");
    const rect = node.getBoundingClientRect();
    spacer.style.cssText = `display: inline-block; width: ${rect.width}px; height: ${rect.height}px; visibility: hidden;`;
    return spacer;
  }
  if (node.tagName === "IFRAME") {
    const fallback = document.createElement("div");
    fallback.textContent = "";
    fallback.style.cssText = `width: ${node.offsetWidth}px; height: ${node.offsetHeight}px; background: repeating-linear-gradient(45deg, #ddd, #ddd 5px, #f9f9f9 5px, #f9f9f9 10px);display: flex;align-items: center;justify-content: center;font-size: 12px;color: #555; border: 1px solid #aaa;`;
    return fallback;
  }
  if (node.nodeType === Node.ELEMENT_NODE && node.getAttribute("data-capture") === "placeholder") {
    const clone2 = node.cloneNode(false);
    nodeMap.set(clone2, node);
    inlineAllStyles(node, clone2, styleMap, styleCache, compress);
    const placeholder = document.createElement("div");
    placeholder.textContent = node.getAttribute("data-placeholder-text") || "";
    placeholder.style.cssText = `color: #666;font-size: 12px;text-align: center;line-height: 1.4;padding: 0.5em;box-sizing: border-box;`;
    clone2.appendChild(placeholder);
    return clone2;
  }
  if (node.tagName === "CANVAS") {
    const dataURL = node.toDataURL();
    const img = document.createElement("img");
    img.src = dataURL;
    img.width = node.width;
    img.height = node.height;
    img.style.display = "inline-block";
    img.style.width = `${node.width}px`;
    img.style.height = `${node.height}px`;
    return img;
  }
  if (node.nodeType === Node.TEXT_NODE) {
    const trimmed = node.textContent.trim();
    if (!trimmed) return null;
    if (node.parentElement?.shadowRoot) {
      const tag = node.parentElement.tagName.toLowerCase();
      if (customElements.get(tag)) return null;
    }
    return node.cloneNode(true);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return node.cloneNode(true);
  const clone = node.cloneNode(false);
  nodeMap.set(clone, node);
  inlineAllStyles(node, clone, styleMap, styleCache, compress);
  const frag = document.createDocumentFragment();
  node.childNodes.forEach((child) => {
    const clonedChild = deepClone(child, styleMap, styleCache, nodeMap, compress);
    if (clonedChild) frag.appendChild(clonedChild);
  });
  clone.appendChild(frag);
  if (node.shadowRoot) {
    const shadowContent = Array.from(node.shadowRoot.children).filter((el) => el.tagName !== "STYLE").map((el) => deepClone(el, styleMap, styleCache, nodeMap)).filter(Boolean);
    const shadowFrag = document.createDocumentFragment();
    shadowContent.forEach((child) => shadowFrag.appendChild(child));
    clone.appendChild(shadowFrag);
  }
  return clone;
}