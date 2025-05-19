/**
 * Utilities for inlining ::before and ::after pseudo-elements.
 * @module pseudo
 */

import { fetchImage, getStyle} from '../utils/helpers.js';
import { snapshotComputedStyle } from '../utils/helpers.js';
import { parseContent } from '../utils/helpers.js';
import { getStyleKey } from '../utils/cssTools.js';
import { iconToImage } from '../modules/fonts.js';

/**
 * Creates elements to represent ::before and ::after pseudo-elements, inlining their styles and content.
 *
 * @param {Element} source - Original element
 * @param {Element} clone - Cloned element
 * @param {Map} styleMap - Map to store element-to-style-key mappings
 * @param {WeakMap} styleCache - Cache of computed styles
 * @param {boolean} compress - Whether to compress style keys
 * @returns {Promise<void>} Promise that resolves when all pseudo-elements are processed
 */
export async function inlinePseudoElements(source, clone, styleMap, styleCache, compress) {

  if (!(source instanceof Element) || !(clone instanceof Element)) return;

  for (const pseudo of ["::before", "::after"]) {
    try {
      const style = getStyle(source, pseudo);
      if (!style) continue; 
      const content = style.getPropertyValue("content");
      const bg = style.getPropertyValue("background-image");

      // ¿Este pseudo existe realmente?
      const hasContent = content && content !== "none" && content !== '""' && content !== "''";
      const hasBg = bg && bg.startsWith("url(");

      if (hasContent || hasBg) {
        const fontFamily = style.getPropertyValue("font-family");
        const fontSize = parseInt(style.getPropertyValue("font-size")) || 32;
        const fontWeight = parseInt(style.getPropertyValue("font-weight")) || false;
        const color = style.getPropertyValue("color") || "#000";

        const pseudoEl = document.createElement("span");
        pseudoEl.dataset.snapdomPseudo = pseudo;

        // ⚠️ Ahora usamos tu sistema moderno:
        const snapshot = snapshotComputedStyle(style);
        const key = getStyleKey(snapshot, "span", compress);
        styleMap.set(pseudoEl, key);

        // ¿Es un icon font?
        const isIconFont = fontFamily && /font.*awesome|material|bootstrap|glyphicons|ionicons|remixicon|simple-line-icons|octicons|feather|typicons|weathericons/i.test(fontFamily);

        // ⬇️ Inlinear contenido
        let cleanContent = parseContent(content);
        if (isIconFont && cleanContent.length === 1) {
          const imgEl = document.createElement("img");
          imgEl.src = await iconToImage(cleanContent, fontFamily, fontWeight, fontSize, color);
          imgEl.style = "display:block;width:100%;height:100%;object-fit:contain;";
          pseudoEl.appendChild(imgEl);
        } else if (cleanContent.startsWith("url(")) {
          const match = cleanContent.match(/url\(["']?([^"')]+)["']?\)/);
          if (match?.[1]) {
            try {
              const imgEl = document.createElement("img");
              const dataUrl = await fetchImage(match[1]);
              imgEl.src = dataUrl;
              imgEl.style = "display:block;width:100%;height:100%;object-fit:contain;";
              pseudoEl.appendChild(imgEl);
            } catch (e) {
              console.error(`[snapdom] Error in pseudo ${pseudo} for`, source, e);
            }
          }
        } else if (cleanContent && cleanContent !== "none") {
          pseudoEl.textContent = cleanContent;
        }

        // ✅ Insertamos como before o after
        if (pseudo === "::before") {
          clone.insertBefore(pseudoEl, clone.firstChild);
        } else {
          clone.appendChild(pseudoEl);
        }
      }
    } catch (e) {
      console.warn(`[snapdom] Failed to capture ${pseudo} for`, source, e);
    }
  }

  // ⬇️ Recursivo sobre hijos reales (excluyendo pseudos ya inyectados)
  const sChildren = Array.from(source.children);
  const cChildren = Array.from(clone.children).filter(
    child => !child.dataset.snapdomPseudo
  );
  for (let i = 0; i < Math.min(sChildren.length, cChildren.length); i++) {
    await inlinePseudoElements(sChildren[i], cChildren[i], styleMap, styleCache, compress);
  }
}
