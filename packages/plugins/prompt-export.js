/**
 * promptExport – Official SnapDOM Plugin
 * Produces an LLM-ready package: annotated screenshot + structured element
 * map + prompt text. Tuned for vision-capable LLMs reading the image + map
 * together (Set-of-Mark pattern).
 *
 * Usage:
 *   import { promptExport } from '@zumer/snapdom-plugins/prompt-export';
 *   const result = await snapdom(el, { plugins: [promptExport()] });
 *   const { image, elements, dimensions, prompt } = await result.toPrompt();
 *
 * @param {Object} [options]
 * @param {boolean}  [options.annotate=true]        - Overlay numbered badges on interactive elements
 * @param {string}   [options.imageFormat='png']    - Output image format ('png'|'jpg'|'webp')
 * @param {number}   [options.imageQuality=0.8]     - Quality for lossy formats (0..1)
 * @param {number}   [options.maxImageWidth=1024]   - Max width in px (downscales if larger)
 * @param {string}   [options.interactiveSelector]  - Custom CSS selector for interactive elements
 * @param {string}   [options.semanticSelector]     - Custom CSS selector for semantic elements
 * @param {Object}   [options.labelStyle={}]        - Override styles for annotation badges
 * @param {'compact'|'verbose'} [options.promptMode='compact']  - Prompt text verbosity
 * @param {boolean}  [options.includeCoords=true]   - Include bbox in the prompt text
 * @param {string[]} [options.include]              - Which fields to return. Default
 *   ['elements', 'prompt']. For vision-dependent tasks (chart content, layout QA,
 *   canvas) pass ['image', 'elements', 'prompt'] or add 'image' to the array. For
 *   text-only agent prompts pass ['prompt'] (cheapest — skips canvas draw entirely).
 *   Accepted values: 'image', 'elements', 'prompt'.
 * @returns {Object} SnapDOM plugin
 */

const DEFAULT_INTERACTIVE =
  'a[href], button, input, select, textarea, ' +
  '[role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], ' +
  '[tabindex]:not([tabindex="-1"]), summary, [contenteditable="true"]';

const DEFAULT_SEMANTIC =
  'h1, h2, h3, h4, h5, h6, p, li, img[alt], nav, main, article, section, ' +
  'header, footer, label, td, th, figcaption, blockquote, legend';

const COLLECTED_ATTRS = [
  'role', 'aria-label', 'aria-expanded', 'aria-checked', 'aria-disabled',
  'alt', 'href', 'placeholder', 'name', 'type', 'value', 'title', 'disabled',
];

const VISUAL_FIELDS = [
  'display', 'visibility', 'opacity',
  'color', 'backgroundColor',
  'fontSize', 'fontWeight',
  'cursor', 'overflow',
];

// Common computed-style values that carry no information. Keeping the
// `styles` object small is the difference between a useful LLM input and
// token bloat on every element.
const VISUAL_SKIP = new Set(['initial', 'normal', 'visible', 'auto', 'static', '0']);
function isDefaultStyleValue(prop, value) {
  if (!value) return true;
  if (VISUAL_SKIP.has(value)) return true;
  if (prop === 'cursor' && value === 'none') return true;
  if (prop === 'color' && value === 'rgb(0, 0, 0)') return true;
  if (prop === 'backgroundColor' && value === 'rgba(0, 0, 0, 0)') return true;
  if (prop === 'fontWeight' && (value === '400' || value === 'normal')) return true;
  if (prop === 'opacity' && value === '1') return true;
  return false;
}

// Default omits 'image'. Benchmarking showed the text + JSON map is enough
// to answer most UI-inspection questions and uses ~14× fewer tokens. Pass
// `include: ['image', 'elements', 'prompt']` explicitly when the task truly
// depends on vision (charts, canvas content, layout QA).
const DEFAULT_INCLUDE = ['elements', 'prompt'];

