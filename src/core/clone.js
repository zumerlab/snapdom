/**
 * Deep cloning utilities for DOM elements, including styles and shadow DOM.
 * @module clone
 */

import { inlineAllStyles } from '../modules/styles.js';
import { cache } from '../core/cache.js'

/**
 * Creates a deep clone of a DOM node, including styles, shadow DOM, and special handling for excluded/placeholder/canvas nodes.
 *
 * @param {Node} node - Node to clone
 * @param {boolean} compress - Whether to compress style keys
 * @param {Object} [options={}] - Capture options including exclude and filter 
 * @param {Node} [originalRoot] - Original root element being captured
 * @returns {Node|null} Cloned node with styles and shadow DOM content, or null for empty text nodes or filtered elements
 */

 function isSlotElement(node) {
  return node.nodeType === Node.ELEMENT_NODE && node.tagName === 'SLOT';
}

export function deepClone(node, compress, options = {}, originalRoot) {
  // 1. Validación inicial del nodo
  if (!node) {
    throw new Error('Invalid node: node is null or undefined');
  }

  try {
    // 2. Manejo de nodos de texto
    if (node.nodeType === Node.TEXT_NODE) {
      return node.cloneNode(true);
    }

    // 3. Manejo de nodos que no son elementos
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return node.cloneNode(true);
    }

    // 4. Manejo de elementos excluidos
    if (node.getAttribute("data-capture") === "exclude") {
      const spacer = document.createElement("div");
      const rect = node.getBoundingClientRect();
      spacer.style.cssText = `display: inline-block; width: ${rect.width}px; height: ${rect.height}px; visibility: hidden;`;
      return spacer;
    }

    // 5. Manejo de selectores excluidos
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

    // 6. Manejo de filtros personalizados
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

    // 7. Manejo especial de iframes
    if (node.tagName === "IFRAME") {
      const fallback = document.createElement("div");
      fallback.textContent = "";
      fallback.style.cssText = `width: ${node.offsetWidth}px; height: ${node.offsetHeight}px; background-image: repeating-linear-gradient(45deg, #ddd, #ddd 5px, #f9f9f9 5px, #f9f9f9 10px);display: flex;align-items: center;justify-content: center;font-size: 12px;color: #555; border: 1px solid #aaa;`;
      return fallback;
    }

    // 8. Manejo de placeholders
    if (node.getAttribute("data-capture") === "placeholder") {
      const clone2 = node.cloneNode(false);
      cache.preNodeMap.set(clone2, node);
      inlineAllStyles(node, clone2, compress);
      const placeholder = document.createElement("div");
      placeholder.textContent = node.getAttribute("data-placeholder-text") || "";
      placeholder.style.cssText = `color: #666;font-size: 12px;text-align: center;line-height: 1.4;padding: 0.5em;box-sizing: border-box;`;
      clone2.appendChild(placeholder);
      return clone2;
    }

    // 9. Manejo especial de canvas
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

    // 10. Clonación del nodo principal
    let clone;
    try {
      clone = node.cloneNode(false);
      if (!clone) {
        throw new Error('Failed to clone node: cloneNode returned null');
      }
      cache.preNodeMap.set(clone, node);
    } catch (err) {
      console.error("[Snapdom] Failed to clone node:", node, err);
      throw err; // Propaga el error original
    }

    // 11. Manejo de elementos especiales (input, textarea, select)
    if (node instanceof HTMLInputElement) {
      clone.value = node.value;
      clone.setAttribute("value", node.value);
      if (node.checked !== void 0) {
        clone.checked = node.checked;
        if (node.checked) clone.setAttribute("checked", "");
      }
    } else if (node instanceof HTMLTextAreaElement) {
      const rect = node.getBoundingClientRect();
      clone.textContent = node.value;
      clone.style.width = `${rect.width}px`;
      clone.style.height = `${rect.height}px`;
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

    // 12. Aplicación de estilos
    inlineAllStyles(node, clone, compress);

    // 13. Clonación de hijos
    try {
      if (isSlotElement(node)) {
        const assigned = node.assignedNodes?.({ flatten: true }) || [];
        const nodesToClone = assigned.length > 0 ? assigned : Array.from(node.childNodes);
        const fragment = document.createDocumentFragment();

        for (const child of nodesToClone) {
          try {
            const clonedChild = deepClone(child, compress, options, originalRoot || node);
            if (clonedChild) fragment.appendChild(clonedChild);
          } catch (err) {
            console.warn("[Snapdom] Failed to clone slot content:", child, err);
          }
        }
        return fragment;
      } else {
        const baseChildren = node.shadowRoot ? node.shadowRoot.childNodes : node.childNodes;
        
        for (const child of baseChildren) {
          try {
            const clonedChild = deepClone(child, compress, options, originalRoot || node);
            if (clonedChild) clone.appendChild(clonedChild);
          } catch (err) {
            console.warn("[Snapdom] Failed to clone child node:", child, err);
          }
        }

        if (node.shadowRoot && node.childNodes.length > 0 && !node.shadowRoot.querySelector('slot')) {
          const lightDomContent = document.createDocumentFragment();
          for (const child of node.childNodes) {
            try {
              const clonedChild = deepClone(child, compress, options, originalRoot || node);
              if (clonedChild) lightDomContent.appendChild(clonedChild);
            } catch (err) {
              console.warn("[Snapdom] Failed to clone light DOM child:", child, err);
            }
          }
          clone.appendChild(lightDomContent);
        }
      }
    } catch (err) {
      console.error("[Snapdom] Error cloning children:", err);
      throw err;
    }

    return clone;

  } catch (error) {
    console.error("[Snapdom] Error in deepClone:", error);
    throw error; // Propaga el error al llamador
  }
}

  
