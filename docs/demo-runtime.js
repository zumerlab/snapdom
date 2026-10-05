// The site and npm users exercise the same exporters and plugin implementations.
export const loadSnapdom = () => import('https://unpkg.com/@zumer/snapdom@latest/dist/snapdom.mjs').then(m => m.snapdom)
const modules = new Map()
const retries = new Map()
export async function loadPlugin(name) {
  if (!modules.has(name)) modules.set(name, import(`https://esm.sh/@zumer/snapdom-plugins@4/${name}?external=@zumer/snapdom${retries.has(name) ? '&retry=' + retries.get(name) : ''}`).catch(error => {
    modules.delete(name)
    retries.set(name, (retries.get(name) || 0) + 1)
    throw new Error(`${name} could not load. Reload to retry, or run npm run site to use the local plugin build.`, { cause: error })
  }))
  return modules.get(name)
}

const heading = (label, title) => `<div class="sample-card-kicker">${label}</div><div class="sample-card-title" data-title contenteditable="true" aria-label="Edit sample title" spellcheck="false">${title}</div>`
const email = '<label class="demo-input">Contact email<input type="email" value="ana@example.com"></label>'
const chart = '<svg viewBox="0 0 300 130" role="img" aria-label="Orders: 18, 32, 24, 46, 58"><path d="M10 115H290" stroke="#b7c4df"/><g fill="#2D5BFF"><rect x="20" y="79" width="35" height="36"/><rect x="75" y="51" width="35" height="64"/><rect x="130" y="67" width="35" height="48"/><rect x="185" y="23" width="35" height="92"/><rect x="240" y="0" width="35" height="115"/></g></svg>'
export function sample(kind, title) {
  const samples = {
    invoice: heading('Invoice INV-1042', 'Design & development') + '<p>North Studio · Due 14 October</p><table><tr><td>Interface design</td><td>$840</td></tr><tr><td>Implementation</td><td>$560</td></tr><tr><th>Total USD</th><th>$1,400</th></tr></table>' + email,
    chart: heading('Orders · October', 'Five days of growth') + chart + '<p>Mon 18 · Tue 32 · Wed 24 · Thu 46 · Fri 58</p>',
    form: heading('Account settings', title && /React|Vue|Svelte|Angular|Next/i.test(title) ? title + ' · profile component' : 'Your profile') + email + '<label class="demo-input">Display name<input value="Ana Ruiz"></label><label><input type="checkbox" checked> Email notifications</label><div class="sample-card-actions"><button type="button" data-sample-save>Save profile</button><span data-sample-status></span></div>',
    social: heading('SnapDOM field notes', 'Ship the interface. Share the proof.') + '<p style="font-size:20px;line-height:1.4">From a live component to an image in one call.</p><p>snapdom.dev · Developer tools</p>',
    document: heading('Release notes', 'A complete document') + Array.from({length:6}, (_, i) => `<h3>Section ${i + 1}</h3><p>Capture styles, text and controls together. This longer example keeps its full height when exported.</p>`).join(''),
    svg: heading('Editable artwork', 'Orbit / 03') + '<svg viewBox="0 0 300 160" aria-label="Blue orbit illustration" role="img"><circle cx="150" cy="80" r="55" fill="#E8EEFF"/><ellipse cx="150" cy="80" rx="115" ry="30" fill="none" stroke="#2D5BFF" stroke-width="3" transform="rotate(-25 150 80)"/><circle cx="150" cy="80" r="22" fill="#0F1E4D"/></svg>',
    card: heading('Component preview', title || 'Capture an editable component') + '<p>A live DOM element with text, a colour swatch and a contact field.</p><div style="height:52px;background:linear-gradient(100deg,#2D5BFF,#bcd0ff)"></div>' + email,
    iframe: heading('Embedded document', 'Same-origin iframe') + '<iframe title="Embedded capture sample" style="width:100%;height:170px;border:1px solid #c6d2e8" srcdoc="<body style=\'font:16px Arial;padding:12px;color:#0F1E4D\'><h2>Inside the frame</h2><p>This content belongs to its own document.</p><input value=\'Frame state\'></body>"></iframe>',
    canvas: heading('Canvas chart', 'Orders drawn on canvas') + '<canvas width="300" height="140" aria-label="Canvas orders chart"></canvas>',
  }
  return `<div class="sample-card" data-target>${samples[kind] || samples.card}</div>`
}
export function mountSample(container, kind, title) {
  container.innerHTML = sample(kind, title)
  const card = container.firstElementChild
  const canvas = card.querySelector('canvas')
  if (canvas) {
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 300, 140)
    ctx.fillStyle = '#2D5BFF'
    ;[18, 32, 24, 46, 58].forEach((n, i) => ctx.fillRect(20 + i * 55, 125 - n * 2, 35, n * 2))
  }
  card.querySelector('[data-sample-save]')?.addEventListener('click', () => { card.querySelector('[data-sample-status]').textContent = 'Profile saved' })
  return card
}
export function sampleFor(title, path = '') {
  const text = `${title} ${path}`.toLowerCase()
  if (/iframe/.test(text)) return 'iframe'
  if (/chart.js|chart-js|canvas/.test(text)) return 'canvas'
  if (/invoice|pdf/.test(text)) return 'invoice'
  if (/full.page|long|huge/.test(text)) return 'document'
  if (/social|jpeg|jpg|webp/.test(text)) return 'social'
  if (/vector|svg|ascii/.test(text)) return 'svg'
  if (/chart|dashboard/.test(text)) return 'chart'
  if (/private|context|agent|map|state|cache|snapdiff|snapeye|snapsurf|react|vue|svelte|angular|next/.test(text)) return 'form'
  return 'card'
}
