# Builds the snapdom.dev pages that use the pane template (docs/panes.css, docs/panes.js):
# sidebar, reading column, and the live demo below the reading column where a page has one.
#   python3 scripts/docs-site/build.py
# plugins.py, tools.py and ecosystem.py write their pages from data; sections.py converts the
# existing content pages (docs, how-to, guides, compare, blog, labs) in place and is
# idempotent, so it can run again after a page's content changes. finish.py then refreshes
# the shared chrome of every page and metadata.py rebuilds the sitemap.
import html, json, os, re
E = html.escape
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'docs')
SITE = 'https://snapdom.dev/'

MENU = [
 ('Learn', [('Docs','docs/','capture','API, options and quick start'),('How-to','how-to/','start','Recipes and framework guides'),('Compare','compare/','ecosystem','SnapDOM vs html2canvas and others')]),
 ('Explore', [('Showcase','showcase/','labs','Live demos and labs'),('Plugins','plugins/','export','PDF, Vector, Stream and the toolbox'),('Blog','blog/','record','Engineering notes')]),
 ('Community', [('Ecosystem','ecosystem/','ecosystem','SnapDiff, SnapEye, SnapSurf'),('Made with','made-with/','context','Projects using SnapDOM')]),
]
FOOT = [
 ('Learn', [('Documentation','docs/'),('Quick start','docs/#quick-start'),('How-to recipes','how-to/'),('Framework guides','how-to/#frameworks'),('Compare','compare/')]),
 ('Explore', [('Showcase','showcase/'),('Plugins','plugins/'),('PDF','plugins/pdf/'),('Vector','plugins/vector/'),('Stream','plugins/stream/'),('Writing plugins','docs/plugins/#build'),('Labs','showcase/#labs'),('Blog','blog/')]),
 ('Community', [('Ecosystem','ecosystem/'),('SnapDiff','tools/snapdiff/'),('SnapEye','tools/snapeye/'),('SnapSurf','tools/snapsurf/'),('Made with','made-with/'),('Community plugins','plugins/#community-plugins'),('GitHub','https://github.com/zumerlab/snapdom'),('npm','https://www.npmjs.com/package/@zumer/snapdom'),('Sponsors','https://github.com/sponsors/tinchox5')]),
]

CUR = ' aria-current="page"'
def header(active, root='../'):
    groups = []
    for label, items in MENU:
        cur = any(i[0] == active for i in items)
        links = ''.join(
            f'<a class="site-nav-item sec-{s}" href="{root}{h}"{CUR if l == active else ""}><span class="sec-dot"></span><span class="site-nav-item-label">{E(l)}</span><span class="site-nav-item-desc">{E(d)}</span></a>'
            for l, h, s, d in items)
        groups.append(f'<div class="site-nav-group{" is-current" if cur else ""}"><button type="button" class="site-nav-button" aria-expanded="false">{label}</button><div class="site-nav-panel">{links}</div></div>')
    return ('<header class="site-head"><div class="site-head-inner">'
            f'<a class="site-shell-brand" href="{root or "./"}" aria-label="SnapDOM home"><span class="site-shell-mark"></span><span>SnapDOM</span></a>'
            f'<nav class="site-nav" aria-label="Main navigation">{"".join(groups)}</nav>'
            '<button type="button" class="site-menu-button" aria-expanded="false">Menu</button>'
            '<a class="site-shell-github" aria-label="SnapDOM on GitHub" href="https://github.com/zumerlab/snapdom" target="_blank" rel="noopener"><span>GitHub</span><span class="site-shell-stars">★ <span data-star-count>8K</span></span></a>'
            '</div></header>')

def footer(root='../'):
    cols = ''.join(f'<div><h2>{t}</h2>' + ''.join(f'<a href="{h if h.startswith("http") else root + h}">{E(l)}</a>' for l, h in ls) + '</div>' for t, ls in FOOT)
    return (f'<footer class="site-foot"><nav class="site-foot-directory" aria-label="Site directory">{cols}</nav>'
            '<div class="site-foot-legal"><p>MIT © <a href="https://zumerlab.com/">Zumerlab</a></p></div></footer>')

def code(src):
    # A bare <pre>: code-blocks.js highlights it and adds the copy button, as on every other page.
    return f'<pre><code>{E(src)}</code></pre>'

