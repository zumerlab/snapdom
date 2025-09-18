/**
 * Core logic for capturing DOM elements as SVG data URLs.
 * @module capture
 */

import { prepareClone } from './prepare.js';
import { inlineImages } from '../modules/images.js';
import { inlineBackgroundImages } from '../modules/background.js';
import { idle, collectUsedTagNames, generateDedupedBaseCSS, isSafari } from '../utils/index.js';
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
      const rect = getNaturalBorderBoxSize(element);
      let w = rect.width;
      let h = rect.height;

      const hasW = Number.isFinite(options.width);
      const hasH = Number.isFinite(options.height);
      const scaleOpt = options.scale ?? 1;
      const hasScale = typeof scaleOpt === "number" && scaleOpt !== 1;

      if (!hasScale) {
        const aspect = rect.width / rect.height;
        if (hasW && hasH) { w = options.width; h = options.height; }
        else if (hasW) { w = options.width; h = w / aspect; }
        else if (hasH) { h = options.height; w = h * aspect; }
      }
      w = Math.max(1, Math.ceil(w));
      h = Math.max(1, Math.ceil(h));

      const csEl = getComputedStyle(element);
      const baseTransform = csEl.transform && csEl.transform !== "none" ? csEl.transform : "";
      const ind = readIndividualTransforms(element);

      let outW, outH, tx, ty, cancelTranslateX = 0, cancelTranslateY = 0;

      if (!hasBBoxAffectingTransform(element)) {
        const r = element.getBoundingClientRect();
        const vp = inflateRect(r, { top: 0, right: 0, bottom: 0, left: 0 });
        outW = Math.max(1, vp.width);
        outH = Math.max(1, vp.height);
        tx = - (vp.x - Math.floor(r.left));
        ty = - (vp.y - Math.floor(r.top));
      } else {
        const TOTAL = readTotalTransformMatrix({
          baseTransform,
          rotate: ind.rotate || "0deg",
          scale: ind.scale,
          translate: ind.translate
        });

        const e = TOTAL.e ?? TOTAL.m41 ?? 0; // translateX
        const f = TOTAL.f ?? TOTAL.m42 ?? 0; // translateY
        cancelTranslateX = -e;
        cancelTranslateY = -f;
        /* v8 ignore next */
        const M2D = TOTAL.is2D ? matrix2DNoTranslate(TOTAL) : matrix2DNoTranslate(new DOMMatrix(TOTAL.toString()));
        const bb = bboxFromMatrix(w, h, M2D);

        outW = Math.max(1, Math.ceil(bb.width));
        outH = Math.max(1, Math.ceil(bb.height));
        tx = -bb.minX;
        ty = -bb.minY;
      }

      const svgNS = "http://www.w3.org/2000/svg";
      const fo = document.createElementNS(svgNS, "foreignObject");
      fo.setAttribute("width", "100%");
      fo.setAttribute("height", "100%");
      fo.setAttribute("x", String(tx));
      fo.setAttribute("y", String(ty));
      fo.style.overflow = "visible";

      const styleTag = document.createElement("style");
      styleTag.textContent =
        baseCSS +
        fontsCSS +
        "svg{overflow:visible;} foreignObject{overflow:visible;}" +
        classCSS;
      fo.appendChild(styleTag);

      const container = document.createElement("div");
      container.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      container.style.width = `${w}px`;
      container.style.height = `${h}px`;
      container.style.overflow = "visible";
      container.style.transformOrigin = "0 0";

      const cancels = [];
      if (cancelTranslateX || cancelTranslateY) {
        cancels.push(`translate(${cancelTranslateX}px, ${cancelTranslateY}px)`);
      }

      if (!hasScale && (hasW || hasH)) {
        const sxWH = rect.width ? (w / rect.width) : 1;
        const syWH = rect.height ? (h / rect.height) : 1;
        cancels.push(`scale(${sxWH}, ${syWH})`);
      } else if (hasScale) {
        cancels.push(`scale(${scaleOpt})`);
      }

      if (cancels.length) container.style.transform = cancels.join(" ");

      clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      clone.style.transformOrigin = "0 0";
      clone.style.position = "static";
      clone.style.left = "0";
      clone.style.top = "0";
      if (baseTransform) clone.style.transform = baseTransform;
      clone.style.rotate = ind.rotate || "0deg";
      clone.style.scale = ind.scale || "1";
      clone.style.translate = ind.translate || "0 0";

      container.appendChild(clone);
      fo.appendChild(container);

      const serializer = new XMLSerializer();
      const foString = serializer.serializeToString(fo);
      const finalW = (!hasScale && (hasW || hasH)) ? w : outW;
      const finalH = (!hasScale && (hasH || hasW)) ? h : outH;
      const svgHeader = `<svg xmlns="${svgNS}" width="${finalW}" height="${finalH}" viewBox="0 0 ${outW} ${outH}">`;
      // const svgHeader = `<svg xmlns="${svgNS}" width="${outW}" height="${outH}" viewBox="0 0 ${outW} ${outH}">`;

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
  if (!tr || tr === "none") return new DOMMatrix();
  try { return new DOMMatrix(tr); }
  catch { return new WebKitCSSMatrix(tr); } // fallback WebKit
}

