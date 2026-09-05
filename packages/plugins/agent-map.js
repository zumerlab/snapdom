/**
 * agentMap – Official SnapDOM Plugin
 *
 * Produces a Set-of-Mark package for visual agents: an annotated screenshot
 * with numbered badges on interactive elements, plus a compact JSON map from
 * badge index → role / name / bbox / state. Designed for one-call capture
 * on the client side — visual agents, computer-use harnesses, dataset
 * generation for vision training, visual QA.
 *
 * Usage:
 *   import { agentMap } from '@zumer/snapdom-plugins/agent-map';
 *   const result = await snapdom(el, { plugins: [agentMap()] });
 *   const { image, map, dimensions } = await result.toAgentMap();
 *
 *   // model reply: "click element 2" → map[2].b gives [x, y, w, h]
 *
 * @param {Object} [options]
 * @param {'annotated'|'raw'|false} [options.image='annotated']  Image output
 *   mode. 'annotated' draws numbered badges on the rendered image, 'raw'
 *   returns the image without badges, false skips image generation (cheapest).
 * @param {'minimal'|'full'} [options.fields='minimal']  Per-entry shape.
 *   'minimal' returns {i, n, r, b, s?}. 'full' adds {t (text), a (attrs)}.
 * @param {boolean} [options.semantic=false]  Include non-interactive semantic
 *   elements (headings, paragraphs, nav, main, landmarks). Off by default —
 *   agents typically only act on interactive.
 * @param {number}  [options.maxImageWidth=1024]  Downscale target for the image.
 * @param {'png'|'jpg'|'webp'} [options.imageFormat='png']  Image format.
 * @param {number}  [options.imageQuality=0.8]  Quality for lossy formats.
 * @param {string}  [options.interactiveSelector]  CSS selector (default below).
 * @param {string}  [options.semanticSelector]  CSS selector (default below).
 * @param {Object}  [options.labelStyle={}]  Override badge styles.
 * @param {'clone'|'render'} [options.needs='render']  How far the capture runs.
 *   'clone' skips rendering entirely — requires image: false, and result.url throws.
 * @returns {Object} SnapDOM plugin
 */

const DEFAULT_INTERACTIVE =
  'a[href], button, input, select, textarea, ' +
  '[role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="switch"], [role="slider"], [role="combobox"], [role="textbox"], ' +
  '[tabindex]:not([tabindex="-1"]), summary, [contenteditable="true"]';

const DEFAULT_SEMANTIC =
  'h1, h2, h3, h4, h5, h6, nav, main, article, section, header, footer, ' +
  'figcaption, blockquote, legend, p';

