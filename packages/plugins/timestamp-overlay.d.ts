/**
 * Type declarations for `@zumer/snapdom-plugins/timestamp-overlay`.
 *
 * The plugin instance type comes from the core package: one definition of what a plugin IS,
 * so a plugin that stops matching the host's contract fails to typecheck instead of failing
 * at capture time.
 */
import type { SnapdomPlugin } from '@zumer/snapdom';

export interface TimestampOverlayOptions {
  format?: 'datetime' | 'date' | 'time' | 'iso' | ((date: Date) => string);
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  background?: string;
  color?: string;
  fontSize?: number;
}

/** Adds a timestamp label, evaluating the clock/formatter again for every capture. */
export declare function timestampOverlay(options?: TimestampOverlayOptions): SnapdomPlugin;
