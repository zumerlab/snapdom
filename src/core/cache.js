/**
 * Caches for images, backgrounds, resources, and computed styles used during DOM capture.
 * @module cache
 */

export const imageCache = new Map();
export const bgCache = new Map();
export const resourceCache = new Map();
export const defaultStylesCache = new Map();
export const baseCSSCache = new Map();
export const computedStyleCache = new WeakMap();
export const processedFontURLs = new Set();

