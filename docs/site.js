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
