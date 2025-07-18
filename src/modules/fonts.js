/**
 * Utilities for handling and embedding web fonts and icon fonts.
 * @module fonts
 */

import { extractURL} from "../utils/helpers"
import { cache } from "../core/cache"
import { isIconFont } from '../modules/iconFonts.js';

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


function isStylesheetLoaded(href) {
  return Array.from(document.styleSheets).some(sheet => sheet.href === href);
}

function injectLinkIfMissing(href) {
  return new Promise((resolve) => {
    if (isStylesheetLoaded(href)) return resolve(null);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute("data-snapdom", "injected-import");
    link.onload = () => resolve(link);
    link.onerror = () => resolve(null);
    document.head.appendChild(link);
  });
}

/**
 * Embeds custom fonts found in the document as data URLs in CSS.
 *
 * @export
 * @param {Object} options
 * @param {boolean} [options.preCached=false] - Whether to use pre-cached resources
 * @returns {Promise<string>} The inlined CSS for custom fonts
 */



export async function embedCustomFonts({preCached = false } = {}) {

  if (cache.resource.has("fonts-embed-css")) {
    if (preCached) {
      const style = document.createElement("style");
      style.setAttribute("data-snapdom", "embedFonts");
      style.textContent = cache.resource.get("fonts-embed-css");
      document.head.appendChild(style);
    }
    return cache.resource.get("fonts-embed-css");
  }

  const importRegex = /@import\s+url\(["']?([^"')]+)["']?\)/g;
  const styleImports = [];

  for (const styleTag of document.querySelectorAll("style")) {
    const cssText = styleTag.textContent || "";
    const matches = Array.from(cssText.matchAll(importRegex));
    for (const match of matches) {
      const importUrl = match[1];
      if (isIconFont(importUrl)) continue;
      if (!isStylesheetLoaded(importUrl)) {
        styleImports.push(importUrl);
      }
    }
  }

  await Promise.all(styleImports.map(injectLinkIfMissing));

  const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).filter((link) => link.href);
  let finalCSS = "";

  for (const link of links) {
    try {
      const res = await fetch(link.href);
      const cssText = await res.text();

      if ((isIconFont(link.href) || isIconFont(cssText))) continue;

      const urlRegex = /url\((["']?)([^"')]+)\1\)/g;
      const inlinedCSS = await Promise.all(
        Array.from(cssText.matchAll(urlRegex)).map(async (match) => {
          let rawUrl = extractURL(match[0]);
          if (!rawUrl) return null;
          let url = rawUrl;
          if (!url.startsWith("http") && !url.startsWith("data:")) {
            url = new URL(url, link.href).href;
          }
          if (isIconFont(url)) return null;
          if (cache.resource.has(url)) {
            cache.font.add(url);
            return { original: match[0], inlined: `url(${cache.resource.get(url)})` };
          }
          if (cache.font.has(url)) return null;
          try {
            const fontRes = await fetch(url);
            const blob = await fontRes.blob();
            const b64 = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
            cache.resource.set(url, b64);
            cache.font.add(url);
            return { original: match[0], inlined: `url(${b64})` };
          } catch (e) {
            console.warn("[snapdom] Failed to fetch font resource:", url);
            return null;
          }
        })
      );

      let cssFinal = cssText;
      for (const r of inlinedCSS) {
        if (r) cssFinal = cssFinal.replace(r.original, r.inlined);
      }
      finalCSS += cssFinal + "\n";
    } catch (e) {
      console.warn("[snapdom] Failed to fetch CSS:", link.href);
    }
  }

  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.type === CSSRule.FONT_FACE_RULE) {
          const src = rule.style.getPropertyValue("src");
          const family = rule.style.getPropertyValue("font-family");
          if (!src || (isIconFont(family))) continue;

          const urlRegex = /url\((["']?)([^"')]+)\1\)/g;
          let inlinedSrc = src;
          const matches = Array.from(src.matchAll(urlRegex));
          for (const match of matches) {
            let rawUrl = match[2].trim();
            if (!rawUrl) continue;
            let url = rawUrl;
            if (!url.startsWith("http") && !url.startsWith("data:")) {
              url = new URL(url, sheet.href || location.href).href;
            }
            if (isIconFont(url)) continue;
            if (cache.resource.has(url)) {
              cache.font.add(url);
              inlinedSrc = inlinedSrc.replace(match[0], `url(${cache.resource.get(url)})`);
              continue;
            }
            if (cache.font.has(url)) continue;
            try {
              const res = await fetch(url);
              const blob = await res.blob();
              const b64 = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(blob);
              });
              cache.resource.set(url, b64);
              cache.font.add(url);
              inlinedSrc = inlinedSrc.replace(match[0], `url(${b64})`);
            } catch (e) {
              console.warn("[snapdom] Failed to fetch font URL:", url);
            }
          }

          finalCSS += `@font-face {
font-family: ${family};
src: ${inlinedSrc};
font-style: ${rule.style.getPropertyValue("font-style") || "normal"};
font-weight: ${rule.style.getPropertyValue("font-weight") || "normal"};
}
`;
        }
      }
    } catch (e) {
      console.warn("[snapdom] Cannot access stylesheet", sheet.href, e);
    }
  }

  for (const font of document.fonts) {
    if (font.family && font.status === "loaded" && font._snapdomSrc) {
      if (isIconFont(font.family)) continue;
      let b64 = font._snapdomSrc;
      if (!b64.startsWith("data:")) {
        if (cache.resource.has(font._snapdomSrc)) {
          b64 = cache.resource.get(font._snapdomSrc);
          cache.font.add(font._snapdomSrc);
        } else if (!cache.font.has(font._snapdomSrc)) {
          try {
            const res = await fetch(font._snapdomSrc);
            const blob = await res.blob();
            b64 = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
            cache.resource.set(font._snapdomSrc, b64);
            cache.font.add(font._snapdomSrc);
          } catch (e) {
            console.warn("[snapdom] Failed to fetch dynamic font src:", font._snapdomSrc);
            continue;
          }
        }
      }

      finalCSS += `@font-face {
  font-family: '${font.family}';
  src: url(${b64});
  font-style: ${font.style || "normal"};
  font-weight: ${font.weight || "normal"};
}
`;
    }
  }

  if (finalCSS) {
    cache.resource.set("fonts-embed-css", finalCSS);
    if (preCached) {
      const style = document.createElement("style");
      style.setAttribute("data-snapdom", "embedFonts");
      style.textContent = finalCSS;
      document.head.appendChild(style);
    }
  }

  return finalCSS;
}
