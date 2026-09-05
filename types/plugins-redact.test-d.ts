import { redactInputs, type RedactInputsOptions } from '../packages/plugins/redact-inputs.js';
import type { SnapdomPlugin } from './snapdom.js';

const options: RedactInputsOptions = {
  types: ['email', 'tel'],
  autocomplete: ['cc-*', 'one-time-code'],
  selector: 'textarea.private',
  all: false,
  mask: (value, element) => element.hasAttribute('data-blank') ? '' : '•'.repeat(value.length),
  blocks: ['.private-panel', '[data-private-block]'],
  attributes: [{ selector: '[data-token]', names: ['data-token', 'title'] }],
};

const plugins: SnapdomPlugin[] = [
  redactInputs(),
  redactInputs(options),
  redactInputs({ blocks: '.private-panel' }),
  redactInputs({ blocks: [], attributes: [] }),
  redactInputs({ types: [], autocomplete: [], attributes: [{ selector: 'textarea', names: ['value'] }] }),
];
void plugins;

// @ts-expect-error Blocks accept CSS selector strings, not regular expressions.
redactInputs({ blocks: /private/ });
// @ts-expect-error Attribute names must be an explicit list.
redactInputs({ attributes: [{ selector: '.private', names: 'data-token' }] });
// @ts-expect-error Every attribute rule requires a selector.
redactInputs({ attributes: [{ names: ['data-token'] }] });
// @ts-expect-error The existing field selector remains a single CSS selector string.
redactInputs({ selector: ['input', 'textarea'] });
