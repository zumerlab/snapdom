/**
 * Prepares a deep clone of an element, inlining pseudo-elements and generating CSS classes.
 * @module prepare
 */

import { generateCSSClasses, stripTranslate } from '../utils/index.js';
import { deepClone } from './clone.js';
import { inlinePseudoElements } from '../modules/pseudo.js';
import { snapFetch } from '../modules/snapFetch.js';
import { inlineExternalDefsAndSymbols } from '../modules/svgDefs.js';
import { cache } from '../core/cache.js';

/**
 * Prepares a clone of an element for capture, inlining pseudo-elements and generating CSS classes.
 *
 * @param {Element} element - Element to clone
 * @param {boolean} [embedFonts=false] - Whether to embed custom fonts
 * @param {Object} [options={}] - Capture options
 * @param {string[]} [options.exclude] - CSS selectors for elements to exclude
 * @param {Function} [options.filter] - Custom filter function
 * @returns {Promise<Object>} Object containing the clone, generated CSS, and style cache
 */

export async function prepareClone(element, options = {}) {
  const sessionCache = {
    styleMap: cache.session.styleMap,
    styleCache: cache.session.styleCache,
    nodeMap: cache.session.nodeMap
  }

  let clone
  let classCSS = '';
  let shadowScopedCSS = '';

  stabilizeLayout(element)

  try {
    inlineExternalDefsAndSymbols(element)
  } catch (e) {
    console.warn("inlineExternal defs or symbol failed:", e);
  }


  try {
    clone = await deepClone(element, sessionCache, options, element);
  } catch (e) {
    console.warn("deepClone failed:", e);
    throw e;
  }
  try {
    await inlinePseudoElements(element, clone, sessionCache, options);
  } catch (e) {
    console.warn("inlinePseudoElements failed:", e);
  }
  await resolveBlobUrlsInTree(clone);
  // --- Pull shadow-scoped CSS out of the clone (avoid visible CSS text) ---

  try {
    const styleNodes = clone.querySelectorAll('style[data-sd]');
    for (const s of styleNodes) {
      shadowScopedCSS += s.textContent || '';
      s.remove(); // Do not leave <style> inside the visual clone
    }
  } catch { }

  const keyToClass = generateCSSClasses(sessionCache.styleMap);
  classCSS = Array.from(keyToClass.entries())
    .map(([key, className]) => `.${className}{${key}}`)
    .join("");

  // prepend shadow CSS so variables/rules are available for everything
  classCSS = shadowScopedCSS + classCSS;

  for (const [node, key] of sessionCache.styleMap.entries()) {
    if (node.tagName === "STYLE") continue;
    /* c8 ignore next 4 */
    if (node.getRootNode && node.getRootNode() instanceof ShadowRoot) {
      node.setAttribute("style", key.replace(/;/g, "; "));
      continue;
    }

    // Fuera de Shadow DOM: aplica clase generada para compresión
    const className = keyToClass.get(key);
    if (className) node.classList.add(className);

    // Reaplica backgroundImage para evitar que se pierda (si existe)
    const bgImage = node.style?.backgroundImage;
    const hasIcon = node.dataset?.snapdomHasIcon;
    if (bgImage && bgImage !== "none") node.style.backgroundImage = bgImage;
    /* c8 ignore next 4 */
    if (hasIcon) {
      node.style.verticalAlign = "middle";
      node.style.display = "inline";
    }
  }


  for (const [cloneNode, originalNode] of sessionCache.nodeMap.entries()) {
    const scrollX = originalNode.scrollLeft;
    const scrollY = originalNode.scrollTop;
    const hasScroll = scrollX || scrollY;
    if (hasScroll && cloneNode instanceof HTMLElement) {
      cloneNode.style.overflow = "hidden";
      cloneNode.style.scrollbarWidth = "none";
      cloneNode.style.msOverflowStyle = "none";
      const inner = document.createElement("div");
      inner.style.transform = `translate(${-scrollX}px, ${-scrollY}px)`;
      inner.style.willChange = "transform";
      inner.style.display = "inline-block";
      inner.style.width = "100%";
      while (cloneNode.firstChild) {
        inner.appendChild(cloneNode.firstChild);
      }
      cloneNode.appendChild(inner);
    }
  }
  if (element === sessionCache.nodeMap.get(clone)) {
    const computed = sessionCache.styleCache.get(element) || window.getComputedStyle(element);
    sessionCache.styleCache.set(element, computed);
    const transform = stripTranslate(computed.transform);
    clone.style.margin = "0";
   // clone.style.position = "static";
    clone.style.top = "auto";
    clone.style.left = "auto";
    clone.style.right = "auto";
    clone.style.bottom = "auto";
    //clone.style.zIndex = "auto";
    clone.style.float = "none";
    clone.style.clear = "none";
    clone.style.transform = transform || "";
  }
  for (const [cloneNode, originalNode] of sessionCache.nodeMap.entries()) {
    if (originalNode.tagName === "PRE") {
      cloneNode.style.marginTop = "0";
      cloneNode.style.marginBlockStart = "0";
    }
  }
  return { clone, classCSS, styleCache: sessionCache.styleCache };
}

