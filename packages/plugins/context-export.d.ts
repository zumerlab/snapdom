/**
 * Type declarations for `@zumer/snapdom-plugins/context-export`.
 *
 * The plugin instance type comes from the core package: one definition of what a plugin IS,
 * so a plugin that stops matching the host's contract fails to typecheck instead of failing
 * at capture time.
 */
import type { SnapdomPlugin } from '@zumer/snapdom';

export interface ContextExportOptions {
  format?: 'outline' | 'json';
  /** Per-node text cap; longer text is ellipsised. */
  maxTextLength?: number;
  /** Hard cap on nodes; the output notes the truncation. */
  maxNodes?: number;
  /** Include bounding boxes. */
  geometry?: boolean;
  /** How far the capture runs. */
  needs?: 'clone' | 'render';
}

/** Adds `result.toContext()`: the captured tree as a text outline or JSON instead of pixels. */
export declare function contextExport(options?: ContextExportOptions): SnapdomPlugin;

export default contextExport;
