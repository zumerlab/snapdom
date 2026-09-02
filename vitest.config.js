// Drop-in replacement for snapdom/vitest.config.js.
// Adds snapdiff file-system commands to the existing browser config.
// BROWSER env var selects the engine: chromium (default) | firefox | webkit | all.

import { defineConfig, configDefaults } from 'vitest/config'
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

// Answers "what can this connection serve right now?" for every browser worker, from the one
// node process they all share: run network-dependent tests as usual, run them one at a time, or
// skip them. See __tests__/helpers/network-gate.js.
// `workers` is what makes "fast enough" a question about this run rather than about the
// link: BROWSER=all puts three engines on the same connection, and it also sets what the
// serial lane may cost before the run gives up on network tests altogether.
const networkGate = createNetworkGate({ workers: browsers.length })

// A stylesheet the page cannot read: `cssRules` throws on a cross-origin sheet (verified on
// all three engines), which is what makes the author-style scan "unreliable" and switches
// every gate to its probe-everything path. The test page lives on localhost, so a second
// host is enough — the same machine on 127.0.0.1. Tests call
// `commands.serveCrossOriginCss(cssText)` and get a URL for a <link>.
const crossOriginCss = (() => {
  const sheets = new Map()
  let server = null
  let port = 0
  async function start() {
    const { createServer } = await import('node:http')
    server = createServer((req, res) => {
      const css = sheets.get(req.url)
      if (css === undefined) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'content-type': 'text/css', 'cache-control': 'no-store' })
      res.end(css)
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    server.unref() // must not keep the run alive after the last test
    port = server.address().port
  }
  return {
    commands: {
      async serveCrossOriginCss(_ctx, css) {
        if (!server) await start()
        const path = `/${sheets.size}.css`
        sheets.set(path, String(css))
        return `http://127.0.0.1:${port}${path}`
      },
    },
  }
})()

// The first reading is taken here, before any browser starts, and handed to the suites via
// inject('network'). Tests re-consult the gate as they run (the run itself is what congests the
// link), but a value known at COLLECTION time is what lets a suite size its own test timeout: a
// slow link needs a longer one, and vitest bakes timeouts in when the tests are registered. The
// probe is bounded and paid once per run.
const network = await networkGate.status()

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
    // An agent worktree checked out under .claude/worktrees/ carries its own __tests__/, and
    // the default glob ran both copies — a filter by file name matched twice.
    exclude: [...configDefaults.exclude, '**/.claude/**'],
    provide: {
      network: { mode: network.mode, reading: network.reading, kbps: network.kbps, serialTimeoutMs: networkGate.serialTimeoutMs },
      // Suites size their own timeouts from this: the same demo has three times the machine
      // and three times the link contention under BROWSER=all.
      engines: browsers.length,
    },
    // The visual suite tests compiled dist/ — never let it pixel-diff a stale build.
    globalSetup: ['./scripts/ensure-fresh-dist.mjs', './scripts/require-visual.mjs'],
    browser: {
      enabled: true,
      provider: 'playwright',
      screenshotFailures: false,
      instances: browsers.map((browser) => ({ browser })),
      commands: { ...visualCommands, ...networkGate.commands, ...crossOriginCss.commands },
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
    },
  },
})
