import type { SnapdomOptions, SnapdomPlugin } from '@zumer/snapdom'

/** One repaint of a stream: the rects of `canvas` that changed, in canvas pixels. */
export interface StreamFrame {
  /** True when the whole canvas was repainted; `reason` says why. */
  full: boolean
  reason: string | null
  rects: { x: number; y: number; width: number; height: number }[]
  /** Wall time of the repaint. */
  ms: number
  /** The part of `ms` the stream's own work held the main thread: the turns between windows and the decodes are out, a full frame's capture counts whole. */
  busyMs: number
  canvas: HTMLCanvasElement
}

export interface StreamOptions extends SnapdomOptions {
  onFrame?: (frame: StreamFrame) => void
  /** Cap on frames per second; default every animation frame. */
  fps?: number
  /** false repaints full frames only. Default true. */
  patches?: boolean
  /** false stops following running animations and transitions: an animated box keeps its last drawn pixels until something else repaints it. Default true. */
  animations?: boolean
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

declare module '@zumer/snapdom' {
  interface CaptureResult {
    toStream(options?: StreamOptions): Promise<Stream>
  }
}

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

/** The transparent stage every overlay template sits on; stream this element. */
export function overlayStage(options?: { width?: number; height?: number; theme?: Record<string, string> }): HTMLDivElement

export interface ScoreboardClock { start(): void; stop(): void; reset(seconds?: number): void; set(text: string): void }

/** Two teams, their points and a running clock. */
export function scoreboard(options?: { home?: string; away?: string; homeColor?: string; awayColor?: string }): {
  el: HTMLElement
  score(home: number, away: number): void
  add(side: 'home' | 'away', n?: number): void
  clock: ScoreboardClock
}

/** A name and a role that slide in and out. */
export function lowerThird(options?: { name?: string; role?: string; visible?: boolean }): {
  el: HTMLElement
  set(fields: { name?: string; role?: string }): void
  show(): void
  hide(): void
}

/** A scrolling news line; speed is seconds per loop. */
export function ticker(options?: { label?: string; items?: string[]; speed?: number }): { el: HTMLElement; set(items: string[]): void }

/** A pulsing LIVE bug. */
export function liveBadge(options?: { text?: string }): { el: HTMLElement; set(text: string): void }
