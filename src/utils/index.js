/** Re-export barrel for src/utils. @module utils */
export { inlineSingleBackgroundEntry } from './image.js'
export { getDefaultStyleForTag, getStyleKey, softensWidth, softenNeedsAutoWidth, collectUsedTagNames, generateDedupedBaseCSS, generateCSSClasses, getStyle, parseContent, snapshotComputedStyle, splitBackgroundImage, NO_CAPTURE_TAGS, NO_DEFAULTS_TAGS, shouldIgnoreProp } from './css.js'
export { isIOS, isSafari } from './browser.js'
export { safeEncodeURI, stripTranslate, extractURL, resolveURL, resolveImageSetURL, isPasswordInput, maskValue, isTag, isHTMLEl, isSVGEl } from './helpers.js'
export { debugWarn } from './debug.js'
