/**
 * Utilities for handling and embedding web fonts and icon fonts.
 * @module fonts
 */

import { extractURL } from "../utils/helpers";
import { cache } from "../core/cache";
import { isIconFont } from "../modules/iconFonts.js";
import { snapFetch } from "./snapFetch.js";

/**
 * Converts a unicode character from an icon font into a data URL image.
 *
 * @export
 * @param {string} unicodeChar - The unicode character to render
 * @param {string} fontFamily - The font family name
 * @param {string|number} fontWeight - The font weight
 * @param {number} [fontSize=32] - The font size in pixels
 * @param {string} [color="#000"] - The color to use
 * @returns {Promise<{dataUrl:string,width:number,height:number}>} Data URL and intrinsic size
 */
export async function iconToImage(unicodeChar, fontFamily, fontWeight, fontSize = 32, color = "#000") {
  fontFamily = fontFamily.replace(/^['"]+|['"]+$/g, "");
  const dpr = window.devicePixelRatio || 1;

  try { await document.fonts.ready; } catch {}

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

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width * dpr);
  canvas.height = Math.max(1, height * dpr);

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.font = fontWeight ? `${fontWeight} ${fontSize}px "${fontFamily}"` : `${fontSize}px "${fontFamily}"`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
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
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "emoji", "math", "fangsong", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded"
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
  if (t === "bold") return 700;
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
  if (t.startsWith("italic")) return "italic";
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

function parseWeightSpec(spec) {
  const s = String(spec || "400").trim();
  const m = s.match(/^(\d{2,3})\s+(\d{2,3})$/);
  if (m) {
    const a = normWeight(m[1]), b = normWeight(m[2]);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const v = normWeight(s);
  return { min: v, max: v };
}

function parseStyleSpec(spec) {
  const t = String(spec || "normal").trim().toLowerCase();
  if (t === "italic") return { kind: "italic" };
  if (t.startsWith("oblique")) return { kind: "oblique" };
  return { kind: "normal" };
}

function parseStretchSpec(spec) {
  const s = String(spec || "100%").trim();
  const mm = s.match(/(\d+(?:\.\d+)?)\s*%\s+(\d+(?:\.\d+)?)\s*%/);
  if (mm) {
    const a = parseFloat(mm[1]), b = parseFloat(mm[2]);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const m = s.match(/(\d+(?:\.\d+)?)\s*%/);
  const v = m ? parseFloat(m[1]) : 100;
  return { min: v, max: v };
}

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
    const FONT_HOSTS = [
      "fonts.googleapis.com", "fonts.gstatic.com",
      "use.typekit.net", "p.typekit.net", "kit.fontawesome.com", "use.fontawesome.com"
    ];
    if (FONT_HOSTS.some(h => host.endsWith(h))) return true;

    const path = (u.pathname + u.search).toLowerCase();
    if (/\bfont(s)?\b/.test(path) || /\.woff2?(\b|$)/.test(path)) return true;

    for (const fam of requiredFamilies) {
      const tokenA = fam.toLowerCase().replace(/\s+/g, "+");
      const tokenB = fam.toLowerCase().replace(/\s+/g, "-");
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
    const fam = String(k).split("__")[0]?.trim();
    if (fam) out.add(fam);
  }
  return out;
}

// ----------------------------------------------------------------------------
// Import inliner + relative URL rewriter per stylesheet level (with cycle guard)
// ----------------------------------------------------------------------------

/** Rewrites all relative url(...) using the given baseHref. */
function rewriteRelativeUrls(cssText, baseHref) {
  if (!cssText) return cssText;
  return cssText.replace(
    /url\(\s*(['"]?)([^)'"]+)\1\s*\)/g,
    (m, q, u) => {
      const src = (u || "").trim();
      if (!src || /^data:|^blob:|^https?:|^file:|^about:/i.test(src)) return m;
      let abs = src;
      try { abs = new URL(src, baseHref || location.href).href; } catch {}
      return `url("${abs}")`;
    }
  );
}

// Supports both @import url("...") and @import "..."
const IMPORT_ANY_RE = /@import\s+(?:url\(\s*(['"]?)([^)"']+)\1\s*\)|(['"])([^"']+)\3)([^;]*);/g;

/**
 * Flattens @import recursively and rewrites relative urls at each level
 * using that sheet's base href. Uses snapFetch (with proxy) on purpose
 * to bypass CSSOM CORS blocks. Guards cycles and too-deep trees.
 * @param {string} cssText
 * @param {string} ownerHref
 * @param {string} useProxy
 */
async function inlineImportsAndRewrite(cssText, ownerHref, useProxy) {
  if (!cssText) return cssText;

  const visited = new Set();
  const MAX_IMPORT_DEPTH = 10;

  function normalizeUrl(u, base) {
    try { return new URL(u, base || location.href).href; } catch { return u; }
  }

  async function resolveOnce(text, baseHref, depth = 0) {
    if (depth > MAX_IMPORT_DEPTH) {
      console.warn(`[snapDOM] @import depth exceeded (${MAX_IMPORT_DEPTH}) at ${baseHref}`);
      return text;
    }

    let out = "";
    let last = 0;
    let m;
    while ((m = IMPORT_ANY_RE.exec(text))) {
      out += text.slice(last, m.index);
      last = IMPORT_ANY_RE.lastIndex;

      const rawUrl = (m[2] || m[4] || "").trim();
      const absUrl = normalizeUrl(rawUrl, baseHref);

      if (visited.has(absUrl)) {
        console.warn(`[snapDOM] Skipping circular @import: ${absUrl}`);
        continue; // skip re-including this import
      }
      visited.add(absUrl);

      let imported = "";
      try {
        const r = await snapFetch(absUrl, { as: "text", useProxy, silent: true });
        if (r.ok && typeof r.data === "string") imported = r.data;
      } catch { /* noop */ }

      if (imported) {
        imported = rewriteRelativeUrls(imported, absUrl);
        imported = await resolveOnce(imported, absUrl, depth + 1);
        out += `\n/* inlined: ${absUrl} */\n${imported}\n`;
      } else {
        // keep original @import if we couldn't fetch (CORS/offline)
        out += m[0];
      }
    }
    out += text.slice(last);
    return out;
  }

  let rewritten = rewriteRelativeUrls(cssText, ownerHref || location.href);
  rewritten = await resolveOnce(rewritten, ownerHref || location.href, 0);
  return rewritten;
}

// ----------------------------------------------------------------------------

/** Regexes local to embedCustomFonts */
const URL_RE = /url\((["']?)([^"')]+)\1\)/g;
const FACE_RE = /@font-face[^{}]*\{[^}]*\}/g;

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
  if (!used || used.size === 0) return true; // don't over-filter if unknown
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
async function inlineUrlsInCssBlock(cssBlock, baseHref, useProxy = "") {
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
      const r = await snapFetch(abs, { as: "dataURL", useProxy, silent: true });
      if (r.ok && typeof r.data === "string") {
        const b64 = r.data;
        cache.resource?.set(abs, b64);
        cache.font?.add(abs);
        out = out.replace(m[0], `url(${b64})`);
      }
    } catch {
      console.warn("[snapDOM] Failed to fetch font resource:", abs);
    }
  }
  return out;
}

// ---- simple exclude builder (families/domains/subsets) ----
function subsetFromRanges(ranges) {
  if (!ranges.length) return null;
  const hit = (a, b) => ranges.some(([x, y]) => !(y < a || x > b));
  const latin = hit(0x0000, 0x00FF) || hit(0x0131, 0x0131);
  const latinExt = hit(0x0100, 0x024F) || hit(0x1E00, 0x1EFF);
  const greek = hit(0x0370, 0x03FF);
  const cyr = hit(0x0400, 0x04FF);
  const viet = hit(0x1EA0, 0x1EF9) || hit(0x0102, 0x0103) || hit(0x01A0, 0x01A1) || hit(0x01AF, 0x01B0);
  if (viet) return "vietnamese";
  if (cyr) return "cyrillic";
  if (greek) return "greek";
  if (latinExt) return "latin-ext";
  if (latin) return "latin";
  return null;
}

function buildSimpleExcluder(ex = {}) {
  const famSet = new Set((ex.families || []).map(s => String(s).toLowerCase()));
  const domSet = new Set((ex.domains || []).map(s => String(s).toLowerCase()));
  const subSet = new Set((ex.subsets || []).map(s => String(s).toLowerCase()));
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

function dedupeFontFaces(cssText) {
  if (!cssText) return cssText;

  const FACE_RE_G = /@font-face[^{}]*\{[^}]*\}/gi;

  const seen = new Set();
  const out = [];

  for (const block of cssText.match(FACE_RE_G) || []) {
    const familyRaw = block.match(/font-family:\s*([^;]+);/i)?.[1] || "";
    const family = pickPrimaryFamily(familyRaw);
    const weightSpec = (block.match(/font-weight:\s*([^;]+);/i)?.[1] || "400").trim();
    const styleSpec = (block.match(/font-style:\s*([^;]+);/i)?.[1] || "normal").trim();
    const stretchSpec = (block.match(/font-stretch:\s*([^;]+);/i)?.[1] || "100%").trim();
    const urange = (block.match(/unicode-range:\s*([^;]+);/i)?.[1] || "").trim();
    const srcRaw = (block.match(/src\s*:\s*([^;]+);/i)?.[1] || "").trim();

    const urls = extractSrcUrls(srcRaw, location.href);
    const srcPart = urls.length
      ? urls.map(u => String(u).toLowerCase()).sort().join("|")
      : srcRaw.toLowerCase();

    const key = [
      String(family || "").toLowerCase(),
      weightSpec, styleSpec, stretchSpec,
      urange.toLowerCase(),
      srcPart
    ].join("|");

    if (!seen.has(key)) {
      seen.add(key);
      out.push(block);
    }
  }

  if (out.length === 0) return cssText;

  let i = 0;
  return cssText.replace(FACE_RE_G, () => out[i++] || "");
}

// ---- cache key per capture signature (avoid cross-pollution between different targets) ----
function buildFontsCacheKey(required, exclude, localFonts, useProxy) {
  const req = Array.from(required || []).sort().join("|");
  const ex = exclude ? JSON.stringify({
    families: (exclude.families || []).map(s => String(s).toLowerCase()).sort(),
    domains: (exclude.domains || []).map(s => String(s).toLowerCase()).sort(),
    subsets: (exclude.subsets || []).map(s => String(s).toLowerCase()).sort(),
  }) : "";
  const lf = (localFonts || [])
    .map(f => `${(f.family || "").toLowerCase()}::${f.weight || "normal"}::${f.style || "normal"}::${f.src || ""}`)
    .sort()
    .join("|");
  const px = useProxy || "";
  return `fonts-embed-css::req=${req}::ex=${ex}::lf=${lf}::px=${px}`;
}

// ----------------------------------------------------------------------------
// CSSOM recursive collector (descends into CSSImportRule) with cycle guard
// ----------------------------------------------------------------------------

/**
 * Recursively collect @font-face from a CSSStyleSheet, honoring baseHref for each subsheet.
 * Guards cycles and excessive import depth.
 * @param {CSSStyleSheet} sheet
 * @param {string} baseHref
 * @param {(css:string)=>Promise<void>|void} emitFace
 * @param {Object} ctx
 * @param {Map} ctx.requiredIndex
 * @param {Set<number>} ctx.usedCodepoints
 * @param {(fam:string,styleSpec:string,weightSpec:string,stretchSpec:string)=>boolean} ctx.faceMatchesRequired
 * @param {(meta:any, ranges:any)=>boolean} ctx.simpleExcluder
 * @param {string} ctx.useProxy
 * @param {Set<string>} ctx.visitedSheets
 * @param {number} ctx.depth
 */
async function collectFacesFromSheet(sheet, baseHref, emitFace, ctx) {
  let rules;
  try {
    rules = sheet.cssRules || [];
  } catch {
    // CSSOM blocked (CORS) → handled in <link> pass via fetch+inline
    return;
  }

  const normalizeUrl = (u, base) => {
    try { return new URL(u, base || location.href).href; } catch { return u; }
  };
  const MAX_IMPORT_DEPTH = 10;

  for (const rule of rules) {
    if (rule.type === CSSRule.IMPORT_RULE && rule.styleSheet) {
      const childHref = rule.href ? normalizeUrl(rule.href, baseHref) : baseHref;

      if (ctx.depth >= MAX_IMPORT_DEPTH) {
        console.warn(`[snapDOM] CSSOM import depth exceeded (${MAX_IMPORT_DEPTH}) at ${childHref}`);
        continue;
      }
      if (childHref && ctx.visitedSheets.has(childHref)) {
        console.warn(`[snapDOM] Skipping circular CSSOM import: ${childHref}`);
        continue;
      }
      if (childHref) ctx.visitedSheets.add(childHref);

      const nextCtx = { ...ctx, depth: (ctx.depth || 0) + 1 };
      await collectFacesFromSheet(rule.styleSheet, childHref, emitFace, nextCtx);
      continue;
    }

    if (rule.type === CSSRule.FONT_FACE_RULE) {
      const famRaw = (rule.style.getPropertyValue("font-family") || "").trim();
      const family = pickPrimaryFamily(famRaw);
      if (!family || isIconFont(family)) continue;

      const weightSpec  = (rule.style.getPropertyValue("font-weight")   || "400").trim();
      const styleSpec   = (rule.style.getPropertyValue("font-style")    || "normal").trim();
      const stretchSpec = (rule.style.getPropertyValue("font-stretch")  || "100%").trim();
      const srcRaw      = (rule.style.getPropertyValue("src")           || "").trim();
      const urange      = (rule.style.getPropertyValue("unicode-range") || "").trim();

      if (!ctx.faceMatchesRequired(family, styleSpec, weightSpec, stretchSpec)) continue;
      const ranges = parseUnicodeRange(urange);
      if (!unicodeIntersects(ctx.usedCodepoints, ranges)) continue;

      const meta = {
        family, weightSpec, styleSpec, stretchSpec,
        unicodeRange: urange,
        srcRaw,
        srcUrls: extractSrcUrls(srcRaw, baseHref || location.href),
        href: baseHref || location.href
      };
      if (ctx.simpleExcluder && ctx.simpleExcluder(meta, ranges)) continue;

      if (/url\(/i.test(srcRaw)) {
        const inlinedSrc = await inlineUrlsInCssBlock(srcRaw, baseHref || location.href, ctx.useProxy);
        await emitFace(`@font-face{font-family:${family};src:${inlinedSrc};font-style:${styleSpec};font-weight:${weightSpec};font-stretch:${stretchSpec};${urange ? `unicode-range:${urange};` : ""}}`);
      } else {
        await emitFace(`@font-face{font-family:${family};src:${srcRaw};font-style:${styleSpec};font-weight:${weightSpec};font-stretch:${stretchSpec};${urange ? `unicode-range:${urange};` : ""}}`);
      }
    }
  }
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
 * @param {Array<{family:string,src:string,weight?:string|number,style?:string,stretchPct?:number}>} [options.localFonts=[]]
 * @param {string}  [options.useProxy=""]
 * @returns {Promise<string>} inlined @font-face CSS
 */
export async function embedCustomFonts({
  required,
  usedCodepoints,
  exclude = undefined,
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

  function faceMatchesRequired(fam, styleSpec, weightSpec, stretchSpec) {
    if (!requiredIndex.has(fam)) return false;

    const need = requiredIndex.get(fam);
    const ws = parseWeightSpec(weightSpec);
    const ss = parseStyleSpec(styleSpec);
    const ts = parseStretchSpec(stretchSpec);

    const faceIsRange = ws.min !== ws.max;
    const faceSingleW = ws.min;

    const styleOK = (reqKind) => (
      (ss.kind === "normal" && reqKind === "normal") ||
      (ss.kind !== "normal" && (reqKind === "italic" || reqKind === "oblique"))
    );

    let exactMatched = false;

    for (const r of need) {
      const wOk = faceIsRange ? (r.w >= ws.min && r.w <= ws.max) : (r.w === faceSingleW);
      const sOk = styleOK(normStyle(r.s));
      const tOk = (r.st >= ts.min && r.st <= ts.max);

      if (wOk && sOk && tOk) {
        exactMatched = true;
        break;
      }
    }

    if (exactMatched) return true;

    if (!faceIsRange) {
      for (const r of need) {
        const sOk = styleOK(normStyle(r.s));
        const tOk = (r.st >= ts.min && r.st <= ts.max);
        const nearWeight = Math.abs(faceSingleW - r.w) <= 300;
        if (nearWeight && sOk && tOk) return true;
      }
    }

    return false;
  }

  const simpleExcluder = buildSimpleExcluder(exclude);

  const cacheKey = buildFontsCacheKey(required, exclude, localFonts, useProxy);
  if (cache.resource?.has(cacheKey)) {
    return cache.resource.get(cacheKey);
  }

  // ---- Ensure only likely @import font styles become reachable (<link>), avoid noise ----
  const requiredFamilies = familiesFromRequired(required);

  const importUrls = [];
  const IMPORT_ANY_RE_LOCAL = IMPORT_ANY_RE;

  for (const styleTag of document.querySelectorAll("style")) {
    const cssText = styleTag.textContent || "";
    for (const m of cssText.matchAll(IMPORT_ANY_RE_LOCAL)) {
      const u = (m[2] || m[4] || "").trim();
      if (!u || isIconFont(u)) continue;
      const hasLink = !!document.querySelector(`link[rel="stylesheet"][href="${u}"]`);
      if (!hasLink) importUrls.push(u);
    }
  }
  if (importUrls.length) {
    await Promise.all(importUrls.map((u) => new Promise((resolve) => {
      if (document.querySelector(`link[rel="stylesheet"][href="${u}"]`)) return resolve(null);
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
      if (isIconFont(link.href)) continue;

      let cssText = "";
      let sameOrigin = false;
      try { sameOrigin = new URL(link.href, location.href).origin === location.origin; } catch {}

      if (!sameOrigin) {
        if (!isLikelyFontStylesheet(link.href, requiredFamilies)) continue;
      }

      if (sameOrigin) {
        const sheet = Array.from(document.styleSheets).find(s => s.href === link.href);
        if (sheet) {
          try {
            const rules = sheet.cssRules || [];
            cssText = Array.from(rules).map(r => r.cssText).join("");
          } catch {
            // fallback to fetch below
          }
        }
      }

      if (!cssText) {
        const res = await snapFetch(link.href, { as: "text", useProxy });
        cssText = res.data;
        if (isIconFont(link.href)) continue;
      }

      // Flatten nested @import and rewrite relative urls per-level using link.href as base
      cssText = await inlineImportsAndRewrite(cssText, link.href, useProxy);

      let facesOut = "";
      for (const face of cssText.match(FACE_RE) || []) {
        const famRaw = (face.match(/font-family:\s*([^;]+);/i)?.[1] || "").trim();
        const family = pickPrimaryFamily(famRaw);
        if (!family || isIconFont(family)) continue;

        const weightSpec = (face.match(/font-weight:\s*([^;]+);/i)?.[1] || "400").trim();
        const styleSpec = (face.match(/font-style:\s*([^;]+);/i)?.[1] || "normal").trim();
        const stretchSpec = (face.match(/font-stretch:\s*([^;]+);/i)?.[1] || "100%").trim();
        const urange = (face.match(/unicode-range:\s*([^;]+);/i)?.[1] || "").trim();
        const srcRaw = (face.match(/src\s*:\s*([^;]+);/i)?.[1] || "").trim();
        const srcUrls = extractSrcUrls(srcRaw, link.href);

        if (!faceMatchesRequired(family, styleSpec, weightSpec, stretchSpec)) continue;
        const ranges = parseUnicodeRange(urange);
        if (!unicodeIntersects(usedCodepoints, ranges)) continue;

        const meta = { family, weightSpec, styleSpec, stretchSpec, unicodeRange: urange, srcRaw, srcUrls, href: link.href };
        if (exclude && simpleExcluder(meta, ranges)) continue;

        const newFace = /url\(/i.test(srcRaw)
          ? await inlineUrlsInCssBlock(face, link.href, useProxy)
          : face;
        facesOut += newFace;
      }

      if (facesOut.trim()) finalCSS += facesOut;
    } catch {
      console.warn("[snapDOM] Failed to process stylesheet:", link.href);
    }
  }

  // ---------- 2) CSSOM (inline/imported) ----------
  const ctx = {
    requiredIndex,
    usedCodepoints,
    faceMatchesRequired,
    simpleExcluder: exclude ? buildSimpleExcluder(exclude) : null,
    useProxy,
    visitedSheets: new Set(),
    depth: 0
  };

  for (const sheet of document.styleSheets) {
    if (sheet.href && linkNodes.some(l => l.href === sheet.href)) continue;
    try {
      const rootHref = sheet.href || location.href;
      if (rootHref) ctx.visitedSheets.add(rootHref);
      await collectFacesFromSheet(
        sheet,
        rootHref,
        async (faceCss) => { finalCSS += faceCss; },
        ctx
      );
    } catch {
      // cross-origin protected CSSOM; ignore (text pass already tried)
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
            const r = await snapFetch(f._snapdomSrc, { as: "dataURL", useProxy, silent: true });
            if (r.ok && typeof r.data === "string") {
              b64 = r.data;
              cache.resource?.set(f._snapdomSrc, b64);
              cache.font?.add(f._snapdomSrc);
            } else {
              continue;
            }
          } catch {
            console.warn("[snapDOM] Failed to fetch dynamic font src:", f._snapdomSrc);
            continue;
          }
        }
      }
      finalCSS += `@font-face{font-family:'${fam}';src:url(${b64});font-style:${f.style || "normal"};font-weight:${f.weight || "normal"};}`;
    }
  } catch {}

  // ---------- 4) user-provided localFonts ----------
  for (const font of localFonts) {
    if (!font || typeof font !== "object") continue;
    const family = String(font.family || "").replace(/^['"]+|['"]+$/g, "");
    if (!family || isIconFont(family)) continue;
    if (!requiredIndex.has(family)) continue;
    if (exclude?.families && exclude.families.some(n => String(n).toLowerCase() === family.toLowerCase())) continue;

    const weight = font.weight != null ? String(font.weight) : "normal";
    const style = font.style != null ? String(font.style) : "normal";
    const stretch = font.stretchPct != null ? `${font.stretchPct}%` : "100%";
    const src = String(font.src || "");

    let b64 = src;
    if (!b64.startsWith("data:")) {
      if (cache.resource?.has(src)) {
        b64 = cache.resource.get(src);
        cache.font?.add(src);
      } else if (!cache.font?.has(src)) {
        try {
          const r = await snapFetch(src, { as: "dataURL", useProxy, silent: true });
          if (r.ok && typeof r.data === "string") {
            b64 = r.data;
            cache.resource?.set(src, b64);
            cache.font?.add(src);
          } else {
            continue;
          }
        } catch {
          console.warn("[snapDOM] Failed to fetch localFonts src:", src);
          continue;
        }
      }
    }
    finalCSS += `@font-face{font-family:'${family}';src:url(${b64});font-style:${style};font-weight:${weight};font-stretch:${stretch};}`;
  }

  // ---------- Cache + return ----------
  if (finalCSS) {
    finalCSS = dedupeFontFaces(finalCSS);
    cache.resource?.set(cacheKey, finalCSS);
  }
  return finalCSS;
}

// ----------------------------------------------------------------------------
// Collectors for required variants and used codepoints
// ----------------------------------------------------------------------------

/**
 * Collects used font variants (family, weight, style, stretch) in subtree.
 * @param {Element} root
 * @returns {Set<string>} keys "family__weight__style__stretchPct"
 */
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
    const el = /** @type {Element} */ (tw.currentNode);
    const cs = getComputedStyle(el);
    addFromStyle(cs);
    const b = getComputedStyle(el, "::before");
    if (b && b.content && b.content !== "none") addFromStyle(b);
    const a = getComputedStyle(el, "::after");
    if (a && a.content && a.content !== "none") addFromStyle(a);
  }
  return req;
}

/**
 * Collects used codepoints in subtree (including ::before/::after content).
 * @param {Element} root
 * @returns {Set<number>}
 */
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
      const el = /** @type {Element} */ (n);
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
              try { used.add(parseInt(m.slice(1), 16)); } catch {}
            }
          }
        }
      }
    }
  }
  return used;
}

/**
 * Ensures web fonts are fully resolved before capture, with a Safari-friendly warm-up.
 * - Awaits document.fonts.ready
 * - Forces layout/rasterization for each family by painting hidden spans
 * - Optionally retries a couple of times if Safari is still lazy
 *
 * @param {Set<string>|string[]} families - Plain family names (e.g., "Mansalva", "Unbounded")
 * @param {number} [warmupRepetitions=2] - How many times to warm-up each family
 * @returns {Promise<void>}
 */
export async function ensureFontsReady(families, warmupRepetitions = 2) {
  try { await document.fonts.ready; } catch {}

  const fams = Array.from(families || []).filter(Boolean);
  if (fams.length === 0) return;

  const warmupOnce = () => {
    const container = document.createElement("div");
    container.style.cssText = "position:absolute!important;left:-9999px!important;top:0!important;opacity:0!important;pointer-events:none!important;contain:layout size style;";

    for (const fam of fams) {
      const span = document.createElement("span");
      span.textContent = "AaBbGg1234ÁÉÍÓÚçñ—∞";
      span.style.fontFamily = `"${fam}"`;
      span.style.fontWeight = "700";
      span.style.fontStyle = "italic";
      span.style.fontSize = "32px";
      span.style.lineHeight = "1";
      span.style.whiteSpace = "nowrap";
      span.style.margin = "0";
      span.style.padding = "0";
      container.appendChild(span);
    }

    document.body.appendChild(container);
    // Force layout
    // eslint-disable-next-line no-unused-expressions
    container.offsetWidth;
    document.body.removeChild(container);
  };

  for (let i = 0; i < Math.max(1, warmupRepetitions); i++) {
    warmupOnce();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  }
}
