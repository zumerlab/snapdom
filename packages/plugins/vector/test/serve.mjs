import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Every page that captures has to import `@zumer/snapdom` from somewhere. It is a
// sibling checkout, not a dependency, so it gets its own mount instead of being
// copied into this repo.
//
// TWO mounts, because the two products in this repo need two different engines and
// there is no build that is both:
//
//   /snapdom-v2/  the published 2.x line, for pages that go through a snapdom
//                 EXPORT rather than a render hook — `demo/capture-check.html` is
//                 the one left here since the PDF product moved to its own
//                 repository, and it is why this mount survives.
//   /snapdom-v3/  packages/vector, svd and the Figma payload. The vector engine
//                 walks the CLONE a render hook hands it, and that clone has to be
//                 v3's: measured against the 2.x line the vector suite gives 683/693
//                 and the ten failures are all fidelity.
//
// One shared mount is what this used to be, and it could not be right for both: the
// v3 worktree was preferred whenever it existed, so the whole raster suite died on
// `missing export.requestedOptions` — 22 fixtures blaming snapdom in general. The
// bare `/snapdom/` prefix is now refused rather than resolved, because a request
// that does not say which line it wants is a request nobody can serve correctly.
//
// Each directory can be overridden on its own. `SNAPDOM_DIR` is still honoured as
// an alias for the v2 one.
// Two levels up, not one: this repository lives inside `snapdom-pro/`, the folder
// that mirrors the GitHub org, while the engine checkouts sit beside that folder
// under `zumerlab/`.
const SNAPDOM_V2 = path.resolve(process.env.SNAPDOM_V2_DIR || process.env.SNAPDOM_DIR ||
  path.resolve(ROOT, '..', '..', 'snapdom'))
// The v3 line is the exact `@zumer/snapdom` release pinned in devDependencies: the
// published package a buyer installs. A sibling checkout used to be the default and
// it moved under the suite; on 5 Aug 2026 its `dist/` was rebuilt from another
// branch, silently removing the plugin system every capture here depends on.
const SNAPDOM_V3 = path.resolve(process.env.SNAPDOM_V3_DIR ||
  path.resolve(ROOT, '../../..'))

/** The engine lines a page can ask for, by mount prefix. */
export const ENGINES = {
  v2: { prefix: '/snapdom-v2/', dir: SNAPDOM_V2, what: 'the published snapdom 2.x checkout' },
  v3: { prefix: '/snapdom-v3/', dir: SNAPDOM_V3, what: 'the pinned @zumer/snapdom 3.x install' },
}

/**
 * Mounts, most specific first. Each entry is its own containment root: a request
 * is resolved against exactly one of them and may never climb out of it.
 * @type {{prefix: string, dir: string, what: string}[]}
 */
const MOUNTS = [
  { prefix: ENGINES.v2.prefix, dir: ENGINES.v2.dir, what: ENGINES.v2.what },
  { prefix: ENGINES.v3.prefix, dir: ENGINES.v3.dir, what: ENGINES.v3.what },
  { prefix: '/', dir: ROOT, what: 'snapdom-pro (vector)' },
]

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
}

/**
 * Resolve a request path to a file on disk under exactly one mount.
 * @param {string} url decoded request path, always starting with `/`
 * @returns {{file: string, mount: typeof MOUNTS[number]}|null} null when the path
 *   escapes its mount — containment is checked per mount, not against a prefix.
 */
function resolve(url) {
  for (const mount of MOUNTS) {
    if (!url.startsWith(mount.prefix)) continue
    const rest = url.slice(mount.prefix.length - 1) || '/'
    const file = path.join(mount.dir, rest === '/' && mount.dir === ROOT ? 'demo/vector.html' : rest)
    // Containment, not prefix: `/../snapdom-pro-secret/x` also startsWith(ROOT).
    if (!file.startsWith(mount.dir + path.sep)) return null
    return { file, mount }
  }
  return null
}

/**
 * @param {number} [port] - 0 picks a free port, so parallel verify runs never collide.
 * @returns {Promise<import('node:http').Server>} with `.port` set to the assigned port.
 */
