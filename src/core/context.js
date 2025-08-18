// src/core/context.js
// import { getGlobalPlugins, normalizePlugins } from './plugins';

import { preCache } from "../api/preCache";

/**
 * Creates a unified configuration context
 * @param {Object} options - User options
 * @returns {Object} Context with clear format/type separation
 */
export function createContext(options = {}) {
  return {
    // Core Capture
    debug: options.debug ?? false,
    compress: options.compress ?? true,
    fast: options.fast ?? true,
    scale: options.scale ?? 1,
    exclude: options.exclude ?? [],
    filter: options.filter ?? null,
    embedFonts: options.embedFonts ?? false,
    iconFonts: options.iconFonts ?? [],
    localFonts: options.localFonts ?? [],
    preCached: options.preCached ?? false,
    reset: options.reset ?? false,
    // Output Configuration
    width: options.width ?? null,
    height: options.height ?? null,
    format: options.format ?? 'png',  // 'png'|'jpg'|'jpeg'|'webp'|'svg' 
    type: options.type ?? 'svg',       
    quality: options.quality ?? 0.92,
    dpr: options.dpr ?? (window.devicePixelRatio || 1),
    backgroundColor: options.backgroundColor ?? 
                   (['jpg','jpeg','webp'].includes(options.format) ? '#ffffff' : null),
    filename: options.filename ?? `snapDOM`,

    // Plugins
   /*  plugins: normalizePlugins(
      options.ignoreGlobalPlugins 
        ? options.plugins ?? []
        : [...getGlobalPlugins(), ...(options.plugins ?? [])],
      options.debug
    ) */
  };
}