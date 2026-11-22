# test/

One product, four suites, one harness.

The PDF product left for its own repository on 2026-08-28 and took its suite, its
fixtures and its demos with it. What is here tests the vector path.

| | file | asserts | against |
|---|---|---|---|
| **vector** | `test/verify-vector.mjs` | `packages/vector`, `packages/svd`, the Figma payload | the **live DOM**, plus recorded baselines |
| **h2d** | `test/verify-h2d.mjs` | the html-to-design channel | a recorded capture from the official extension |
| **plugin** | `test/verify-plugin.mjs` | v3 option precedence, export hooks, capture isolation and cleanup | the mounted v3 build and local fixtures |
| **MathML** | `test/verify-mathml.mjs` | native math content, geometry, fonts, exclusions and capture cleanup | browser layout and actual public SVG exports |

Shared: `test/harness.mjs` (assertions, Chromium bootstrap) and `test/serve.mjs`
(static server: this repo at `/`, the snapdom checkouts at `/snapdom-v3/` and
`/snapdom-v2/`). `test/_vharness.mjs` is the vector suite's own layer on top.

The vector suite walks **three** demo pages and reads its fixture list off each one's
`<select>`, so a fixture added to a demo joins the suite on the next run: `vector.html`
(5), `figma.html` (4) and `demo/challenges.html` (10 — the deliberately hostile ones).

```
npm test                  all suites; exits non-zero if any fails
npm run test:vector       just test/verify-vector.mjs
npm run test:h2d          just test/verify-h2d.mjs
npm run test:plugin       just the v3 plugin integration checks
npm run test:mathml       native MathML regressions in Chromium
npm run test:vector:update   re-record the vector baselines — read the rules below first
npm run demo              serve.mjs on its own, for the browser
```

All suites start their own server. `H2D_BASE` still points the h2d one at an
outside server when you want that; it used to REQUIRE one, and `npm test` failed
with `ERR_CONNECTION_REFUSED` for a reason that had nothing to do with the code.

MathML also accepts `--browser=firefox` or `--browser=webkit`, and `--only=` to
select a case. It saves native screenshots, exported SVGs, rendered images and
observations in `out/mathml/<browser>/`. Structural assertions check content and
geometry independently; pixel differences remain observations, with no baseline
updates or automatic fidelity rating.

**The `_` prefix means "run by hand", not "unimportant".** Every `_*.mjs` here is a
tool: it measures or investigates, asserts nothing and gates nothing, and its header
says which question it was written to answer. It is fair to delete one once that
question is settled. `_vharness.mjs` is the exception — it is a module the vector
suite imports, not a tool.

Artifacts land in `out/` (gitignored). The vector suite owns `out/vector-verify/`
(`<page>-<fixture>.svg`, `.live.png`, `.emitted.png` and the amplified `.diff.png` —
the fastest way to see *which* part of a fixture disagrees) and `out/vector/wild/`
for `--url` captures.

**One fixture:** the vector suite filters with `--only=`, a substring of
`page/fixture` (`--only=challenges/fx-type`, `--only=fx-card` for both pages that
have one); a filter matching nothing fails and prints every key that exists.

---

## What the vector suite covers

729 checks over 19 fixtures, ~38 per fixture, all hard. The full list of assertions
and the reasoning behind each threshold is in `verify-vector.mjs`'s header; the short
version is that every fixture is captured, emitted, **rendered and compared against a
screenshot of the live element**, translated to the Figma payload and fed to the real
plugin's `readPayload`, then captured 20 more times to prove it leaks nothing.

| page | fixtures | what they pin |
|---|---|---|
| `demo/vector.html` | `fx-card` `fx-type` `fx-ui` `fx-table` `fx-z` | the everyday surface: gradients, states, tables, stacking contexts |
| `demo/figma.html` | `fx-clone` `fx-card` `fx-prose` `fx-ui` | what the plugin eats, plus shadow DOM, `::marker`, icon-font ligatures |
| `demo/challenges.html` | ten, one hard problem each | `<img>`/`object-fit`/`srcset`/`background-size`, inline SVG with repeated ids, grid, transforms + `clip-path` + `mask-image`, `backdrop-filter`, hostile typography, `::marker` + CSS counters, native form controls, `border-collapse` tables, `oklch`/`color-mix`/`conic-gradient` |

`challenges.html` was outside the suite until 2026-08-05, which meant a week of fixes
to it — superscripts and subscripts, the wavy underline, the hyphenation glyph,
small-caps, `-webkit-text-stroke`, inline SVG, CSS counters — had **no test defending
any of it**. It is in now, with its own baselines.

**`serve.mjs` mounts two engine lines, and the vector suite uses one of them.** The
vector engine walks the clone a v3 render hook hands it. The `/snapdom-v2/` mount is
for pages that go through a snapdom EXPORT instead — `demo/capture-check.html` is the
one left here now that the PDF product has its own repository — and no single build
is both, so the mount is not shared:

