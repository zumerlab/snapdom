/** Clone-only enforcement for the explicitly configured redactInputs extensions.
 * Matching happens before mutations. The render-boundary pass removes resources added
 * after afterClone, without invoking the caller's field masker a second time.
 */
const STATE = Symbol('redact-inputs-clone-state');
const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_DEFINITIONS = new Set([
  'defs', 'symbol', 'linearGradient', 'radialGradient', 'pattern', 'clipPath',
  'mask', 'marker', 'filter',
]);

function sourceFor(node, ctx, known) {
  if (node === ctx.clone) return ctx.element || node;
  const mapped = ctx.nodeMap?.get(node);
  if (mapped) return mapped;
  // External SVG definitions are copied with native cloneNode, outside the nodeMap.
  // Resolve their author id in the source tree scope before using clone-side selectors.
  if (node.namespaceURI === SVG_NS) {
    const scope = ctx.element?.getRootNode?.();
    const path = [];
    for (let parent = node; parent && parent !== ctx.clone; parent = parent.parentElement) {
      let original = ctx.nodeMap?.get(parent) || known.get(parent)?.source;
      if (!original || original === parent) {
        original = parent.id && (scope?.getElementById?.(parent.id) ||
          ctx.element?.ownerDocument?.getElementById(parent.id));
      }
      if (original && original !== parent) {
        for (let i = path.length - 1; i >= 0 && original; i--) original = original.children[path[i]];
        if (original?.localName === node.localName && original.namespaceURI === node.namespaceURI) return original;
      }
      if (!parent.parentElement) break;
      path.push([...parent.parentElement.children].indexOf(parent));
    }
  }
  return node;
}

function isDefinition(node) {
  for (let el = node; el?.nodeType === 1 && el.namespaceURI === SVG_NS; el = el.parentElement) {
    if (SVG_DEFINITIONS.has(el.localName)) return true;
  }
  return false;
}

function spacerFor(node, source) {
  const doc = node.ownerDocument;
  // SVG shapes have no HTML flow box to reserve. An empty group preserves their place
  // in the SVG tree without introducing HTML into that namespace.
  if (node.namespaceURI === SVG_NS && node.localName !== 'svg') {
    return doc.createElementNS(SVG_NS, 'g');
  }
  let style;
  try { style = source.ownerDocument.defaultView.getComputedStyle(source); } catch { /* detached clone */ }
  let rect;
  try { rect = source.getBoundingClientRect(); } catch { /* detached clone */ }
  const width = source.offsetWidth || parseFloat(node.style?.width) || rect?.width || 0;
  const height = source.offsetHeight || parseFloat(node.style?.height) || rect?.height || 0;
  const display = style?.display || node.style?.display || 'block';
  const out = node.namespaceURI === SVG_NS
    ? doc.createElementNS(SVG_NS, 'svg') : doc.createElement('div');
  out.style.cssText = `display:${display === 'inline' ? 'inline-block' : display};` +
    `width:${width}px;height:${height}px;visibility:hidden;`;
  return out;
}

function forgetSubtree(map, root) {
  if (!map?.delete) return;
  map.delete(root);
  for (const node of root.querySelectorAll('*')) map.delete(node);
}

function removeAttribute(node, name) {
  const lower = name.toLowerCase();
  // Removing a value attribute alone leaves a dirty form control's displayed property
  // intact. Textareas serialize their value as child text, so that must be cleared too.
  if (lower === 'value' && (node.localName === 'input' || node.localName === 'textarea')) {
    node.value = '';
    node.defaultValue = '';
    if (node.localName === 'textarea') node.textContent = '';
  }
  if (lower === 'checked' && node.localName === 'input') {
    node.checked = false;
    node.defaultChecked = false;
  }
  if (lower === 'selected' && node.localName === 'option') {
    node.selected = false;
    node.defaultSelected = false;
  }
  // Flush a lazily serialized CSSOM value before removal. Blink/WebKit can otherwise
  // materialize style="" during serialization after late background writes.
  if (lower === 'style') node.getAttribute(name);
  node.removeAttribute(name);
}

/**
 * @param {object} ctx Capture context.
 * @param {{isBlocked: Function, redactedNames: Function}} policy Validated plugin policy.
 * @param {{final?: boolean}} options The final pass runs in beforeRender.
 */
export function sanitizeClone(ctx, policy, { final = false } = {}) {
  const root = ctx.clone;
  if (!root?.querySelectorAll) return;
  const states = ctx[STATE] ||= new WeakMap();
  let state = states.get(policy);
  if (!state) {
    state = { nodes: new WeakMap(), blockedRoot: false };
    states.set(policy, state);
  }

  // Snapshot ALL matches before removing classes, ids, or selector-dependent metadata.
  // Remember them between passes: an unmapped copied def may lose its identifying id.
  const work = [root, ...root.querySelectorAll('*')].map(node => {
    const previous = state.nodes.get(node);
    const source = previous?.source || sourceFor(node, ctx, state.nodes);
    const names = new Set(previous?.names || []);
    for (const name of policy.redactedNames(source)) names.add(name);
    const blocked = previous?.blocked || policy.isBlocked(source);
    const entry = { node, source, names, blocked };
    state.nodes.set(node, entry);
    return entry;
  });

  if (state.blockedRoot || work[0].blocked) {
    state.blockedRoot = true;
    forgetSubtree(ctx.nodeMap, root);
    ctx.clone = spacerFor(root, ctx.element || root);
    // A root pseudo can already have contributed literal content to scoped CSS. A fully
    // blocked capture has no authored paint to preserve, including late font/assets CSS.
    ctx.classCSS = '';
    if (final) {
      ctx.fontsCSS = '';
      ctx.scrollbarCSS = '';
    }
    return;
  }

  for (const { node, source, names, blocked } of work) {
    if (node !== root && !root.contains(node)) continue;
    if (blocked) {
      forgetSubtree(ctx.nodeMap, node);
      if (isDefinition(node)) node.remove();
      else node.replaceWith(spacerFor(node, source));
      continue;
    }
    for (const name of names) removeAttribute(node, name);
    // Layout reconciliation runs after beforeRender and writes inline dimensions to
    // mapped nodes. Explicitly removing style must also opt that node out of repinning.
    if (final && [...names].some(name => name.toLowerCase() === 'style')) ctx.nodeMap?.delete(node);
  }
}
