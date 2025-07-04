/**
 * Inlines external `<defs>` used by `<use xlink:href="#...">` or `<use href="#...">` inside SVGs,
 * copying only the necessary definitions into each individual cloned SVG.
 *
 * This is needed because cloned SVGs using `<use>` may reference elements like `<symbol>`, `<path>`, etc.,
 * defined elsewhere in the document (e.g., in a shared `<defs>` block that is not part of the cloned subtree).
 *
 * The function finds all `<use>` elements within `root`, extracts the referenced IDs,
 * and embeds the required definitions at the top of each SVG.
 *
 * @function inlineExternalDef
 * @param {ParentNode} root - The root node containing cloned SVGs (usually the result of a DOM snapshot).
 * @returns {void}
 *
 * @example
 * const { clone } = await prepareClone(element);
 * inlineExternalDef(clone);
 */

export function inlineExternalDef(root) {
  if (!root) return;
  const defsSources = document.querySelectorAll('svg > defs');
  if (!defsSources.length) return;

  root.querySelectorAll('svg').forEach(svg => {
    const uses = svg.querySelectorAll('use');
    if (!uses.length) return;

    const usedIds = new Set();
    uses.forEach(use => {
      const href = use.getAttribute('xlink:href') || use.getAttribute('href');
      if (href && href.startsWith('#')) usedIds.add(href.slice(1));
    });
    if (!usedIds.size) return;

    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");

    for (const id of usedIds) {
      for (const source of defsSources) {
        const def = source.querySelector(`#${CSS.escape(id)}`);
        if (def) {
          defs.appendChild(def.cloneNode(true));
          break;
        }
      }
    }

    if (defs.childNodes.length) {
      svg.insertBefore(defs, svg.firstChild);
    }
  });
}
