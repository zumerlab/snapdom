/**
 * Type declarations for `@zumer/snapdom-plugins`.
 *
 * The plugin instance type comes from the core package: one definition of what a plugin IS,
 * so a plugin that stops matching the host's contract fails to typecheck instead of failing
 * at capture time.
 */
export * from './filter.js';
export * from './color-tint.js';
export * from './replace-text.js';
export * from './timestamp-overlay.js';
export * from './redact-inputs.js';
export * from './ascii-export.js';
export * from './pdf-image.js';
export * from './html-export.js';
export * from './gif-export.js';
export * from './video-export.js';
export * from './agent-map.js';
export * from './context-export.js';
