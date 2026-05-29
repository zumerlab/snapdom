/**
 * gifExport - Official SnapDOM Plugin
 * Adds a toGif() export that records an animated GIF by re-capturing the live
 * element over time and encoding the frames (median-cut quantization + LZW,
 * GIF89a, no dependencies).
 *
 * Returns a Blob (image/gif). Use opts.download to also trigger a file download.
 *
 * @param {Object} [options]
 * @param {number}  [options.fps=10] - Frames per second
 * @param {number}  [options.duration=2000] - Total duration in ms (ignored if options.frames is set)
 * @param {number}  [options.frames] - Explicit frame count (overrides duration)
 * @param {number}  [options.maxColors=256] - Palette size per frame (2-256)
 * @param {string}  [options.background='#ffffff'] - Color composited under transparent pixels
 * @param {number}  [options.scale=1] - Capture scale
 * @param {number}  [options.repeat=0] - Loop count (0 = forever, -1 = play once)
 * @param {string}  [options.filename='capture.gif'] - Download filename
 * @returns {Object} SnapDOM plugin
 */
import { snapdom } from '@zumer/snapdom';

export function gifExport(options = {}) {
  const {
    fps = 10,
    duration = 2000,
    frames: frameOpt = null,
    maxColors = 256,
    background = '#ffffff',
    scale = 1,
    repeat = 0,
    filename = 'capture.gif',
  } = options;

  return {
    name: 'gif-export',

    // The export ctx comes from createContext (no `element`). Stash the live
    // element during a capture hook so toGif() can re-capture frames from it.
    beforeSnap(ctx) {
      if (ctx && ctx.options) ctx.options.__snapSource = ctx.element;
    },

    defineExports() {
      return {
        gif: async (ctx, opts = {}) => {
          const el = ctx.__snapSource || ctx.element;
          if (!el) throw new Error('[snapdom] gif-export: no source element on context');

          const _fps = opts.fps ?? fps;
          const _dur = opts.duration ?? duration;
          const _count = Math.max(1, opts.frames ?? frameOpt ?? Math.round((_dur / 1000) * _fps));
          const _max = Math.min(256, Math.max(2, opts.maxColors ?? maxColors));
          const _bg = opts.background ?? background;
          const _scale = opts.scale ?? scale ?? ctx.scale ?? 1;
          const _repeat = opts.repeat ?? repeat;
          const delayCs = Math.max(2, Math.round(100 / _fps)); // GIF delay unit is 1/100 s

          let W = 0, H = 0;
          const frames = [];
          for (let i = 0; i < _count; i++) {
            const cap = await snapdom(el, { scale: _scale, backgroundColor: _bg, fast: true });
            const src = await cap.toCanvas();
            if (i === 0) { W = src.width; H = src.height; }
            const fc = document.createElement('canvas');
            fc.width = W; fc.height = H;
            const fx = fc.getContext('2d');
            fx.fillStyle = _bg;
            fx.fillRect(0, 0, W, H);
            fx.drawImage(src, 0, 0, W, H);
            frames.push(fx.getImageData(0, 0, W, H));
            if (i < _count - 1) await new Promise(r => setTimeout(r, 1000 / _fps));
          }

          const bytes = encodeGif(frames, W, H, _max, delayCs, _repeat);
          const blob = new Blob([bytes], { type: 'image/gif' });

          const dl = opts.download;
          if (dl) {
            const objUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objUrl;
            a.download = typeof dl === 'string' ? dl : filename;
            a.click();
            setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
          }
          return blob;
        }
      };
    }
  };
}

/* ── GIF89a encoder (no dependencies) ─────────────────────────────────────── */

function encodeGif(frames, w, h, maxColors, delayCs, repeat) {
  const out = [];
  const byte = b => out.push(b & 0xff);
  const short = s => { out.push(s & 0xff); out.push((s >> 8) & 0xff); };
  const str = s => { for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i)); };

  str('GIF89a');
  short(w); short(h);
  byte(0x70); // no global color table; 8-bit color resolution
  byte(0);    // background color index
  byte(0);    // pixel aspect ratio

  if (frames.length > 1 && repeat >= 0) {
    byte(0x21); byte(0xff); byte(0x0b);
    str('NETSCAPE2.0');
    byte(0x03); byte(0x01);
    short(repeat); // 0 = loop forever
    byte(0x00);
  }

  for (const frame of frames) {
    const { palette, indices, bits } = quantizeFrame(frame.data, maxColors);
    const tableSize = 1 << bits;

    // Graphic Control Extension
    byte(0x21); byte(0xf9); byte(0x04);
    byte(0x00);       // disposal none, no transparency
    short(delayCs);
    byte(0x00);       // transparent color index (unused)
    byte(0x00);

    // Image Descriptor
    byte(0x2c);
    short(0); short(0);
    short(w); short(h);
    byte(0x80 | (bits - 1)); // local color table, size = bits-1

    for (let i = 0; i < tableSize; i++) {
      const c = palette[i] || [0, 0, 0];
      byte(c[0]); byte(c[1]); byte(c[2]);
    }

    const minCodeSize = Math.max(2, bits);
    byte(minCodeSize);
    const lzw = lzwEncode(indices, minCodeSize);
    let p = 0;
    while (p < lzw.length) {
      const n = Math.min(255, lzw.length - p);
      byte(n);
      for (let i = 0; i < n; i++) byte(lzw[p + i]);
      p += n;
    }
    byte(0x00);
  }

  byte(0x3b);
  return new Uint8Array(out);
}

