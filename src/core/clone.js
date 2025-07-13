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
 * @param {Object} [options={}] - Capture options including exclude and filter 
 * @param {Node} [originalRoot] - Original root element being captured
 * @returns {Node|null} Cloned node with styles and shadow DOM content, or null for empty text nodes or filtered elements
 */

 function isSlotElement(node) {
  return node.nodeType === Node.ELEMENT_NODE && node.tagName === 'SLOT';
}

export function deepClone(node, styleMap, styleCache, nodeMap, compress, options = {}, originalRoot) {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.cloneNode(true); // Siempre clona nodos de texto
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return node.cloneNode(true);

  if (node.getAttribute("data-capture") === "exclude") {
    const spacer = document.createElement("div");
    const rect = node.getBoundingClientRect();
    spacer.style.cssText = `display: inline-block; width: ${rect.width}px; height: ${rect.height}px; visibility: hidden;`;
    return spacer;
  }

  if (options.exclude && Array.isArray(options.exclude)) {
    for (const selector of options.exclude) {
      try {
        if (node.matches?.(selector)) {
          const spacer = document.createElement("div");
          const rect = node.getBoundingClientRect();
          spacer.style.cssText = `display: inline-block; width: ${rect.width}px; height: ${rect.height}px; visibility: hidden;`;
          return spacer;
        }
      } catch (err) {
        console.warn(`Invalid selector in exclude option: ${selector}`, err);
      }
    }
  }

  if (typeof options.filter === "function") {
    try {
      if (!options.filter(node, originalRoot || node)) {
        const spacer = document.createElement("div");
        const rect = node.getBoundingClientRect();
        spacer.style.cssText = `display: inline-block; width: ${rect.width}px; height: ${rect.height}px; visibility: hidden;`;
        return spacer;
      }
    } catch (err) {
      console.warn("Error in filter function:", err);
    }
  }

  if (node.tagName === "IFRAME") {
    const fallback = document.createElement("div");
    fallback.textContent = "";
    fallback.style.cssText = `width: ${node.offsetWidth}px; height: ${node.offsetHeight}px; background-image: repeating-linear-gradient(45deg, #ddd, #ddd 5px, #f9f9f9 5px, #f9f9f9 10px);display: flex;align-items: center;justify-content: center;font-size: 12px;color: #555; border: 1px solid #aaa;`;
    return fallback;
  }

  if (node.getAttribute("data-capture") === "placeholder") {
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
    img.style.width = node.style.width || `${node.width}px`;
    img.style.height = node.style.height || `${node.height}px`;
    return img;
  }

  const clone = node.cloneNode(false);
  nodeMap.set(clone, node);

  if (node instanceof HTMLInputElement) {
    clone.value = node.value;
    clone.setAttribute("value", node.value);
    if (node.checked !== void 0) {
      clone.checked = node.checked;
      if (node.checked) clone.setAttribute("checked", "");
    }
  } else if (node instanceof HTMLTextAreaElement) {
   clone.textContent = node.value;
  } else if (node instanceof HTMLSelectElement) {
    clone.value = node.value;
    Array.from(clone.options).forEach((opt) => {
      if (opt.value === node.value) {
        opt.setAttribute("selected", "");
      } else {
        opt.removeAttribute("selected");
      }
    });
  }

  inlineAllStyles(node, clone, styleMap, styleCache, compress);

  // Aquí es donde se clonan hijos o shadowRoot con slots
  if (isSlotElement(node)) {
  // No clonamos el <slot> en sí, sino que devolvemos sus nodos asignados clonados directamente
  const assigned = node.assignedNodes?.({ flatten: true }) || [];
  const nodesToClone = assigned.length > 0 ? assigned : Array.from(node.childNodes);

  // Creamos un fragmento para devolver los nodos clonados
  const fragment = document.createDocumentFragment();

  for (const child of nodesToClone) {
    const clonedChild = deepClone(child, styleMap, styleCache, nodeMap, compress, options, originalRoot || node);
    if (clonedChild) fragment.appendChild(clonedChild);
  }

  return fragment;
} else {
    const baseChildren = node.shadowRoot ? node.shadowRoot.childNodes : node.childNodes;
    
    for (const child of baseChildren) {
      const clonedChild = deepClone(child, styleMap, styleCache, nodeMap, compress, options, originalRoot || node);
      if (clonedChild) clone.appendChild(clonedChild);
    }

    if (node.shadowRoot && node.childNodes.length > 0 && !node.shadowRoot.querySelector('slot')) {
      const lightDomContent = document.createDocumentFragment();
      for (const child of node.childNodes) {
        const clonedChild = deepClone(child, styleMap, styleCache, nodeMap, compress, options, originalRoot || node);
        if (clonedChild) lightDomContent.appendChild(clonedChild);
      }
      clone.appendChild(lightDomContent);
    }
  }

  return clone;
}

  
