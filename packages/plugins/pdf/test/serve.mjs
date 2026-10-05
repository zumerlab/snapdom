import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveSnapdomCore } from './compatibility.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Every page and its pixel oracle use one verified v3 checkout.
const { directory: SNAPDOM_DIR } = resolveSnapdomCore()
export const ENGINES = {
  current: { prefix: '/snapdom/', dir: SNAPDOM_DIR, what: 'the selected SnapDOM core' },
}
const MOUNTS = [
  { prefix: '/node_modules/', dir: path.join(SNAPDOM_DIR, 'node_modules'), what: 'test dependencies' },
  ENGINES.current,
  { prefix: '/', dir: ROOT, what: 'snapdom-pdf' },
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
    const file = path.join(mount.dir, rest === '/' && mount.dir === ROOT ? 'demo/index.html' : rest)
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

/** A missing core build is reported once before the fixture imports run. */
export function snapdomBuildProblem (line = 'current') {
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
  for (const line of Object.keys(ENGINES)) {
    const problem = snapdomBuildProblem(line)
    if (problem) console.warn(`[serve] ${problem}`)
  }
}
