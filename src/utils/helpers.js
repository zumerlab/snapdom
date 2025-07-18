/**
 * General helper utilities for DOM, style, and resource handling.
 * @module helpers
 */

import { cache } from "../core/cache";

/**
 * Fetches and inlines a single background-image entry to a data URL (with caching).
 * - If entry is a gradient or "none", returns unchanged.
 * - If entry is a url(...), fetches the image as data URL and caches it.
 *
 * @param {string} entry - Single background-image entry (e.g., "url(...)").
 * @param {Object} [options={}] - Options like crossOrigin.
 * @param {boolean} [options.skipInline=false] - If true, only fetches & caches, doesn't return a replacement.
 * @returns {Promise<string|void>} - The processed entry (unless skipInline is true).
 */
export async function inlineSingleBackgroundEntry(entry, options = {}) {
  const rawUrl = extractURL(entry)

  const isGradient = /^((repeating-)?(linear|radial|conic)-gradient)\(/i.test(entry);
  
  if (rawUrl) {
    const encodedUrl = safeEncodeURI(rawUrl);
    if (cache.background.has(encodedUrl)) {
      return options.skipInline ? void 0 : `url(${cache.background.get(encodedUrl)})`;
    } else {
      const dataUrl = await fetchImage(encodedUrl, { useProxy: options.useProxy });
      cache.background.set(encodedUrl, dataUrl);
      return options.skipInline ? void 0 : `url("${dataUrl}")`;
    }
  }

  if (isGradient || entry === "none") {
    return entry;
  }

  return entry;
}


/**
 * Creates a promise that resolves after the specified delay
 * @param {number} [ms=0] - Milliseconds to delay
 * @returns {Promise<void>} Promise that resolves after the delay
 */

export function idle(fn, { fast = false } = {}) {
  if (fast) return fn();
  if ('requestIdleCallback' in window) {
    requestIdleCallback(fn, { timeout: 50 });
  } else {
    setTimeout(fn, 1);
  }
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
 * Extracts a URL from a CSS value like background-image.
 *
 * @param {string} value - The CSS value
 * @returns {string|null} The extracted URL or null
 */

export function extractURL(value) {
  const urlStart = value.indexOf("url(");
  if (urlStart === -1) return null;
  let url = value.slice(urlStart + 4).trim(); // Remove "url("
  if (url.endsWith(")")) url = url.slice(0, -1).trim(); // Remove trailing ")"
  if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
    url = url.slice(1, -1);
  }
  if (url.startsWith('#')) return null;
  return url;
}

/**
 * Determines if a font family or URL is an icon font.
 *
 * @param {string} familyOrUrl - The font family or URL
 * @returns {boolean} True if it is an icon font
 */
export function isIconFont(familyOrUrl) {
  const iconFontPatterns = [
    /font\s*awesome/i,
    /material\s*icons/i,
    /ionicons/i,
    /glyphicons/i,
    /feather/i,
    /bootstrap\s*icons/i,
    /remix\s*icons/i,
    /heroicons/i,
    /layui/i,
    /lucide/i
  ];
  return iconFontPatterns.some(rx => rx.test(familyOrUrl));
}
/**
 *
 *
 * @export
 * @param {*} src
 * @param {number} [timeout=3000]
 * @return {*} 
 */

export function fetchImage(src, { timeout = 3000, useProxy = '' } = {}) {
  function getCrossOriginMode(url) {
    try {
      const parsed = new URL(url, window.location.href);
      return parsed.origin === window.location.origin ? "use-credentials" : "anonymous";
    } catch {
      return "anonymous";
    }
  }

  // Función común para fallback vía fetch + proxy
  async function fetchWithFallback(url) {
    const fetchBlobAsDataURL = (fetchUrl) =>
      fetch(fetchUrl, {
        mode: "cors",
        credentials: getCrossOriginMode(fetchUrl) === "use-credentials" ? "include" : "omit",
      })
        .then(r => r.blob())
        .then(blob => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = reader.result;
            if (typeof base64 !== "string" || !base64.startsWith("data:image/")) {
              reject(new Error("Invalid image data URL"));
              return;
            }
            resolve(base64);
          };
          reader.onerror = () => reject(new Error("FileReader error"));
          reader.readAsDataURL(blob);
        }));

    try {
      return await fetchBlobAsDataURL(url);
    } catch (e) {
      if (useProxy && typeof useProxy === "string") {
        const proxied = useProxy.replace(/\/$/, "") + safeEncodeURI(url);
        try {
          return await fetchBlobAsDataURL(proxied);
        } catch {
          console.error(`[SnapDOM - fetchImage] Proxy fallback failed for: ${url}`);
          throw new Error("CORS restrictions prevented image capture (even via proxy)");
        }
      } else {
        console.error(`[SnapDOM - fetchImage] No valid proxy URL provided for fallback: ${url}`);
        throw new Error("Fetch fallback failed and no proxy provided");
      }
    }
  }

  const crossOriginValue = getCrossOriginMode(src);
  console.log(`[SnapDOM - fetchImage] Start loading image: ${src} with crossOrigin=${crossOriginValue}`);

  if (cache.image.has(src)) {
    console.log(`[SnapDOM - fetchImage] Cache hit for: ${src}`);
    return Promise.resolve(cache.image.get(src));
  }

  // Detectamos si es un data URI, si sí, devolvemos directo sin fetch
  const isDataURI = src.startsWith("data:image/");
  if (isDataURI) {
    cache.image.set(src, src);
    return Promise.resolve(src);
  }

  // Mejor detección SVG, incluyendo query strings
  const isSVG = /\.svg(\?.*)?$/i.test(src);

  if (isSVG) {
    return (async () => {
      try {
        const response = await fetch(src, {
          mode: "cors",
          credentials: crossOriginValue === "use-credentials" ? "include" : "omit"
        });
        const svgText = await response.text();
        const encoded = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
        cache.image.set(src, encoded);
        return encoded;
      } catch {
        return fetchWithFallback(src);
      }
    })();
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      console.log(`[SnapDOM - fetchImage] Timeout after ${timeout}ms for image: ${src}`);
      reject(new Error("Image load timed out"));
    }, timeout);

    const image = new Image();
    image.crossOrigin = crossOriginValue;

    image.onload = async () => {
      clearTimeout(timeoutId);
      try {
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const dataURL = canvas.toDataURL("image/png");
        cache.image.set(src, dataURL);
        resolve(dataURL);
      } catch {
        try {
          const fallbackDataURL = await fetchWithFallback(src);
          cache.image.set(src, fallbackDataURL);
          resolve(fallbackDataURL);
        } catch (e) {
          reject(e);
        }
      }
    };

    image.onerror = async () => {
      clearTimeout(timeoutId);
      console.error(`[SnapDOM - fetchImage] Image failed to load: ${src}`);
      try {
        const fallbackDataURL = await fetchWithFallback(src);
        cache.image.set(src, fallbackDataURL);
        resolve(fallbackDataURL);
      } catch (e) {
        reject(e);
      }
    };

    image.src = src;
  });
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

export function isSafari() {
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
}

export function stripTranslate(transform) {
  if (!transform || transform === 'none') return '';

  let cleaned = transform.replace(/translate[XY]?\([^)]*\)/g, '');

  cleaned = cleaned.replace(/matrix\(([^)]+)\)/g, (_, values) => {
    const parts = values.split(',').map(s => s.trim());
    if (parts.length !== 6) return `matrix(${values})`;
    parts[4] = '0';
    parts[5] = '0';
    return `matrix(${parts.join(', ')})`;
  });

  cleaned = cleaned.replace(/matrix3d\(([^)]+)\)/g, (_, values) => {
    const parts = values.split(',').map(s => s.trim());
    if (parts.length !== 16) return `matrix3d(${values})`;
    parts[12] = '0';
    parts[13] = '0';
    return `matrix3d(${parts.join(', ')})`;
  });

  return cleaned.trim().replace(/\s{2,}/g, ' ');
}

export function safeEncodeURI(uri) {
  if (/%[0-9A-Fa-f]{2}/.test(uri)) return uri; // prevent reencode
  try {
    return encodeURI(uri);
  } catch {
    return uri;
  }
}

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

