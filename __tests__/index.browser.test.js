import { it, expect } from 'vitest';
import * as snapdom from '../src/index.browser.js';

it('should import the browser bundle without errors', () => {
  expect(snapdom).toBeDefined();
});
