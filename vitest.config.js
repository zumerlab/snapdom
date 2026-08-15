// Drop-in replacement for snapdom/vitest.config.js.
// Adds snapdiff file-system commands to the existing browser config.
// BROWSER env var selects the engine: chromium (default) | firefox | webkit | all.

import { defineConfig } from 'vitest/config'
import { snapDiffCommands } from '@zumer/snapdiff/vitest'

const ALL_BROWSERS = ['chromium', 'firefox', 'webkit']
const requested = process.env.BROWSER || 'chromium'
const browsers = requested === 'all' ? ALL_BROWSERS : [requested]

// Commands must be registered at the top browser level (per-instance commands
// are ignored by vitest), so each command resolves its baseDir from the
// project name (= browser) at call time to keep visual baselines separated.
const visualCommands = Object.fromEntries(
  Object.keys(snapDiffCommands()).map((name) => [name, (ctx, ...args) => {
    const browser = ctx.project?.name
    const baseDir = browser && browser !== 'chromium' ? `__snapshots__/visual-${browser}` : '__snapshots__/visual'
    return snapDiffCommands({ baseDir })[name](ctx, ...args)
  }])
)

export default defineConfig({
  // packages/plugins/* import '@zumer/snapdom' by NAME (they are published separately, so they
  // must). Under test that name resolved to whatever npm had installed in node_modules — the
  // last PUBLISHED release, 2.24.1 — so gif-export and video-export ran their internal
  // recaptures against v2 while claiming to test v3. Point the bare specifier at this
  // checkout's source: same module graph as `../src/...` imports in the tests, so the plugins
  // and the suite share one runtime and one plugin registry.
  resolve: {
    alias: { '@zumer/snapdom': new URL('./src/index.js', import.meta.url).pathname },
  },
  test: {
    // The visual suite tests compiled dist/ — never let it pixel-diff a stale build.
    globalSetup: ['./scripts/ensure-fresh-dist.mjs', './scripts/require-visual.mjs'],
    browser: {
      enabled: true,
      provider: 'playwright',
      screenshotFailures: false,
      instances: browsers.map((browser) => ({ browser })),
      commands: visualCommands,
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
    },
  },
})