function matrix2DNoTranslate(M) {
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

/**
 * Safely reads individual transform properties from CSS Typed OM when available,
 * falling back to getComputedStyle if not supported.
 * Prevents TypeError: "Invalid propertyName: rotate" on browsers without individual transforms.
 *
 * @param {Element} el
 * @returns {{ rotate: string, scale: string|null, translate: string|null }}
 */
function readIndividualTransforms(el) {
  const out = { rotate: "0deg", scale: null, translate: null };

  // Prefer CSS Typed OM if available, but guard against unsupported properties.
  const map = typeof el.computedStyleMap === "function" ? el.computedStyleMap() : null;
  if (map) {
    /** @param {"rotate"|"scale"|"translate"} prop */
    const safeGet = (prop) => {
      try {
        // If has() exists and says "no", avoid get()
        if (typeof map.has === "function" && !map.has(prop)) return null;
        if (typeof map.get !== "function") return null;
        return map.get(prop);
      } catch {
        return null;
      }
    };

    const rot = safeGet("rotate");
    if (rot) {
      // rot could be a CSSRotate or a plain object depending on impl
      const ang = rot.angle ?? rot;
      if (ang && typeof ang === "object" && "unit" in ang) {
        out.rotate = ang.unit === "rad" ? (ang.value * 180 / Math.PI) + "deg" : (ang.value + ang.unit);
      } else {
        out.rotate = String(rot);
      }
    }

    const sc = safeGet("scale");
    if (sc && sc.length) {
      const sx = sc[0]?.value ?? 1;
      const sy = sc[1]?.value ?? sx;
      out.scale = `${sx} ${sy}`;
    }

    const tr = safeGet("translate");
    if (tr && tr.length) {
      const tx = tr[0]?.value ?? 0;
      const ty = tr[1]?.value ?? 0;
      const ux = tr[0]?.unit ?? "px";
      const uy = tr[1]?.unit ?? "px";
      out.translate = `${tx}${ux} ${ty}${uy}`;
    }

    return out;
  }

  // Fallback: try computed style individual props; if absent, defaults remain
  const cs = getComputedStyle(el);
  out.rotate = cs.rotate && cs.rotate !== "none" ? cs.rotate : "0deg";
  out.scale = cs.scale && cs.scale !== "none" ? cs.scale : null;
  out.translate = cs.translate && cs.translate !== "none" ? cs.translate : null;

  return out;
}


/**
 * Returns true if element has a transform that changes its bounding box
 * (i.e., rotation/scale/skew). Pure translate is ignored.
 * @param {Element} el
 */
function hasBBoxAffectingTransform(el) {
  const t = getComputedStyle(el).transform || 'none';
  if (t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)') return false; // identity
  // pure translate: matrix(1,0,0,1,tx,ty)
  if (/^matrix\(\s*1\s*,\s*0\s*,\s*0\s*,\s*1\s*,/i.test(t)) return false;
  return true; // rotation/scale/skew/perspective → affects bbox
}

/**
 * Inflate a DOMRect with margins (px) using floor/ceil to avoid subpixel clipping.
 * @param {DOMRect} r
 * @param {{top:number,right:number,bottom:number,left:number}} p
 */
function inflateRect(r, p) {
  const x = Math.floor(r.left - p.left);
  const y = Math.floor(r.top - p.top);
  const w = Math.ceil(r.width + p.left + p.right);
  const h = Math.ceil(r.height + p.top + p.bottom);
  return { x, y, width: w, height: h };
}

let __measureHost = null;
/** Get a persistent offscreen host for measurement (no layout trashing per capture). */
function getMeasureHost() {
  if (__measureHost) return __measureHost;
  const n = document.createElement('div');
  n.id = 'snapdom-measure-slot';
  n.setAttribute('aria-hidden', 'true');
  Object.assign(n.style, {
    position: 'absolute', left: '-99999px', top: '0px',
    width: '0px', height: '0px', overflow: 'hidden',
    opacity: '0', pointerEvents: 'none', contain: 'size layout style'
  });
  document.documentElement.appendChild(n);
  __measureHost = n;
  return n;
}

/**
 * Safe matrix read from a temporary child in the measure host.
 * Applies classic + individual transforms to the temp node and reads DOMMatrix.
 * @param {{ baseTransform:string, rotate:string, scale:string|null, translate:string|null }} t
 */
function readTotalTransformMatrix(t) {
  const host = getMeasureHost();
  const tmp = document.createElement('div');
  tmp.style.transformOrigin = '0 0';
  if (t.baseTransform) tmp.style.transform = t.baseTransform;
  if (t.rotate) tmp.style.rotate = t.rotate;
  if (t.scale) tmp.style.scale = t.scale;
  if (t.translate) tmp.style.translate = t.translate;
  host.appendChild(tmp);
  const M = matrixFromComputed(tmp);
  host.removeChild(tmp);
  return M;
}
