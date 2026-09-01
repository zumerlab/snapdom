// __tests__/helpers/category.libs.js
// Library adapters shared by the category benchmark and the capability matrix.
//
// This module registers NOTHING (no describe/bench/test). That is the point: a test file
// that imports a module which calls `bench()` at load time dies with "`bench()` is only
// available in benchmark mode", because the bench registry only exists under `vitest bench`.
// Keeping the adapters here lets category.benchmark.js and category.capabilities.test.js
// share one definition without sharing a registration.
//
// Competitors are fetched from a CDN. A STATIC `import ... from 'https://…'` aborts
// collection of the entire file when the link is down or slow, which is why this suite could
// not be part of `npm test`. Each competitor is loaded lazily and independently instead: one
// unreachable payload costs one row, and the suites report it as unavailable. snapdom is
// local, so its row always runs, offline included.

import { snapdom } from '../../src/index'

/**
 * Normalize any library output (data URL | <img> | <canvas> | Blob) to a PNG data URL,
 * so every adapter ends at the same stage.
 * @param {any} out
 * @returns {Promise<string>}
 */
export async function toDataUrl(out) {
  if (typeof out === 'string') return out
  if (out?.tagName === 'IMG') return out.src
  if (out?.tagName === 'CANVAS') return out.toDataURL('image/png')
  if (out instanceof Blob) {
    return await new Promise((r) => {
      const f = new FileReader()
      f.onload = () => r(/** @type {string} */ (f.result))
      f.readAsDataURL(out)
    })
  }
  if (out && typeof out.toPng === 'function') return toDataUrl(await out.toPng())
  throw new Error('unrecognized capture output')
}

const pick = (m) => (m.default && typeof m.default === 'object' ? m.default : m)

// Vite statically analyses `import()` with a literal argument and tries to resolve it at
// build time; @vite-ignore hands the URL to the browser's own loader instead.
const cdn = (url) => import(/* @vite-ignore */ url)

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.onload = () => resolve(undefined)
    script.onerror = () => reject(new Error(`failed to load ${src}`))
    document.head.appendChild(script)
  })
}

// Insertion order is the order every report renders in, so keep snapdom first.
const LOADERS = {
  'snapDOM current': async () => async (el) => toDataUrl(await snapdom.toPng(el, { scale: 1 })),

  'html2canvas 1.4.1': async () => {
    if (!(/** @type {any} */ (window).html2canvas)) {
      await loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js')
    }
    return async (el) => toDataUrl(await /** @type {any} */ (window).html2canvas(el, { logging: false, scale: 1 }))
  },

  'html-to-image 1.11.13': async () => {
    const m = await cdn('https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/+esm')
    return async (el) => toDataUrl(await m.toPng(el, { pixelRatio: 1 }))
  },

  'modern-screenshot 4.7.0': async () => {
    const m = await cdn('https://cdn.jsdelivr.net/npm/modern-screenshot@4.7.0/+esm')
    return async (el) => toDataUrl(await m.domToPng(el, { scale: 1 }))
  },

  'dom-to-image-more 3.10.2': async () => {
    const m = pick(await cdn('https://cdn.jsdelivr.net/npm/dom-to-image-more@3.10.2/+esm'))
    return async (el) => toDataUrl(await m.toPng(el, { scale: 1 }))
  },

  'dom-to-image 2.6.0': async () => {
    const m = pick(await cdn('https://cdn.jsdelivr.net/npm/dom-to-image@2.6.0/+esm'))
    return async (el) => toDataUrl(await m.toPng(el, { scale: 1 }))
  },

  'dom-to-image-modern 1.0.2': async () => {
    const m = pick(await cdn('https://cdn.jsdelivr.net/npm/dom-to-image-modern@1.0.2/+esm'))
    return async (el) => toDataUrl(await m.toPng(el, { scale: 1 }))
  },

  'domlens.js 0.1.0': async () => {
    const m = await cdn('https://cdn.jsdelivr.net/npm/domlens.js@0.1.0/+esm')
    return async (el) => toDataUrl(await m.capture(el, { scale: 1 }))
  },

  '@renoun/screenshot 0.3.3': async () => {
    const m = await cdn('https://cdn.jsdelivr.net/npm/@renoun/screenshot@0.3.3/+esm')
    return async (el) => toDataUrl(await m.screenshot.canvas(el, { scale: 1 }))
  },
}

/** Every library name the category covers, in report order. */
export const LIB_NAMES = Object.keys(LOADERS)

/** name → why it could not be loaded. Populated by loadLibs(). */
export const UNAVAILABLE = new Map()

let loaded = null

/**
 * Resolve every adapter that this machine can actually reach.
 * @returns {Promise<Record<string, (el: Element) => Promise<string>>>} name → adapter
 */
export async function loadLibs() {
  if (loaded) return loaded
  const libs = {}
  for (const [name, load] of Object.entries(LOADERS)) {
    try {
      libs[name] = await load()
    } catch (e) {
      UNAVAILABLE.set(name, String(e?.message || e).slice(0, 120))
    }
  }
  loaded = libs
  return libs
}
