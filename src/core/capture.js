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
import { lineClamp } from '../modules/lineClamp.js';
import { runHook } from './plugins.js';

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

export async function captureDOM(element, options) {
  if (!element) throw new Error("Element cannot be null or undefined");
  applyCachePolicy(options.cache);
  const context = options
  await runHook('beforeSnap', context);


  const fast = options.fast;
  let clone, classCSS, styleCache;
  let fontsCSS = "";
  let baseCSS = "";
  let dataURL;
  let svgString;

  await runHook('beforeClone', context);

  const undoClamp = lineClamp(element);
  try {
    ({ clone, classCSS, styleCache } = await prepareClone(element, options));
    context.clone = clone;
    context.classCSS = classCSS;
    context.styleCache = styleCache;

    // HOOK: afterClone
    await runHook('afterClone', context);
  } finally {
    undoClamp();
  }
  await new Promise((resolve) => {
    idle(async () => {
      await inlineImages(context.clone, options);
      resolve();
    }, { fast });
  });
  await new Promise((resolve) => {
    idle(async () => {
      await inlineBackgroundImages(element, context.clone, context.styleCache, options);
      resolve();
    }, { fast });
  });
  if (options.embedFonts) {
    await new Promise((resolve) => {
      idle(async () => {
        const required = collectUsedFontVariants(element);
        const usedCodepoints = collectUsedCodepoints(element);
        if (isSafari()) {
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
          useProxy: options.useProxy
        });
        resolve();
      }, { fast });
    });
  }
  const usedTags = collectUsedTagNames(context.clone).sort();
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
  context.fontsCSS = fontsCSS;
  context.baseCSS = baseCSS;
  await new Promise((resolve) => {
    idle(() => {
      const csEl = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const w0 = Math.max(1, Math.ceil(element.offsetWidth || parseFloat(csEl.width) || rect.width || 1));
      const h0 = Math.max(1, Math.ceil(element.offsetHeight || parseFloat(csEl.height) || rect.height || 1));
      const coerceNum = (v, def = NaN) => {
        const n = typeof v === "string" ? parseFloat(v) : v;
        return Number.isFinite(n) ? n : def;
      };
      const optW = coerceNum(options.width);
      const optH = coerceNum(options.height);
      let w = w0, h = h0;

      const hasW = Number.isFinite(optW);
      const hasH = Number.isFinite(optH);
      const aspect0 = h0 > 0 ? w0 / h0 : 1;
      if (hasW && hasH) {
        w = Math.max(1, Math.ceil(optW));
        h = Math.max(1, Math.ceil(optH));
      } else if (hasW) {
        w = Math.max(1, Math.ceil(optW));
        h = Math.max(1, Math.ceil(w / (aspect0 || 1)));
      } else if (hasH) {
        h = Math.max(1, Math.ceil(optH));
        w = Math.max(1, Math.ceil(h * (aspect0 || 1)));
      } else {
        w = w0;
        h = h0;
      }

      let minX = 0, minY = 0, maxX = w0, maxY = h0;
      if (hasTFBBox(element)) {
        const baseTransform2 = csEl.transform && csEl.transform !== "none" ? csEl.transform : "";
        const ind2 = readIndividualTransforms(element);
        const TOTAL = readTotalTransformMatrix({
          baseTransform: baseTransform2,
          rotate: ind2.rotate || "0deg",
          scale: ind2.scale,
          translate: ind2.translate
        });
        const { ox: ox2, oy: oy2 } = parseTransformOriginPx(csEl, w0, h0);
        const M = TOTAL.is2D ? TOTAL : new DOMMatrix(TOTAL.toString());
        const bb = bboxWithOriginFull(w0, h0, M, ox2, oy2);
        minX = bb.minX;
        minY = bb.minY;
        maxX = bb.maxX;
        maxY = bb.maxY;
      }
      const bleedShadow = parseBoxShadow(csEl);
      const bleedBlur = parseFilterBlur(csEl);
      const bleedOutline = parseOutline(csEl);
      const drop = parseFilterDropShadows(csEl);

      // Suma a los bleeds
      const bleed = {
        top: bleedShadow.top + bleedBlur.top + bleedOutline.top + drop.bleed.top,
        right: bleedShadow.right + bleedBlur.right + bleedOutline.right + drop.bleed.right,
        bottom: bleedShadow.bottom + bleedBlur.bottom + bleedOutline.bottom + drop.bleed.bottom,
        left: bleedShadow.left + bleedBlur.left + bleedOutline.left + drop.bleed.left
      };

      minX -= bleed.left;
      minY -= bleed.top;
      maxX += bleed.right;
      maxY += bleed.bottom;

      const vbW0 = Math.max(1, Math.ceil(maxX - minX));
      const vbH0 = Math.max(1, Math.ceil(maxY - minY));
      const outW = Math.max(1, Math.round(vbW0 * (hasW || hasH ? w / w0 : 1)));
      const outH = Math.max(1, Math.round(vbH0 * (hasH || hasW ? h / h0 : 1)));
      const svgNS = "http://www.w3.org/2000/svg";
      const pad = isSafari() ? 1 : 0;
      const fo = document.createElementNS(svgNS, "foreignObject");
      const vbMinX = Math.floor(minX);
      const vbMinY = Math.floor(minY);
      fo.setAttribute("x", String(-(vbMinX - pad)));
      fo.setAttribute("y", String(-(vbMinY - pad)));
      fo.setAttribute("width", String(Math.ceil(w0 + pad * 2)));
      fo.setAttribute("height", String(Math.ceil(h0 + pad * 2)));
      fo.style.overflow = "visible";
      const styleTag = document.createElement("style");
      styleTag.textContent = baseCSS + fontsCSS + "svg{overflow:visible;} foreignObject{overflow:visible;}" + classCSS;
      fo.appendChild(styleTag);
      const container = document.createElement("div");
      container.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      container.style.width = `${w0}px`;
      container.style.height = `${h0}px`;
      container.style.overflow = "visible";
      clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      container.appendChild(clone);
      fo.appendChild(container);
      const serializer = new XMLSerializer();
      const foString = serializer.serializeToString(fo);
      const vbW = vbW0 + pad * 2;
      const vbH = vbH0 + pad * 2;

      const wantsSize = hasW || hasH;

      // Guardar todo en un bloque meta
      options.meta = {
        w0,        // ancho natural del elemento
        h0,        // alto natural
        vbW,       // ancho del viewBox
        vbH,       // alto del viewBox
        targetW: w,  // ancho deseado según options.width
        targetH: h   // alto deseado según options.height
      };

      // SVG header: si es Safari + width/height => mantener natural
      const svgOutW = (isSafari() && wantsSize) ? vbW : (outW + pad * 2);
      const svgOutH = (isSafari() && wantsSize) ? vbH : (outH + pad * 2);

      context.renderParts = {
        foString, svgNS,
        viewBox: { width: vbW, height: vbH },
        output: { width: svgOutW, height: svgOutH },
        pad
      };

      runHook('beforeRender', context).then(() => {
        const { foString: _fo, svgNS: _ns, viewBox, output } = context.renderParts;
        const svgHeader = `<svg xmlns="${_ns}" width="${output.width}" height="${output.height}" viewBox="0 0 ${viewBox.width} ${viewBox.height}">`;
        const svgFooter = "</svg>";
        svgString = svgHeader + _fo + svgFooter;
        dataURL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;

        // Publicar resultado de render
        context.svgString = svgString;
        context.dataURL = dataURL;

        // HOOK: afterRender
        runHook('afterRender', context).then(resolve);
      });
     
    }, { fast });
  });
  const sandbox = document.getElementById("snapdom-sandbox");
  if (sandbox && sandbox.style.position === "absolute") sandbox.remove();
  return dataURL;
}

