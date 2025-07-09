import { getStyleKey } from '../utils/cssTools.js';
import { getStyle } from '../utils/helpers.js';

const snapshotCache = new WeakMap();       // Element → snapshot (object)
const snapshotKeyCache = new Map();        // hash string → style key

function snapshotComputedStyleFull(style) {
  const result = {};
  for (let i = 0; i < style.length; i++) {
    const prop = style[i];
    let val = style.getPropertyValue(prop);

    // Opcional: evitar URLs externas que puedan romper renderizado
    if (
      (prop === 'background-image' || prop === 'content') &&
      val.includes('url(') &&
      !val.includes('data:')
    ) {
      val = 'none';
    }

    result[prop] = val;
  }
  return result;
}

export function inlineAllStyles(source, clone, styleMap, cache, compress) {
  if (source.tagName === 'STYLE') return;

  if (!cache.has(source)) {
    cache.set(source, getStyle(source));
  }
  const style = cache.get(source);

  if (!snapshotCache.has(source)) {
    const snapshot = snapshotComputedStyleFull(style);
    snapshotCache.set(source, snapshot);
  }

  const snapshot = snapshotCache.get(source);

  const hash = Object.entries(snapshot)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prop, val]) => `${prop}:${val}`)
    .join(';');

  if (snapshotKeyCache.has(hash)) {
    styleMap.set(clone, snapshotKeyCache.get(hash));
    return;
  }

  const tagName = source.tagName?.toLowerCase() || 'div';
  const key = getStyleKey(snapshot, tagName, compress);

  snapshotKeyCache.set(hash, key);
  styleMap.set(clone, key);
}
