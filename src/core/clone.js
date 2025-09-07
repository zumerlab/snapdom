/**
 * Deep cloning utilities for DOM elements, including styles and shadow DOM.
 * @module clone
 */

import { inlineAllStyles } from '../modules/styles.js';
import {NO_CAPTURE_TAGS} from '../utils/css.js'
import { idle } from '../utils/index.js';

function idleCallback(childList, callback, fast) {
  return Promise.all(childList.map(child => {
    return new Promise((resolve) => {
      function deal() {
        idle(
          (deadline) => {
            if (deadline instanceof IdleDeadline) {
              if (deadline.timeRemaining()) {
                callback(child, resolve)
              } else {
                deal()
              }
            } else {
              callback(child, resolve)
            }
          }, 
          {
            fast
          }
        )
      }
      deal()
    })
  }))
}

/**
 * Add :not([data-sd-slotted]) at the rightmost compound of a selector.
 * Very safe approximation: append at the end.
 */
function addNotSlottedRightmost(sel) {
  sel = sel.trim();
  if (!sel) return sel;
  // Evitar duplicar si ya está
  if (/\:not\(\s*\[data-sd-slotted\]\s*\)\s*$/.test(sel)) return sel;
  return `${sel}:not([data-sd-slotted])`;
}

/**
 * Wrap a selector list with :where(scope ...), lowering specificity to 0.
 * Optionally excludes slotted elements on the rightmost selector.
 */
function wrapWithScope(selectorList, scopeSelector, excludeSlotted = true) {
  return selectorList
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      // Si ya fue reescrito como :where(...), no lo toques
      if (s.startsWith(':where(')) return s;

      // No toques @rules aquí (esto se hace en el caller)
      if (s.startsWith('@')) return s;

      const body = excludeSlotted ? addNotSlottedRightmost(s) : s;
      // Especificidad 0 para todo el selector:
      return `:where(${scopeSelector} ${body})`;
    })
    .join(', ');
}

/**
 * Rewrite Shadow DOM selectors to a flat, host-scoped form with specificity 0.
 * - :host(.foo)           => :where([data-sd="sN"]:is(.foo))
 * - :host                 => :where([data-sd="sN"])
 * - ::slotted(X)          => :where([data-sd="sN"] X)              (no excluye sloteados)
 * - (resto, p.ej. .button)=> :where([data-sd="sN"] .button:not([data-sd-slotted]))
 * - :host-context(Y)      => :where(:where(Y) [data-sd="sN"])      (aprox)
 */
function rewriteShadowCSS(cssText, scopeSelector) {
  if (!cssText) return '';

  // 1) :host(.foo) y :host
  cssText = cssText.replace(/:host\(([^)]+)\)/g, (_, sel) => {
    return `:where(${scopeSelector}:is(${sel.trim()}))`;
  });
  cssText = cssText.replace(/:host\b/g, `:where(${scopeSelector})`);

  // 2) :host-context(Y)
  cssText = cssText.replace(/:host-context\(([^)]+)\)/g, (_, sel) => {
    return `:where(:where(${sel.trim()}) ${scopeSelector})`;
  });

  // 3) ::slotted(X) → descendiente dentro del scope, sin excluir sloteados
  cssText = cssText.replace(/::slotted\(([^)]+)\)/g, (_, sel) => {
    return `:where(${scopeSelector} ${sel.trim()})`;
  });

  // 4) Por cada bloque de selectores “suelto”, envolver con :where(scope …)
  //    y excluir sloteados en el rightmost (:not([data-sd-slotted])).
  cssText = cssText.replace(/(^|})(\s*)([^@}{]+){/g, (_, brace, ws, selectorList) => {
    const wrapped = wrapWithScope(selectorList, scopeSelector, /*excludeSlotted*/ true);
    return `${brace}${ws}${wrapped}{`;
  });

  return cssText;
}

/**
 * Generate a unique shadow scope id for this session.
 * @param {{shadowScopeSeq?: number}} sessionCache
 * @returns {string} like "s1", "s2", ...
 */
function nextShadowScopeId(sessionCache) {
  sessionCache.shadowScopeSeq = (sessionCache.shadowScopeSeq || 0) + 1;
  return `s${sessionCache.shadowScopeSeq}`;
}

/**
 * Extract CSS text from a ShadowRoot: inline <style> plus adoptedStyleSheets (if readable).
 * @param {ShadowRoot} sr
 * @returns {string}
 */
