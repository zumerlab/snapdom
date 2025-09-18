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
import { snapFetch } from './snapFetch.js';


let counterCtx = null;

const RX_COUNTER_FN = /\b(counter|counters)\s*\(([^)]+)\)/g;
function unquoteDoubleStrings(s) {
  // Replace every CSS string token "..." with its raw content (keeps single quotes)
  return s.replace(/"([^"]*)"/g, '$1');
}


function alpha(n, upper=false) {
  let s = "", x = Math.max(1, n);
  while (x > 0) { x--; s = String.fromCharCode(97 + (x % 26)) + s; x = Math.floor(x / 26); }
  return upper ? s.toUpperCase() : s;
}

function roman(n, upper=true) {
  const map = [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
  let num = Math.max(1, Math.min(3999, n)), out = '';
  for (const [v, sym] of map) while (num >= v) { out += sym; num -= v; }
  return upper ? out : out.toLowerCase();
}

function formatCounter(value, style) {
  switch ((style||'decimal').toLowerCase()) {
    case 'decimal': return String(Math.max(0, value));
    case 'decimal-leading-zero': return (value < 10 ? '0' : '') + String(Math.max(0, value));
    case 'lower-alpha': return alpha(value, false);
    case 'upper-alpha': return alpha(value, true);
    case 'lower-roman': return roman(value, false);
    case 'upper-roman': return roman(value, true);
    default: return String(Math.max(0, value));
  }
}

function buildCounterContext(root) {
  // Map<Element, Map<string, number[]>>  ← pila por contador en cada nodo
  const nodeCounters = new WeakMap();
  const rootEl = (root instanceof Document) ? root.documentElement : root;

  const isLi = (el) => el && el.tagName === 'LI';
  const countPrevLi = (li) => {
    let c = 0, p = li?.parentElement;
    if (!p) return 0;
    for (const sib of p.children) { if (sib === li) break; if (sib.tagName === 'LI') c++; }
    return c;
  };
  const cloneMap = (m) => {
    const out = new Map();
    for (const [k, arr] of m) out.set(k, arr.slice());
    return out;
  };

  // Aplica reset/increment/list-item sobre un mapa base, usando parentMap para decidir push vs replace
  const applyTo = (baseMap, parentMap, el) => {
    const map = cloneMap(baseMap);

    // counter-reset: si el padre tiene ese contador → push; si no → replace
    let reset;
    try { reset = el.style?.counterReset || getComputedStyle(el).counterReset; } catch {}
    if (reset && reset !== 'none') {
      for (const part of reset.split(',')) {
        const toks = part.trim().split(/\s+/);
        const name = toks[0];
        const val = Number.isFinite(Number(toks[1])) ? Number(toks[1]) : 0;
        if (!name) continue;

        const parentStack = parentMap.get(name);               // pila heredada del PADRE
        if (parentStack && parentStack.length) {
          // anidar sobre la pila del padre
          const s = parentStack.slice();
          s.push(val);
          map.set(name, s);
        } else {
          // reemplazar cualquier estado arrastrado entre hermanos
          map.set(name, [val]);
        }
      }
    }

    // counter-increment: suma al tope (crea top=0 si no existe)
    let inc;
    try { inc = el.style?.counterIncrement || getComputedStyle(el).counterIncrement; } catch {}
    if (inc && inc !== 'none') {
      for (const part of inc.split(',')) {
        const toks = part.trim().split(/\s+/);
        const name = toks[0];
        const by = Number.isFinite(Number(toks[1])) ? Number(toks[1]) : 1;
        if (!name) continue;
        const stack = map.get(name) || [];
        if (stack.length === 0) stack.push(0);
        stack[stack.length - 1] += by;
        map.set(name, stack);
      }
    }

    // list-item simple (OL/UL) con start y li[value]
    try {
      const cs = getComputedStyle(el);
      if (cs.display === 'list-item' && isLi(el)) {
        const p = el.parentElement;
        let idx = 1;
        if (p && p.tagName === 'OL') {
          const startAttr = p.getAttribute('start');
          const start = Number.isFinite(Number(startAttr)) ? Number(startAttr) : 1;
          const prev = countPrevLi(el);
          const ownAttr = el.getAttribute('value');
          idx = Number.isFinite(Number(ownAttr)) ? Number(ownAttr) : (start + prev);
        } else {
          idx = 1 + countPrevLi(el);
        }
        const s = map.get('list-item') || [];
        if (s.length === 0) s.push(0);
        s[s.length - 1] = idx;
        map.set('list-item', s);
      }
    } catch {}

    return map;
  };

  // Construye recursivo con (parentMap, carryMap)
  const build = (el, parentMap, carryMap) => {
    // mapa del propio elemento: aplicar sobre el estado ARRASTRADO, decidiendo con el mapa del PADRE
    const curr = applyTo(carryMap, parentMap, el);
    nodeCounters.set(el, curr);

    // hijos: el primer hijo parte de curr; cada siguiente parte del mapa que dejó el hermano anterior
    let nextCarry = curr;
    for (const child of el.children) {
      const childCarry = build(child, curr, nextCarry);
      nextCarry = childCarry;
    }
    // devolver curr para que el siguiente hermano del *mismo nivel* arranque desde acá
    return curr;
  };

  const empty = new Map();
  build(rootEl, empty, empty);

  return {
    get(node, name) {
      const s = nodeCounters.get(node)?.get(name);
      return s && s.length ? s[s.length - 1] : 0;
    },
    getStack(node, name) {
      const s = nodeCounters.get(node)?.get(name);
      return s ? s.slice() : [];
    }
  };
}



function resolveCountersInContent(raw, node, ctx) {
  if (!raw || raw === 'none') return raw;
  try {
    let out = raw.replace(RX_COUNTER_FN, (_, fn, args) => {
      const parts = args.split(',').map(s => s.trim());
      if (fn === 'counter') {
        const name = parts[0]?.replace(/^["']|["']$/g, '');
        const style = (parts[1] || 'decimal').toLowerCase();
        const v = ctx.get(node, name);
        return formatCounter(v, style);
      } else { // counters(name, sep, style?)
        const name = parts[0]?.replace(/^["']|["']$/g, '');
        const sep  = (parts[1]?.replace(/^["']|["']$/g, '')) ?? '';
        const style = (parts[2] || 'decimal').toLowerCase();
        const stack = ctx.getStack(node, name);
        // empty stack → empty string (no "0", no trailing sep)
        if (!stack.length) return '';
        const pieces = stack.map(v => formatCounter(v, style));
        return pieces.join(sep);
      }
    });
    // remove CSS double-quoted string tokens: " … " →  …
    out = unquoteDoubleStrings(out);
    return out;
  } catch {
    return "- ";
  }
}


/**
 * Creates elements to represent ::before, ::after, and ::first-letter pseudo-elements, inlining their styles and content.
 *
 * @param {Element} source - Original element
 * @param {Element} clone - Cloned element
 * @param {boolean} embedFonts - Whether to embed icon fonts as images
 * @returns {Promise} Promise that resolves when all pseudo-elements are processed
 */

export async function inlinePseudoElements(source, clone, sessionCache, options) {
  if (!(source instanceof Element) || !(clone instanceof Element)) return;

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

      const content = style.content;
      
      let cleanContent = parseContent(content);
if (/\bcounter\s*\(|\bcounters\s*\(/.test(content)) {
  counterCtx = buildCounterContext(source.ownerDocument || document);
  cleanContent = resolveCountersInContent(cleanContent, source, counterCtx);
}



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

      const hasExplicitContent = content !== 'none' && cleanContent !== '';
      const hasBg = bg && bg !== 'none';
      const hasBgColor =
        bgColor && bgColor !== 'transparent' && bgColor !== 'rgba(0, 0, 0, 0)';
      const hasBox = display !== 'inline' && (width > 0 || height > 0);
      const hasBorder =
        borderStyle && borderStyle !== 'none' && borderWidth > 0;
      const hasTransform = transform && transform !== 'none';

      const shouldRender =
        hasExplicitContent || hasBg || hasBgColor || hasBox || hasBorder || hasTransform;

      if (!shouldRender) continue;

      const pseudoEl = document.createElement('span');
      pseudoEl.dataset.snapdomPseudo = pseudo;
      pseudoEl.style.verticalAlign = 'middle'
      const snapshot = snapshotComputedStyle(style);
      const key = getStyleKey(snapshot, 'span');
      sessionCache.styleMap.set(pseudoEl, key);

      if (isIconFont2 && cleanContent.length === 1) {
        const { dataUrl, width, height } = await iconToImage(cleanContent, fontFamily, fontWeight, fontSize, color);
        const imgEl = document.createElement("img");
        imgEl.src = dataUrl;
        imgEl.style = `height:${fontSize}px;width:${(width / height) * fontSize}px;object-fit:contain;`;
        pseudoEl.appendChild(imgEl);
        clone.dataset.snapdomHasIcon = "true";
      } else if (cleanContent.startsWith('url(')) {
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
        pseudoEl.textContent = cleanContent;
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
        hasContent2 || hasBg || hasBgColor || hasBox || hasBorder || hasTransform;

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

  const sChildren = Array.from(source.children);
  const cChildren = Array.from(clone.children).filter((child) => !child.dataset.snapdomPseudo);
  for (let i = 0; i < Math.min(sChildren.length, cChildren.length); i++) {
    await inlinePseudoElements(sChildren[i], cChildren[i], sessionCache, options);
  }
}

