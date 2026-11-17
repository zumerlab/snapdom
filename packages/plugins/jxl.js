/**
 * JPEG XL exports with exact text and lossy photos. Captures are measured in afterClone;
 * exports encode the frozen canvas and preserve transparency unless a background is set.
 * Requires the optional jpegxl 8.4.0 peer. Pinned by __tests__/plugin.jxl.test.js.
 * @module @zumer/snapdom-plugins/jxl
 */
import { measure, pageRects } from 'jpegxl/page-rects';

/**
 * Add toJxl(), toBlob({ format: 'jxl' }) and download({ format: 'jxl' }).
 * @param {import('./jxl.js').JxlOptions} [options]
 * @returns {import('./jxl.js').JxlPlugin} SnapDOM plugin
 */
export function jxl(options = {}) {
  const { module = 'jpegxl/capture-complete', codec, effort: preset, webgpu } = options;
  // Equal options give the same plugin, so SnapDOM's memo of an unchanged capture holds for an
  // inline `jxl()` too.
  const id = JSON.stringify([module, preset, webgpu]);
  const made = codec ? byCodec.get(codec) ?? byCodec.set(codec, new Map()).get(codec) : plugins;
  if (!made.has(id)) made.set(id, create(module, codec, preset, webgpu));
  return made.get(id);
}

export default jxl;

const plugins = new Map(), byCodec = new WeakMap();

