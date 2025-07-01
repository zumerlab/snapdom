/**
 * Deep cloning utilities for DOM elements, including styles and shadow DOM.
 * Solo clona, no inyecta pseudo-elementos ni procesa imágenes/backgrounds.
 * @module clone
 */

import { inlineAllStyles } from '../modules/styles.js';

/**
 * @typedef {Map<Element, string>} StyleMap
 * @typedef {WeakMap<Element, CSSStyleDeclaration>} StyleCache
 * @typedef {WeakMap<Element, Element>} NodeMap
 */

function shouldExcludeNode(node) {
  return node.nodeType === Node.ELEMENT_NODE && node.getAttribute("data-capture") === "exclude";
}
function createSpacer(node) {
  const spacer = document.createElement("div");
  const rect = node.getBoundingClientRect();
  spacer.style.cssText = `display: inline-block; width: ${rect.width}px; height: ${rect.height}px; visibility: hidden;`;
  return spacer;
}
function isIframe(node) {
  return node.tagName === "IFRAME";
}
function cloneIframe(node, styleMap, styleCache, nodeMap, compress) {
  let sameOrigin = false;
  let doc = null;
  try {
    doc = node.contentDocument;
    // Si no lanza excepción, es mismo origen
    if (doc && doc.body) sameOrigin = true;
  } catch (e) {
    sameOrigin = false;
  }
  if (sameOrigin && doc) {
    // Clonar el contenido del iframe
    const iframeClone = node.cloneNode(false);
    // Clonar el body del iframe
    const clonedBody = deepClone(doc.body, styleMap, styleCache, nodeMap, compress);
    // Limpiar el contenido del iframe clonado y agregar el body clonado
    // (No se puede insertar directamente en el iframe, así que usar un div wrapper)
    const wrapper = document.createElement("div");
    wrapper.style.cssText = `width:100%;height:100%;box-sizing:border-box;overflow:auto;background:white;`;
    if (clonedBody) wrapper.appendChild(clonedBody);
    iframeClone.appendChild(wrapper);
    return iframeClone;
  } else {
    // Fallback visual para cross-origin
    const fallback = document.createElement("div");
    fallback.textContent = "";
    fallback.style.cssText = `width: ${node.offsetWidth}px; height: ${node.offsetHeight}px; background-image: repeating-linear-gradient(45deg, #ddd, #ddd 5px, #f9f9f9 5px, #f9f9f9 10px);display: flex;align-items: center;justify-content: center;font-size: 12px;color: #555; border: 1px solid #aaa;`;
    return fallback;
  }
}
function isPlaceholder(node) {
  return node.nodeType === Node.ELEMENT_NODE && node.getAttribute("data-capture") === "placeholder";
}
function clonePlaceholder(node, styleMap, styleCache, nodeMap, compress) {
  const clone2 = node.cloneNode(false);
  nodeMap.set(clone2, node);
  inlineAllStyles(node, clone2, styleMap, styleCache, compress);
  const placeholder = document.createElement("div");
  placeholder.textContent = node.getAttribute("data-placeholder-text") || "";
  placeholder.style.cssText = `color: #666;font-size: 12px;text-align: center;line-height: 1.4;padding: 0.5em;box-sizing: border-box;`;
  clone2.appendChild(placeholder);
  return clone2;
}
function isCanvas(node) {
  return node.tagName === "CANVAS";
}
function cloneCanvas(node) {
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
function isTextNode(node) {
  return node.nodeType === Node.TEXT_NODE;
}
function cloneTextNode(node) {
  if (node.parentElement?.shadowRoot) {
    const tag = node.parentElement.tagName.toLowerCase();
    if (customElements.get(tag)) return null;
  }
  return node.cloneNode(true);
}
function isElementNode(node) {
  return node.nodeType === Node.ELEMENT_NODE;
}
function handleInputElement(node, clone) {
  clone.value = node.value;
  clone.setAttribute("value", node.value);
  if (node.checked !== undefined) {
    clone.checked = node.checked;
    if (node.checked) clone.setAttribute("checked", "");
  }
}
function handleTextareaElement(node, clone) {
  clone.value = node.value;
  clone.textContent = node.value;
}
function handleSelectElement(node, clone) {
  clone.value = node.value;
  Array.from(clone.options).forEach(opt => {
    if (opt.value === node.value) {
      opt.setAttribute("selected", "");
    } else {
      opt.removeAttribute("selected");
    }
  });
}
function cloneShadowDOM(node, clone, styleMap, styleCache, nodeMap, compress) {
  if (!node.shadowRoot) return;
  const shadowContent = Array.from(node.shadowRoot.children)
    .filter((el) => el.tagName !== "STYLE")
    .map((el) => deepClone(el, styleMap, styleCache, nodeMap, compress))
    .filter(Boolean);
  const shadowFrag = document.createDocumentFragment();
  shadowContent.forEach((child) => shadowFrag.appendChild(child));
  clone.appendChild(shadowFrag);
}

/**
 * Crea un clon profundo de un nodo DOM, incluyendo estilos, shadow DOM y casos especiales.
 * No procesa pseudo-elementos ni imágenes/backgrounds.
 *
 * @param {Node} node - Nodo a clonar
 * @param {StyleMap} styleMap - Mapa para asociar nodos clonados a claves de estilo
 * @param {StyleCache} styleCache - Cache de estilos computados
 * @param {NodeMap} nodeMap - Mapa de correspondencia original→clon
 * @param {boolean} compress - Si se debe comprimir el CSS
 * @returns {Node|null} Nodo clonado con estilos y shadow DOM, o null para nodos vacíos
 */
export function deepClone(node, styleMap, styleCache, nodeMap, compress) {
  if (shouldExcludeNode(node)) return createSpacer(node);
  if (isIframe(node)) return cloneIframe(node, styleMap, styleCache, nodeMap, compress);
  if (isPlaceholder(node)) return clonePlaceholder(node, styleMap, styleCache, nodeMap, compress);
  if (isCanvas(node)) return cloneCanvas(node);
  if (isTextNode(node)) return cloneTextNode(node);
  if (!isElementNode(node)) return node.cloneNode(true);

  // Clone the element node
  const clone = node.cloneNode(false);
  nodeMap.set(clone, node);

  // Special handling for form elements: inputs, textareas, and selects
  if (node instanceof HTMLInputElement) {
    handleInputElement(node, clone);
  } else if (node instanceof HTMLTextAreaElement) {
    handleTextareaElement(node, clone);
  } else if (node instanceof HTMLSelectElement) {
    handleSelectElement(node, clone);
  }

  // Apply computed styles to the clone and register in the styleMap
  inlineAllStyles(node, clone, styleMap, styleCache, compress);

  // Recursively clone all child nodes (deep clone)
  const frag = document.createDocumentFragment();
  node.childNodes.forEach((child) => {
    const clonedChild = deepClone(child, styleMap, styleCache, nodeMap, compress);
    if (clonedChild) frag.appendChild(clonedChild);
  });
  clone.appendChild(frag);

  // Handle shadow DOM cloning
  cloneShadowDOM(node, clone, styleMap, styleCache, nodeMap, compress);

  return clone;
}