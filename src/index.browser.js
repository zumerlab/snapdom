/**
 * Entry point for snapDOM library exports.
 *
 * @file index.browser.js
 */

import { snapdom } from './api/snapdom.js';
import { preCache } from './api/preCache.js';

window.snapdom = snapdom;
window.preCache = preCache;

