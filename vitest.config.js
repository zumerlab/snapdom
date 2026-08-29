// Drop-in replacement for snapdom/vitest.config.js.
// Adds snapdiff file-system commands to the existing browser config.
// BROWSER env var selects the engine: chromium (default) | firefox | webkit | all.

import { defineConfig } from 'vitest/config'
import { snapDiffCommands } from '@zumer/snapdiff/vitest'
import { createNetworkGate } from './vitest.network.mjs'

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

// Answers "what can this connection serve right now?" for every browser worker, from the
// one node process they all share: run network-dependent tests as usual, run them one at a
// time, or skip them. See __tests__/helpers/network-gate.js.
// `workers` is what makes "fast enough" a question about this run rather than about the
// link: BROWSER=all puts three engines on the same connection, and it also sets what the
// serial lane may cost before the run gives up on network tests altogether.
const networkGate = createNetworkGate({ workers: browsers.length })

// The first reading is taken here, before any browser starts, and handed to the suites via
// inject('network'). Tests re-consult the gate as they run — the run itself is what
// congests the link — but a value known at COLLECTION time is what lets a suite size its
// own test timeout: a slow link needs a longer one, and vitest bakes timeouts in when the
// tests are registered. The probe is bounded and paid once per run.
const network = await networkGate.status()

export default defineConfig({
  test: {
    provide: {
      network: { mode: network.mode, reading: network.reading, kbps: network.kbps, serialTimeoutMs: networkGate.serialTimeoutMs },
      // Suites size their own timeouts from this: the same demo has three times the machine
      // and three times the link contention under BROWSER=all.
      engines: browsers.length,
    },
    browser: {
      enabled: true,
      provider: 'playwright',
      screenshotFailures: false,
      instances: browsers.map((browser) => ({ browser })),
      commands: { ...visualCommands, ...networkGate.commands },
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
    },
  },
})
