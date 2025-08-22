// === Minimal patch: ultra-fast snapshots with full-change invalidation ===
// Keeps snapshot & snapshotKey caches persistent (no resets) but auto-invalidates
// on ANY change (DOM, stylesheets, fonts) via a single global epoch.
//
// Drop-in: preserves your imports and cache usage.

import { getStyleKey } from '../utils/index.js';
import { cache } from '../core/cache.js';

// -----------------------------------------------------------------------------
// 0) Persistent caches (do NOT reset between captures)
// -----------------------------------------------------------------------------

/** Element -> { epoch:number, snapshot:Object } */
const snapshotCache = new WeakMap();
/** signature:string -> styleKey:string (keep hot across captures) */
const snapshotKeyCache = new Map();

// -----------------------------------------------------------------------------
// 1) Global epoch that bumps on ANY relevant change
// -----------------------------------------------------------------------------

let __epoch = 0; // increases whenever something changes that can affect styles
function bumpEpoch() { __epoch++; }

// Wire once; extremely low overhead
let __wired = false;
/**
 * Observe document-level changes that can affect computed styles:
 * - DOM mutations under the root you're capturing
 * - <style>/<link rel="stylesheet"> changes
 * - Font loading (icon fonts, etc.)
 * Call is idempotent; safe to leave as-is.
 * @param {Element} [root=document.documentElement]
 */
function setupInvalidationOnce(root = document.documentElement) {
  if (__wired) return;
  __wired = true;

  // Any DOM change under root triggers invalidation
  try {
    const domObs = new MutationObserver(() => bumpEpoch());
    domObs.observe(root || document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  } catch {}

  // Stylesheet changes (new/removed/edited style/link) trigger invalidation
  try {
    const headObs = new MutationObserver(() => bumpEpoch());
    headObs.observe(document.head, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  } catch {}

  // Font availability (metrics/icon fonts becoming ready) triggers invalidation
  try {
    const f = document.fonts;
    if (f) {
      f.addEventListener?.('loadingdone', bumpEpoch, { once: false });
      f.ready?.then(() => bumpEpoch()).catch(() => {});
    }
  } catch {}
}

// -----------------------------------------------------------------------------
// 2) Snapshot helpers (unchanged semantics; minimal add of epoch check)
// -----------------------------------------------------------------------------

/**
 * Build a flattened computed-style snapshot from a CSSStyleDeclaration.
 * Keeps your visibility tweak and external URL sanitization.
 * @param {CSSStyleDeclaration} style
 * @returns {Record<string,string>}
 */
function snapshotComputedStyleFull(style) {
  const result = {};
  const computedVisibility = style.getPropertyValue('visibility');

  for (let i = 0; i < style.length; i++) {
    const prop = style[i];
    let val = style.getPropertyValue(prop);
    if (
      (prop === 'background-image' || prop === 'content') &&
      val.includes('url(') &&
      !val.includes('data:')
    ) {
      val = 'none';
    }
    result[prop] = val;
  }

  if (computedVisibility === 'hidden') {
    result.opacity = '0';
  }
  return result;
}

/** Memo for signatures per snapshot object */
const __snapshotSig = new WeakMap();
/**
 * Canonical signature for a computed-style snapshot (memoized).
 * @param {Record<string,string>} snapshot
 */
function styleSignature(snapshot) {
  let sig = __snapshotSig.get(snapshot);
  if (sig) return sig;
  const entries = Object.entries(snapshot);
  entries.sort((a, b) => (a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0)));
  sig = entries.map(([k, v]) => `${k}:${v}`).join(';');
  __snapshotSig.set(snapshot, sig);
  return sig;
}

/**
 * Return a snapshot for `el`. Reuse only if the global epoch didn't change.
 * If anything in the doc changed since the last capture, the epoch differs and we recompute.
 * @param {Element} el
 * @param {CSSStyleDeclaration|null} [preStyle]
 */
function getSnapshot(el, preStyle = null) {
  const rec = snapshotCache.get(el);
  if (rec && rec.epoch === __epoch) {
    return rec.snapshot; // HOT path: unchanged environment
  }
  const style = preStyle || getComputedStyle(el);
  const snap = snapshotComputedStyleFull(style);
  snapshotCache.set(el, { epoch: __epoch, snapshot: snap });
  return snap;
}

// -----------------------------------------------------------------------------
// 3) Back-compat context adapter (keeps your current cache/session usage)
// -----------------------------------------------------------------------------

function ensureContext(context) {
  if (context && context.session && context.persist) return context;
  return {
    persist: {
      snapshotKeyCache,
      defaultStyle: cache.defaultStyle,
      baseStyle: cache.baseStyle,
      image: cache.image,
      resource: cache.resource,
      background: cache.background,
      font: cache.font,
    },
    session: cache.session,
    options: (context && context.options) || {},
  };
}

// -----------------------------------------------------------------------------
// 4) Public API: inlineAllStyles (drop-in)
// -----------------------------------------------------------------------------

/**
 * Inline styles using persistent snapshot & signature caches with full invalidation.
 * Speed: when nothing changed, all nodes hit hot caches.
 * Fidelity: if *anything* changed (DOM, styles, fonts), epoch increments and nodes recompute.
 * @param {Element} source
 * @param {Element} clone
 * @param {object} [context]
 */
export async function inlineAllStyles(source, clone, context) {
    if (source.tagName === "STYLE") return;
  // Wire invalidation (idempotent, tiny cost)
  setupInvalidationOnce(document.documentElement);

  const ctx = ensureContext(context);
  const { session, persist } = ctx;

  // Cache getComputedStyle per capture (your current pattern)
  if (!session.styleCache.has(source)) {
    session.styleCache.set(source, getComputedStyle(source));
  }
  const preStyle = session.styleCache.get(source);

  // Snapshot that auto-invalidates if ANY change happened
  const snapshot = getSnapshot(source, preStyle);

  // Dedupe by canonical signature → stable style key (persistent across captures)
  const sig = styleSignature(snapshot);
  let key = persist.snapshotKeyCache.get(sig);
  if (!key) {
    const tag = source.tagName?.toLowerCase() || 'div';
    key = getStyleKey(snapshot, tag);
    persist.snapshotKeyCache.set(sig, key);
  }

  session.styleMap.set(clone, key);
}
