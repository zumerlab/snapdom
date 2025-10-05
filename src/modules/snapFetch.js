// src/modules/snapFetch.js
import { safeEncodeURI } from '../utils/helpers.js'

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
  const seen = new Map()
  let emitted = 0

  function log(level, key, msg) {
    if (emitted >= maxEntries) return
    const now = Date.now()
    const until = seen.get(key) || 0
    if (until > now) return // still under TTL
    seen.set(key, now + ttlMs)
    emitted++
    if (level === 'warn' && console && console.warn) console.warn(`${prefix} ${msg}`)
    else if (console && console.error) console.error(`${prefix} ${msg}`)
  }

  return {
    warnOnce(key, msg) { log('warn', key, msg) },
    errorOnce(key, msg) { log('error', key, msg) },
    reset() { seen.clear(); emitted = 0 },
  }
}

const snapLogger = createSnapLogger('[snapDOM]', { ttlMs: 3 * 60_000, maxEntries: 10 })

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const _inflight = new Map()
const _errorCache = new Map()

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** data:/blob:/about:blank should not go through proxy decision */
function isSpecialURL(url) {
  return /^data:|^blob:|^about:blank$/i.test(url)
}

/** Avoid re-proxying an URL that's already going through the proxy */
function isAlreadyProxied(url, useProxy) {
  try {
    const baseHref = (typeof location !== 'undefined' && location.href) ? location.href : 'http://localhost/'
    const proxyBaseRaw = useProxy.includes('{url}') ? useProxy.split('{url}')[0] : useProxy
    const proxyBase = new URL(proxyBaseRaw || '.', baseHref)
    const u = new URL(url, baseHref)

    // Same origin as proxy → likely already proxied
    if (u.origin === proxyBase.origin) return true

    // Common query keys used by proxies
    const sp = u.searchParams
    if (sp && (sp.has('url') || sp.has('target'))) return true
  } catch {}
  return false
}

/** Decide whether to proxy based on origin/config */
function shouldProxy(url, useProxy) {
  if (!useProxy) return false
  if (isSpecialURL(url)) return false
  if (isAlreadyProxied(url, useProxy)) return false
  try {
    const base = (typeof location !== 'undefined' && location.href) ? location.href : 'http://localhost/'
    const u = new URL(url, base)
    return (typeof location !== 'undefined') ? (u.origin !== location.origin) : true
  } catch {
    // If URL can't be parsed but a proxy is configured, err on the side of proxying
    return !!useProxy
  }
}

/**
 * Apply proxy in multiple formats:
 * - Template: "...?url={url}" (query-encoded) or "/proxy/{urlRaw}" (path-style)
 * - Explicit query base: "...?url=" or matches /[?&]url=$/
 * - Ends with "?" → append "url=" before value (tests expect this)
 * - Path-style base: endsWith("/")
 * - Fallback: append "?url="
 */
function applyProxy(url, useProxy) {
  if (!useProxy) return url

  // Template tokens
  if (useProxy.includes('{url}')) {
    return useProxy
      .replace('{urlRaw}', safeEncodeURI(url))     // path-style (1.9.9 compatible)
      .replace('{url}', encodeURIComponent(url))  // query-style
  }

  // Explicit query base
  if (/[?&]url=?$/.test(useProxy)) {
    return `${useProxy}${encodeURIComponent(url)}`
  }
  // Ends with '?' → tests want '?url=' prefix
  if (useProxy.endsWith('?')) {
    return `${useProxy}url=${encodeURIComponent(url)}`
  }

  // Path-style base
  if (useProxy.endsWith('/')) {
    return `${useProxy}${safeEncodeURI(url)}`     // DO NOT use encodeURIComponent here
  }

  // Fallback query param
  const sep = useProxy.includes('?') ? '&' : '?'
  return `${useProxy}${sep}url=${encodeURIComponent(url)}`
}

function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(String(fr.result || ''))
    fr.onerror = () => rej(new Error('read_failed'))
    fr.readAsDataURL(blob)
  })
}

