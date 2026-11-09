# The ecosystem hub, /ecosystem/: one page that places the plugins and the three
# tools next to each other and sends the reader to the page of each. The tools' own pages are
# written by tools.py; the plugins' by plugins.py. Old links into this page's topics
# (#snapeye, #pdf, …) are forwarded by a short script, since the hub used to hold them all.
PATH = 'ecosystem/index.html'
CELLS = [(n, sec, 'Plugin', rel(PATH, f'plugins/{s}/')) for s, n, sec, _ in OWN_PAGE] + [('The toolbox', 'prepare', '11 plugins', rel(PATH, 'plugins/#toolbox'))]
CELLS += [(t['name'], 'ecosystem', 'Experimental' if t.get('experimental') else 'Tool', rel(PATH, f'tools/{t["slug"]}/')) for t in TOOLS]
JOBS = [('Export an element as an image', 'SnapDOM core', rel(PATH, 'docs/#quick-start')),
        ('Make a PDF with selectable text and pages', 'PDF', rel(PATH, 'plugins/pdf/')),
        ('Edit the result in Figma or an SVG tool', 'Vector', rel(PATH, 'plugins/vector/')),
        ('Feed a live element to WebGL or a video call', 'Stream', rel(PATH, 'plugins/stream/')),
        ('Redact, filter, record or map a capture', 'The toolbox', rel(PATH, 'plugins/#toolbox')),
        ('Check that nothing changed visually', 'SnapDiff', rel(PATH, 'tools/snapdiff/')),
        ('Give a coding agent before/after evidence', 'SnapEye', rel(PATH, 'tools/snapeye/')),
        ('Let an agent reach a state and verify it', 'SnapSurf (experimental)', rel(PATH, 'tools/snapsurf/'))]
STEPS = [('1 · Reach the state', 'SnapSurf opens the page and clicks Settings. Verify that the panel appeared and the controls are available.'),
         ('2 · Inspect the edit', 'SnapEye captures the open panel before and after the code change. Compare its appearance or record the transition.'),
         ('3 · Keep it checked', 'SnapDiff adds the panel to a repeatable visual suite. Review the baseline and check future changes against it.')]

inner = doc_head(['Ecosystem'], 'Plugins · Tools', 'Plugins and tools built on SnapDOM.',
                 'Extend a capture with the official plugins, or use the tools built on SnapDOM for visual testing and for agents. Every piece has a page of its own; this one shows how they fit together.')
inner += '<div class="pane-content pane-prose">' + index_grid(CELLS)
inner += ('<h2>Choose by the job</h2><div class="compare-table"><table><thead><tr><th scope="col">Job</th><th scope="col">Use</th></tr></thead><tbody>'
          + ''.join(f'<tr><td>{a}</td><td><a href="{h}">{b}</a></td></tr>' for a, b, h in JOBS) + '</tbody></table></div>')
inner += '<h2>One settings panel, three kinds of checks</h2><ol class="pane-steps">' + ''.join(f'<li><h3>{a}</h3><p>{b}</p></li>' for a, b in STEPS) + '</ol>'
inner += ('<p class="pane-para" style="margin-top:20px">Your agent or test harness connects these steps. For an already-open panel, call SnapEye’s in-page API: its URL trigger reloads the page. '
          'Keep viewport, data and state consistent, and manage each tool’s baselines separately.</p>')
inner += (f'<h2 id="community-plugins">Community plugins</h2><p>Plugins written outside this repository are listed on <a href="{rel(PATH, "plugins/#community-plugins")}">the plugins page</a>, '
          f'with a row per project. <a href="{rel(PATH, "docs/plugins/#build")}">The plugin guide</a> shows how to write one.</p></div>')
SIDE = [('Tools', 'ecosystem', [(rel(PATH, f'tools/{t["slug"]}/'), t['name']) for t in TOOLS]),
        ('Plugins', 'export', [(rel(PATH, 'plugins/'), 'All plugins')] + [(rel(PATH, f'plugins/{s}/'), n) for s, n, _, _ in OWN_PAGE]),
        ('Community', 'context', [(rel(PATH, 'plugins/#community-plugins'), 'Community plugins'), (rel(PATH, 'made-with/'), 'Made with')])]
FORWARD = {'#snapeye': 'tools/snapeye/', '#snapdiff': 'tools/snapdiff/', '#snapsurf': 'tools/snapsurf/', '#official-plugins': 'plugins/', '#pdf': 'plugins/pdf/', '#vector': 'plugins/vector/'}
SCRIPT = '\n<script>{ const to = ' + json.dumps({k: rel(PATH, v) for k, v in FORWARD.items()}) + '[location.hash]; if (to) location.replace(to) }</script>'
LD = {'mainEntity': {'@type': 'ItemList', 'itemListElement': [{'@type': 'ListItem', 'position': i + 1, 'name': n, 'url': SITE + p} for i, (p, n) in enumerate(
      [(f'plugins/{s}/', n) for s, n, _, _ in OWN_PAGE] + [(f'tools/{t["slug"]}/', t['name']) for t in TOOLS])]}}
standalone(PATH, 'Ecosystem', meta('SnapDOM ecosystem: plugins, SnapDiff, SnapEye, SnapSurf',
           'Plugins and tools built on SnapDOM: PDF, Vector and Stream, the toolbox, SnapDiff for visual regression, SnapEye for coding agents, SnapSurf for browsing agents.',
           'ecosystem/', 'CollectionPage', LD), SIDE, 'Filter ecosystem', 'Ecosystem', 'ecosystem', 'Ecosystem', inner, None,
           pager(None, (rel(PATH, 'tools/snapdiff/'), 'SnapDiff')), '', SCRIPT)