function create(module, codec, preset, webgpu) {
  const exactOnly = module === 'jpegxl/capture';
  // Edges are measured with the page, for any export effort from 4 (a scan of about 0.1 ms on
  // SnapDOM's demo pages): measuring the page again at export could see it changed.
  const edges = module !== 'jpegxl/upload';
  if (!MODULES.includes(module)) throw new Error(`The jxl plugin's module is ${MODULES.join(', ')} or left out.`);
  if (webgpu !== undefined && module !== COMPLETE) throw new Error(`jxl({module: '${module}'}) runs on WebAssembly; remove webgpu.`);
  if (!codec && module !== COMPLETE) throw new Error(`jxl({module: '${module}'}) needs its codec: import * as codec from '${module}' and pass {codec}.`);
  // Start loading now, so the first export does not wait on the network.
  if (!codec) door().catch(() => {});
  return {
    name: 'jxl',
    // The measurement reads the live DOM and nothing else, so SnapDOM can keep memoizing
    // unchanged captures.
    pure: true,

    // Exact capture needs no rectangles. Otherwise text and photos are measured on the page
    // as it was captured; the export maps them onto the drawn canvas.
    ...(exactOnly ? {} : {
      afterClone(context) {
        const element = context.element;
        // Only what SnapDOM cloned is drawn: exclude, filter and unslotted children add nothing.
        const keep = context.nodeMap ? new Set(context.nodeMap.values()) : undefined;
        // The measurement serves this plugin's exports only: one that fails rejects a JPEG XL export, never another.
        try {
          context[SNAPSHOT] = element ? { ...measured(measure, element, edges, keep), frame: frameOf(element, context.outerTransforms !== false) } : null;
        } catch (error) {
          context[SNAPSHOT] = { error };
        }
      },
    }),

    defineExports: ({ exports }) => {
      const encodedOnce = async (context, options, callbacks) => {
        // The export's own options first: a beforeExport plugin may have changed them, and a
        // direct call has nothing else.
        const asked = context.export?.requestedOptions ?? {}, pick = k => options[k] !== undefined ? options[k] : asked[k];
        const effort = pick('effort') ?? preset, signal = pick('signal'), onProgress = pick('onProgress'), onEncoded = pick('onEncoded');
        const observe = async (callback, value) => {
          try { await abortable(Promise.resolve(callback(value)), signal); }
          catch (error) { callbacks.failed = true; throw error; }
        };
        signal?.throwIfAborted();
        if (context[SNAPSHOT]?.error) throw context[SNAPSHOT].error;
        const encoder = codec ?? await abortable(door(), signal);
        // Upload carries two coders: the capture one is warmed; every other module prepares its own.
        (module === 'jpegxl/upload' ? encoder.prepare('capture') : encoder.prepare()).catch(() => {});
        const drawOptions = { ...options }, suppliedCanvas = drawOptions.canvas;
        let canvas;
        try {
          await abortable(Promise.resolve(exports.canvas(drawOptions)).then(drawn => {
            if (signal?.aborted) {
              if (drawn !== suppliedCanvas) free(drawn);
              signal.throwIfAborted();
            }
            canvas = drawn;
          }), signal);
          signal?.throwIfAborted();

          // A quality outside 0 to 1 is ignored for the default, as toWebp's canvas.toBlob ignores it.
          const quality = Number.isFinite(options.quality) && options.quality >= 0 && options.quality <= 1 ? options.quality : 0.92;
          const photo = { quality: Math.max(1, quality * 100) };
          // The canvas shows the capture's viewBox: the measurement moves into it the way SnapDOM
          // drew the root (its outer shadow, transform and clip window), or, where it cannot, the
          // whole capture stays exact.
          const both = o => Number.isFinite(o.width) && Number.isFinite(o.height);
          const fitted = both(context) && !safari(), exported = both(options) && firefox() && options;
          const shot = inView(context[SNAPSHOT], context.meta, fitted, exported, options.crop);
          // WebKit draws a clip window's positioned boxes as if the window began at the element's corner
          // (SnapDOM 3.7.2): in Safari the text stays exact in both places.
          const unclipped = shot && safari() && context.meta?.clip ? inView(context[SNAPSHOT], { ...context.meta, clip: null }, fitted, exported, options.crop) : null;
          const area = {};

          // Below 1:1, text boxes map through the drawn scale (outward to whole pixels) so glyphs
          // stay exact, and photos still take the quality. With no photos left the page stays exact;
          // with photos, the smaller of that file and the whole page exact wins, so a scaled export
          // is never larger.
          const naturalW = shot?.box.width, naturalH = shot?.box.height;
          const below = !!(shot && naturalW && naturalH &&
            (canvas.width < Math.floor(naturalW) || canvas.height < Math.floor(naturalH)));
          const measured = [shot, unclipped].filter(Boolean).map(s => pageRects(s, canvas, { area, edges: !below && (effort ?? 3) >= 4 }));
          let rects = quality < 1 && !exactOnly && measured.length
            ? { exactRects: measured.flatMap(r => r.exactRects), photoRects: measured.flatMap(r => r.photoRects),
              ...(measured.every(r => r.textComplete === true) && { textComplete: true }) } : null;
          // A page SnapDOM had to shrink to its canvas limit is drawn with its text moved from where
          // the page has it, so the rectangles cannot follow: it stays exact.
          if (below && (!rects?.photoRects?.length || atLimit(canvas))) rects = null;
          // Text over a photograph: one more draw, the capture with its text alone (textMask), gives the encoder the
          // page without its text, so the photograph under the letters takes the quality and the letters stay exact.
          if (rects && !below) {
            const under = await abortable(withoutText(context, options, canvas, rects), signal).catch(error => { if (signal?.aborted) throw error; return null; });
            if (under) rects = { ...rects, withoutText: under };
          }

          const base = { ...(effort !== undefined && { effort }), ...(webgpu !== undefined && { webgpu }), ...(signal && { signal }) };
          // The encoder's progress up to 1; the export's 1 comes after its record (the record, the abort check, then 1).
          const rising = onProgress && (f => { if (f < 1) return observe(onProgress, f); });
          const file = below && rects
            ? await smaller(encoder, canvas, base, [{ fidelity: photo, ...rects }, { fidelity: 'exact' }], { signal, onProgress: rising })
            : await encoder.capture(canvas, {
              ...(rects ? { fidelity: photo, ...rects } : { fidelity: 'exact' }),
              ...base, ...(rising && { onProgress: rising }),
            });
          // An encoder that finished after the abort still loses to it.
          signal?.throwIfAborted();
          bytesOf(file);
          // The capture's record, read from its result: exact, and whether unboxed text was looked for.
          const record = { exact: file.kept === 'pixels', ...(file.textMarks && { textMarks: file.textMarks }) }, { exact } = record;
          if (onEncoded != null) await observe(onEncoded, record);
          signal?.throwIfAborted();
          if (onProgress != null) await observe(onProgress, 1);
          signal?.throwIfAborted();
          return { blob: new Blob([bytesOf(file)], { type: 'image/jxl' }), canvas, exact, own: canvas !== suppliedCanvas };
        } catch (error) {
          if (canvas !== suppliedCanvas) free(canvas);
          throw error;
        }
      };
      // A canvas the browser handed over blank (WebKit under load: a white canvas where the page has photographs) is
      // refused by the capture with JXL_PLATFORM; SnapDOM draws it once more. A canvas the caller supplied is not redrawn.
      const encoded = async (context, options) => {
        const callbacks = {failed: false};
        try { return await encodedOnce(context, options, callbacks); } catch (error) {
          if (callbacks.failed) throw error;
          const asked = context.export?.requestedOptions ?? {}, signal = options.signal !== undefined ? options.signal : asked.signal;
          if (!blankCanvas(error) || options.canvas || signal?.aborted) throw error;
          return encodedOnce(context, options, callbacks);
        }
      };
      const encode = async (context, options) => {
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
          const { blob, canvas: drawn, exact, own } = await encoded(context, options);
          return image(blob, drawn, own, options.dpr || 1, signalOf(context, options), exact);
        },
        blob: (context, options = {}) => isJxl(context, options) ? encode(context, options) : exports.blob(options),
        async download(context, options = {}) {
          const format = isJxl(context, options) ? 'jxl' : options.format === 'jpg' ? 'jpeg' : options.format || 'png';
          const name = options.filename || 'snapdom';
          const filename = /\.(png|jpe?g|webp|svg|jxl)$/i.test(name) ? name : `${name}.${format}`;
          const next = { ...options, dpr: 1 };
          const blob = format === 'jxl' ? await encode(context, next) : await exports.blob({ ...next, format });
          signalOf(context, options)?.throwIfAborted();
          await save(blob, filename);
        },
      };
    },
  };
}

