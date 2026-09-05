/**
 * Type declarations for `@zumer/snapdom-plugins/color-tint`.
 *
 * The plugin instance type comes from the core package: one definition of what a plugin IS,
 * so a plugin that stops matching the host's contract fails to typecheck instead of failing
 * at capture time.
 */
import type { SnapdomPlugin } from '@zumer/snapdom';

export interface ColorTintOptions {
  /** CSS color value. */
  color?: string;
  /** Overlay opacity, 0-1. */
  opacity?: number;
}

/** Tints an HTML capture using mix-blend-mode. Opacity zero leaves it unchanged; repeats may reuse a memo. */
export declare function colorTint(options?: ColorTintOptions): SnapdomPlugin;
