// Local dev server for the docs site running against the local build instead
// of the CDN: serves docs/ and rewrites core/plugin CDN imports (only inside
// <script> blocks and .js files, so displayed code snippets stay intact) to
// /__dist/ and /__plugins/. Files are read per request, so
// re-running `npm run compile` in another terminal is picked up on reload.
// Run with: npm run site
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DOCS = join(ROOT, 'docs')
const DIST = join(ROOT, 'dist')
const PLUGINS = join(ROOT, 'packages/plugins')
const pluginEntries = JSON.parse(readFileSync(join(PLUGINS, 'package.json'), 'utf8')).exports
const PORT = Number(process.env.PORT) || 8123

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
const PLUGIN_CDN = /https:\/\/esm\.sh\/@zumer\/snapdom-plugins(?:@[^/'"`\s?]+)?(?=\/|['"`?]|$)/g
const rewriteJs = (s) => s.replace(CDN, '/__dist/').replace(PLUGIN_CDN, '/__plugins')
const rewritePluginJs = (s) => rewriteJs(s).replace(/(['"])@zumer\/snapdom(?:\/plugins)?\1/g, '$1/__dist/snapdom.mjs$1')
const rewriteHtml = (s) => s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, rewriteJs)

function localFile(base, path) {
  const file = resolve(base, `.${path}`)
  return file.startsWith(base + sep) ? file : null
}

function pluginFile(path) {
  const entry = path.slice('/__plugins/'.length)
  // Public extensionless entries follow package exports; relative helper imports may
  // request a single .js filename. Neither route can escape the plugin directory.
  const exported = pluginEntries[entry ? `./${entry}` : '.']
  const name = typeof exported === 'string' ? exported.slice(2) : entry
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.js$/.test(name)) return null
  return join(PLUGINS, name)
}

createServer((req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    // Keep relative imports in the barrel under /__plugins/ as well.
    if (path === '/__plugins') {
      res.writeHead(302, { location: '/__plugins/' }).end()
      return
    }
    const plugin = path.startsWith('/__plugins/')
    const dist = path.startsWith('/__dist/')
    if (!plugin && path.endsWith('/')) path += 'index.html'
    const file = plugin ? pluginFile(path)
      : dist ? localFile(DIST, path.slice('/__dist'.length)) : localFile(DOCS, path)
    if (!file) { res.writeHead(404).end(); return }
    let body = readFileSync(file)
    const ext = extname(file)
    // The archive must keep its pinned v2 dependencies even during v3 development.
    const archived = path.startsWith('/v2/')
    if (ext === '.html' && !archived) body = rewriteHtml(body.toString())
    else if (plugin) body = rewritePluginJs(body.toString())
    else if (ext === '.js' && !dist && !archived) body = rewriteJs(body.toString())
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end()
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`docs site with local core and plugins → http://127.0.0.1:${PORT}/`)
})