export function promptExport(options = {}) {
  const {
    annotate = true,
    imageFormat = 'png',
    imageQuality = 0.8,
    maxImageWidth = 1024,
    interactiveSelector = DEFAULT_INTERACTIVE,
    semanticSelector = DEFAULT_SEMANTIC,
    labelStyle = {},
    promptMode = 'compact',
    includeCoords = true,
    include = DEFAULT_INCLUDE,
  } = options;

  return {
    name: 'prompt-export',

    afterClone(ctx) {
      const meta = extractMetadata(ctx.element, interactiveSelector, semanticSelector);
      // snapdom spreads a fresh ctx for the export phase from ctx.options,
      // so write to both so the prompt() call below can read it.
      ctx.__promptMetadata = meta;
      if (ctx.options) ctx.options.__promptMetadata = meta;

      if (annotate) {
        addAnnotations(ctx.clone, meta.elements, labelStyle);
      }
    },

    defineExports() {
      return {
        prompt: async (ctx, opts = {}) => {
          const meta = ctx.__promptMetadata;
          const wantSet = new Set(opts.include || include || DEFAULT_INCLUDE);
          const wantImage = wantSet.has('image');
          const wantElements = wantSet.has('elements');
          const wantPrompt = wantSet.has('prompt');

          if (!meta || !meta.elements.length) {
            const empty = { dimensions: { width: 0, height: 0 } };
            if (wantImage) empty.image = ctx.export.url;
            if (wantElements) empty.elements = [];
            if (wantPrompt) empty.prompt = '';
            return empty;
          }

          const format = opts.imageFormat || imageFormat;
          const quality = opts.imageQuality || imageQuality;
          const maxWidth = opts.maxImageWidth || maxImageWidth;
          const mode = opts.promptMode || promptMode;
          const withCoords = opts.includeCoords !== undefined ? opts.includeCoords : includeCoords;

          // Only load + rasterize the SVG when the caller actually wants the
          // image. Skipping saves the img decode + canvas draw + toDataURL —
          // the most expensive steps of this export.
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
            // No image — scale bboxes to the same target width the image would
            // have used, so downstream callers can still render the map over
            // a separately-rendered screenshot at the same scale.
            const sourceW = meta.dimensions.width || 1;
            const ratio = sourceW > maxWidth ? maxWidth / sourceW : 1;
            w = Math.round(sourceW * ratio);
            h = Math.round(meta.dimensions.height * ratio);
          }

          const sx = w / (meta.dimensions.width || 1);
          const sy = h / (meta.dimensions.height || 1);

          const scaledElements = meta.elements.map((el) => ({
            ...el,
            bbox: {
              x: Math.round(el.bbox.x * sx),
              y: Math.round(el.bbox.y * sy),
              width: Math.round(el.bbox.width * sx),
              height: Math.round(el.bbox.height * sy),
            },
          }));

          const emitCoords = mode === 'verbose' ? true : (withCoords && !annotate);
          const promptText = (wantPrompt)
            ? (mode === 'verbose'
                ? formatPromptVerbose(scaledElements, { width: w, height: h }, emitCoords)
                : formatPromptCompact(scaledElements, { width: w, height: h }, emitCoords))
            : null;

          const out = { dimensions: { width: w, height: h } };
          if (wantImage) out.image = dataURL;
          if (wantElements) out.elements = scaledElements;
          if (wantPrompt) out.prompt = promptText;
          return out;
        },
      };
    },
  };
}

/* ── Accessible name ──────────────────────────── */

function truncate(str, max) {
  if (!str) return '';
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}

/**
 * Compute the element's accessible name following a simplified WAI-ARIA order.
 * This is what an LLM agent reads first to know what the element IS.
 */
function accessibleName(el) {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const root = el.getRootNode();
    const getById = (id) =>
      root && typeof root.getElementById === 'function'
        ? root.getElementById(id)
        : document.getElementById(id);
    const parts = labelledBy.trim().split(/\s+/)
      .map((id) => {
        const ref = getById(id);
        return ref ? (ref.textContent || '').trim() : '';
      })
      .filter(Boolean);
    if (parts.length) return parts.join(' ');
  }

  if (el.tagName === 'IMG') {
    const alt = el.getAttribute('alt');
    if (alt && alt.trim()) return alt.trim();
  }

  const title = el.getAttribute('title');
  if (title && title.trim()) return title.trim();

  if (el.labels && el.labels[0]) {
    const t = (el.labels[0].textContent || '').trim();
    if (t) return t;
  }

  const text = (el.textContent || '').trim();
  return text ? truncate(text, 40) : '';
}

/* ── DOM state ────────────────────────────────── */

/**
 * Capture real runtime state (not just ARIA attributes). This is what
 * separates a useful map from a static screenshot annotation: an agent can
 * see "checkbox is unchecked / select has value=X / details is closed".
 */
