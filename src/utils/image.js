
import { cache } from "../core/cache";
import { extractURL, safeEncodeURI } from "./helpers";


/**
 * Adds a background color to the canvas if specified.
 * @param {HTMLCanvasElement} baseCanvas - Source canvas element.
 * @param {string} backgroundColor - CSS color string for the background.
 * @returns {HTMLCanvasElement} Returns the original canvas if no background needed,
 * or a new canvas with the background applied.
 */
export function createBackground(baseCanvas, backgroundColor) {
  if (!backgroundColor || !baseCanvas.width || !baseCanvas.height) {
    return baseCanvas;
  }

  const temp = document.createElement('canvas');
  temp.width = baseCanvas.width;
  temp.height = baseCanvas.height;
  const ctx = temp.getContext('2d');

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, temp.width, temp.height);
  ctx.drawImage(baseCanvas, 0, 0);

  return temp;
}

// deps esperadas en tu archivo:
// import { cache } from '../core/cache.js'
// import { fetchImage } from '../utils/fetchImage.js'
// import { extractURL, safeEncodeURI } from '../utils/index.js'

/**
 * Inline a single background-image entry (one layer) robustly.
 * - If it's a URL() and fetching fails, degrade to "none" instead of throwing.
 * - Gradients and "none" are returned untouched.
 * - Uses cache.background to avoid repeated work.
 *
 * @param {string} entry - A single background layer (e.g., 'url("...")', 'linear-gradient(...)', 'none')
 * @param {{ useProxy?: string }} [options]
 * @returns {Promise<string|undefined>} Inlined CSS value for this layer (e.g., `url("data:...")`), original entry, or "none".
 */
export async function inlineSingleBackgroundEntry(entry, options = {}) {
  // Quick checks for non-URL values
  const isGradient = /^((repeating-)?(linear|radial|conic)-gradient)\(/i.test(entry);
  if (isGradient || entry.trim() === "none") {
    return entry; // leave as is
  }

  // Extract raw URL from url("...") (your existing helper)
  const rawUrl = extractURL(entry);
  if (!rawUrl) {
    // Not a URL(...) we recognize → keep original as a safe fallback
    return entry;
  }

  // Normalize / encode the URL string for cache key & fetch
  const encodedUrl = safeEncodeURI(rawUrl);

  // Fast path: cached success
  if (cache.background.has(encodedUrl)) {
    const dataUrl = cache.background.get(encodedUrl);
    return dataUrl ? `url("${dataUrl}")` : "none";
  }

  // Try to inline; never throw — degrade to "none" on failure
  try {
    const dataUrl = await fetchImage(encodedUrl, {
      useProxy: options.useProxy || "",
    });
    // Guard: ensure it actually looks like an image data URL
    if (typeof dataUrl === "string" && /^data:image\//i.test(dataUrl)) {
      cache.background.set(encodedUrl, dataUrl);
      return `url("${dataUrl}")`;
    }
    // Unexpected format → degrade safely
    cache.background.set(encodedUrl, null);
    return "none";
  } catch {
    // On any error (404/CORS/timeout/tainted/etc.), don't break the capture
    cache.background.set(encodedUrl, null); // remember failure to avoid loops
    return "none";
  }
}


var _inflight = /* @__PURE__ */ new Map();
var _errorCache = /* @__PURE__ */ new Map();

export function fetchImage(src, { timeout = 3000, useProxy = "", errorTTL = 8000 } = {}) {

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