function parseFilterDropShadows(cs) {
  // Soporta 'filter' y '-webkit-filter'; puede haber múltiples drop-shadow()
  const raw = `${cs.filter || ""} ${cs.webkitFilter || ""}`.trim();
  if (!raw || raw === "none") {
    return { bleed: { top: 0, right: 0, bottom: 0, left: 0 }, has: false };
  }

  // Captura tokens drop-shadow(...) tolerando paréntesis en colores (rgb(a), hsl(a))
  const tokens = raw.match(/drop-shadow\((?:[^()]|\([^()]*\))*\)/gi) || [];
  let t = 0, r = 0, b = 0, l = 0;
  let found = false;

  for (const tok of tokens) {
    found = true;
    // Extrae offsets/blur en px (ox oy [blur]); 'spread' no existe en drop-shadow()
    const nums = tok.match(/-?\d+(?:\.\d+)?px/gi)?.map(v => parseFloat(v)) || [];
    const [ox = 0, oy = 0, blur = 0] = nums;
    const extX = Math.abs(ox) + blur;
    const extY = Math.abs(oy) + blur;
    r = Math.max(r, extX + Math.max(ox, 0));
    l = Math.max(l, extX + Math.max(-ox, 0));
    b = Math.max(b, extY + Math.max(oy, 0));
    t = Math.max(t, extY + Math.max(-oy, 0));
  }

  return {
    bleed: { top: Math.ceil(t), right: Math.ceil(r), bottom: Math.ceil(b), left: Math.ceil(l) },
    has: found
  };
}
function parseBoxShadow(cs) {
  const v = cs.boxShadow || "";
  if (!v || v === "none") return { top: 0, right: 0, bottom: 0, left: 0 };
  const parts = v.split(/\),(?=(?:[^()]*\([^()]*\))*[^()]*$)/).map((s) => s.trim());
  let t = 0, r = 0, b2 = 0, l = 0;
  for (const part of parts) {
    const nums = part.match(/-?\d+(\.\d+)?px/g)?.map((n) => parseFloat(n)) || [];
    if (nums.length < 2) continue;
    const [ox2, oy2, blur = 0, spread = 0] = nums;
    const extX = Math.abs(ox2) + blur + spread;
    const extY = Math.abs(oy2) + blur + spread;
    r = Math.max(r, extX + Math.max(ox2, 0));
    l = Math.max(l, extX + Math.max(-ox2, 0));
    b2 = Math.max(b2, extY + Math.max(oy2, 0));
    t = Math.max(t, extY + Math.max(-oy2, 0));
  }
  return { top: Math.ceil(t), right: Math.ceil(r), bottom: Math.ceil(b2), left: Math.ceil(l) };
}
function parseFilterBlur(cs) {
  const m = (cs.filter || "").match(/blur\(\s*([0-9.]+)px\s*\)/);
  const b2 = m ? Math.ceil(parseFloat(m[1]) || 0) : 0;
  return { top: b2, right: b2, bottom: b2, left: b2 };
}
function parseOutline(cs) {
  if ((cs.outlineStyle || "none") === "none") return { top: 0, right: 0, bottom: 0, left: 0 };
  const w2 = Math.ceil(parseFloat(cs.outlineWidth || "0") || 0);
  return { top: w2, right: w2, bottom: w2, left: w2 };
}
function bboxWithOriginFull(w2, h2, M, ox2, oy2) {
  const a2 = M.a, b2 = M.b, c2 = M.c, d2 = M.d, e2 = M.e || 0, f2 = M.f || 0;
  function pt(x, y) {
    let X = x - ox2, Y = y - oy2;
    let X2 = a2 * X + c2 * Y, Y2 = b2 * X + d2 * Y;
    X2 += ox2 + e2;
    Y2 += oy2 + f2;
    return [X2, Y2];
  }
  const P = [pt(0, 0), pt(w2, 0), pt(0, h2), pt(w2, h2)];
  let minX2 = Infinity, minY2 = Infinity, maxX2 = -Infinity, maxY2 = -Infinity;
  for (const [X, Y] of P) {
    if (X < minX2) minX2 = X;
    if (Y < minY2) minY2 = Y;
    if (X > maxX2) maxX2 = X;
    if (Y > maxY2) maxY2 = Y;
  }
  return { minX: minX2, minY: minY2, maxX: maxX2, maxY: maxY2, width: maxX2 - minX2, height: maxY2 - minY2 };
}
function hasTFBBox(el) {
  return hasBBoxAffectingTransform(el);
}

