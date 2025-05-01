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
    "position",
    "top",
    "right",
    "bottom",
    "left",
    "z-index",
    "width",
    "height",
    "min-width",
    "max-width",
    "min-height",
    "max-height",
    "margin",
    "padding",
    "border",
    "border-width",
    "border-style",
    "border-color",
    "border-radius",
    "box-sizing",
    "display",
    "overflow",
    "overflow-x",
    "overflow-y",
    "flex",
    "flex-grow",
    "flex-shrink",
    "flex-basis",
    "flex-direction",
    "justify-content",
    "align-items",
    "align-content",
    "gap",
    "row-gap",
    "column-gap",
    "grid",
    "grid-template-columns",
    "grid-template-rows",
    "background",
    "background-color",
    "background-image",
    "color",
    "font",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "font-stretch",
    "text-align",
    "vertical-align",
    "text-decoration",
    "line-height",
    "letter-spacing",
    "white-space",
    "word-break",
    "text-overflow",
    "visibility",
    "opacity",
    "box-shadow",
    "transform",
    "transition",
    "clip-path",
    "-webkit-text-fill-color"
  ];
  for (const pseudo of ["::before", "::after"]) {
    try {
      const style = window.getComputedStyle(source, pseudo);
      const content = style.getPropertyValue("content");
      const bg = style.getPropertyValue("background-image");
      
      
      if (content && content !== "none" && content !== '""' && content !== "''" || bg && bg.startsWith("url(")) {
        const fontFamily = style.getPropertyValue("font-family");
        const pseudoEl = document.createElement("span");
        pseudoEl.className = `snapdom-pseudo-${pseudo.replace("::", "")}`;
        let cleanContent = parseContent(content);
        const isIconFont = fontFamily && /font.*awesome|material|bootstrap|glyphicons|ionicons|remixicon|simple-line-icons|octicons|feather|typicons|weathericons/i.test(fontFamily);
        const fontSize = parseInt(style.getPropertyValue("font-size")) || 32;
        const fontWeight = parseInt(style.getPropertyValue("font-weight")) || false;
        const color = style.getPropertyValue("color") || "#000";
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
              const dataUrl = await fetchImageAsDataURL(match[1]);
              imgEl.src = dataUrl;
              imgEl.style = "display:block;width:100%;height:100%;object-fit:contain;";
              pseudoEl.appendChild(imgEl);
            } catch (e) {
              console.error(`[snapdom] Error in pseudo ${pseudo} for`, source, e);
            }
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
        if (!pseudoEl.style.position) pseudoEl.style.position = "absolute";
        if (pseudo === "::before") {
          clone.insertBefore(pseudoEl, clone.firstChild);
        } else {
          clone.appendChild(pseudoEl);
        }
      } 
    } catch (e) {
    }
  }
  const sChildren = Array.from(source.children);
  const cChildren = Array.from(clone.children).filter(
    (child) => !child.classList.contains("snapdom-pseudo-before") && !child.classList.contains("snapdom-pseudo-after")
  );
  for (let i = 0; i < Math.min(sChildren.length, cChildren.length); i++) {
    await inlinePseudoElements(sChildren[i], cChildren[i]);
  }
}

function parseContent(content) {
  let clean = content.replace(/^['"]|['"]$/g, '');
  if (clean.startsWith('\\')) {
    try {
      return String.fromCharCode(parseInt(clean.replace('\\', ''), 16));
    } catch {
      return clean;
    }
  }
  return clean;
}

async function iconToImage(unicodeChar, fontFamily, fontWeight, fontSize = 32, color = "#000") {
  fontFamily = fontFamily.replace(/^['"]+|['"]+$/g, ''); // Remover comillas

  await document.fonts.ready;
  await document.fonts.load(`${fontSize}px "${fontFamily}"`);

  const canvas = document.createElement('canvas');
  canvas.width = fontSize;
  canvas.height = fontSize;
  const ctx = canvas.getContext('2d');
  
  ctx.font = fontWeight ? `${fontWeight} ${fontSize}px "${fontFamily}"` : ` ${fontSize}px "${fontFamily}"`;
  ctx.textAlign = 'center'; // Centrar horizontal
  ctx.textBaseline = 'middle'; // Centrar vertical
  ctx.fillStyle = color;
  
  ctx.fillText(unicodeChar, canvas.width / 2, canvas.height / 2);

  return canvas.toDataURL();
}



