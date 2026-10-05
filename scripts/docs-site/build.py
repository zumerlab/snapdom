# Builds the snapdom.dev pages that use the 3-pane template (docs/panes.css, docs/panes.js).
#   python3 scripts/docs-site/build.py
# capabilities.py and ecosystem.py write their pages from data; sections.py converts the
# existing content pages (docs, how-to, guides, compare, blog, labs) in place and is
# idempotent, so it can run again after a page's content changes.
import html, json, os, re
E = html.escape
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'docs')

MENU = [
 ('Learn', [('Docs','docs/','capture','API, options and quick start'),('How-to','how-to/','start','Short recipes, one task each'),('Guides','guides/','options','React, Vue, Svelte, Angular, Lit, Next.js'),('Compare','compare/','ecosystem','SnapDOM vs html2canvas and others')]),
 ('Build', [('Capabilities','capabilities/','capture','What you can make from a capture'),('Plugins','plugins.html','export','13 official plugins'),('Playground','playground/','capture','Change settings, see the result')]),
 ('Explore', [('Showcase','showcase/','labs','Live capture demos'),('Labs','labs.html','labs','Experiments on top of captures'),('Blog','blog/','record','Notes from the team')]),
 ('Community', [('Ecosystem','ecosystem/','ecosystem','SnapDIFF, SnapEye, SnapSurf'),('Made with','made-with/','context','Projects using SnapDOM')]),
]
FOOT = [
 ('Learn', [('Documentation','docs/'),('Quick start','docs/#quick-start'),('How-to recipes','how-to/'),('Guides','guides/'),('Compare','compare/')]),
 ('Build', [('Capabilities','capabilities/'),('Plugins','plugins.html'),('Playground','playground/'),('Writing plugins','plugins.html#build-plugin')]),
 ('Explore', [('Showcase','showcase/'),('Labs','labs.html'),('Blog','blog/')]),
 ('Community', [('Ecosystem','ecosystem/'),('Made with','made-with/'),('Community plugins','plugins.html#community'),('GitHub','https://github.com/zumerlab/snapdom'),('npm','https://www.npmjs.com/package/@zumer/snapdom'),('Sponsors','https://github.com/sponsors/tinchox5')]),
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

def code(title, src):
    return (f'<div class="pane-code"><div class="pane-code-bar"><span>{E(title)}</span><button type="button" data-copy>copy</button></div>'
            f'<pre><code>{E(src)}</code></pre></div>')

def doc_head(trail, meta, title, lead):
    crumbs = '<span aria-hidden="true">/</span>'.join(f'<span>{E(t)}</span>' for t in trail)
    return (f'<header class="doc-head"><div class="doc-head-bar"><nav class="doc-crumbs" aria-label="Breadcrumb">{crumbs}</nav>'
            f'<span class="doc-meta">{E(meta)}</span></div><h1>{title}</h1><p class="doc-lead">{lead}</p></header>')

def tag(text):
    tone = 'core' if re.match('core', text, re.I) else 'experimental' if re.search('exp', text, re.I) else 'project' if re.search('separate', text, re.I) else 'plugin'
    return f'<span class="tag tag-{tone}">{E(text)}</span>'

def slug(t):
    return re.sub(r'[^a-z0-9]+', '-', t.lower().replace('&', '')).strip('-')

def index_grid(items):
    return '<div class="index-grid">' + ''.join(
        f'<a class="sec-{s}" href="#{h}"><span class="sec-dot"></span><span class="index-grid-label">{E(l)}</span><span class="index-grid-meta">{E(m)}</span></a>' for l, s, m, h in items) + '</div>'

def sidebar(groups, placeholder, label):
    out = []
    for g in groups:
        links = ''.join(f'<a href="#{i["id"]}">{E(i["t"])}</a>' for i in g['items'])
        out.append(f'<div class="sec-{g["section"]}"><button type="button" class="pane-nav-head" aria-expanded="true"><span class="sec-dot"></span>{E(g["label"])}</button><div class="pane-nav-items">{links}</div></div>')
    return (f'<aside class="pane-side"><label class="pane-filter"><span aria-hidden="true">⌕</span><input type="search" placeholder="{placeholder}" aria-label="{placeholder}"></label>'
            f'<nav class="pane-nav" aria-label="{label}">{"".join(out)}</nav></aside>')

def demo_panel(target=None):
    return DEMO.replace('{target}', target or SAMPLE)

DEMO = '''<div class="pane-demo"><section class="demo-panel sec-capture" aria-label="Live demo">
<header class="demo-panel-head"><span class="demo-panel-title">Live demo</span><button type="button" class="demo-act is-primary" data-act="run">Run</button><button type="button" class="demo-act" data-act="baseline" hidden>Baseline</button><button type="button" class="demo-act" data-act="compare" hidden>Compare</button><button type="button" class="demo-act" data-act="reset">Reset</button></header>
<div class="demo-panel-body"><p class="demo-label">Live element</p>
{target}<p class="demo-label" data-result-label>Result</p><div data-results><div class="demo-empty">Nothing captured yet</div></div><p class="demo-note"></p></div>
<footer class="demo-panel-status" role="status">Edit the title, then run. This uses the real library from unpkg.</footer></section></div>'''

SAMPLE = '''<div class="sample-card" data-target><div class="sample-card-kicker">Component preview</div><div class="sample-card-title" data-title contenteditable spellcheck="false">Capture an editable component</div>
<div class="sample-card-bars" aria-hidden="true"><i style="height:38%"></i><i style="height:52%"></i><i style="height:44%"></i><i style="height:70%"></i><i style="height:61%"></i><i style="height:84%"></i><i style="height:96%"></i></div>
<div class="sample-card-total"><b>1,284</b><span>+12% vs last week</span></div>
<label class="demo-input">Owner email<input type="email" value="ana@example.com"></label>
<p>Editable text and an open shadow root can be captured together.</p></div>
'''

COPY_JS = '''<script>
document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', () => {
  navigator.clipboard?.writeText(button.closest('.pane-code').querySelector('code').textContent)
  button.textContent = 'copied'
  setTimeout(() => { button.textContent = 'copy' }, 1400)
}))
</script>'''

def page(path, active, head_meta, groups, sections, placeholder, label):
    body = (f'{header(active)}\n<main id="main" class="pane" data-pane>\n{sidebar(groups, placeholder, label)}\n{demo_panel()}\n'
            f'<article class="pane-read">\n' + '\n'.join(sections) + '\n</article>\n</main>\n' + footer() + '\n' + COPY_JS)
    doc = f'''<!DOCTYPE html>
<html lang="en">
<head>
{head_meta}
  <link rel="icon" type="image/png" href="../assets/favicon/favicon-96x96.png" sizes="96x96">
  <link rel="icon" type="image/svg+xml" href="../assets/favicon/favicon.svg">
  <link rel="shortcut icon" href="../assets/favicon/favicon.ico">
  <meta name="theme-color" content="#F7F9FC">
  <link rel="stylesheet" href="../shared.css">
  <link rel="stylesheet" href="../page.css">
  <link rel="stylesheet" href="../navigation.css">
  <link rel="stylesheet" href="../panes.css">
  <script defer src="../site.js"></script>
  <script type="module" src="../panes.js"></script>
</head>
<body>
{body}
</body>
</html>
'''
    open(f'{OUT}/{path}', 'w').write(doc)

def topic(i, sec, inner, demo=None):
    attrs = ''
    if demo:
        for k, v in demo.items():
            if v is None: continue
            v = json.dumps(v) if isinstance(v, dict) else v
            attrs += f' data-{k}="{E(v)}"'
    return f'<section class="pane-topic sec-{sec}" id="{i["id"]}" data-title="{E(i["t"])}"{attrs}>\n{inner}\n</section>'

def build(groups, render):
    for g in groups:
        for i in g['items']:
            i.setdefault('id', slug(i['t']))
            i.setdefault('section', g['section'])
            i['group'] = g['label']
    return [render(i) for g in groups for i in g['items']]

for name in ('capabilities.py', 'ecosystem.py', 'sections.py'):
    exec(open(os.path.join(HERE, name)).read())

exec(open(os.path.join(HERE, 'finish.py')).read(), {'__file__': os.path.join(HERE, 'finish.py')})

exec(open(os.path.join(HERE, 'metadata.py')).read(), {'__file__': os.path.join(HERE, 'metadata.py')})
