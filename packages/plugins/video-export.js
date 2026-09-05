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
 * @param {number} [options.scale] - Capture scale (inherits the capture when omitted)
 * @param {number} [options.bitrate] - videoBitsPerSecond passed to MediaRecorder
 * @param {string} [options.filename] - Download filename (default follows the recorded container)
 * @returns {Object} SnapDOM plugin
 */
import { rememberCanvas, exportOption, frameOptions } from './capture-frames.js';

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
    scale,
    bitrate = null,
    filename = null,
  } = options;

  return {
    name: 'video-export',

    defineExports(context) {
      rememberCanvas(context);
      return {
        mp4: async (ctx, opts = {}) => {
          if (typeof MediaRecorder === 'undefined') {
            throw new Error('[snapdom] video-export: MediaRecorder is not available in this environment');
          }
          if (typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
            throw new Error('[snapdom] video-export: canvas.captureStream is not available in this environment');
          }
          const el = ctx.element;
          if (!el) throw new Error('[snapdom] video-export: no source element on context');

          const recording = frameOptions(ctx, opts, { fps, duration, frames: frameOpt, scale, background }, 'video-export');
          const { fps: _fps, count: _count, background: _bg } = recording;
          const _bitrate = exportOption(ctx, opts, 'bitrate', bitrate);
          const frameMs = 1000 / _fps;

          // 1) Recapture the live first frame, retaining the caller's capture policy.
          // Later frames use the same options and the engine's normal freshness checks.
          const firstSrc = await recording.next();
          const W = firstSrc.width, H = firstSrc.height;

          // 2) Pick the best supported container/codec.
          const mimeType = MIME_CANDIDATES.find(t =>
            typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(t)
          ) || '';
          if (mimeType && !mimeType.startsWith('video/mp4')) {
            console.warn(`[snapdom] video-export: MP4 not supported by this browser's MediaRecorder; falling back to ${mimeType}`);
          }

          // 3) Request each painted frame where supported. MediaRecorder uses a real-time
          // clock: slow captures can still stretch timing; requestFrame supplies no timestamp.
          const stage = document.createElement('canvas');
          stage.width = W; stage.height = H;
          const sctx = stage.getContext('2d');
          const paint = (src) => {
            sctx.fillStyle = _bg;
            sctx.fillRect(0, 0, W, H);
            sctx.drawImage(src, 0, 0, W, H);
          };
          const recOpts = {};
          if (mimeType) recOpts.mimeType = mimeType;
          if (_bitrate) recOpts.videoBitsPerSecond = _bitrate;
          const chunks = [];
          let stream, rec;
          try {
            stream = stage.captureStream(0);
            let track = stream.getVideoTracks()[0];
            if (!track) throw new Error('[snapdom] video-export: captureStream produced no video track');
            if (typeof track.requestFrame !== 'function') {
              // A zero-rate track without requestFrame never receives later paintings.
              for (const t of stream.getTracks()) t.stop();
              stream = stage.captureStream(_fps);
              track = stream.getVideoTracks()[0];
              if (!track) throw new Error('[snapdom] video-export: captureStream produced no video track');
            }
            const pushFrame = () => track.requestFrame?.();
            rec = new MediaRecorder(stream, recOpts);
            rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
            const stopped = new Promise(resolve => { rec.onstop = resolve; });
            const failed = new Promise((_, reject) => {
              rec.onerror = event => reject(event.error || new Error('[snapdom] video-export: MediaRecorder failed'));
            });
            // An error can arrive between awaited frame operations. Mark it handled now;
            // every wait below still observes the original rejection and exits the recorder.
            failed.catch(() => {});
            const wait = promise => Promise.race([promise, failed]);
            const sleep = ms => wait(new Promise(resolve => setTimeout(resolve, ms)));

            rec.start();
            paint(firstSrc);
            pushFrame();
            // Hold the first frame too; immediately painting the second used to erase it.
            await sleep(frameMs);
            for (let i = 1; i < _count; i++) {
              const t0 = performance.now();
              paint(await wait(recording.next()));
              pushFrame();
              const remaining = frameMs - (performance.now() - t0);
              // Give the last painting a full frame interval before stopping the encoder.
              if (i === _count - 1 || remaining > 0) await sleep(i === _count - 1 ? frameMs : remaining);
            }
            rec.stop();
            await wait(stopped);
          } finally {
            if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch { /* already failed */ } }
            for (const track of stream?.getTracks() || []) track.stop();
          }

          const actualType = (rec.mimeType || chunks.find(chunk => chunk.type)?.type || mimeType || 'video/webm').split(';')[0];
          const isMp4 = actualType.startsWith('video/mp4');
          const blob = new Blob(chunks, { type: actualType });

          const dl = opts.download;
          if (dl) {
            const objUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objUrl;
            const fallbackName = isMp4 ? 'capture.mp4' : 'capture.webm';
            a.download = typeof dl === 'string' ? dl : exportOption(ctx, opts, 'filename', filename || fallbackName);
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
