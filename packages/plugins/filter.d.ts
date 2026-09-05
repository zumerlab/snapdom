/**
 * Type declarations for `@zumer/snapdom-plugins/filter`.
 *
 * The plugin instance type comes from the core package: one definition of what a plugin IS,
 * so a plugin that stops matching the host's contract fails to typecheck instead of failing
 * at capture time.
 */
import type { SnapdomPlugin } from '@zumer/snapdom';

export interface FilterOptions {
  /** CSS filter string, e.g. 'grayscale(1) blur(2px)'. Ignored when `preset` is set. */
  filter?: string;
  preset?: 'grayscale' | 'sepia' | 'blur' | 'invert' | 'vintage' | 'dramatic';
}

/** Applies CSS filter effects, overriding authored filters. Unchanged captures may reuse a memo. */
export declare function filter(options?: FilterOptions): SnapdomPlugin;
