# pending/

Two checks of the vector page (`src/svd-pdf.js`) that do not run, and did not run
before they came here. They moved with the code they are about, on 2026-11-22, when
everything that writes PDF left the vector engine for this plugin. In the engine they
were `test/_pdfcheck.mjs` and `test/_vectorpath.mjs`: the underscore kept them out of
`npm test`, so nobody saw them stop working.

| | what it asked | why it does not run |
|---|---|---|
| `vectorpath.mjs` | that `toPdf(el, { mode: 'vector' })` reaches the paper, options included | there is no such mode: the door was removed when the two products were split. It is the specification of the wiring that is still to be decided |
| `pdfcheck.mjs` | that the vector page is DRAWN, not a picture: path operators against image XObjects, text items, fonts | it reads `out/vector/*.svd.json`, which a tool that no longer runs used to write |

Neither has been edited beyond its place on disk, so their import paths are the old
ones too. `test/svdcheck.mjs` is what covers the vector page today. Revive these, or
delete them, when the vector page is wired into `toPdf()`.
