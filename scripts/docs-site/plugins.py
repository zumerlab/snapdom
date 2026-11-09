# The plugin pages: /plugins/ (the index) and one page per toolbox plugin, written from the
# sections of packages/plugins/README.md so the site and the package say the same thing.
# PDF, Vector and Stream are plugins like the rest, each published as a package of its own,
# with a hand-written page (docs/plugins/<name>/index.html) that is also its reference; this
# file lists them in their job group and writes the sidebar every plugin page shares into
# them. The pages carry the `plugin-page` class so finish.py leaves them alone.
README = open(os.path.join(HERE, '..', '..', 'packages', 'plugins', 'README.md')).read()
GITHUB = 'https://github.com/zumerlab/snapdom/blob/main/'
INSTALL = 'npm install @zumer/snapdom@latest @zumer/snapdom-plugins@latest'

# The three with a package and a hand-written page of their own: slug, name, job group, one line.
OWN_PAGE = [('pdf', 'PDF', 'export', 'Documents with selectable text, links and pages'),
            ('vector', 'Vector', 'export', 'Editable SVG and the Figma clipboard'),
            ('stream', 'Stream', 'record', 'A live element as a canvas that repaints what changed')]
# Stream's page links the places it runs; the other two demo themselves in the page.
OWN_LINKS = {'stream': [('showcase/#stream-demo', 'Showcase demo'), ('labs/video-overlay/', 'Video overlay lab'),
                        ('labs/webrtc-overlay/', 'WebRTC overlay lab'), ('labs/ascii-mirror/', 'ASCII mirror lab')]}