const SNAPSHOT = Symbol('jxl measurement');
// SnapDOM's raster limits: 32767 pixels a side (16384 in Safari) and 16384 * 16384 in all.
const atLimit = ({ width, height }) => [16384, 32767].includes(Math.max(width, height)) || width * height > 0.99 * 16384 * 16384;
const MAX_PIXELS = 16384 * 16384;
let decoder = null, complete = null;

// The default module, the one encoder import here (in a browser it runs in its own worker), so a bundler ships no
// other module; capture and upload arrive only as the `codec` the app imports.
const COMPLETE = 'jpegxl/capture-complete';
const MODULES = [COMPLETE, 'jpegxl/capture', 'jpegxl/upload'];
const door = () => complete ??= import('jpegxl/capture-complete').catch(error => { complete = null; throw needs(error); });
const needs = error => new Error('The jxl plugin needs jpegxl 8.4.0 or later: npm install jpegxl', { cause: error });

// SnapDOM draws <html> without the top margins that collapse through its first children (<body>'s
// own included), so what lies in <body>'s flow is drawn higher by that much; a box positioned on the
// page itself is not. Those boxes are measured on their own, and the rest moves up.
function measured(measure, element, edges, keep) {
  const lift = keep ? liftOf(element) : 0;
  if (!lift) return measure(element, { edges, keep });
  const placed = onPage(element.ownerDocument.body), inFlow = new Set(keep);
  for (const el of placed) inFlow.delete(el);
  const up = r => ({ ...r, top: r.top - lift, bottom: r.bottom - lift });
  const shot = measure(element, { edges, keep: inFlow });
  shot.text = shot.text.map(t => ({ ...t, r: up(t.r) }));
  shot.photos = shot.photos.map(up);
  if (shot.edges) shot.edges = shot.edges.map(up);
  for (const el of placed) {
    if (!keep.has(el)) continue;
    const own = measure(el, { edges, keep });
    shot.text.push(...own.text);
    shot.photos.push(...own.photos);
    if (shot.edges) shot.edges.push(...own.edges);
  }
  return shot;
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

// The outermost absolute or fixed boxes in <body> whose containing block is the page.
function onPage(body) {
  const placed = [];
  const fixedBlock = s => s.transform !== 'none' || s.perspective !== 'none' || s.filter !== 'none' ||
    /layout|content|paint|strict/.test(s.contain) || /transform|perspective|filter/.test(s.willChange);
  const visit = (el, absolute, fixed) => {
    for (const child of el.children) {
      const s = getComputedStyle(child);
      if (s.position === 'absolute' && absolute || s.position === 'fixed' && fixed) { placed.push(child); continue; }
      visit(child, absolute && s.position === 'static' && !fixedBlock(s), fixed && !fixedBlock(s));
    }
  };
  const s = getComputedStyle(body);
  visit(body, s.position === 'static' && !fixedBlock(s), !fixedBlock(s));
  return placed;
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
// An export's crop is a window of the viewBox, drawn 1:1 (SnapDOM's cropSvgText), never a downscale: the box is the
// window; over a fitted capture or a fitted export the capture stays exact.
function inView(shot, meta, fitted, exported, crop) {
  if (!shot?.frame || !meta || !Number.isFinite(meta.vbW)) return null;
  const { contentX = 0, contentY = 0, vbW, vbH, clip, targetW, targetH } = meta, { toDrawn } = shot.frame;
  let width = vbW, height = vbH, left = 0, top = 0;
  const fit = (w, h) => { const k = Math.min(w / width, h / height); width = w / k; height = h / k; };
  if (crop) {
    if (fitted && targetW && targetH || exported) return null;
    left = Math.max(0, crop.x); top = Math.max(0, crop.y);
    width = Math.min(vbW, crop.x + crop.width) - left; height = Math.min(vbH, crop.y + crop.height) - top;
    if (!(width > 0 && height > 0)) return null;
  } else {
    if (fitted && targetW && targetH) fit(targetW, targetH);
    if (exported) fit(exported.width, exported.height);
  }
  const dx = contentX - (clip?.x ?? 0) - left + (crop ? 0 : (width - vbW) / 2), dy = contentY - (clip?.y ?? 0) - top + (crop ? 0 : (height - vbH) / 2);
  const move = r => {
    const ps = [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]].map(([x, y]) => toDrawn({ x, y }));
    const xs = ps.map(p => p.x + dx), ys = ps.map(p => p.y + dy);
    return { ...r, left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
  };
  return {
    box: { left: 0, top: 0, width, height },
    text: shot.text.map(t => ({ ...t, r: move(t.r) })),
    photos: shot.photos.map(move),
    ...(shot.textComplete === true && { textComplete: true }),
    ...(shot.edges && { edges: shot.edges.map(move) }),
  };
}

// Text over a photograph, SnapDOM's way: the export's own SVG drawn once more with every text white and all else
// transparent (a layer first in its first <style>, so its important rules win), on the export's canvas (the crop as the
// source rectangle). Its alpha is the text. Images are hidden, so a capture whose originals an export restored draws the
// same mask. WebKit redraws a page's shadows as filters and moves its letters by up to 2 px, so there the mask grows by
// 2 px; a first draw that comes back empty is drawn again (WebKit). null where there is no SVG, no text over a
// photograph, or no mask: the text boxes stay exact.
const MASK = encodeURIComponent('@layer snapdom-mask{*{color:#fff!important;-webkit-text-fill-color:#fff!important;' +
  'background:none!important;border-color:transparent!important;box-shadow:none!important;text-shadow:none!important;' +
  'outline:none!important}img,video,canvas,iframe,foreignObject svg{visibility:hidden!important}}');
async function withoutText(context, options, canvas, rects) {
  if (typeof HTMLCanvasElement === 'undefined' || !(canvas instanceof HTMLCanvasElement)) return null;
  const over = rects.exactRects.filter(r => !r.edge && rects.photoRects.some(p => r.x < p.x + p.width && p.x < r.x + r.width && r.y < p.y + p.height && p.y < r.y + r.height));
  const url = over.length ? context.export?.url : null, meta = context.meta;
  if (typeof url !== 'string' || !url.startsWith('data:image/svg+xml') || !meta || !Number.isFinite(meta.vbW)) return null;
  // SnapDOM's URL is encodeURIComponent of the SVG: the layer goes in after the first <style ...>, the URL left encoded.
  const at = url.search(/%3Cstyle(%20|%3E)/), end = at < 0 ? -1 : url.indexOf('%3E', at) + 3;
  if (end < 3) return null;
  const img = new Image();
  img.src = url.slice(0, end) + MASK + url.slice(end);
  await img.decode();
  const { width: w, height: h } = canvas, crop = options.crop, kx = img.naturalWidth / meta.vbW, ky = img.naturalHeight / meta.vbH;
  const draw = document.createElement('canvas');
  draw.width = w; draw.height = h;
  const g = draw.getContext('2d', { willReadFrequently: true });
  let alpha = null;
  try {
    for (let tries = 0; tries < 2 && !alpha; tries++) {
      g.clearRect(0, 0, w, h);
      if (crop) {
        const x = Math.max(0, crop.x), y = Math.max(0, crop.y);
        g.drawImage(img, x * kx, y * ky, (Math.min(meta.vbW, crop.x + crop.width) - x) * kx, (Math.min(meta.vbH, crop.y + crop.height) - y) * ky, 0, 0, w, h);
      } else g.drawImage(img, 0, 0, w, h);
      const a = g.getImageData(0, 0, w, h).data;
      for (let i = 3; i < a.length; i += 4) if (a[i]) { alpha = a; break; }
    }
  } finally { free(draw); }
  if (!alpha) return null;
  // A shadow with a length, read in the encoded URL (a declaration ends at ;, } or ").
  const grow = safari() && /(box|text)-shadow%3A(?:[^%]|%(?!3B|7D|22))*?px/i.test(url) ? 2 : 0;
  let mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = alpha[i * 4 + 3] ? 1 : 0;
  if (grow) {
    const out = new Uint8Array(mask.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x])
      for (let dy = Math.max(0, y - grow); dy <= Math.min(h - 1, y + grow); dy++) out.fill(1, dy * w + Math.max(0, x - grow), dy * w + Math.min(w - 1, x + grow) + 1);
    mask = out;
  }
  // The page without its text: each text sample takes the nearest sample left of it on its row that is not text (or
  // right of it, at a row's start), changed where it would equal the drawn one, so every text sample differs.
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data, under = new Uint8ClampedArray(data);
  for (let y = 0; y < h; y++) {
    let last = -1;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) { last = i; continue; }
      let from = last;
      if (from < 0) for (let r = x + 1; r < w; r++) if (!mask[y * w + r]) { from = y * w + r; break; }
      if (from >= 0) under.set(data.subarray(from * 4, from * 4 + 4), i * 4);
      if (under[i * 4] === data[i * 4] && under[i * 4 + 1] === data[i * 4 + 1] && under[i * 4 + 2] === data[i * 4 + 2]) under[i * 4] ^= 1;
    }
  }
  return { data: under, width: w, height: h, rects: over.map(({ x, y, width, height }) => ({ x, y, width, height })) };
}

