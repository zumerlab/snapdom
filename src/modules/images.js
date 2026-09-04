/**
 * Inline every <img> and SVG <image> in the clone as a data URL.
 *
 * An svg-as-image document loads no external resources, so a remote src paints nothing
 * inside the foreignObject. This pass fetches each one through snapFetch and writes the data
 * URL onto the clone; an <img> that cannot be fetched becomes a sized placeholder (or an
 * invisible spacer with `placeholders: false`). SVG <image href> gets the same treatment
 * since #341.
 *
 * One contract, measured: an inlined data: URL is written to the clone ONCE. Every src
 * write re-parses and re-decodes the payload, every read through the `src` getter
 * re-serializes it, and the 9-photo gallery (26 MB of base64) paid that four times over
 * (cloneNode's attribute copy, freezeImgSrcset re-setting the same value, this pass
 * re-assigning it, compress writing the downsample) plus two regex scans of the same
 * megabytes. Removing all but the first took the warm pipeline from 172 ms to 62 and the
 * cold one from 409 to 298. What is left is cloneNode's own 41 ms, since the attribute copy
 * itself starts a load; avoiding it means a clone with no `src` until serialization, which a
 * plugin reading the clone would see, so it is not done.
 * Pinned by __tests__/modules.images.dataUrlPassthrough.test.js, which counts the writes.
 * @module images
 */

import { snapFetch } from './snapFetch.js'
import { sessionWarn } from '../utils/debug.js'
import { cache } from '../core/cache.js'
import { pickSrcsetCandidate } from './pictureResolver.js'

const XLINK_NS = 'http://www.w3.org/1999/xlink'

/** `href`, then the legacy `xlink:href` in either spelling. */
function getSvgImageHref(el) {
  return el.getAttribute('href') || el.getAttribute('xlink:href') ||
    (typeof el.getAttributeNS === 'function' ? el.getAttributeNS(XLINK_NS, 'href') : null)
}

/**
 * The box a placeholder should take when the image never loaded.
 *
 * snapdom's own data-snapdom-width/height win, then the inline style, then the width/height
 * attributes, then whatever the element reports, then 100x100. A failed image has no
 * natural size, so the earlier hints are the only way to keep the layout from collapsing.
 * @param {HTMLImageElement} img
 * @returns {{ width: number, height: number }}
 */
function extractImageDimensions(img) {
  const dsW = parseInt(img.dataset?.snapdomWidth || '', 10) || 0
  const dsH = parseInt(img.dataset?.snapdomHeight || '', 10) || 0
  const attrW = parseInt(img.getAttribute('width') || '', 10) || 0
  const attrH = parseInt(img.getAttribute('height') || '', 10) || 0
  const styleW = parseFloat(img.style?.width || '') || 0
  const styleH = parseFloat(img.style?.height || '') || 0

  const w = dsW || styleW || attrW || img.width || img.naturalWidth || 100
  const h = dsH || styleH || attrH || img.height || img.naturalHeight || 100

  return { width: w, height: h }
}

/**
 * Inline every <img> and SVG <image> in the clone, six at a time.
 *
 * Per <img>: pick one concrete src (srcset and sizes are dropped), reuse a cached data URL,
 * else fetch. A fetch that fails tries `fallbackURL` (string or async callback), then
 * replaces the element with a grey "img" box of the estimated size (plus an `image-fallback`
 * session warning), or with an invisible spacer under `placeholders: false`.
 * Also runs on the differential path (diff.js) for the rebuilt subtree.
 * Pinned by __tests__/modules.images.test.js.
 * @param {Element} clone - the clone, or the <img> itself when that is the capture root
 * @param {object} [options={}] - capture context; reads useProxy, fallbackURL, placeholders, __session
 * @returns {Promise<void>}
 */