function extractShadowCSS(sr) {
  let css = '';
  try {
    // inline <style>
    sr.querySelectorAll('style').forEach(s => { css += (s.textContent || '') + '\n'; });

    // adoptedStyleSheets (may throw cross-origin; guard)
    const sheets = sr.adoptedStyleSheets || [];
    for (const sh of sheets) {
      try {
        if (sh && sh.cssRules) {
          for (const rule of sh.cssRules) css += rule.cssText + '\n';
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return css;
}



/**
 * Inject a <style> as the first child of `hostClone` with rewritten CSS.
 * @param {Element} hostClone
 * @param {string} cssText
 * @param {string} scopeId like s1
 */
function injectScopedStyle(hostClone, cssText, scopeId) {
  if (!cssText) return;
  const style = document.createElement('style');
  style.setAttribute('data-sd', scopeId);
  style.textContent = cssText;
  // prepend to ensure it wins over later subtree
  hostClone.insertBefore(style, hostClone.firstChild || null);
}

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
 * Collect all custom properties referenced via var(--foo) in a CSS string.
 * @param {string} cssText
 * @returns {Set<string>} e.g. new Set(['--o-fill','--o-gray-light'])
 */
function collectCustomPropsFromCSS(cssText) {
  const out = new Set();
  if (!cssText) return out;
  const re = /var\(\s*(--[A-Za-z0-9_-]+)\b/g;
  let m;
  while ((m = re.exec(cssText))) out.add(m[1]);
  return out;
}

/**
 * Resolve the cascaded value of a custom prop for an element.
 * Falls back to documentElement if empty.
 * @param {Element} el
 * @param {string} name like "--o-fill"
 * @returns {string} resolved token string or empty if unavailable
 */
function resolveCustomProp(el, name) {
  try {
    const cs = getComputedStyle(el);
    let v = cs.getPropertyValue(name).trim();
    if (v) return v;
  } catch {}
  try {
    const rootCS = getComputedStyle(document.documentElement);
    let v = rootCS.getPropertyValue(name).trim();
    if (v) return v;
  } catch {}
  return '';
}

/**
 * Build a seed rule that initializes given custom props on the scope.
 * Placed before the rewritten shadow CSS so later rules (e.g. :hover) can override.
 * @param {Element} hostEl
 * @param {Iterable<string>} names
 * @param {string} scopeSelector e.g. [data-sd="s3"]
 * @returns {string} CSS rule text (or "" if nothing to seed)
 */
function buildSeedCustomPropsRule(hostEl, names, scopeSelector) {
  const decls = [];
  for (const name of names) {
    const val = resolveCustomProp(hostEl, name);
    if (val) decls.push(`${name}: ${val};`);
  }
  if (!decls.length) return '';
  return `${scopeSelector}{${decls.join('')}}\n`;
}


/**
 * Creates a deep clone of a DOM node, including styles, shadow DOM, and special handling for excluded/placeholder/canvas nodes.
 *
 * @param {Node} node - Node to clone 
 * @param {Object} [options={}] - Capture options including exclude and filter 
 * @param {Node} [originalRoot] - Original root element being captured
 * @returns {Node|null} Cloned node with styles and shadow DOM content, or null for empty text nodes or filtered elements
 */
function markSlottedSubtree(root) {
  if (!root) return;
  if (root.nodeType === Node.ELEMENT_NODE) {
    root.setAttribute('data-sd-slotted', '');
  }
  // Marcar todos los descendientes elemento
  if (root.querySelectorAll) {
    root.querySelectorAll('*').forEach(el => el.setAttribute('data-sd-slotted', ''));
  }
}
 
export async function deepClone(node, sessionCache, options) {
  if (!node) throw new Error("Invalid node");
  const clonedAssignedNodes =  new Set();
  let pendingSelectValue = null;
  let pendingTextAreaValue = null;
  if (node.nodeType === Node.ELEMENT_NODE) {
    const tag = (node.localName || node.tagName || "").toLowerCase();
    if (node.id === "snapdom-sandbox" || node.hasAttribute("data-snapdom-sandbox")) {
      return null;
    }
    if (NO_CAPTURE_TAGS.has(tag)) {
      return null;
    }
  }
  if (node.nodeType === Node.TEXT_NODE) {
    return node.cloneNode(true);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return node.cloneNode(true);
  }
  if (node.getAttribute("data-capture") === "exclude") {
    const spacer = document.createElement("div");
    const rect = node.getBoundingClientRect();
    spacer.style.cssText = `display:inline-block;width:${rect.width}px;height:${rect.height}px;visibility:hidden;`;
    return spacer;
  }
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
  if (node.tagName === "IFRAME") {
    if (options.placeholders) {
      const fallback = document.createElement("div");
      fallback.style.cssText = `width:${node.offsetWidth}px;height:${node.offsetHeight}px;background-image:repeating-linear-gradient(45deg,#ddd,#ddd 5px,#f9f9f9 5px,#f9f9f9 10px);display:flex;align-items:center;justify-content:center;font-size:12px;color:#555;border:1px solid #aaa;`;
      inlineAllStyles(node, fallback, sessionCache, options);
      return fallback;
    } else {
      const rect = node.getBoundingClientRect();
      const spacer = document.createElement("div");
      spacer.style.cssText = `display:inline-block;width:${rect.width}px;height:${rect.height}px;visibility:hidden;`;
      inlineAllStyles(node, spacer, sessionCache, options);
      return spacer;
    }
  }
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
  let clone;
  try {
    clone = node.cloneNode(false);
    sessionCache.nodeMap.set(clone, node);
    if (node.tagName === "IMG") {
      freezeImgSrcset(node, clone);
      // Record original image dimensions for fallback usage when inlining fails
      try {
        const rect = node.getBoundingClientRect();
        let w = Math.round(rect.width || 0);
        let h = Math.round(rect.height || 0);
        if (!w || !h) {
          const computed = window.getComputedStyle(node);
          const cssW = parseFloat(computed.width) || 0;
          const cssH = parseFloat(computed.height) || 0;
          const attrW = parseInt(node.getAttribute('width') || '', 10) || 0;
          const attrH = parseInt(node.getAttribute('height') || '', 10) || 0;
          const propW = node.width || node.naturalWidth || 0;
          const propH = node.height || node.naturalHeight || 0;
          w = Math.round(w || cssW || attrW || propW || 0);
          h = Math.round(h || cssH || attrH || propH || 0);
        }
        if (w) clone.dataset.snapdomWidth = String(w);
        if (h) clone.dataset.snapdomHeight = String(h);
      } catch {}
    }
  } catch (err) {
    console.error("[Snapdom] Failed to clone node:", node, err);
    throw err;
  }
  if (node instanceof HTMLTextAreaElement) {
    const rect = node.getBoundingClientRect();
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
  }
  if (node instanceof HTMLInputElement) {
    clone.value = node.value;
    clone.setAttribute("value", node.value);
    if (node.checked !== void 0) {
      clone.checked = node.checked;
      if (node.checked) clone.setAttribute("checked", "");
      if (node.indeterminate) clone.indeterminate = node.indeterminate;
    }
  }
  if (node instanceof HTMLSelectElement) {
    pendingSelectValue = node.value;
  }
    if (node instanceof HTMLTextAreaElement) {
    pendingTextAreaValue = node.value;
  }
  inlineAllStyles(node, clone, sessionCache, options);
  if (node.shadowRoot) {
    try {
      const slots = node.shadowRoot.querySelectorAll("slot");
      for (const s of slots) {
        let assigned = [];
        try {
          assigned = s.assignedNodes?.({ flatten: true }) || s.assignedNodes?.() || [];
        } catch {
          assigned = s.assignedNodes?.() || [];
        }
        for (const an of assigned) clonedAssignedNodes.add(an);
      }
    } catch {
    }
    const scopeId = nextShadowScopeId(sessionCache);
    const scopeSelector = `[data-sd="${scopeId}"]`;
    try {
      clone.setAttribute("data-sd", scopeId);
    } catch {
    }
    const rawCSS = extractShadowCSS(node.shadowRoot);
    const rewritten = rewriteShadowCSS(rawCSS, scopeSelector);
    const neededVars = collectCustomPropsFromCSS(rawCSS);
    const seed = buildSeedCustomPropsRule(node, neededVars, scopeSelector);
    injectScopedStyle(clone, seed + rewritten, scopeId);
    const shadowFrag = document.createDocumentFragment();
    function callback(child, resolve) {
      if (child.nodeType === Node.ELEMENT_NODE && child.tagName === 'STYLE') {
        return resolve(null)
      } else {
        deepClone(child, sessionCache, options).then((clonedChild) => {
          resolve(clonedChild || null)
        }).catch((e) => {
          resolve(null)
        })
      }
    }

    const cloneList = await idleCallback(Array.from(node.shadowRoot.childNodes), callback, options.fast)
    shadowFrag.append(...cloneList.filter(clonedChild => !!clonedChild))
    clone.appendChild(shadowFrag)
  }
  if (node.tagName === "SLOT") {
    const assigned = node.assignedNodes?.({ flatten: true }) || [];
    const nodesToClone = assigned.length > 0 ? assigned : Array.from(node.childNodes);
    const fragment = document.createDocumentFragment();

    function callback(child, resolve) {
      deepClone(child, sessionCache, options).then((clonedChild) => {
        if (clonedChild) {
          markSlottedSubtree(clonedChild)
        }
        resolve(clonedChild || null)
      }).catch((e) => {
        resolve(null)
      })
    }
    const cloneList = await idleCallback(Array.from(nodesToClone), callback, options.fast)
    fragment.append(...cloneList.filter(clonedChild => !!clonedChild))
    return fragment;
  }

  function callback(child, resolve) {
    if (clonedAssignedNodes.has(child)) return resolve(null);
    deepClone(child, sessionCache, options).then((clonedChild) => {
      resolve(clonedChild || null)
    }).catch((e) => {
      resolve(null)
    })
  }
  const cloneList = await idleCallback(Array.from(node.childNodes), callback, options.fast)
  clone.append(...cloneList.filter(clonedChild => !!clonedChild))

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
    if (pendingTextAreaValue !== null && clone instanceof HTMLTextAreaElement) {
    clone.textContent = pendingTextAreaValue;

  }
  return clone;
}
