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

// ---- Font helpers (module-scope; shared by collectors & embedCustomFonts) ----

/** Generic CSS family names to ignore when picking primary family */
const GENERIC_FAMILIES = new Set([
  "serif","sans-serif","monospace","cursive","fantasy","system-ui",
  "emoji","math","fangsong","ui-serif","ui-sans-serif","ui-monospace","ui-rounded"
]);

/**
 * Normalize a CSS font-family list to the first non-generic family.
 * E.g. `"Roboto", Arial, sans-serif` -> `Roboto`
 * @param {string} familyList
 * @returns {string}
 */
function pickPrimaryFamily(familyList) {
  if (!familyList) return "";
  for (let raw of familyList.split(",")) {
    let f = raw.trim().replace(/^['"]+|['"]+$/g, "");
    if (!f) continue;
    if (!GENERIC_FAMILIES.has(f.toLowerCase())) return f;
  }
  return "";
}

/**
 * Normalize weight to 100..900 (maps "normal"->400, "bold"->700).
 * @param {string|number} w
 */
function normWeight(w) {
  const t = String(w ?? "400").trim().toLowerCase();
  if (t === "normal") return 400;
  if (t === "bold")   return 700;
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? Math.min(900, Math.max(100, n)) : 400;
}

/**
 * Normalize style to "normal" | "italic" | "oblique".
 * @param {string} s
 * @returns {"normal"|"italic"|"oblique"}
 */
function normStyle(s) {
  const t = String(s ?? "normal").trim().toLowerCase();
  if (t.startsWith("italic"))  return "italic";
  if (t.startsWith("oblique")) return "oblique";
  return "normal";
}

/**
 * Normalize font-stretch to a percentage number (50..200). Defaults to 100.
 * @param {string} st
 * @returns {number}
 */
function normStretchPct(st) {
  const m = String(st ?? "100%").match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? Math.max(50, Math.min(200, parseFloat(m[1]))) : 100;
}

  function parseWeightSpec (spec) {
    const s = String(spec || "400").trim();
    const m = s.match(/^(\d{2,3})\s+(\d{2,3})$/);
    if (m) {
      const a = normWeight(m[1]), b = normWeight(m[2]);
      return { min: Math.min(a,b), max: Math.max(a,b) };
    }
    const v = normWeight(s);
    return { min: v, max: v };
  };

  function parseStyleSpec (spec) {
    const t = String(spec || "normal").trim().toLowerCase();
    if (t === "italic") return { kind: "italic" };
    if (t.startsWith("oblique")) return { kind: "oblique" };
    return { kind: "normal" };
  };

  function parseStretchSpec (spec) {
    const s = String(spec || "100%").trim();
    const mm = s.match(/(\d+(?:\.\d+)?)\s*%\s+(\d+(?:\.\d+)?)\s*%/);
    if (mm) {
      const a = parseFloat(mm[1]), b = parseFloat(mm[2]);
      return { min: Math.min(a,b), max: Math.max(a,b) };
    }
    const m = s.match(/(\d+(?:\.\d+)?)\s*%/);
    const v = m ? parseFloat(m[1]) : 100;
    return { min: v, max: v };
  };
/**
 * Return true if a stylesheet URL is likely to contain @font-face rules.
 * Conservative allowlist for cross-origin fetches.
 * - Same-origin: always allowed (we read CSSOM, no fetch).
 * - Cross-origin: allow only well-known font hosts or URLs containing family hints.
 * @param {string} href
 * @param {Set<string>} requiredFamilies // plain names e.g. "Unbounded", "Mansalva"
 */
function isLikelyFontStylesheet(href, requiredFamilies) {
  if (!href) return false;
  try {
    const u = new URL(href, location.href);
    const sameOrigin = (u.origin === location.origin);
    if (sameOrigin) return true; // read via CSSOM, no network fetch here

    const host = u.host.toLowerCase();
    // common font CDNs / keywords
    const FONT_HOSTS = [
      'fonts.googleapis.com', 'fonts.gstatic.com',
      'use.typekit.net', 'p.typekit.net', 'kit.fontawesome.com', 'use.fontawesome.com'
    ];
    if (FONT_HOSTS.some(h => host.endsWith(h))) return true;

    // fallback: heuristic by path keywords
    const path = (u.pathname + u.search).toLowerCase();
    if (/\bfont(s)?\b/.test(path) || /\.woff2?(\b|$)/.test(path)) return true;

    // check if any required family token appears in the URL (e.g., family=Unbounded)
    for (const fam of requiredFamilies) {
      const tokenA = fam.toLowerCase().replace(/\s+/g, '+');
      const tokenB = fam.toLowerCase().replace(/\s+/g, '-');
      if (path.includes(tokenA) || path.includes(tokenB)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Handy: build the set of plain family names from the required keys.
 * required key format: "family__weight__style__stretchPct"
 * @param {Set<string>} required
 */
function familiesFromRequired(required) {
  const out = new Set();
  for (const k of (required || [])) {
    const fam = String(k).split('__')[0]?.trim();
    if (fam) out.add(fam);
  }
  return out;
}

/**
 * Embed only the @font-face rules that match required variants AND intersect used unicode ranges.
 * Smart by default + simple "exclude" knobs (no regex for end users).
 *
 * @typedef {{family:string, weightSpec:string, styleSpec:string, stretchSpec:string, unicodeRange:string, srcRaw:string, srcUrls:string[], href:string}} FontFaceMeta
 *
 * @param {Object} options
 * @param {Set<string>} options.required                     // keys: "family__weight__style__stretchPct"
 * @param {Set<number>} options.usedCodepoints               // codepoints used in the captured subtree
 * @param {{families?:string[], domains?:string[], subsets?:string[]}} [options.exclude] // simple exclude
 * @param {boolean} [options.preCached=false]
 * @param {Array<{family:string,src:string,weight?:string|number,style?:string,stretchPct?:number}>} [options.localFonts=[]]
 * @param {string}  [options.useProxy=""]
 * @returns {Promise<string>} inlined @font-face CSS
 */
export async function embedCustomFonts({
  required,
  usedCodepoints,
  exclude = undefined,
  preCached = false,
  localFonts = [],
  useProxy = "",
} = {}) {
  // ---------- Normalize inputs ----------
  if (!(required instanceof Set)) required = new Set();
  if (!(usedCodepoints instanceof Set)) usedCodepoints = new Set();

  // Build index: family -> [{w,s,st}]
  const requiredIndex = new Map();
  for (const key of required) {
    const [fam, w, s, st] = String(key).split("__");
    if (!fam) continue;
    const arr = requiredIndex.get(fam) || [];
    arr.push({ w: parseInt(w, 10), s, st: parseInt(st, 10) });
    requiredIndex.set(fam, arr);
  }

  // ---- Local helpers (scoped) ----
  const IMPORT_RE = /@import\s+url\(["']?([^"')]+)["']?\)/g;
  const URL_RE    = /url\((["']?)([^"')]+)\1\)/g;
  const FACE_RE   = /@font-face[^{}]*\{[^}]*\}/g;

  /**
 * Decide si un @font-face (por family/style/weight/stretch declarados en CSS)
 * satisface alguna variante requerida. Acepta:
 * - Coincidencia exacta por rango (p.ej. 100..900 incluye cualquier req).
 * - Coincidencia exacta por valor.
 * - Fallback por “mejor cercano” cuando el face declara un único peso y la familia
 *   no publica el requerido (p.ej. req=700, face=400 ⇒ OK).
 */
function faceMatchesRequired(fam, styleSpec, weightSpec, stretchSpec) {
  if (!requiredIndex.has(fam)) return false;

  const need    = requiredIndex.get(fam);           // [{ w:number, s:string, st:number }]
  const ws      = parseWeightSpec(weightSpec);      // { min, max }
  const ss      = parseStyleSpec(styleSpec);        // { kind: 'normal'|'italic'|'oblique' }
  const ts      = parseStretchSpec(stretchSpec);    // { min, max }

  // ¿El face declara un rango real (no single)?
  const faceIsRange = ws.min !== ws.max;
  const faceSingleW = ws.min; // si single, min==max

  // helper: ¿req.style es compatible con face.style?
  const styleOK = (reqKind) => (
    (ss.kind === 'normal' && reqKind === 'normal') ||
    (ss.kind !== 'normal' && (reqKind === 'italic' || reqKind === 'oblique'))
  );

  let exactMatched = false;

  for (const r of need) {
    // Coincidencia exacta por rango/peso
    const wOk = faceIsRange ? (r.w >= ws.min && r.w <= ws.max) : (r.w === faceSingleW);
    const sOk = styleOK(normStyle(r.s));
    const tOk = (r.st >= ts.min && r.st <= ts.max);

    if (wOk && sOk && tOk) {
      exactMatched = true;
      break;
    }
  }

  if (exactMatched) return true;

  // --- Fallback “mejor cercano” ---
  // Si el face NO trae rango (solo un peso) y falló exacto, permitimos cercanía.
  // Razonamiento: algunos families (Mansalva, etc.) solo publican 400 y el navegador
  // sintetiza bold/italic. Aceptamos diferencia de hasta 300 (400 vs 700).
  if (!faceIsRange) {
    for (const r of need) {
      const sOk = styleOK(normStyle(r.s));
      const tOk = (r.st >= ts.min && r.st <= ts.max);
      const nearWeight = Math.abs(faceSingleW - r.w) <= 300; // 100..900 pasos de 100

      if (nearWeight && sOk && tOk) {
        return true;
      }
    }
  }

  return false;
}


  /** @param {string} ur */
  function parseUnicodeRange(ur) {
    if (!ur) return [];
    const ranges = [];
    const parts = ur.split(",").map(s => s.trim()).filter(Boolean);
    for (const p of parts) {
      const m = p.match(/^U\+([0-9A-Fa-f?]+)(?:-([0-9A-Fa-f?]+))?$/);
      if (!m) continue;
      const a = m[1], b = m[2];
      const expand = (hex) => {
        if (!hex.includes("?")) return parseInt(hex, 16);
        const min = parseInt(hex.replace(/\?/g, "0"), 16);
        const max = parseInt(hex.replace(/\?/g, "F"), 16);
        return [min, max];
      };
      if (b) {
        const A = expand(a), B = expand(b);
        const min = Array.isArray(A) ? A[0] : A;
        const max = Array.isArray(B) ? B[1] : B;
        ranges.push([Math.min(min, max), Math.max(min, max)]);
      } else {
        const X = expand(a);
        if (Array.isArray(X)) ranges.push([X[0], X[1]]);
        else ranges.push([X, X]);
      }
    }
    return ranges;
  }

  /** @param {Set<number>} used @param {Array<[number,number]>} ranges */
  function unicodeIntersects(used, ranges) {
    if (!ranges.length) return true;
    for (const cp of used) {
      for (const [a, b] of ranges) if (cp >= a && cp <= b) return true;
    }
    return false;
  }

  /** @param {string} srcValue @param {string} baseHref */
  function extractSrcUrls(srcValue, baseHref) {
    const urls = [];
    if (!srcValue) return urls;
    for (const m of srcValue.matchAll(URL_RE)) {
      let u = (m[2] || "").trim();
      if (!u || u.startsWith("data:")) continue;
      if (!/^https?:/i.test(u)) {
        try { u = new URL(u, baseHref || location.href).href; } catch {}
      }
      urls.push(u);
    }
    return urls;
  }

  /** @param {string} cssBlock @param {string} baseHref */
  async function inlineUrlsInCssBlock(cssBlock, baseHref) {
    let out = cssBlock;
    for (const m of cssBlock.matchAll(URL_RE)) {
      const raw = extractURL(m[0]);
      if (!raw) continue;
      let abs = raw;
      if (!abs.startsWith("http") && !abs.startsWith("data:")) {
        try { abs = new URL(abs, baseHref || location.href).href; } catch {}
      }
      if (isIconFont(abs)) continue;

      if (cache.resource?.has(abs)) {
        cache.font?.add(abs);
        out = out.replace(m[0], `url(${cache.resource.get(abs)})`);
        continue;
      }
      if (cache.font?.has(abs)) continue;

      try {
        const res  = await fetchResource(abs, { useProxy });
        const blob = await res.blob();
        const b64  = await new Promise((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.readAsDataURL(blob);
        });
        cache.resource?.set(abs, b64);
        cache.font?.add(abs);
        out = out.replace(m[0], `url(${b64})`);
      } catch {
        console.warn("[snapdom] Failed to fetch font resource:", abs);
      }
    }
    return out;
  }

  // ---- simple exclude builder (families/domains/subsets) ----
  function subsetFromRanges(ranges) {
    if (!ranges.length) return null;
    const hit = (a, b) => ranges.some(([x, y]) => !(y < a || x > b));
    const latin    = hit(0x0000, 0x00FF) || hit(0x0131, 0x0131);
    const latinExt = hit(0x0100, 0x024F) || hit(0x1E00, 0x1EFF);
    const greek    = hit(0x0370, 0x03FF);
    const cyr      = hit(0x0400, 0x04FF);
    const viet     = hit(0x1EA0, 0x1EF9) || hit(0x0102, 0x0103) || hit(0x01A0, 0x01A1) || hit(0x01AF, 0x01B0);
    if (viet) return "vietnamese";
    if (cyr)  return "cyrillic";
    if (greek) return "greek";
    if (latinExt) return "latin-ext";
    if (latin) return "latin";
    return null;
  }
  function buildSimpleExcluder(ex = {}) {
    const famSet = new Set((ex.families || []).map(s => String(s).toLowerCase()));
    const domSet = new Set((ex.domains  || []).map(s => String(s).toLowerCase()));
    const subSet = new Set((ex.subsets  || []).map(s => String(s).toLowerCase()));
    return (meta, parsedRanges) => {
      if (famSet.size && famSet.has(meta.family.toLowerCase())) return true;
      if (domSet.size) {
        for (const u of meta.srcUrls) {
          try { if (domSet.has(new URL(u).host.toLowerCase())) return true; } catch {}
        }
      }
      if (subSet.size) {
        const label = subsetFromRanges(parsedRanges);
        if (label && subSet.has(label)) return true;
      }
      return false;
    };
  }
  const simpleExcluder = buildSimpleExcluder(exclude);

  // ---- cache key per capture signature (avoid cross‑pollution between different targets) ----
  function buildFontsCacheKey() {
    const req = Array.from(required || []).sort().join('|');
    const ex  = exclude ? JSON.stringify({
      families: (exclude.families || []).map(s => String(s).toLowerCase()).sort(),
      domains:  (exclude.domains  || []).map(s => String(s).toLowerCase()).sort(),
      subsets:  (exclude.subsets  || []).map(s => String(s).toLowerCase()).sort(),
    }) : '';
    const lf  = (localFonts || [])
      .map(f => `${(f.family||'').toLowerCase()}::${f.weight||'normal'}::${f.style||'normal'}::${f.src||''}`)
      .sort()
      .join('|');
    const px  = useProxy || '';
    return `fonts-embed-css::req=${req}::ex=${ex}::lf=${lf}::px=${px}`;
  }
  function injectOrReplaceEmbedStyle(cssText) {
    document.querySelectorAll('style[data-snapdom="embedFonts"]').forEach(s => s.remove());
    const style = document.createElement('style');
    style.setAttribute('data-snapdom', 'embedFonts');
    style.textContent = cssText;
    document.head.appendChild(style);
    return style;
  }
  const cacheKey = buildFontsCacheKey();
  if (cache.resource?.has(cacheKey)) {
    const css = cache.resource.get(cacheKey);
    if (preCached && css) injectOrReplaceEmbedStyle(css);
    return css;
  }

  // ---- Ensure only likely @import font styles become reachable (<link>), avoid noise (orbit, fa, etc.) ----
  const requiredFamilies = familiesFromRequired(required);
  const importUrls = [];
  for (const styleTag of document.querySelectorAll("style")) {
    const cssText = styleTag.textContent || "";
    for (const m of cssText.matchAll(IMPORT_RE)) {
      const u = m[1];
      if (!u) continue;
      if (isIconFont(u)) continue;
      if (!isLikelyFontStylesheet(u, requiredFamilies)) continue;
      if (!Array.from(document.styleSheets).some(s => s.href === u)) {
        importUrls.push(u);
      }
    }
  }
  if (importUrls.length) {
    await Promise.all(importUrls.map((u) => new Promise((resolve) => {
      if (Array.from(document.styleSheets).some(s => s.href === u)) return resolve(null);
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = u;
      link.setAttribute("data-snapdom", "injected-import");
      link.onload = () => resolve(link);
      link.onerror = () => resolve(null);
      document.head.appendChild(link);
    })));
  }

  let finalCSS = "";

  // ---------- 1) External <link rel="stylesheet"> ----------
  const linkNodes = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).filter(l => !!l.href);

  for (const link of linkNodes) {
    try {
      // skip icon fonts by href early
      if (isIconFont(link.href)) continue;

      // same-origin => prefer CSSOM (no fetch)
      let cssText = '';
      let sameOrigin = false;
      try { sameOrigin = new URL(link.href, location.href).origin === location.origin; } catch {}
      if (!sameOrigin) {
        // cross-origin: only fetch if likely font stylesheet
        if (!isLikelyFontStylesheet(link.href, requiredFamilies)) continue;
      }

      if (sameOrigin) {
        const sheet = Array.from(document.styleSheets).find(s => s.href === link.href);
        if (sheet) {
          try {
            const rules = sheet.cssRules || [];
            cssText = Array.from(rules).map(r => r.cssText).join('\n');
          } catch {
            // fallback to fetch
          }
        }
      }
      if (!cssText) {
        const res = await fetchResource(link.href, { useProxy });
        cssText = await res.text();
        if (isIconFont(cssText)) continue;
      }

      let cssOut = cssText;
      for (const face of cssText.match(FACE_RE) || []) {
        const famRaw      = (face.match(/font-family:\s*([^;]+);/i)?.[1] || "").trim();
        const family      = pickPrimaryFamily(famRaw);
        if (!family || isIconFont(family)) { cssOut = cssOut.replace(face, ""); continue; }

        const weightSpec  = (face.match(/font-weight:\s*([^;]+);/i)?.[1] || "400").trim();
        const styleSpec   = (face.match(/font-style:\s*([^;]+);/i)?.[1]  || "normal").trim();
        const stretchSpec = (face.match(/font-stretch:\s*([^;]+);/i)?.[1] || "100%").trim();
        const urange      = (face.match(/unicode-range:\s*([^;]+);/i)?.[1]|| "").trim();
        const srcRaw      = (face.match(/src\s*:\s*([^;]+);/i)?.[1]     || "").trim();
        const srcUrls     = extractSrcUrls(srcRaw, link.href);

        if (!faceMatchesRequired(family, styleSpec, weightSpec, stretchSpec)) { cssOut = cssOut.replace(face, ""); continue; }
        const ranges = parseUnicodeRange(urange);
        if (!unicodeIntersects(usedCodepoints, ranges)) { cssOut = cssOut.replace(face, ""); continue; }

        const meta = { family, weightSpec, styleSpec, stretchSpec, unicodeRange: urange, srcRaw, srcUrls, href: link.href };
        if (exclude && simpleExcluder(meta, ranges)) { cssOut = cssOut.replace(face, ""); continue; }

        const newFace = /url\(/i.test(srcRaw) ? await inlineUrlsInCssBlock(face, link.href) : face;
        cssOut = cssOut.replace(face, newFace);
      }

      if (cssOut.trim()) finalCSS += cssOut + "\n";
    } catch (e) {
      console.warn("[snapdom] Failed to process stylesheet:", link.href);
    }
  }

  // ---------- 2) CSSOM (inline/imported) ----------
  for (const sheet of document.styleSheets) {
    try {
      // avoid double-processing if already handled via link loop
      if (sheet.href && linkNodes.some(l => l.href === sheet.href)) continue;

      const rules = sheet.cssRules || [];
      for (const rule of rules) {
        if (rule.type !== CSSRule.FONT_FACE_RULE) continue;

        const famRaw      = (rule.style.getPropertyValue("font-family") || "").trim();
        const family      = pickPrimaryFamily(famRaw);
        if (!family || isIconFont(family)) continue;

        const weightSpec  = (rule.style.getPropertyValue("font-weight")  || "400").trim();
        const styleSpec   = (rule.style.getPropertyValue("font-style")    || "normal").trim();
        const stretchSpec = (rule.style.getPropertyValue("font-stretch")  || "100%").trim();
        const srcRaw      = (rule.style.getPropertyValue("src") || "").trim();
        const urange      = (rule.style.getPropertyValue("unicode-range") || "").trim();
        const srcUrls     = extractSrcUrls(srcRaw, sheet.href || location.href);

        if (!faceMatchesRequired(family, styleSpec, weightSpec, stretchSpec)) continue;
        const ranges = parseUnicodeRange(urange);
        if (!unicodeIntersects(usedCodepoints, ranges)) continue;

        const meta = { family, weightSpec, styleSpec, stretchSpec, unicodeRange: urange, srcRaw, srcUrls, href: sheet.href || location.href };
        if (exclude && simpleExcluder(meta, ranges)) continue;

        if (/url\(/i.test(srcRaw)) {
          const inlinedSrc = await inlineUrlsInCssBlock(srcRaw, sheet.href || location.href);
          finalCSS += `@font-face{font-family:${family};src:${inlinedSrc};font-style:${styleSpec};font-weight:${weightSpec};font-stretch:${stretchSpec};${urange?`unicode-range:${urange};`:""}}\n`;
        } else {
          // keep local()-only variants
          finalCSS += `@font-face{font-family:${family};src:${srcRaw};font-style:${styleSpec};font-weight:${weightSpec};font-stretch:${stretchSpec};${urange?`unicode-range:${urange};`:""}}\n`;
        }
      }
    } catch {
      // cross-origin protected CSSOM; ignore
    }
  }

  // ---------- 3) document.fonts with _snapdomSrc ----------
  try {
    for (const f of document.fonts || []) {
      if (!f || !f.family || f.status !== "loaded" || !f._snapdomSrc) continue;
      const fam = String(f.family).replace(/^['"]+|['"]+$/g, "");
      if (isIconFont(fam)) continue;
      if (!requiredIndex.has(fam)) continue;

      if (exclude?.families && exclude.families.some(n => String(n).toLowerCase() === fam.toLowerCase())) {
        continue;
      }

      let b64 = f._snapdomSrc;
      if (!String(b64).startsWith("data:")) {
        if (cache.resource?.has(f._snapdomSrc)) {
          b64 = cache.resource.get(f._snapdomSrc);
          cache.font?.add(f._snapdomSrc);
        } else if (!cache.font?.has(f._snapdomSrc)) {
          try {
            const res  = await fetchResource(f._snapdomSrc, { useProxy });
            const blob = await res.blob();
            b64 = await new Promise((resolve) => {
              const r = new FileReader();
              r.onload = () => resolve(r.result);
              r.readAsDataURL(blob);
            });
            cache.resource?.set(f._snapdomSrc, b64);
            cache.font?.add(f._snapdomSrc);
          } catch {
            console.warn("[snapdom] Failed to fetch dynamic font src:", f._snapdomSrc);
            continue;
          }
        }
      }
      finalCSS += `@font-face{font-family:'${fam}';src:url(${b64});font-style:${f.style||"normal"};font-weight:${f.weight||"normal"};}\n`;
    }
  } catch {}

  // ---------- 4) user-provided localFonts (respect smart filtering by family) ----------
  for (const font of localFonts) {
    if (!font || typeof font !== "object") continue;
    const family = String(font.family || "").replace(/^['"]+|['"]+$/g, "");
    if (!family || isIconFont(family)) continue;
    if (!requiredIndex.has(family)) continue;
    if (exclude?.families && exclude.families.some(n => String(n).toLowerCase() === family.toLowerCase())) continue;

    const weight  = font.weight != null ? String(font.weight) : "normal";
    const style   = font.style  != null ? String(font.style)  : "normal";
    const stretch = font.stretchPct != null ? `${font.stretchPct}%` : "100%";
    const src     = String(font.src || "");

    let b64 = src;
    if (!b64.startsWith("data:")) {
      if (cache.resource?.has(src)) {
        b64 = cache.resource.get(src);
        cache.font?.add(src);
      } else if (!cache.font?.has(src)) {
        try {
          const res  = await fetchResource(src, { useProxy });
          const blob = await res.blob();
          b64 = await new Promise((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.readAsDataURL(blob);
          });
          cache.resource?.set(src, b64);
          cache.font?.add(src);
        } catch {
          console.warn("[snapdom] Failed to fetch localFonts src:", src);
          continue;
        }
      }
    }
    finalCSS += `@font-face{font-family:'${family}';src:url(${b64});font-style:${style};font-weight:${weight};font-stretch:${stretch};}\n`;
  }

  // ---------- Cache + optional inject ----------
  if (finalCSS) {
    cache.resource?.set(cacheKey, finalCSS);
    // borro global viejo si existiera (legacy)
    if (cache.resource?.has('fonts-embed-css')) cache.resource.delete('fonts-embed-css');
    if (preCached) {
      injectOrReplaceEmbedStyle(finalCSS);
    }
  }
  return finalCSS;
}


export function collectUsedFontVariants(root) {
  const req = /* @__PURE__ */ new Set();
  if (!root) return req;
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
  const addFromStyle = (cs) => {
    const family = pickPrimaryFamily(cs.fontFamily);
    if (!family) return;
    const key = (w, s, st) => `${family}__${normWeight(w)}__${normStyle(s)}__${normStretchPct(st)}`;
    req.add(key(cs.fontWeight, cs.fontStyle, cs.fontStretch));
  };
  addFromStyle(getComputedStyle(root));
  const csBeforeRoot = getComputedStyle(root, "::before");
  if (csBeforeRoot && csBeforeRoot.content && csBeforeRoot.content !== "none") addFromStyle(csBeforeRoot);
  const csAfterRoot = getComputedStyle(root, "::after");
  if (csAfterRoot && csAfterRoot.content && csAfterRoot.content !== "none") addFromStyle(csAfterRoot);
  while (tw.nextNode()) {
    const el = (
      /** @type {Element} */
      tw.currentNode
    );
    const cs = getComputedStyle(el);
    addFromStyle(cs);
    const b = getComputedStyle(el, "::before");
    if (b && b.content && b.content !== "none") addFromStyle(b);
    const a = getComputedStyle(el, "::after");
    if (a && a.content && a.content !== "none") addFromStyle(a);
  }
  return req;
}
export function collectUsedCodepoints(root) {
  const used = /* @__PURE__ */ new Set();
  const pushText = (txt) => {
    if (!txt) return;
    for (const ch of txt) used.add(ch.codePointAt(0));
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null);
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n.nodeType === Node.TEXT_NODE) {
      pushText(n.nodeValue || "");
    } else if (n.nodeType === Node.ELEMENT_NODE) {
      const el = (
        /** @type {Element} */
        n
      );
      for (const pseudo of ["::before", "::after"]) {
        const cs = getComputedStyle(el, pseudo);
        const c = cs?.getPropertyValue("content");
        if (!c || c === "none") continue;
        if (/^"/.test(c) || /^'/.test(c)) {
          pushText(c.slice(1, -1));
        } else {
          const matches = c.match(/\\[0-9A-Fa-f]{1,6}/g);
          if (matches) {
            for (const m of matches) {
              try {
                used.add(parseInt(m.slice(1), 16));
              } catch {
              }
            }
          }
        }
      }
    }
  }
  return used;
}
