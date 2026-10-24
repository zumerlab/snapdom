import type { SnapdomOptions, SnapdomPlugin } from '@zumer/snapdom'

/** One repaint of a stream: the rects of `canvas` that changed, in canvas pixels. */
export interface StreamFrame {
  /** True when the whole canvas was repainted; `reason` says why. */
  full: boolean
  reason: string | null
  rects: { x: number; y: number; width: number; height: number }[]
  ms: number
  canvas: HTMLCanvasElement
}

export interface StreamOptions extends SnapdomOptions {
  onFrame?: (frame: StreamFrame) => void
  /** Cap on frames per second; default every animation frame. */
  fps?: number
  /** false repaints full frames only. Default true. */
  patches?: boolean
}

export interface Stream {
  canvas: HTMLCanvasElement
  ready: Promise<void>
  stats: { full: number; patch: number; skipped: number; lastMs: number }
  stop(): void
}

/**
 * Stream a live element into a canvas that repaints only the boxes that changed: the
 * first frame is a full capture, later frames capture and redraw just the changed
 * subtrees, and anything that cannot be patched exactly is a full frame.
 */
export function stream(element: Element, options?: StreamOptions): Stream

/** Plugin form: adds `result.toStream(options)` to a capture result. */
export function streamExport(defaults?: StreamOptions): SnapdomPlugin

/** A WebGL texture kept in step with a stream; `update` uploads only the changed rects on WebGL2. */
export function streamTexture(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  options?: { filter?: number }
): { texture: WebGLTexture; width: number; height: number; update(frame: StreamFrame): number }

/** Record a canvas with MediaRecorder; `duration` (ms) stops it by itself. */
export function recordCanvas(
  canvas: HTMLCanvasElement,
  options?: { fps?: number; duration?: number; bitrate?: number }
): { done: Promise<Blob>; stop(): Promise<Blob>; type: string }
