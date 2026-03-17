/**
 * Utilities for inlining <img> and SVG <image> elements as data URLs or placeholders.
 * Fixes #341: SVG <image href="https://..."> now inlined like HTML <img>.
 * @module images
 */

import { snapFetch } from './snapFetch.js'

const XLINK_NS = 'http://www.w3.org/1999/xlink'

function getSvgImageHref(el) {
  return el.getAttribute('href') || el.getAttribute('xlink:href') ||
    (typeof el.getAttributeNS === 'function' ? el.getAttributeNS(XLINK_NS, 'href') : null)
}

/**
 * Extract dimensions from an image element in priority order
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
 * Converts all <img> elements in the clone to data URLs or replaces them with
 * placeholders if loading fails. Compatible with the new non-throwing snapFetch.
 *
 * - Success: result.ok === true && typeof result.data === 'string' (DataURL)
 * - Failure: any other case → replace <img> with a sized fallback <div>
 *
 * @param {Element} clone - Clone of the original element
 * @param {{ useProxy?: string }} [options={}] - Options for image processing
 * @returns {Promise<void>}
 */
export async function inlineImages(clone, options = {}) {
  const imgs = Array.from(clone.querySelectorAll('img'))
  /** @param {HTMLImageElement} img */
  const processImg = async (img) => {
    // Normalize src/srcset/sizes to a single concrete URL
    if (!img.getAttribute('src')) {
      const eff = img.currentSrc || img.src || ''
      if (eff) img.setAttribute('src', eff)
    }

    img.removeAttribute('srcset')
    img.removeAttribute('sizes')

    const src = img.src || ''
    if (!src) return

    const r = await snapFetch(src, { as: 'dataURL', useProxy: options.useProxy })
    if (r.ok && typeof r.data === 'string' && r.data.startsWith('data:')) {
      // Success path: inline DataURL and ensure dimensions for layout fidelity
      img.src = r.data
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
        // noop → cae al placeholder
      }
    }

    if (options.placeholders !== false) {
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

  for (let i = 0; i < imgs.length; i += 4) {
    const group = imgs.slice(i, i + 4).map(processImg)
    await Promise.allSettled(group)
  }

  // #341: Inline SVG <image href="https://..."> (e.g. Highcharts, D3)
  const svgImages = Array.from(clone.querySelectorAll('image'))
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
  for (let i = 0; i < svgImages.length; i += 4) {
    const group = svgImages.slice(i, i + 4).map(processSvgImage)
    await Promise.allSettled(group)
  }
}
