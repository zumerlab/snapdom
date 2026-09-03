/**
 * Browser (IIFE) entry: puts `snapdom` and `preCache` on `window`.
 *
 * Exports nothing, on purpose. The build has no `globalName`: with one, esbuild would assign
 * the bundle's empty export object to `window.snapdom` after this file ran and wipe the real
 * one. The entry owns the global (esbuild.config.mjs).
 * @file index.browser.js
 */

import { snapdom } from './api/snapdom.js'
import { preCache } from './api/preCache.js'

if (typeof window !== 'undefined') {
  window.snapdom = snapdom
  window.preCache = preCache
}
