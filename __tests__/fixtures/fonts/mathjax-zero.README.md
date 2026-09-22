# MathJax zero-width font fixture

`mathjax-zero.woff2` is the unmodified 840-byte `mjx-ncm-zero.woff2` from
`@mathjax/mathjax-newcm-font` 4.1.3:

https://cdn.jsdelivr.net/npm/@mathjax/mathjax-newcm-font@4.1.3/chtml/woff2/mjx-ncm-zero.woff2

SHA-256: `5871b40a61aec9c13826851150208b19e06a15419bebac653e638437daafbcfc`

The package declares Apache-2.0. The accompanying `mathjax-zero.LICENSE` is
the license from https://github.com/mathjax/MathJax/blob/4.1.3/LICENSE.

Issue #506 uses this face before the existing JetBrains Mono fixture in a font
fallback list. Chromium resolves SVG image decoding before the fallback font
has painted, leaving the first raster blank. The small fixture reproduces that
MathJax behavior without downloading MathJax or its full text fonts during tests.