function stabilizeLayout(element) {
  const style = getComputedStyle(element);
  const outlineStyle = style.outlineStyle;
  const outlineWidth = style.outlineWidth;
  const borderStyle = style.borderStyle;
  const borderWidth = style.borderWidth;

  const outlineVisible = outlineStyle !== 'none' && parseFloat(outlineWidth) > 0;
  const borderAbsent = (borderStyle === 'none' || parseFloat(borderWidth) === 0);

  if (outlineVisible && borderAbsent) {
    element.style.border = `${outlineWidth} solid transparent`;
  }
}

var _blobToDataUrlCache = new Map();


/**
 * Read a blob: URL and return its data URL, with memoization + shared cache.
 * - Usa snapFetch(as:'dataURL') para convertir directo.
 * - Dedupea inflight guardando la promesa en el Map.
 * - Escribe también en cache.resource para reuso cross-módulo.
 * @param {string} blobUrl
 * @returns {Promise<string>} data URL
 */
async function blobUrlToDataUrl(blobUrl) {
  // 1) Hit en cache global compartido
  if (cache.resource?.has(blobUrl)) return cache.resource.get(blobUrl);

  // 2) Hit en memo local (puede ser promesa o string resuelto)
  if (_blobToDataUrlCache.has(blobUrl)) return _blobToDataUrlCache.get(blobUrl);

  // 3) Crear promesa inflight y guardarla para dedupe
  const p = (async () => {
    const r = await snapFetch(blobUrl, { as: 'dataURL', silent: true });
    if (!r.ok || typeof r.data !== 'string') {
      throw new Error(`[snapDOM] Failed to read blob URL: ${blobUrl}`);
    }
    cache.resource?.set(blobUrl, r.data);   // cache compartido
    return r.data;
  })();

  _blobToDataUrlCache.set(blobUrl, p);
  try {
    const data = await p;
    // Opcional: reemplazar promesa por string ya resuelto (menos retenciones)
    _blobToDataUrlCache.set(blobUrl, data);
    return data;
  } catch (e) {
    // Si falla, limpiamos para permitir reintentos futuros
    _blobToDataUrlCache.delete(blobUrl);
    throw e;
  }
}


var BLOB_URL_RE = /\bblob:[^)"'\s]+/g;

async function replaceBlobUrlsInCssText(cssText) {
  if (!cssText || cssText.indexOf("blob:") === -1) return cssText;
  const uniques = Array.from(new Set(cssText.match(BLOB_URL_RE) || []));
  if (uniques.length === 0) return cssText;
  let out = cssText;
  for (const u of uniques) {
    try {
      const d = await blobUrlToDataUrl(u);
      out = out.split(u).join(d);
    } catch { }
  }
  return out;
}

function isBlobUrl(u) {
  return typeof u === "string" && u.startsWith("blob:");
}

function parseSrcset(srcset) {
  return (srcset || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const m = item.match(/^(\S+)(\s+.+)?$/);
      return m ? { url: m[1], desc: m[2] || "" } : null;
    })
    .filter(Boolean);
}

function stringifySrcset(parts) {
  return parts.map((p) => (p.desc ? `${p.url} ${p.desc.trim()}` : p.url)).join(", ");
}

async function resolveBlobUrlsInTree(root) {
  if (!root) return;

  const imgs = root.querySelectorAll ? root.querySelectorAll("img") : [];
  for (const img of imgs) {
    try {
      const srcAttr = img.getAttribute("src");
      const effective = srcAttr || img.currentSrc || "";
      if (isBlobUrl(effective)) {
        const data = await blobUrlToDataUrl(effective);
        img.setAttribute("src", data);
      }
      const srcset = img.getAttribute("srcset");
      if (srcset && srcset.includes("blob:")) {
        const parts = parseSrcset(srcset);
        let changed = false;
        for (const p of parts) {
          if (isBlobUrl(p.url)) {
            try {
              p.url = await blobUrlToDataUrl(p.url);
              changed = true;
            } catch { }
          }
        }
        if (changed) img.setAttribute("srcset", stringifySrcset(parts));
      }
    } catch { }
  }

  const svgImages = root.querySelectorAll ? root.querySelectorAll("image") : [];
  for (const node of svgImages) {
    try {
      const XLINK_NS = "http://www.w3.org/1999/xlink";
      const href = node.getAttribute("href") || node.getAttributeNS?.(XLINK_NS, "href");
      if (isBlobUrl(href)) {
        const d = await blobUrlToDataUrl(href);
        node.setAttribute("href", d);
        node.removeAttributeNS?.(XLINK_NS, "href");
      }
    } catch { }
  }

  const styled = root.querySelectorAll ? root.querySelectorAll("[style*='blob:']") : [];
  for (const el of styled) {
    try {
      const styleText = el.getAttribute("style");
      if (styleText && styleText.includes("blob:")) {
        const replaced = await replaceBlobUrlsInCssText(styleText);
        el.setAttribute("style", replaced);
      }
    } catch { }
  }

  const styleTags = root.querySelectorAll ? root.querySelectorAll("style") : [];
  for (const s of styleTags) {
    try {
      const css = s.textContent || "";
      if (css.includes("blob:")) {
        s.textContent = await replaceBlobUrlsInCssText(css);
      }
    } catch { }
  }

  const urlAttrs = ["poster"];
  for (const attr of urlAttrs) {
    const nodes = root.querySelectorAll ? root.querySelectorAll(`[${attr}^='blob:']`) : [];
    for (const n of nodes) {
      try {
        const u = n.getAttribute(attr);
        if (isBlobUrl(u)) {
          n.setAttribute(attr, await blobUrlToDataUrl(u));
        }
      } catch { }
    }
  }
}
