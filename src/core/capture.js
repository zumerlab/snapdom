/**
 * Core logic for capturing DOM elements as SVG data URLs.
 * @module capture
 */

import { prepareClone } from './prepare.js';
import { inlineImages } from '../modules/images.js';
import { inlineBackgroundImages } from '../modules/background.js';
import { idle,collectUsedTagNames, generateDedupedBaseCSS, isSafari } from '../utils/index.js';
import { embedCustomFonts, collectUsedFontVariants, collectUsedCodepoints, ensureFontsReady } from '../modules/fonts.js';
import { cache } from '../core/cache.js'

/**
 * Captures an HTML element as an SVG data URL, inlining styles, images, backgrounds, and optionally fonts.
 *
 * @param {Element} element - DOM element to capture
 * @param {Object} [options={}] - Capture options
 * @param {boolean} [options.compress=true] - Whether to compress style keys
 * @param {boolean} [options.embedFonts=false] - Whether to embed custom fonts
 * @param {boolean} [options.fast=true] - Whether to skip idle delay for faster results
 * @param {number} [options.scale=1] - Output scale multiplier
 * @param {string[]} [options.exclude] - CSS selectors for elements to exclude
 * @param {Function} [options.filter] - Custom filter function 
 * @returns {Promise<string>} Promise that resolves to an SVG data URL
 */

export async function captureDOM(element, options) {
  if (!element) throw new Error("Element cannot be null or undefined");
   cache.reset()
   const fast = options.fast
  let clone, classCSS, styleCache;
  let fontsCSS = "";
  let baseCSS = "";
  let dataURL;
  let svgString;

  ({ clone, classCSS, styleCache } = await prepareClone(element, options));

  await new Promise((resolve) => {
    idle(async () => {
      await inlineImages(clone, options);
      resolve();
    }, { fast });
  });
  await new Promise((resolve) => {
    idle(async () => {
      await inlineBackgroundImages(element, clone, styleCache, options);
      resolve();
    }, { fast });
  });
  if (options.embedFonts) {
    await new Promise((resolve) => {
      idle(async () => {
        // en tu captureDOM (o prepareClone) antes de llamar embedCustomFonts:
const required = collectUsedFontVariants(element);
const usedCodepoints = collectUsedCodepoints(element);
// ...
if (isSafari) {
const families = new Set(
        Array.from(required)
          .map(k => String(k).split('__')[0])
          .filter(Boolean)
      );
      await ensureFontsReady(families, 2);
    }
 fontsCSS = await embedCustomFonts({ required, usedCodepoints, preCached: false,  exclude: options.fontExclude, useProxy: options.useProxy });

// luego concat: baseCSS + fontsCSS + ...

      //  fontsCSS = await embedCustomFonts(options);
        resolve();
      }, { fast });
    });
  }
  if (options.compress) {
    const usedTags = collectUsedTagNames(clone).sort();
    const tagKey = usedTags.join(",");
    if (cache.baseStyle.has(tagKey)) {
      baseCSS = cache.baseStyle.get(tagKey);
    } else {
      await new Promise((resolve) => {
        idle(() => {
          baseCSS = generateDedupedBaseCSS(usedTags);
          cache.baseStyle.set(tagKey, baseCSS);
          resolve();
        }, { fast });
      });
    }
  }
  await new Promise((resolve) => {
    idle(() => {
      const rect = element.getBoundingClientRect();
      let w = rect.width;
      let h = rect.height;
      const hasW = Number.isFinite(options.width);
      const hasH = Number.isFinite(options.height);
      const hasScale = typeof scale === "number" && scale !== 1;
      if (!hasScale) {
        const aspect = rect.width / rect.height;
        if (hasW && hasH) {
          w = options.width;
          h = options.height;
        } else if (hasW) {
          w = options.width;
          h = w / aspect;
        } else if (hasH) {
          h = options.height;
          w = h * aspect;
        }
      }
      w = Math.ceil(w);
      h = Math.ceil(h);
      clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      clone.style.transformOrigin = "top left";
      if (!hasScale && (hasW || hasH)) {
        const originalW = rect.width;
        const originalH = rect.height;
        const scaleX = w / originalW;
        const scaleY = h / originalH;
        const existingTransform = clone.style.transform || "";
        const scaleTransform = `scale(${scaleX}, ${scaleY})`;
        clone.style.transform = `${scaleTransform} ${existingTransform}`.trim();
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

