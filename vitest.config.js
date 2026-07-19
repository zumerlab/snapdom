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
  test: {
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