// Where JPEG XL does not display (found on the first try, then remembered), a PNG of the exact
// canvas, or of jpegxl/decode's copy (loaded only then). The saved Blob stays JPEG XL. The image
// takes the drawn canvas's CSS size; its own canvases are emptied once read.
let showsJxl;
async function image(blob, drawn, own, dpr, signal, exact) {
  const img = new Image(), wait = promise => abortable(promise, signal);
  const { width, height } = drawn?.style ?? {};
  let decoded = null;
  try {
    try {
      if (showsJxl === false) throw new Error('JPEG XL does not display here');
      await wait(shown(img, await wait(dataURL(blob))));
      showsJxl = true;
    } catch {
      if (signal?.aborted) throw signal.reason;
      if (showsJxl === undefined) showsJxl = false;
      if (!exact) {
        decoder ??= import('jpegxl/decode').catch(error => { decoder = null; throw needs(error); });
        const { data, width: w, height: h } = await wait((await wait(decoder)).decode(blob, { format: 'uint8', colorSpace: 'srgb', maxPixels: MAX_PIXELS, ...(signal && { signal }) }));
        decoded = document.createElement('canvas');
        decoded.width = w;
        decoded.height = h;
        decoded.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), w, h), 0, 0);
      }
      const source = decoded ?? drawn;
      await wait(shown(img, await wait(dataURL(await wait(new Promise(resolve => source.toBlob(resolve, 'image/png')))))));
    }
  } finally {
    if (own) free(drawn);
    free(decoded);
  }
  signal?.throwIfAborted();
  img.style.width = width || `${img.naturalWidth / dpr}px`;
  img.style.height = height || `${img.naturalHeight / dpr}px`;
  return img;
}

