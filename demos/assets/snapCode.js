/*!
 * SnapCode – mini playground (vanilla) con prism-code-editor
 * - Layouts: right | left | bottom | top | only-editors (auto)
 * - Preview-only / Editors-only, persistencia, export HTML, toggle de tema
 * - Alturas de editores sincronizadas o fijas (opcional)
 */
(function (global) {
  const CDN = 'https://cdn.jsdelivr.net/npm/prism-code-editor@4.1.0/dist'
  const THEME_DARK = `${CDN}/themes/github-dark.css`
  const THEME_LIGHT = `${CDN}/themes/github-light.css`

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel)
  const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n }

  function ensureThemeLink(href) {
    let link = document.getElementById('prism-theme')
    if (!link) {
      link = document.createElement('link')
      link.id = 'prism-theme'
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }
    if (link.href !== href) link.href = href
  }

  // Inyecta CSS base (layouts + preview-only + editors-only + tabs alignment + heights)
  function injectBaseStylesOnce() {
    if (document.getElementById('snapcode-base-css')) return
    const css = `
      :root { --border:#e5e7eb; --muted:#6b7280; --bg:#f9fafb; --radius:10px; --tabs-h:36px; }
      .sc { display:grid; gap:12px; border:1px solid var(--border); border-radius:12px; padding:12px; background:#fff; }
      .sc .toolbar { display:flex; gap:8px; align-items:center; }
      .sc .toolbar .spacer { flex:1 }
      .sc .btn { padding:6px 10px; border:1px solid var(--border); border-radius:8px; background:#fff; cursor:pointer; }
      .sc .tabs { display:flex; gap:6px; flex-wrap:wrap; align-items:center; height:var(--tabs-h); }
      .sc .tab { padding:6px 10px; border:1px solid var(--border); border-radius:8px; background:#fff; cursor:pointer; }
      .sc .tab[aria-selected="true"] { background:var(--bg); }
      .sc .pane { display:none; }
      .sc .pane.active { display:block; height:100%; }
      .sc .editor { height:100%; min-height:200px; border:1px solid var(--border); border-radius:10px; overflow:auto; background:#fff; }
      .sc .preview { border:1px solid var(--border); border-radius:10px; overflow:hidden; background:#fff; }
      .sc .preview iframe { width:100%; height:100%; border:0; display:block; background:#fff; }
      .sc .meta { color:var(--muted); font-size:12px; }

      /* —— Grid base —— */
      .sc.sc-layout { display:grid; gap:12px; }
      .sc .sc-editors, .sc .sc-preview { min-height:0; }

      /* RIGHT: editors | preview */
      .sc.sc-right {
        grid-template-columns: 1fr 1fr;
        grid-template-rows: auto minmax(0,1fr);
        grid-template-areas:
          "toolbar toolbar"
          "editors preview";
      }

      /* LEFT: preview | editors */
      .sc.sc-left {
        grid-template-columns: 1fr 1fr;
        grid-template-rows: auto minmax(0,1fr);
        grid-template-areas:
          "toolbar toolbar"
          "preview editors";
      }

      /* BOTTOM: editors ↓ preview */
     .sc.sc-bottom {
  grid-template-columns: 1fr;
  grid-template-rows: auto minmax(0,1fr) auto;
  grid-template-areas:
    "toolbar"
    "editors"
    "preview";
}

      /* TOP: preview ↑ editors */
      .sc.sc-top {
  grid-template-columns: 1fr;
  grid-template-rows: auto auto minmax(0,1fr);
  grid-template-areas:
    "toolbar"
    "preview"
    "editors";
}

      /* Solo preview: toolbar + preview */
      .sc.sc-only-preview {
        grid-template-columns: 1fr;
        grid-template-rows: auto minmax(0,1fr);
        grid-template-areas:
          "toolbar"
          "preview";
      }

      /* Solo editores: toolbar + editores (sin preview) → NO deja huecos */
      .sc.sc-only-editors {
        grid-template-columns: 1fr;
        grid-template-rows: auto minmax(0,1fr);
        grid-template-areas:
          "toolbar"
          "editors";
      }

      .sc .toolbar   { grid-area: toolbar; }
      .sc .sc-editors{ grid-area: editors; display:flex; flex-direction:column; gap:8px; }
      .sc .sc-preview{ grid-area: preview; }

      /* Alineación: solo aplica si hay tabs y preview */
      .sc.has-preview.has-tabs.sc-right .sc-preview,
      .sc.has-preview.has-tabs.sc-left  .sc-preview { padding-top: var(--tabs-h); }

      @media (max-width: 900px) {
        .sc.sc-right, .sc.sc-left {
          grid-template-columns: 1fr;
          grid-template-rows: auto minmax(0,1fr) minmax(0,1fr);
          grid-template-areas:
            "toolbar"
            "editors"
            "preview";
        }
      }

      .sc .layout-ctl select {
        font:inherit; padding:2px 6px; border-radius:6px;
        border:1px solid var(--border); background:transparent;
      }
    `
    const style = document.createElement('style')
    style.id = 'snapcode-base-css'
    style.textContent = css
    document.head.appendChild(style)
  }

  // Iframe por Blob (seguro)
  function setIframeHTMLViaBlob(iframe, htmlString) {
    const blob = new Blob([htmlString], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    if (iframe.__blobUrl) { try { URL.revokeObjectURL(iframe.__blobUrl) } catch { } }
    iframe.__blobUrl = url
    iframe.src = url
  }

  // Documento final
  function buildDoc({ html, css, js }) {
    const OPEN = '<scr' + 'ipt>'
    const CLOSE = '</scr' + 'ipt>'
    const BODY_OPEN = '<bo' + 'dy>'
    const BODY_CLOSE = '</bo' + 'dy>'
    return [
      '<!doctype html>',
      '<ht' + 'ml>',
      '<he' + 'ad>',
      '<meta charset="utf-8" />',
      '<meta name="viewport" content="width=device-width,initial-scale=1" />',
      '<style>',
      css || '',
      '</sty' + 'le>',
      '</he' + 'ad>',
      BODY_OPEN,
      html || '',
      OPEN,
      'window.addEventListener("DOMContentLoaded",function(){',
      js || '',
      '});',
      CLOSE,
      BODY_CLOSE,
      '</ht' + 'ml>'
    ].join('\n')
  }

  // Prism loader
  let prismPromise = null
  function loadPrism() {
    if (prismPromise) return prismPromise
    prismPromise = (async () => {
      const cssFiles = [
        'layout.css', 'scrollbar.css', 'guides.css', 'copy.css',
        'search.css', 'autocomplete.css', 'autocomplete-icons.css',
        'folding.css', 'invisibles.css', 'code-block.css'
      ]
      cssFiles.forEach(f => {
        const href = `${CDN}/${f}`
        if (![...document.styleSheets].some(s => s.href === href)) {
          const l = document.createElement('link')
          l.rel = 'stylesheet'; l.href = href
          document.head.appendChild(l)
        }
      })

      ensureThemeLink(THEME_DARK)

      const [
        core,
        copyBtn, matchBr, guides, hiPairs, matchTags, cmds,
        _m, _c, _j
      ] = await Promise.all([
        import(`${CDN}/index.js`),
        import(`${CDN}/extensions/copyButton/index.js`),
        import(`${CDN}/extensions/matchBrackets/index.js`),
        import(`${CDN}/extensions/guides.js`),
        import(`${CDN}/extensions/matchBrackets/highlight.js`),
        import(`${CDN}/extensions/matchTags.js`),
        import(`${CDN}/extensions/commands.js`),
        import(`${CDN}/prism/languages/markup.js`),
        import(`${CDN}/prism/languages/css.js`),
        import(`${CDN}/prism/languages/javascript.js`),
      ])

      return {
        createEditor: core.createEditor,
        ext: {
          copyButton: () => copyBtn.copyButton(),
          matchBrackets: () => matchBr.matchBrackets(),
          indentGuides: () => guides.indentGuides(),
          highlightBracketPairs: () => hiPairs.highlightBracketPairs(),
          matchTags: () => matchTags.matchTags(),
          defaultCommands: () => cmds.defaultCommands(),
          editHistory: () => cmds.editHistory(),
        }
      }
    })()
    return prismPromise
  }

  function buildExtensions(ext) {
    if (!ext) return []
    return [
      ext.defaultCommands(),
      ext.editHistory(),
      ext.copyButton(),
      ext.matchBrackets(),
      ext.indentGuides(),
      ext.highlightBracketPairs(),
      ext.matchTags(),
    ].filter(Boolean)
  }

  /**
   * Create a SnapCode instance.
   * @param {HTMLElement|string} containerOrSelector
   * @param {Object} [options]
   * @param {string} [options.title='SnapCode']
   * @param {{html?:boolean, css?:boolean, js?:boolean}} [options.panels]
   * @param {boolean} [options.preview=true]
   * @param {"html"|"css"|"js"} [options.defaultActive]
   * @param {boolean} [options.readOnly=false]
   * @param {"right"|"left"|"bottom"|"top"} [options.layout='right']
   * @param {number} [options.height=320]          // preview height
   * @param {number} [options.editorsHeight]       // fixed editors height (px)
   * @param {boolean} [options.syncEditorsHeightWithPreview=true]
   * @param {string} [options.theme='github-dark']
   * @param {string} [options.storageKey]
   * @param {boolean} [options.editors=true]       // preview-only if false
   * @param {{showTitle?:boolean, showExport?:boolean, showTheme?:boolean, showLayout?:boolean}} [options.toolbar]
   * @param {boolean} [options.layoutControl=true] // compat
   */
  async function create(containerOrSelector, options = {}) {
    injectBaseStylesOnce()
    const { createEditor, ext } = await loadPrism()

    const container = (typeof containerOrSelector === 'string')
      ? $(containerOrSelector) : containerOrSelector
    if (!container) throw new Error('Container no encontrado')

    const persisted = (() => {
      if (!options.storageKey) return null
      try { const raw = localStorage.getItem(options.storageKey); return raw ? JSON.parse(raw) : null }
      catch { return null }
    })()

    // defaults
    let currentTheme = persisted?.theme || options.theme || 'github-dark'
    let currentLayout = (persisted && persisted.layout) || options.layout || 'right'
    const initial = Object.assign({
      html: `<div style="padding:16px">
  <h1 id="hello">Hi SnapCode</h1>
  <button id="btn">Click!</button>
</div>`,
      css: `#hello { color:#0d9488; font-weight:700; }
button { padding:8px 12px; border-radius:8px; border:1px solid #ddd; cursor:pointer; }`,
      js: `const btn = document.getElementById('btn');
if (btn) btn.addEventListener('click', () => alert('Hello!'));`
    }, options.initial || {})

    // state
    let HTML_VAL = persisted?.html ?? (initial.html ?? '')
    let CSS_VAL = persisted?.css ?? (initial.css ?? '')
    let JS_VAL = persisted?.js ?? (initial.js ?? '')

    const height = options.height ?? 320
    const syncEditorsHeightWithPreview = options.syncEditorsHeightWithPreview !== false
    const editorsHeightOpt = typeof options.editorsHeight === 'number' ? options.editorsHeight : null

    const tb = Object.assign(
      { showTitle: true, showExport: true, showTheme: true, showLayout: true },
      options.toolbar || {}
    )
    const showLayoutCtl = tb.showLayout && (options.layoutControl !== false)

    // panels / flags
    const panels = options.panels || { html: true, css: true, js: true }
    const requested = { html: !!panels.html, css: !!panels.css, js: !!panels.js }
    const availablePanels = []
    if (requested.html) availablePanels.push({ key: 'html', enabled: true })
    if (requested.css) availablePanels.push({ key: 'css', enabled: true })
    if (requested.js) availablePanels.push({ key: 'js', enabled: true })
    const wantEditors = options.editors !== false && availablePanels.length > 0
    const multiplePanels = availablePanels.length > 1

    // —— Helpers hoisted ——
    function persist() {
      if (!options.storageKey) return
      try {
        localStorage.setItem(options.storageKey, JSON.stringify({
          html: HTML_VAL, css: CSS_VAL, js: JS_VAL,
          theme: currentTheme, layout: currentLayout
        }))
      } catch { }
    }
    let render = function noop() { }

    // layout base
    container.classList.add('sc', 'sc-layout')
    container.classList.remove(
      'sc-right', 'sc-left', 'sc-bottom', 'sc-top',
      'sc-only-preview', 'sc-only-editors',
      'has-tabs', 'has-preview'
    )
    container.innerHTML = ''

    const showPreview = options.preview !== false
    if (showPreview) container.classList.add('has-preview')

    if (!showPreview && wantEditors) {
      // Solo editores
      container.classList.add('sc-only-editors')
      if (multiplePanels) container.classList.add('has-tabs')
    } else if (showPreview && !wantEditors) {
      // Solo preview
      container.classList.add('sc-only-preview')
    } else if (showPreview && wantEditors) {
      // Layout normal
      container.classList.add('sc-' + currentLayout) // right|left|bottom|top
      if (multiplePanels) container.classList.add('has-tabs')
    } else {
      // Ni preview ni editores (raro) → deja solo toolbar
      container.classList.add('sc-only-editors')
    }

    // toolbar
    const toolbar = el('div', 'toolbar')
    if (tb.showTitle) {
      const h2 = el('h2'); h2.style.margin = '0'; h2.textContent = options.title || 'SnapCode'
      toolbar.appendChild(h2)
    }
    const spacer = el('div', 'spacer')
    if (tb.showExport) {
      var btnExport = el('button', 'btn'); btnExport.textContent = 'Export .html'
      toolbar.appendChild(btnExport)
    }
    if (tb.showTheme) {
      var btnTheme = el('button', 'btn'); btnTheme.textContent = currentTheme === 'github-dark' ? 'Dark' : 'Light'
      toolbar.appendChild(btnTheme)
    }
    toolbar.appendChild(spacer)
    container.appendChild(toolbar)

    // layout control (opcional)
    if (showLayoutCtl && wantEditors && showPreview) {
      const ctl = el('label', 'layout-ctl')
      ctl.style.display = 'inline-flex'
      ctl.style.alignItems = 'center'
      ctl.style.gap = '6px'
      ctl.style.marginInlineStart = '8px'
      const span = document.createElement('span'); span.textContent = 'Layout:'
      const sel = document.createElement('select')
        ; (['right', 'left', 'bottom', 'top']).forEach(v => {
          const o = document.createElement('option'); o.value = v; o.textContent = v
          if (v === currentLayout) o.selected = true
          sel.appendChild(o)
        })
      sel.addEventListener('change', () => setLayout(sel.value))
      ctl.append(span, sel)
      toolbar.insertBefore(ctl, spacer)
    }

    // editors wrapper y tabs
    let editorsWrap = null
    let tabs = null
    const panesByKey = {}
    const editorsByKey = {}

    if (wantEditors) {
      editorsWrap = el('div', 'sc-editors')
      container.appendChild(editorsWrap)

      if (multiplePanels) {
        tabs = el('div', 'tabs')
        tabs.setAttribute('role', 'tablist')
        editorsWrap.appendChild(tabs)
      }
    }

    // tema
    ensureThemeLink(currentTheme === 'github-dark' ? THEME_DARK : THEME_LIGHT)

    // export
    if (tb.showExport && btnExport) {
      btnExport.addEventListener('click', () => {
        const blob = new Blob([buildDoc({ html: HTML_VAL, css: CSS_VAL, js: JS_VAL })], { type: 'text/html' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = 'snapcode.html'
        a.click()
        setTimeout(() => { try { URL.revokeObjectURL(url) } catch { } }, 0)
      })
    }

    // Extensiones
    const EXTENSIONS = wantEditors ? buildExtensions(ext) : []

    // Edits
    if (wantEditors) {
      for (const p of availablePanels) {
        if (multiplePanels) {
          const tabBtn = el('button', 'tab')
          tabBtn.textContent = p.key.toUpperCase()
          tabBtn.setAttribute('role', 'tab')
          tabBtn.id = `${(container.id || 'sc')}-tab-${p.key}`
          tabs.appendChild(tabBtn)
        }

        const pane = el('div', 'pane')
        const holder = el('div', 'editor ' + p.key + '-editor')
        pane.appendChild(holder)
        editorsWrap.appendChild(pane)

        panesByKey[p.key] = pane

        const readOnly = !!options.readOnly
        const common = { theme: currentTheme, readOnly, wordWrap: true }

        if (p.key === 'html') {
          editorsByKey.html = createEditor(holder, {
            language: 'html',
            value: HTML_VAL,
            ...common,
            onUpdate(v) { HTML_VAL = v; render(); persist() }
          }, ...EXTENSIONS)
        } else if (p.key === 'css') {
          editorsByKey.css = createEditor(holder, {
            language: 'css',
            value: CSS_VAL,
            ...common,
            onUpdate(v) { CSS_VAL = v; render(); persist() }
          }, ...EXTENSIONS)
        } else {
          editorsByKey.js = createEditor(holder, {
            language: 'javascript',
            value: JS_VAL,
            ...common,
            onUpdate(v) { JS_VAL = v; render(); persist() }
          }, ...EXTENSIONS)
        }
      }

      if (multiplePanels) {
        const keysOrder = availablePanels.map(p => p.key)
        const wanted = options.defaultActive
        const initialKey = (wanted && keysOrder.includes(wanted)) ? wanted : keysOrder[0]

        function activate(key) {
          [...tabs.children].forEach(b => b.setAttribute('aria-selected', 'false'))
          Object.values(panesByKey).forEach(p => p.classList.remove('active'))
          const btn = /** @type {HTMLButtonElement} */ (Array.from(tabs.children).find(b => b.id.endsWith(key)))
          if (btn) btn.setAttribute('aria-selected', 'true')
          panesByKey[key]?.classList.add('active')
        }

        activate(initialKey)

        tabs.addEventListener('click', (ev) => {
          const b = ev.target
          if (!(b instanceof HTMLButtonElement)) return
          const key = ['html', 'css', 'js'].find(k => b.id.endsWith(k))
          if (key) activate(key)
        })
      } else {
        panesByKey[availablePanels[0].key]?.classList.add('active')
      }
    }

    // setLayout
    function setLayout(mode) {
      if (!(showPreview && wantEditors)) return
      container.classList.remove('sc-right', 'sc-left', 'sc-bottom', 'sc-top')
      const m = (mode === 'left' || mode === 'bottom' || mode === 'top') ? mode : 'right'
      currentLayout = m
      container.classList.add('sc-' + m)
      persist()
      syncHeights()
    }

    // Preview
    let preview, iframe
    if (showPreview) {
      preview = el('div', 'preview'); preview.style.height = `${height}px`
      iframe = el('iframe')
      preview.appendChild(iframe)
      const previewWrap = el('div', 'sc-preview')
      previewWrap.appendChild(preview)
      container.appendChild(previewWrap)

      render = function renderPreview() {
        setIframeHTMLViaBlob(iframe, buildDoc({ html: HTML_VAL, css: CSS_VAL, js: JS_VAL }))
      }
    }

    // Theme toggle
    if (tb.showTheme && btnTheme) {
      btnTheme.addEventListener('click', () => {
        const toLight = (currentTheme === 'github-dark')
        currentTheme = toLight ? 'github-light' : 'github-dark'
        editorsByKey.html?.setOptions?.({ theme: currentTheme })
        editorsByKey.css?.setOptions?.({ theme: currentTheme })
        editorsByKey.js?.setOptions?.({ theme: currentTheme })
        ensureThemeLink(toLight ? THEME_LIGHT : THEME_DARK)
        btnTheme.textContent = toLight ? 'Light' : 'Dark'
        persist()
      })
    }

    function syncHeights() {
      if (!wantEditors) return

      const verticalLayout = (currentLayout === 'bottom' || currentLayout === 'top')

      // ——— VERTICALES (bottom/top): evitar solapes y huecos ———
      if (verticalLayout) {
        if (editorsWrap) {
          // Si el usuario dio editorsHeight, lo tratamos como *máximo* y dejamos scroll.
          if (editorsHeightOpt != null) {
            editorsWrap.style.height = ''                 // no forzar altura fija
            editorsWrap.style.maxHeight = editorsHeightOpt + 'px'
            editorsWrap.style.overflow = 'auto'
          } else {
            // Sin altura definida: que fluya natural
            editorsWrap.style.height = ''
            editorsWrap.style.maxHeight = ''
            editorsWrap.style.overflow = ''
          }

          // En vertical, NO imponemos 100% a pane/holder (para que respeten el flow).
          Object.values(panesByKey).forEach(p => {
            if (!p) return
            p.style.height = '' // auto
            const holder = p.querySelector('.editor')
            if (holder) holder.style.height = '' // auto
          })
        }
        return // ya resolvimos verticales
      }

      // ——— HORIZONTALES (left/right): comportamiento clásico ———
      let targetH = null
      if (editorsHeightOpt != null) {
        targetH = editorsHeightOpt // respetar altura fija
      } else if (syncEditorsHeightWithPreview && showPreview && preview) {
        targetH = Math.max(0, parseInt(preview.style.height || `${height}`, 10) || height)
      } else {
        targetH = height
      }

      if (targetH != null && editorsWrap) {
        editorsWrap.style.maxHeight = ''          // sin límite en horizontales
        editorsWrap.style.overflow = ''           // sin scroll extra
        editorsWrap.style.height = targetH + 'px' // altura explícita
        Object.values(panesByKey).forEach(p => {
          if (!p) return
          p.style.height = '100%'
          const holder = p.querySelector('.editor')
          if (holder) holder.style.height = '100%'
        })
      }
    }

    // Primer render y alturas
    render()
    syncHeights()

    // API pública
    return {
      run: () => { render(); syncHeights() },
      getValue() { return { html: HTML_VAL, css: CSS_VAL, js: JS_VAL, theme: currentTheme } },
      setValue({ html, css, js } = {}) {
        if (typeof html === 'string') { HTML_VAL = html; editorsByKey.html?.setValue?.(html) }
        if (typeof css === 'string') { CSS_VAL = css; editorsByKey.css?.setValue?.(css) }
        if (typeof js === 'string') { JS_VAL = js; editorsByKey.js?.setValue?.(js) }
        render(); persist(); syncHeights()
      },
      exportHTML() { return buildDoc({ html: HTML_VAL, css: CSS_VAL, js: JS_VAL }) },
      setReadOnly(ro) {
        const ropt = { readOnly: !!ro }
        editorsByKey.html?.setOptions?.(ropt)
        editorsByKey.css?.setOptions?.(ropt)
        editorsByKey.js?.setOptions?.(ropt)
      },
      toggleTheme() { (tb.showTheme && typeof btnTheme?.click === 'function') && btnTheme.click() }
    }
  }

  // ---------- API global ----------
  global.SnapCode = {
    create,
    ensureTheme: ensureThemeLink,
    loadPrism
  }
})(window)