function quantizeFrame(data, maxColors) {
  const hist = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    const e = hist.get(key);
    if (e) e.n++;
    else hist.set(key, { r: data[i], g: data[i + 1], b: data[i + 2], n: 1 });
  }
  const colors = [...hist.values()];
  let palette = colors.length <= maxColors
    ? colors.map(c => [c.r, c.g, c.b])
    : medianCut(colors, maxColors);
  if (palette.length === 0) palette = [[0, 0, 0]];

  let bits = 1;
  while ((1 << bits) < palette.length) bits++;

  const keyToIndex = new Map();
  for (const c of colors) {
    keyToIndex.set((c.r << 16) | (c.g << 8) | c.b, nearest(palette, c.r, c.g, c.b));
  }

  const indices = new Uint8Array(data.length / 4);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    indices[j] = keyToIndex.get((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
  }
  return { palette, indices, bits };
}

function nearest(palette, r, g, b) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = p[0] - r, dg = p[1] - g, db = p[2] - b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) { bestD = d; best = i; if (d === 0) break; }
  }
  return best;
}

function medianCut(colors, maxColors) {
  let boxes = [colors];
  while (boxes.length < maxColors) {
    let bi = -1, bestRange = -1, ch = 'r';
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.length < 2) continue;
      let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
      for (const c of box) {
        if (c.r < rmin) rmin = c.r; if (c.r > rmax) rmax = c.r;
        if (c.g < gmin) gmin = c.g; if (c.g > gmax) gmax = c.g;
        if (c.b < bmin) bmin = c.b; if (c.b > bmax) bmax = c.b;
      }
      const rr = rmax - rmin, gg = gmax - gmin, bb = bmax - bmin;
      const range = Math.max(rr, gg, bb);
      if (range > bestRange) {
        bestRange = range;
        bi = i;
        ch = rr >= gg && rr >= bb ? 'r' : (gg >= bb ? 'g' : 'b');
      }
    }
    if (bi < 0) break;
    const box = boxes[bi];
    box.sort((a, b) => a[ch] - b[ch]);
    const mid = box.length >> 1;
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
  }
  return boxes.map(box => {
    let r = 0, g = 0, b = 0, tot = 0;
    for (const c of box) { r += c.r * c.n; g += c.g * c.n; b += c.b * c.n; tot += c.n; }
    tot = tot || 1;
    return [Math.round(r / tot), Math.round(g / tot), Math.round(b / tot)];
  });
}

function lzwEncode(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let dict = new Map();
  let nextCode = clearCode + 2;

  const out = [];
  let cur = 0, curBits = 0;
  const emit = code => {
    cur |= code << curBits;
    curBits += codeSize;
    while (curBits >= 8) { out.push(cur & 0xff); cur >>>= 8; curBits -= 8; }
  };
  const reset = () => { dict = new Map(); nextCode = clearCode + 2; codeSize = minCodeSize + 1; };

  emit(clearCode);
  if (indices.length === 0) {
    emit(eoiCode);
    if (curBits > 0) out.push(cur & 0xff);
    return out;
  }

  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    if (dict.has(key)) {
      prefix = dict.get(key);
    } else {
      emit(prefix);
      // Grow the code size BEFORE assigning the next code (omggif/GIF semantics):
      // emit the prefix at the current width, then widen. Growing after the
      // increment switches one code too early and desyncs every decoder.
      if (nextCode === 4096) {
        emit(clearCode);
        reset();
      } else {
        if (nextCode >= (1 << codeSize) && codeSize < 12) codeSize++;
        dict.set(key, nextCode++);
      }
      prefix = k;
    }
  }
  emit(prefix);
  emit(eoiCode);
  if (curBits > 0) out.push(cur & 0xff);
  return out;
}

export default gifExport;
