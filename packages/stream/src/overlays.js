/**
 * Broadcast overlay templates: a stage, a scoreboard with a clock, a lower third, a ticker and
 * a live badge, as plain DOM with a small controller each. Framework-free: append `.el`
 * wherever the overlay lives and stream the stage.
 *
 * Built to patch. Every box that changes is opaque, so a score or a clock tick repaints that
 * box alone; the lower third slides with `left`, which moves an out-of-flow box the stream
 * clears and redraws, where a `transform` slide would be a full frame on every step of it.
 * Theme through CSS variables on the stage (--sdo-accent, --sdo-panel, --sdo-text, --sdo-font).
 * Pinned by __tests__/plugin.stream.overlays.test.js.
 * @module plugins/stream/overlays
 */

const CSS = `
.sdo-stage{position:relative;overflow:hidden;--sdo-accent:#facc15;--sdo-panel:#0b0f17;--sdo-panel-2:#161d2b;--sdo-text:#fff;--sdo-ink:#111;--sdo-live:#ef4444;--sdo-font:Arial,Helvetica,sans-serif;font:16px/20px var(--sdo-font);color:var(--sdo-text)}
.sdo-score{position:absolute;left:24px;top:24px;display:flex;background:var(--sdo-panel);border-radius:6px;overflow:hidden;box-shadow:0 4px 14px #0009}
.sdo-team{display:flex;align-items:center;gap:10px;padding:8px 14px;background:var(--sdo-panel);font-weight:700;letter-spacing:.04em}
.sdo-team i{width:10px;height:28px;border-radius:2px;display:block}
.sdo-pts{min-width:44px;text-align:center;font:700 26px/32px var(--sdo-font);padding:4px 8px;background:var(--sdo-panel-2)}
.sdo-clock{padding:0 14px;display:flex;align-items:center;background:var(--sdo-accent);color:var(--sdo-ink);font:700 20px/40px ui-monospace,Menlo,monospace}
.sdo-live{position:absolute;right:24px;top:24px;background:var(--sdo-panel);border-radius:6px;padding:6px 12px 6px 28px;font-weight:700;letter-spacing:.1em}
.sdo-live::before{content:'';position:absolute;left:11px;top:11px;width:10px;height:10px;border-radius:50%;background:var(--sdo-live);animation:sdo-pulse 1s ease-in-out infinite}
@keyframes sdo-pulse{50%{opacity:.25}}
.sdo-lower{position:absolute;left:24px;bottom:76px;display:flex;flex-direction:column;transition:left .45s cubic-bezier(.2,.8,.2,1)}
.sdo-lower.sdo-hidden{left:-720px}
.sdo-name{background:#f8fafc;color:#0b0f17;font:700 24px/30px var(--sdo-font);padding:6px 16px;border-radius:4px 4px 0 0}
.sdo-role{background:#1d4ed8;color:#fff;padding:6px 16px;border-radius:0 0 4px 4px}
.sdo-ticker{position:absolute;left:0;right:0;bottom:0;height:40px;background:var(--sdo-panel);overflow:hidden;display:flex;align-items:center}
.sdo-tag{background:var(--sdo-live);height:40px;padding:0 14px;display:flex;align-items:center;font-weight:700;position:relative;z-index:1}
.sdo-run{white-space:nowrap;padding-left:20px;animation:sdo-run var(--sdo-speed,18s) linear infinite}
@keyframes sdo-run{from{transform:translateX(0)}to{transform:translateX(-50%)}}
`

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function injectCss(doc = document) {
  if (doc.getElementById('sdo-css')) return
  const style = el('style')
  style.id = 'sdo-css'
  style.textContent = CSS
  doc.head.append(style)
}

/**
 * The transparent stage every overlay sits on; stream this element.
 * @param {{width?: number, height?: number, theme?: Record<string, string>}} [options] -
 *   size in CSS px (default 960x540); theme maps --sdo-* names without the prefix.
 * @returns {HTMLDivElement}
 */
