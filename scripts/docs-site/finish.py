"""Refresh shared chrome and the search index after generating the content pages."""
from pathlib import Path
import argparse, html, json, re
ROOT = Path(__file__).resolve().parents[2] / 'docs'
parser = argparse.ArgumentParser(description=__doc__)
mode = parser.add_mutually_exclusive_group()
mode.add_argument('--index-only', action='store_true', help='Only rebuild search-index.json; leave HTML and metadata untouched.')
mode.add_argument('--navigation-only', action='store_true', help='Refresh reading navigation and search; leave head and shared chrome untouched.')
args = parser.parse_args()

ns = {'__file__': str(Path(__file__).with_name('build.py'))}
exec(Path(__file__).with_name('build.py').read_text().split("for name in ('plugins.py'")[0], ns)

if not args.index_only:
    for p in ROOT.rglob('*.html'):
        s = p.read_text(); root = '../' * (len(p.relative_to(ROOT).parts)-1)
        # Downloadable fixtures must remain self-contained when served outside docs.
        if 'data-standalone-fixture' in s: continue
        # Redirect stubs (the old /playground/) stay bare and out of the search index.
        if 'http-equiv="refresh"' in s: continue
        if args.navigation_only:
            p.write_text(ns['page_navigation'](s, p.relative_to(ROOT).as_posix()))
            continue
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
        s = ns['page_navigation'](s, p.relative_to(ROOT).as_posix())
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

def plain(s):
    s = re.sub(r'<(?:script|style)\b[^>]*>.*?</(?:script|style)>', '', s, flags=re.S)
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s))).strip()

index=[]
for p in sorted(ROOT.rglob('*.html')):
    s=p.read_text()
    # Redirect stubs and framed fixtures are not destinations of their own.
    if 'http-equiv="refresh"' in s or 'data-standalone-fixture' in s: continue
    title=re.search(r'<title>(.*?)</title>',s,re.S)
    if not title: continue
    content=reading(s)
    text=plain(content)
    path=str(p.relative_to(ROOT))
    if path.endswith('index.html'): path=path[:-10] or './'
    page={'title':plain(title[1]),'path':path,'text':text}
    parts=path.strip('/').split('/')
    if len(parts)==2 and parts[0] in ('plugins', 'tools', 'guides', 'compare', 'how-to'):
        page.update(kind='page',symbols=[parts[1], parts[1].replace('-', ' ')])
    index.append(page)
    heading=re.search(r'<h1\b[^>]*>(.*?)</h1>',content,re.S)
    context=plain(heading[1]) if heading else plain(title[1])
    headings=[head for head in ns['ReadingHeadings'](content).headings if head['id']]
    for i, section in enumerate(headings):
        end=headings[i+1]['start'] if i+1<len(headings) else len(content)
        label=section['text']
        entry={'title':label,'path':path+'#'+section['id'],
               'text':plain(content[section['end']:end]),'context':context,'kind':'section'}
        method=re.match(r'(?:snapdom\.)?(\w+)\(',label)
        if method:
            entry.update(kind='method',symbols=[method[1], 'snapdom.'+method[1]])
        index.append(entry)
    # Reference rows provide exact symbols and a direct destination, rather than a
    # match somewhere inside a full API/options page. Detail links take precedence.
    for row in re.finditer(r'<tr\b[^>]*>(.*?)</tr>',content,re.S):
        cells=re.findall(r'<td\b[^>]*>(.*?)</td>',row[1],re.S)
        if not cells: continue
        label=plain(cells[0])
        row_id=re.search(r'^<tr\b[^>]*\bid="([^"]+)"',row[0])
        detail=re.search(r'<a\b[^>]*href="#([^"]+)"',cells[0])
        anchor=detail[1] if detail else row_id[1] if row_id else None
        if path=='docs/options/' and row_id and row_id[1].startswith('option-'):
            symbols=[symbol.strip() for symbol in label.split('/')]
            kind='option'
        elif path=='docs/api/' and label.startswith('snapdom.'):
            name=label.split('(',1)[0].removeprefix('snapdom.')
            if not anchor and name in ('plugins', 'preCapture', 'version'): anchor='top-level'
            if not anchor and name=='download': anchor='download'
            symbols=[name, 'snapdom.'+name]
            kind='method'
        else: continue
        if not anchor: continue
        index.append({'title':label,'path':path+'#'+anchor,'text':plain(' '.join(cells[1:])),
                      'context':context,'kind':kind,'symbols':symbols})
(ROOT/'search-index.json').write_text(json.dumps(index,ensure_ascii=False,separators=(',',':'))+'\n')
