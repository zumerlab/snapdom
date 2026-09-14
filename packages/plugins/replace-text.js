/**
 * replaceText - Official SnapDOM Plugin
 * Find-and-replace text in the captured clone.
 * Preserves stylesheet/script text; replacement arrays remain live between captures.
 * Pinned by __tests__/plugins.transforms.v3.test.js.
 * @module plugins/replace-text
 *
 * @param {Object} [options]
 * @param {Array<{find: string|RegExp, replace: string}>} [options.replacements=[]]
 * @returns {Object} SnapDOM plugin
 */
export function replaceText(options = {}) {
  const {
    replacements = [],
  } = options;

  function walkTextNodes(node, fn) {
    // Retained CSS is text too, but changing it would replace styles, URLs and selectors.
    if (node.nodeType === Node.ELEMENT_NODE && /^(style|script)$/i.test(node.localName)) return;
    if (node.nodeType === Node.TEXT_NODE) {
      fn(node);
    } else {
      for (const child of node.childNodes) {
        walkTextNodes(child, fn);
      }
      if (node.localName === 'textarea') node.value = node.textContent;
    }
  }

  return {
    name: 'replace-text',

    afterClone(ctx) {
      if (!replacements.length) return;

      walkTextNodes(ctx.clone, (textNode) => {
        let text = textNode.textContent;
        for (const { find, replace } of replacements) {
          if (find instanceof RegExp) {
            text = text.replace(find, replace);
          } else {
            text = text.split(find).join(replace);
          }
        }
        textNode.textContent = text;
      });
    }
  };
}
