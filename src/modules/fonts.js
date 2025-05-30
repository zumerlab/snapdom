/**
 * Utilities for handling and embedding web fonts and icon fonts.
 * @module fonts
 */

import { isIconFont } from "../utils/helpers"
import { resourceCache } from "../core/cache"

/**
 * Converts a unicode character from an icon font into a data URL image.
 *
 * @export
 * @param {string} unicodeChar - The unicode character to render
 * @param {string} fontFamily - The font family name
 * @param {string|number} fontWeight - The font weight
 * @param {number} [fontSize=32] - The font size in pixels
 * @param {string} [color="#000"] - The color to use
 * @returns {Promise<string>} Data URL of the rendered icon
 */

export async function iconToImage(unicodeChar, fontFamily, fontWeight, fontSize = 32, color = "#000") {
  fontFamily = fontFamily.replace(/^['"]+|['"]+$/g, "");
  const dpr = window.devicePixelRatio || 1;

  // Create temporary context to measure
  const tempCanvas = document.createElement("canvas");
  const tempCtx = tempCanvas.getContext("2d");
  tempCtx.font = fontWeight
    ? `${fontWeight} ${fontSize}px "${fontFamily}"`
    : `${fontSize}px "${fontFamily}"`;

  const metrics = tempCtx.measureText(unicodeChar);
  const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.8;
  const descent = metrics.actualBoundingBoxDescent || fontSize * 0.2;
  const height = ascent + descent;
  const width = metrics.width;

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * dpr);
  canvas.height = Math.ceil(height * dpr);

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.font = tempCtx.font;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic"; // aligns with baseline
  ctx.fillStyle = color;

  // Draw at (0, ascent) so the full glyph fits vertically
  ctx.fillText(unicodeChar, 0, ascent);

  return canvas.toDataURL();
}

/**
 * Embeds custom fonts found in the document as data URLs in CSS.
 *
 * @export
 * @param {Object} options
 * @param {boolean} [options.ignoreIconFonts=true] - Whether to skip icon fonts
 * @param {boolean} [options.preCached=false] - Whether to use pre-cached resources
 * @returns {Promise<string>} The inlined CSS for custom fonts
 */
export async function embedCustomFonts({ ignoreIconFonts = true, preCached = false }) {
  const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).filter(link => link.href);
  let finalCSS = '';

  for (const link of links) {
    try {
      const res = await fetch(link.href);
      const cssText = await res.text();

      // ⏭️ Skip icon font CSS if instructed
      if (ignoreIconFonts && (isIconFont(link.href) || isIconFont(cssText))) {
        // console.log('⏭️ Skipping icon font CSS:', link.href);
        continue;
      }

      const urlRegex = /url\(([^)]+)\)/g;
      const inlinedCSS = await Promise.all(
        Array.from(cssText.matchAll(urlRegex)).map(async match => {
          let url = match[1].replace(/["']/g, '');
          if (!url.startsWith('http')) {
            url = new URL(url, link.href).href;
          }

          // ⏭️ Skip icon font URL if instructed
          if (ignoreIconFonts && isIconFont(url)) {
            // console.log('⏭️ Skipping icon font URL:', url);
            return null;
          }

          if (resourceCache.has(url)) {
            return { original: match[0], inlined: `url(${resourceCache.get(url)})` };
          }

          try {
            const fontRes = await fetch(url);
            const blob = await fontRes.blob();
            const b64 = await new Promise(resolve => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
            resourceCache.set(url, b64);
            return { original: match[0], inlined: `url(${b64})` };
          } catch (err) {
            console.warn('❌ Failed to fetch font:', url);
            return null;
          }
        })
      );

      let cssFinal = cssText;
      for (const r of inlinedCSS) {
        if (r) {
          cssFinal = cssFinal.replace(r.original, r.inlined);
        }
      }

      finalCSS += cssFinal + '\n';
    } catch (e) {
      console.warn('❌ Failed to fetch CSS:', link.href);
    }
  }

  // 🧠 Optionally inject pre-cached fonts into the document
  if (finalCSS && preCached) {
    const style = document.createElement('style');
    style.setAttribute('data-snapdom', 'embedFonts');
    style.textContent = finalCSS;
    document.head.appendChild(style);
  }

  return finalCSS;
}
