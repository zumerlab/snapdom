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
 * The mask keeps the ORIGINAL LENGTH, so line breaks, field widths and truncation stay
 * where they were. `mask: () => ''` is the way to blank a field outright.
 *
 * Note: this plugin declares `afterClone`, so a capture using it always runs the full
 * pipeline (the differential fast path cannot prove a whole-clone hook is subtree-local).
 * That costs repeat-capture speed, never correctness.
 *
 * @param {Object} [options]
 * @param {string[]} [options.types] - input `type` values to redact. Default:
 *   ['email', 'tel']. Note 'password' is already masked by core.
 * @param {string[]} [options.autocomplete] - autocomplete tokens to redact. A trailing '*'
 *   matches by prefix. Default: ['cc-*', 'current-password', 'new-password', 'one-time-code'].
 * @param {string} [options.selector] - extra CSS selector; anything it matches is redacted
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
    if (el.tagName !== 'INPUT') return false;
    // Read the ATTRIBUTE, not el.type: an unknown type attribute reflects as 'text' through
    // the property, so a `type="email"` the engine does not implement would slip through.
    if (typeSet.has((el.getAttribute('type') || 'text').toLowerCase())) return true;
    return matchesAutocomplete(el);
  }

  return {
    name: 'redact-inputs',

    afterClone(ctx) {
      const root = ctx.clone;
      if (!root || !root.querySelectorAll) return;
      // querySelectorAll skips the root itself, and the capture root IS routinely a single
      // field. Include it explicitly (this is the #461 shape of bug).
      const nodes = [...root.querySelectorAll('input, textarea')];
      if (root.matches?.('input, textarea')) nodes.unshift(root);

      for (const el of nodes) {
        if (!shouldRedact(el)) continue;
        if (el.tagName === 'TEXTAREA') {
          // Core transfers the live value as the clone's text content, so that is what paints.
          el.textContent = mask(el.textContent || '', el);
          continue;
        }
        const masked = mask(el.value || '', el);
        el.value = masked;
        el.setAttribute('value', masked);
      }
    }
  };
}