function matrixFromComputed(el) {
  const tr = getComputedStyle(el).transform;
  if (!tr || tr === "none") return new DOMMatrix();
  try {
    return new DOMMatrix(tr);
  } catch {
    return new WebKitCSSMatrix(tr);
  }
}

/**
 * Returns a robust snapshot of individual transform-like properties.
 * Supports CSS Typed OM (CSSScale/CSSRotate/CSSTranslate) and legacy strings.
 * @param {Element} el
 * @returns {{ rotate:string, scale:string|null, translate:string|null }}
 */
function readIndividualTransforms(el) {
  const out = { rotate: "0deg", scale: null, translate: null };

  const map = (typeof el.computedStyleMap === "function") ? el.computedStyleMap() : null;
  if (map) {
    const safeGet = (prop) => {
      try {
        if (typeof map.has === "function" && !map.has(prop)) return null;
        if (typeof map.get !== "function") return null;
        return map.get(prop);
      } catch { return null; }
    };

    // ROTATE
    const rot = safeGet("rotate");
    if (rot) {
      // CSSRotate or CSSUnitValue(angle)
      if (rot.angle) {
        const ang = rot.angle; // CSSUnitValue
        out.rotate = (ang.unit === "rad")
          ? (ang.value * 180 / Math.PI) + "deg"
          : (ang.value + ang.unit);
      } else if (rot.unit) {
        // CSSUnitValue
        out.rotate = rot.unit === "rad"
          ? (rot.value * 180 / Math.PI) + "deg"
          : (rot.value + rot.unit);
      } else {
        out.rotate = String(rot);
      }
    } else {
      // Legacy fallback
      const cs = getComputedStyle(el);
      out.rotate = (cs.rotate && cs.rotate !== "none") ? cs.rotate : "0deg";
    }

    // SCALE
    const sc = safeGet("scale");
    if (sc) {
      // Chrome: CSSScale { x: CSSUnitValue, y: CSSUnitValue, z? }
      // Safari TP / spec variants can differ; be permissive:
      const sx = ("x" in sc && sc.x?.value != null) ? sc.x.value : (Array.isArray(sc) ? sc[0]?.value : Number(sc) || 1);
      const sy = ("y" in sc && sc.y?.value != null) ? sc.y.value : (Array.isArray(sc) ? sc[1]?.value : sx);
      out.scale = `${sx} ${sy}`;
    } else {
      const cs = getComputedStyle(el);
      out.scale = (cs.scale && cs.scale !== "none") ? cs.scale : null;
    }

    // TRANSLATE
    const tr = safeGet("translate");
    if (tr) {
      // CSSTranslate: { x: CSSNumericValue, y: CSSNumericValue }
      const tx = ("x" in tr && "value" in tr.x) ? tr.x.value : (Array.isArray(tr) ? tr[0]?.value : 0);
      const ty = ("y" in tr && "value" in tr.y) ? tr.y.value : (Array.isArray(tr) ? tr[1]?.value : 0);
      const ux = ("x" in tr && tr.x?.unit) ? tr.x.unit : "px";
      const uy = ("y" in tr && tr.y?.unit) ? tr.y.unit : "px";
      out.translate = `${tx}${ux} ${ty}${uy}`;
    } else {
      const cs = getComputedStyle(el);
      out.translate = (cs.translate && cs.translate !== "none") ? cs.translate : null;
    }
    return out;
  }

  // Legacy path – no Typed OM
  const cs = getComputedStyle(el);
  out.rotate = (cs.rotate && cs.rotate !== "none") ? cs.rotate : "0deg";
  out.scale = (cs.scale && cs.scale !== "none") ? cs.scale : null;
  out.translate = (cs.translate && cs.translate !== "none") ? cs.translate : null;
  return out;
}

