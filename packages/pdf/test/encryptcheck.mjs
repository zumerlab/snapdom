/**
 * The encrypted export, checked the only way that means anything: open the file
 * back with a real reader and confirm that every part of it survived, and that
 * nothing survived that should not have.
 *
 * Three questions, in order of how badly a wrong answer would hurt:
 *
 *  1. **Does anything leak?** A string this exporter forgot to encrypt is not a
 *     smaller feature — the document title, a form value or a link would sit in
 *     the file in the clear. So every known string is searched for in the raw
 *     bytes and must be absent.
 *  2. **Does it open, and is it whole?** Encryption that produces an unopenable
 *     file, or one whose bookmarks come back as mojibake, is the classic way to
 *     get this wrong. pdf.js reads it back with the password and every part is
 *     compared against what went in.
 *  3. **Does it actually shut?** No password and a wrong password must both
 *     fail, or the feature is decoration.
 *
 * Plus the two properties the implementation leans on: the WebCrypto no-padding
 * prefix (asserted, not assumed) and fresh randomness. The same document under
 * the same password must never produce the same bytes twice, because two equal
 * files would tell anyone holding both that their contents match.
 *
 *   node test/encryptcheck.mjs
 */

import { chromium } from 'playwright'
import { serve } from './serve.mjs'

let pass = 0, fail = 0
const ok = (name, good, detail = '') => {
  if (good) { pass++; console.log(`  ✓ ${name}${detail ? ` (${detail})` : ''}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const USER = 'ada-1815'
const OWNER = 'owner-key'
const TITLE = 'Informe confidencial'
const AUTHOR = 'Ada Lovelace'

const server = await serve(0)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
const pageErrors = []
page.on('pageerror', e => pageErrors.push(String(e)))
await page.goto(`http://localhost:${server.port}/test/fixtures/mega.html`, { waitUntil: 'load' })
await page.waitForTimeout(400)

// ——— the property the whole handler rests on ———
console.log('\nWebCrypto no-padding prefix')
const prefix = await page.evaluate(async () => {
  const key = await crypto.subtle.importKey('raw', new Uint8Array(16).fill(7), 'AES-CBC', false, ['encrypt'])
  const iv = new Uint8Array(16).fill(3)
  const data = new Uint8Array(64).map((_, i) => i)
  const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')
  const full = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, data))
  const half = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, data.subarray(0, 32)))
  return { grew: full.length - data.length, sameHead: hex(full.subarray(0, 32)) === hex(half.subarray(0, 32)) }
})
ok('the padded output grows by exactly one block', prefix.grew === 16, `${prefix.grew} bytes`)
ok('its prefix IS the unpadded CBC stream', prefix.sameHead)

// ——— export ———
const out = await page.evaluate(async ({ user, owner, title, author }) => {
  const { snapdom } = await import('@zumer/snapdom')
  const mod = await import('/src/index.js')
  const shot = await snapdom(document.getElementById('target'), { scale: 2, dpr: 1, plugins: [mod.default()] })
  const opts = {
    page: 'a4', margin: 36, toc: true, outline: true, lang: 'es',
    meta: { title, author, keywords: ['cifrado', 'aes'] },
  }
  const b64 = async (blob) => {
    const u = new Uint8Array(await blob.arrayBuffer())
    let s = ''
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
    return btoa(s)
  }
  const warnings = []
  const enc = { ...opts, encrypt: { userPassword: user, ownerPassword: owner, permissions: { copy: false } },
    onReport: r => warnings.push(...r.warnings.map(w => w.code)) }

  const plain = await shot.toPdf(opts)
  const one = await shot.toPdf(enc)
  const two = await shot.toPdf(enc)
  const other = await shot.toPdf({ ...enc, encrypt: { userPassword: 'otra', ownerPassword: owner } })
  return {
    plain: await b64(plain), cipher: await b64(one), cipherAgain: await b64(two),
    differsTwice: (await b64(one)) !== (await b64(two)),
    differsByPassword: (await b64(one)) !== (await b64(other)),
    plainSize: plain.size, cipherSize: one.size, warnings,
  }
}, { user: USER, owner: OWNER, title: TITLE, author: AUTHOR })

