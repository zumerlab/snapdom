/**
 * General helper utilities for DOM, style, and resource handling.
 * @module helpers
 */

import { imageCache, computedStyleCache, bgCache } from "../core/cache";

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
  const isUrl = entry.startsWith("url(");
  const isGradient = /^((repeating-)?(linear|radial|conic)-gradient)\(/i.test(entry);
  if (isUrl) {
    const rawUrl = extractURL(entry);
    if (!rawUrl) return entry;
    const encodedUrl = safeEncodeURI(rawUrl);
    if (bgCache.has(encodedUrl)) {
      return options.skipInline ? void 0 : `url(${bgCache.get(encodedUrl)})`;
    } else {
      const dataUrl = await fetchImage(encodedUrl, {useProxy: options.useProxy});
      bgCache.set(encodedUrl, dataUrl);
      return options.skipInline ? void 0 : `url(${dataUrl})`;
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

  let map = computedStyleCache.get(el);
  if (!map) {
    map = new Map();
    computedStyleCache.set(el, map);
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

export function fetchImage(src, {timeout = 3000, useProxy = ''}) {
  // Determina automáticamente el modo de crossOrigin según la URL
  function getCrossOriginMode(url) {
    try {
      const parsed = new URL(url, window.location.href);
      return parsed.origin === window.location.origin ? "use-credentials" : "anonymous";
    } catch {
      return "anonymous";
    }
  }

  const crossOriginValue = getCrossOriginMode(src);
  console.log(`[SnapDOM - fetchImage] Start loading image: ${src} with crossOrigin=${crossOriginValue}`);

  if (imageCache.has(src)) {
    console.log(`[SnapDOM - fetchImage] Cache hit for: ${src}`);
    return Promise.resolve(imageCache.get(src));
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      console.log(`[SnapDOM - fetchImage] Timeout after ${timeout}ms for image: ${src}`);
      reject(new Error("Image load timed out"));
    }, timeout);

    const fallbackViaFetch = () => {
      console.warn(`[SnapDOM - fetchImage] Trying fetch fallback for: ${src}`);
      fetch(src, {
        mode: "cors",
        credentials: crossOriginValue === "use-credentials" ? "include" : "omit"
      }).then((r) => {
        console.log(`[SnapDOM - fetchImage] Fetch response received for: ${src}`);
        return r.blob();
      }).then((blob) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result;
          if (typeof base64 === "string" && base64.startsWith("data:application/octet-stream")) {
            reject(new Error("Image response was empty or blocked"));
            return;
          }
          imageCache.set(src, base64);
          resolve(base64);
        };
        reader.readAsDataURL(blob);
      }).catch(() => {
        console.warn(`[SnapDOM - fetchImage] Fetch fallback failed for: ${src}`);
        if (useProxy !== '') {
          const proxied = typeof useProxy === "string" ? useProxy.replace(/\/$/, "") + safeEncodeURI(src) : 
          null;

          if (proxied) {
            console.log(`[SnapDOM - fetchImage] Trying proxy fallback: ${proxied}`);
          fetch(proxied).then((r) => r.blob()).then((blob) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64 = reader.result;
              if (typeof base64 === "string" && base64.startsWith("data:application/octet-stream")) {
                reject(new Error("Image response was empty or blocked"));
                return;
              }
              imageCache.set(src, base64);
              resolve(base64);
            };
            reader.readAsDataURL(blob);
          }).catch(() => {
            console.error(`[SnapDOM - fetchImage] Proxy fallback failed for: ${src}`);
            reject(new Error("CORS restrictions prevented image capture (even via proxy)"));
          });
          } else {
            console.error(`[SnapDOM - fetchImage] Provide a valid proxy url: ${src}`);
          }
        } else {
            console.error(`[SnapDOM - fetchImage] You may try add a proxy "useProxy: url" `);
          }
      });
    };

    const image = new Image();
    image.crossOrigin = crossOriginValue;

    image.onload = async () => {
      // console.log(`[SnapDOM - fetchImage] Image loaded: ${src}`);
      clearTimeout(timeoutId);
      try {
        await image.decode();
       //  console.log(`[SnapDOM - fetchImage] Image decoded: ${src}`);
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        try {
          const dataURL = canvas.toDataURL("image/png");
          // console.log(`[SnapDOM - fetchImage] Canvas toDataURL succeeded for: ${src}`);
          imageCache.set(src, dataURL);
          resolve(dataURL);
        } catch (e) {
         // console.warn(`[SnapDOM - fetchImage] Canvas toDataURL failed for: ${src}`, e);
          fallbackViaFetch();
        }
      } catch (e) {
       // console.error(`[SnapDOM - fetchImage] Image decode failed: ${src}`, e);
        fallbackViaFetch();
      }
    };

    image.onerror = (e) => {
      clearTimeout(timeoutId);
      console.error(`[SnapDOM - fetchImage] Image failed to load: ${src}`, e);
      fallbackViaFetch();
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

