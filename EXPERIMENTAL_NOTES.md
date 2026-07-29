# experimental branch — lab notes

Bolder sibling of `next` (branched from it 2026-07-28). Same graduation model as
NEXT_NOTES → main: each item below states its verdict — **graduate to next**, **keep
experimenting**, or **discarded (with evidence)**. Source roadmap: 49 adversarially-verified
findings from the 67-agent principles audit (details in the session's findings-detail.md).

## Wave 0 — guardrails

- **dist-stale guard** (`scripts/ensure-fresh-dist.mjs`, vitest globalSetup): the visual
  suite tests compiled dist/; a stale build already masked a real styleScan regression
  once. Now any vitest run recompiles automatically when src is newer than dist.
  Verdict candidate: **graduate to next** (zero-cost, closes a demonstrated false-green).
- **.claude/CLAUDE.md tracked** + real-Safari verification method documented in it
  (SnapEye harness + safaridriver fallback; Playwright WebKit does not reproduce #219770).
  Verdict candidate: **graduate to next**.