export async function inlineImages(clone, options = {}) {
  // querySelectorAll only matches descendants: when the capture root is itself an
  // <img>, it must be included or its src stays external and svg-as-image won't load it.
  const imgs = Array.from(clone.querySelectorAll('img'))
  if (clone.tagName === 'IMG') imgs.unshift(clone)
  /** @param {HTMLImageElement} img */
  const processImg = async (img) => {
    // Normalize src/srcset/sizes to a single concrete URL. currentSrc stays empty on the
    // detached clone until the candidate loads (Chromium/Firefox), so derive a candidate
    // from srcset before stripping it — never demote a sourced img to a source-less one.
    if (!img.getAttribute('src')) {
      const eff = img.currentSrc || img.src || pickSrcsetCandidate(img.getAttribute('srcset'), img) || ''
      if (eff) img.setAttribute('src', eff)
    }

    img.removeAttribute('srcset')
    img.removeAttribute('sizes')

    // Already inline: nothing to fetch, and the clone carries it. Re-assigning the same
    // string re-parsed and re-decoded it (61 ms of a 180 ms gallery pipeline, 26 MB of
    // base64), and the image cache would have kept a multi-MB key pointing at itself. The
    // attribute is read raw on purpose: the `src` GETTER re-serializes the URL, another
    // copy of every payload.
    if ((img.getAttribute('src') || '').startsWith('data:')) {
      if (!img.width) img.width = img.naturalWidth || 100
      if (!img.height) img.height = img.naturalHeight || 100
      return
    }
    const src = img.src || ''
    if (!src) return

    // Reuse the data URL an earlier capture fetched for the same resolved src: snapFetch
    // caches no successes, so this cross-capture cache is what keeps a repeat from re-fetching.
    const cached = cache.image?.get(src)
    if (cached) {
      img.src = cached
      if (!img.width) img.width = img.naturalWidth || 100
      if (!img.height) img.height = img.naturalHeight || 100
      return
    }

    const r = await snapFetch(src, { as: 'dataURL', useProxy: options.useProxy })
    if (r.ok && typeof r.data === 'string' && r.data.startsWith('data:')) {
      // Success path: inline DataURL and ensure dimensions for layout fidelity
      cache.image?.set(src, r.data)
      img.src = r.data
      // Same bytes as the data URL, zero-copy into compress's worker (a Blob crosses
      // postMessage by reference; the string would be cloned and base64-decoded again).
      if (r.blob) img.__snapdomBlob = r.blob
      if (!img.width) img.width = img.naturalWidth || 100
      if (!img.height) img.height = img.naturalHeight || 100
      return
    }
    // Try fallbackURL (string or callback)
    const { width: fbW, height: fbH } = extractImageDimensions(img)
    const { fallbackURL } = options || {}
    if (fallbackURL) {
      try {
        const fallbackUrl =
          typeof fallbackURL === 'function'
            ? await fallbackURL({ width: fbW, height: fbH, src, element: img })
            : fallbackURL

        if (fallbackUrl) {
          const fallbackData = await snapFetch(fallbackUrl, { as: 'dataURL', useProxy: options.useProxy })
          if (fallbackData?.ok && typeof fallbackData.data === 'string') {
            img.src = fallbackData.data
            if (!img.width) img.width = fbW
            if (!img.height) img.height = fbH
            return
          }
        }
      } catch {
        // a throwing callback or a bad fallback fetch falls through to the placeholder
      }
    }

    if (options.placeholders !== false) {
      sessionWarn(options.__session, 'image-fallback', `image failed to inline, using placeholder: ${src}`)
      const fallback = document.createElement('div')
      fallback.style.cssText = [
        `width:${fbW}px`,
        `height:${fbH}px`,
        'background:#ccc',
        'display:inline-block',
        'text-align:center',
        `line-height:${fbH}px`,
        'color:#666',
        'font-size:12px',
        'overflow:hidden'
      ].join(';')
      fallback.textContent = 'img'
      img.replaceWith(fallback)
    } else {
      const spacer = document.createElement('div')
      spacer.style.cssText = `display:inline-block;width:${fbW}px;height:${fbH}px;visibility:hidden;`
      img.replaceWith(spacer)
    }
  }

  // Batch size 6 matches the typical per-origin HTTP/1.1 connection limit;
  // raising it further doesn't help once the connection pool is saturated
  // and could degrade other in-flight requests on the page.
  const BATCH = 6
  for (let i = 0; i < imgs.length; i += BATCH) {
    const group = imgs.slice(i, i + BATCH).map(processImg)
    await Promise.allSettled(group)
  }

  // #341: SVG <image href="https://..."> (Highcharts, D3). No placeholder on failure: the
  // href stays as it was and the rasterizer draws nothing there.
  const svgImages = Array.from(clone.querySelectorAll('image'))
  if (clone.localName === 'image') svgImages.unshift(clone)
  const processSvgImage = async (el) => {
    const href = getSvgImageHref(el)
    if (!href || href.startsWith('data:') || href.startsWith('blob:')) return

    const r = await snapFetch(href, { as: 'dataURL', useProxy: options.useProxy })
    if (r.ok && typeof r.data === 'string' && r.data.startsWith('data:')) {
      el.setAttribute('href', r.data)
      el.removeAttribute('xlink:href')
      if (typeof el.removeAttributeNS === 'function') el.removeAttributeNS(XLINK_NS, 'href')
    }
  }
  for (let i = 0; i < svgImages.length; i += BATCH) {
    const group = svgImages.slice(i, i + BATCH).map(processSvgImage)
    await Promise.allSettled(group)
  }
}
