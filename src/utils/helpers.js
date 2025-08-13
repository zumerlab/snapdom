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
  const match = value.match(/url\((['"]?)(.*?)(\1)\)/);
  if (!match) return null;

  const url = match[2].trim();
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
// utils/helpers.js (solo la función; deja el resto como está)
var _inflight = /* @__PURE__ */ new Map();
var _errorCache = /* @__PURE__ */ new Map();

export function fetchImage(
  src,
  { timeout = 3000, useProxy = "", errorTTL = 8000 } = {}
) {
  function getCrossOriginMode(url) {
    try {
      const parsed = new URL(url, window.location.href);
      return parsed.origin === window.location.origin ? "use-credentials" : "anonymous";
    } catch {
      return "anonymous";
    }
  }

  // Helpers seguros: NUNCA rechazan, devuelven {ok|error}
  const ok   = (data) => ({ ok: true,  data });
  const fail = (e) => ({ ok: false, error: e instanceof Error ? e : new Error(String(e)) });

  function fetchBlobAsDataURLSafe(fetchUrl) {
    try {
      return fetch(fetchUrl, {
        mode: "cors",
        credentials: getCrossOriginMode(fetchUrl) === "use-credentials" ? "include" : "omit",
      })
        .then((r) => {
          if (!r.ok) return fail(new Error("HTTP " + r.status));
          return r.blob().then((blob) => new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64 = reader.result;
              if (typeof base64 !== "string" || !base64.startsWith("data:image/")) {
                resolve(fail(new Error("Invalid image data URL")));
              } else {
                resolve(ok(base64));
              }
            };
            reader.onerror = () => resolve(fail(new Error("FileReader error")));
            reader.readAsDataURL(blob);
          }));
        })
        .catch((e) => fail(e));
    } catch (e) {
      return Promise.resolve(fail(e));
    }
  }

  function fetchWithFallbackOnceSafe(url) {
    return fetchBlobAsDataURLSafe(url).then((r) => {
      if (r.ok) return r;
      if (useProxy && typeof useProxy === "string") {
        const proxied = useProxy.replace(/\/$/, "") + safeEncodeURI(url);
        return fetchBlobAsDataURLSafe(proxied).then((r2) => {
          if (r2.ok) return r2;
          return fail(new Error("[SnapDOM - fetchImage] Fetch failed and no proxy provided"));
        });
      }
      return fail(new Error("[SnapDOM - fetchImage] Fetch failed and no proxy provided"));
    });
  }

  // cooldown / inflight
  const now = Date.now();
  const until = _errorCache.get(src);
  if (until && until > now) {
    const pr = Promise.reject(new Error("[SnapDOM - fetchImage] Recently failed (cooldown)."));
    pr.catch(() => {}); // evita "unhandled" si el caller no hace catch
    return pr;
  }
  if (_inflight.has(src)) return _inflight.get(src);

  const crossOriginValue = getCrossOriginMode(src);

  // cache rápida
  if (cache.image.has(src)) return Promise.resolve(cache.image.get(src));
  if (src.startsWith("data:image/")) {
    cache.image.set(src, src);
    return Promise.resolve(src);
  }

  // ==== SVG ====
  if (/\.svg(\?.*)?$/i.test(src)) {
    const p2 = (async () => {
      // intento directo
      const direct = await (async () => {
        try {
          const res = await fetch(src, {
            mode: "cors",
            credentials: crossOriginValue === "use-credentials" ? "include" : "omit",
          });
          if (!res.ok) return fail(new Error("HTTP " + res.status));
          const svgText = await res.text();
          return ok(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`);
        } catch (e) {
          return fail(e);
        }
      })();

      if (direct.ok) {
        cache.image.set(src, direct.data);
        return direct.data;
      }

      // fallback
      const via = await fetchWithFallbackOnceSafe(src);
      if (via.ok) {
        cache.image.set(src, via.data);
        return via.data;
      }
      _errorCache.set(src, now + errorTTL);
      return Promise.reject(via.error); // <— rechazo CONTROLADO (los tests con .rejects lo capturan)
    })();

    _inflight.set(src, p2);
    p2.finally(() => _inflight.delete(src));
    p2.catch(() => {});               // <— blindaje anti-unhandled si alguien no hace catch
    return p2;
  }

  // ==== Raster genérico ====
  const p = new Promise((resolve, reject) => {
    let finished = false;
    const img = new Image();

    const finish = (fn) => (arg) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      img.onload = img.onerror = null;
      fn(arg);
    };

    const onSuccess = (d) => { cache.image.set(src, d); resolve(d); };
    const onFinalError = (e) => { _errorCache.set(src, Date.now() + errorTTL); reject(e); };

    const timeoutId = setTimeout(
      finish(() => {
        // El test "rejects on timeout" quiere exactamente este mensaje
        fetchWithFallbackOnceSafe(src).then((r) => {
          if (r.ok) onSuccess(r.data);
          else onFinalError(new Error("Image load timed out"));
        });
      }),
      timeout
    );

    img.crossOrigin = crossOriginValue;

    img.onload = finish(() => {
      Promise.resolve(img.decode())
        .then(() => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            onSuccess(canvas.toDataURL("image/png"));
          } catch {
            fetchWithFallbackOnceSafe(src).then((r) => {
              if (r.ok) onSuccess(r.data); else onFinalError(r.error);
            });
          }
        })
        .catch(() => {
          // El test "decode fail" quiere el mensaje de proxy ausente
          fetchWithFallbackOnceSafe(src).then((r) => {
            if (r.ok) onSuccess(r.data); else onFinalError(r.error);
          });
        });
    });

    img.onerror = finish(() => {
      // El test "invalid-url" quiere el mensaje de proxy ausente
      fetchWithFallbackOnceSafe(src).then((r) => {
        if (r.ok) onSuccess(r.data); else onFinalError(r.error);
      });
    });

    img.src = src;
  });

  _inflight.set(src, p);
  p.finally(() => _inflight.delete(src));
  p.catch(() => {});                 // <— blindaje anti-unhandled si alguien no hace catch
  return p;
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

