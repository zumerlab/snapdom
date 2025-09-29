/**
 * Utilities for inlining ::before and ::after pseudo-elements.
 * @module pseudo
 */

import {
  getStyle,
  snapshotComputedStyle,
  parseContent,
  extractURL,
  safeEncodeURI,
  inlineSingleBackgroundEntry,
  splitBackgroundImage,
  getStyleKey
} from '../utils';
import { iconToImage } from '../modules/fonts.js';
import { isIconFont } from '../modules/iconFonts.js';
import {
  buildCounterContext,
  resolveCountersInContent,
  hasCounters
} from '../modules/counter.js';
import { snapFetch } from './snapFetch.js';

let counterCtx = null;

/** Acumulador de contadores por padre para propagar increments en pseudos entre hermanos */
const __siblingCounters = new WeakMap(); // parentElement -> Map<counterName, number>

/** Remove only enclosing double-quoted tokens from CSS content (keeps single quotes). */
function unquoteDoubleStrings(s) {
  return (s || '').replace(/"([^"]*)"/g, '$1');
}

/**
 * Concatena tokens de content (p.ej. `"1" "."`) sin introducir espacios.
 * Si no hay comillas, devuelve el unquote estándar.
 * @param {string} raw
 */
function collapseCssContent(raw) {
  if (!raw) return '';
  const tokens = [];
  const rx = /"([^"]*)"/g;
  let m;
  while ((m = rx.exec(raw))) tokens.push(m[1]);
  // Si hay tokens con comillas, concatenar sin espacios (comportamiento del browser)
  if (tokens.length) return tokens.join('');
  return unquoteDoubleStrings(raw);
}

/**
 * Crea un contexto base envuelto que aplica overrides de hermanos (si existen).
 * @param {Element} node
 * @param {{get:Function, getStack:Function}} base
 */
function withSiblingOverrides(node, base) {
  const parent = node.parentElement;
  const map = parent ? __siblingCounters.get(parent) : null;
  if (!map) return base;
  return {
    get(n, name) {
      const v = base.get(n, name);
      const ov = map.get(name);
      // usar el mayor (o el override si existe) para mantener secuencia
      return typeof ov === 'number' ? Math.max(v, ov) : v;
    },
    getStack(n, name) {
      const s = base.getStack(n, name);
      if (!s.length) return s;
      const ov = map.get(name);
      if (typeof ov === 'number') {
        const out = s.slice();
        out[out.length - 1] = Math.max(out[out.length - 1], ov);
        return out;
      }
      return s;
    }
  };
}

/**
 * Aplica counter-reset / counter-increment del pseudo *solo para este nodo*,
 * partiendo de un contexto base (ya envuelto con overrides de hermanos).
 * @param {Element} node
 * @param {CSSStyleDeclaration|null} pseudoStyle
 * @param {{get:Function, getStack:Function}} baseCtx
 */
function deriveCounterCtxForPseudo(node, pseudoStyle, baseCtx) {
  const modStacks = new Map();

  function parseListDecl(value) {
    const out = [];
    if (!value || value === 'none') return out;
    for (const part of String(value).split(',')) {
      const toks = part.trim().split(/\s+/);
      const name = toks[0];
      const num = Number.isFinite(Number(toks[1])) ? Number(toks[1]) : undefined;
      if (name) out.push({ name, num });
    }
    return out;
  }

  const resets = parseListDecl(pseudoStyle?.counterReset);
  const incs   = parseListDecl(pseudoStyle?.counterIncrement);

  function getStackDerived(name) {
    if (modStacks.has(name)) return modStacks.get(name).slice();
    let stack = baseCtx.getStack(node, name);
    stack = stack.length ? stack.slice() : [];

    // reset: push si hay stack, replace si no
    const r = resets.find(x => x.name === name);
    if (r) {
      const val = Number.isFinite(r.num) ? r.num : 0;
      stack = stack.length ? [...stack, val] : [val];
    }

    // increment: sobre el top, crear top=0 si no existe
    const inc = incs.find(x => x.name === name);
    if (inc) {
      const by = Number.isFinite(inc.num) ? inc.num : 1;
      if (stack.length === 0) stack = [0];
      stack[stack.length - 1] += by;
    }

    modStacks.set(name, stack.slice());
    return stack;
  }

  return {
    get(_node, name) {
      const s = getStackDerived(name);
      return s.length ? s[s.length - 1] : 0;
    },
    getStack(_node, name) {
      return getStackDerived(name);
    },
    /** expone increments del pseudo para que el caller pueda propagar a hermanos */
    __incs: incs
  };
}

/**
 * Resuelve el `content` del pseudo aplicando:
 * 1) overrides de hermanos (para continuidad entre siblings),
 * 2) reset/increment del pseudo,
 * 3) colapso de tokens `"..."` sin espacios intermedios.
 *
 * @param {Element} node
 * @param {'::before'|'::after'} pseudo
 * @param {{get:Function, getStack:Function}} baseCtx
 * @returns {{ text: string, incs: Array<{name:string,num:number|undefined}> }}
 */