| mount | default directory | override | who imports it |
|---|---|---|---|
| `/snapdom-v2/` | `../../snapdom` | `SNAPDOM_V2_DIR` (or `SNAPDOM_DIR`) | `demo/capture-check.html` |
| `/snapdom-v3/` | `node_modules/@zumer/snapdom` (the pinned release) | `SNAPDOM_V3_DIR` | `demo/vector.html`, `figma.html`, `challenges.html`, `h2d.html`, `destinos.html`, `hybrid-probe.html`, `paste-html.html`, `test/fixtures/vector.html`, `test/spike-clone.html` |

The rule for a new page is what it asks the engine for, not which package it demos:
anything that reads the CLONE out of a render hook (`beforeRender(state).clone`, which
is how `paste-html.html` and `spike-clone.html` got here without importing the vector
engine at all) is v3, and anything that goes through a snapdom EXPORT is v2.

A bare `/snapdom/` is refused with a message naming both, because a page that does not
say which line it wants is a page nobody can serve correctly — that shared mount is
what once silently ran the PDF suite against a v3 beta and failed 22 fixtures on
`missing export.requestedOptions`. Each suite checks its own mount once, up front,
instead of letting every case blame snapdom in general.

Three assertions are about content or state rather than appearance, and they run on all 19:

- **the first capture leaves every form control as it found it.** Mounting the clone
  used to drop copies of the page's radios into the page's own radio groups, and the
  browser unchecked the *live* one. Read before the first capture and after it,
  because the damage is done once and is then idempotent — a before/after around the
  20-capture loop cannot see it. `checked`/`indeterminate`/`value` are IDL state, so
  the attribute signature the leak check compares cannot see it either.

- **no element carries the same attribute twice.** Invalid XML makes Figma paste
  *nothing at all*, which is the hardest symptom there is to trace. Scanned off the
  raw text by consuming whole `name="value"` pairs, so the `=` padding in a base64
  data URL is not mistaken for an attribute.
