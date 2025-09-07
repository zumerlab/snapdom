/**
 * snapFetch — unified fetch for SnapDOM
 * - Single inflight queue & error cache (with TTL)
 * - Timeout via AbortController
 * - Optional proxy handling ("...{url}" or "...?url=")
 * - Non-throwing: always resolves { ok, data|null, status, url, reason, ... }
 * - Thin, deduplicated logging: `[snapDOM]` warn/error with TTL + session cap
 *
 * @typedef {'text'|'blob'|'dataURL'} FetchAs
 *
 * @typedef {Object} SnapFetchOptions
 * @property {FetchAs} [as='blob']               Expected result type.
 * @property {number}  [timeout=3000]            Timeout in ms.
 * @property {string}  [useProxy='']             Proxy template or base URL. Supports "{url}" or "?url=" patterns.
 * @property {number}  [errorTTL=8000]           ms to cache errors to avoid retry storms.
 * @property {RequestCredentials} [credentials]  Override inferred credentials.
 * @property {Record<string,string>} [headers]   Optional headers.
 * @property {boolean} [silent=false]            If true, disables console logging for this call.
 * @property {(r:SnapFetchResult)=>void} [onError] Optional hook when a fetch fails (ok=false).
 *
 * @typedef {Object} SnapFetchResult
 * @property {boolean} ok
 * @property {string|Blob|null} data             Text, Blob, or DataURL (depending on `as`).
 * @property {number} status                     HTTP status (0 on network/timeout).
 * @property {string} url                        Final URL (after proxy if applied).
 * @property {boolean} fromCache                 Served from inflight/error cache.
 * @property {string} [mime]                     Best-effort MIME (blob/dataURL modes).
 * @property {string} [reason]                   Failure reason (e.g., 'http_error','timeout','abort','network').
 */

// ---------------------------------------------------------------------------
// Slim logger: dedup + TTL + session cap
// ---------------------------------------------------------------------------

function createSnapLogger(prefix = '[snapDOM]', { ttlMs = 5 * 60_000, maxEntries = 12 } = {}) {
  /** @type {Map<string, number>} until timestamps by key */
  const seen = new Map();
  let emitted = 0;

  /** @param {'warn'|'error'} level @param {string} key @param {string} msg */
  function log(level, key, msg) {
    if (emitted >= maxEntries) return;
    const now = Date.now();
    const until = seen.get(key) || 0;
    if (until > now) return; // still under TTL
    seen.set(key, now + ttlMs);
    emitted++;
    if (level === 'warn' && console && console.warn) console.warn(`${prefix} ${msg}`);
    else if (console && console.error) console.error(`${prefix} ${msg}`);
  }

  return {
    warnOnce(key, msg) { log('warn', key, msg); },
    errorOnce(key, msg) { log('error', key, msg); },
    reset() { seen.clear(); emitted = 0; },
  };
}

const snapLogger = createSnapLogger('[snapDOM]', { ttlMs: 3 * 60_000, maxEntries: 10 });

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** @type {Map<string, Promise<SnapFetchResult>>} */
const _inflight = new Map();
/** @type {Map<string, {until:number, result:SnapFetchResult}>} */
const _errorCache = new Map();

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** @param {string} url */
function isSpecialURL(url) {
  return /^data:|^blob:|^about:blank$/.test(url);
}

/** @param {string} url @param {string} useProxy */
function shouldProxy(url, useProxy) {
  if (!useProxy || isSpecialURL(url)) return false;
  try {
    const base = (typeof location !== 'undefined' && location.href) ? location.href : 'http://localhost/';
    const u = new URL(url, base);
    return (typeof location !== 'undefined') ? (u.origin !== location.origin) : true;
  } catch {
    return !!useProxy;
  }
}

/** @param {string} url @param {string} useProxy */
function applyProxy(url, useProxy) {
  if (!useProxy) return url;
  if (useProxy.includes('{url}')) return useProxy.replace('{url}', encodeURIComponent(url));
    const sep = useProxy.endsWith('?') ? '' : (useProxy.includes('?') ? '&' : '?');
    return `${useProxy}${sep}url=${encodeURIComponent(url)}`;
}

/** @param {Blob} blob */
function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result || ''));
    fr.onerror = () => rej(new Error('read_failed'));
    fr.readAsDataURL(blob);
  });
}