def doc_head(trail, meta, title, lead, links=()):
    """The page header: breadcrumb trail, a meta line, the h1 and the lead, then optional
    (href, text) links in a row."""
    crumbs = '<span aria-hidden="true">/</span>'.join(f'<span>{E(t)}</span>' for t in trail)
    row = ''.join(f'<a href="{h}">{E(t)}</a>' for h, t in links)
    return (f'<header class="doc-head"><div class="doc-head-bar"><nav class="doc-crumbs" aria-label="Breadcrumb">{crumbs}</nav>'
            f'<span class="doc-meta">{E(meta)}</span></div><h1>{title}</h1><p class="doc-lead">{lead}</p>'
            + (f'<p class="pane-links doc-links">{row}</p>' if row else '') + '</header>')

def tag(text, tone):
    return f'<span class="tag tag-{tone}">{E(text)}</span>'

def slug(t):
    return re.sub(r'[^a-z0-9]+', '-', t.lower().replace('&', '')).strip('-')

def rel(frm, to):
    """Relative href from the page `frm` to `to`, both docs-relative: a folder ('plugins/pdf/'),
    a page ('docs/api/index.html', 'labs/x.html') or '' for the site root, with an optional
    '#fragment' on `to`. sections.py and the generators share it, so a link between a converted
    page and a generated one is computed one way."""
    base, _, frag = to.partition('#')
    folder = base == '' or base.endswith('/') or base.endswith('index.html')
    if base.endswith('index.html'): base = base[:-10]
    start = os.path.dirname(frm) if frm.endswith('.html') else frm
    href = os.path.relpath(base.rstrip('/') or '.', start.rstrip('/') or '.').replace(os.sep, '/')
    if folder: href = './' if href == '.' else href + '/'
    if frag: href = ('' if href == './' else href) + '#' + frag
    return href

def index_grid(items):
    """Tiles of (label, section, meta, href)."""
    return '<div class="index-grid">' + ''.join(
        f'<a class="sec-{s}" href="{h}"><span class="sec-dot"></span><span class="index-grid-label">{E(l)}</span><span class="index-grid-meta">{E(m)}</span></a>' for l, s, m, h in items) + '</div>'

def nav_groups(groups, placeholder, label):
    """Sidebar of a page of its own: groups of (label, section, [(href, text)]). The current
    page is the item whose href is './'; its group starts open and the others closed. An index
    page, which is current in no group, shows every group open."""
    here = any(h == './' for _, _, items in groups for h, _ in items)
    out = []
    for glabel, sec, items in groups:
        links = ''.join(f'<a href="{h}"{CUR if h == "./" else ""}>{E(t)}</a>' for h, t in items)
        open_ = not here or any(h == './' for h, _ in items)
        out.append(f'<div class="sec-{sec}"><button type="button" class="pane-nav-head" aria-expanded="{str(open_).lower()}"><span class="sec-dot"></span>{E(glabel)}</button><div class="pane-nav-items">{links}</div></div>')
    return (f'<aside class="pane-side"><label class="pane-filter"><span aria-hidden="true">⌕</span><input type="search" placeholder="{placeholder}" aria-label="{placeholder}"></label>'
            f'<nav class="pane-nav" aria-label="{label}">{"".join(out)}</nav></aside>')

def pager(prev, nxt):
    """Previous and Next as (href, label); either may be None."""
    out = '<nav class="pager" aria-label="Pages">'
    if prev: out += f'<a href="{prev[0]}"><span>Previous</span><strong>{E(prev[1])}</strong></a>'
    if nxt: out += f'<a class="is-next" href="{nxt[0]}"><span>Next</span><strong>{E(nxt[1])}</strong></a>'
    return out + '</nav>'

def meta(title, description, path, kind='WebPage', extra=None):
    """The <head> block every generated page shares: title, description, canonical, social cards and JSON-LD."""
    url = SITE + path
    ld = {'@context': 'https://schema.org', '@type': kind, 'name': title, 'description': description, 'url': url,
          'isPartOf': {'@type': 'WebSite', 'name': 'SnapDOM', 'url': SITE}}
    if kind == 'TechArticle': ld['headline'] = title
    if extra: ld.update(extra)
    return f'''  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{E(title)}</title>
  <meta name="description" content="{E(description)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="{url}">
  <link rel="help" type="text/plain" href="{SITE}llms.txt" title="LLM summary">
  <link rel="help" type="text/plain" href="{SITE}llms-full.txt" title="LLM full reference">
  <meta property="og:type" content="website">
  <meta property="og:title" content="{E(title)}">
  <meta property="og:description" content="{E(description)}">
  <meta property="og:url" content="{url}">
  <meta property="og:image" content="{SITE}assets/og-card.jpg">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">
  {json.dumps(ld, indent=2, ensure_ascii=False)}
  </script>'''