export function serve(port = 0) {
  const server = http.createServer((req, res) => {
    // A malformed escape (`/%`) or a NUL throws, and an uncaught throw in this
    // listener takes the whole suite down mid-run with no fixture attribution.
    let url
    try {
      url = decodeURIComponent(req.url.split('?')[0])
      if (url.includes('\0')) throw new Error('NUL in path')
    } catch {
      res.writeHead(400).end('bad request')
      return
    }
    // The old shared mount. Answered by name rather than by the catch-all's
    // anonymous 404, because a page still pointing here is not missing a file — it
    // is missing a DECISION, and the fix is one word in its import map.
    if (url.startsWith('/snapdom/')) {
      res.writeHead(404).end(
        `/snapdom/ no longer exists: pick an engine line. Use ${ENGINES.v2.prefix} for ` +
        `a page that goes through a snapdom export, or ${ENGINES.v3.prefix} for the ` +
        'vector engine, which walks the clone a v3 render hook hands it.')
      return
    }
    const hit = resolve(url)
    if (!hit) {
      res.writeHead(404).end('not found')
      return
    }
    // A directory serves its index.html, the way every static host does — otherwise
    // a link to `pdf/` works in production and 404s here, which is the wrong way
    // round for a dev server to be wrong.
    if (fs.existsSync(hit.file) && fs.statSync(hit.file).isDirectory()) {
      const index = path.join(hit.file, 'index.html')
      if (fs.existsSync(index)) hit.file = index
    }
    if (!fs.existsSync(hit.file) || fs.statSync(hit.file).isDirectory()) {
      // A missing sibling checkout is the one 404 nobody guesses from the URL, so
      // it says which directory it looked in instead of failing anonymously.
      res.writeHead(404).end(`not found: ${url} — looked in ${hit.mount.what} at ${hit.file}`)
      return
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(hit.file)] || 'application/octet-stream' })
    fs.createReadStream(hit.file).pipe(res)
  })
  return new Promise(resolve => server.listen(port, () => {
    server.port = server.address().port
    resolve(server)
  }))
}

/**
 * Is the mounted snapdom build one this repo can capture with?
 *
 * One failure, and it is the one nobody guesses from the symptom: the bundle is not
 * there, so every import 404s and every page dies before it runs a line of its own.
 *
 * There used to be a second check here, for the public `retain` option, and it has
 * been deleted rather than updated. Two reasons, in order:
 *
 * 1. `retain` is GONE. It was reverted in snapdom-v3 — the plugin system's render
 *    hooks already hand the clone over, so the option widened the public surface for
 *    nothing. The check outlived the thing it checked and would now refuse to serve
 *    the very build the engine needs.
 *
 * 2. Nothing legible replaces it, and pretending otherwise would be worse. The
 *    obvious substitute is `defineExports`, but MEASURED: the pinned node_modules
 *    copy (2.23.2, i.e. `main`) has `defineExports`, runs `beforeRender`, and hands
 *    over a clone — a probe hook saw all three. So a sniff for it passes on exactly
 *    the build it is meant to catch. The suppressor literal the adapter anchors on
 *    is in both bundles too.
 *
 * What a `main` build actually costs is no longer uniform and no longer needs
 * announcing up front: running the suite against 2.23.2 gives 683/693, and the ten
 * failures name themselves — `figma/fx-clone` drifts 29.6px median / 50.0px max and
 * files `B4.upgraded-custom-element` (its clone does not flatten shadow DOM the way
 * v3's does), and `challenges/fx-img` comes back 12KB short (an asset not inlined).
 * That reads better than any string this function could look for, so the suite is
 * left to say it.
 *
 * @param {'v2'|'v3'} line which engine mount the calling suite captures through
 * @returns {string|null} the problem, ready to print, or null when the build is usable
 */
export function snapdomBuildProblem (line) {
  const engine = ENGINES[line]
  if (!engine) throw new Error(`snapdomBuildProblem: unknown engine line ${line}`)
  const file = path.join(engine.dir, 'dist/snapdom.mjs')
  if (!fs.existsSync(file)) {
    return `${engine.prefix} is mounted on ${engine.dir} but dist/snapdom.mjs is not there — ` +
      'build it (`node esbuild.config.mjs` in that repo) or every capture on this suite ' +
      '404s on import.'
  }
  return null
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = await serve(Number(process.argv[2]) || 4321)
  console.log(`http://localhost:${server.port}`)
  for (const line of ['v2', 'v3']) {
    const problem = snapdomBuildProblem(line)
    if (problem) console.warn(`[serve] ${problem}`)
  }
}