function resolvePseudoContentAndIncs(node, pseudo, baseCtx) {
  let ps;
  try { ps = getComputedStyle(node, pseudo); } catch {}
  const raw = ps?.content;
  if (!raw || raw === 'none' || raw === 'normal') return { text: '', incs: [] };

  // 1) aplicar overrides de hermanos
  const baseWithSiblings = withSiblingOverrides(node, baseCtx);

  // 2) derivar (aplica reset/increment del pseudo)
  const derived = deriveCounterCtxForPseudo(node, ps, baseWithSiblings);

  // 3) resolver counter()/counters()
  let resolved = hasCounters(raw)
    ? resolveCountersInContent(raw, node, derived)
    : raw;

  // 4) colapsar tokens (quita espacios entre "1" "." -> "1.")
  const text = collapseCssContent(resolved);
  return { text, incs: derived.__incs || [] };
}

/**
 * Creates elements to represent ::before, ::after, and ::first-letter pseudo-elements, inlining their styles and content.
 *
 * @param {Element} source - Original element
 * @param {Element} clone - Cloned element
 * @param {Map} sessionCache - styleMap cache etc.
 * @param {Object} options - capture options
 * @returns {Promise<void>}
 */
export async function inlinePseudoElements(source, clone, sessionCache, options) {
  if (!(source instanceof Element) || !(clone instanceof Element)) return;

  // Build counters context once per document
  if (!counterCtx) {
    try {
      counterCtx = buildCounterContext(source.ownerDocument || document);
    } catch { /* noop */ }
  }

  for (const pseudo of ['::before', '::after', '::first-letter']) {
    try {
      const style = getStyle(source, pseudo);
      if (!style || typeof style[Symbol.iterator] !== 'function') continue;

      // Skip visually empty pseudo-elements early
      const isEmptyPseudo =
        style.content === 'none' &&
        style.backgroundImage === 'none' &&
        style.backgroundColor === 'transparent' &&
        (style.borderStyle === 'none' || parseFloat(style.borderWidth) === 0) &&
        (!style.transform || style.transform === 'none') &&
        style.display === 'inline';

      if (isEmptyPseudo) continue;

      if (pseudo === '::first-letter') {
        const normal = getComputedStyle(source);
        const isMeaningful =
          style.color !== normal.color ||
          style.fontSize !== normal.fontSize ||
          style.fontWeight !== normal.fontWeight;
        if (!isMeaningful) continue;

        const textNode = Array.from(clone.childNodes).find(
          (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim().length > 0
        );
        if (!textNode) continue;

        const text = textNode.textContent;
        const match = text.match(/^([^\p{L}\p{N}\s]*[\p{L}\p{N}](?:['’])?)/u);
        const first = match?.[0];
        const rest = text.slice(first?.length || 0);
        if (!first || /[\uD800-\uDFFF]/.test(first)) continue;

        const span = document.createElement('span');
        span.textContent = first;
        span.dataset.snapdomPseudo = '::first-letter';
        const snapshot = snapshotComputedStyle(style);
        const key = getStyleKey(snapshot, 'span');
        sessionCache.styleMap.set(span, key);

        const restNode = document.createTextNode(rest);
        clone.replaceChild(restNode, textNode);
        clone.insertBefore(span, restNode);
        continue;
      }

      // ---------- CONTENT (pseudo-aware counters + collapse tokens) ----------
      const rawContent = style.content;
      const { text: cleanContent, incs } =
        resolvePseudoContentAndIncs(source, pseudo, counterCtx);

      const bg = style.backgroundImage;
      const bgColor = style.backgroundColor;
      const fontFamily = style.fontFamily;
      const fontSize = parseInt(style.fontSize) || 32;
      const fontWeight = parseInt(style.fontWeight) || false;
      const color = style.color || '#000';
      const display = style.display;
      const width = parseFloat(style.width);
      const height = parseFloat(style.height);
      const borderStyle = style.borderStyle;
      const borderWidth = parseFloat(style.borderWidth);
      const transform = style.transform;

      const isIconFont2 = isIconFont(fontFamily);

      const hasExplicitContent = rawContent !== 'none' && cleanContent !== '';
      const hasBg = bg && bg !== 'none';
      const hasBgColor =
        bgColor && bgColor !== 'transparent' && bgColor !== 'rgba(0, 0, 0, 0)';
      const hasBox = display !== 'inline' && (width > 0 || height > 0);
      const hasBorder =
        borderStyle && borderStyle !== 'none' && borderWidth > 0;
      const hasTransform = transform && transform !== 'none';

           const shouldRender =
        hasExplicitContent || hasBg || hasBgColor || hasBorder || hasTransform;

      if (!shouldRender) {
        // Aun si no renderizamos caja, si el pseudo tenía increments, propagar a hermanos
        if (incs && incs.length && source.parentElement) {
          const map = __siblingCounters.get(source.parentElement) || new Map();
          // Para cada counter incrementado en el pseudo, guardar el valor resuelto final
          for (const { name, num } of incs) {
            if (!name) continue;
            // reconstruir valor final desde derived: volvemos a pedirlo
            // Usamos withSiblingOverrides + derive para ser consistentes
            const baseWithSibs = withSiblingOverrides(source, counterCtx);
            const derived = deriveCounterCtxForPseudo(source, getComputedStyle(source, pseudo), baseWithSibs);
            const finalVal = derived.get(source, name);
            map.set(name, finalVal);
          }
          __siblingCounters.set(source.parentElement, map);
        }
        continue;
      }

      const pseudoEl = document.createElement('span');
      pseudoEl.dataset.snapdomPseudo = pseudo;
      pseudoEl.style.verticalAlign = 'middle';
      pseudoEl.style.pointerEvents = 'none';
      const snapshot = snapshotComputedStyle(style);
      const key = getStyleKey(snapshot, 'span');
      sessionCache.styleMap.set(pseudoEl, key);

      // ---- Content handling (icon-font glyphs / url() / text) ----
      if (isIconFont2 && cleanContent && cleanContent.length === 1) {
        const { dataUrl, width: w, height: h } =
          await iconToImage(cleanContent, fontFamily, fontWeight, fontSize, color);
        const imgEl = document.createElement('img');
        imgEl.src = dataUrl;
        imgEl.style = `height:${fontSize}px;width:${(w / h) * fontSize}px;object-fit:contain;`;
        pseudoEl.appendChild(imgEl);
        clone.dataset.snapdomHasIcon = 'true';
      } else if (cleanContent && cleanContent.startsWith('url(')) {
        // content: url(...)
        const rawUrl = extractURL(cleanContent);
        if (rawUrl?.trim()) {
          try {
            const imgEl = document.createElement('img');
            const dataUrl = await snapFetch(safeEncodeURI(rawUrl), { as: 'dataURL', useProxy: options.useProxy });
            imgEl.src = dataUrl.data;
            imgEl.style = `width:${fontSize}px;height:auto;object-fit:contain;`;
            pseudoEl.appendChild(imgEl);
          } catch (e) {
            console.error(`[snapdom] Error in pseudo ${pseudo} for`, source, e);
          }
        }
      } else if (!isIconFont2 && hasExplicitContent) {
        pseudoEl.textContent = cleanContent; // <- ya sin espacios extra
      }

      // ---- Backgrounds / colors ----
           // Reset explícito para no heredar nada a menos que el pseudo lo defina
     pseudoEl.style.background = 'none';
     // Mask también reseteada por defecto (si tu pipeline soporta masks)
     if ('mask' in pseudoEl.style) {
       pseudoEl.style.mask = 'none';
     }
      if (hasBg) {
        try {
          const bgSplits = splitBackgroundImage(bg);
          const newBgParts = await Promise.all(bgSplits.map(inlineSingleBackgroundEntry));
          pseudoEl.style.backgroundImage = newBgParts.join(', ');
        } catch (e) {
          console.warn(`[snapdom] Failed to inline background-image for ${pseudo}`, e);
        }
      }
      if (hasBgColor) pseudoEl.style.backgroundColor = bgColor;

      const hasContent2 =
        pseudoEl.childNodes.length > 0 || (pseudoEl.textContent?.trim() !== '');
     const hasVisibleBox =
       hasContent2 || hasBg || hasBgColor || hasBorder || hasTransform;

      // Antes de insertar, si hubo increments en el pseudo, propagar valor final a los hermanos
      if (incs && incs.length && source.parentElement) {
        const map = __siblingCounters.get(source.parentElement) || new Map();
        const baseWithSibs = withSiblingOverrides(source, counterCtx);
        const derived = deriveCounterCtxForPseudo(source, getComputedStyle(source, pseudo), baseWithSibs);
        for (const { name } of incs) {
          if (!name) continue;
          const finalVal = derived.get(source, name);
          map.set(name, finalVal);
        }
        __siblingCounters.set(source.parentElement, map);
      }

      if (!hasVisibleBox) continue;

      if (pseudo === '::before') {
        clone.insertBefore(pseudoEl, clone.firstChild);
      } else {
        clone.appendChild(pseudoEl);
      }
    } catch (e) {
      console.warn(`[snapdom] Failed to capture ${pseudo} for`, source, e);
    }
  }

  // Recurse
  const sChildren = Array.from(source.children);
  const cChildren = Array.from(clone.children).filter((child) => !child.dataset.snapdomPseudo);
  for (let i = 0; i < Math.min(sChildren.length, cChildren.length); i++) {
    await inlinePseudoElements(sChildren[i], cChildren[i], sessionCache, options);
  }
}