def demo_panel(target=None):
    return DEMO.replace('{target}', target or SAMPLE)

DEMO = '''<div class="pane-demo"><section class="demo-panel sec-capture" aria-label="Live demo">
<header class="demo-panel-head"><span class="demo-panel-title">Try it here<span class="demo-panel-sub"></span></span><button type="button" class="demo-act is-primary" data-act="run">Run</button><button type="button" class="demo-act" data-act="baseline" hidden>Baseline</button><button type="button" class="demo-act" data-act="compare" hidden>Compare</button><button type="button" class="demo-act" data-act="reset">Reset</button></header>
<div class="demo-panel-body"><p class="demo-label">Live element</p>
{target}<p class="demo-label" data-result-label>Result</p><div data-results><div class="demo-empty">Nothing captured yet</div></div><p class="demo-note"></p></div>
<div class="demo-panel-status" role="status">Edit the title, then run. This uses the real library from unpkg.</div></section></div>'''

SAMPLE = '''<div class="sample-card" data-target><div class="sample-card-kicker">Component preview</div><div class="sample-card-title" data-title contenteditable spellcheck="false">Capture an editable component</div>
<div class="sample-card-bars" aria-hidden="true"><i style="height:38%"></i><i style="height:52%"></i><i style="height:44%"></i><i style="height:70%"></i><i style="height:61%"></i><i style="height:84%"></i><i style="height:96%"></i></div>
<div class="sample-card-total"><b>1,284</b><span>+12% vs last week</span></div>
<label>Owner email<input type="email" value="ana@example.com"></label>
<p>Editable text and an open shadow root can be captured together.</p></div>
'''


def standalone(path, active, head, groups, placeholder, label, sec, title, inner, demo=None, pages='', extra_class='', scripts=''):
    """Write a page of its own: sidebar, article, then the demo panel and the pager when the
    page has a demo (without one the pager closes the article). `demo` holds the data-*
    settings panes.js reads from the article; `pages` is the pager markup."""
    root = '../' * path.count('/')
    attrs = f' data-title="{E(title)}"'
    for k, v in (demo or {}).items():
        if v is not None: attrs += f' data-{k}="{E(json.dumps(v) if isinstance(v, dict) else str(v))}"'
    classes = 'pane' + ('' if demo else ' no-demo') + (f' {extra_class}' if extra_class else '')
    tail = f'</article>\n{demo_panel()}\n{pages}\n</main>\n' if demo else f'{pages}\n</article>\n</main>\n'
    body = (f'{header(active, root)}\n<main id="main" class="{classes}" data-pane>\n{nav_groups(groups, placeholder, label)}\n\n'
            f'<article class="pane-read sec-{sec}"{attrs}>\n{inner}\n{tail}{footer(root)}{scripts}')
    doc = f'''<!DOCTYPE html>
<html lang="en">
<head>
{head}
  <link rel="icon" type="image/png" href="{root}assets/favicon/favicon-96x96.png" sizes="96x96">
  <link rel="icon" type="image/svg+xml" href="{root}assets/favicon/favicon.svg">
  <link rel="shortcut icon" href="{root}assets/favicon/favicon.ico">
  <meta name="theme-color" content="#F7F9FC">
  <link rel="stylesheet" href="{root}shared.css">
  <link rel="stylesheet" href="{root}page.css">
  <link rel="stylesheet" href="{root}navigation.css">
  <link rel="stylesheet" href="{root}panes.css">
  <script defer src="{root}site.js"></script>
  <script type="module" src="{root}panes.js"></script>
</head>
<body>
{body}
</body>
</html>
'''
    full = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    open(full, 'w').write(doc)

for name in ('plugins.py', 'tools.py', 'ecosystem.py', 'sections.py'):
    exec(open(os.path.join(HERE, name)).read())

exec(open(os.path.join(HERE, 'finish.py')).read(), {'__file__': os.path.join(HERE, 'finish.py')})

exec(open(os.path.join(HERE, 'metadata.py')).read(), {'__file__': os.path.join(HERE, 'metadata.py')})