function computeState(el) {
  const state = {};
  try {
    if (el.matches(':checked')) state.checked = true;
    if (el.matches(':disabled')) state.disabled = true;
    if (el.matches(':focus')) state.focus = true;
  } catch { /* some selectors may fail on exotic nodes */ }

  const tag = el.tagName;
  if (tag === 'INPUT') {
    // Checkbox/radio: `value` defaults to "on" when no explicit value attr
    // is set — noise. The meaningful signal is `checked`. Skip value here.
    const type = (el.type || 'text').toLowerCase();
    if (type !== 'checkbox' && type !== 'radio' && el.value) {
      state.value = el.value;
    }
  } else if (tag === 'TEXTAREA') {
    if (el.value) state.value = el.value;
  } else if (tag === 'SELECT') {
    state.value = el.value;
    const opt = el.options && el.options[el.selectedIndex];
    if (opt) state.selectedText = opt.text || '';
  } else if (tag === 'DETAILS') {
    state.open = !!el.open;
  } else if (el.hasAttribute && el.hasAttribute('open')) {
    state.open = true;
  }

  return Object.keys(state).length ? state : null;
}

/* ── Visual styles ────────────────────────────── */

/**
 * Pull a small set of visually-meaningful computed styles. Reads from the
 * live element (the clone uses class-based styling so its inline style is
 * empty and a detached `getComputedStyle(cloneNode)` returns initial values).
 * The computed style of the original is what snapdom used to build the
 * capture, so the result matches what the screenshot shows.
 */
function computeVisualStyles(el) {
  let cs;
  try { cs = getComputedStyle(el); } catch { return null; }
  if (!cs) return null;
  const out = {};
  for (const prop of VISUAL_FIELDS) {
    const v = cs[prop];
    if (isDefaultStyleValue(prop, v)) continue;
    out[prop] = v;
  }
  return Object.keys(out).length ? out : null;
}

/* ── Covered detection ────────────────────────── */

/**
 * True when another element is painted on top of the center of this one.
 * An agent that knows a button is covered by a modal won't try to click it.
 */
function isCovered(el, rect) {
  if (!rect.width || !rect.height) return false;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  if (cx < 0 || cy < 0) return false;
  const doc = el.ownerDocument || document;
  if (!doc.elementFromPoint) return false;
  const top = doc.elementFromPoint(cx, cy);
  if (!top || top === el) return false;
  if (el.contains && el.contains(top)) return false;
  return true;
}

/* ── Metadata extraction ──────────────────────── */

function extractMetadata(element, interactiveSelector, semanticSelector) {
  const rootRect = element.getBoundingClientRect();
  const elements = [];
  let id = 0;

  const tracked = new Set();

  for (const el of element.querySelectorAll(interactiveSelector)) {
    const entry = buildEntry(el, rootRect, id, 'interactive');
    if (entry) {
      elements.push(entry);
      tracked.add(el);
      id++;
    }
  }

  for (const el of element.querySelectorAll(semanticSelector)) {
    if (tracked.has(el)) continue;
    const entry = buildEntry(el, rootRect, id, 'semantic');
    if (entry) {
      elements.push(entry);
      id++;
    }
  }

  return {
    elements,
    dimensions: { width: rootRect.width, height: rootRect.height },
  };
}

function buildEntry(el, rootRect, id, type) {
  const rect = el.getBoundingClientRect();
  const bbox = {
    x: Math.round(rect.left - rootRect.left),
    y: Math.round(rect.top - rootRect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };

  if (bbox.width <= 0 && bbox.height <= 0) return null;

  const tag = el.tagName.toLowerCase();
  const maxText = type === 'interactive' ? 200 : 120;
  const text = (el.textContent || '').trim().slice(0, maxText);

  const attributes = {};
  for (const attr of COLLECTED_ATTRS) {
    const val = el.getAttribute(attr);
    if (val == null || val === '' || val === 'false') continue;
    attributes[attr] = val;
  }

  // For <img>, replace the (potentially long, cache-busted) src with just the
  // filename — "logo.svg" is more useful to an LLM than the full URL.
  if (tag === 'img' && el.src) {
    try {
      const base = (el.ownerDocument && el.ownerDocument.location)
        ? el.ownerDocument.location.href
        : (typeof location !== 'undefined' ? location.href : undefined);
      const url = base ? new URL(el.src, base) : new URL(el.src);
      attributes.src = url.pathname.split('/').pop() || el.src;
    } catch {
      attributes.src = el.src;
    }
  }

  const entry = {
    id,
    tag,
    type,
    name: accessibleName(el),
    text,
    bbox,
    attributes,
  };

  const styles = computeVisualStyles(el);
  if (styles) entry.styles = styles;

  if (type === 'interactive') {
    const state = computeState(el);
    if (state) {
      // Drop state.value when it just echoes attributes.value — no
      // divergence between the initial HTML attribute and the current
      // property, nothing for the LLM to learn from the repeat.
      if (state.value !== undefined && state.value === attributes.value) {
        delete state.value;
      }
      if (Object.keys(state).length) entry.state = state;
    }
    if (isCovered(el, rect)) entry.covered = true;
  }

  return entry;
}

/* ── Visual annotations ───────────────────────── */

function addAnnotations(clone, elements, customStyle) {
  const interactive = elements.filter((e) => e.type === 'interactive');
  if (!interactive.length) return;

  const overlay = document.createElement('div');
  overlay.setAttribute('data-snap-prompt-overlay', 'true');
  Object.assign(overlay.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: '2147483647',
    overflow: 'visible',
  });

  for (const el of interactive) {
    const badge = document.createElement('span');
    badge.textContent = String(el.id);
    badge.setAttribute('data-snap-prompt-label', String(el.id));
    // Center the badge on the element's bbox, not on its top-left corner:
    // `translate(-50%, -50%)` offsets from the anchor point.
    const cx = el.bbox.x + el.bbox.width / 2;
    const cy = el.bbox.y + el.bbox.height / 2;
    Object.assign(badge.style, {
      position: 'absolute',
      left: `${cx}px`,
      top: `${cy}px`,
      transform: 'translate(-50%, -50%)',
      minWidth: '18px',
      height: '18px',
      lineHeight: '18px',
      fontSize: '11px',
      fontWeight: '700',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: '#fff',
      backgroundColor: 'rgba(220, 38, 38, 0.92)',
      borderRadius: '9px',
      textAlign: 'center',
      padding: '0 4px',
      boxSizing: 'border-box',
      boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      ...customStyle,
    });
    overlay.appendChild(badge);
  }

  clone.style.position = 'relative';
  clone.appendChild(overlay);
}

