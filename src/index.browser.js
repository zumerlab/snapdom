/**
 * Entry point for snapDOM library exports.
 *
 * @file index.browser.js
 */

import { snapdom } from './api/snapdom.js';
import { preCache } from './api/preCache.js';

if (typeof window !== 'undefined') {
  window.snapdom = snapdom;
  window.preCache = preCache;
}