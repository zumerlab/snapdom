// The Safari shadow rewrites keep a stylesheet's literal dollar signs.
//
// Both helpers rewrite each <style> block with String.prototype.replace and a string replacement, which reads `$&`,
// `$'`, `` $` `` and `$$` in the stylesheet as replacement patterns: `content:"$&"` came back as the whole stylesheet.
// Each rewrite must equal the same rewrite of the stylesheet with a plain word in place of the dollar sign.
import { describe, it, expect } from 'vitest'
import { rewriteSvgBoxShadowToDropShadow, rewriteSvgShadowOffsets } from '../src/exporters/safariShadows.js'

const svg = (text) => '<svg xmlns="http://www.w3.org/2000/svg"><style>' +
  `.a{box-shadow:0px 4px 0px 0px #000;text-shadow:0px 2px 0px #000}.b::after{content:"${text}"}</style></svg>`

describe('Safari shadow rewrites keep literal dollar signs', () => {
  const helpers = {
    rewriteSvgBoxShadowToDropShadow: (s) => rewriteSvgBoxShadowToDropShadow(s),
    rewriteSvgShadowOffsets: (s) => rewriteSvgShadowOffsets(s, true),
  }
  for (const [name, rewrite] of Object.entries(helpers)) {
    it(`${name} rewrites the shadows`, () => {
      expect(rewrite(svg('plain'))).not.toBe(svg('plain'))
    })
    for (const d of ['$&', "$'", '$`', '$$', '$1']) {
      it(`${name} keeps ${d}`, () => {
        expect(rewrite(svg(d))).toBe(rewrite(svg('plain')).replace('"plain"', () => `"${d}"`))
      })
    }
  }
})
