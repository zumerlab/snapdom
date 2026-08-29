// Browser side of the network gate: keeps a test from failing for a reason that has
// nothing to do with the code under test.
//
// The gate measures the link once per run (in node; see vitest.network.mjs for why it
// cannot be measured from in here) and answers with one of three modes:
//
//   parallel  the link swallows the whole run at once: nothing happens
//   serial    it works, it just cannot take every worker at once: tests that need the
//             network take turns through a single lane shared by ALL workers
//   skip      the payload cannot arrive in time even alone: those tests are skipped,
//             with the reading attached, instead of timing out
//
// Nothing here is specific to a suite. Two ways to use it:
//
//   import { beforeEach } from 'vitest'
//   import { gateOnNetwork } from './helpers/network-gate.js'
//   beforeEach(gateOnNetwork)                           // gate every test in the file
//
//   it('loads an icon font from a CDN', async (ctx) => {
//     await gateOnNetwork(ctx)                          // gate one test
//     ...
//   })
//
// ...or gate only the tests that actually need the network, decided per test:
//
//   beforeEach(networkGuard((name) => name.startsWith('cdn:')))
//
import { commands } from '@vitest/browser/context'

// A run asks this once per test. The node side caches the reading, but a round trip per
// test is still pointless traffic, so hold it here too and let node decide when to re-probe.
const POLL_MS = 3000

// How long a test may queue for the serial lane before it is skipped instead. The default
// fits under vitest's default 10s hookTimeout, because a hook that times out reports a
// FAILED test and the whole point here is not to fail for the connection's sake. A suite
// that raises its hookTimeout can pass a longer wait and let a real queue form.
const LANE_WAIT_MS = 8000

let last = null
let lastAt = 0
let pending = null

/** Current verdict: `{ mode, reading, kbps }`. An unreachable gate means "run it". */
export async function networkStatus() {
  if (pending) return pending
  if (last && performance.now() - lastAt < POLL_MS) return last
  pending = Promise.resolve()
    .then(() => commands.netGateStatus())
    .then((status) => {
      last = status
      lastAt = performance.now()
      return status
    })
    .catch(() => ({ mode: 'parallel', reading: 'gate unavailable', kbps: 0 }))
    .finally(() => { pending = null })
  return pending
}

/**
 * Gate the running test on the connection: skip it when the link cannot serve it, or hold
 * it until the shared lane is free when the link cannot take every worker at once.
 * Usable as a `beforeEach` callback or called with the test context.
 * @param {import('vitest').TestContext} ctx
 */
export async function gateOnNetwork(ctx) {
  return networkGuard(() => true)(ctx)
}

/**
 * Same, but only for the tests that need the network. `needsNetwork` receives the test name
 * and may be async, so a suite can decide from whatever it knows about the test.
 * @param {(name: string, ctx: any) => boolean | Promise<boolean>} needsNetwork
 * @param {{ laneWaitMs?: number }} [options] `laneWaitMs` must stay under the hookTimeout
 *        of the suite installing this, or a queued test fails instead of being skipped.
 */
export function networkGuard(needsNetwork, { laneWaitMs = LANE_WAIT_MS } = {}) {
  return async (ctx) => {
    const status = await networkStatus()
    if (status.mode === 'parallel') return
    if (!(await needsNetwork(ctx.task.name, ctx))) return

    // ctx.skip() throws a PendingError: the test is reported as skipped WITH this note,
    // rather than as a green pass that quietly covered nothing.
    if (status.mode === 'skip') ctx.skip(`slow connection: ${status.reading}`)

    const lease = await commands.netGateEnter(laneWaitMs).catch(() => ({ granted: true, token: null }))
    // Released here rather than in an afterEach: the lease belongs to this test, and
    // onTestFinished still runs when the test fails or times out.
    if (lease.token !== null) ctx.onTestFinished(() => commands.netGateLeave(lease.token).catch(() => {}))
    // A refusal is usually INSTANT: the broker knows what a turn in the lane costs and how
    // many tests are ahead, so it says no rather than letting this one park on a timer for
    // the full laneWaitMs to find out. Say which of the two it was, because "skipped after
    // 0s" and "skipped after 20s" mean different things about the run.
    if (!lease.granted) {
      const waited = lease.waitedMs > 0 ? `after ${Math.round(lease.waitedMs / 1000)}s` : 'immediately'
      const queue = lease.ahead ? `, ${lease.ahead} ahead` : ''
      ctx.skip(`network lane full, gave up ${waited}${queue}: ${status.reading}`)
    }
  }
}

// --- Deciding whether a page needs the network -------------------------------------------

// Attributes that actually FETCH something. `a[href]` is deliberately absent: a page can
// link to github.com in prose and still render fine with no network at all.
const RESOURCE_SELECTOR = [
  'link[href]', 'script[src]', 'img[src]', 'img[srcset]', 'source[src]', 'source[srcset]',
  'iframe[src]', 'video[src]', 'video[poster]', 'audio[src]', 'object[data]', 'embed[src]',
  'input[src]', 'track[src]', 'use[href]', 'image[href]',
].join(',')

const URL_IN_TEXT = /https?:\/\/[^\s"'()<>\\]+/g

// w3.org is the xmlns of every inline SVG and is never fetched; example.com only ever
// shows up in copy.
const IGNORED_HOSTS = /^(?:www\.)?(?:w3\.org|example\.com)$/i

/**
 * Hosts a page would have to reach over the network to render correctly.
 * @param {string} html
 * @param {string} baseUrl used to resolve relative URLs and to recognise same-origin ones
 * @returns {Set<string>}
 */
export function externalHosts(html, baseUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const candidates = []

  for (const el of doc.querySelectorAll(RESOURCE_SELECTOR)) {
    for (const attr of ['href', 'src', 'srcset', 'data', 'poster']) {
      const value = el.getAttribute(attr)
      // srcset is a comma-separated list of "url descriptor" pairs; the plain attributes
      // fall through the same split untouched.
      if (value) candidates.push(...value.split(',').map((part) => part.trim().split(/\s+/)[0]))
    }
  }

  // @import and url() live in <style> text and in style="" attributes, and a page may
  // assign a CDN URL to an img.src from an inline <script>. Text-scan all three rather
  // than trying to parse CSS and JS.
  for (const el of doc.querySelectorAll('style, script:not([src]), [style]')) {
    const text = el.tagName === 'STYLE' || el.tagName === 'SCRIPT'
      ? el.textContent
      : el.getAttribute('style')
    candidates.push(...(String(text || '').match(URL_IN_TEXT) || []))
  }

  const hosts = new Set()
  for (const candidate of candidates) {
    let url
    try { url = new URL(candidate, baseUrl) } catch { continue }
    if (!/^https?:$/.test(url.protocol)) continue
    if (url.origin === location.origin) continue
    if (IGNORED_HOSTS.test(url.hostname)) continue
    hosts.add(url.hostname)
  }
  return hosts
}

const needsCache = new Map()

/** True when the page at `url` pulls anything from another origin. Cached per URL. */
export async function pageNeedsNetwork(url) {
  if (!url) return false
  if (!needsCache.has(url)) {
    needsCache.set(url, fetch(url)
      .then((res) => res.text())
      .then((html) => externalHosts(html, new URL(url, location.origin).href).size > 0)
      // Unreadable page: let the test run and report its own failure.
      .catch(() => false))
  }
  return needsCache.get(url)
}