export function agentMap(options = {}) {
  const {
    image = 'annotated',
    fields = 'minimal',
    semantic = false,
    maxImageWidth = 1024,
    imageFormat = 'png',
    imageQuality = 0.8,
    interactiveSelector = DEFAULT_INTERACTIVE,
    semanticSelector = DEFAULT_SEMANTIC,
    labelStyle = {},
  } = options;

  // `needs` names how far the capture has to run. Default 'render': dropping the image is
  // the caller's call. The two rejections below are cases core cannot catch — without
  // them the caller gets an EMPTY map, or a late error, instead of the reason.
  const needs = options.needs ?? 'render';
  // The map is read in afterClone: with no clone there is no map, only a plausible-looking
  // empty one.
  if (needs !== 'clone' && needs !== 'render') {
    throw new Error(`[snapdom] agent-map cannot run at stage '${needs}': it supports clone, render`);
  }
  // A capture with no render can never carry an image, and asking for both is a
  // contradiction the caller should hear now, not at export time.
  if (needs === 'clone' && image !== false) {
    throw new Error("[snapdom] agent-map: needs: 'clone' produces no image — pass image: false, or needs: 'render'");
  }

  return {
    name: 'agent-map',
    needs,

    afterClone(ctx) {
      const meta = extractMap(
        ctx.element,
        interactiveSelector,
        semantic ? semanticSelector : null,
        fields,
        // The capture's ONE exclusion policy (src/core/context.js). Absent only when a
        // caller drives the hook with a hand-built context.
        typeof ctx.shouldExclude === 'function' ? ctx.shouldExclude : NEVER,
        ctx.outerTransforms
      );
      meta.labelStyle = { ...labelStyle };
      ctx.__agentMapMeta = meta;
    },

    defineExports(capture) {
      return {
        agentMap: async (ctx, opts = {}) => {
          const meta = ctx.__agentMapMeta;
          const wantImage = opts.image !== undefined ? opts.image : image;
          if (!meta) throw new Error('[snapdom] agent-map: this capture carries no frozen map.');

          const format = opts.imageFormat || imageFormat;
          const quality = opts.imageQuality ?? imageQuality;
          const maxWidth = opts.maxImageWidth ?? maxImageWidth;
          const geometry = ctx.meta;
          const sourceW = geometry?.vbW || meta.dimensions.width || 1;
          const sourceH = geometry?.vbH || meta.dimensions.height || 1;
          const hasW = Number.isFinite(opts.width), hasH = Number.isFinite(opts.height);
          let w = hasW ? opts.width : hasH ? opts.height * sourceW / sourceH : sourceW * (opts.scale ?? 1);
          let h = hasH ? opts.height : hasW ? opts.width * sourceH / sourceW : sourceH * (opts.scale ?? 1);
          w *= opts.dpr ?? 1;
          h *= opts.dpr ?? 1;
          const ratio = w > maxWidth ? maxWidth / w : 1;
          w = Math.max(1, Math.round(w * ratio));
          h = Math.max(1, Math.round(h * ratio));
          const sx = w / sourceW, sy = h / sourceH;
          const dx = (geometry?.contentX || 0) - (geometry?.clip?.x || 0);
          const dy = (geometry?.contentY || 0) - (geometry?.clip?.y || 0);
          const frame = geometry ? meta.frame : { x: 0, y: 0, sx: 1, sy: 1 };

          const scaledMap = meta.map.map(e => {
            const scaled = { ...e, b: [
              Math.round((e.b[0] * frame.sx + frame.x + dx) * sx),
              Math.round((e.b[1] * frame.sy + frame.y + dy) * sy),
              Math.round(e.b[2] * frame.sx * sx),
              Math.round(e.b[3] * frame.sy * sy),
            ] };
            if (e.s) scaled.s = { ...e.s };
            if (e.a) scaled.a = { ...e.a };
            return scaled;
          });

          const out = { dimensions: { width: w, height: h }, map: scaledMap };
          if (wantImage) {
            // Core owns Safari drawing and restoration of compressed originals. Decode at
            // the original aspect ratio first; Firefox letterboxes an SVG decoded with a
            // different width/height ratio. Only the finished bitmap is stretched below.
            const density = Math.max(sx, sy);
            const opaque = format === 'jpg' || format === 'jpeg' || format === 'webp';
            const backgroundColor = opaque && (opts.backgroundColor == null || opts.backgroundColor === 'transparent')
              ? '#ffffff' : opts.backgroundColor;
            const source = await capture.exports.canvas({ width: sourceW * density, height: null,
              scale: 1, dpr: 1, canvas: null, crop: null, backgroundColor });
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const draw = canvas.getContext('2d');
            draw.drawImage(source, 0, 0, w, h);
            if (wantImage === 'annotated' && scaledMap.some(e => !e.isSemanticOnly)) {
              // Badges belong to this export, not the frozen base image: raw/annotated
              // overrides and later exports must never inherit another call's overlay.
              const layer = document.createElement('div');
              layer.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
              layer.style.cssText = `width:${w}px;height:${h}px;`;
              addAnnotations(layer, scaledMap, meta.labelStyle);
              const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%">${new XMLSerializer().serializeToString(layer)}</foreignObject></svg>`;
              const overlay = new Image();
              overlay.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
              await overlay.decode();
              draw.drawImage(overlay, 0, 0);
            }
            const mime = format === 'jpg' || format === 'jpeg' ? 'image/jpeg'
              : format === 'webp' ? 'image/webp' : 'image/png';
            out.image = canvas.toDataURL(mime, quality);
          }
          return out;
        },
      };
    },
  };
}

/* ── Role derivation ────────────────────────────── */

function deriveRole(el) {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  const type = (el.type || '').toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a' && el.hasAttribute('href')) return 'link';
  if (tag === 'input') {
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'range') return 'slider';
    if (type === 'file') return 'file';
    if (type === 'submit' || type === 'button' || type === 'reset' || type === 'image') return 'button';
    return 'textbox';
  }
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'summary') return 'button';
  if (tag === 'details') return 'group';
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'nav') return 'navigation';
  if (tag === 'main') return 'main';
  if (tag === 'header') return 'banner';
  if (tag === 'footer') return 'contentinfo';
  if (tag === 'article') return 'article';
  if (tag === 'section') return 'region';
  if (tag === 'p') return 'paragraph';
  if (tag === 'img') return 'image';
  return tag;
}

