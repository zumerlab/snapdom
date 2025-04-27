import { normalizeFontName, normalizeVariation } from '../utils/normalize.js';

/**
 * Collects and generates CSS for fonts used in the document
 * @param {WeakMap} [styleCache=new WeakMap()] - Cache of computed styles
 * @returns {Promise<string>} Promise that resolves to CSS for fonts
 */
export async function inlineFonts(styleCache = new WeakMap()) {
  await document.fonts.ready;
  
  // Collect @font-face rules
  const fontFaceRules = [];
  Array.from(document.styleSheets).forEach(sheet => {
    try {
      Array.from(sheet.cssRules).forEach(rule => {
        if (rule instanceof CSSFontFaceRule) {
          fontFaceRules.push(rule.cssText);
        }
      });
    } catch (e) {
      console.warn('Could not access stylesheet rules:', e);
    }
  });

  // Detect font families and variations used
  const fontData = new Map();
  const elements = document.querySelectorAll('*');
  
  elements.forEach(el => {
    const style = styleCache.get(el) || window.getComputedStyle(el);
    if (!styleCache.has(el)) styleCache.set(el, style);
    
    const family = style.fontFamily?.split(',')[0]?.trim().replace(/["']/g, '');
    if (!family) return;
    
    const weight = normalizeVariation(style.fontWeight || '400');
    const styleAttr = normalizeVariation(style.fontStyle || 'normal');
    const stretch = normalizeVariation(style.fontStretch || 'normal');
    
    if (!fontData.has(family)) {
      fontData.set(family, new Set());
    }
    
    fontData.get(family).add(`${weight}_${styleAttr}_${stretch}`);
  });

  // Generate CSS classes
  const cssClasses = [...fontFaceRules];
  
  for (const [family, variations] of fontData) {
    const safeFamily = normalizeFontName(family);
    
    for (const variation of variations) {
      const [weight, styleAttr, stretch] = variation.split('_');
      const variationClass = `fg-f-${safeFamily}-w${weight}-${styleAttr}-s${stretch}`;
      
      const cssProps = [
        `font-family:"${family}",sans-serif`,
        `font-weight:${weight}`,
        `font-style:${styleAttr}`,
        `font-stretch:${stretch}%`
      ].filter(Boolean).join(';');
      
      cssClasses.push(`.${variationClass}{${cssProps}}`);
    }
  }

  //Inheritance rule
  cssClasses.push('*{font-family:inherit;font-weight:inherit;font-style:inherit;}');
  
  return cssClasses.join('');
}

/**
 * Applies font classes to cloned elements
 * @param {Element} clone - Cloned element
 * @param {Element} original - Original element
 * @param {WeakMap} styleCache - Cache of computed styles
 */
export function applyFontClasses(clone, original, styleCache) {
  const style = styleCache.get(original) || window.getComputedStyle(original);
  const family = style.fontFamily?.split(',')[0]?.trim().replace(/["']/g, '');
  
  if (!family) return;
  
  const weight = normalizeVariation(style.fontWeight || '400');
  const styleAttr = normalizeVariation(style.fontStyle || 'normal');
  const stretch = normalizeVariation(style.fontStretch || 'normal');
  const safeFamily = normalizeFontName(family);
  
  clone.classList.add(`fg-f-${safeFamily}-w${weight}-${styleAttr}-s${stretch}`);
}
