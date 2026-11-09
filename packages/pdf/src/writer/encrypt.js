/**
 * Standard security handler, revision 6: AES-256, and nothing older.
 *
 * A PDF that leaves the browser as a download IS the delivery channel, so the
 * only encryption worth writing here is the kind that protects the file at rest
 * once it has been shared. That rules two things out, in opposite directions:
 *
 *  - **RC4 and the /V 1–4 revisions are not offered.** A 40-bit key is brute
 *    forced in seconds and 128-bit RC4 is not far behind; both also need MD5,
 *    which the platform deliberately does not provide. Writing them by hand to
 *    ship a weaker product is not a trade this file makes.
 *  - **Permission flags are not protection and are not sold as such.** `/P` is
 *    a request a viewer may honour; any tool can ignore it. What actually keeps
 *    a document shut is the user password, because without it the bytes cannot
 *    be read at all. The flags are written because the format has them, and the
 *    caller is told what they are worth.
 *
 * Everything here comes from `crypto.subtle`: SHA-256/384/512 for Algorithm 2.B
 * and AES-CBC for the rest. No dependency, no hand-rolled cipher, no MD5.
 *
 * **One thing WebCrypto will not do**, and the workaround, because it looks like
 * a bug otherwise: 2.B and the key wrapping need AES-CBC with NO padding, and
 * WebCrypto always appends a PKCS#7 block. The bytes it produces before that
 * block ARE the unpadded CBC stream — CBC is sequential, so block n cannot
 * depend on anything after it — so every no-padding call here encrypts and then
 * truncates. `encryptcheck.mjs` asserts that prefix property rather than
 * trusting it.
 *
 * **Every secret is random, so encryption is not deterministic.** The file key,
 * the four salts, the /Perms filler and every IV come from
 * `crypto.getRandomValues`, as ISO 32000-2 intends. The rest of this writer
 * produces the same bytes for the same input; this file is the exception on
 * purpose. An earlier version derived all of them from the passwords and a
 * digest of the plaintext, so two encrypted exports of the same document under
 * the same password were byte-identical, and anyone holding both files learned
 * that their contents matched without knowing either password.
 * `encryptcheck.mjs` asserts that two such exports differ and open to the same
 * text.
 */

const utf8 = (s) => new TextEncoder().encode(s)

/** Concatenate byte runs. */
function cat(...runs) {
  let n = 0
  for (const r of runs) n += r.length
  const out = new Uint8Array(n)
  let at = 0
  for (const r of runs) { out.set(r, at); at += r.length }
  return out
}

const hex = (b) => [...b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase()

const random = (bytes) => crypto.getRandomValues(new Uint8Array(bytes))

async function sha(bits, data) {
  return new Uint8Array(await crypto.subtle.digest(`SHA-${bits}`, data))
}

/**
 * AES-CBC with no padding, by encrypting and dropping the block WebCrypto adds.
 * `data.length` must be a multiple of 16, which every caller here guarantees.
 */
async function aesNoPad(key, iv, data) {
  const k = await crypto.subtle.importKey('raw', key, 'AES-CBC', false, ['encrypt'])
  const full = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, k, data))
  return full.subarray(0, data.length)
}

/** AES-CBC with the PKCS#7 padding the PDF stream/string format wants, IV first. */
async function aesCbc(key, iv, data) {
  const k = await crypto.subtle.importKey('raw', key, 'AES-CBC', false, ['encrypt'])
  return cat(iv, new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, k, data)))
}

/**
 * ISO 32000-2, Algorithm 2.B — the hardened password hash revision 6 uses.
 *
 * The loop is the point of it: at least 64 rounds, each one AES over 64 copies
 * of (password ‖ K ‖ udata) and then one of three SHA-2 variants chosen by the
 * data itself, and it only stops once the last byte of a round's output falls
 * below round − 32. That makes a guess cost work no table can amortise.
 *
 * @param {Uint8Array} password  UTF-8, already truncated to 127 bytes
 * @param {Uint8Array} salt      8 bytes
 * @param {Uint8Array} udata     the 48-byte /U for an owner hash; empty for a user one
 */
async function hash2B(password, salt, udata) {
  let k = await sha(256, cat(password, salt, udata))
  for (let round = 0; ; round++) {
    const block = cat(password, k, udata)
    const k1 = new Uint8Array(block.length * 64)
    for (let i = 0; i < 64; i++) k1.set(block, i * block.length)
    const e = await aesNoPad(k.subarray(0, 16), k.subarray(16, 32), k1)
    let mod = 0
    for (let i = 0; i < 16; i++) mod += e[i]
    k = await sha([256, 384, 512][mod % 3], e)
    if (round >= 63 && e[e.length - 1] <= round - 31) break
  }
  return k.subarray(0, 32)
}

/** A PDF password: UTF-8, capped at 127 bytes, cut on a code point boundary. */
function passwordBytes(text) {
  const raw = utf8(String(text ?? ''))
  if (raw.length <= 127) return raw
  let end = 127
  while (end > 0 && (raw[end] & 0xc0) === 0x80) end--
  return raw.subarray(0, end)
}

