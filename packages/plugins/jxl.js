/**
 * jxl - Official SnapDOM Plugin
 * Adds JPEG XL exports: `result.toJxl()`, `toBlob({ format: 'jxl' })` and
 * `download({ format: 'jxl' })`. They take `toWebp()`'s options and defaults, plus
 * `effort`, `signal`, `onProgress` and `onEncoded`.
 *
 * Text and interface stay exact while photos take the quality, in one file. The plugin
 * measures where text and photos are on the page in `afterClone`, then encodes the drawn
 * canvas in the browser with rapier-jxl 8.3.2 or later (MIT), an optional peer dependency:
 * `npm install rapier-jxl`. The text measurement loads at the first capture, the encoder at the
 * first JPEG XL export.
 *
 * @param {Object} [options]
 * @param {string} [options.module='rapier-jxl/capture-complete'] - What the encoder is:
 *   'rapier-jxl/capture-complete' (efforts 1-9, created by the plugin), or with your own `codec`,
 *   'rapier-jxl/capture' (every pixel exact, efforts 1-5) or 'rapier-jxl/upload' (photographic,
 *   efforts 1-3)
 * @param {Object} [options.codec] - Your own encoder with `prepare` and `capture`: a rapier-jxl
 *   codec or a directly imported capture module
 * @param {Object} [options.decoder] - A decoder with `decode` (`createCodec()` from
 *   'rapier-jxl/codec/decode'): `toJxl()` shows its pixels where the browser cannot show JPEG XL
 * @param {number} [options.effort=3] - Default effort for each export; an export's `effort` wins
 * @param {false|'required'} [options.webgpu] - Disable WebGPU, or require a device
 * @param {boolean|{count: number, memoryBytes?: number}} [options.helpers] - Helper workers for a
 *   codec the plugin creates
 * @returns {Object} SnapDOM plugin
 */
export function jxl(options = {}) {
  const { module = 'rapier-jxl/capture-complete', codec, decoder, effort: preset, webgpu, helpers: asked } = options;
  // The same helpers written in another order share one plugin.
  const helpers = asked && typeof asked === 'object'
    ? { count: asked.count, ...(asked.memoryBytes !== undefined && { memoryBytes: asked.memoryBytes }) } : asked || undefined;
  // Equal options give the same plugin, so SnapDOM's memo of an unchanged capture holds for an
  // inline `jxl()` too.
  const id = JSON.stringify([module, helpers, preset, webgpu]);
  const made = within(within(plugins, codec, 'codecs'), decoder, 'decoders').ids;
  if (!made.has(id)) made.set(id, create(module, codec, decoder, preset, webgpu, helpers));
  return made.get(id);
}

const scope = () => ({ ids: new Map(), codecs: new WeakMap(), decoders: new WeakMap() });
const plugins = scope();
const within = (at, object, kind) => !object ? at : at[kind].get(object) ?? at[kind].set(object, scope()).get(object);