/* ── Accessible name ────────────────────────────── */

function accessibleName(el, textOf) {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const root = el.getRootNode();
    const getById = (id) =>
      root && typeof root.getElementById === 'function'
        ? root.getElementById(id) : document.getElementById(id);
    const parts = labelledBy.trim().split(/\s+/)
      .map(id => { const r = getById(id); return r ? textOf(r).trim() : ''; })
      .filter(Boolean);
    if (parts.length) return parts.join(' ');
  }

  if (el.tagName === 'IMG' || (el.tagName === 'INPUT' && (el.type || '').toLowerCase() === 'image')) {
    const alt = el.getAttribute('alt');
    if (alt && alt.trim()) return alt.trim();
  }

  const title = el.getAttribute('title');
  if (title && title.trim()) return title.trim();

  if (el.labels && el.labels[0]) {
    const t = textOf(el.labels[0]).trim();
    if (t) return t;
  }

  const text = textOf(el).replace(/\s+/g, ' ').trim();
  if (text) return text.length > 60 ? text.slice(0, 59) + '…' : text;
  return '';
}

/* ── State extraction ───────────────────────────── */

/**
 * Builds the `s` (state) object. Only meaningful states — never default
 * values that add no signal for an agent. Critically, aria-expanded and
 * aria-pressed are included for BOTH values (true and false) because
 * "pressed: false" on a toggle is meaningful information.
 */

/* Sensitive-input guard (self-contained: this package publishes standalone).
 * Secrets are EXCLUDED, never truncated — a truncated password is still a leak. */
const SENSITIVE_AC = new Set(['current-password', 'new-password', 'one-time-code']);
function isSensitiveInput(el) {
  if (!el || el.tagName !== 'INPUT') return false;
  const type = (el.getAttribute('type') || 'text').toLowerCase();
  if (type === 'password' || type === 'email' || type === 'tel') return true;
  const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
  if (!ac) return false;
  for (const token of ac.split(/\s+/)) {
    if (SENSITIVE_AC.has(token) || token.startsWith('cc-')) return true;
  }
  return false;
}
function maskedValue(value) {
  return '\u2022'.repeat(Math.min(String(value ?? '').length, 12));
}

function deriveState(el, role, rect) {
  const s = {};

  try {
    if (el.matches(':checked')) s.checked = true;
    else if (role === 'checkbox' || role === 'radio') {
      // include checked:false for form groups where an agent needs to
      // know "unchecked" is a valid state distinct from "not a checkbox".
      s.checked = false;
    }
    if (el.matches(':disabled')) s.disabled = true;
    if (el.matches(':focus')) s.focus = true;
  } catch { /* exotic nodes */ }

  const expanded = el.getAttribute('aria-expanded');
  if (expanded === 'true') s.expanded = true;
  else if (expanded === 'false') s.expanded = false;

  const pressed = el.getAttribute('aria-pressed');
  if (pressed === 'true') s.pressed = true;
  else if (pressed === 'false') s.pressed = false;

  const selected = el.getAttribute('aria-selected');
  if (selected === 'true') s.selected = true;
  else if (selected === 'false' && (role === 'tab' || role === 'option')) s.selected = false;

  if (el.tagName === 'INPUT') {
    const type = (el.type || 'text').toLowerCase();
    if (type !== 'checkbox' && type !== 'radio' && type !== 'submit' && type !== 'button' && type !== 'reset' && el.value) {
      // Sensitive inputs (password/email/tel/cc-*): value NEVER emitted, in any field.
      // Remaining inputs: masked by default — the agent learns "field has content"
      // without the output carrying user data.
      if (!isSensitiveInput(el)) {
        s.value = maskedValue(el.value);
        s.hasValue = true;
      }
    }
  } else if (el.tagName === 'TEXTAREA') {
    if (el.value) { s.value = maskedValue(el.value); s.hasValue = true; }
  } else if (el.tagName === 'SELECT') {
    s.value = el.value;
    const opt = el.options && el.options[el.selectedIndex];
    if (opt) s.selectedText = opt.text || '';
  } else if (el.tagName === 'DETAILS') {
    s.open = !!el.open;
  }

  // Covered — element visually occluded by something else at its center.
  if (rect && rect.width && rect.height) {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    if (cx >= 0 && cy >= 0) {
      const doc = el.ownerDocument || document;
      if (doc.elementFromPoint) {
        const top = doc.elementFromPoint(cx, cy);
        if (top && top !== el && !(el.contains && el.contains(top))) {
          s.covered = true;
        }
      }
    }
  }

  return Object.keys(s).length ? s : null;
}

