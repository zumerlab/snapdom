# next branch — what's here and what can graduate to main

Working notes for the architecture work on `next`. Each item states its risk profile and
whether it can cherry-pick to `main` independently.

## Landed on next

### 1. `perf: stylesheet-scan property universe` (aeefbaa) — **main-ready, biggest cold-capture win**

`src/modules/styleScan.js` + integration in `styles.js`. Scans the document's stylesheets once
(per style epoch) for the set of CSS properties any rule can touch; per-node snapshots read
only that universe (+ a ~110-prop always-list + the node's inline props) instead of all ~400.

- Measured: cold capture (`cache: 'disabled'`) **1.5×/1.75×/1.9×** faster (Modal/Page/Large
  card-grid scenes). Warm-repeat pipeline unchanged (snapshotCache already amortized it).
- Property reads themselves: 8.6×/9.2× faster (chromium/webkit, 45-prop probe).
- Fallbacks: cross-origin CSS → full reads; shadow-root nodes → full reads; WAAPI keyframe
  props unioned in; rule budget 20k.
- Dead ends measured, do not retry: Typed OM `computedStyleMap()` is ~2× SLOWER than
  enumeration; copying stylesheets into the clone (~0%, see compression experiment).
- Verified: full suite 3 engines + visual baselines byte-green.

### 2. `feat: auto-burst` (88e079d) — **main-ready, but ship notes below**

`burst` becomes tri-state: explicit true/false win; unset auto-enables after 3 captures of
the same element in a 2s sliding window. The old console.warn advice is gone (it now just
does the thing it advertised). Canvas-bearing elements are excluded from auto mode (canvas
pixel draws are invisible to MutationObserver — explicit `burst:true` + `invalidate` still
available there). `captureWithBurst` already flushes `takeRecords()` synchronously before
serving the memo, so DOM mutations can never be missed by timing.

- Measured: repeated captures of a static element ~**300–5000×** (it's a memo hit).
- Ship notes for main: docs must say polling loops get this for free now; CSSOM-only
  mutation apps (insertRule) should pass `burst:false` or `invalidate:true` — same caveat
  the explicit option always had, but now it can engage without opt-in.
- Benchmarks: all `*.benchmark.js` now pin `burst:false` — otherwise they measure the memo.

### 3. `refactor: per-capture session object` (cc88a5e) — **main-ready**

`src/core/session.js` — `createCaptureSession(policy)` created in captureDOM's first
synchronous tick; the capture never trusts `cache.session` after an await. Removed
rasterizeIframe's save/restore of the global session (redundant now). `cache.session`
remains only as a legacy surface for direct callers (preCache, tests).

- This is the structural cure for the shared-mutable-state race class (#463, the double
  scroll-compensation bug). Follow-up candidate: migrate preCache + styles.js `_resolveCtx`
  fallback off `cache.session`, then delete the global bucket entirely.

## Known flake (pre-existing)

`visual.demos.test.js > d-compress` on webkit fails intermittently (~1 in 5 FULL-suite runs,
2.1% pixel mismatch; 6/6 green in isolation). Load-sensitive decode timing; this demo has a
prior history of intermittent blanks (see bench/snapeye-dev.mjs investigation). Options:
per-demo mismatch tolerance bump for webkit, or re-run that harness under load.

## Not done (assessed, next steps)

- **Differential capture (burst v2)**: keep the clone alive; MutationObserver marks dirty
  subtrees; recapture re-runs stages only on dirty nodes and splices. Turns mutating-poll
  captures from O(tree) into O(dirty). Builds on burst + nodeMap + reconcile pieces.
- **RenderBackend abstraction**: isolate foreignObject-svg rendering behind an interface so
  WICG html-in-canvas (`drawElementImage`) can slot in when it ships; quarantines the
  per-engine quirk layer (Safari fixes) into one backend file.
- **Worker offload**: only `compress` downsampling qualifies (OffscreenCanvas); svg-as-image
  decode must stay on main. Low priority.
- **Folder reorg by pipeline stage**: deliberately skipped — ~90 test files import src paths
  directly; churn outweighs benefit while the session object already enforces the state
  contract.
