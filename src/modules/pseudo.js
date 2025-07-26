/**
 * Utilities for inlining ::before and ::after pseudo-elements.
 * @module pseudo
 */

import { getStyle, snapshotComputedStyle, parseContent, extractURL, safeEncodeURI, fetchImage, inlineSingleBackgroundEntry, splitBackgroundImage } from '../utils/helpers.js';
import { getStyleKey } from '../utils/cssTools.js';
import { iconToImage } from '../modules/fonts.js';
import { isIconFont } from '../modules/iconFonts.js';
import { cache } from '../core/cache.js'

/**
 * Creates elements to represent ::before, ::after, and ::first-letter pseudo-elements, inlining their styles and content.
 *
 * @param {Element} source - Original element
 * @param {Element} clone - Cloned element
 * @param {boolean} compress - Whether to compress style keys
 * @param {boolean} embedFonts - Whether to embed icon fonts as images
 * @returns {Promise} Promise that resolves when all pseudo-elements are processed
 */

export async function inlinePseudoElements(source, clone, compress, embedFonts = false, useProxy) {
  if (!(source instanceof Element) || !(clone instanceof Element)) return;
  for (const pseudo of ["::before", "::after", "::first-letter"]) {
    try {
      const style = getStyle(source, pseudo);
      if (!style || typeof style[Symbol.iterator] !== "function") continue;
      if (pseudo === "::first-letter") {
        const normal = getComputedStyle(source);
        const isMeaningful = style.color !== normal.color || style.fontSize !== normal.fontSize || style.fontWeight !== normal.fontWeight;
        if (!isMeaningful) continue;
        const textNode = Array.from(clone.childNodes).find(
          (n) => n.nodeType === Node.TEXT_NODE && n.textContent && n.textContent.trim().length > 0
        );
        if (!textNode) continue;
        const text = textNode.textContent;
        const match = text.match(/^([^\p{L}\p{N}\s]*[\p{L}\p{N}](?:['’])?)/u);
        const first = match?.[0];
        const rest = text.slice(first?.length || 0);
        if (!first || /[\uD800-\uDFFF]/.test(first)) continue;
        const span = document.createElement("span");
        span.textContent = first;
        span.dataset.snapdomPseudo = "::first-letter";
        const snapshot = snapshotComputedStyle(style);
        const key = getStyleKey(snapshot, "span", compress);
        cache.preStyleMap.set(span, key);
        const restNode = document.createTextNode(rest);
        clone.replaceChild(restNode, textNode);
        clone.insertBefore(span, restNode);
        continue;
      }
const content = style.getPropertyValue("content");
const bg = style.getPropertyValue("background-image");
const bgColor = style.getPropertyValue("background-color");

const fontFamily = style.getPropertyValue("font-family");
const fontSize = parseInt(style.getPropertyValue("font-size")) || 32;
const fontWeight = parseInt(style.getPropertyValue("font-weight")) || false;
const color = style.getPropertyValue("color") || "#000";
const display = style.getPropertyValue("display");
const width = parseFloat(style.getPropertyValue("width"));
const height = parseFloat(style.getPropertyValue("height"));
const borderStyle = style.getPropertyValue("border-style");
const transform = style.getPropertyValue("transform");

const isIconFont2 = isIconFont(fontFamily);

// Detect counter() || counters()
let cleanContent;
if (/counter\s*\(|counters\s*\(/.test(content)) {
  cleanContent = "- ";
} else {
  cleanContent = parseContent(content);
}

const hasContent = content !== "none";
const hasExplicitContent = hasContent && cleanContent !== "";
const hasBg = bg && bg !== "none";
const hasBgColor = bgColor && bgColor !== "transparent" && bgColor !== "rgba(0, 0, 0, 0)";
const hasBox = display !== "inline" && (width > 0 || height > 0);
const hasBorder = borderStyle && borderStyle !== "none";
const hasTransform = transform && transform !== "none";

const shouldRender =
  hasExplicitContent || hasBg || hasBgColor || hasBox || hasBorder || hasTransform;

if (!shouldRender) continue;

const pseudoEl = document.createElement("span");
pseudoEl.dataset.snapdomPseudo = pseudo;
const snapshot = snapshotComputedStyle(style);
const key = getStyleKey(snapshot, "span", compress);
cache.preStyleMap.set(pseudoEl, key);

if (isIconFont2 && cleanContent.length === 1) {
  const imgEl = document.createElement("img");
  imgEl.src = await iconToImage(cleanContent, fontFamily, fontWeight, fontSize, color);
  imgEl.style = `width:${fontSize}px;height:auto;object-fit:contain;`;
  pseudoEl.appendChild(imgEl);
} else if (cleanContent.startsWith("url(")) {
  const rawUrl = extractURL(cleanContent);
  if (rawUrl && rawUrl.trim() !== "") {
    try {
      const imgEl = document.createElement("img");
      const dataUrl = await fetchImage(safeEncodeURI(rawUrl, { useProxy }));
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
    const newBgParts = await Promise.all(
      bgSplits.map((entry) => inlineSingleBackgroundEntry(entry))
    );
    pseudoEl.style.backgroundImage = newBgParts.join(", ");
  } catch (e) {
    console.warn(`[snapdom] Failed to inline background-image for ${pseudo}`, e);
  }
}

if (hasBgColor) pseudoEl.style.backgroundColor = bgColor;

const hasContent2 =
  pseudoEl.childNodes.length > 0 ||
  (pseudoEl.textContent && pseudoEl.textContent.trim() !== "");
const hasVisibleBox = hasContent2 || hasBg || hasBgColor || hasBox || hasBorder || hasTransform;

if (!hasVisibleBox) continue;

pseudo === "::before"
  ? clone.insertBefore(pseudoEl, clone.firstChild)
  : clone.appendChild(pseudoEl);

    } catch (e) {
      console.warn(`[snapdom] Failed to capture ${pseudo} for`, source, e);
    }
  }
  const sChildren = Array.from(source.children);
  const cChildren = Array.from(clone.children).filter((child) => !child.dataset.snapdomPseudo);
  for (let i = 0; i < Math.min(sChildren.length, cChildren.length); i++) {
    await inlinePseudoElements(
      sChildren[i],
      cChildren[i],
      compress,
      embedFonts,
      useProxy
    );
  }
}