/* ── Map extraction ─────────────────────────────── */

const NEVER = () => false;

/** What actually paints under `el`, mirroring deepClone: a <slot> renders its assigned
 *  elements, and an open shadow root renders in place of the host's light children —
 *  except unassigned ones, which core clones after the shadow fragment. */
function renderedChildren(el) {
  if (el.localName === 'slot') {
    const assigned = el.assignedElements?.({ flatten: true }) || [];
    return assigned.length ? assigned : el.children;
  }
  const sr = el.shadowRoot;
  if (!sr) return el.children;
  const slotted = new Set();
  for (const s of sr.querySelectorAll('slot')) for (const n of s.assignedElements()) slotted.add(n);
  return [...sr.children, ...Array.from(el.children).filter((c) => !slotted.has(c))];
}

function extractMap(element, interactiveSelector, semanticSelector, fields, shouldExclude, outerTransforms) {
  const rootRect = element.getBoundingClientRect();
  const map = [];
  let i = 0;
  const tracked = new Set();

  // Names/full text must obey the same redaction boundary as the entry walk. Plain
  // textContent resurrects excluded descendants, and textarea defaults bypass masked
  // state. Referenced labels may also live under an excluded ancestor outside this root.
  const textOf = (el) => {
    for (let ancestor = el; ancestor; ancestor = ancestor.parentElement || ancestor.getRootNode()?.host) {
      if (shouldExclude(ancestor)) return '';
    }
    const read = (node) => {
      if (node.nodeType === 3) return node.nodeValue || '';
      if (node.nodeType !== 1 || node.tagName === 'TEXTAREA' || shouldExclude(node)) return '';
      return Array.from(node.childNodes, read).join('');
    };
    return read(el);
  };

  // querySelectorAll never matches the root and never crosses a shadow boundary, so a
  // capture root that IS a button, and every shadow-DOM control, were missing from the
  // map while both render in the image. Walk what core clones instead, and prune excluded
  // subtrees so a redacted node cannot come back as an actionable badge.
  const els = [];
  const visit = (el) => {
    if (shouldExclude(el)) return;
    els.push(el);
    for (const c of renderedChildren(el)) visit(c);
  };
  visit(element);

  for (const el of els) {
    if (!el.matches(interactiveSelector)) continue;
    const entry = buildEntry(el, rootRect, i, fields, 'interactive', textOf);
    if (entry) { map.push(entry); tracked.add(el); i++; }
  }

  if (semanticSelector) {
    for (const el of els) {
      if (tracked.has(el) || !el.matches(semanticSelector)) continue;
      const entry = buildEntry(el, rootRect, i, fields, 'semantic', textOf);
      if (entry) { map.push(entry); i++; }
    }
  }

  return {
    map,
    dimensions: { width: rootRect.width, height: rootRect.height },
    frame: captureFrame(element, rootRect, outerTransforms),
  };
}