function makeKey(url, o) {
  return [
    o.as || 'blob',
    o.timeout ?? 3000,
    o.useProxy || '',
    o.errorTTL ?? 8000,
    url
  ].join('|')
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
  const as = options.as ?? 'blob'
  const timeout = options.timeout ?? 3000
  const useProxy = options.useProxy || ''
  const errorTTL = options.errorTTL ?? 8000
  const headers = options.headers || {}
  const silent = !!options.silent

  // --- Special schemes: handle explicitly so tests expect data: outputs ---

  // data:
  if (/^data:/i.test(url)) {
    try {
      if (as === 'text') {
        return { ok: true, data: String(url), status: 200, url, fromCache: false }
      }
      if (as === 'dataURL') {
        return {
          ok: true,
          data: String(url),
          status: 200,
          url,
          fromCache: false,
          mime: String(url).slice(5).split(';')[0] || ''
        }
      }
      // as === 'blob' → decode data: to Blob
      const [, meta = '', data = ''] = String(url).match(/^data:([^,]*),(.*)$/) || []
      const isBase64 = /;base64/i.test(meta)
      const bin = isBase64 ? atob(data) : decodeURIComponent(data)
      const bytes = new Uint8Array([...bin].map(c => c.charCodeAt(0)))
      const b = new Blob([bytes], { type: (meta || '').split(';')[0] || '' })
      return { ok: true, data: b, status: 200, url, fromCache: false, mime: b.type || '' }
    } catch {
      return { ok: false, data: null, status: 0, url, fromCache: false, reason: 'special_url_error' }
    }
  }

  // blob:
  if (/^blob:/i.test(url)) {
    try {
      const resp = await fetch(url)
      if (!resp.ok) {
        return { ok: false, data: null, status: resp.status, url, fromCache: false, reason: 'http_error' }
      }
      const blob = await resp.blob()
      const mime = blob.type || resp.headers.get('content-type') || ''
      if (as === 'dataURL') {
        const dataURL = await blobToDataURL(blob)
        return { ok: true, data: dataURL, status: resp.status, url, fromCache: false, mime }
      }
      if (as === 'text') {
        const text = await blob.text()
        return { ok: true, data: text, status: resp.status, url, fromCache: false, mime }
      }
      return { ok: true, data: blob, status: resp.status, url, fromCache: false, mime }
    } catch {
      // Do NOT memoize blob: failures — these are often transient (revocations)
      return { ok: false, data: null, status: 0, url, fromCache: false, reason: 'network' }
    }
  }

  // about:blank
  if (/^about:blank$/i.test(url)) {
    if (as === 'dataURL') {
      return {
        ok: true,
        data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==',
        status: 200,
        url,
        fromCache: false,
        mime: 'image/png'
      }
    }
    return { ok: true, data: as === 'text' ? '' : new Blob([]), status: 200, url, fromCache: false }
  }

  // ---- Normal http(s) path ----

  const key = makeKey(url, { as, timeout, useProxy, errorTTL })

  // Error cache
  const e = _errorCache.get(key)
  if (e && e.until > Date.now()) {
    return { ...e.result, fromCache: true }
  } else if (e) {
    _errorCache.delete(key)
  }

  // Inflight dedupe
  const inflight = _inflight.get(key)
  if (inflight) return inflight

  // Final URL (with robust proxying) & credentials
  const finalURL = shouldProxy(url, useProxy) ? applyProxy(url, useProxy) : url

  let cred = options.credentials
  if (!cred) {
    try {
      const base = (typeof location !== 'undefined' && location.href) ? location.href : 'http://localhost/'
      const u = new URL(url, base)
      const sameOrigin = (typeof location !== 'undefined') && (u.origin === location.origin)
      cred = sameOrigin ? 'include' : 'omit'
    } catch {
      cred = 'omit'
    }
  }

  // Timeout controller
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort('timeout'), timeout)

  const p = (async () => {
    try {
      const resp = await fetch(finalURL, { signal: ctrl.signal, credentials: cred, headers })

      if (!resp.ok) {
        const result = { ok: false, data: null, status: resp.status, url: finalURL, fromCache: false, reason: 'http_error' }
        if (errorTTL > 0) _errorCache.set(key, { until: Date.now() + errorTTL, result })
        if (!silent) {
          const short = `${resp.status} ${resp.statusText || ''}`.trim()
          snapLogger.warnOnce(
            `http:${resp.status}:${as}:${(new URL(url, (location?.href ?? 'http://localhost/'))).origin}`,
            `HTTP error ${short} while fetching ${as} ${url}`
          )
        }
        options.onError && options.onError(result)
        return result
      }

      if (as === 'text') {
        const text = await resp.text()
        return { ok: true, data: text, status: resp.status, url: finalURL, fromCache: false }
      }

      const blob = await resp.blob()
      const mime = blob.type || resp.headers.get('content-type') || ''

      if (as === 'dataURL') {
        const dataURL = await blobToDataURL(blob)
        return { ok: true, data: dataURL, status: resp.status, url: finalURL, fromCache: false, mime }
      }

      // default 'blob'
      return { ok: true, data: blob, status: resp.status, url: finalURL, fromCache: false, mime }

    } catch (err) {
      const reason =
        (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError')
          ? (String(err.message || '').includes('timeout') ? 'timeout' : 'abort')
          : 'network'

      const result = { ok: false, data: null, status: 0, url: finalURL, fromCache: false, reason }

      // Persist HTTP network failures; avoid memoizing non-HTTP (handled above)
      if (!/^blob:/i.test(url) && errorTTL > 0) {
        _errorCache.set(key, { until: Date.now() + errorTTL, result })
      }

      if (!silent) {
        const k = `${reason}:${as}:${(new URL(url, (location?.href ?? 'http://localhost/'))).origin}`
        const tips = reason === 'timeout'
          ? `Timeout after ${timeout}ms. Consider increasing timeout or using a proxy for ${url}`
          : reason === 'abort'
            ? `Request aborted while fetching ${as} ${url}`
            : `Network/CORS issue while fetching ${as} ${url}. A proxy may be required`
        snapLogger.errorOnce(k, tips)
      }

      options.onError && options.onError(result)
      return result

    } finally {
      clearTimeout(timer)
      _inflight.delete(key)
    }
  })()

  _inflight.set(key, p)
  return p
}
