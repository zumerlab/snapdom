// Local dev server for the docs site running against the local build instead
// of the CDN: serves docs/ and rewrites snapdom unpkg imports (only inside
// <script> blocks and .js files, so displayed code snippets stay intact) to
// /__dist/, which is served from dist/. dist files are read per request, so
// re-running `npm run compile` in another terminal is picked up on reload.
// Run with: npm run site
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DOCS = join(ROOT, 'docs')
const DIST = join(ROOT, 'dist')
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
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm'
}

const CDN = /https:\/\/unpkg\.com\/@zumer\/snapdom(@[^/]+)?\/dist\//g
const rewriteJs = (s) => s.replace(CDN, '/__dist/')
const rewriteHtml = (s) => s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, rewriteJs)

createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (path.endsWith('/')) path += 'index.html'
  const file = path.startsWith('/__dist/') ? join(DIST, path.slice(8)) : join(DOCS, path)
  try {
    let body = readFileSync(file)
    const ext = extname(file)
    if (ext === '.html') body = rewriteHtml(body.toString())
    else if (ext === '.js' && !path.startsWith('/__dist/')) body = rewriteJs(body.toString())
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end()
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`docs site with local dist → http://127.0.0.1:${PORT}/`)
})
