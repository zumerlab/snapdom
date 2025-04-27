import { fetchImageAsDataURL } from '../utils/fetchImage.js';
import { delay } from '../utils/delay.js';

/**
 * Creates elements to represent ::before and ::after pseudo-elements
 * @param {Element} source - Original element
 * @param {Element} clone - Cloned element
 * @returns {Promise<void>} Promise that resolves when all pseudo-elements are processed
 */
export async function inlinePseudoElements(source, clone) {
  const importantProps = [
    'position', 'top', 'right', 'bottom', 'left', 'z-index',
    'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
    'margin', 'padding', 'border', 'border-radius',
    'background', 'background-color', 'background-image',
    'color', 'font', 'font-family', 'font-size', 'font-weight',
    'text-align', 'text-decoration', 'line-height', 'letter-spacing',
    'display', 'visibility', 'opacity', 'overflow', 'box-shadow',
    'transform', 'transition', 'flex', 'grid'
  ];

  for (const pseudo of ['::before', '::after']) {
    try {
      const style = window.getComputedStyle(source, pseudo);
      const content = style.getPropertyValue('content');
      if (content && content !== 'none' && content !== '""' && content !== "''") {
        const pseudoEl = document.createElement('span');
        pseudoEl.className = `snapdom-pseudo-${pseudo.replace('::', '')}`;
        let cleanContent = content.replace(/^\"|\"$/g, '');

        if (cleanContent.startsWith('url(')) {
          const match = cleanContent.match(/url\(["']?([^"')]+)["']?\)/);
          if (match?.[1]) {
            try {
              const imgEl = document.createElement('img');
              const dataUrl = await fetchImageAsDataURL(match[1]);
              imgEl.src = dataUrl;
              imgEl.style = 'display:block;width:100%;height:100%;object-fit:contain;';
              pseudoEl.appendChild(imgEl);
            } catch (e) {}
          }
        } else {
          pseudoEl.textContent = cleanContent;
        }

        for (const prop of importantProps) {
          const value = style.getPropertyValue(prop);
          if (value) {
            pseudoEl.style[prop] = value;
          }
        }

        if (!pseudoEl.style.position) pseudoEl.style.position = 'absolute';

        if (pseudo === '::before') {
          clone.insertBefore(pseudoEl, clone.firstChild);
        } else {
          clone.appendChild(pseudoEl);
        }
      }
    } catch (e) {}
  }

  const sChildren = Array.from(source.children);
  const cChildren = Array.from(clone.children).filter(child =>
    !child.classList.contains('snapdom-pseudo-before') &&
    !child.classList.contains('snapdom-pseudo-after')
  );

  for (let i = 0; i < Math.min(sChildren.length, cChildren.length); i++) {
    await inlinePseudoElements(sChildren[i], cChildren[i]);
    if (i % 5 === 0) await delay(1);  // Small delay to keep the browser responsive
  }
}
