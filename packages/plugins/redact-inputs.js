/**
 * redactInputs - Official SnapDOM Plugin
 * Replace typed values with a same-length bullet mask in the captured clone.
 *
 * Core captures what the browser paints, which is the whole point of a fidelity-first
 * renderer: an `email` or `tel` field shows its value in plain text on screen, so the
 * capture shows it too. The ONE exception core makes is `type="password"`, and only because
 * the control already paints bullets, so masking it costs zero fidelity.
 *
 * Redacting anything else is a deliberate loss of fidelity, so it is opt-in and lives here.
 * Defaults cover the fields that are usually sensitive AND rendered in the clear.
 *
 * The default mask keeps the string's length. Glyph widths can differ, so wrapping and
 * truncation may change. `mask: () => ''` blanks a field outright.
 *
 * The built-in mask without a selector permits unchanged-repeat memoization. Custom maskers
 * and selectors run on every capture because they may read changing external state.
 * A changed tree rebuilds fully: the differential path cannot skip this afterClone transformation.
 * Pinned by __tests__/plugins.transforms.v3.test.js.
 * @module plugins/redact-inputs
 *
 * @param {Object} [options]
 * @param {string[]} [options.types] - input `type` values to redact. Default:
 *   ['email', 'tel']. Note 'password' is already masked by core.
 * @param {string[]} [options.autocomplete] - autocomplete tokens to redact. A trailing '*'
 *   matches by prefix. Default: ['cc-*', 'current-password', 'new-password', 'one-time-code'].
 * @param {string} [options.selector] - extra CSS selector for inputs and textareas
 *   (use it for textareas and app-specific fields).
 * @param {boolean} [options.all=false] - redact EVERY input and textarea, ignoring the lists.
 * @param {(value: string, el: Element) => string} [options.mask] - custom masker.
 * @returns {Object} SnapDOM plugin
 */
export function redactInputs(options = {}) {
  const {
    types = ['email', 'tel'],
    autocomplete = ['cc-*', 'current-password', 'new-password', 'one-time-code'],
    selector = '',
    all = false,
    mask = (value) => '•'.repeat(value.length),
  } = options;

  const typeSet = new Set(types.map((t) => String(t).toLowerCase()));
  const acExact = new Set();
  const acPrefixes = [];
  for (const token of autocomplete) {
    const t = String(token).toLowerCase();
    if (t.endsWith('*')) acPrefixes.push(t.slice(0, -1));
    else acExact.add(t);
  }

  function matchesAutocomplete(el) {
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (!ac) return false;
    for (const token of ac.split(/\s+/)) {
      if (acExact.has(token)) return true;
      for (const prefix of acPrefixes) {
        if (token.startsWith(prefix)) return true;
      }
    }
    return false;
  }

  function shouldRedact(el) {
    if (all) return true;
    if (selector) {
      try {
        if (el.matches(selector)) return true;
      } catch { /* invalid selector: the other rules still apply */ }
    }
    // Read the ATTRIBUTE, not el.type: an unknown type attribute reflects as 'text' through
    // the property, so a `type="email"` the engine does not implement would slip through.
    if (el.tagName === 'INPUT' && typeSet.has((el.getAttribute('type') || 'text').toLowerCase())) return true;
    return matchesAutocomplete(el);
  }

  return {
    name: 'redact-inputs',
    pure: options.mask === undefined && !selector,

    afterClone(ctx) {
      const root = ctx.clone;
      if (!root || !root.querySelectorAll) return;
      // querySelectorAll skips the root itself, and the capture root IS routinely a single
      // field. Include it explicitly (this is the #461 shape of bug).
      const nodes = [...root.querySelectorAll('input, textarea')];
      if (root.matches?.('input, textarea')) nodes.unshift(root);

      for (const el of nodes) {
        // Core turns date/time controls into text on Firefox/WebKit. Their source still
        // carries the type and selector state the caller asked to match.
        if (!shouldRedact(ctx.nodeMap?.get(el) || el)) continue;
        if (el.tagName === 'TEXTAREA') {
          const masked = String(mask(el.textContent || '', el));
          // Native canvas rendering and later plugins read value; SVG serialization reads text.
          el.value = masked;
          el.textContent = masked;
          continue;
        }
        const masked = String(mask(el.value || '', el));
        try { el.value = masked; } catch {
          // File inputs reject non-empty values. A redacted clone must display the mask,
          // not abort the capture before the remaining fields have been processed.
          el.type = 'text';
          el.value = masked;
        }
        if (el.value !== masked) {
          // Number/date controls silently sanitize arbitrary mask text to an empty value.
          el.type = 'text';
          el.value = masked;
        }
        el.setAttribute('value', masked);
      }
    }
  };
}
