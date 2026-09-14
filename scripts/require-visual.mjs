// Vitest globalSetup: refuse to call a run "green" when the visual suite could not have
// caught anything.
//
// Two ways that happens, both silent:
//   1. `demos/` is missing (a sparse checkout, or a worktree created before it was
//      committed). visual.demos.test.js globs /demos/d*.html, gets nothing, and registers a
//      describe.skip — so the run reports a fully passing `npm test` while having
//      pixel-diffed zero demos.
//   2. Baselines are recorded on FIRST run. With an empty __snapshots__/visual the suite
//      records whatever the current build produces and passes, which only proves the build
//      agrees with itself.
//
// Neither should fail an ordinary contributor's run — a fork legitimately has no demos — so
// this is opt-in and the release script turns it on. `npm run release` is the moment those
// silences stop being acceptable.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { skippedVisualDemos } from './visual-policy.mjs'

const ON = ['1', 'true', 'yes']

export default function requireVisual(root = fileURLToPath(new URL('..', import.meta.url)), env = process.env) {
  // Vitest passes its project as the first argument to globalSetup.
  if (typeof root !== 'string') root = fileURLToPath(new URL('..', import.meta.url))
  if (!ON.includes(String(env.REQUIRE_VISUAL || '').toLowerCase())) return

  const list = (dir, test) => (existsSync(dir) ? readdirSync(dir).filter(test) : [])

  const demos = list(join(root, 'demos'), (f) => /^d.*\.html$/.test(f))
    .map(f => f.slice(0, -5)).filter(name => !skippedVisualDemos.has(name))
  const browsers = env.BROWSER === 'all' ? ['chromium', 'firefox', 'webkit'] : [env.BROWSER || 'chromium']

  const problems = []
  if (!demos.length) {
    problems.push('no demos/d*.html — the visual suite skips itself entirely, so a green run proves nothing about pixels')
  }
  if (ON.includes(String(env.VITE_UPDATE_VISUAL || '').toLowerCase()) || ON.includes(String(env.UPDATE_VISUAL || '').toLowerCase())) {
    problems.push('baseline updates are enabled — a release must compare against existing baselines')
  }
  for (const browser of browsers) {
    const dir = browser === 'chromium' ? 'visual' : `visual-${browser}`
    const baselines = new Set(list(join(root, '__snapshots__', dir), f => f.endsWith('.png')))
    const missing = demos.filter(name => !baselines.has(`${name}.png`))
    if (missing.length) problems.push(`${dir} is missing ${missing.length} baselines: ${missing.join(', ')}`)
  }
  if (problems.length) {
    throw new Error(`[require-visual] REQUIRE_VISUAL is set but ${problems.join('; and ')}`)
  }
  console.log(`[require-visual] ${demos.length} demos have baselines for ${browsers.join(', ')}`)
}