# Groups by the job a plugin does. Each plugin: slug, name, h1, one line for the index, the
# demo settings panes.js reads, its demo's id on the showcase, and the meta description
# (150 to 160 characters: Bing Webmaster Tools flags shorter ones as too short).
TOOLBOX = [
 ('Prepare', 'prepare', 'Change what the capture shows. The live page is never touched.', [
  ('redact-inputs', 'Redact inputs', 'Redact fields before sharing.', 'Mask field values, hide blocks, drop attributes',
   {'demo': 'capture', 'prepare': 'redact', 'sample': 'form', 'demo-label': 'Email masked', 'note': 'The email field is masked in the capture only. The display name is not an email or phone field, so it stays; add it with selector or all.'}, 'redact-demo',
   'SnapDOM plugin that masks input and textarea values, hides selected blocks and strips named attributes from the capture, while the live page stays unchanged.'),
  ('replace-text', 'Replace text', 'Replace text in the capture.', 'Strings or regular expressions, in the clone only',
   {'demo': 'capture', 'prepare': 'retitle', 'demo-label': 'Title replaced', 'note': 'Whatever title you type is replaced by "Name hidden for sharing" in the capture. The page keeps yours.'}, 'replace-demo',
   'SnapDOM plugin that replaces text in the captured clone with plain strings or regular expressions, leaving stylesheet and script text and the page untouched.'),
  ('filter', 'Filter', 'Apply a CSS filter to the capture.', 'Grayscale, sepia, blur or any filter string',
   {'demo': 'capture', 'prepare': 'filter', 'demo-label': 'Grayscale preset', 'note': 'The capture takes the grayscale preset; the live card keeps its colors.'}, 'filter-demo',
   'SnapDOM plugin that applies a CSS filter to the capture: grayscale, sepia, blur or any filter string, via a preset or a raw value, overriding authored filters.'),
  ('color-tint', 'Color tint', 'Tint the capture with a color.', 'A blend-mode overlay with its own opacity',
   {'demo': 'capture', 'prepare': 'tint', 'demo-label': 'Blue at 35%', 'note': 'A royal blue overlay at 0.35 opacity, mixed with mix-blend-mode.'}, 'filter-demo',
   'SnapDOM plugin that tints a capture with a color overlay mixed through mix-blend-mode, with its own opacity, where opacity 0 leaves the image as captured.'),
  ('timestamp-overlay', 'Timestamp overlay', 'Stamp the capture with the time.', 'Date, time or a custom formatter in a corner',
   {'demo': 'capture', 'prepare': 'timestamp', 'demo-label': 'Top-right datetime', 'note': 'The clock runs at capture time, so two runs carry two different stamps.'}, 'timestamp-demo',
   'SnapDOM plugin that stamps a capture with a timestamp label: datetime, date, time, ISO or a custom formatter, in any corner, with background and color options.'),
 ]),
 ('Export', 'export', 'Other outputs from the same capture.', [
  ('html-export', 'HTML export', 'Export the frozen HTML.', 'The clone with its styles and fonts as a document',
   {'demo': 'capture', 'transform': 'html', 'demo-label': 'toHtml()', 'note': 'The result is the captured document as text. Save it as a file and it reopens with the same layout.'}, 'html-export-demo',
   'SnapDOM plugin that adds toHtml(): the frozen clone with its captured styles and fonts as an HTML document you can save and reopen with the same layout.'),
  ('ascii-export', 'ASCII export', 'Export the capture as ASCII art.', 'Text or colored HTML, also frame by frame',
   {'demo': 'capture', 'transform': 'ascii', 'sample': 'svg', 'demo-label': 'toAscii() at 46 columns'}, 'ascii-demo',
   'SnapDOM plugin that adds toAscii(): convert a capture to ASCII art as plain text or colored HTML, with width, invert and contrast options, frame by frame.'),
 ]),
 ('Record', 'record', 'Record the live element over time.', [
  ('gif-export', 'GIF export', 'Record the element as a GIF.', 'A built-in GIF89a encoder, no dependency',
   {'demo': 'capture', 'transform': 'gif', 'demo-label': 'toGif(), one second', 'note': 'Recording starts when you run. Edit the title while it records to see frames differ.'}, 'gif-export-demo',
   'SnapDOM plugin that adds toGif(): record a live element into a GIF Blob with a built-in GIF89a encoder and no dependency, with fps, duration and scale options.'),
  ('video-export', 'Video export', 'Record the element as video.', 'MP4 or WebM through MediaRecorder',
   {'demo': 'capture', 'transform': 'video', 'demo-label': 'toMp4(), 1.5 seconds', 'note': 'Records through MediaRecorder: MP4 where the browser encodes it, WebM otherwise. Edit the title while it records.'}, 'video-export-demo',
   'SnapDOM plugin that adds toMp4(): record a live element through MediaRecorder into an MP4 or WebM Blob, with fps, duration, frames, scale and bitrate options.'),
 ]),
 ('Context', 'context', 'Structured output for coding agents and visual QA.', [
  ('agent-map', 'Agent map', 'Map interactive elements for agents.', 'Badges on the image plus a JSON element map',
   {'demo': 'capture', 'transform': 'map', 'sample': 'form', 'demo-label': 'toAgentMap()', 'note': 'Badges number the interactive elements; the JSON map with names, roles and bounds comes back with the image.'}, 'agent-map-demo',
   'SnapDOM plugin that adds toAgentMap(): a Set-of-Mark image with numbered badges on interactive elements plus a JSON map of their names, roles, bounds and state.'),
  ('context-export', 'Context export', 'Export the UI as text for agents.', 'An outline or JSON tree of structure, text and state',
   {'demo': 'capture', 'transform': 'context', 'sample': 'form', 'demo-label': 'toContext()', 'note': 'The outline keeps roles, visible text and state; typed values are masked.'}, 'context-demo',
   'SnapDOM plugin that adds toContext(): the captured UI as a text outline or JSON tree of structure, roles, text, state and optional bounds, for coding agents.'),
 ]),
]

# ── A small Markdown reader for the README's plugin sections ──
TOK = re.compile(r'(`[^`]*`)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*(.+?)\*\*')

def md_url(u):
    return u if re.match(r'https?://', u) else GITHUB + 'packages/plugins/' + re.sub(r'^\./', '', u)