/* ── Prompt text formatters ───────────────────── */

function stateToStr(state) {
  if (!state) return '';
  const flags = [];
  const pairs = [];
  for (const k of Object.keys(state)) {
    const v = state[k];
    if (v === true) flags.push(k);
    else pairs.push(`${k}=${JSON.stringify(v)}`);
  }
  if (!flags.length && !pairs.length) return '';
  return ` {${[...flags, ...pairs].join(', ')}}`;
}

function coordsToStr(bbox) {
  return ` (${bbox.x},${bbox.y} ${bbox.width}×${bbox.height})`;
}

function formatPromptCompact(elements, dimensions, withCoords) {
  const lines = [`Screenshot (${dimensions.width}×${dimensions.height}px).`];

  const interactive = elements.filter((e) => e.type === 'interactive');
  const semantic = elements.filter((e) => e.type === 'semantic');

  if (interactive.length) {
    lines.push('', 'Interactive:');
    for (const el of interactive) {
      const name = el.name ? ` "${truncate(el.name, 60)}"` : '';
      const st = stateToStr(el.state);
      const cov = el.covered ? ' (covered)' : '';
      const coords = withCoords ? coordsToStr(el.bbox) : '';
      lines.push(`  [${el.id}] ${el.tag}${name}${st}${cov}${coords}`);
    }
  }

  if (semantic.length) {
    lines.push('', 'Semantic:');
    for (const el of semantic) {
      const name = el.name ? ` "${truncate(el.name, 60)}"` : '';
      lines.push(`  [${el.id}] ${el.tag}${name}`);
    }
  }

  return lines.join('\n');
}

function formatPromptVerbose(elements, dimensions, withCoords) {
  const lines = [
    `Screenshot of a web page (${dimensions.width}×${dimensions.height}px).`,
    '',
  ];

  const interactive = elements.filter((e) => e.type === 'interactive');
  const semantic = elements.filter((e) => e.type === 'semantic');

  if (interactive.length) {
    lines.push('Interactive elements:');
    for (const el of interactive) {
      const name = el.name ? ` "${truncate(el.name, 80)}"` : '';
      const attrParts = Object.entries(el.attributes).map(([k, v]) => `${k}="${v}"`);
      const attrs = attrParts.length ? ' ' + attrParts.join(' ') : '';
      const pos = withCoords ? coordsToStr(el.bbox) : '';
      const st = stateToStr(el.state);
      const cov = el.covered ? ' (covered)' : '';
      lines.push(`  [${el.id}] <${el.tag}>${name}${pos}${attrs}${st}${cov}`);
    }
    lines.push('');
  }

  if (semantic.length) {
    lines.push('Semantic structure:');
    for (const el of semantic) {
      const name = el.name ? ` "${truncate(el.name, 80)}"` : '';
      const attrParts = [];
      if (el.attributes.alt) attrParts.push(`alt="${el.attributes.alt}"`);
      if (el.attributes.role) attrParts.push(`role="${el.attributes.role}"`);
      const attrs = attrParts.length ? ' ' + attrParts.join(' ') : '';
      lines.push(`  [${el.id}] <${el.tag}>${name}${attrs}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
