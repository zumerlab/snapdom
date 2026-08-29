// One network gate for the whole run: a broker in the node process that measures the
// connection and tells every browser worker how to treat tests that need external
// resources: run them as usual, run them ONE AT A TIME, or skip them.
//
// Any test can consult it (see __tests__/helpers/network-gate.js); nothing here knows about
// demos, snapdom or any particular suite.
//
// WHY A BROKER IN NODE INSTEAD OF A PROBE PER WORKER
// The suite runs as several test FILES times one browser instance each: six shards under
// BROWSER=all is eighteen workers. Eighteen probes racing the tests for the same link
// measure the run's own congestion, and they disagree with each other: measured 81-159ms
// probing alone against 1669ms and "no response" with the shards running, with different
// shards reaching OPPOSITE verdicts inside one run. One broker gives one answer, probes
// once no matter how many workers ask, and is also the only place a global "one at a time"
// lane can exist: the workers share a link, not a process.
//
// WHY THROUGHPUT, NOT LATENCY
// On the link that prompted this, a 25KB stylesheet came back in 627ms, healthy by any
// round-trip threshold, while six woff2 files totalling 86KB took 6602ms in parallel. A
// KaTeX page pulls about twenty of those, which is how it reaches a 10s test timeout on a
// connection that pings fine. So the probe fetches what a page fetches: a real batch of
// files, in parallel, timed to the last byte, and reports KB/s.
//
// WHY IT IS MEASURED TWICE
// The first reading is taken before any browser starts (vitest.config.js awaits it and
// hands it to the suites): it measures the link's CAPACITY on an idle line, which is what
// a policy decided at collection time needs: a suite sizes its test timeout from it, and
// vitest bakes timeouts in when tests are registered.
//
// But an idle reading is not the whole answer, because the run itself is what saturates
// the link: one run passed exactly this pre-run probe and then timed out 54 demos. So the
// gate is re-read as tests run, under the load they create, and the mode only ever gets
// stricter (see MODES below).
//
// Env overrides (all optional):
//   NETWORK_GATE=off / parallel   never gate: run everything as usual
//   NETWORK_GATE=serial           force the one-at-a-time lane
//   NETWORK_GATE=skip             force skipping (offline work)
//   NETWORK_GATE_URLS             comma-separated payload URLs instead of the default batch
//   NETWORK_GATE_FAST_KBPS / NETWORK_GATE_MIN_KBPS   tier thresholds, in KB/s
//   NETWORK_GATE_BUDGET_MS / NETWORK_GATE_WARMUP_MS / NETWORK_GATE_TTL_MS
//   NETWORK_GATE_LANE_BUDGET_MS   total seconds the serial lane may cost the whole run

// Pinned so the probe measures the connection rather than whatever the CDN serves today.
const KATEX = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist'
const DEFAULT_PAYLOAD = [
  'KaTeX_Main-Regular', 'KaTeX_Math-Italic', 'KaTeX_Size1-Regular',
  'KaTeX_AMS-Regular', 'KaTeX_Size2-Regular', 'KaTeX_Caligraphic-Regular',
].map((font) => `${KATEX}/fonts/${font}.woff2`)

// Strictness order. A run only ever ratchets TOWARDS the right: measuring again once the
// lane has calmed the link down would read fast, flip back to parallel, congest it again
// and flip back. A mode is never relaxed inside a run.
const MODES = ['parallel', 'serial', 'skip']
const strictest = (a, b) => MODES[Math.max(MODES.indexOf(a), MODES.indexOf(b))]

const FORCED = {
  off: 'parallel', parallel: 'parallel', '0': 'parallel', false: 'parallel', no: 'parallel',
  serial: 'serial', slow: 'serial',
  skip: 'skip', '1': 'skip', true: 'skip', yes: 'skip',
}

const list = (value) => String(value || '').split(',').map((s) => s.trim()).filter(Boolean)
const num = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback)

