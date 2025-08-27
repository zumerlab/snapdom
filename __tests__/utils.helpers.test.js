import { describe, it, expect, vi, beforeEach} from 'vitest';
import { extractURL, isIconFont, stripTranslate, safeEncodeURI } from '../src/utils';

describe('extractURL', () => {
  it('extracts the URL from background-image', () => {
    expect(extractURL('url("https://test.com/img.png")')).toBe('https://test.com/img.png');
    expect(extractURL('none')).toBeNull();
  });
});

describe('isIconFont', () => {
  it('detects icon fonts', () => {
    expect(isIconFont('Font Awesome')).toBe(true);
    expect(isIconFont('Arial')).toBe(false);
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

describe('safeEncodeURI', () => {
  it('returns an encoded string', () => {
    expect(typeof safeEncodeURI('https://test.com/á')).toBe('string');
  });
  it('safeEncodeURI handles invalid URIs gracefully', () => {
    expect(typeof safeEncodeURI('%E0%A4%A')).toBe('string');
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
