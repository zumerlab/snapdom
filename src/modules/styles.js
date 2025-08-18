import { getStyleKey, getStyle} from '../utils/index.js';
import {cache} from '../core/cache.js'

const snapshotCache = new WeakMap();       // Element → snapshot (object)
const snapshotKeyCache = new Map();        // hash string → style key

function snapshotComputedStyleFull(style) {
  const result = {};
  // Comprobamos primero la visibilidad computada (incluye herencia)
  const computedVisibility = style.getPropertyValue('visibility');

  for (let i = 0; i < style.length; i++) {
    const prop = style[i];
    let val = style.getPropertyValue(prop);
    // Evitar URLs externas que puedan romper renderizado
    if (
      (prop === 'background-image' || prop === 'content') &&
      val.includes('url(') &&
      !val.includes('data:')
    ) {
      val = 'none';
    }

    result[prop] = val;
  }

  // Si el nodo (o por herencia) está invisible, forzamos opacity:0
  // (solo si no hemos capturado ya una opacidad explícita)
  if (computedVisibility === 'hidden') {
    result.opacity = '0';
  }

  return result;
}



export function inlineAllStyles(source, clone, sessionCache, options) {
  
  if (source.tagName === 'STYLE') return;

  if (!sessionCache.styleCache.has(source)) {
    sessionCache.styleCache.set(source, getStyle(source));
  }
  const style = sessionCache.styleCache.get(source);

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
    sessionCache.styleMap.set(clone, snapshotKeyCache.get(hash));
    return;
  }

  const tagName = source.tagName?.toLowerCase() || 'div';
  const key = getStyleKey(snapshot, tagName, options);

  snapshotKeyCache.set(hash, key);
  sessionCache.styleMap.set(clone, key);
}



