import { describe, it, expect, vi, beforeEach} from 'vitest';
import { getStyle, parseContent, snapshotComputedStyle, stripTranslate } from '../src/utils';

describe('getStyle', () => {
  it('returns a CSSStyleDeclaration', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const style = getStyle(el);
    expect(style).toBeInstanceOf(CSSStyleDeclaration);
    document.body.removeChild(el);
  });
});

describe('parseContent', () => {
  it('parses CSS content correctly', () => {
    expect(parseContent('"★"')).toBe('★');
    expect(parseContent('\\2605')).toBe('★');
  });
});

describe('parseContent edge cases', () => {
  it('returns \u0000 if parseInt fails (not hex)', () => {
    expect(parseContent('\\nothex')).toBe('\u0000');
  });
  it('returns clean if String.fromCharCode throws', () => {
    const orig = String.fromCharCode;
    String.fromCharCode = () => { throw new Error('fail'); };
    expect(parseContent('\\2605')).toBe('\\2605');
    String.fromCharCode = orig;
  });
});

describe('snapshotComputedStyle', () => {
  it('returns a style snapshot', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const style = getComputedStyle(el);
    const snap = snapshotComputedStyle(style);
    expect(typeof snap).toBe('object');
    document.body.removeChild(el);
  });
});

describe('stripTranslate', () => {
  it('removes translate transforms', () => {
    expect(stripTranslate('translateX(10px) scale(2)')).toContain('scale(2)');
  });
  it('stripTranslate removes matrix and matrix3d', () => {
    expect(stripTranslate('matrix(1,0,0,1,10,20)')).not.toContain('10,20');
    expect(stripTranslate('matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,10,20,30,1)')).not.toContain('10,20,30');
  });
});

describe('stripTranslate edge cases', () => {
  it('returns empty string for empty or none', () => {
    expect(stripTranslate('')).toBe('');
    expect(stripTranslate('none')).toBe('');
  });
  it('returns original for malformed matrix', () => {
    expect(stripTranslate('matrix(1,2,3)')).toBe('matrix(1,2,3)');
    expect(stripTranslate('matrix3d(1,2,3)')).toBe('matrix3d(1,2,3)');
  });
});

