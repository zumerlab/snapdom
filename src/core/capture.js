import { prepareClone } from './prepare.js';
import { inlineImages } from '../modules/images.js';
import { inlineBackgroundImages } from '../modules/background.js';
import { idle } from '../utils/helpers.js';
import { collectUsedTagNames, generateDedupedBaseCSS } from '../utils/cssTools.js';
import { embedCustomFonts } from '../modules/fonts.js';
import { baseCSSCache } from '../core/cache.js'

/**
 * Captures an HTML element as an SVG data URL
 * @param {Element} element - DOM element to capture
 * @param {Object} [options={}] - Capture options
 * @returns {Promise<string>} Promise that resolves to SVG Blob
 */

export async function captureDOM(element, options = {}) {
  if (!element) throw new Error('Element cannot be null or undefined');

  const { compress = true, embedFonts = false, fast = true, scale = 1 } = options;
  let clone, classCSS, styleCache;
  let fontsCSS = '';
  let baseCSS = '';
  let dataURL;
  let svgString;

  // 1. Clonación + pseudo
  ({ clone, classCSS, styleCache } = await prepareClone(element, compress));

  // 2. Inline images (una sola vez)
  await new Promise(resolve => {
    idle(async () => {
      await inlineImages(clone);
      resolve();
    }, { fast });
  });

  // 3. Inline background images (una sola vez)
  await new Promise(resolve => {
    idle(async () => {
      await inlineBackgroundImages(element, clone, styleCache);
      resolve();
    }, { fast });
  });

  // 4. Embed fonts si aplica
  if (embedFonts) {
    await new Promise(resolve => {
      idle(async () => {
        fontsCSS = await embedCustomFonts({ ignoreIconFonts: true });
        resolve();
      }, { fast });
    });
  }

  // 5. Generar baseCSS para compresión si aplica, con caché de tags
  if (compress) {
    const usedTags = collectUsedTagNames(clone).sort();
    const tagKey = usedTags.join(',');
    if (baseCSSCache.has(tagKey)) {
      baseCSS = baseCSSCache.get(tagKey);
    } else {
      await new Promise(resolve => {
        idle(() => {
          baseCSS = generateDedupedBaseCSS(usedTags);
          baseCSSCache.set(tagKey, baseCSS);
          resolve();
        }, { fast });
      });
    }
  }

  // 6. Montaje del SVG final con serialización de sólo <foreignObject>
  await new Promise(resolve => {
    idle(() => {
      const rect = element.getBoundingClientRect();
      const w = rect.width * scale;
      const h = rect.height * scale;

      // Ajuste de escala si aplica
      if (scale !== 1) {
        clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        clone.style.transform = `scale(${scale})`;
        clone.style.transformOrigin = 'top left';
        clone.style.width = `${rect.width}px`;
        clone.style.height = `${rect.height}px`;
      }

      // Preparar svg y foreignObject
      const svgNS = 'http://www.w3.org/2000/svg';
      const fo = document.createElementNS(svgNS, 'foreignObject');
      fo.setAttribute('width', '100%');
      fo.setAttribute('height', '100%');

      const styleTag = document.createElement('style');
      styleTag.textContent = baseCSS + fontsCSS + 'svg{overflow:visible;}' + classCSS;
      fo.appendChild(styleTag);
      fo.appendChild(clone);

      // Serializar sólo el foreignObject
      const serializer = new XMLSerializer();
      const foString = serializer.serializeToString(fo);
      const svgHeader = `<svg xmlns="${svgNS}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
      const svgFooter = '</svg>';
      svgString = svgHeader + foString + svgFooter;
      
      dataURL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
      
      resolve();
    }, { fast });
  });

  // 7. Limpieza del sandbox si existe
  const sandbox = document.getElementById('snapdom-sandbox');
  if (sandbox && sandbox.style.position === 'absolute') sandbox.remove();

  return dataURL;
}