// A canvas holds its pixels until it is emptied, even once nothing reads it. Only the export's own
// canvases are emptied, never one the app passed as `canvas`.
// The capture's refusal of a canvas that reads back blank where its rectangles hold content (JXL_PLATFORM; its words, which cross
// a worker, say "blank" in every jpegxl version).
const blankCanvas = error => error?.code === 'JXL_PLATFORM' && /\bblank\b/.test(error?.message ?? '');

function free(canvas) {
  if (typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement) canvas.width = canvas.height = 0;
}

const shown = (img, src) => new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = src; })
  .finally(() => { img.onload = img.onerror = null; });

const dataURL = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

// iOS saves a file only through the share sheet.
async function save(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  const ios = navigator.userAgentData ? navigator.userAgentData.platform === 'iOS'
    : /iPhone|iPad|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  if (ios && navigator.canShare?.({ files: [file] })) {
    // Closing the sheet is the person's choice; any other refusal is the export's failure.
    try { await navigator.share({ files: [file], title: filename }); } catch (error) { if (error.name !== 'AbortError') throw error; }
    return;
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

// Below 1:1, encode each candidate quietly and keep the smallest. Progress runs 0 to 1 across the candidates without
// restarting; the export reports its 1 after the record.
async function smaller(encoder, canvas, base, jobs, hooks) {
  const span = 1 / jobs.length;
  let best = null;
  for (let i = 0; i < jobs.length; i++) {
    const result = await encoder.capture(canvas, {
      ...base, ...jobs[i],
      onProgress: hooks.onProgress && (f => { if (f < 1) return hooks.onProgress(i * span + f * span); }),
    });
    if (result.meetsTarget && result.bytes && (!best || result.bytes.byteLength < best.bytes.byteLength)) best = result;
  }
  hooks.signal?.throwIfAborted();
  bytesOf(best);
  hooks.signal?.throwIfAborted();
  return best;
}

function bytesOf(result) {
  if (!result?.meetsTarget || !result.bytes) {
    throw Object.assign(new Error(result?.reason?.message ?? "No output meets the target; adjust fidelity or size."),
      { code: result?.reason?.code ?? 'JXL_UNSUPPORTED' });
  }
  return result.bytes;
}

function abortable(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (settle, value) => {
      if (done) return;
      done = true;
      try { signal.removeEventListener('abort', stop); }
      catch (reason) { if (settle === resolve) { reject(reason); return; } }
      settle(value);
    };
    const stop = () => {
      try { if (signal.aborted) finish(reject, signal.reason); }
      catch (reason) { finish(reject, reason); }
    };
    Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
    try { signal.addEventListener('abort', stop, { once: true }); stop(); }
    catch (reason) { finish(reject, reason); }
  });
}