async function timedFetch(url, budgetMs, drain) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), budgetMs)
  const started = performance.now()
  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal })
    // The payload IS what is being measured, so it is timed to the last byte. The warmup
    // only has to prove the host answers, so it drops the body instead of paying for it.
    const body = drain ? await res.arrayBuffer() : await res.body?.cancel().catch(() => {})
    return { ms: performance.now() - started, bytes: drain ? body.byteLength : 0 }
  } catch {
    return null // offline, DNS failure, or slower than the budget
  } finally {
    clearTimeout(timer)
  }
}

/**
 * @param {object} [options]
 * @param {string[]} [options.payload]    URLs fetched in parallel and timed as one batch
 * @param {string}   [options.warmup]     URL fetched first, alone, to pay for DNS + TLS
 * @param {number}   [options.fastKbps]   at or above this the link takes the whole run at once
 * @param {number}   [options.workers]    how many browser workers share the link; scales fastKbps
 * @param {number}   [options.pageKB]     what one network-dependent test is assumed to pull
 * @param {number}   [options.serialTimeoutMs] how long such a test may take in serial mode
 * @param {number}   [options.budgetMs]   hard cap on the timed batch
 * @param {number}   [options.warmupMs]   budget for the warmup, which pays a cold handshake
 * @param {number}   [options.ttlMs]      how long a reading is reused before re-probing
 * @param {number}   [options.laneMs]     a lease is dropped after this even if never released
 * @param {number}   [options.laneBudgetMs] total time the serial lane may cost the whole run
 * @returns {{ commands: Record<string, Function>, status: Function, enter: Function, leave: Function }}
 */