/** @param {string} url @param {SnapFetchOptions} o */
function makeKey(url, o) {
  return [
    o.as || 'blob',
    o.timeout ?? 3000,
    o.useProxy || '',
    o.errorTTL ?? 8000,
    url
  ].join('|');
}

// ---------------------------------------------------------------------------
// snapFetch
// ---------------------------------------------------------------------------

/**
 * Unified, non-throwing fetch with minimal, deduplicated logging.
 * @param {string} url
 * @param {SnapFetchOptions} [options]
 * @returns {Promise<SnapFetchResult>}
 */
export async function snapFetch(url, options = {}) {
  const as = options.as ?? 'blob';
  const timeout = options.timeout ?? 3000;
  const useProxy = options.useProxy || '';
  const errorTTL = options.errorTTL ?? 8000;
  const headers = options.headers || {};
  const silent = !!options.silent;

  const key = makeKey(url, { as, timeout, useProxy, errorTTL });

  // Error cache
  const e = _errorCache.get(key);
  if (e && e.until > Date.now()) {
  return { ...e.result, fromCache: true };

  } else if (e) {
    _errorCache.delete(key);
  }

  // Inflight
  const inflight = _inflight.get(key);
  if (inflight) return inflight;

  // Final URL & credentials
  const finalURL = shouldProxy(url, useProxy) ? applyProxy(url, useProxy) : url;

  let cred = options.credentials;
  if (!cred) {
    try {
      const base = (typeof location !== 'undefined' && location.href) ? location.href : 'http://localhost/';
      const u = new URL(url, base);
      const sameOrigin = (typeof location !== 'undefined') && (u.origin === location.origin);
      cred = sameOrigin ? 'include' : 'omit';
    } catch {
      cred = 'omit';
    }
  }

  // Timeout controller
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort('timeout'), timeout);

  const p = (async () => {
    try {
      const resp = await fetch(finalURL, { signal: ctrl.signal, credentials: cred, headers });

      if (!resp.ok) {
        const result = { ok: false, data: null, status: resp.status, url: finalURL, fromCache: false, reason: 'http_error' };
        _errorCache.set(key, { until: Date.now() + errorTTL, result });
        if (!silent) {
          const short = `${resp.status} ${resp.statusText || ''}`.trim();
          snapLogger.warnOnce(
            `http:${resp.status}:${as}:${(new URL(url, (location?.href ?? 'http://localhost/'))).origin}`,
            `HTTP error ${short} while fetching ${as} ${url}`
          );
        }
        options.onError && options.onError(result);
        return result;
      }

      if (as === 'text') {
        const text = await resp.text();
        return { ok: true, data: text, status: resp.status, url: finalURL, fromCache: false };
      }

      const blob = await resp.blob();
      const mime = blob.type || resp.headers.get('content-type') || '';

      if (as === 'dataURL') {
        const dataURL = await blobToDataURL(blob);
        return { ok: true, data: dataURL, status: resp.status, url: finalURL, fromCache: false, mime };
      }

      // default blob
      return { ok: true, data: blob, status: resp.status, url: finalURL, fromCache: false, mime };

    } catch (err) {
      const reason = (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError')
        ? (String(err.message || '').includes('timeout') ? 'timeout' : 'abort')
        : 'network';

      const result = { ok: false, data: null, status: 0, url: finalURL, fromCache: false, reason };
      _errorCache.set(key, { until: Date.now() + errorTTL, result });

      if (!silent) {
        const k = `${reason}:${as}:${(new URL(url, (location?.href ?? 'http://localhost/'))).origin}`;
        // Messages are concise, actionable, and deduped:
        // - timeout: suggest raising timeout or using proxy
        // - abort: likely external cancel
        // - network: connectivity/CORS; suggest proxy
        const tips = reason === 'timeout'
          ? `Timeout after ${timeout}ms. Consider increasing timeout or using a proxy for ${url}`
          : reason === 'abort'
          ? `Request aborted while fetching ${as} ${url}`
          : `Network/CORS issue while fetching ${as} ${url}. A proxy may be required`;
        snapLogger.errorOnce(k, tips);
      }

      options.onError && options.onError(result);
      return result;
    } finally {
      clearTimeout(timer);
      _inflight.delete(key);
    }
  })();

  _inflight.set(key, p);
  return p;
}
