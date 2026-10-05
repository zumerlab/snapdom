const starNodes = document.querySelectorAll('[data-star-count]')

if (starNodes.length) {
  const compact = value => new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)

  fetch('https://api.github.com/repos/zumerlab/snapdom')
    .then(response => response.ok ? response.json() : Promise.reject())
    .then(repo => starNodes.forEach(node => { node.textContent = compact(repo.stargazers_count) }))
    .catch(() => {})
}

// Grouped header (navigation.css): hover or click opens a group, Esc or an outside click
// closes it. Below 1080px the Menu button shows every group at once.
const siteHead = document.querySelector('.site-head')

if (siteHead) {
  const groups = [...siteHead.querySelectorAll('.site-nav-group')]
  const menuButton = siteHead.querySelector('.site-menu-button')
  const setOpen = open => groups.forEach(group => {
    group.classList.toggle('is-open', group === open)
    group.querySelector('.site-nav-button').setAttribute('aria-expanded', String(group === open))
  })
  const setMenu = open => {
    siteHead.classList.toggle('is-menu-open', open)
    menuButton.setAttribute('aria-expanded', String(open))
    menuButton.textContent = open ? 'Close' : 'Menu'
  }

  // A tap fires mouseenter right before click; without this the click closed what the tap opened.
  let hoveredAt = 0
  groups.forEach(group => {
    group.addEventListener('mouseenter', () => { hoveredAt = Date.now(); setOpen(group) })
    group.addEventListener('mouseleave', () => { if (group.classList.contains('is-open')) setOpen(null) })
    group.querySelector('.site-nav-button').addEventListener('click', () => {
      if (Date.now() - hoveredAt > 400) setOpen(group.classList.contains('is-open') ? null : group)
    })
  })
  menuButton.addEventListener('click', () => setMenu(!siteHead.classList.contains('is-menu-open')))
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { setOpen(null); setMenu(false) } })
  document.addEventListener('mousedown', event => { if (!siteHead.contains(event.target)) { setOpen(null); setMenu(false) } })
}

// Search the generated local index; no account or third-party search service needed.
if (siteHead) {
  const root = new URL('.', [...document.scripts].find(s => /\/site\.js(?:\?|$)/.test(s.src)).src)
  const searchButton = document.createElement('button')
  searchButton.type = 'button'; searchButton.className = 'site-search-button'
  searchButton.innerHTML = 'Search docs <kbd>/</kbd>'
  searchButton.setAttribute('aria-haspopup', 'dialog')
  siteHead.querySelector('.site-menu-button').before(searchButton)
  const dialog = document.createElement('dialog')
  dialog.className = 'site-search-dialog'
  dialog.setAttribute('aria-label', 'Search SnapDOM documentation')
  dialog.innerHTML = '<form method="dialog"><label>Search docs<input type="search" placeholder="API, recipe or plugin" autocomplete="off"></label><button>Close</button></form><p role="status" aria-live="polite">Type to find a page.</p><div class="site-search-results"></div>'
  document.body.append(dialog)
  const input = dialog.querySelector('input'), results = dialog.querySelector('.site-search-results'), status = dialog.querySelector('[role=status]')
  let indexPromise
  const search = async () => {
    const query = input.value.trim().toLowerCase(), words = query.split(/\s+/)
    results.replaceChildren()
    if (!query) { status.textContent = 'Type to find a page.'; return }
    try {
      indexPromise ||= fetch(new URL('search-index.json', root)).then(r => { if (!r.ok) throw new Error(); return r.json() }).catch(e => { indexPromise = null; throw e })
      const pages = await indexPromise
      if (query !== input.value.trim().toLowerCase()) return
      const matches = pages.filter(p => words.every(w => `${p.title} ${p.text}`.toLowerCase().includes(w))).sort((a, b) => Number(b.title.toLowerCase().includes(query)) - Number(a.title.toLowerCase().includes(query))).slice(0, 12)
      for (const page of matches) {
        const link = document.createElement('a'); link.href = new URL(page.path, root); link.textContent = page.title
        const path = document.createElement('small'); path.textContent = page.path; link.append(path); results.append(link)
      }
      status.textContent = matches.length ? `${matches.length} results` : 'No matches. Try a format, framework or API name.'
    } catch { status.textContent = 'Search could not load. Try again or browse the Learn menu.' }
  }
  const open = () => { if (!dialog.open) dialog.showModal(); input.focus() }
  searchButton.addEventListener('click', open)
  input.addEventListener('input', search)
  dialog.addEventListener('close', () => searchButton.focus())
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close() } })
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && dialog.open) { event.preventDefault(); dialog.close(); return }
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); open() }
  })
}