def md_inline(s):
    out, pos = [], 0
    for m in TOK.finditer(s):
        out.append(E(s[pos:m.start()]))
        if m[1]: out.append(f'<code>{E(m[1][1:-1])}</code>')
        elif m[2]: out.append(f'<a href="{E(md_url(m[3]))}">{md_inline(m[2])}</a>')
        else: out.append(f'<strong>{md_inline(m[4])}</strong>')
        pos = m.end()
    out.append(E(s[pos:]))
    # An arrow chain in prose reads as "then"; code samples keep their arrows (finish.py
    # would otherwise strip the glyph and leave the words touching).
    return ''.join(out).replace(' → ', ', then ')

def md_blocks(text):
    """Split a section into ('p', text) | ('code', lang, src) | ('table', lines) | ('h2', text) | ('list', items)."""
    out, lines, i = [], text.split('\n'), 0
    while i < len(lines):
        l = lines[i]
        if not l.strip() or l.strip() == '---':
            i += 1
        elif l.startswith('```'):
            j = i + 1
            while not lines[j].startswith('```'): j += 1
            out.append(('code', l[3:].strip(), '\n'.join(lines[i + 1:j]))); i = j + 1
        elif l.startswith('|'):
            j = i
            while j < len(lines) and lines[j].startswith('|'): j += 1
            out.append(('table', lines[i:j])); i = j
        elif l.startswith('#### '):
            out.append(('h2', l[5:].strip())); i += 1
        elif l.startswith('- '):
            items, j = [], i
            while j < len(lines) and (lines[j].startswith('- ') or lines[j].startswith('  ')):
                if lines[j].startswith('- '): items.append(lines[j][2:].strip())
                else: items[-1] += ' ' + lines[j].strip()
                j += 1
            out.append(('list', items)); i = j
        else:
            j = i
            while j < len(lines) and lines[j].strip() and not re.match(r'```|\||#### |- ', lines[j]): j += 1
            out.append(('p', ' '.join(x.strip() for x in lines[i:j]))); i = j
    return out

def md_table(lines):
    rows = [[c.strip().replace('\\|', '|') for c in re.split(r'(?<!\\)\|', l.strip().strip('|'))]
            for l in lines if not re.fullmatch(r'[\s:|-]+', l)]
    return ('<div class="compare-table"><table><thead><tr>' + ''.join(f'<th scope="col">{md_inline(c)}</th>' for c in rows[0])
            + '</tr></thead><tbody>' + ''.join('<tr>' + ''.join(f'<td>{md_inline(c)}</td>' for c in r) + '</tr>' for r in rows[1:])
            + '</tbody></table></div>')

def md_html(blocks):
    out = []
    for b in blocks:
        if b[0] == 'code': out.append(code(b[2]))
        elif b[0] == 'table': out.append(md_table(b[1]))
        elif b[0] == 'h2': out.append(f'<h2>{E(b[1])}</h2>')
        elif b[0] == 'list': out.append('<ul class="pane-list">' + ''.join(f'<li>{md_inline(x)}</li>' for x in b[1]) + '</ul>')
        else: out.append(f'<p>{md_inline(b[1])}</p>')
    return '\n'.join(out)

def readme_section(slug):
    m = re.search(rf'^### `{re.escape(slug)}`\n(.*?)(?=^### |^## )', README, re.S | re.M)
    if not m: raise SystemExit(f'plugins.py: no README section for {slug}')
    return m[1]

# ── Pages ──
def by_job(sec, items):
    """The (slug, name, one line) of a job group: the plugins with a page of their own first."""
    return [(s, n, m) for s, n, g, m in OWN_PAGE if g == sec] + [(i[0], i[1], i[3]) for i in items]

FLAT = [('plugins/', 'All plugins')] + [(f'plugins/{s}/', n) for _, sec, _, items in TOOLBOX for s, n, _ in by_job(sec, items)]

def plugin_nav(path):
    return ([('Plugins', 'export', [(rel(path, 'plugins/'), 'All plugins')])]
            + [(glabel, sec, [(rel(path, f'plugins/{s}/'), n) for s, n, _ in by_job(sec, items)]) for glabel, sec, _, items in TOOLBOX])