/**
 * The permission bits of `/P`. Bits 1–2 and 7–8 are reserved and always 1; every
 * bit this does not turn off stays on, so the default grants everything.
 *
 * Bit 10 — extraction for accessibility — is NOT exposed. It is deprecated in
 * PDF 2.0 (a conforming reader must always allow it) and PDF/UA requires an
 * encrypted file to keep permitting it, so an exporter whose entire selling
 * point is an extractable text layer has no business offering to switch it off.
 */
const PERMISSION_BITS = {
  print: 3, modify: 4, copy: 5, annotate: 6,
  fillForms: 9, assemble: 11, printHighRes: 12,
}

function permissionValue(permissions, warn) {
  let p = -1 // every bit set
  // Bits 1, 2, 7, 8 are reserved and must be 1; -1 already has them.
  for (const [name, value] of Object.entries(permissions || {})) {
    const bit = PERMISSION_BITS[name]
    if (bit === undefined) {
      warn(`encrypt.permissions.${name} is not a permission — ignored. Known: ` +
        `${Object.keys(PERMISSION_BITS).join(', ')}.`)
      continue
    }
    if (value === false) p &= ~(1 << (bit - 1))
  }
  return p | 0
}

/**
 * Everything a document needs to be encrypted: the file key, and the /Encrypt
 * dictionary that lets a reader recover it from a password.
 *
 * @param {object} args
 * @param {string} args.userPassword     opens the document; '' means "opens without one"
 * @param {string} [args.ownerPassword]  lifts the permission flags; defaults to the user one
 * @param {object} [args.permissions]    `{print:false, copy:false, …}`
 * @param {(msg:string)=>void} args.warn
 */
export async function buildEncryption({ userPassword, ownerPassword, permissions, warn }) {
  const user = passwordBytes(userPassword)
  // An owner password equal to the user one is the common case and is fine; what
  // is NOT fine is an owner password alone, because then anyone opens the file
  // and only the advisory flags stand between them and everything.
  const owner = passwordBytes(ownerPassword ?? userPassword)
  const p = permissionValue(permissions, warn)

  // Random, never derived: see the file comment.
  const fileKey = random(32)
  const uValidation = random(8)
  const uKeySalt = random(8)
  const oValidation = random(8)
  const oKeySalt = random(8)

  // Algorithm 8: /U proves a user password, /UE hands over the file key.
  const uHash = await hash2B(user, uValidation, new Uint8Array(0))
  const U = cat(uHash, uValidation, uKeySalt)
  const UE = await aesNoPad(await hash2B(user, uKeySalt, new Uint8Array(0)), new Uint8Array(16), fileKey)

  // Algorithm 9: the owner hashes are bound to /U, so /O cannot be lifted onto
  // another document.
  const oHash = await hash2B(owner, oValidation, U)
  const O = cat(oHash, oValidation, oKeySalt)
  const OE = await aesNoPad(await hash2B(owner, oKeySalt, U), new Uint8Array(16), fileKey)

  // Algorithm 10: /Perms is the permission set encrypted under the file key, so
  // a reader that HAS the key can tell whether the flags were tampered with.
  // Bytes 12–15 are the random filler the algorithm asks for.
  const perms = new Uint8Array(16)
  new DataView(perms.buffer).setInt32(0, p, true)
  perms.set([0xff, 0xff, 0xff, 0xff], 4)
  perms[8] = 0x54 // 'T': the metadata stream is encrypted too
  perms.set([0x61, 0x64, 0x62], 9) // 'adb'
  perms.set(random(4), 12)
  const Perms = await aesNoPad(fileKey, new Uint8Array(16), perms)

  const dict =
    '/Filter /Standard /V 5 /R 6 /Length 256 ' +
    '/CF << /StdCF << /CFM /AESV3 /AuthEvent /DocOpen /Length 32 >> >> ' +
    '/StmF /StdCF /StrF /StdCF ' +
    `/O <${hex(O)}> /U <${hex(U)}> /OE <${hex(OE)}> /UE <${hex(UE)}> ` +
    `/Perms <${hex(Perms)}> /P ${p} /EncryptMetadata true`

  return {
    dict,
    p,
    /**
     * Encrypt one stream payload or one string. Revision 6 uses the file key
     * directly (the per-object key derivation of revisions 2–4 is gone), so an
     * object number is not needed and cannot be got wrong. Every call draws its
     * own random IV, which travels as the first 16 bytes.
     */
    async encrypt(bytes) {
      return aesCbc(fileKey, random(16), bytes)
    },
  }
}

/**
 * The catalog entry that tells an ISO 32000-1 reader this file uses a feature
 * from the next edition. `%PDF-1.7` stays in the header — the file structure IS
 * 1.7 — and AES-256 arrived as Adobe extension level 3 before ISO 32000-2
 * standardised it, which is the shape every reader in the field learned.
 */
export const AES256_EXTENSION =
  '/Extensions << /ADBE << /BaseVersion /1.7 /ExtensionLevel 3 >> >>'
