/**
 * Ensures that all external <symbol> or <defs> elements referenced by <use> 
 * inside the given root element are inlined into it.
 *
 * This is necessary when capturing or exporting an SVG fragment that relies on 
 * definitions existing elsewhere in the document, ensuring it remains 
 * self-contained and renders correctly.
 *
 * Process:
 * 1. Collect all IDs referenced by <use> elements in the root.
 * 2. Look up those IDs in the global document (outside the root).
 * 3. Create or reuse a hidden <svg> container inside the root to hold inlined defs.
 * 4. Only insert missing <symbol>/<defs> elements that are not already present.
 *
 * Existing definitions in the root are never modified or removed.
 *
 * @param {HTMLElement} rootElement - The root element being processed (typically the cloned DOM fragment).
 */
export function inlineExternalDefsAndSymbols(rootElement) {
  if (!rootElement) return;

  // Collect all IDs referenced by <use>
  const usedIds = new Set();
  rootElement.querySelectorAll('use').forEach(use => {
    const href = use.getAttribute('xlink:href') || use.getAttribute('href');
    if (href && href.startsWith('#')) {
      usedIds.add(href.slice(1));
    }
  });
  if (!usedIds.size) return;

  //  Get all global <symbol> and <defs> in one go
  const allGlobal = Array.from(document.querySelectorAll('svg > symbol, svg > defs'));
  const globalSymbols = allGlobal.filter(el => el.tagName.toLowerCase() === 'symbol');
  const globalDefs = allGlobal.filter(el => el.tagName.toLowerCase() === 'defs');

  //  Ensure a hidden container inside the root for defs/symbols
  let container = rootElement.querySelector('svg.inline-defs-container');
  if (!container) {
    container = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    container.setAttribute('aria-hidden', 'true');
    container.setAttribute('style', 'position: absolute; width: 0; height: 0; overflow: hidden;');
    container.classList.add('inline-defs-container');
    rootElement.insertBefore(container, rootElement.firstChild);
  }

  // Track IDs already present inside the root
  const existingIds = new Set();
  rootElement.querySelectorAll('symbol[id], defs > *[id]').forEach(el => {
    existingIds.add(el.id);
  });

  // Add only missing symbols/defs
  usedIds.forEach(id => {
    if (existingIds.has(id)) return;

    const symbol = globalSymbols.find(sym => sym.id === id);
    if (symbol) {
      container.appendChild(symbol.cloneNode(true));
      existingIds.add(id);
      return;
    }

    for (const defs of globalDefs) {
      const defEl = defs.querySelector(`#${CSS.escape(id)}`);
      if (defEl) {
        let defsContainer = container.querySelector('defs');
        if (!defsContainer) {
          defsContainer = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
          container.appendChild(defsContainer);
        }
        defsContainer.appendChild(defEl.cloneNode(true));
        existingIds.add(id);
        break;
      }
    }
  });
}