def plugin_pager(path):
    i = [p for p, _ in FLAT].index(path[:-10])
    prev = (rel(path, FLAT[i - 1][0]), FLAT[i - 1][1]) if i else None
    nxt = (rel(path, FLAT[i + 1][0]), FLAT[i + 1][1]) if i + 1 < len(FLAT) else None
    return pager(prev, nxt)

def plugin_page(glabel, sec, slug, name, h1, demo, showcase_id, description):
    path = f'plugins/{slug}/index.html'
    blocks = md_blocks(readme_section(slug))
    intro, rest = blocks[0], blocks[1:]
    if not any(b[0] == 'h2' and b[1] == 'Options' for b in rest):
        k = next((i for i, b in enumerate(rest) if b[0] == 'table'), None)
        if k is not None: rest.insert(k, ('h2', 'Options'))
    k = next((i for i, b in enumerate(rest) if b[0] == 'code'), None)
    if k is not None: rest.insert(k, ('h2', 'Usage'))
    links = [(GITHUB + f'packages/plugins/{slug}.js', 'Source · MIT'), (GITHUB + 'packages/plugins/CHANGELOG.md', 'Changelog'),
             (rel(path, f'showcase/#{showcase_id}'), 'Showcase demo')]
    inner = doc_head(['Plugins', glabel, name], '@zumer/snapdom-plugins · MIT', E(h1), md_inline(intro[1]), links)
    inner += ('<div class="pane-content pane-prose">' + code(INSTALL) + md_html(rest)
              + f'<h2>Something missing?</h2><p>Options are added for captures someone needed, not in advance. '
              f'<a href="https://github.com/zumerlab/snapdom/issues/new?title={slug}%3A%20">Open an issue</a> with the element and the output you need.</p></div>')
    standalone(path, 'Plugins', meta(f'{name} plugin for SnapDOM', description, f'plugins/{slug}/', 'TechArticle'),
               plugin_nav(path), 'Filter plugins', 'Plugins', sec, name, inner, demo, plugin_pager(path), 'plugin-page')

def community_table():
    rows = [[c.strip() for c in l.strip().strip('|').split('|')] for l in open(os.path.join(OUT, 'community-plugins.md')) if l.startswith('|')]
    rows = [r for r in rows if not re.fullmatch(r'[\s:|-]+', '|'.join(r))][1:]
    # An empty npm cell is a project that left npm (figma-restoration-mcp-vue-tools, unpublished 2026-10-28).
    body = ''.join(f'<tr><td><a href="{E(gh)}">{E(name)}</a></td><td>{E(desc)}</td><td>{E(cat)}</td><td>'
                   + (f'<a href="https://www.npmjs.com/package/{E(npm)}">{E(npm)}</a>' if npm else '')
                   + f'</td><td>{E(author)}</td></tr>' for name, desc, cat, npm, gh, author in rows)
    return ('<div class="compare-table"><table><thead><tr><th scope="col">Plugin</th><th scope="col">What it does</th><th scope="col">Category</th>'
            f'<th scope="col">npm</th><th scope="col">Author</th></tr></thead><tbody>{body}</tbody></table></div>')