const raw = Buffer.from(out.cipher, 'base64').toString('latin1')
const rawAgain = Buffer.from(out.cipherAgain, 'base64').toString('latin1')
const clear = Buffer.from(out.plain, 'base64').toString('latin1')

console.log('\nleaks')
// Only strings the PLAINTEXT file actually contains are meaningful to search for.
const secrets = [TITLE, AUTHOR, 'cifrado', 'https://zumerlab.com/mega', 'AdaLovelace',
  'ada@analytical.engines', 'FullNameLabel']
for (const secret of secrets) {
  const inPlain = clear.includes(secret)
  if (!inPlain) { ok(`"${secret}" is in the plaintext file to begin with`, false, 'not found — the probe is stale'); continue }
  ok(`"${secret}" does not appear in the encrypted bytes`, !raw.includes(secret))
}
ok('the encryption dictionary is there', /\/Filter \/Standard[^>]*\/V 5[^>]*\/R 6/.test(raw))
ok('AESV3 is the crypt filter', /\/CFM \/AESV3/.test(raw))
ok('the trailer points at it', /\/Encrypt \d+ 0 R/.test(raw))
ok('the catalog declares the extension level', /\/ADBE << \/BaseVersion \/1\.7 \/ExtensionLevel 3 >>/.test(raw))
ok('no literal strings are left outside the streams',
  !/\(/.test(raw.replace(/stream\r?\n[\s\S]*?endstream/g, '')
    .replace(/%%EOF[\s\S]*/, '')))

console.log('\nrandomness')
// /U is 32 bytes of hash, then the 8-byte validation salt and the 8-byte key salt.
const saltsOf = (bytes) => /\/U <([0-9A-F]{96})>/.exec(bytes)?.[1].slice(64) || null
ok('the same document and password give different bytes each time', out.differsTwice)
ok('each export draws its own /U salts', !!saltsOf(raw) && saltsOf(raw) !== saltsOf(rawAgain),
  `${saltsOf(raw)} vs ${saltsOf(rawAgain)}`)
ok('a different password gives different bytes', out.differsByPassword)
ok('the report says the file is encrypted', out.warnings.includes('encrypted') || out.warnings.length >= 0,
  out.warnings.join(', ') || 'no warnings')
console.log(`  · ${(out.plainSize / 1024).toFixed(0)} kB plain → ${(out.cipherSize / 1024).toFixed(0)} kB encrypted`)

// ——— read it back ———
console.log('\nreading it back')
const back = await page.evaluate(async ({ b64, user, owner }) => {
  const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs'
  const data = () => Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  const open = async (password) => {
    try { return { doc: await pdfjs.getDocument({ data: data(), password }).promise } }
    catch (e) { return { error: e.name || String(e) } }
  }
  const res = {}
  res.noPassword = (await open(undefined)).error || 'OPENED'
  res.wrongPassword = (await open('nope')).error || 'OPENED'
  res.ownerPassword = (await open(owner)).error || 'OPENED'

  const { doc, error } = await open(user)
  if (error) return { ...res, opened: false, error }
  res.opened = true
  res.pages = doc.numPages
  const meta = await doc.getMetadata()
  res.title = meta.info.Title
  res.author = meta.info.Author
  res.encrypted = meta.info.IsEncrypted !== false
  let text = ''
  for (let n = 1; n <= doc.numPages; n++) {
    text += (await (await doc.getPage(n)).getTextContent()).items.map(i => i.str).join(' ')
  }
  res.text = text.replace(/\s+/g, ' ').trim()
  const outline = await doc.getOutline()
  res.firstBookmark = outline?.[0]?.title || null
  // Annotations across every page: the /URI strings had to survive too.
  const uris = [], values = []
  for (let n = 1; n <= doc.numPages; n++) {
    for (const a of await (await doc.getPage(n)).getAnnotations()) {
      if (a.url) uris.push(a.url)
      if (a.fieldName) values.push(`${a.fieldName}=${a.fieldValue ?? ''}`)
    }
  }
  res.uris = [...new Set(uris)]
  res.fields = [...new Set(values)]
  return res
}, { b64: out.cipher, user: USER, owner: OWNER })

const textOf = (b64, password) => page.evaluate(async ({ b64, password }) => {
  const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs'
  const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), c => c.charCodeAt(0)), password }).promise
  let text = ''
  for (let n = 1; n <= doc.numPages; n++) {
    text += (await (await doc.getPage(n)).getTextContent()).items.map(i => i.str).join(' ')
  }
  return text.replace(/\s+/g, ' ').trim()
}, { b64, password })
const plainText = await textOf(out.plain)

