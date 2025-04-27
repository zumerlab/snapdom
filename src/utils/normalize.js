/**
 * Normalizes font family names for use in CSS class names
 * @param {string} str - Font family name
 * @returns {string} Normalized font name
 */
export function normalizeFontName(str) {
  return str.toLowerCase()
    .replace(/\s+/g, '-')          // Spaces to hyphens
    .replace(/[^a-z0-9-]/g, '')    // Remove special characters
    .replace(/-+/g, '-')           // Multiple hyphens to single
    .replace(/^-|-$/g, '');        // Remove leading/trailing hyphens
}

/**
 * Normalizes font variation values to standard formats
 * @param {string} value - CSS property value
 * @returns {string} Normalized value
 */
export function normalizeVariation(value) {
  const mappings = {
    'normal': '400',
    'bold': '700',
    'italic': 'italic',
    'oblique': 'italic',
    'ultra-condensed': '50',
    'extra-condensed': '62',
    'condensed': '75',
    'semi-condensed': '87',
    'expanded': '125',
    'semi-expanded': '112',
    'extra-expanded': '150',
    'ultra-expanded': '200'
  };
  
  return mappings[value] || value.replace(/%/g, '');
}
