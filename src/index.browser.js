/**
 * Entry point for snapDOM library exports.
 *
 * @file index.browser.js
 */

import { snapdom } from './api/snapdom.js';
import { preCache } from './api/preCache.js';

window.snapdom = snapdom;

// Global browsers
if (typeof window !== 'undefined') {
  window.snapdom = snapdom;
  window.preCache = preCache;
}

// CommonJS (Angular, Node, etc)
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = { snapdom, preCache };
}

// AMD 
if (typeof define === 'function' && define.amd) {
  define([], function () {
    return { snapdom, preCache };
  });
}

// Fallback
if (typeof globalThis !== 'undefined') {
  globalThis.snapdom = snapdom;
  globalThis.preCache = preCache;
}


