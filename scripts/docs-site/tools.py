# The tool pages, /tools/<name>/: SnapDiff, SnapEye and SnapSurf are separate projects with
# their own repositories; the site gives each one page with the same shape as a plugin page.
# The facts (versions, peer ranges, snippets) were read from each repository's README and
# package.json on 2026-11-09; update them here when a tool publishes a new release. `install`
# is (heading, snippet): SnapSurf is added to an MCP client rather than installed.
TOOLS = [
 {'slug': 'snapdiff', 'name': 'SnapDiff', 'npm': '@zumer/snapdiff', 'version': '0.3.1', 'repo': 'https://github.com/zumerlab/snapdiff', 'site': 'https://zumerlab.com/snapdiff/',
  'tagline': 'Visual regression testing that runs in the browser.',
  'lead': 'SnapDiff captures DOM elements with SnapDOM, compares them to saved baselines, and shows what changed. Capture, diff, storage and review happen in the page; the Vitest suite adds disk baselines and tests that fail when visuals drift.',
  'does': ['A script tag with <code>data-snap</code> attributes: baselines in IndexedDB, a badge to review changes.',
           '<code>snapdiff-stale</code> flags baselines older than their source files, with no rendering.',
           '<code>defineDemoSuite</code> turns each demo into a Vitest browser test with disk baselines.'],
  'fit': ['SnapDiff captures what SnapDOM captures: the DOM rendered to an image, not the browser window, so native widgets and browser chrome fall outside it.',
          'SnapEye and SnapDiff both compare pixels. Choose SnapEye for an agent’s capture-and-inspect task; choose SnapDiff for a maintained set of visual tests and baseline reviews.'],
  'range': 'Works with SnapDOM 2.x and 3.x.',
  'install': ('Install', 'npm install --save-dev @zumer/snapdiff'),
  'usage': "import { snapdom } from '@zumer/snapdom'\nimport { createRunner, Reporter } from '@zumer/snapdiff'\n\nconst runner = createRunner({ snapdom, namespace: 'my-app', threshold: 0.1, failureRatio: 0 })\nrunner.test('homepage hero', () => document.querySelector('.hero'))\nconst reporter = new Reporter(runner)\nreporter.mount()\nawait reporter.runAndShow()",
  'links': [('https://github.com/zumerlab/snapdiff#ways-to-use-it', 'Ways to use it'), ('https://github.com/zumerlab/snapdiff#vitest-browser-suite', 'Vitest browser suite'),
            ('https://github.com/zumerlab/snapdiff#staleness-check-snapdiff-stale', 'Staleness check'), ('https://github.com/zumerlab/snapdiff#determinism-applies-to-every-tier', 'Determinism')],
  'demo': {'demo': 'diff', 'sample': 'form', 'demo-label': 'Baseline and compare', 'note': 'Take a baseline of the card, change its title, then compare. Changed pixels turn red, the rest fades. SnapDiff does this against saved baselines.'}},
 {'slug': 'snapeye', 'name': 'SnapEye', 'npm': '@zumer/snapeye', 'version': '0.4.0', 'repo': 'https://github.com/zumerlab/snapeye',
  'tagline': 'Capture, compare and record for coding agents.',
  'lead': 'SnapEye is a visual toolbelt built on SnapDOM for coding agents. The agent runs one command, gets a JSON answer, and only opens an image when the JSON says it should.',
  'does': ['<code>capture</code> records a baseline PNG of one target under <code>.snapeye/baselines</code>.',
           '<code>diff</code> compares the current render against it and reports changed regions as JSON.',
           '<code>record</code> captures a target for a fixed duration as GIF, video and filmstrip.'],
  'fit': ['SnapEye does not navigate, click, reason, call a model or orchestrate an agent; getting the app into the right state stays the agent’s job. A browser driver reaches interactive states; SnapEye measures their appearance.',
          'Its visual comparison uses SnapDiff’s diff engine. The CLI talks to the app through the Vite plugin, or serves a page itself with <code>--serve</code>.'],
  'range': 'Works with SnapDOM 2.24.10 or newer, including 3.x.',
  'install': ('Install', 'npm install --save-dev @zumer/snapeye @zumer/snapdom@latest'),
  'usage': "npx snapeye capture header-desktop --target '#site-header'\nnpx snapeye diff header-desktop --target '#site-header' --fail-on-change\nnpx snapeye record menu --target '.menu' --duration 3000 --fps 10 --format gif\nnpx snapeye diff dashboard --url http://localhost:5173/settings?tab=billing\nnpx snapeye capture issue --serve repro/issue.html --snapdom ../snapdom/dist --target '#test'",
  'links': [('https://github.com/zumerlab/snapeye#agent-workflow', 'Agent workflow'), ('https://github.com/zumerlab/snapeye#result-contract', 'Result contract'),
            ('https://github.com/zumerlab/snapeye/blob/main/RECIPES.md', 'Agent recipes'), ('https://github.com/zumerlab/snapeye#any-vite-app', 'Setup for a Vite app')],
  'demo': {'demo': 'pair', 'sample': 'form', 'demo-label': 'Before and after', 'note': 'Take a baseline, change the card, then compare to get the before/after pair an agent would receive.'}},
 {'slug': 'snapsurf', 'name': 'SnapSurf', 'npm': '@zumer/snapsurf', 'version': '0.1.2', 'repo': 'https://github.com/zumerlab/snapsurf', 'experimental': True,
  'tagline': 'Web navigation and verification for agents.',
  'lead': 'SnapSurf tells an agent what its last action changed: a compact semantic digest of the page, a typed diff after each action, and assertions over that exact diff. It runs locally as an MCP server or CLI with its own Chromium session.',
  'does': ['<code>browser_open</code> returns a compact semantic digest of the page with element ids.',
           '<code>browser_verify</code> returns a typed diff after each action: content, state, layout, clickability.',
           '<code>browser_assert</code> checks that exact diff by its id, including changes beyond the displayed list.'],
  'fit': ['A semantic diff answers whether the observed page changed. It does not replace a pixel comparison against a saved visual baseline.',
          'SnapSurf runs its own Chromium session with its own cookies and storage, so it cannot use your everyday browser’s sign-ins. Its observation code also works as an in-page library built on SnapDOM.'],
  'range': 'Bundles its own SnapDOM runtime; installing another SnapDOM version does not replace it.',
  'install': ('Add it to your MCP client', '{\n  "command": "npx",\n  "args": ["-y", "-p", "@zumer/snapsurf@latest", "snapsurf-mcp"]\n}'),
  'usage': "# terminal 1: the daemon\nnpx -y @zumer/snapsurf serve\n# terminal 2: a local smoke check\nnpx -y @zumer/snapsurf open 'data:text/html,<h1>Local%20check</h1>'\nnpx -y @zumer/snapsurf assert '{\"exists\":\"Local check\"}'\nnpx -y @zumer/snapsurf stop",
  'links': [('https://github.com/zumerlab/snapsurf#add-it-to-your-mcp-client', 'Add it to your MCP client'), ('https://github.com/zumerlab/snapsurf/blob/main/docs/INTEGRATIONS.md', 'Per-client snippets'),
            ('https://github.com/zumerlab/snapsurf/blob/main/docs/USAGE.md', 'Usage and API reference'), ('https://github.com/zumerlab/snapsurf/blob/main/AGENTS.md', 'The loop and the rules for agents')],
  'badge': '<a href="https://mcprush.com/tinchox5/snapsurf-mcp-2"><img width="380" height="200" src="https://mcprush.com/badge/snapsurf-mcp/card.svg" alt="SnapSurf MCP server" loading="lazy"></a>'},
]

