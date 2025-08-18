import { describe, it, expect } from 'vitest';
import { inlineAllStyles } from '../src/modules/styles.js';
import { cache } from '../src/core/cache.js';
import { createContext } from '../src/core/context.js';


 it('inlineAllStyles works with compress true', () => {
    const el = document.createElement('span');
    const clone = document.createElement('span');
    const options = createContext()
      const sessionCache = {
        styleMap: cache.session.styleMap,
        styleCache: cache.session.styleCache,
        nodeMap: cache.session.nodeMap
      }
    inlineAllStyles(el, clone, sessionCache, {...options, compress: true});
    expect(sessionCache.styleMap.has(clone)).toBe(true);
  });
