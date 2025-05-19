/**
 * Core logic for capturing DOM elements as SVG data URLs.
 * @module capture
 */

import { prepareClone } from './prepare.js';
import { inlineImages } from '../modules/images.js';
import { inlineBackgroundImages } from '../modules/background.js';
import { idle, isSafari } from '../utils/helpers.js';
import { collectUsedTagNames, generateDedupedBaseCSS } from '../utils/cssTools.js';
import { embedCustomFonts } from '../modules/fonts.js';
import { baseCSSCache } from '../core/cache.js'

/**
 * Captures an HTML element as an SVG data URL, inlining styles, images, backgrounds, and optionally fonts.
 *
 * @param {Element} element - DOM element to capture
 * @param {Object} [options={}] - Capture options
 * @param {boolean} [options.compress=true] - Whether to compress style keys
 * @param {boolean} [options.embedFonts=false] - Whether to embed custom fonts
 * @param {boolean} [options.fast=true] - Whether to skip idle delay for faster results
 * @param {number} [options.scale=1] - Output scale multiplier
 * @returns {Promise<string>} Promise that resolves to an SVG data URL
 */

export async function captureDOM(element, options = {}) {
  if (!element) throw new Error("Element cannot be null or undefined");
  const { compress = true, embedFonts = false, fast = true, scale = 1 } = options;
  let clone, classCSS, styleCache;
  let fontsCSS = "";
  let baseCSS = "";
  let dataURL;
  let svgString;
  ({ clone, classCSS, styleCache } = await prepareClone(element, compress));
  await new Promise((resolve) => {
    idle(async () => {
      await inlineImages(clone);
      resolve();
    }, { fast });
  });
  await new Promise((resolve) => {
    idle(async () => {
      await inlineBackgroundImages(element, clone, styleCache);
      resolve();
    }, { fast });
  });
  if (embedFonts) {
    await new Promise((resolve) => {
      idle(async () => {
        fontsCSS = await embedCustomFonts({ ignoreIconFonts: true });
        resolve();
      }, { fast });
    });
  }
  if (compress) {
    const usedTags = collectUsedTagNames(clone).sort();
    const tagKey = usedTags.join(",");
    if (baseCSSCache.has(tagKey)) {
      baseCSS = baseCSSCache.get(tagKey);
    } else {
      await new Promise((resolve) => {
        idle(() => {
          baseCSS = generateDedupedBaseCSS(usedTags);
          baseCSSCache.set(tagKey, baseCSS);
          resolve();
        }, { fast });
      });
    }
  }
  await new Promise((resolve) => {
    idle(() => {
      const rect = element.getBoundingClientRect();
      // para capurar drop shadow en raster hay que aumentar el tmano aca
      const w = Math.ceil(rect.width);
      const h = Math.ceil(rect.height);
       clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
       clone.style.transformOrigin = "top left";
       if (scale !== 1 && isSafari()) {
        clone.style.scale = `${scale}`;
      }
      const svgNS = "http://www.w3.org/2000/svg";
      const fo = document.createElementNS(svgNS, "foreignObject");
      fo.setAttribute("width", "100%");
      fo.setAttribute("height", "100%");
      const styleTag = document.createElement("style");
      styleTag.textContent = baseCSS + fontsCSS + "svg{overflow:visible;}" + classCSS;
      fo.appendChild(styleTag);
      fo.appendChild(clone);
      const serializer = new XMLSerializer();
      const foString = serializer.serializeToString(fo);
      const svgHeader = `<svg xmlns="${svgNS}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
      const svgFooter = "</svg>";
      svgString = svgHeader + foString + svgFooter;
      dataURL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
      resolve();
    }, { fast });
  });
  const sandbox = document.getElementById("snapdom-sandbox");
  if (sandbox && sandbox.style.position === "absolute") sandbox.remove();
  return dataURL;
}