function create(module, codec, decoder, preset, webgpu, helpers) {
  checkEffort(preset);
  if (!MODULES.includes(module)) throw new Error(`The jxl plugin's module is ${MODULES.join(', ')} or left out.`);
  // One codec door, so a bundler ships one encoder's workers: the others come as your own codec.
  if (module !== MODULES[0] && !codec) throw new Error(`The jxl plugin's ${module} needs your codec: createCodec() from ${module.replace('/', '/codec/')}.`);
  const exactOnly = module === 'rapier-jxl/capture';
  // Edges are measured with the page, for any export effort from 4 (a scan of about 0.1 ms on
  // SnapDOM's demo pages): measuring the page again at export could see it changed.
  const edges = module !== 'rapier-jxl/upload';
  // The encoder this plugin creates, on its first JPEG XL export; `close()` ends it.
  let own = null;
  const ownCodec = () => own ??= import('rapier-jxl/codec/capture-complete').then(
    ({ createCodec }) => createCodec({ module, ...(helpers !== undefined && { helpers }) }),
    error => { own = null; throw needs(error); });

  return {
    name: 'jxl',
    // The measurement reads the live DOM and nothing else, so SnapDOM can keep memoizing
    // unchanged captures.
    pure: true,

    /**
     * Ends the encoder this plugin created (never your own `codec` or `decoder`). Calling it again
     * does nothing; a later export creates it again.
     * @returns {Promise<void>}
     */
    async close() {
      const open = own;
      own = null;
      await open?.then(c => c.close(), () => {});
    },

    // Exact capture needs no rectangles. Otherwise text and photos are measured on the page
    // as it was captured; the export maps them onto the drawn canvas. A failure to load or
    // measure is kept for the JPEG XL export, which then rejects with it.
    ...(exactOnly ? {} : {
      async afterClone(context) {
        const element = context.element;
        // Only what SnapDOM cloned is drawn: exclude, filter and unslotted children add nothing.
        const keep = context.nodeMap ? new Set(context.nodeMap.values()) : undefined;
        try {
          const { measure } = await loadRects();
          const shot = element && measured(measure, element, edges, keep);
          context[SNAPSHOT] = shot ? { ...shot, frame: frameOf(element, context.outerTransforms !== false) } : null;
        } catch (error) {
          context[SNAPSHOT] = { error };
        }
      },
    }),

    defineExports: ({ exports }) => {
      const encoded = async (context, options) => {
        // The export's own options first: a beforeExport plugin may have changed them, and a
        // direct call has nothing else.
        const asked = context.export?.requestedOptions ?? {}, pick = k => options[k] !== undefined ? options[k] : asked[k];
        const effort = pick('effort') ?? preset, signal = pick('signal'), onProgress = pick('onProgress'), onEncoded = pick('onEncoded');
        checkEffort(effort);
        if (options.quality !== undefined && !(options.quality >= 0 && options.quality <= 1)) throw new RangeError('The jxl plugin\'s quality is 0 to 1.');
        signal?.throwIfAborted();
        if (context[SNAPSHOT]?.error) throw context[SNAPSHOT].error;
        const { pageRects } = exactOnly ? {} : await abortable(loadRects(), signal);
        // The plugin's own encoder takes up to MAX_PIXELS: a canvas well past it is never drawn.
        if (!codec && drawnPixels(context, options) > 1.5 * MAX_PIXELS) throw tooLarge();
        const encoder = codec ?? await abortable(ownCodec(), signal);
        // Ready while SnapDOM draws; a failure rejects this export.
        const ready = Promise.resolve().then(() => encoder.prepare('capture'));
        ready.catch(() => {});
        const mine = c => c !== options.canvas;
        const drawing = exports.canvas({ ...options, backgroundColor: options.backgroundColor ?? '#ffffff' });
        let canvas;
        try {
          canvas = await abortable(drawing, signal);
        } catch (error) {
          // A draw that ends after the abort still frees its canvas.
          drawing.then(c => { if (mine(c)) free(c); }, () => {});
          throw error;
        }
        try {
          signal?.throwIfAborted();
          if (!codec && canvas.width * canvas.height > MAX_PIXELS) throw tooLarge();
          await abortable(ready, signal);
          const blob = await encode(encoder, canvas, context, options, { effort, signal, onProgress, onEncoded, pageRects });
          return { blob, canvas, own: mine(canvas) };
        } catch (error) {
          if (mine(canvas)) free(canvas);
          throw error;
        }
      };
      const blobOf = async (context, options) => {
        const { blob, canvas, own } = await encoded(context, options);
        if (own) free(canvas);
        return blob;
      };
      // `type` is SnapDOM's older name for `format`, which it keeps for its own formats only. A format
      // chosen for this export (the call, a beforeExport plugin) wins; the capture's own does not.
      const isJxl = (context, options) => {
        if (String(options.format).toLowerCase() === 'jxl') return true;
        const asked = context.export?.requestedOptions ?? options;
        return asked.format === undefined && String(asked.type).toLowerCase() === 'jxl' &&
          (options.__explicitFormat ?? null) === (context.__explicitFormat ?? null);
      };
      const signalOf = (context, options) => options.signal ?? context.export?.requestedOptions?.signal;

      return {
        jxl: async (context, options = {}) => {
          // Where JPEG XL does not show and there is no decoder, nothing is encoded.
          if (showsJxl === false && !decoder) throw notShown();
          const { blob, canvas, own: owned } = await encoded(context, options);
          return image(blob, canvas, owned, options.dpr || 1, signalOf(context, options), decoder);
        },
        blob: (context, options = {}) => isJxl(context, options) ? blobOf(context, options) : exports.blob(options),
        // Replacing download replaces it for every format: the others are saved as SnapDOM saves
        // them (its file name, its Blob, the iOS share sheet falling back to the anchor).
        async download(context, options = {}) {
          const name = options.filename || 'snapDOM';
          if (!isJxl(context, options)) {
            const format = options.format === 'jpg' ? 'jpeg' : options.format || 'png';
            const blob = await exports.blob({ ...options, format, dpr: 1 });
            return save(blob, /\.(png|jpe?g|webp|svg)$/i.test(name) ? name : `${name}.${format}`, false);
          }
          const filename = /\.jxl$/i.test(name) ? name : `${name.replace(/\.(png|jpe?g|webp|svg)$/i, '')}.jxl`;
          const blob = await blobOf(context, { ...options, dpr: 1 });
          signalOf(context, options)?.throwIfAborted();
          await save(blob, filename, true);
        },
      };

      // Maps the measurement onto the drawn canvas and encodes it.
      async function encode(encoder, canvas, context, options, { effort, signal, onProgress, onEncoded, pageRects }) {
        const { quality = 0.92 } = options;
        const photo = { quality: Math.max(1, quality * 100) };
        // The canvas shows the capture's viewBox: the measurement moves into it the way SnapDOM
        // drew the root (its outer shadow, transform and clip window), or, where it cannot, the
        // whole capture stays exact.
        const both = o => Number.isFinite(o.width) && Number.isFinite(o.height);
        const fitted = both(context) && !safari(), exported = both(options) && firefox() && options;
        // WebKit draws an export crop's window from the capture's corner (SnapDOM 3.7.2): exact there.
        const crop = options.crop && (safari() || exported ? null : options.crop);
        const shot = exactOnly || options.crop && !crop ? null : inView(context[SNAPSHOT], context.meta, fitted, exported, crop);
        // WebKit draws a clip window's positioned boxes as if the window began at the element's corner
        // (SnapDOM 3.7.2): in Safari the text stays exact in both places.
        const unclipped = shot && safari() && context.meta?.clip ? inView(context[SNAPSHOT], { ...context.meta, clip: null }, fitted, exported, crop) : null;
        const area = {};

        // Below 1:1, text boxes map through the drawn scale (outward to whole pixels) so glyphs
        // stay exact, and photos still take the quality. With no photos left the page stays exact;
        // with photos, the smaller of that file and the whole page exact wins, so a scaled export
        // is never larger.
        const naturalW = shot?.box.width, naturalH = shot?.box.height;
        const below = !!(shot && naturalW && naturalH &&
          (canvas.width < Math.floor(naturalW) || canvas.height < Math.floor(naturalH)));
        const measured = [shot, unclipped].filter(Boolean).map(s => pageRects(s, canvas, { area, edges: !below && (effort ?? 3) >= 4 }));
        // pageRects' whole result reaches the encoder. Safari's two measurements unite their
        // rectangles, and their text is complete only when both say so.
        let rects = quality < 1 && measured.length ? measured.length === 1 ? measured[0] : {
          exactRects: measured.flatMap(r => r.exactRects), photoRects: measured.flatMap(r => r.photoRects),
          ...(measured.every(r => r.textComplete === true) && { textComplete: true }),
        } : null;
        // A page SnapDOM had to shrink to its canvas limit is drawn with its text moved from where
        // the page has it, so the rectangles cannot follow: it stays exact.
        if (below && (!rects?.photoRects?.length || atLimit(canvas))) rects = null;

        const base = { ...(effort !== undefined && { effort }), ...(webgpu !== undefined && { webgpu }), ...(signal && { signal }) };
        const hooks = { signal, onProgress, onEncoded };
        const file = below && rects
          ? await smaller(encoder, canvas, base, [{ ...rects, fidelity: photo }, { fidelity: 'exact' }], hooks)
          : await encoder.capture(canvas, {
            ...(rects ? { ...rects, fidelity: photo } : { fidelity: 'exact' }),
            ...base, ...(onProgress !== undefined && { onProgress }), ...(onEncoded !== undefined && { onEncoded }),
          });
        // An encoder that finished after the abort still loses to it.
        signal?.throwIfAborted();
        return new Blob([bytesOf(file)], { type: 'image/jxl' });
      }
    },
  };
}

