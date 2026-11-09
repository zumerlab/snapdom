"""Refresh shared chrome and the search index after generating the content pages."""
from pathlib import Path
import html, json, re
ROOT = Path(__file__).resolve().parents[2] / 'docs'
ns = {'__file__': str(Path(__file__).with_name('build.py'))}
exec(Path(__file__).with_name('build.py').read_text().split("for name in ('plugins.py'")[0], ns)

for p in ROOT.rglob('*.html'):
    s = p.read_text(); root = '../' * (len(p.relative_to(ROOT).parts)-1)
    # Downloadable fixtures must remain self-contained when served outside docs.
    if 'data-standalone-fixture' in s: continue
    # Redirect stubs (the old /playground/) stay bare and out of the search index.
    if 'http-equiv="refresh"' in s: continue
    s = re.sub(r'<div class="pane-toc">.*?</div>', '', s, flags=re.S)
    # Every page gets the current menu and footer, keeping its active item. Pages
    # that were folded into another keep pointing at the page that absorbed them.
    head = re.search(r'<header class="site-head">.*?</header>', s, re.S)
    if head:
        cur = re.search(r'aria-current="page"><span class="sec-dot"></span><span class="site-nav-item-label">([^<]+)<', head[0])
        cur = cur[1] if cur else ''
        cur = {'Labs': 'Showcase', 'Guides': 'How-to', 'Capabilities': 'Showcase', 'Playground': 'Showcase'}.get(cur, cur)
        s = s[:head.start()] + ns['header'](cur, root) + s[head.end():]
    s = re.sub(r'<footer class="site-foot">.*?</footer>', lambda m: ns['footer'](root), s, count=1, flags=re.S)
    # Source examples and inline JS are reference content, not navigation labels.
    parts = re.split(r'(<(?:pre|code|script)\b[^>]*>.*?</(?:pre|code|script)>)', s, flags=re.S)
    for i in range(0,len(parts),2):
        parts[i] = re.sub(r'\s*[←→↗]\s*', ' ', parts[i])
    s=''.join(parts)
    if '<script type="importmap"' not in s.split('</head>')[0]:
        imports={'@zumer/snapdom':'https://unpkg.com/@zumer/snapdom@latest/dist/snapdom.mjs','@zumer/snapdom/plugins':'https://unpkg.com/@zumer/snapdom@latest/dist/snapdom.mjs'}
        s=s.replace('<head>','<head><script type="importmap">'+json.dumps({'imports':imports})+'</script>',1)
    s=re.sub(r'<script\b[^>]*src="[^"]*(?:copy-code|code-blocks)\.js[^"]*"[^>]*></script>','',s)
    # The text face is fetched with the stylesheet, not after it, so the first paint has it.
    if 'shared.css' in s and 'fonts/roboto.woff2' not in s:
        s=s.replace('</head>',f'<link rel="preload" href="{root}assets/fonts/roboto.woff2" as="font" type="font/woff2" crossorigin></head>',1)
    if 'code.css' not in s:
        s=s.replace('</head>',f'<link rel="stylesheet" href="{root}code.css"><script defer data-manual src="{root}assets/prism/prism.min.js"></script><script defer src="{root}code-blocks.js"></script></head>')
    else:
        s=s.replace('</head>',f'<script defer src="{root}code-blocks.js"></script></head>')
    p.write_text('\n'.join(line.rstrip() for line in s.split('\n')))

def reading(s):
    """The text a page is searched by: the reading column of a pane page, nested articles
    included, or the first article or main of an older page. The sidebar and the pager are
    navigation, so a plugin's name must not match every page whose sidebar lists it."""
    m = re.search(r'<article\b[^>]*\bpane-read\b[^>]*>', s)
    if m:
        depth, end = 1, len(s)
        for t in re.finditer(r'<article\b|</article>', s[m.end():]):
            depth += 1 if t[0] == '<article' else -1
            if not depth: end = m.end() + t.start(); break
        text = s[m.end():end]
    else:
        body = re.search(r'<(?:article|main)\b[^>]*>(.*?)</(?:article|main)>', s, re.S)
        text = body[1] if body else s
    return re.sub(r'<nav class="pager".*?</nav>', '', text, flags=re.S)

index=[]
for p in ROOT.rglob('*.html'):
    s=p.read_text()
    # Redirect stubs and framed fixtures are not destinations of their own.
    if 'http-equiv="refresh"' in s or 'data-standalone-fixture' in s: continue
    title=re.search(r'<title>(.*?)</title>',s,re.S)
    if not title: continue
    text=re.sub(r'<(?:script|style)\b[^>]*>.*?</(?:script|style)>','',reading(s),flags=re.S)
    text=html.unescape(re.sub(r'<[^>]+>',' ',text))
    text=re.sub(r'\s+',' ',text).strip()
    path=str(p.relative_to(ROOT))
    if path.endswith('index.html'): path=path[:-10] or './'
    index.append({'title':html.unescape(title[1]),'path':path,'text':text})
(ROOT/'search-index.json').write_text(json.dumps(index,ensure_ascii=False,separators=(',',':'))+'\n')
