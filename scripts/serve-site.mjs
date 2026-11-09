// Local dev server for the docs site running against the local build instead
// of the CDN: serves docs/ and rewrites core and plugin CDN imports (only inside
// <script> blocks and .js files, so displayed code snippets stay intact) to
// /__dist/ and /__pkg/<package>/. Files are read per request, so
// re-running `npm run compile` in another terminal is picked up on reload.
// Run with: npm run site
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DOCS = join(ROOT, 'docs')
const DIST = join(ROOT, 'dist')
// packages/<dir> publishes @zumer/snapdom-<dir>; its exports map names the public entries.
const PACKAGES = Object.fromEntries(['plugins', 'pdf', 'vector', 'stream'].map((dir) =>
  [dir, JSON.parse(readFileSync(join(ROOT, 'packages', dir, 'package.json'), 'utf8')).exports]))
const PORT = Number(process.env.PORT) || 4180

if (!existsSync(join(DIST, 'snapdom.mjs'))) {
  console.error('dist/snapdom.mjs not found — run `npm run compile` first')
  process.exit(1)
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm'
}

const CDN = /https:\/\/unpkg\.com\/@zumer\/snapdom(@[^/]+)?\/dist\//g
const PKG_CDN = /https:\/\/(?:esm\.sh|unpkg\.com)\/@zumer\/snapdom-(plugins|pdf|vector|stream)(?:@[^/'"`\s?]+)?(?=\/|['"`?]|$)/g
const rewriteJs = (s) => s.replace(CDN, '/__dist/').replace(PKG_CDN, '/__pkg/$1')
const rewritePackageJs = (s) => rewriteJs(s).replace(/(['"])@zumer\/snapdom(?:\/plugins)?\1/g, '$1/__dist/snapdom.mjs$1')
const rewriteHtml = (s) => s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, rewriteJs)

function localFile(base, path) {
  const file = resolve(base, `.${path}`)
  return file.startsWith(base + sep) ? file : null
}

function packageFile(path) {
  const [dir, ...rest] = path.slice('/__pkg/'.length).split('/')
  const entry = rest.join('/')
  if (!PACKAGES[dir]) return null
  // Public extensionless entries follow package exports; relative helper imports may request
  // relative .js modules, including a source tree. Neither route can escape the package directory.
  const exported = PACKAGES[dir][entry ? `./${entry}` : '.']
  const name = typeof exported === 'string' ? exported.slice(2) : entry
  if (!name.endsWith('.js')) return null
  return localFile(join(ROOT, 'packages', dir), `/${name}`)
}

createServer((req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    // A bare package (`/__pkg/pdf`) redirects to its root so the barrel's relative imports stay under it.
    const root = path.match(/^\/__pkg\/(\w+)$/)
    if (root) {
      res.writeHead(302, { location: `/__pkg/${root[1]}/` }).end()
      return
    }
    const pkg = path.startsWith('/__pkg/')
    const dist = path.startsWith('/__dist/')
    if (!pkg && path.endsWith('/')) path += 'index.html'
    const file = pkg ? packageFile(path)
      : dist ? localFile(DIST, path.slice('/__dist'.length)) : localFile(DOCS, path)
    if (!file) { res.writeHead(404).end(); return }
    let body = readFileSync(file)
    const ext = extname(file)
    if (ext === '.html') body = rewriteHtml(body.toString())
    else if (pkg) body = rewritePackageJs(body.toString())
    else if (ext === '.js' && !dist) body = rewriteJs(body.toString())
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end()
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`docs site with local core and plugins → http://127.0.0.1:${PORT}/`)
})
