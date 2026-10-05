const input = document.querySelector('[data-catalogue-search]')
const filters = document.querySelector('[data-catalogue-filters]')
const status = document.querySelector('[data-catalogue-status]')
const plugins = [...document.querySelectorAll('#officialGrid [data-plugin]')]
const cards = plugins.length ? plugins : [...document.querySelectorAll('.mw-card')]
const stages = {
  Prepare: ['redact-inputs', 'timestamp-overlay', 'replace-text', 'color-tint', 'filter'],
  Export: ['pdf', 'html-export', 'ascii-export', 'vector'],
  Record: ['gif-export', 'video-export'],
  Context: ['context-export', 'agent-map'],
}
let active = 'All'
const groups = new Map()
for (const card of cards) {
  const group = plugins.length ? Object.keys(stages).find(k => stages[k].includes(card.dataset.plugin)) : card.querySelector('.tag').textContent.trim()
  card.dataset.catalogueGroup = group
  if (!groups.has(group)) groups.set(group, [])
  groups.get(group).push(card)
}
const orderedGroups = plugins.length ? new Map(Object.keys(stages).map(label => [label, groups.get(label)])) : groups
if (plugins.length) {
  const grid = document.querySelector('#officialGrid')
  for (const [label, entries] of orderedGroups) {
    const section = document.createElement('section')
    section.dataset.catalogueSection = label
    const heading = document.createElement('h3'); heading.textContent = `${label} · ${entries.length}`
    const list = document.createElement('div'); list.className = 'plugin-grid'; list.append(...entries)
    section.append(heading, list); grid.before(section)
  }
  grid.remove()
}
const buttons = ['All', ...orderedGroups.keys()].map(label => {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = `${label} · ${label === 'All' ? cards.length : groups.get(label).length}`
  button.setAttribute('aria-pressed', String(label === active))
  button.addEventListener('click', () => { active = label; update() })
  filters.append(button)
  return [label, button]
})
function update() {
  const q = input.value.trim().toLowerCase()
  let count = 0
  cards.forEach(card => { card.hidden = (active !== 'All' && card.dataset.catalogueGroup !== active) || !card.textContent.toLowerCase().includes(q); if (!card.hidden) count++ })
  document.querySelectorAll('[data-catalogue-section]').forEach(s => { s.hidden = [...s.querySelectorAll('[data-plugin]')].every(c => c.hidden) })
  buttons.forEach(([label, b]) => b.setAttribute('aria-pressed', String(label === active)))
  status.textContent = count ? `${count} ${plugins.length ? (count === 1 ? 'plugin' : 'plugins') : (count === 1 ? 'project' : 'projects')} shown` : 'No matches. Try another term or choose All.'
}
input.addEventListener('input', update)
update()
// Keep the detail dialog keyboard-contained and restore the invoking card.
const modal = document.querySelector('#pluginModal')
let opener
if (modal) {
  document.addEventListener('click', event => { const card = event.target.closest('[data-plugin]'); if (card) opener = card })
  document.addEventListener('keydown', event => {
    if (event.target.closest('[data-plugin]')) opener = event.target.closest('[data-plugin]')
    if (!modal.classList.contains('open')) return
    if (event.key === 'Tab') {
      const nodes = [...modal.querySelectorAll('button,a[href],input,select')]
      const first = nodes[0], last = nodes.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
  })
  new MutationObserver(() => { if (!modal.classList.contains('open')) opener?.focus() }).observe(modal, { attributes: true, attributeFilter: ['class'] })
}
