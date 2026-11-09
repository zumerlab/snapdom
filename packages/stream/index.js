/**
 * @zumer/snapdom-stream
 * A live element as a canvas that repaints only what changed. `stream(el)` is the entry;
 * `streamExport()` adds the same to a capture result as `toStream()`.
 *
 *   import { stream, streamTexture, recordCanvas } from '@zumer/snapdom-stream'
 *
 * Up to @zumer/snapdom-plugins 4.x the same code shipped at that package's `/stream` subpath.
 */
export { stream, streamExport, streamTexture, recordCanvas, overlayStage, scoreboard, lowerThird, ticker, liveBadge } from './src/index.js'