/**
 * True if any transform (matrix or individual) can affect layout/bbox.
 * @param {Element} el
 */
function hasBBoxAffectingTransform(el) {
  const cs = getComputedStyle(el);
  const t = cs.transform || "none";

  // Matrix identity or none => might still have individual transforms
  const hasMatrix =
    t !== "none" &&
    !/^matrix\(\s*1\s*,\s*0\s*,\s*0\s*,\s*1\s*,\s*0\s*,\s*0\s*\)$/i.test(t);

  if (hasMatrix) return true;

  // Check individual transform-like properties
  const r = cs.rotate && cs.rotate !== "none" && cs.rotate !== "0deg";
  const s = cs.scale && cs.scale !== "none" && cs.scale !== "1";
  const tr = cs.translate && cs.translate !== "none" && cs.translate !== "0px 0px";

  return Boolean(r || s || tr);
}

/**
 * Parses transform-origin supporting keywords (left/center/right, top/center/bottom).
 * Returns pixel offsets.
 * @param {CSSStyleDeclaration} cs
 * @param {number} w
 * @param {number} h
 */
function parseTransformOriginPx(cs, w, h) {
  const raw = (cs.transformOrigin || "0 0").trim().split(/\s+/);
  const [oxRaw, oyRaw] = [raw[0] || "0", raw[1] || "0"];

  const toPx = (token, size) => {
    const t = token.toLowerCase();
    if (t === "left" || t === "top") return 0;
    if (t === "center") return size / 2;
    if (t === "right") return size;
    if (t === "bottom") return size;
    if (t.endsWith("px")) return parseFloat(t) || 0;
    if (t.endsWith("%")) return (parseFloat(t) || 0) * size / 100;
    // number without unit => px
    if (/^-?\d+(\.\d+)?$/.test(t)) return parseFloat(t) || 0;
    return 0;
  };

  return {
    ox: toPx(oxRaw, w),
    oy: toPx(oyRaw, h),
  };
}

var __measureHost = null;
function getMeasureHost() {
  if (__measureHost) return __measureHost;
  const n = document.createElement("div");
  n.id = "snapdom-measure-slot";
  n.setAttribute("aria-hidden", "true");
  Object.assign(n.style, {
    position: "absolute",
    left: "-99999px",
    top: "0px",
    width: "0px",
    height: "0px",
    overflow: "hidden",
    opacity: "0",
    pointerEvents: "none",
    contain: "size layout style"
  });
  document.documentElement.appendChild(n);
  __measureHost = n;
  return n;
}
function readTotalTransformMatrix(t) {
  const host = getMeasureHost();
  const tmp = document.createElement("div");
  tmp.style.transformOrigin = "0 0";
  if (t.baseTransform) tmp.style.transform = t.baseTransform;
  if (t.rotate) tmp.style.rotate = t.rotate;
  if (t.scale) tmp.style.scale = t.scale;
  if (t.translate) tmp.style.translate = t.translate;
  host.appendChild(tmp);
  const M = matrixFromComputed(tmp);
  host.removeChild(tmp);
  return M;
}