// gBCR starts at the transformed bounding box; render meta starts at the root's
// pre-transform origin. Freeze that offset with the map, including individual transforms.
// Ancestor rotation/perspective and stripping a root rotation cannot be reconstructed from
// axis-aligned source rectangles; those cases still need a capture-space geometry API.
function captureFrame(element, rect, outerTransforms = true) {
  const css = getComputedStyle(element);
  const w = element.offsetWidth || parseFloat(css.width) || rect.width;
  const h = element.offsetHeight || parseFloat(css.height) || rect.height;
  // Core keeps scale/skew but anchors the clone at 0 0 when outer transforms are stripped.
  const [ox, oy] = outerTransforms !== false ? css.transformOrigin.split(/\s+/).map(parseFloat) : [0, 0];
  const scale = css.scale && css.scale !== 'none' ? css.scale.split(/\s+/).map(Number) : [1];
  const rotation = css.rotate && css.rotate !== 'none' ? css.rotate.split(/\s+/) : ['0deg'];
  const angleText = rotation.pop();
  const angle = parseFloat(angleText) * (angleText.endsWith('turn') ? 360
    : angleText.endsWith('grad') ? 0.9 : angleText.endsWith('rad') ? 180 / Math.PI : 1);
  const axis = rotation.length === 3 ? rotation.map(Number)
    : rotation.length ? ['x', 'y', 'z'].map(name => Number(name === rotation[0])) : [0, 0, 1];
  // Firefox marks rotateAxisAngle as 3D even around z, so keep the ordinary 2D path.
  const rotationMatrix = !axis[0] && !axis[1] ? new DOMMatrix().rotate(Math.sign(axis[2]) * angle)
    : new DOMMatrix().rotateAxisAngle(...axis, angle);
  const matrix = rotationMatrix.scale(scale[0], scale[1] ?? scale[0], scale[2] ?? 1)
    .multiply(new DOMMatrix(css.transform === 'none' ? undefined : css.transform));
  if (!matrix.is2D) return { x: 0, y: 0, sx: 1, sy: 1 };
  const corners = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => ({
    x: (x - ox) * matrix.a + (y - oy) * matrix.c + ox,
    y: (x - ox) * matrix.b + (y - oy) * matrix.d + oy,
  }));
  const x = Math.min(...corners.map(p => p.x)), y = Math.min(...corners.map(p => p.y));
  return { x, y,
    sx: rect.width ? (Math.max(...corners.map(p => p.x)) - x) / rect.width : 1,
    sy: rect.height ? (Math.max(...corners.map(p => p.y)) - y) / rect.height : 1 };
}

function buildEntry(el, rootRect, i, fields, kind, textOf) {
  const rect = el.getBoundingClientRect();
  // The annotation pass filters on this flag — without it, semantic:true put badges
  // on headings/paragraphs (the filter was a no-op because nothing ever set it).
  // Kept in the output so consumers can distinguish actables from context entries.
  const b = [
    Math.round(rect.left - rootRect.left),
    Math.round(rect.top - rootRect.top),
    Math.round(rect.width),
    Math.round(rect.height),
  ];
  if (b[2] <= 0 && b[3] <= 0) return null;

  const role = deriveRole(el);
  const n = accessibleName(el, textOf);

  const entry = { i, n, r: role, b };
  if (kind === 'semantic') entry.isSemanticOnly = true;

  if (kind === 'interactive') {
    const s = deriveState(el, role, rect);
    if (s) entry.s = s;
  }

  if (fields === 'full') {
    const t = textOf(el).replace(/\s+/g, ' ').trim();
    if (t && t !== n) entry.t = t.length > 160 ? t.slice(0, 159) + '…' : t;
    const a = {};
    for (const name of ['href', 'type', 'name', 'placeholder', 'alt', 'title', 'role', 'aria-label']) {
      const v = el.getAttribute(name);
      if (v && v !== 'false') a[name] = v;
    }
    if (Object.keys(a).length) entry.a = a;
  }

  return entry;
}

/* ── Annotations ────────────────────────────────── */

function addAnnotations(clone, entries, customStyle) {
  const interactive = entries.filter(e => !e.isSemanticOnly);
  if (!interactive.length) return;

  const overlay = document.createElement('div');
  overlay.setAttribute('data-snap-agent-overlay', 'true');
  Object.assign(overlay.style, {
    position: 'absolute',
    top: '0', left: '0', width: '100%', height: '100%',
    pointerEvents: 'none',
    zIndex: '2147483647',
    overflow: 'visible',
  });

  for (const e of interactive) {
    const badge = document.createElement('span');
    badge.textContent = String(e.i);
    const cx = e.b[0] + e.b[2] / 2;
    const cy = e.b[1] + e.b[3] / 2;
    Object.assign(badge.style, {
      position: 'absolute',
      left: cx + 'px', top: cy + 'px',
      transform: 'translate(-50%, -50%)',
      minWidth: '18px', height: '18px',
      lineHeight: '18px', fontSize: '11px', fontWeight: '700',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: '#fff', backgroundColor: 'rgba(220, 38, 38, 0.92)',
      borderRadius: '9px', textAlign: 'center', padding: '0 4px',
      boxSizing: 'border-box', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      ...customStyle,
    });
    overlay.appendChild(badge);
  }

  clone.style.position = 'relative';
  clone.appendChild(overlay);
}