def plugins_index():
    path = 'plugins/index.html'
    count = len(OWN_PAGE) + sum(len(g[3]) for g in TOOLBOX)
    inner = doc_head(['Plugins'], f'{count} official plugins · MIT', 'Plugins for SnapDOM.',
                     'Fourteen official plugins, grouped by the job they do. Every page has the options and a live demo. '
                     'All of them are MIT. PDF, Vector and Stream are each a package of their own; the other eleven ship together as the toolbox.',
                     [(GITHUB + 'packages', 'Source'), ('https://www.npmjs.com/package/@zumer/snapdom-plugins', 'npm'), (rel(path, 'showcase/#plugins'), 'Plugin demos')])
    inner += '<div class="pane-content pane-prose">'
    inner += '<h2 id="install">Install</h2>' + code(INSTALL + '\nnpm install @zumer/snapdom-pdf @zumer/snapdom-vector @zumer/snapdom-stream')
    inner += ('<p>The first line is SnapDOM and the toolbox; the second, PDF, Vector and Stream, each a package of its own. Import those three from their package and a toolbox plugin from its subpath, and pass them in <code>plugins</code>. All of them need SnapDOM 3.4.0 or newer within 3.x.</p>'
              + code("import { snapdom } from '@zumer/snapdom'\nimport { redactInputs } from '@zumer/snapdom-plugins/redact-inputs'\nimport { pdf } from '@zumer/snapdom-pdf'\n\nconst result = await snapdom(el, { plugins: [redactInputs(), pdf()] })\nconst blob = await result.toPdf({ page: 'a4' })"))
    inner += '<h2 id="toolbox">Plugins by job</h2><p>Prepare plugins change the clone before it renders; the others add an export method to the result, and Stream keeps a canvas in step with the element.</p>'
    for glabel, sec, blurb, items in TOOLBOX:
        inner += f'<h3 id="{sec}">{E(glabel)}</h3><p>{E(blurb)}</p>' + index_grid([(n, sec, m, rel(path, f'plugins/{s}/')) for s, n, m in by_job(sec, items)])
    inner += ('<h2 id="community-plugins">Community plugins</h2><p>Maintained by their authors. Check the supported SnapDOM versions before using one with 3.x. '
              f'To add yours, open a pull request with a row in <a href="{GITHUB}docs/community-plugins.md">community-plugins.md</a>; '
              f'<a href="{GITHUB}CONTRIBUTING_PLUGINS.md">CONTRIBUTING_PLUGINS.md</a> says what a row needs.</p>' + community_table())
    inner += (f'<h2 id="build">Build your own</h2><p>A plugin is an object with hooks. <a href="{rel(path, "docs/plugins/#build")}">The plugin guide</a> walks through one, '
              f'and <a href="{GITHUB}PLUGIN_SPEC.md">PLUGIN_SPEC.md</a> is the contract: hook order, what each hook receives, and what it may change.</p></div>')
    ld = {'mainEntity': {'@type': 'ItemList', 'itemListElement': [{'@type': 'ListItem', 'position': i + 1, 'name': n, 'url': SITE + p} for i, (p, n) in enumerate(FLAT[1:])]}}
    standalone(path, 'Plugins', meta('SnapDOM plugins: PDF, Vector, Stream and the toolbox',
               'Fourteen official plugins for SnapDOM, grouped by job: prepare, export, record and map a capture. PDF, Vector and Stream are each a package of their own. MIT.',
               'plugins/', 'CollectionPage', ld), plugin_nav(path), 'Filter plugins', 'Plugins', 'export', 'Plugins', inner, None, plugin_pager(path), 'plugin-page')

def own_page_side(s):
    """Write the shared sidebar into a hand-written page, plus the sections of that page, read
    from its h2 ids so the list cannot drift from the content. No filter box: these pages load
    their own runner, not panes.js."""
    path = f'plugins/{s}/index.html'
    full = os.path.join(OUT, path)
    page = open(full).read()
    article = page[page.index('<article'):page.index('</article>')]
    here = [('#' + i, html.unescape(re.sub(r'<[^>]+>', '', t))) for i, t in re.findall(r'<h2 id="([^"]+)">(.*?)</h2>', article, re.S)]
    groups = plugin_nav(path) + [('On this page', 'context', here)]
    if s in OWN_LINKS: groups.append(('Where it runs', 'labs', [(rel(path, h), t) for h, t in OWN_LINKS[s]]))
    open(full, 'w').write(re.sub(r'<aside class="pane-side">.*?</aside>', lambda m: nav_groups(groups, None, 'Plugins'), page, count=1, flags=re.S))

plugins_index()
for s, _, _, _ in OWN_PAGE: own_page_side(s)
for glabel, sec, _, items in TOOLBOX:
    # Not `slug`: this runs in build.py's namespace, where slug() is the function sections.py calls.
    for s, name, h1, _, demo, showcase_id, description in items:
        plugin_page(glabel, sec, s, name, h1, demo, showcase_id, description)
