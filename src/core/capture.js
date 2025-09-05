/**
 * Core logic for capturing DOM elements as SVG data URLs.
 * @module capture
 */

import { prepareClone } from './prepare.js';
import { inlineImages } from '../modules/images.js';
import { inlineBackgroundImages } from '../modules/background.js';
import { idle,collectUsedTagNames, generateDedupedBaseCSS, isSafari } from '../utils/index.js';
import { embedCustomFonts, collectUsedFontVariants, collectUsedCodepoints, ensureFontsReady } from '../modules/fonts.js';
import { cache, applyCachePolicy } from '../core/cache.js'

/**
 * Captures an HTML element as an SVG data URL, inlining styles, images, backgrounds, and optionally fonts.
 *
 * @param {Element} element - DOM element to capture
 * @param {Object} [options={}] - Capture options
 * @param {boolean} [options.embedFonts=false] - Whether to embed custom fonts
 * @param {boolean} [options.fast=true] - Whether to skip idle delay for faster results
 * @param {number} [options.scale=1] - Output scale multiplier
 * @param {string[]} [options.exclude] - CSS selectors for elements to exclude
 * @param {Function} [options.filter] - Custom filter function 
 * @returns {Promise<string>} Promise that resolves to an SVG data URL
 */

// src/core/capture.js
export async function captureDOM(element, options) {
  if (!element) throw new Error("Element cannot be null or undefined");
  applyCachePolicy(options.cache);
  const fast = options.fast;
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
        const required = collectUsedFontVariants(element);
        const usedCodepoints = collectUsedCodepoints(element);
        if (isSafari) {
          const families = new Set(
            Array.from(required).map((k) => String(k).split("__")[0]).filter(Boolean)
          );
          await ensureFontsReady(families, 2);
        }
        fontsCSS = await embedCustomFonts({
          required,
          usedCodepoints,
          preCached: false,
          exclude: options.excludeFonts,
          useProxy: options.useProxy,
        });
        resolve();
      }, { fast });
    });
  }

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

  await new Promise((resolve) => {
    idle(() => {
      // 1) tamaño base del elemento original
      const rect = getNaturalBorderBoxSize(element);
      let w = rect.width;
      let h = rect.height;

      // 2) ajuste por width/height opcionales SIN tocar la matriz del elemento
      const hasW = Number.isFinite(options.width);
      const hasH = Number.isFinite(options.height);
      const scaleOpt = options.scale ?? 1;
      const hasScale = typeof scaleOpt === "number" && scaleOpt !== 1;

      if (!hasScale) {
        const aspect = rect.width / rect.height;
        if (hasW && hasH) { w = options.width; h = options.height; }
        else if (hasW)    { w = options.width; h = w / aspect; }
        else if (hasH)    { h = options.height; w = h * aspect; }
      }
      w = Math.max(1, Math.ceil(w));
      h = Math.max(1, Math.ceil(h));

      // 3) crear un 'measure' para pedirle al motor la matriz total exacta
      const csEl = getComputedStyle(element);
      const baseTransform = csEl.transform && csEl.transform !== "none" ? csEl.transform : "";
      const ind = readIndividualTransforms(element);

      const measure = document.createElement("div");
      measure.style.position = "fixed";
      measure.style.left = "0";
      measure.style.top = "0";
      measure.style.visibility = "hidden";
      measure.style.pointerEvents = "none";
      measure.style.transformOrigin = "0 0"; // simplifico el análisis del bbox

      // seteo transform "clásico" e individuales (el motor compone en el orden correcto)
      if (baseTransform) measure.style.transform = baseTransform;
      if (ind.rotate)    measure.style.rotate = ind.rotate;
      if (ind.scale)     measure.style.scale = ind.scale;
      if (ind.translate) measure.style.translate = ind.translate;

      document.documentElement.appendChild(measure);
      const TOTAL = matrixFromComputed(measure);
      document.documentElement.removeChild(measure);

      // 4) bbox proyectado (sin traslación) sobre el tamaño w,h
      const M2D = TOTAL.is2D ? matrix2DNoTranslate(TOTAL) : matrix2DNoTranslate(new DOMMatrix(TOTAL.toString()));
      const bb = bboxFromMatrix(w, h, M2D);
      const outW = Math.max(1, Math.ceil(bb.width));
      const outH = Math.max(1, Math.ceil(bb.height));
      const tx = -bb.minX;
      const ty = -bb.minY;

      // 5) construir SVG + foreignObject
      const svgNS = "http://www.w3.org/2000/svg";
      const fo = document.createElementNS(svgNS, "foreignObject");
      fo.setAttribute("width", "100%");
      fo.setAttribute("height", "100%");
      fo.setAttribute("x", String(tx));
      fo.setAttribute("y", String(ty));
      fo.style.overflow = "visible";

      // estilos base (tu pipeline)
      const styleTag = document.createElement("style");
      styleTag.textContent =
        baseCSS +
        fontsCSS +
        "svg{overflow:visible;} foreignObject{overflow:visible;}" +
        classCSS;
      fo.appendChild(styleTag);

      // 6) contenedor para el re-escalado por width/height (si aplica)
      const container = document.createElement("div");
      container.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      container.style.width = `${w}px`;
      container.style.height = `${h}px`;
      container.style.overflow = "visible";
      container.style.transformOrigin = "0 0";

      if (!hasScale && (hasW || hasH)) {
        // escalo solo por petición de output w/h
        const sxWH = rect.width ? (w / rect.width) : 1;
        const syWH = rect.height ? (h / rect.height) : 1;
        container.style.transform = `scale(${sxWH}, ${syWH})`;
      } else if (hasScale) {
        container.style.transform = `scale(${scaleOpt})`;
      }

      // 7) aplicar al clone EXACTAMENTE lo que tenía el elemento
      clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      clone.style.transformOrigin = "0 0";
      // no tocar posición/offset absolutos del original dentro del FO
      clone.style.position = "static";
      clone.style.left = "0";
      clone.style.top = "0";
      // transform clásico + individuales
      if (baseTransform) clone.style.transform = baseTransform;
      // asigno individuales (no concateno strings)
      clone.style.rotate    = ind.rotate || "0deg";
      if (ind.scale)     clone.style.scale = ind.scale;
      else               clone.style.scale = "1";
      if (ind.translate) clone.style.translate = ind.translate;
      else               clone.style.translate = "0 0";

      container.appendChild(clone);
      fo.appendChild(container);

      // 8) serialización SVG
      const serializer = new XMLSerializer();
      const foString = serializer.serializeToString(fo);
      const svgHeader = `<svg xmlns="${svgNS}" width="${outW}" height="${outH}" viewBox="0 0 ${outW} ${outH}">`;
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

      // helpers -----------------------------------------------------------------------
      function getNaturalBorderBoxSize(el) {
        const cs = getComputedStyle(el);
        const px = (v) => parseFloat(v) || 0;
        let w = px(cs.width);
        let h = px(cs.height);
        if (cs.boxSizing === "content-box") {
          w += px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth);
          h += px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth);
        }
        return { width: w, height: h };
      }

      function matrixFromComputed(el) {
        const tr = getComputedStyle(el).transform;
        if (!tr || tr === "none") return new DOMMatrix(); // identidad
        try { return new DOMMatrix(tr); }
        catch { return new WebKitCSSMatrix(tr); } // fallback WebKit
      }

      function matrix2DNoTranslate(M) {
        // devuelvo solo a,b,c,d y cero e,f para bbox
        return new DOMMatrix([M.a, M.b, M.c, M.d, 0, 0]);
      }

      function bboxFromMatrix(w, h, M2D) {
        const pts = [
          { x: 0, y: 0 },
          { x: w, y: 0 },
          { x: 0, y: h },
          { x: w, y: h },
        ];
        const t = pts.map(p => ({
          x: M2D.a * p.x + M2D.c * p.y,
          y: M2D.b * p.x + M2D.d * p.y,
        }));
        const minX = Math.min(...t.map(p => p.x));
        const maxX = Math.max(...t.map(p => p.x));
        const minY = Math.min(...t.map(p => p.y));
        const maxY = Math.max(...t.map(p => p.y));
        return { minX, minY, width: maxX - minX, height: maxY - minY };
      }

      // lectura de typed OM (cuando existe)
      function readIndividualTransforms(el) {
        const out = { rotate: "0deg", scale: null, translate: null };
        const map = el.computedStyleMap?.();
        if (map) {
          const rot = map.get("rotate");
          if (rot) {
            const ang = rot.angle ?? rot;
            if (ang && "unit" in ang) {
              out.rotate = ang.unit === "rad" ? (ang.value * 180 / Math.PI) + "deg" : ang.value + ang.unit;
            } else {
              out.rotate = String(rot);
            }
          }
          const sc = map.get("scale");
          if (sc && sc.length) {
            const sx = sc[0]?.value ?? 1;
            const sy = sc[1]?.value ?? sx;
            out.scale = `${sx} ${sy}`;
          }
          const tr = map.get("translate");
          if (tr && tr.length) {
            const tx = tr[0]?.value ?? 0;
            const ty = tr[1]?.value ?? 0;
            const ux = tr[0]?.unit ?? "px";
            const uy = tr[1]?.unit ?? "px";
            out.translate = `${tx}${ux} ${ty}${uy}`;
          }
          return out;
        }
        // fallbacks por si no hay Typed OM
        const cs = getComputedStyle(el);
        out.rotate = cs.rotate && cs.rotate !== "none" ? cs.rotate : "0deg";
        out.scale = cs.scale && cs.scale !== "none" ? cs.scale : null;
        out.translate = cs.translate && cs.translate !== "none" ? cs.translate : null;
        return out;
      }