TOOL_FLAT = [('ecosystem/', 'Ecosystem')] + [(f'tools/{t["slug"]}/', t['name']) for t in TOOLS]

def tool_nav(path):
    return [('Tools', 'ecosystem', [(rel(path, f'tools/{t["slug"]}/'), t['name']) for t in TOOLS] + [(rel(path, 'ecosystem/'), 'How they fit together')]),
            ('Plugins', 'export', [(rel(path, 'plugins/'), 'All plugins')] + [(rel(path, f'plugins/{s}/'), n) for s, n, _, _ in OWN_PAGE])]

def tool_page(t):
    path = f'tools/{t["slug"]}/index.html'
    i = [p for p, _ in TOOL_FLAT].index(path[:-10])
    pages = pager((rel(path, TOOL_FLAT[i - 1][0]), TOOL_FLAT[i - 1][1]), (rel(path, TOOL_FLAT[i + 1][0]), TOOL_FLAT[i + 1][1]) if i + 1 < len(TOOL_FLAT) else None)
    exp = t.get('experimental')
    links = [(t['repo'], 'GitHub'), (f'https://www.npmjs.com/package/{t["npm"]}', 'npm')] + ([(t['site'], 'Project site')] if t.get('site') else [])
    inner = doc_head(['Ecosystem', 'Tools', t['name']], f'{t["npm"]} {t["version"]}' + (' · experimental' if exp else ''), E(t['tagline']), E(t['lead']), links)
    inner += f'<div class="pane-content pane-prose"><div class="provided-by"><span class="topic-sub">Built on SnapDOM, released from its own repository.</span>{tag("Separate project", "project")}{tag("Experimental", "experimental") if exp else ""}</div>'
    if exp:
        inner += f'<aside class="callout"><div class="callout-label">Status</div>{t["name"]} is at {t["version"]} and calls itself experimental: the CLI, the MCP tools and the diff format can change between releases.</aside>'
    inner += '<h2>What it does</h2><ul class="pane-list">' + ''.join(f'<li>{d}</li>' for d in t['does']) + '</ul>'
    inner += f'<h2>{E(t["install"][0])}</h2>' + code(t['install'][1]) + '<h2>Use it</h2>' + code(t['usage'])
    inner += '<h2>Where it fits</h2>' + ''.join(f'<p>{p}</p>' for p in t['fit']) + f'<p>{E(t["range"])}</p>'
    inner += '<p class="pane-links">' + ''.join(f'<a href="{h}">{E(l)}</a>' for h, l in t['links']) + '</p>'
    if t.get('badge'): inner += f'<p>{t["badge"]}</p>'
    inner += '</div>'
    ld = {'applicationCategory': 'DeveloperApplication', 'operatingSystem': 'Web', 'softwareVersion': t['version'], 'sameAs': [t['repo']] + ([t['site']] if t.get('site') else [])}
    standalone(path, 'Ecosystem', meta(f'{t["name"]}: {t["tagline"].rstrip(".")}', t['lead'][:157].rsplit(' ', 1)[0] + '…' if len(t['lead']) > 160 else t['lead'], f'tools/{t["slug"]}/', 'SoftwareApplication', ld),
               tool_nav(path), 'Filter tools', 'Tools', 'ecosystem', t['name'], inner, t.get('demo'), pages)

for t in TOOLS: tool_page(t)