export default jxl;

const SNAPSHOT = Symbol('jxl measurement');
// SnapDOM's raster limits: 32767 pixels a side (16384 in Safari) and 16384 * 16384 in all.
const atLimit = ({ width, height }) => [16384, 32767].includes(Math.max(width, height)) || width * height > 0.99 * 16384 * 16384;
// rapier-jxl's own default limit: 40 MP, 160 MB of RGBA before the encoder's copies. Your own
// `codec` keeps its own limit.
const MAX_PIXELS = 40000000;
const tooLarge = () => Object.assign(new Error(`The capture is over ${MAX_PIXELS} pixels: export it smaller, or pass your own codec with a higher maxPixels.`), { code: 'JXL_LIMIT' });
let measuring = null, rectsLoading = null;

// About how many pixels SnapDOM will draw, before it draws (its v3 sizing rule): width and height
// win, either one keeps the aspect, otherwise the capture's size times scale; times dpr squared.
function drawnPixels(context, options) {
  let { vbW, vbH } = context.meta ?? {};
  if (!(vbW > 0 && vbH > 0)) return 0;
  // An export crop draws its window alone.
  const crop = options.crop;
  if (crop && [crop.x, crop.y, crop.width, crop.height].every(Number.isFinite)) {
    vbW = Math.max(0, Math.min(vbW, crop.x + crop.width) - Math.max(0, crop.x));
    vbH = Math.max(0, Math.min(vbH, crop.y + crop.height) - Math.max(0, crop.y));
    if (!(vbW > 0 && vbH > 0)) return 0;
  }
  const w = Number.isFinite(options.width) ? options.width : null, h = Number.isFinite(options.height) ? options.height : null;
  const k = options.scale || 1, dpr = options.dpr || (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1;
  const width = w ?? (h ? h * vbW / vbH : vbW * k), height = h ?? (w ? w * vbH / vbW : vbH * k);
  return width * height * dpr * dpr;
}

// rapier-jxl is an optional peer dependency, imported the first time a capture or export needs it,
// so calling jxl() and the rest of the plugins load nothing.
const checkEffort = effort => {
  if (effort !== undefined && !(Number.isInteger(effort) && effort >= 1 && effort <= 9)) throw new RangeError('The jxl plugin\'s effort is a whole number from 1 to 9.');
};
const MODULES = ['rapier-jxl/capture-complete', 'rapier-jxl/capture', 'rapier-jxl/upload'];
const needs = error => new Error('The jxl plugin needs rapier-jxl 8.3.2 or later: npm install rapier-jxl', { cause: error });

function loadRects() {
  if (measuring) return Promise.resolve(measuring);
  rectsLoading ??= import('rapier-jxl/page-rects').then(
    m => (measuring = { measure: m.measure, pageRects: m.pageRects }),
    error => { rectsLoading = null; throw needs(error); });
  return rectsLoading;
}

// SnapDOM 3.7.3 draws <html> without the top margins that collapse through its first children,
// <body>'s own included, so its text is not where the page has it: such a capture stays exact.
function measured(measure, element, edges, keep) {
  return keep && liftOf(element) ? null : measure(element, { edges, keep });
}

function liftOf(element) {
  const doc = element.ownerDocument, body = doc?.body;
  if (element !== doc?.documentElement || !body) return 0;
  const s = getComputedStyle(element);
  // As SnapDOM decides it: an edge with a border or padding, or a root that starts its own block
  // formatting context, keeps the margins.
  if (parseFloat(s.borderTopWidth) || parseFloat(s.paddingTop) || /flex|grid|table|inline-block|flow-root/.test(s.display) ||
    s.position === 'absolute' || s.position === 'fixed' || s.float !== 'none' || s.overflowX !== 'visible' || s.overflowY !== 'visible' ||
    /layout|content|paint|strict/.test(s.contain)) return 0;
  // A relatively positioned <body> keeps its offset in the clone.
  const b = getComputedStyle(body), moved = b.position === 'relative' ? parseFloat(b.top) || 0 : 0;
  return body.getBoundingClientRect().top - moved - element.getBoundingClientRect().top;
}

// How the page shows the capture root: the viewport point of its layout corner, the scale of the
// ancestors and the root's own transform. null where an ancestor rotates or skews it, or a
// transform cannot be read: the export then keeps the whole capture exact.
function frameOf(element, keepsRotation) {
  try {
    const box = element.getBoundingClientRect(), style = getComputedStyle(element);
    const width = element.offsetWidth ?? box.width, height = element.offsetHeight ?? box.height;
    // No transform on the root or above it, and its layout size is its box: the page's own pixels.
    let flat = none(style.transform) && none(style.rotate) && none(style.scale);
    for (let up = element.parentElement ?? element.getRootNode?.().host; up && flat; up = up.parentElement ?? up.getRootNode?.().host) {
      const s = getComputedStyle(up);
      flat = none(s.transform) && none(s.rotate) && none(s.scale);
    }
    if (flat && Math.abs(box.width - width) < 0.5 && Math.abs(box.height - height) < 0.5) {
      return { toDrawn: p => ({ x: p.x - box.left, y: p.y - box.top }) };
    }
    const [ox, oy] = style.transformOrigin.split(' ').map(parseFloat);
    const transform = style.transform === 'none' ? new DOMMatrix() : new DOMMatrix(style.transform);
    const rotate = style.rotate && style.rotate !== 'none' ? new DOMMatrix(`rotate(${style.rotate})`) : new DOMMatrix();
    const scale = style.scale && style.scale !== 'none' ? new DOMMatrix(`scale(${style.scale.split(' ').slice(0, 2).join(',')})`) : new DOMMatrix();
    transform.e = transform.f = 0; // SnapDOM drops the root's translation
    const live = rotate.multiply(scale).multiply(transform);
    // SnapDOM keeps the root's transform, or with outerTransforms false only its scale and skew,
    // about its top left corner.
    const drawn = keepsRotation ? live : scale.multiply(scaleSkew(transform));
    for (let up = element.parentElement ?? element.getRootNode().host; up; up = up.parentElement ?? up.getRootNode().host) {
      const s = getComputedStyle(up), m = s.transform === 'none' ? null : new DOMMatrix(s.transform);
      if (m && (m.b || m.c) || s.rotate && s.rotate !== 'none') return null;
    }
    const corners = m => [[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) => m.transformPoint({ x, y }));
    const about = (m, x, y) => new DOMMatrix().translate(x, y).multiply(m).translate(-x, -y);
    const page = corners(about(live, ox, oy));
    const xs = page.map(p => p.x), ys = page.map(p => p.y);
    const near = v => Math.abs(v - 1) < 0.01 ? 1 : v;
    const sx = near(box.width / (Math.max(...xs) - Math.min(...xs) || 1)), sy = near(box.height / (Math.max(...ys) - Math.min(...ys) || 1));
    // From the page to the root's own layout box.
    const toLayout = about(live, ox, oy).inverse()
      .multiply(new DOMMatrix().scale(1 / sx, 1 / sy).translate(-(box.left - Math.min(...xs) * sx), -(box.top - Math.min(...ys) * sy)));
    const shown = (keepsRotation ? about(live, ox, oy) : drawn).multiply(toLayout);
    return { toDrawn: p => shown.transformPoint(p) };
  } catch {
    return null;
  }
}

const none = v => !v || v === 'none';

// Firefox as SnapDOM tells it (its isFirefox).
const firefox = () => typeof navigator !== 'undefined' && (navigator.userAgent || '').toLowerCase().includes('firefox');

// Safari as SnapDOM tells it (its isSafari): the browsers whose captures it draws its Safari way.
function safari() {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent || '', low = ua.toLowerCase(), webkit = /applewebkit/i.test(ua);
  return low.includes('safari') && !/chrome|crios|fxios|android/.test(low) || webkit && /mobile/i.test(ua) && !/safari/i.test(ua) ||
    /(micromessenger|wxwork|wecom|windowswechat|macwechat)/i.test(ua) || /(baiduboxapp|baidubrowser|baidusearch|baiduboxlite)/i.test(low) ||
    /ipad|iphone|ipod/.test(low) && webkit;
}

// What SnapDOM leaves of a matrix with outerTransforms false: its scale and skew.
function scaleSkew({ a, b, c, d }) {
  const sx = Math.hypot(a, b);
  if (!sx) return new DOMMatrix();
  const a1 = a / sx, b1 = b / sx, shear = a1 * c + b1 * d;
  const sy = Math.hypot(c - a1 * shear, d - b1 * shear);
  return new DOMMatrix([sx, 0, sy ? shear : 0, sy, 0, 0]);
}

// The measurement moved into the capture's viewBox, in CSS pixels; null keeps the capture exact.
// The box is what the canvas shows, in viewBox units. A capture given both width and height fits its
// viewBox inside them, centered (Safari stretches it instead), and Firefox draws an export given
// both fitted and centered too (the others stretch it): mapping the box onto the canvas is a stretch.
function inView(shot, meta, fitted, exported, crop) {
  if (!shot?.frame || !meta || !Number.isFinite(meta.vbW)) return null;
  const { contentX = 0, contentY = 0, vbW, vbH, clip, targetW, targetH } = meta, { toDrawn } = shot.frame;
  let width = vbW, height = vbH;
  const fit = (w, h) => { const k = Math.min(w / width, h / height); width = w / k; height = h / k; };
  if (fitted && targetW && targetH) fit(targetW, targetH);
  if (exported) fit(exported.width, exported.height);
  const dx = contentX - (clip?.x ?? 0) + (width - vbW) / 2, dy = contentY - (clip?.y ?? 0) + (height - vbH) / 2;
  const move = r => {
    const ps = [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]].map(([x, y]) => toDrawn({ x, y }));
    const xs = ps.map(p => p.x + dx), ys = ps.map(p => p.y + dy);
    return { ...r, left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
  };
  let box = { left: 0, top: 0, width, height };
  // An export crop is a window of the viewBox.
  if (crop) {
    const left = Math.max(0, crop.x), top = Math.max(0, crop.y);
    const right = Math.min(vbW, crop.x + crop.width), bottom = Math.min(vbH, crop.y + crop.height);
    if (!(right > left && bottom > top)) return null;
    box = { left, top, width: right - left, height: bottom - top };
  }
  const { frame: _frame, ...measurement } = shot;
  return {
    ...measurement,
    box,
    text: shot.text.map(t => ({ ...t, r: move(t.r) })),
    photos: shot.photos.map(move),
    ...(shot.edges && { edges: shot.edges.map(move) }),
  };
}

// The file as an image. Where the browser cannot show JPEG XL (found on the first try, then
// remembered), the decoder's pixels if you gave one; otherwise the export says so. The image
// takes the drawn canvas's CSS size.
let showsJxl;
const notShown = () => Object.assign(new Error('This browser cannot show JPEG XL: use toBlob({ format: \'jxl\' }) for the file, or give the plugin a decoder.'), { code: 'JXL_NOT_SHOWN' });
async function image(blob, drawn, own, dpr, signal, decoder) {
  const img = new Image(), wait = promise => abortable(promise, signal);
  const { width, height } = drawn?.style ?? {};
  if (own) free(drawn);
  let decoded = null;
  try {
    if (showsJxl !== false) {
      try {
        await wait(shown(img, blob));
        showsJxl = true;
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        showsJxl = false;
      }
    }
    if (!showsJxl) {
      if (!decoder) throw notShown();
      const { data, width: w, height: h } = await wait(decoder.decode(blob, { format: 'uint8', colorSpace: 'srgb', ...(signal && { signal }) }));
      decoded = document.createElement('canvas');
      decoded.width = w;
      decoded.height = h;
      decoded.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), w, h), 0, 0);
      await wait(shown(img, await wait(new Promise(resolve => decoded.toBlob(resolve, 'image/png')))));
    }
  } finally {
    free(decoded);
  }
  signal?.throwIfAborted();
  img.style.width = width || `${img.naturalWidth / dpr}px`;
  img.style.height = height || `${img.naturalHeight / dpr}px`;
  return img;
}

