// Vitest globalSetup: refuse to call a run "green" when the visual suite could not have
// caught anything.
//
// Two ways that happens, both silent:
//   1. `demos/` is gitignored. visual.demos.test.js globs /demos/d*.html, gets nothing, and
//      registers a describe.skip — so a fresh clone reports a fully passing `npm test` while
//      having pixel-diffed zero demos.
//   2. Baselines are recorded on FIRST run. With an empty __snapshots__/visual the suite
//      records whatever the current build produces and passes, which only proves the build
//      agrees with itself.
//
// Neither should fail an ordinary contributor's run — a fork legitimately has no demos — so
// this is opt-in and the release script turns it on. `npm run release` is the moment those
// silences stop being acceptable.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ON = ['1', 'true', 'yes']

export default function requireVisual() {
  if (!ON.includes(String(process.env.REQUIRE_VISUAL || '').toLowerCase())) return

  const root = new URL('..', import.meta.url).pathname
  const list = (dir, test) => (existsSync(dir) ? readdirSync(dir).filter(test) : [])

  const demos = list(join(root, 'demos'), (f) => /^d.*\.html$/.test(f))
  const baseDir = join(root, '__snapshots__', 'visual')
  const baselines = list(baseDir, (f) => f.endsWith('.png'))

  const problems = []
  if (!demos.length) {
    problems.push('no demos/d*.html — the visual suite skips itself entirely, so a green run proves nothing about pixels')
  }
  if (!baselines.length) {
    problems.push('no baselines in __snapshots__/visual — the first run RECORDS them and passes, which only proves this build agrees with itself')
  }
  if (problems.length) {
    throw new Error(`[require-visual] REQUIRE_VISUAL is set but ${problems.join('; and ')}`)
  }
  console.log(`[require-visual] ${demos.length} demos, ${baselines.length} baselines`)
}
