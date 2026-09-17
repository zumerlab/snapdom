/**
 * A dev build of the current commit, for users to test before a release:
 * `npm install @zumer/snapdom@dev`.
 *
 * Publishes the committed tree as `<next patch>-dev.<n>` under the `dev` dist-tag, the scheme
 * the earlier dev builds used. `latest` never moves, CHANGELOG.md is not touched, and nothing is
 * committed or pushed: the version sits in package.json and package-lock.json only while npm
 * publishes, and both files are written back byte for byte afterwards. The script prints the
 * commit it published.
 *
 *   npm run publish:dev               3.0.1-dev.0
 *   npm run publish:dev -- 3.1.0      3.1.0-dev.0, when the next release is a minor
 *   npm run publish:dev -- --dry-run  everything except the upload
 *
 * It refuses uncommitted changes, since the tarball would not be the commit it reports (a dry
 * run skips that check), and it runs test:pack first, so a dev build cannot ship a package whose
 * entrypoints or types are broken.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const baseArg = args.find((a) => /^\d+\.\d+\.\d+$/.test(a))

const run = (cmd, cmdArgs) => execFileSync(cmd, cmdArgs, { stdio: 'inherit' })
const read = (cmd, cmdArgs) => execFileSync(cmd, cmdArgs, { encoding: 'utf8' }).trim()

if (!dryRun && read('git', ['status', '--porcelain'])) {
  console.error('publish:dev: commit your changes first, the dev build has to match a commit.')
  process.exit(1)
}

const manifest = readFileSync('package.json', 'utf8')
const lock = readFileSync('package-lock.json', 'utf8')
const pkg = JSON.parse(manifest)
const [major, minor, patch] = pkg.version.split('-')[0].split('.').map(Number)
const base = baseArg || `${major}.${minor}.${patch + 1}`

// The next free <n> for this base, from what the registry already holds.
const devOf = new RegExp(`^${base.replace(/\./g, '\\.')}-dev\\.(\\d+)$`)
const taken = JSON.parse(read('npm', ['view', pkg.name, 'versions', '--json']))
  .map((v) => v.match(devOf))
  .filter(Boolean)
  .map((m) => Number(m[1]))
const n = taken.length ? Math.max(...taken) + 1 : 0
const version = `${base}-dev.${n}`
const sha = read('git', ['rev-parse', '--short', 'HEAD'])

console.log(`\npublish:dev: ${pkg.name}@${version} from commit ${sha}, under the dev tag${dryRun ? ' (dry run)' : ''}\n`)
run('npm', ['run', 'test:pack'])

try {
  run('npm', ['version', version, '--no-git-tag-version'])
  run('npm', ['publish', '--tag', 'dev', ...(dryRun ? ['--dry-run'] : [])])
} finally {
  writeFileSync('package.json', manifest)
  writeFileSync('package-lock.json', lock)
}

console.log(dryRun
  ? `\nDry run done. Nothing was uploaded; package.json and package-lock.json are unchanged.`
  : `\nPublished. Testers: npm install ${pkg.name}@dev  (or @${version})`)
