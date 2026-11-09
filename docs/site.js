const starNodes = document.querySelectorAll('[data-star-count]')

// Runs a callback once the page has painted content. Lighthouse counts every request begun
// before that paint against LCP, and in some runs Chrome holds the first frame until well after
// load, so neither load nor the next animation frame is late enough (gtag alone is 180 KB).
window.afterFirstPaint = callback => new PerformanceObserver((list, observer) => {
  if (!list.getEntriesByName('first-contentful-paint').length) return
  observer.disconnect()
  setTimeout(callback)
}).observe({ type: 'paint', buffered: true })

if (location.hostname === 'snapdom.dev') {
  window.afterFirstPaint(() => {
    const umami = document.createElement('script')
    umami.src = 'https://cloud.umami.is/script.js'
    umami.dataset.websiteId = '7ec718e8-f0c5-4abb-8f4f-144f57f61937'
    const gtagScript = document.createElement('script')
    gtagScript.async = true
    gtagScript.src = 'https://www.googletagmanager.com/gtag/js?id=G-4G88ZHG7S1'
    document.head.append(umami, gtagScript)
    window.dataLayer = window.dataLayer || []
    window.gtag = function () { window.dataLayer.push(arguments) }
    window.gtag('js', new Date())
    window.gtag('config', 'G-4G88ZHG7S1', { transport_type: 'beacon' })
  })
}

const stableDocumentation = document.getElementById('stable-documentation')
if (stableDocumentation) {
  fetch('https://registry.npmjs.org/@zumer%2Fsnapdom/latest')
    .then(response => response.ok ? response.json() : Promise.reject())
    .then(({ version }) => {
      if (!/^\d+\.\d+\.\d+$/.test(version)) return
      const label = document.createElement('strong')
      label.textContent = `v${version}`
      stableDocumentation.replaceChildren(label, ' documentation')
      stableDocumentation.hidden = false
    })
    .catch(() => {})
}

// shields.io caches the count; api.github.com allows 60 unauthenticated calls an hour per IP,
// and every 403 past that is a console error on each page.
if (starNodes.length) {
  fetch('https://img.shields.io/github/stars/zumerlab/snapdom.json')
    .then(response => response.ok ? response.json() : Promise.reject())
    .then(({ value }) => starNodes.forEach(node => { node.textContent = value.toUpperCase() }))
    .catch(() => {})
}

// Grouped header (navigation.css): hover or click opens a group, Esc or an outside click
// closes it. Below 1080px the Menu button shows every group at once.
const siteHead = document.querySelector('.site-head')

const revealTarget = target => {
  for (let parent = target?.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === 'DETAILS') parent.open = true
  }
}
const revealHash = () => {
  if (!location.hash) return
  let id
  try { id = decodeURIComponent(location.hash.slice(1)) } catch { return }
  revealTarget(document.getElementById(id))
}
addEventListener('hashchange', revealHash)
revealHash()

const paneMenu = document.querySelector('.pane-menu')
if (paneMenu) {
  const compact = matchMedia('(max-width: 1080px)')
  const summary = paneMenu.querySelector('summary')
  const setLayout = () => {
    const focused = paneMenu.contains(document.activeElement)
    const summaryFocused = document.activeElement === summary
    paneMenu.open = !compact.matches
    if (compact.matches && focused) summary.focus()
    else if (!compact.matches && summaryFocused) (paneMenu.querySelector('[aria-current="page"]') || paneMenu.querySelector('a')).focus()
  }
  compact.addEventListener('change', setLayout)
  setLayout()
  paneMenu.addEventListener('click', event => {
    const link = event.target.closest('a')
    if (!link || !compact.matches || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
    paneMenu.open = false
    if (link.hash && link.pathname === location.pathname) {
      const target = document.getElementById(decodeURIComponent(link.hash.slice(1)))
      revealTarget(target)
      target.tabIndex = -1
      target.focus({ preventScroll: true })
    }
  })
  paneMenu.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !compact.matches || !paneMenu.open) return
    paneMenu.open = false
    summary.focus()
  })
  const links = [...paneMenu.querySelectorAll('.pane-outline a, .pane-nav-items a')].filter(a => a.hash && a.pathname === location.pathname && document.getElementById(decodeURIComponent(a.hash.slice(1))))
  const targets = links.map(a => document.getElementById(decodeURIComponent(a.hash.slice(1))))
  const side = paneMenu.parentElement
  let queued = false
  const mark = () => {
    queued = false
    let i = targets.findLastIndex(el => (el.matches('h2, h3') ? el : el.querySelector('h2, h3'))?.getBoundingClientRect().top <= innerHeight / 2)
    if (i < 0) i = 0
    links.forEach((a, j) => {
      if (j !== i) return a.removeAttribute('aria-current')
      if (a.getAttribute('aria-current') === 'location') return
      a.setAttribute('aria-current', 'location')
      if (compact.matches) return
      const top = a.getBoundingClientRect().top - side.getBoundingClientRect().top + side.scrollTop
      if (top < side.scrollTop || top > side.scrollTop + side.clientHeight - 40) side.scrollTo({ top: top - side.clientHeight / 3 })
    })
  }
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(mark) } }, { passive: true })
  mark()
}