- **the emitted text reconstructs the live element's text.** The measured lines must
  cover every character of their block, what a block paints must be a string the page
  really says, and every visible live text node must reach some block. Generated
  content (`::before`, `::after`, `::marker`) is admitted as at most one run at each
  end of a block, and the allowance for text that legitimately stops being text is
  `report.coverage.iconFont`, which the engine counts itself. Both detectors are run
  against **planted defects on every run** (`detectors (planted defects)`, plus a
  one-character loss planted in each fixture's own document), because a detector
  nobody ever sees fire is indistinguishable from one that always returns nothing.

## What is NOT covered

Be suspicious of green. These are holes, not oversights waiting to be discovered.
- **External pages, in CI.** Every fixture is a local file served by `serve.mjs` and
  nothing in a normal run touches the network. The vector suite can be pointed at a
  real URL (`--url=…`, below), but that mode asserts **nothing** on purpose and is
  never part of the tally, so "it captures snapdom.dev" is not a claim either suite
  makes.
- **Fonts beyond what the machine has.** Base-14 substitution and every pixel-diff
  threshold are asserted against whatever Chromium resolves *locally*. A machine with
  a different font stack will move typography numbers without any code changing; that
  is why the vector baselines carry `_provenance`.
- **Figma itself.** The vector pixel diff renders the emitted SVG in Chromium, not in
  Figma. What Figma does with the file — substituting the family, ignoring
  `letter-spacing`, reflowing a TextNode — is measured by hand and written down in
  `FIGMA_FINDINGS.md`; no test in this directory can see it.
- **Text CASE, and the first or last run of a text block.** The text audit folds case
  (because `text-transform` legitimately changes it) and lets generated content trim
  one run off each end of a block, so a corruption that lives exactly there is
  invisible to it. Everything between is not.
- **One browser, one renderer for the complete suite.** Chromium only; pdf.js only.
  The release gate separately smokes both built customer modules in Firefox and
  WebKit, but does not run this complex-layout matrix there. There is no check that
  Acrobat, Preview or a print RIP agrees — `pdfProblems()` is the closest thing,
  and it only proves the file describes itself honestly.
- **Colour management.** sRGB is assumed end to end; no ICC, no CMYK, no wide gamut.
- **Print.** No `@media print`, no page-box CSS, no headers/footers.
- **`paginate` is pure Node.** It proves the arithmetic, never that the DOM handed it
  the right blocks — only `table` and `prose` do that.

---

## Baselines

The vector suite records baselines, because "this SVG still has the same 41 primitives with the
same paint" has no live-DOM counterpart to derive.

```
npm run test:vector          compare against the recorded baselines
npm run test:vector:update   overwrite them with this run's output
```

**Update a baseline only when you can say, in the commit message, which numbers moved
and why that is better.** In practice:

- **Read the diff first.** Every changed line, not the summary. If you cannot explain
  a line, you are not updating a baseline, you are erasing a regression.
- **Never update to turn red green.** That is the entire failure mode. A suite that is
  updated whenever it complains has the information content of `exit 0`.
- **Never update when the diff got worse** — a primitive count that dropped, a grade
  that fell, a colour that drifted, a node that vanished. Fix it, or leave the check
  failing with a comment saying what is broken. A known-red check is worth more than a
  green one that lies.
- **Never update on a machine that differs from the one that recorded them.** Different
  fonts or a different Chromium produce a diff that is about the machine, not the code.
  Update where the numbers were made.
- **Never update on a BUSY machine.** Everything in the baseline except `ms` is
  bit-identical run to run (sd = 0.000000 over 5 runs), so contention cannot corrupt
  it — but `ms` is a real measurement and it will happily record the load instead of
  the code. This is not hypothetical: an `--update` taken while ten spinning processes
  saturated the CPU wrote an `ms` baseline exactly 2× the true value, which silently
  doubled every `msLimit` in the file. Check `uptime` first; re-record if the 1-minute
  load average is not near idle.
- **`why` is yours, not the tool's.** It is the only field a human writes and the only
  one `--update` preserves rather than overwrites. If a case's numbers are high on
  purpose, the reason belongs there, next to the number it explains.
- **Never update in the same commit as an unrelated change.** A baseline diff buried in
  a refactor is unreviewable.
- **Re-record only what you looked at.** `--update` rewrites every case the run
  measured, so a full `--update` taken while somebody else is changing the engine
  quietly accepts their work too. `node test/verify-vector.mjs --only=challenges
  --update` writes those cases and leaves the rest of the file byte for byte. The
  ten `challenges/*` baselines were recorded that way on 2026-08-05, with the other
  nine cases red at the time for reasons that belonged to another change.
- **Baselines are committed; `out/` is not.** Artifacts under `out/` are what the run
  produced, never what it expected. Copying one over a baseline is the same mistake as
  `--update`, done by hand.

If a baseline change is legitimate and large, say so out loud in the PR body and paste
the before/after numbers. Reviewers cannot see a re-recorded file.

---

## Pointing at a real page

Both suites serve from `test/serve.mjs`, so anything in the repo — and the sibling
snapdom checkout under `/snapdom/` — is reachable:

```
npm run demo                                   # then open:
#   http://localhost:4321/demo/vector.html?fixture=fx-card
#   http://localhost:4321/demo/figma.html
```

For the vector path there is no need to write anything: `node test/verify-vector.mjs
--url=https://example.com/ [--selector=…]` picks the largest visible block (or the
selector you give it), vectorises it, prints the numbers and leaves the artifacts in
`out/vector/wild/`. It asserts nothing and never fails the run — a suite that went red
on the open web would be muted within a week — and it says out loud that it bypasses
the target's CSP to inject the engine.

A page that is not ours never sets `window.__ready`, which is what the fixture wait
keys on. `harness.mjs` takes the readiness predicate as an argument for exactly this,
so a throwaway script against any URL is about ten lines:

```js
import { loadChromium, instrument, openFixture, check, report } from './test/harness.mjs'

const chromium = await loadChromium(process.cwd())
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const { errors } = instrument(page)
await openFixture(page, 'https://example.com/', { ready: () => document.readyState === 'complete' })
// ...capture #main here, assert with check()/near()...
check('the page raised no uncaught error', errors.length === 0, errors.join(' | '))
await browser.close()
report()
```

Two things to know before you trust the result: a live page keeps moving (ads, lazy
images, animations) so two runs are not the same document, and the harness's default
viewport is `1200×900` at `deviceScaleFactor: 1` — a real page is a different layout
at a different size, and comparing a capture taken at one to pixels taken at another
measures the viewport.

---

## harness.mjs

The shared surface, so both suites report identically. Two layers; a suite may use
one without the other. It had a third — everything that read a finished PDF back —
and that went to the PDF repository with the product it served.

| layer | exports |
|---|---|
| reporting | `results`, `setFixture`, `check`, `near`, `fmt`, `angleDelta`, `summarize`, `report`, `resetResults`, `currentFixture` |
| browser | `loadChromium(root)`, `instrument(page)`, `openFixture(page, url, opts)`, `livePixels(browser, url, selector, opts)`, `PROBES`, `clearArtifacts(dir)` |

`check(name, ok, detail)` records **and** prints, and returns the coerced boolean so a
caller can skip dependent checks. `summarize()` returns `{passed, failed, cases}` —
the shape `runVector(opts)` returns — and `report()` prints the summary, repeats every
failure with its fixture, and sets `process.exitCode`. Pass `{setExitCode: false}`
when something else owns the process's exit code.
