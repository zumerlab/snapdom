import { getStyleKey, NO_DEFAULTS_TAGS } from '../utils/index.js';
import { cache } from '../core/cache.js';

const snapshotCache = new WeakMap();
const snapshotKeyCache = new Map();
let __epoch = 0;
function bumpEpoch() { __epoch++; }

export function notifyStyleEpoch() { bumpEpoch(); }

let __wired = false;
function setupInvalidationOnce(root = document.documentElement) {
  if (__wired) return;
  __wired = true;
  try {
    const domObs = new MutationObserver(() => bumpEpoch());
    domObs.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
  } catch { }
  try {
    const headObs = new MutationObserver(() => bumpEpoch());
    headObs.observe(document.head, { subtree: true, childList: true, characterData: true, attributes: true });
  } catch { }
  try {
    const f = document.fonts;
    if (f) {
      f.addEventListener?.('loadingdone', bumpEpoch);
      f.ready?.then(() => bumpEpoch()).catch(() => { });
    }
  } catch { }
}

function snapshotComputedStyleFull(style, options = {}) {
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
  if (options.embedFonts) {
    const EXTRA_FONT_PROPS = [
      "font-feature-settings",
      "font-variation-settings",
      "font-kerning",
      "font-variant",
      "font-variant-ligatures",
      "font-optical-sizing",
    ];
    for (const prop of EXTRA_FONT_PROPS) {
      if (out[prop]) continue;
      try {
        const v = style.getPropertyValue(prop);
        if (v) out[prop] = v;
      } catch { }
    }
  }
  if (vis === 'hidden') out.opacity = '0';
  return out;
}
const __snapshotSig = new WeakMap();
function styleSignature(snap) {
  let sig = __snapshotSig.get(snap);
  if (sig) return sig;
  const entries = Object.entries(snap).sort((a, b) => a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0));
  sig = entries.map(([k, v]) => `${k}:${v}`).join(';');
  __snapshotSig.set(snap, sig);
  return sig;
}
function getSnapshot(el, preStyle = null, options = {}) {
  const rec = snapshotCache.get(el);
  if (rec && rec.epoch === __epoch) return rec.snapshot;
  const style = preStyle || getComputedStyle(el);
  const snap = snapshotComputedStyleFull(style, options);
  snapshotCache.set(el, { epoch: __epoch, snapshot: snap });
  return snap;
}

function _resolveCtx(sessionOrCtx, opts) {
  if (sessionOrCtx && sessionOrCtx.session && sessionOrCtx.persist) return sessionOrCtx;
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

export async function inlineAllStyles(source, clone, sessionOrCtx, opts) {
  if (source.tagName === 'STYLE') return;

  const ctx = _resolveCtx(sessionOrCtx, opts);
  const resetMode = (ctx.options && ctx.options.cache) || 'auto';

  if (resetMode !== 'disabled') setupInvalidationOnce(document.documentElement);

  if (resetMode === 'disabled' && !ctx.session.__bumpedForDisabled) {
    bumpEpoch();
    snapshotKeyCache.clear();
    ctx.session.__bumpedForDisabled = true;
  }

  if (NO_DEFAULTS_TAGS.has(source.tagName?.toLowerCase())) {
    const author = source.getAttribute?.('style');
    if (author) clone.setAttribute('style', author);
  }

  const { session, persist } = ctx;

  if (!session.styleCache.has(source)) {
    session.styleCache.set(source, getComputedStyle(source));
  }
  const pre = session.styleCache.get(source);

  const snap = getSnapshot(source, pre, ctx.options);

  const sig = styleSignature(snap);
  let key = persist.snapshotKeyCache.get(sig);
  if (!key) {
    const tag = source.tagName?.toLowerCase() || 'div';
    key = getStyleKey(snap, tag);
    persist.snapshotKeyCache.set(sig, key);
  }
  session.styleMap.set(clone, key);
}