// A canvas holds its pixels until it is emptied, even once nothing reads it. Only the export's own
// canvases are emptied, never one the app passed as `canvas`.
function free(canvas) {
  if (typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement) canvas.width = canvas.height = 0;
}

// The image decodes the Blob through an object URL, revoked once it has loaded or failed: the
// decoded image keeps its pixels, and nothing holds a base64 copy.
function shown(img, blob) {
  if (!blob) return Promise.reject(new Error('The canvas gave no PNG.'));
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; })
    .then(() => img.decode?.().catch(() => {}))
    .finally(() => { img.onload = img.onerror = null; URL.revokeObjectURL(url); });
}

// iOS saves a file only through the share sheet. For JPEG XL a refused share is the export's
// failure; SnapDOM's own formats fall back to the anchor, as SnapDOM's download does.
async function save(blob, filename, strict) {
  const file = new File([blob], filename, { type: blob.type });
  const ios = navigator.userAgentData ? navigator.userAgentData.platform === 'iOS'
    : /iPhone|iPad|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  if (ios && navigator.canShare?.({ files: [file] })) {
    // Closing the sheet is the person's choice.
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (strict) throw error;
    }
  }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  try {
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
  } finally {
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// Below 1:1, encode each candidate quietly, keep the smallest, then report one onEncoded and
// a final progress of 1. Progress runs 0 to 1 across the candidates without restarting.
async function smaller(encoder, canvas, base, jobs, hooks) {
  const span = 1 / jobs.length;
  let best = null, record = null;
  for (let i = 0; i < jobs.length; i++) {
    let got = null;
    const result = await encoder.capture(canvas, {
      ...base, ...jobs[i],
      onProgress: hooks.onProgress && (f => { if (f < 1) hooks.onProgress(i * span + f * span); }),
      onEncoded: r => { got = r; },
    });
    if (result.fits && result.bytes && (!best || result.bytes.byteLength < best.bytes.byteLength)) { best = result; record = got; }
  }
  hooks.signal?.throwIfAborted();
  bytesOf(best);
  hooks.onEncoded?.(record ?? { exact: false });
  hooks.signal?.throwIfAborted();
  hooks.onProgress?.(1);
  hooks.signal?.throwIfAborted();
  return best;
}

function bytesOf(result) {
  if (!result?.fits || !result.bytes) {
    throw Object.assign(new Error(result?.reason?.message ?? 'The JPEG XL file did not meet the requested target.'),
      { code: result?.reason?.code ?? 'JXL_UNSUPPORTED' });
  }
  return result.bytes;
}

function abortable(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const stop = () => reject(signal.reason);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}
