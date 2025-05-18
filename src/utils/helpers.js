import { imageCache, computedStyleCache } from "../core/cache";

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
 *
 *
 * @export
 * @param {*} el
 * @param {*} [pseudo=null]
 * @return {*} 
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
 *
 *
 * @export
 * @param {*} content
 * @return {*} 
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
 *
 *
 * @export
 * @param {*} cssValue
 * @return {*} 
 */
export function extractUrl(cssValue) {
  const m = cssValue.match(/url\(["']?([^"')]+)["']?\)/);
  return m ? m[1] : null;
}
/**
 *
 *
 * @export
 * @param {*} familyOrUrl
 * @return {*} 
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
export function fetchImage(src, timeout = 3000) {

  if (imageCache.has(src)) {
    return Promise.resolve(imageCache.get(src));
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error("Image load timed out"));
    }, timeout);

    const image = new Image();
    image.crossOrigin = "anonymous";

    image.onload = async () => {
      clearTimeout(timeoutId);
      try {
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0);
        try {
          const dataURL = canvas.toDataURL("image/png");
          // Guarda en cache para futuras llamadas
          imageCache.set(src, dataURL);
          resolve(dataURL);
        } catch (e) {
          reject(new Error("CORS restrictions prevented image capture"));
        }
      } catch (e) {
        reject(e);
      }
    };

    image.onerror = (e) => {
      clearTimeout(timeoutId);
      reject(new Error("Failed to load image: " + (e.message || "Unknown error")));
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
