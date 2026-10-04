// Runs vitest the way the npm scripts call it, then gives every test the network gate skipped
// a second turn.
//
// The gate (vitest.network.mjs, __tests__/helpers/network-gate.js) skips a test that needs the
// network when the link cannot serve it at that moment, and the run itself is what congests
// the link: eighteen workers under BROWSER=all. Once the rest of the run is over, those tests
// run again here one engine at a time and one file at a time, so each has the link and the
// machine to itself. Nothing to configure: a link that served the first pass leaves nothing
// to rerun, and one that cannot serve even this pass (offline) leaves the tests skipped.
// Under REQUIRE_VISUAL (npm run release) a test still skipped then fails the run: a release
// is not green on demos it never compared.
//
// Arguments are vitest's own: `node scripts/vitest.mjs run --browser.headless ...`.
import { parseCLI, startVitest } from 'vitest/node'

// SKIP_NOTE in __tests__/helpers/network-gate.js, which a node process cannot import.
const SKIP_NOTE = 'network gate: '
const ON = ['1', 'true', 'yes']

/** Tests the gate skipped, with the project and file they ran in. */
function gateSkipped(vitest) {
  const found = []
  const walk = (task, file, path) => {
    for (const child of task.tasks ?? []) {
      const names = [...path, child.name]
      if (child.type === 'suite') walk(child, file, names)
      else if (child.result?.state === 'skip' && child.result.note?.startsWith(SKIP_NOTE)) {
        found.push({ project: file.projectName, file: file.filepath, name: names.join(' ') })
      }
    }
  }
  for (const file of vitest.state.getFiles()) walk(file, file, [])
  return found
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const { filter, options } = parseCLI(['vitest', ...process.argv.slice(2)])
let skipped = gateSkipped(await startVitest('test', filter, options))

if (skipped.length) {
  console.log(`\n[network gate] running the ${skipped.length} tests it skipped again, one at a time\n`)
  const left = []
  for (const project of new Set(skipped.map((t) => t.project))) {
    const tests = skipped.filter((t) => t.project === project)
    const again = await startVitest('test', [...new Set(tests.map((t) => t.file))], {
      ...options,
      project,
      fileParallelism: false,
      // Anchored at the end only: the full name vitest matches starts with the enclosing suites.
      testNamePattern: new RegExp(`(?:^| )(?:${tests.map((t) => escape(t.name)).join('|')})$`),
    })
    left.push(...gateSkipped(again))
  }
  skipped = left
}

if (skipped.length) {
  const list = skipped.map((t) => `  ${t.project}: ${t.name}`).join('\n')
  if (ON.includes(String(process.env.REQUIRE_VISUAL || '').toLowerCase())) {
    console.error(`\nRelease coverage incomplete, still skipped for the connection:\n${list}\n`)
    process.exitCode = 1
  } else {
    console.log(`\n[network gate] still skipped for the connection:\n${list}\n`)
  }
}
// vitest's own CLI exits the same way: a closed run can leave handles that keep node alive.
process.exit()
