/**
 * Utilities for handling and embedding web fonts and icon fonts.
 * @module fonts
 */

import { extractURL, fetchResource } from "../utils/helpers"
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

  // Asegurar que la fuente esté cargada (para evitar medidas incorrectas)
  await document.fonts.ready;

  // Crear span oculto para medir tamaño real
  const span = document.createElement("span");
  span.textContent = unicodeChar;
  span.style.position = "absolute";
  span.style.visibility = "hidden";
  span.style.fontFamily = `"${fontFamily}"`;
  span.style.fontWeight = fontWeight || "normal";
  span.style.fontSize = `${fontSize}px`;
  span.style.lineHeight = "1";
  span.style.whiteSpace = "nowrap";
  span.style.padding = "0";
  span.style.margin = "0";
  document.body.appendChild(span);

  const rect = span.getBoundingClientRect();
  const width = Math.ceil(rect.width);
  const height = Math.ceil(rect.height);
  document.body.removeChild(span);

  // Crear canvas del tamaño medido
  const canvas = document.createElement("canvas");
  canvas.width = width * dpr;
  canvas.height = height * dpr;

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.font = fontWeight ? `${fontWeight} ${fontSize}px "${fontFamily}"` : `${fontSize}px "${fontFamily}"`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top"; // Alineado exacto con getBoundingClientRect
  ctx.fillStyle = color;
  ctx.fillText(unicodeChar, 0, 0);

  return {
    dataUrl: canvas.toDataURL(),
    width,
    height
  };
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
 * @param {Object} [options.localFonts=[]] - Additional local fonts to embed
 * @param {string} [options.useProxy=''] - Optional proxy for font fetching
 * @returns {Promise<string>} The inlined CSS for custom fonts
 */
export async function embedCustomFonts({ preCached = false, localFonts = [], useProxy = '' } = {}) {
  if (cache.resource.has("fonts-embed-css")) {
    if (preCached) {
      const style = document.createElement("style");
      style.setAttribute("data-snapdom", "embedFonts");
      style.textContent = cache.resource.get("fonts-embed-css");
      document.head.appendChild(style);
    }
    return cache.resource.get("fonts-embed-css");
  }

  const loadedFonts = new Set();
  try {
    for (const f of document.fonts) {
      if (f.status === "loaded") {
        loadedFonts.add(`${f.family}__${f.weight || "normal"}__${f.style || "normal"}`);
      }
    }
  } catch {}

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
      const res = await fetchResource(link.href, { useProxy });
      const cssText = await res.text();

      if ((isIconFont(link.href) || isIconFont(cssText))) continue;

      const faceRegex = /@font-face[^{}]*{[^}]*}/g;
      let cssFinal = cssText;
      for (const face of cssText.match(faceRegex) || []) {
        const famMatch = face.match(/font-family:\s*([^;]+);/i);
        if (!famMatch) continue;
        const family = famMatch[1].replace(/['"]/g, '').trim();
        const weightMatch = face.match(/font-weight:\s*([^;]+);/i);
        const styleMatch = face.match(/font-style:\s*([^;]+);/i);
        const weight = weightMatch ? weightMatch[1].trim() : 'normal';
        const style = styleMatch ? styleMatch[1].trim() : 'normal';
        const key = `${family}__${weight}__${style}`;
        const urlRegex = /url\((["']?)([^"')]+)\1\)/g;
        const hasURL = /url\(/i.test(face);
        const hasLocal = /local\(/i.test(face);

        if (!hasURL && hasLocal) {
          continue;
        }
        if (!loadedFonts.has(key)) {
          cssFinal = cssFinal.replace(face, '');
          continue;
        }

        let inlined = face;
        const matches = Array.from(face.matchAll(urlRegex));
        for (const match of matches) {
          let rawUrl = extractURL(match[0]);
          if (!rawUrl) continue;
          let url = rawUrl;
          if (!url.startsWith('http') && !url.startsWith('data:')) {
            url = new URL(url, link.href).href;
          }
          if (isIconFont(url)) continue;
          if (cache.resource.has(url)) {
            cache.font.add(url);
            inlined = inlined.replace(match[0], `url(${cache.resource.get(url)})`);
            continue;
          }
          if (cache.font.has(url)) continue;
          try {
            const fontRes = await fetchResource(url, { useProxy });
            const blob = await fontRes.blob();
            const b64 = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
            cache.resource.set(url, b64);
            cache.font.add(url);
            inlined = inlined.replace(match[0], `url(${b64})`);
          } catch (e) {
            console.warn('[snapdom] Failed to fetch font resource:', url);
          }
        }
        cssFinal = cssFinal.replace(face, inlined);
      }
      finalCSS += cssFinal + "\n";
    } catch (e) {
      console.warn("[snapdom] Failed to fetch CSS:", link.href);
    }
  }

  for (const sheet of document.styleSheets) {
    try {
      if (!sheet.href || links.every((link) => link.href !== sheet.href)) {
        for (const rule of sheet.cssRules) {
          if (rule.type === CSSRule.FONT_FACE_RULE) {
            const src = rule.style.getPropertyValue("src");
            const family = rule.style.getPropertyValue("font-family");
            if (!src || isIconFont(family)) continue;

            const weightVal = rule.style.getPropertyValue("font-weight") || "normal";
            const styleVal = rule.style.getPropertyValue("font-style") || "normal";
            const key = `${family}__${weightVal}__${styleVal}`;

            const urlRegex = /url\((["']?)([^"')]+)\1\)/g;
            const localRegex = /local\((["']?)[^)]+?\1\)/g;
            const hasURL = !!src.match(urlRegex);
            const hasLocal = !!src.match(localRegex);

            if (!hasURL && hasLocal) {
              finalCSS += `@font-face{font-family:${family};src:${src};font-style:${styleVal};font-weight:${weightVal};}`;
              continue;
            }

            if (!loadedFonts.has(key)) continue;

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
                const res = await fetchResource(url, { useProxy });
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

            finalCSS += `@font-face{font-family:${family};src:${inlinedSrc};font-style:${styleVal};font-weight:${weightVal};}`;
          }
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
            const res = await fetchResource(font._snapdomSrc, { useProxy });
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

      finalCSS += `@font-face{font-family:'${font.family}';src:url(${b64});font-style:${font.style || "normal"};font-weight:${font.weight || "normal"};}`;
    }
  }

  for (const font of localFonts) {
    if (!font || typeof font !== 'object') continue;
    const { family, src, weight = 'normal', style = 'normal' } = font;
    if (!family || !src) continue;

    let b64 = src;
    if (!b64.startsWith('data:')) {
      try {
        const res = await fetchResource(src, { useProxy });
        const blob = await res.blob();
        b64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
        cache.resource.set(src, b64);
        cache.font.add(src);
      } catch (e) {
        console.warn('[snapdom] Failed to load local font:', src);
        continue;
      }
    } else {
      cache.resource.set(src, b64);
      cache.font.add(src);
    }
    finalCSS += `@font-face{font-family:'${family}';src:url(${b64});font-style:${style};font-weight:${weight};}`;
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
