/**
 * Extracts a URL from a CSS value like background-image.
 *
 * @param {string} value - The CSS value
 * @returns {string|null} The extracted URL or null
 */

export function extractURL(value) {
  const match = value.match(/url\((['"]?)(.*?)(\1)\)/);
  if (!match) return null;

  const url = match[2].trim();
  if (url.startsWith('#')) return null;
  return url;
}

/**
 * Determines if a font family or URL is an icon font.
 *
 * @param {string} familyOrUrl - The font family or URL
 * @returns {boolean} True if it is an icon font
 */
export function isIconFont(familyOrUrl) {
  const iconFontPatterns = [
    /font\s*awesome/i,
    /material\s*icons/i,
    /ionicons/i,
    /glyphicons/i,
    /feather/i,
    /bootstrap\s*icons/i,
    /remix\s*icons/i,
    /heroicons/i,
    /layui/i,
    /lucide/i
  ];
  return iconFontPatterns.some(rx => rx.test(familyOrUrl));
}

export function stripTranslate(transform) {
  if (!transform || transform === 'none') return '';

  let cleaned = transform.replace(/translate[XY]?\([^)]*\)/g, '');

  cleaned = cleaned.replace(/matrix\(([^)]+)\)/g, (_, values) => {
    const parts = values.split(',').map(s => s.trim());
    if (parts.length !== 6) return `matrix(${values})`;
    parts[4] = '0';
    parts[5] = '0';
    return `matrix(${parts.join(', ')})`;
  });

  cleaned = cleaned.replace(/matrix3d\(([^)]+)\)/g, (_, values) => {
    const parts = values.split(',').map(s => s.trim());
    if (parts.length !== 16) return `matrix3d(${values})`;
    parts[12] = '0';
    parts[13] = '0';
    return `matrix3d(${parts.join(', ')})`;
  });

  return cleaned.trim().replace(/\s{2,}/g, ' ');
}

export function safeEncodeURI(uri) {
  if (/%[0-9A-Fa-f]{2}/.test(uri)) return uri; // prevent reencode
  try { return encodeURI(uri);} catch { return uri;}
}
