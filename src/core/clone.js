/**
 * Deep cloning utilities for DOM elements, including styles and shadow DOM.
 * @module clone
 */

import { inlineAllStyles } from '../modules/styles.js';

/**
 * Freeze the responsive selection of an <img> that has srcset/sizes.
 * Copies a concrete URL into `src` and removes `srcset`/`sizes` so the clone
 * doesn't need layout to resolve a candidate.
 * Works with <picture> because currentSrc reflects the chosen source.
 * @param {HTMLImageElement} original - Image in the live DOM.
 * @param {HTMLImageElement} cloned - Just-created cloned <img>.
 */
function freezeImgSrcset(original, cloned) {
  try {
    const chosen = original.currentSrc || original.src || '';
    if (!chosen) return;
    cloned.setAttribute('src', chosen);
    cloned.removeAttribute('srcset');
    cloned.removeAttribute('sizes');
    // Hint deterministic decode/load for capture
    cloned.loading = 'eager';
    cloned.decoding = 'sync';
  } catch {
    // no-op
  }
}


/**
 * Creates a deep clone of a DOM node, including styles, shadow DOM, and special handling for excluded/placeholder/canvas nodes.
 *
 * @param {Node} node - Node to clone 
 * @param {boolean} options.compress - Whether to options.compress style keys
 * @param {Object} [options={}] - Capture options including exclude and filter 
 * @param {Node} [originalRoot] - Original root element being captured
 * @returns {Node|null} Cloned node with styles and shadow DOM content, or null for empty text nodes or filtered elements
 */

 