export function overlayStage({ width = 960, height = 540, theme = {} } = {}) {
  injectCss()
  const stage = el('div', 'sdo-stage')
  stage.style.width = `${width}px`
  stage.style.height = `${height}px`
  for (const [k, v] of Object.entries(theme)) stage.style.setProperty(`--sdo-${k}`, v)
  return stage
}

/**
 * Two teams, their points and a running clock.
 * @param {{home?: string, away?: string, homeColor?: string, awayColor?: string}} [options]
 * @returns {{el: HTMLElement, score(home: number, away: number): void, add(side: 'home'|'away', n?: number): void,
 *   clock: {start(): void, stop(): void, reset(seconds?: number): void, set(text: string): void}}}
 */
export function scoreboard({ home = 'HOME', away = 'AWAY', homeColor = '#22c55e', awayColor = '#3b82f6' } = {}) {
  injectCss()
  const root = el('div', 'sdo-score')
  const team = (name, color, first) => {
    const t = el('div', 'sdo-team')
    const swatch = el('i')
    swatch.style.background = color
    t.append(...(first ? [swatch, el('span', '', name)] : [el('span', '', name), swatch]))
    return t
  }
  const pts = [el('div', 'sdo-pts', '0'), el('div', 'sdo-pts', '0')]
  const clockEl = el('div', 'sdo-clock', '00:00.0')
  root.append(team(home, homeColor, true), pts[0], pts[1], team(away, awayColor, false), clockEl)
  const points = [0, 0]
  let started = 0, offset = 0, timer = 0
  const show = (s) => { clockEl.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}` }
  return {
    el: root,
    score(h, a) { points[0] = h; points[1] = a; pts[0].textContent = h; pts[1].textContent = a },
    add(side, n = 1) { const i = side === 'away' ? 1 : 0; points[i] += n; pts[i].textContent = points[i] },
    clock: {
      start() {
        if (timer) return
        started = performance.now()
        timer = setInterval(() => show(offset + (performance.now() - started) / 1000), 100)
      },
      stop() {
        if (!timer) return
        clearInterval(timer)
        timer = 0
        offset += (performance.now() - started) / 1000
      },
      reset(seconds = 0) { offset = seconds; started = performance.now(); show(seconds) },
      set(text) { clockEl.textContent = text },
    },
  }
}

/**
 * A name and a role that slide in and out.
 * @param {{name?: string, role?: string, visible?: boolean}} [options]
 * @returns {{el: HTMLElement, set(fields: {name?: string, role?: string}): void, show(): void, hide(): void}}
 */
export function lowerThird({ name = '', role = '', visible = true } = {}) {
  injectCss()
  const root = el('div', 'sdo-lower' + (visible ? '' : ' sdo-hidden'))
  const nameEl = el('div', 'sdo-name', name)
  const roleEl = el('div', 'sdo-role', role)
  root.append(nameEl, roleEl)
  return {
    el: root,
    set({ name: n, role: r } = {}) { if (n != null) nameEl.textContent = n; if (r != null) roleEl.textContent = r },
    show() { root.classList.remove('sdo-hidden') },
    hide() { root.classList.add('sdo-hidden') },
  }
}

/**
 * A scrolling news line.
 * @param {{label?: string, items?: string[], speed?: number}} [options] - speed: seconds per loop.
 * @returns {{el: HTMLElement, set(items: string[]): void}}
 */
export function ticker({ label = 'NEWS', items = [], speed = 18 } = {}) {
  injectCss()
  const root = el('div', 'sdo-ticker')
  const run = el('div', 'sdo-run')
  root.style.setProperty('--sdo-speed', `${speed}s`)
  root.append(el('div', 'sdo-tag', label), run)
  // Twice over, so the loop's -50% lands exactly where it started.
  const set = (list) => { run.textContent = (list.join('   ·   ') + '   ·   ').repeat(2) }
  set(items)
  return { el: root, set }
}

/**
 * A pulsing "LIVE" bug.
 * @param {{text?: string}} [options]
 * @returns {{el: HTMLElement, set(text: string): void}}
 */
export function liveBadge({ text = 'LIVE' } = {}) {
  injectCss()
  const root = el('div', 'sdo-live', text)
  return { el: root, set(t) { root.textContent = t } }
}