if (siteHead) {
  const groups = [...siteHead.querySelectorAll('.site-nav-group')]
  const menuButton = siteHead.querySelector('.site-menu-button')
  const mobile = matchMedia('(max-width: 1080px)')
  const triggers = groups.map((group, i) => {
    const button = group.querySelector('.site-nav-button')
    const panel = group.querySelector('.site-nav-panel')
    panel.id = `site-nav-panel-${i}`
    button.setAttribute('aria-controls', panel.id)
    const label = document.createElement('span')
    label.className = 'site-nav-button'
    label.textContent = button.textContent
    label.setAttribute('role', 'heading')
    label.setAttribute('aria-level', '2')
    button.after(label)
    return { button, label }
  })
  const navigation = siteHead.querySelector('.site-nav')
  navigation.id = 'site-navigation'
  menuButton.setAttribute('aria-controls', navigation.id)
  const setOpen = open => groups.forEach((group, i) => {
    const button = triggers[i].button
    if (!mobile.matches && group !== open && group.contains(document.activeElement) && document.activeElement !== button) button.focus()
    group.classList.toggle('is-open', group === open)
    if (mobile.matches) button.removeAttribute('aria-expanded')
    else button.setAttribute('aria-expanded', String(group === open))
  })
  const setMenu = open => {
    if (!open && mobile.matches && navigation.contains(document.activeElement)) menuButton.focus()
    siteHead.classList.toggle('is-menu-open', open)
    menuButton.setAttribute('aria-expanded', String(open))
    menuButton.textContent = open ? 'Close' : 'Menu'
  }
  const syncNavigation = () => {
    const focusedGroup = groups.findIndex(group => group.contains(document.activeElement))
    const menuFocused = document.activeElement === menuButton
    triggers.forEach(({ button, label }) => {
      button.hidden = mobile.matches
      label.hidden = !mobile.matches
    })
    setOpen(null)
    setMenu(false)
    if (focusedGroup >= 0) (mobile.matches ? menuButton : triggers[focusedGroup].button).focus()
    else if (menuFocused && !mobile.matches) triggers[0].button.focus()
  }
  syncNavigation()
  mobile.addEventListener('change', syncNavigation)

  // A tap fires mouseenter right before click; without this the click closed what the tap opened.
  let hoveredAt = 0
  groups.forEach((group, i) => {
    group.addEventListener('mouseenter', () => { if (!mobile.matches) { hoveredAt = Date.now(); setOpen(group) } })
    group.addEventListener('mouseleave', () => { if (!mobile.matches && !group.contains(document.activeElement) && group.classList.contains('is-open')) setOpen(null) })
    triggers[i].button.addEventListener('click', event => {
      if (mobile.matches) return
      if (event.detail === 0) { setOpen(group.classList.contains('is-open') ? null : group); return }
      if (Date.now() - hoveredAt > 400) setOpen(group.classList.contains('is-open') ? null : group)
    })
  })
  menuButton.addEventListener('click', () => setMenu(!siteHead.classList.contains('is-menu-open')))
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return
    const openGroup = groups.findIndex(group => group.classList.contains('is-open'))
    const menuOpen = siteHead.classList.contains('is-menu-open')
    if (!menuOpen && openGroup < 0) return
    event.preventDefault()
    setOpen(null)
    setMenu(false)
    const trigger = menuOpen ? menuButton : triggers[openGroup].button
    trigger.focus()
  })
  document.addEventListener('mousedown', event => { if (!siteHead.contains(event.target)) { setOpen(null); setMenu(false) } })
  siteHead.addEventListener('focusout', event => { if (event.relatedTarget && !siteHead.contains(event.relatedTarget)) { setOpen(null); setMenu(false) } })
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
  dialog.innerHTML = '<form><label>Search documentation<input type="search" placeholder="API, capture option or plugin" autocomplete="off" spellcheck="false"></label><button type="button" aria-label="Close search">Close</button></form><p role="status" aria-live="polite">Find an API method, guide or plugin.</p><div class="site-search-results"></div><p class="site-search-shortcuts"><span><kbd>Enter</kbd> Open first result</span> <span><kbd>Esc</kbd> Close</span></p>'
  document.body.append(dialog)
  const input = dialog.querySelector('input'), results = dialog.querySelector('.site-search-results'), status = dialog.querySelector('[role=status]')
  let indexPromise
  let closeFocusTarget = searchButton
  const search = async () => {
    const query = input.value.trim().toLowerCase(), words = query.split(/\s+/)
    results.replaceChildren()
    if (!query) {
      status.textContent = 'Start with a section or search the documentation.'
      for (const [title, path, description] of [
        ['Quick start', 'docs/#quick-start', 'Capture an element and choose an output'],
        ['API reference', 'docs/api/', 'Capture methods and exporters'],
        ['Capture options', 'docs/options/', 'Fonts, images, clipping and output size'],
        ['Plugin API', 'docs/plugins/', 'Hooks and custom exporters'],
      ]) {
        const link = document.createElement('a'); link.href = new URL(path, root); link.textContent = title
        const detail = document.createElement('small'); detail.textContent = description; link.append(detail); results.append(link)
      }
      return
    }
    status.textContent = 'Searching documentation…'
    try {
      indexPromise ||= fetch(new URL('search-index.json', root)).then(r => { if (!r.ok) throw new Error(); return r.json() }).catch(e => { indexPromise = null; throw e })
      const pages = await indexPromise
      if (query !== input.value.trim().toLowerCase()) return
      const symbolQuery = query.replace(/^(?:snapdom|result)\./, '').replace(/\(.*$/, '').replace(/[^a-z0-9]/g, '')
      const matchedPaths = new Set()
      const ranked = pages.map(page => {
        const title = page.title.toLowerCase()
        const symbols = (page.symbols || []).map(symbol => symbol.toLowerCase().replace(/[^a-z0-9]/g, ''))
        const text = `${page.title} ${(page.symbols || []).join(' ')} ${page.text}`.toLowerCase()
        if (!words.every(word => text.includes(word)) && !symbols.includes(symbolQuery)) return null
        const score = (symbols.includes(symbolQuery) ? 10000 : symbolQuery && symbols.some(symbol => symbol.startsWith(symbolQuery)) ? 5000 : 0)
          + (title === query ? 1000 : title.startsWith(query) ? 600 : title.includes(query) ? 300 : 0)
          + (page.kind === 'option' || page.kind === 'method' ? 100 : page.kind === 'section' ? 40 : 0)
        return { page, score }
      }).filter(Boolean).sort((a, b) => b.score - a.score || a.page.title.localeCompare(b.page.title)).filter(({ page }) => {
        if (matchedPaths.has(page.path)) return false
        matchedPaths.add(page.path)
        return true
      })
      let shown = 0
      const showMore = document.createElement('button')
      showMore.type = 'button'
      showMore.className = 'site-search-more'
      showMore.textContent = 'Show more results'
      const renderMore = (focusFirst = false) => {
        const next = ranked.slice(shown, shown + 12)
        let firstLink
        for (const { page } of next) {
          const link = document.createElement('a'); link.href = new URL(page.path, root); link.textContent = page.title
          firstLink ||= link
          const detail = document.createElement('small')
          const start = Math.max(0, page.text.toLowerCase().indexOf(words[0]) - 55)
          const excerpt = page.text.slice(start, start + 180)
          detail.textContent = `${page.context ? `${page.context} · ` : ''}${start ? '…' : ''}${excerpt}${start + excerpt.length < page.text.length ? '…' : ''}`
          link.append(detail)
          results.append(link)
        }
        shown += next.length
        if (shown < ranked.length) results.append(showMore)
        else showMore.remove()
        status.textContent = ranked.length ? `${ranked.length} result${ranked.length === 1 ? '' : 's'}${shown < ranked.length ? ` · showing ${shown}` : ''}` : 'No matches. Try a format, framework or API name.'
        if (focusFirst) firstLink?.focus()
      }
      showMore.addEventListener('click', () => { showMore.remove(); renderMore(true) })
      renderMore()
    } catch { if (query === input.value.trim().toLowerCase()) status.textContent = 'Search could not load. Try again or browse the Learn menu.' }
  }
  const open = () => { if (!dialog.open) dialog.showModal(); input.focus(); search() }
  searchButton.addEventListener('click', open)
  input.addEventListener('input', search)
  dialog.querySelector('button').addEventListener('click', () => dialog.close())
  dialog.querySelector('form').addEventListener('submit', event => { event.preventDefault(); results.querySelector('a')?.click() })
  results.addEventListener('click', event => {
    const link = event.target.closest('a')
    if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
    const destination = new URL(link.href)
    if (destination.origin === location.origin && destination.pathname === location.pathname && destination.search === location.search && destination.hash) {
      const target = document.getElementById(decodeURIComponent(destination.hash.slice(1)))
      if (target) {
        revealTarget(target)
        if (target.tabIndex < 0 && !target.hasAttribute('tabindex')) target.tabIndex = -1
        closeFocusTarget = target
      }
    }
    dialog.close()
  })
  dialog.addEventListener('close', () => { closeFocusTarget.focus({ preventScroll: true }); closeFocusTarget = searchButton })
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close() } })
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && dialog.open) { event.preventDefault(); dialog.close(); return }
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); open() }
  })
}
