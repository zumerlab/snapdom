/**
 * Type declarations for `@zumer/snapdom-plugins/replace-text`.
 *
 * The plugin instance type comes from the core package: one definition of what a plugin IS,
 * so a plugin that stops matching the host's contract fails to typecheck instead of failing
 * at capture time.
 */
import type { SnapdomPlugin } from '@zumer/snapdom';

export interface TextReplacement {
  find: string | RegExp;
  replace: string;
}

export interface ReplaceTextOptions {
  replacements?: TextReplacement[];
}

/** Replaces DOM text in the clone, leaving stylesheet/script text unchanged. */
export declare function replaceText(options?: ReplaceTextOptions): SnapdomPlugin;
