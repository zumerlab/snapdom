/**
 * promptExport – Official SnapDOM Plugin
 * Produces an LLM-ready package: annotated screenshot + structured element map + prompt text.
 *
 * Usage:
 *   import { promptExport } from '@zumer/snapdom-plugins/prompt-export';
 *   const result = await snapdom(el, { plugins: [promptExport()] });
 *   const { image, elements, dimensions, prompt } = await result.toPrompt();
 *
 * @param {Object} [options]
 * @param {boolean}  [options.annotate=true]        - Overlay numbered badges on interactive elements
 * @param {string}   [options.imageFormat='png']     - Output image format ('png'|'jpg'|'webp')
 * @param {number}   [options.imageQuality=0.8]      - Quality for lossy formats (0..1)
 * @param {number}   [options.maxImageWidth=1024]    - Max width in px (downscales if larger)
 * @param {string}   [options.interactiveSelector]   - Custom CSS selector for interactive elements
 * @param {string}   [options.semanticSelector]      - Custom CSS selector for semantic elements
 * @param {Object}   [options.labelStyle={}]         - Override styles for annotation badges
 * @returns {Object} SnapDOM plugin
 */

const DEFAULT_INTERACTIVE =
  'a[href], button, input, select, textarea, ' +
  '[role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], ' +
  '[tabindex]:not([tabindex="-1"]), summary, [contenteditable="true"]';

const DEFAULT_SEMANTIC =
  'h1, h2, h3, h4, h5, h6, p, li, img[alt], nav, main, article, section, ' +
  'header, footer, label, td, th, figcaption, blockquote, legend';

export function promptExport(options = {}) {
  const {
    annotate = true,
    imageFormat = 'png',
    imageQuality = 0.8,
    maxImageWidth = 1024,
    interactiveSelector = DEFAULT_INTERACTIVE,
    semanticSelector = DEFAULT_SEMANTIC,
    labelStyle = {},
  } = options;

  return {
    name: 'prompt-export',

    afterClone(ctx) {
      const meta = extractMetadata(ctx.element, interactiveSelector, semanticSelector);
      // The ctx passed to afterClone is NOT the same object passed to the
      // prompt() export later — snapdom spreads from ctx.options there. Stash
      // on both so (a) standalone tests that pass a minimal ctx still see it
      // and (b) the prompt() call can read it through the shared options ref.
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
          if (!meta || !meta.elements.length) {
            return {
              image: ctx.export.url,
              elements: [],
              dimensions: { width: 0, height: 0 },
              prompt: '',
            };
          }

          const format = opts.imageFormat || imageFormat;
          const quality = opts.imageQuality || imageQuality;
          const maxWidth = opts.maxImageWidth || maxImageWidth;

          const img = new Image();
          img.src = ctx.export.url;
          await new Promise((res, rej) => {
            img.onload = res;
            img.onerror = rej;
          });

          const ratio =
            img.naturalWidth > maxWidth ? maxWidth / img.naturalWidth : 1;
          const w = Math.round(img.naturalWidth * ratio);
          const h = Math.round(img.naturalHeight * ratio);

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const c2d = canvas.getContext('2d');
          c2d.drawImage(img, 0, 0, w, h);

          const mime =
            format === 'jpg' || format === 'jpeg'
              ? 'image/jpeg'
              : format === 'webp'
                ? 'image/webp'
                : 'image/png';
          const dataURL = canvas.toDataURL(mime, quality);

          const sx = w / (meta.dimensions.width || 1);
          const sy = h / (meta.dimensions.height || 1);

          const elements = meta.elements.map((el) => ({
            ...el,
            bbox: {
              x: Math.round(el.bbox.x * sx),
              y: Math.round(el.bbox.y * sy),
              width: Math.round(el.bbox.width * sx),
              height: Math.round(el.bbox.height * sy),
            },
          }));

          return {
            image: dataURL,
            elements,
            dimensions: { width: w, height: h },
            prompt: formatPromptText(elements, { width: w, height: h }),
          };
        },
      };
    },
  };
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

const COLLECTED_ATTRS = [
  'role', 'aria-label', 'aria-expanded', 'aria-checked', 'aria-disabled',
  'alt', 'href', 'placeholder', 'name', 'type', 'value', 'title', 'disabled',
];

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
  const text = (el.textContent || '').trim().slice(0, 200);

  const attributes = {};
  for (const attr of COLLECTED_ATTRS) {
    const val = el.getAttribute(attr);
    if (val != null) attributes[attr] = val;
  }

  return { id, tag, type, text, bbox, attributes };
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
    Object.assign(badge.style, {
      position: 'absolute',
      left: `${el.bbox.x}px`,
      top: `${el.bbox.y}px`,
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

/* ── Prompt text formatter ────────────────────── */

function formatPromptText(elements, dimensions) {
  const lines = [
    `Screenshot of a web page (${dimensions.width}\u00d7${dimensions.height}px).`,
    '',
  ];

  const interactive = elements.filter((e) => e.type === 'interactive');
  const semantic = elements.filter((e) => e.type === 'semantic');

  if (interactive.length) {
    lines.push('Interactive elements:');
    for (const el of interactive) {
      const attrParts = Object.entries(el.attributes).map(
        ([k, v]) => `${k}="${v}"`
      );
      const text = el.text ? ` "${truncate(el.text, 60)}"` : '';
      const pos = `(${el.bbox.x},${el.bbox.y} ${el.bbox.width}\u00d7${el.bbox.height})`;
      const attrs = attrParts.length ? ' ' + attrParts.join(' ') : '';
      lines.push(`  [${el.id}] <${el.tag}>${text} ${pos}${attrs}`);
    }
    lines.push('');
  }

  if (semantic.length) {
    lines.push('Semantic structure:');
    for (const el of semantic) {
      const text = el.text ? ` "${truncate(el.text, 80)}"` : '';
      const attrParts = [];
      if (el.attributes.alt) attrParts.push(`alt="${el.attributes.alt}"`);
      if (el.attributes.role) attrParts.push(`role="${el.attributes.role}"`);
      const attrs = attrParts.length ? ' ' + attrParts.join(' ') : '';
      lines.push(`  [${el.id}] <${el.tag}>${text}${attrs}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '\u2026';
}