export function createNetworkGate(options = {}) {
  const envPayload = list(process.env.NETWORK_GATE_URLS)
  const payload = options.payload ?? (envPayload.length ? envPayload : DEFAULT_PAYLOAD)
  // One request to the payload's own host, so the first reading is not a cold handshake.
  const warmup = options.warmup ?? new URL('/', payload[0]).href
  const budgetMs = num(options.budgetMs ?? process.env.NETWORK_GATE_BUDGET_MS, 4000)
  const warmupMs = num(options.warmupMs ?? process.env.NETWORK_GATE_WARMUP_MS, 5000)
  const ttlMs = num(options.ttlMs ?? process.env.NETWORK_GATE_TTL_MS, 15000)
  // The tiers are expressed in the only unit that answers "will this test finish": KB/s.
  //   >= fastKbps  the link swallows the whole run at once            -> parallel
  //   >= minKbps   it works, it just cannot take 18 pullers at once   -> serial (one lane)
  //   below        the payload cannot arrive in time even alone       -> skip
  //
  // minKbps is not a taste threshold: it is what one test needs to finish. A page that
  // pulls pageKB of fonts and images has serialTimeoutMs to do it in, and below that
  // ratio serialising only converts timeouts into slower timeouts.
  // "Fast enough" is not a property of the link alone: it is the link divided by how many
  // workers pull on it at once. The same connection that swallows one engine's demos is a
  // third of itself under BROWSER=all, which is how a run that passed the pre-run probe went
  // on to time out on CDN demos. An explicit fastKbps (or the env override) is taken as the
  // final word; the default scales.
  const workers = num(options.workers, 1)
  const fastKbps = num(options.fastKbps ?? process.env.NETWORK_GATE_FAST_KBPS, 120 * workers)
  const pageKB = num(options.pageKB, 300)
  const serialTimeoutMs = num(options.serialTimeoutMs, 30000)
  const minKbps = num(options.minKbps ?? process.env.NETWORK_GATE_MIN_KBPS, pageKB / (serialTimeoutMs / 1000))
  // Leases are dropped on their own: a worker that dies mid-test never sends its release,
  // and one lost lease would otherwise stall every queued test behind it.
  const laneMs = num(options.laneMs, 45000)
  // What the whole run may spend running network tests one at a time. Serial mode is a
  // fallback, not a plan: every network test in the run queues for the same lane, so its
  // cost is the number of such tests times how long each takes, and on a link slow enough
  // to need the lane that product is what turns a two-minute suite into a twenty-minute
  // one. Past this the mode ratchets to skip. Per worker, because BROWSER=all runs the
  // same demos three times and each engine deserves the same allowance.
  const laneBudgetMs = num(options.laneBudgetMs ?? process.env.NETWORK_GATE_LANE_BUDGET_MS, 180000 * workers)

  const forcedMode = FORCED[String(process.env.NETWORK_GATE ?? '').trim().toLowerCase()]

  let cached = null      // { mode, reading, kbps, at }
  let inflight = null    // dedupes the workers that ask at the same moment
  let warmed = false
  let mode = forcedMode ?? 'parallel'  // ratchets towards 'skip', never back

  // --- the one-at-a-time lane ---------------------------------------------------------
  //
  // The lane is what makes a degraded link usable, and it is also the only thing here that
  // can spend unbounded wall clock: EVERY network test in the run passes through it, so the
  // last one queued waits behind all the others. Unbounded, that is how a suite ends up
  // reporting single tests at two and a half minutes, most of it spent parked on a timer
  // waiting to be told no. Two bounds, one per test and one per run:
  //
  //   per test  a test is refused IMMEDIATELY when the queue ahead of it cannot clear
  //             inside its own wait budget, instead of parking to discover the same thing.
  //             The estimate uses what a turn in the lane has actually cost THIS run.
  //   per run   the lane has a total budget. Once spent, the mode ratchets to skip: a link
  //             that needed this much of it has been measured by the only instrument that
  //             matters, which is the run itself, and another twenty minutes of one-at-a-
  //             time downloads teaches nothing.
  //
  // Both turn a hang into a reported skip, which is the entire purpose of the gate.
  let nextToken = 1
  const leases = new Map()  // token -> { timer, at }
  const waiting = []        // [{ grant, timer }]
  let laneSpentMs = 0       // wall clock the lane has been held for, this run
  let laneServed = 0        // turns that completed, so the average below is a real one

  // What one turn costs. The seed only has to be the right order of magnitude: it is
  // replaced by a measurement as soon as one network test has been through the lane.
  const laneTurnMs = () => (laneServed > 0 ? laneSpentMs / laneServed : 8000)

  function release(token) {
    const lease = leases.get(token)
    if (lease === undefined) return false
    clearTimeout(lease.timer)
    leases.delete(token)
    laneSpentMs += Date.now() - lease.at
    laneServed++
    const next = waiting.shift()
    if (next) next.grant()
    return true
  }

  function grantToken() {
    const token = nextToken++
    leases.set(token, { at: Date.now(), timer: setTimeout(() => release(token), laneMs) })
    return token
  }

  function enter(maxWaitMs = 120000) {
    // `skip` first, and it is a REFUSAL. Read the other way round it says "not serial, so
    // help yourself", which hands a free pass to exactly the tests the gate has just
    // decided the link cannot serve, and quietly makes the budget below unenforceable.
    if (mode === 'skip') return Promise.resolve({ granted: false, token: null, waitedMs: 0 })
    if (mode !== 'serial') return Promise.resolve({ granted: true, token: null })

    // Budget spent: stop serialising and start skipping, for the rest of the run.
    if (laneSpentMs >= laneBudgetMs) {
      ratchet('skip', `serial lane spent its ${Math.round(laneBudgetMs / 1000)}s budget on ${laneServed} tests`)
      return Promise.resolve({ granted: false, token: null, waitedMs: 0, spentMs: laneSpentMs })
    }

    if (leases.size === 0) return Promise.resolve({ granted: true, token: grantToken() })

    // Refuse now instead of after a long timer when the queue cannot clear in time anyway.
    const ahead = leases.size + waiting.length
    if (ahead * laneTurnMs() > maxWaitMs) {
      return Promise.resolve({ granted: false, token: null, waitedMs: 0, ahead })
    }

    const queuedAt = Date.now()
    return new Promise((resolve) => {
      const entry = {
        grant: () => { clearTimeout(entry.timer); resolve({ granted: true, token: grantToken() }) },
        timer: setTimeout(() => {
          const i = waiting.indexOf(entry)
          if (i >= 0) waiting.splice(i, 1)
          resolve({ granted: false, token: null, waitedMs: Date.now() - queuedAt, ahead })
        }, maxWaitMs),
      }
      waiting.push(entry)
    })
  }

  // --- the probe ----------------------------------------------------------------------
  async function measure() {
    if (!warmed) {
      const cold = await timedFetch(warmup, warmupMs, false)
      if (!cold) return { mode: 'skip', kbps: 0, reading: `${new URL(warmup).hostname} unreachable in ${warmupMs}ms` }
      warmed = true
    }

    const started = performance.now()
    const results = await Promise.all(payload.map((url) => timedFetch(url, budgetMs, true)))
    const elapsed = Math.max(1, performance.now() - started)
    const arrived = results.filter(Boolean)
    const bytes = arrived.reduce((sum, r) => sum + r.bytes, 0)
    const kbps = Math.round(bytes / 1024 / (elapsed / 1000))

    // A batch that did not finish inside the budget says nothing about the link's ceiling,
    // only that it is under it: measure what DID arrive and let the thresholds judge.
    const detail = `${arrived.length}/${results.length} files, ${Math.round(bytes / 1024)}KB in ${Math.round(elapsed)}ms (${kbps}KB/s)`
    if (arrived.length < results.length && kbps < minKbps) return { mode: 'skip', kbps, reading: detail }
    if (kbps >= fastKbps && arrived.length === results.length) return { mode: 'parallel', kbps, reading: detail }
    if (kbps >= minKbps) return { mode: 'serial', kbps, reading: detail }
    return { mode: 'skip', kbps, reading: detail }
  }

  /**
   * Move the verdict towards `skip` and record WHY, so the reading every worker reads back
   * says which instrument decided: the probe, or the lane running out of budget. Never
   * relaxes, and updating `cached` here is what keeps status() from serving the reading
   * that was true one tier ago.
   */
  function ratchet(nextMode, reading) {
    const next = strictest(mode, nextMode)
    if (next === mode) return
    mode = next
    cached = { kbps: cached?.kbps ?? 0, ...cached, mode, reading, at: Date.now() }
  }

  async function probe() {
    const reading = await measure()
    mode = strictest(mode, reading.mode)
    cached = { ...reading, mode, at: Date.now() }
    return cached
  }

  async function status() {
    if (forcedMode) return { mode: forcedMode, kbps: 0, reading: `forced by NETWORK_GATE=${forcedMode}`, at: Date.now() }
    // Nothing to learn once it has ratcheted all the way: stop probing a dead link.
    if (mode === 'skip') return cached ?? { mode, kbps: 0, reading: 'serial lane budget spent', at: Date.now() }
    if (cached && Date.now() - cached.at < ttlMs) return cached
    inflight ??= probe().finally(() => { inflight = null })
    return inflight
  }

  // Browser workers reach these over vitest's command channel; see vitest.config.js.
  return {
    status,
    enter,
    leave: release,
    serialTimeoutMs,
    commands: {
      netGateStatus: async () => {
        const s = await status()
        return { mode: s.mode, reading: s.reading, kbps: s.kbps, ok: s.mode !== 'skip', serialTimeoutMs }
      },
      netGateEnter: (_ctx, maxWaitMs) => enter(maxWaitMs),
      netGateLeave: (_ctx, token) => release(token),
    },
  }
}
