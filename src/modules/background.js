import { fetchImageAsDataURL } from '../utils/fetchImage.js';
import { delay } from '../utils/delay.js';

/**
 * Converts background images to data URLs
 * @param {Element} source - Original element
 * @param {Element} clone - Cloned element
 * @param {WeakMap} styleCache - Cache of computed styles
 * @returns {Promise<void>} Promise that resolves when all background images are processed
 */
export async function inlineBackgroundImages(source, clone, styleCache) {
  const queue = [[source, clone]];
  while (queue.length) {
    const [srcNode, cloneNode] = queue.shift();
    const style = styleCache.get(srcNode) || window.getComputedStyle(srcNode);
    if (!styleCache.has(srcNode)) styleCache.set(srcNode, style);
    const bg = style.getPropertyValue('background-image');
    if (bg && bg.includes('url(')) {
      const match = bg.match(/url\(["']?([^"')]+)["']?\)/);
      if (match?.[1]) {
        try {
          const dataUrl = await fetchImageAsDataURL(match[1]);
          cloneNode.style.backgroundImage = `url(${dataUrl})`;
        } catch {
          cloneNode.style.backgroundImage = 'none';
        }
      }
    }
    const sChildren = Array.from(srcNode.children);
    const cChildren = Array.from(cloneNode.children);
    for (let i = 0; i < Math.min(sChildren.length, cChildren.length); i++) {
      queue.push([sChildren[i], cChildren[i]]);
    }
    await delay(1);  // Small delay to keep the browser responsive
  }
}
