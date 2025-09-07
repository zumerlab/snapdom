import { getStyleKey, NO_DEFAULTS_TAGS } from '../utils/index.js';
import { cache } from '../core/cache.js';

// === epoch + caches internos (persistentes entre capturas) ===
const snapshotCache = new WeakMap();      // el -> {epoch, snapshot}
const snapshotKeyCache = new Map();       // signature -> styleKey
let __epoch = 0;
function bumpEpoch() { __epoch++; }

// opcional: hook público si querés forzar invalidación manual desde otro módulo
export function notifyStyleEpoch() { bumpEpoch(); }

let __wired = false;
function setupInvalidationOnce(root = document.documentElement) {
  if (__wired) return;
  __wired = true;
  try {
    const domObs = new MutationObserver(() => bumpEpoch());
    domObs.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
  } catch {}
  try {
    const headObs = new MutationObserver(() => bumpEpoch());
    headObs.observe(document.head, { subtree: true, childList: true, characterData: true, attributes: true });
  } catch {}
  try {
    const f = document.fonts;
    if (f) {
      f.addEventListener?.('loadingdone', bumpEpoch);
      f.ready?.then(() => bumpEpoch()).catch(() => {});
    }
  } catch {}
}

function snapshotComputedStyleFull(style) {
  const out = {};
  const vis = style.getPropertyValue('visibility');
  for (let i = 0; i < style.length; i++) {
    const prop = style[i];
    let val = style.getPropertyValue(prop);
    if ((prop === 'background-image' || prop === 'content') && val.includes('url(') && !val.includes('data:')) {
      val = 'none';
    }
    out[prop] = val;
  }
  if (vis === 'hidden') out.opacity = '0';
  return out;
}
const __snapshotSig = new WeakMap();
function styleSignature(snap) {
  let sig = __snapshotSig.get(snap);
  if (sig) return sig;
  const entries = Object.entries(snap).sort((a,b) => a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0));
  sig = entries.map(([k,v]) => `${k}:${v}`).join(';');
  __snapshotSig.set(snap, sig);
  return sig;
}
function getSnapshot(el, preStyle = null) {
  const rec = snapshotCache.get(el);
  if (rec && rec.epoch === __epoch) return rec.snapshot;
  const style = preStyle || getComputedStyle(el);
  const snap = snapshotComputedStyleFull(style);
  snapshotCache.set(el, { epoch: __epoch, snapshot: snap });
  return snap;
}

// adapta cualquier llamada: (src, clone, sessionCache, options)  o  (src, clone, ctx)
function _resolveCtx(sessionOrCtx, opts) {
  // 1) ya es ctx completo
  if (sessionOrCtx && sessionOrCtx.session && sessionOrCtx.persist) return sessionOrCtx;

  // 2) vino sessionCache + options
  if (sessionOrCtx && (sessionOrCtx.styleMap || sessionOrCtx.styleCache || sessionOrCtx.nodeMap)) {
    return {
      session: sessionOrCtx,
      persist: {
        snapshotKeyCache,
        defaultStyle: cache.defaultStyle,
        baseStyle: cache.baseStyle,
        image: cache.image,
        resource: cache.resource,
        background: cache.background,
        font: cache.font,
      },
      options: opts || {},
    };
  }

  // 3) fallback: sólo options
  return {
    session: cache.session,
    persist: {
      snapshotKeyCache,
      defaultStyle: cache.defaultStyle,
      baseStyle: cache.baseStyle,
      image: cache.image,
      resource: cache.resource,
      background: cache.background,
      font: cache.font,
    },
    options: (sessionOrCtx || opts || {}),
  };
}

/**
 * Firma flexible:
 *   inlineAllStyles(source, clone, sessionCache, options)
 *   inlineAllStyles(source, clone, ctx)
 */
export async function inlineAllStyles(source, clone, sessionOrCtx, opts) {
  if (source.tagName === 'STYLE') return;

  const ctx = _resolveCtx(sessionOrCtx, opts);
  const resetMode = (ctx.options && ctx.options.cache) || 'auto';

  // sólo enganchar observer si NO está 'disabled'
  if (resetMode !== 'disabled') setupInvalidationOnce(document.documentElement);

    if (resetMode === 'disabled' && !ctx.session.__bumpedForDisabled) {
    bumpEpoch();               // invalida snapshotCache por epoch
    snapshotKeyCache.clear();  // evita reuso de firmas→styleKey previas
    ctx.session.__bumpedForDisabled = true;
  }
  // Copia author styles para tags sin defaults costosos (pero seguimos mapeando)
  if (NO_DEFAULTS_TAGS.has(source.tagName?.toLowerCase())) {
    const author = source.getAttribute?.('style');
    if (author) clone.setAttribute('style', author);
  }

  const { session, persist } = ctx;

  // cachea getComputedStyle por captura
  if (!session.styleCache.has(source)) {
    session.styleCache.set(source, getComputedStyle(source));
  }
  const pre = session.styleCache.get(source);

  // snapshot dependiente de epoch
  const snap = getSnapshot(source, pre);

  // dedupe por firma → clave de estilo estable
  const sig = styleSignature(snap);
  let key = persist.snapshotKeyCache.get(sig);
  if (!key) {
    const tag = source.tagName?.toLowerCase() || 'div';
    key = getStyleKey(snap, tag);
    persist.snapshotKeyCache.set(sig, key);
  }

  session.styleMap.set(clone, key);
}