export function deepClone(node, sessionCache, options) {
  if (!node) throw new Error('Invalid node');

  // Local set to avoid duplicates in slot processing
  const clonedAssignedNodes = new Set();
  let pendingSelectValue = null; // Track select value for later fix

  // 1. Text nodes
  if (node.nodeType === Node.TEXT_NODE) {
    return node.cloneNode(true);
  }

  // 2. Non-element nodes (comments, etc.)
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return node.cloneNode(true);
  }

  // 3. Exclude by attribute
  if (node.getAttribute("data-capture") === "exclude") {
    const spacer = document.createElement("div");
    const rect = node.getBoundingClientRect();
    spacer.style.cssText = `display:inline-block;width:${rect.width}px;height:${rect.height}px;visibility:hidden;`;
    return spacer;
  }

  // 4. Exclude by selectors
  if (options.exclude && Array.isArray(options.exclude)) {
    for (const selector of options.exclude) {
      try {
        if (node.matches?.(selector)) {
          const spacer = document.createElement("div");
          const rect = node.getBoundingClientRect();
          spacer.style.cssText = `display:inline-block;width:${rect.width}px;height:${rect.height}px;visibility:hidden;`;
          return spacer;
        }
      } catch (err) {
        console.warn(`Invalid selector in exclude option: ${selector}`, err);
      }
    }
  }

  // 5. Custom filter function
  if (typeof options.filter === "function") {
    try {
      if (!options.filter(node)) {
        const spacer = document.createElement("div");
        const rect = node.getBoundingClientRect();
        spacer.style.cssText = `display:inline-block;width:${rect.width}px;height:${rect.height}px;visibility:hidden;`;
        return spacer;
      }
    } catch (err) {
      console.warn("Error in filter function:", err);
    }
  }

  // 6. Special case: iframe → fallback pattern
  if (node.tagName === "IFRAME") {
    const fallback = document.createElement("div");
    fallback.style.cssText = `width:${node.offsetWidth}px;height:${node.offsetHeight}px;background-image:repeating-linear-gradient(45deg,#ddd,#ddd 5px,#f9f9f9 5px,#f9f9f9 10px);display:flex;align-items:center;justify-content:center;font-size:12px;color:#555;border:1px solid #aaa;`;
    return fallback;
  }

  // 7. Placeholder nodes
  if (node.getAttribute("data-capture") === "placeholder") {
    const clone2 = node.cloneNode(false);
    sessionCache.nodeMap.set(clone2, node);
    inlineAllStyles(node, clone2, sessionCache, options);
    const placeholder = document.createElement("div");
    placeholder.textContent = node.getAttribute("data-placeholder-text") || "";
    placeholder.style.cssText = `color:#666;font-size:12px;text-align:center;line-height:1.4;padding:0.5em;box-sizing:border-box;`;
    clone2.appendChild(placeholder);
    return clone2;
  }

  // 8. Canvas → convert to image
  if (node.tagName === "CANVAS") {
    const dataURL = node.toDataURL();
    const img = document.createElement("img");
    img.src = dataURL;
    img.width = node.width;
    img.height = node.height;
    sessionCache.nodeMap.set(img, node);
    inlineAllStyles(node, img, sessionCache, options);
    return img;
  }

  // 9. Base clone (without children)
  let clone;
  try {
    clone = node.cloneNode(false);
    sessionCache.nodeMap.set(clone, node);
    
    if (node.tagName === 'IMG') {
      freezeImgSrcset(node, clone);
    }
  } catch (err) {
    console.error("[Snapdom] Failed to clone node:", node, err);
    throw err;
  }

  // Special handling: textarea (keep size and value)
  if (node instanceof HTMLTextAreaElement) {
    clone.textContent = node.value;
    clone.value = node.value;
    const rect = node.getBoundingClientRect();
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    return clone;
  }

  // Special handling: input
  if (node instanceof HTMLInputElement) {
    clone.value = node.value;
    clone.setAttribute("value", node.value);
    if (node.checked !== void 0) {
      clone.checked = node.checked;
      if (node.checked) clone.setAttribute("checked", "");
      if (node.indeterminate) clone.indeterminate = node.indeterminate;
    }
    // return clone;
  }

  // Special handling: select → postpone value adjustment
  if (node instanceof HTMLSelectElement) {
    pendingSelectValue = node.value;
  }

  // 11. Inline styles
  inlineAllStyles(node, clone, sessionCache, options);

  // 12. ShadowRoot logic
  if (node.shadowRoot) {
    const hasSlot = Array.from(node.shadowRoot.querySelectorAll("slot")).length > 0;

    if (hasSlot) {
      // ShadowRoot with slots: only store styles
      for (const child of node.shadowRoot.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE && child.tagName === "STYLE") {
          const cssText = child.textContent || "";
          if (cssText.trim() && options.compress) {
            //if (!cache.preStyle) cache.preStyle = new WeakMap();
            sessionCache.styleCache.set(child, cssText);
         }
        }
      }
    } else {
      // ShadowRoot without slots: clone full content
      const shadowFrag = document.createDocumentFragment();
      for (const child of node.shadowRoot.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE && child.tagName === "STYLE") {
          const cssText = child.textContent || "";
          if (cssText.trim() && options.compress) {
          //  if (!cache.preStyle) cache.preStyle = new WeakMap();
            sessionCache.styleCache.set(child, cssText);
          }
          continue;
        }
        const clonedChild = deepClone(child, sessionCache, options);
        if (clonedChild) shadowFrag.appendChild(clonedChild);
      }
      clone.appendChild(shadowFrag);
    }
  }

  // 13. Slot outside ShadowRoot
  if (node.tagName === "SLOT") {
    const assigned = node.assignedNodes?.({ flatten: true }) || [];
    const nodesToClone = assigned.length > 0 ? assigned : Array.from(node.childNodes);
    const fragment = document.createDocumentFragment();

    for (const child of nodesToClone) {
      const clonedChild = deepClone(child, sessionCache, options);
      if (clonedChild) fragment.appendChild(clonedChild);
    }
    return fragment;
  }

  // 14. Clone children (light DOM), skipping duplicates
  for (const child of node.childNodes) {
    if (clonedAssignedNodes.has(child)) continue;

    const clonedChild = deepClone(child, sessionCache, options);
    if (clonedChild) clone.appendChild(clonedChild);
  }

  // Adjust select value after children are cloned
  if (pendingSelectValue !== null && clone instanceof HTMLSelectElement) {
    clone.value = pendingSelectValue;
    for (const opt of clone.options) {
      if (opt.value === pendingSelectValue) {
        opt.setAttribute("selected", "");
      } else {
        opt.removeAttribute("selected");
      }
    }
  }

  return clone;
}  
