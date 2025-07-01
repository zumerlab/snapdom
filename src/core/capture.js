/**
 * Core logic for capturing DOM elements as SVG data URLs.
 * Orquesta el flujo de preparación, inlining y renderizado.
 * @module capture
 */

import { prepareClone } from './prepare.js';
import { inlineImages } from '../modules/images.js';
import { inlineBackgroundImages } from '../modules/background.js';
import { idle } from '../utils/helpers.js';
import { collectUsedTagNames, generateDedupedBaseCSS } from '../utils/cssTools.js';
import { embedCustomFonts } from '../modules/fonts.js';
import { baseCSSCache } from '../core/cache.js';
import { renderClone } from './render.js';

/**
 * @typedef {Object} CaptureOptions
 * @property {boolean} [compress=true] - Si se debe comprimir el CSS
 * @property {boolean} [embedFonts=false] - Si se deben inlinar fuentes
 * @property {boolean} [fast=true] - Si se debe usar modo rápido (idle)
 * @property {number} [scale=1] - Escala de salida
 * @property {number} [width] - Ancho forzado
 * @property {number} [height] - Alto forzado
 */

/**
 * Captura un elemento HTML como dataURL SVG, inlinando estilos, imágenes, backgrounds y fuentes.
 * Orquesta el flujo de preparación, inlining y renderizado.
 *
 * @param {Element} element - Elemento DOM a capturar
 * @param {CaptureOptions} [options={}] - Opciones de captura
 * @returns {Promise<string>} DataURL SVG serializado
 */

export async function captureDOM(element, options = {}) {
  if (!element) throw new Error("Element cannot be null or undefined");
  if (!(element instanceof Element)) throw new Error("captureDOM: Only Element nodes are supported");

  const { compress = true, embedFonts = false, fast = true, scale = 1 } = options;
  let clone, classCSS, styleCache;
  let fontsCSS = "";
  let baseCSS = "";

  ({ clone, classCSS, styleCache } = await prepareClone(element, compress, embedFonts));

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

  if (embedFonts) {
    await new Promise((resolve) => {
      idle(async () => {
        fontsCSS = await embedCustomFonts({ ignoreIconFonts: !embedFonts });
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

  // --- Renderizado extraído ---
  const { dataURL } = renderClone(clone, element, {
    baseCSS,
    fontsCSS,
    classCSS,
    scale,
    width: options.width,
    height: options.height,
    fast,
    options
  });
  // --- Fin renderizado extraído ---

  const sandbox = document.getElementById("snapdom-sandbox");
  if (sandbox && sandbox.style.position === "absolute") sandbox.remove();

  return dataURL;
}
