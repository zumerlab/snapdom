// Internal contract shared by official exporters. No core traversal or global state:
// each capture owns its policy, and export snapshots contain only the permitted values.
const PRIVACY = Symbol('snapdom.privacy');
const EMPTY_NAMES = new Set();
const parentOf = (el) => el.assignedSlot || el.parentElement || el.getRootNode?.().host || null;
const canonicalName = (el, name) => el.namespaceURI === 'http://www.w3.org/1999/xhtml'
  ? name.toLowerCase() : name;

export function getPrivacyPolicy(ctx) {
  return ctx?.[PRIVACY] || null;
}

export function setPrivacyPolicy(ctx, policy) {
  ctx[PRIVACY] = policy;
}

export function createPrivacyPolicy(blocks, attributes, fieldMatches) {
  const blocked = new WeakMap();
  const namesByNode = new WeakMap();
  const isBlocked = (el) => {
    if (!blocks.length || !el || el.nodeType !== 1) return false;
    if (blocked.has(el)) return blocked.get(el);
    const trail = [];
    let result = false;
    for (let node = el; node; node = parentOf(node)) {
      if (blocked.has(node)) { result = blocked.get(node); break; }
      trail.push(node);
      if (blocks.some(selector => node.matches(selector))) { result = true; break; }
    }
    for (const node of trail) blocked.set(node, result);
    return result;
  };
  const redactedNames = (el) => {
    if (!attributes.length || !el || el.nodeType !== 1) return EMPTY_NAMES;
    if (namesByNode.has(el)) return namesByNode.get(el);
    const names = new Set();
    for (const rule of attributes) {
      if (el.matches(rule.selector)) {
        for (const name of rule.names) names.add(canonicalName(el, name));
      }
    }
    namesByNode.set(el, names);
    return names;
  };
  const redactsAttribute = (el, name) => redactedNames(el).has(canonicalName(el, name));
  return {
    blocks,
    isBlocked,
    redactedNames,
    redactsAttribute,
    attribute: (el, name) => redactsAttribute(el, name) ? null : el.getAttribute(name),
    isField: (el) => /^(?:input|textarea)$/.test(el.localName || '') &&
      (fieldMatches(el) || redactsAttribute(el, 'value')),
  };
}
