/**
 * Utilities for inlining ::before and ::after pseudo-elements.
 * @module pseudo
 */

import {
  getStyle,
  snapshotComputedStyle,
  parseContent,
  extractURL,
  safeEncodeURI,
  fetchImage,
  inlineSingleBackgroundEntry,
  splitBackgroundImage,
  getStyleKey
} from '../utils';
import { iconToImage } from '../modules/fonts.js';
import { isIconFont } from '../modules/iconFonts.js';
import { cache } from '../core/cache.js';

/**
 * Creates elements to represent ::before, ::after, and ::first-letter pseudo-elements, inlining their styles and content.
 *
 * @param {Element} source - Original element
 * @param {Element} clone - Cloned element
 * @param {boolean} embedFonts - Whether to embed icon fonts as images
 * @returns {Promise} Promise that resolves when all pseudo-elements are processed
 */

export async function inlinePseudoElements(source, clone, sessionCache, options) {
  if (!(source instanceof Element) || !(clone instanceof Element)) return;

  for (const pseudo of ['::before', '::after', '::first-letter']) {
    try {
      const style = getStyle(source, pseudo);
      if (!style || typeof style[Symbol.iterator] !== 'function') continue;

      // Skip visually empty pseudo-elements early
      const isEmptyPseudo =
        style.content === 'none' &&
        style.backgroundImage === 'none' &&
        style.backgroundColor === 'transparent' &&
        (style.borderStyle === 'none' || parseFloat(style.borderWidth) === 0) &&
        (!style.transform || style.transform === 'none') &&
        style.display === 'inline';

      if (isEmptyPseudo) continue;

      if (pseudo === '::first-letter') {
        const normal = getComputedStyle(source);
        const isMeaningful =
          style.color !== normal.color ||
          style.fontSize !== normal.fontSize ||
          style.fontWeight !== normal.fontWeight;
        if (!isMeaningful) continue;

        const textNode = Array.from(clone.childNodes).find(
          (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim().length > 0
        );
        if (!textNode) continue;

        const text = textNode.textContent;
        const match = text.match(/^([^\p{L}\p{N}\s]*[\p{L}\p{N}](?:['’])?)/u);
        const first = match?.[0];
        const rest = text.slice(first?.length || 0);
        if (!first || /[\uD800-\uDFFF]/.test(first)) continue;

        const span = document.createElement('span');
        span.textContent = first;
        span.dataset.snapdomPseudo = '::first-letter';
        const snapshot = snapshotComputedStyle(style);
        const key = getStyleKey(snapshot, 'span');
        sessionCache.styleMap.set(span, key);

        const restNode = document.createTextNode(rest);
        clone.replaceChild(restNode, textNode);
        clone.insertBefore(span, restNode);
        continue;
      }

      const content = style.content;
      const cleanContent = /counter\s*\(|counters\s*\(/.test(content)
        ? '- '
        : parseContent(content);

      const bg = style.backgroundImage;
      const bgColor = style.backgroundColor;
      const fontFamily = style.fontFamily;
      const fontSize = parseInt(style.fontSize) || 32;
      const fontWeight = parseInt(style.fontWeight) || false;
      const color = style.color || '#000';
      const display = style.display;
      const width = parseFloat(style.width);
      const height = parseFloat(style.height);
      const borderStyle = style.borderStyle;
      const borderWidth = parseFloat(style.borderWidth);
      const transform = style.transform;

      const isIconFont2 = isIconFont(fontFamily);

      const hasExplicitContent = content !== 'none' && cleanContent !== '';
      const hasBg = bg && bg !== 'none';
      const hasBgColor =
        bgColor && bgColor !== 'transparent' && bgColor !== 'rgba(0, 0, 0, 0)';
      const hasBox = display !== 'inline' && (width > 0 || height > 0);
      const hasBorder =
        borderStyle && borderStyle !== 'none' && borderWidth > 0;
      const hasTransform = transform && transform !== 'none';

      const shouldRender =
        hasExplicitContent || hasBg || hasBgColor || hasBox || hasBorder || hasTransform;

      if (!shouldRender) continue;

      const pseudoEl = document.createElement('span');
      pseudoEl.dataset.snapdomPseudo = pseudo;
      pseudoEl.style.verticalAlign = 'middle'
      const snapshot = snapshotComputedStyle(style);
      const key = getStyleKey(snapshot, 'span');
      sessionCache.styleMap.set(pseudoEl, key);

      if (isIconFont2 && cleanContent.length === 1) {
       const { dataUrl, width, height } = await iconToImage(cleanContent, fontFamily, fontWeight, fontSize, color);
const imgEl = document.createElement("img");
imgEl.src = dataUrl;
imgEl.style = `height:${fontSize}px;width:${(width / height) * fontSize}px;object-fit:contain;`;
pseudoEl.appendChild(imgEl);
        clone.dataset.snapdomHasIcon = "true";
      } else if (cleanContent.startsWith('url(')) {
        const rawUrl = extractURL(cleanContent);
        if (rawUrl?.trim()) {
          try {
            const imgEl = document.createElement('img');
            const dataUrl = await fetchImage(safeEncodeURI(rawUrl), {useProxy: options.useProxy});
            imgEl.src = dataUrl;
            imgEl.style = `width:${fontSize}px;height:auto;object-fit:contain;`;
            pseudoEl.appendChild(imgEl);
          } catch (e) {
            console.error(`[snapdom] Error in pseudo ${pseudo} for`, source, e);
          }
        }
      } else if (!isIconFont2 && hasExplicitContent) {
        pseudoEl.textContent = cleanContent;
      }

      if (hasBg) {
        try {
          const bgSplits = splitBackgroundImage(bg);
          const newBgParts = await Promise.all(bgSplits.map(inlineSingleBackgroundEntry));
          pseudoEl.style.backgroundImage = newBgParts.join(', ');
        } catch (e) {
          console.warn(`[snapdom] Failed to inline background-image for ${pseudo}`, e);
        }
      }

      if (hasBgColor) pseudoEl.style.backgroundColor = bgColor;

      const hasContent2 =
        pseudoEl.childNodes.length > 0 || (pseudoEl.textContent?.trim() !== '');
      const hasVisibleBox =
        hasContent2 || hasBg || hasBgColor || hasBox || hasBorder || hasTransform;

      if (!hasVisibleBox) continue;

      if (pseudo === '::before') {
        clone.insertBefore(pseudoEl, clone.firstChild);
      } else {
        clone.appendChild(pseudoEl);
      }
    } catch (e) {
      console.warn(`[snapdom] Failed to capture ${pseudo} for`, source, e);
    }
  }

  const sChildren = Array.from(source.children);
  const cChildren = Array.from(clone.children).filter((child) => !child.dataset.snapdomPseudo);
  for (let i = 0; i < Math.min(sChildren.length, cChildren.length); i++) {
    await inlinePseudoElements(sChildren[i], cChildren[i], sessionCache, options);
  }
}

