/**
 * replaceText - Official SnapDOM Plugin
 * Find-and-replace text in the captured clone.
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
    if (node.nodeType === Node.TEXT_NODE) {
      fn(node);
    } else {
      for (const child of node.childNodes) {
        walkTextNodes(child, fn);
      }
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
