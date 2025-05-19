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
  await document.fonts.ready;
  await document.fonts.load(`${fontSize}px "${fontFamily}"`);
  const canvas = document.createElement("canvas");
  canvas.width = fontSize;
  canvas.height = fontSize;
  const ctx = canvas.getContext("2d");
  ctx.font = fontWeight ? `${fontWeight} ${fontSize}px "${fontFamily}"` : ` ${fontSize}px "${fontFamily}"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(unicodeChar, canvas.width / 2, canvas.height / 2);
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

      if (ignoreIconFonts && (isIconFont(link.href) || isIconFont(cssText))) {
        console.log('⏭️ Ignorando icon font CSS:', link.href);
        continue;
      }

      const urlRegex = /url\(([^)]+)\)/g;
      const inlinedCSS = await Promise.all(
        Array.from(cssText.matchAll(urlRegex)).map(async match => {
          let url = match[1].replace(/["']/g, '');
          if (!url.startsWith('http')) {
            url = new URL(url, link.href).href;
          }

          if (ignoreIconFonts && isIconFont(url)) {
            console.log('⏭️ Ignorando icon font URL:', url);
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
            console.warn('❌ No pude fetch font', url);
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
      console.warn('❌ No pude fetch CSS', link.href);
    }
  }

  if (finalCSS && preCached) {
    const style = document.createElement('style');
    style.setAttribute('data-snapdom', 'embedFonts');
    style.textContent = finalCSS;
    document.head.appendChild(style);
  }

  return finalCSS;
}
