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

  return {
    name: 'agent-map',

    afterClone(ctx) {
      const meta = extractMap(
        ctx.element,
        interactiveSelector,
        semantic ? semanticSelector : null,
        fields
      );
      // snapdom's export ctx is a fresh spread of ctx.options, so we stash on
      // both for the agentMap() call below to find it.
      ctx.__agentMapMeta = meta;
      if (ctx.options) ctx.options.__agentMapMeta = meta;

      if (image === 'annotated') {
        addAnnotations(ctx.clone, meta.map, labelStyle);
      }
    },

    defineExports() {
      return {
        agentMap: async (ctx, opts = {}) => {
          const meta = ctx.__agentMapMeta;
          const wantImage = opts.image !== undefined ? opts.image : image;

          if (!meta || !meta.map.length) {
            const out = { dimensions: { width: 0, height: 0 }, map: [] };
            if (wantImage) out.image = ctx.export.url;
            return out;
          }

          const format = opts.imageFormat || imageFormat;
          const quality = opts.imageQuality || imageQuality;
          const maxWidth = opts.maxImageWidth || maxImageWidth;

          // Scale dimensions — whether we rasterize or not, bboxes get resized
          // to the target output size so callers can overlay them on the image.
          let w, h, dataURL;
          if (wantImage) {
            const img = new Image();
            img.src = ctx.export.url;
            await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
            const ratio = img.naturalWidth > maxWidth ? maxWidth / img.naturalWidth : 1;
            w = Math.round(img.naturalWidth * ratio);
            h = Math.round(img.naturalHeight * ratio);
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            const mime =
              format === 'jpg' || format === 'jpeg' ? 'image/jpeg'
              : format === 'webp' ? 'image/webp'
              : 'image/png';
            dataURL = canvas.toDataURL(mime, quality);
          } else {
            const sourceW = meta.dimensions.width || 1;
            const ratio = sourceW > maxWidth ? maxWidth / sourceW : 1;
            w = Math.round(sourceW * ratio);
            h = Math.round(meta.dimensions.height * ratio);
          }

          const sx = w / (meta.dimensions.width || 1);
          const sy = h / (meta.dimensions.height || 1);

          const scaledMap = meta.map.map(e => {
            const scaled = { ...e, b: [
              Math.round(e.b[0] * sx),
              Math.round(e.b[1] * sy),
              Math.round(e.b[2] * sx),
              Math.round(e.b[3] * sy),
            ] };
            return scaled;
          });

          const out = { dimensions: { width: w, height: h }, map: scaledMap };
          if (wantImage) out.image = dataURL;
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

function accessibleName(el) {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const root = el.getRootNode();
    const getById = (id) =>
      root && typeof root.getElementById === 'function'
        ? root.getElementById(id) : document.getElementById(id);
    const parts = labelledBy.trim().split(/\s+/)
      .map(id => { const r = getById(id); return r ? (r.textContent || '').trim() : ''; })
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
    const t = (el.labels[0].textContent || '').trim();
    if (t) return t;
  }

  const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
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
      s.value = el.value;
    }
  } else if (el.tagName === 'TEXTAREA') {
    if (el.value) s.value = el.value;
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

function extractMap(element, interactiveSelector, semanticSelector, fields) {
  const rootRect = element.getBoundingClientRect();
  const map = [];
  let i = 0;
  const tracked = new Set();

  for (const el of element.querySelectorAll(interactiveSelector)) {
    const entry = buildEntry(el, rootRect, i, fields, 'interactive');
    if (entry) { map.push(entry); tracked.add(el); i++; }
  }

  if (semanticSelector) {
    for (const el of element.querySelectorAll(semanticSelector)) {
      if (tracked.has(el)) continue;
      const entry = buildEntry(el, rootRect, i, fields, 'semantic');
      if (entry) { map.push(entry); i++; }
    }
  }

  return {
    map,
    dimensions: { width: rootRect.width, height: rootRect.height },
  };
}

function buildEntry(el, rootRect, i, fields, kind) {
  const rect = el.getBoundingClientRect();
  const b = [
    Math.round(rect.left - rootRect.left),
    Math.round(rect.top - rootRect.top),
    Math.round(rect.width),
    Math.round(rect.height),
  ];
  if (b[2] <= 0 && b[3] <= 0) return null;

  const role = deriveRole(el);
  const n = accessibleName(el);

  const entry = { i, n, r: role, b };

  if (kind === 'interactive') {
    const s = deriveState(el, role, rect);
    if (s) entry.s = s;
  }

  if (fields === 'full') {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
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