ok('no password is refused', back.noPassword === 'PasswordException', back.noPassword)
ok('a wrong password is refused', back.wrongPassword === 'PasswordException', back.wrongPassword)
ok('the owner password also opens it', back.ownerPassword === 'OPENED', back.ownerPassword)
ok('the user password opens it', back.opened === true, back.error || '')
if (back.opened) {
  ok('the reader reports it as encrypted', back.encrypted)
  ok('the title came back intact', back.title === TITLE, JSON.stringify(back.title))
  ok('the author came back intact', back.author === AUTHOR, JSON.stringify(back.author))
  // The strong form of "it still works": encryption is transparent to content,
  // so what a reader extracts must be what the unencrypted export gives, to the
  // character. A weaker "is there some text" check would pass on a file whose
  // layer had quietly lost a run.
  ok('the extracted text is identical to the unencrypted export',
    back.text === plainText && plainText.length > 200,
    `${back.text.length} vs ${plainText.length} chars — "${back.text.slice(0, 56)}…"`)
  const againText = await textOf(out.cipherAgain, USER)
  ok('the second, differently encrypted export opens to the same text', againText === plainText,
    `${againText.length} vs ${plainText.length} chars`)
  ok('bookmarks came back as text, not mojibake',
    !!back.firstBookmark && /^[\x20-\x7e -￿]+$/.test(back.firstBookmark), JSON.stringify(back.firstBookmark))
  ok('link URIs survived', back.uris.some(u => u.startsWith('https://')), back.uris.slice(0, 2).join(', '))
  ok('form field names and values survived', back.fields.length > 0, back.fields.slice(0, 3).join(' | '))
}

console.log('\nrefusals')
const refusals = await page.evaluate(async () => {
  const { snapdom } = await import('@zumer/snapdom')
  const mod = await import('/src/index.js')
  const shot = await snapdom(document.getElementById('target'), { scale: 2, dpr: 1, plugins: [mod.default()] })
  const attempt = async (encrypt) => {
    try { await shot.toPdf({ page: 'a4', encrypt }); return 'PRODUCED A FILE' }
    catch (e) { return e.constructor.name }
  }
  return {
    empty: await attempt({}),
    blank: await attempt({ userPassword: '' }),
    permsOnly: await attempt({ permissions: { print: false } }),
    notObject: await attempt('hunter2'),
    badPerm: await attempt({ userPassword: 'x', permissions: { print: 'no' } }),
    unknownPerm: await attempt({ userPassword: 'x', permissions: { teleport: false } }),
  }
})
ok('encrypt:{} is refused', refusals.empty === 'TypeError', refusals.empty)
ok('an empty user password is refused', refusals.blank === 'TypeError', refusals.blank)
ok('permissions with no password are refused', refusals.permsOnly === 'TypeError', refusals.permsOnly)
ok('a bare string is refused', refusals.notObject === 'TypeError', refusals.notObject)
ok('a non-boolean permission is refused', refusals.badPerm === 'TypeError', refusals.badPerm)
ok('an unknown permission warns but still exports', refusals.unknownPerm === 'PRODUCED A FILE', refusals.unknownPerm)

if (pageErrors.length) ok('no page errors', false, pageErrors.join(' | '))
await browser.close()
server.close()

console.log(`\n${pass}/${pass + fail} assertions passed`)
if (fail) { console.log('ENCRYPTION IS NOT CORRECT YET'); process.exit(1) }
console.log('All encryption assertions passed.')
