/**
 * videoExport - Official SnapDOM Plugin
 * Adds a toMp4() export that records a video by re-capturing the live element
 * over time and encoding the frames with the native MediaRecorder.
 *
 * Codec reality: MediaRecorder output depends on the browser. Safari produces
 * MP4 (H.264); Chromium typically produces WebM (VP8/VP9). When MP4 is not
 * supported the plugin falls back to WebM and warns. Returns a Blob whose type
 * reflects what was actually produced.
 *
 * @param {Object} [options]
 * @param {number} [options.fps=10] - Frames per second
 * @param {number} [options.duration=2000] - Total duration in ms (ignored if options.frames is set)
 * @param {number} [options.frames] - Explicit frame count (overrides duration)
 * @param {string} [options.background='#ffffff'] - Color composited under transparent pixels
 * @param {number} [options.scale=1] - Capture scale
 * @param {number} [options.bitrate] - videoBitsPerSecond passed to MediaRecorder
 * @param {string} [options.filename] - Download filename (extension auto-set to .mp4/.webm)
 * @returns {Object} SnapDOM plugin
 */
import { snapdom } from '@zumer/snapdom';

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export function videoExport(options = {}) {
  const {
    fps = 10,
    duration = 2000,
    frames: frameOpt = null,
    background = '#ffffff',
    scale = 1,
    bitrate = null,
    filename = null,
  } = options;

  return {
    name: 'video-export',

    // The export ctx comes from createContext (no `element`). Stash the live
    // element during a capture hook so toMp4() can re-capture frames from it.
    beforeSnap(ctx) {
      if (ctx && ctx.options) ctx.options.__snapSource = ctx.element;
    },

    defineExports() {
      return {
        mp4: async (ctx, opts = {}) => {
          if (typeof MediaRecorder === 'undefined') {
            throw new Error('[snapdom] video-export: MediaRecorder is not available in this environment');
          }
          const el = ctx.__snapSource || ctx.element;
          if (!el) throw new Error('[snapdom] video-export: no source element on context');

          const _fps = opts.fps ?? fps;
          const _dur = opts.duration ?? duration;
          const _count = Math.max(1, opts.frames ?? frameOpt ?? Math.round((_dur / 1000) * _fps));
          const _bg = opts.background ?? background;
          const _scale = opts.scale ?? scale ?? ctx.scale ?? 1;
          const _bitrate = opts.bitrate ?? bitrate;
          const frameMs = 1000 / _fps;

          // 1) Pre-render every frame onto a fixed-size canvas.
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
            frames.push(fc);
            if (i < _count - 1) await new Promise(r => setTimeout(r, frameMs));
          }

          // 2) Pick the best supported container/codec.
          const mimeType = MIME_CANDIDATES.find(t =>
            typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(t)
          ) || '';
          if (mimeType && !mimeType.startsWith('video/mp4')) {
            console.warn(`[snapdom] video-export: MP4 not supported by this browser's MediaRecorder; falling back to ${mimeType}`);
          }

          // 3) Play the frames onto a stage canvas while recording its stream.
          const stage = document.createElement('canvas');
          stage.width = W; stage.height = H;
          const sctx = stage.getContext('2d');
          const stream = stage.captureStream(_fps);

          const recOpts = {};
          if (mimeType) recOpts.mimeType = mimeType;
          if (_bitrate) recOpts.videoBitsPerSecond = _bitrate;
          const rec = new MediaRecorder(stream, recOpts);

          const chunks = [];
          rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
          const stopped = new Promise(res => { rec.onstop = res; });

          rec.start();
          for (let i = 0; i < frames.length; i++) {
            sctx.clearRect(0, 0, W, H);
            sctx.drawImage(frames[i], 0, 0);
            await new Promise(r => setTimeout(r, frameMs));
          }
          await new Promise(r => setTimeout(r, frameMs)); // let the last frame land
          rec.stop();
          await stopped;

          const isMp4 = mimeType.startsWith('video/mp4');
          const blob = new Blob(chunks, { type: (mimeType || 'video/webm').split(';')[0] });

          const dl = opts.download;
          if (dl) {
            const objUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objUrl;
            const fallbackName = isMp4 ? 'capture.mp4' : 'capture.webm';
            a.download = typeof dl === 'string' ? dl : (opts.filename || filename || fallbackName);
            a.click();
            setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
          }
          return blob;
        }
      };
    }
  };
}

export default videoExport;
