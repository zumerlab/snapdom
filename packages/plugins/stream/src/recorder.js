/**
 * Record any canvas a stream feeds (the stream's own, or one it is composited into over
 * video) with the native MediaRecorder. The container follows the browser: Safari records
 * MP4, Chromium and Firefox WebM unless they support MP4.
 * @module plugins/stream/recorder
 */

const TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']

/**
 * Start recording `canvas`.
 * @param {HTMLCanvasElement} canvas
 * @param {{fps?: number, duration?: number, bitrate?: number}} [options] - fps default 30;
 *   with `duration` (ms) the recording stops by itself.
 * @returns {{done: Promise<Blob>, stop: () => Promise<Blob>, type: string}}
 */
export function recordCanvas(canvas, options = {}) {
  if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
    throw new Error('[SnapDOM] stream: recording needs MediaRecorder and canvas.captureStream')
  }
  const type = TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || ''
  const recorder = new MediaRecorder(canvas.captureStream(options.fps ?? 30), {
    mimeType: type, videoBitsPerSecond: options.bitrate,
  })
  const chunks = []
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  const done = new Promise((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || type }))
    recorder.onerror = (e) => reject(e.error || e)
  })
  recorder.start(1000)
  if (options.duration) setTimeout(() => recorder.state !== 'inactive' && recorder.stop(), options.duration)
  return {
    done,
    type: recorder.mimeType || type,
    stop() {
      if (recorder.state !== 'inactive') recorder.stop()
      return done
    },
  }
}
