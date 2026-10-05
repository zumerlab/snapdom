"""Refresh shared chrome and the search index after generating the content pages."""
from pathlib import Path
import html, json, re
ROOT = Path(__file__).resolve().parents[2] / 'docs'
ns = {'__file__': str(Path(__file__).with_name('build.py'))}
exec(Path(__file__).with_name('build.py').read_text().split("for name in ('capabilities.py'")[0], ns)

def scope_css(css):
    # Walk nested media rules while leaving keyframes intact.
    output = ''; cursor = 0
    while cursor < len(css):
        brace = css.find('{', cursor)
        if brace < 0: return output + css[cursor:]
        depth = 1; end = brace + 1
        while end < len(css) and depth:
            if css[end] == '{': depth += 1
            elif css[end] == '}': depth -= 1
            end += 1
        prefix = css[cursor:brace]
        comments = ''.join(re.findall(r'/\*.*?\*/', prefix, re.S))
        selector = re.sub(r'/\*.*?\*/', '', prefix, flags=re.S).strip()
        inner = css[brace+1:end-1]
        if selector.startswith('@media') or selector.startswith('@supports'):
            inner = scope_css(inner)
        elif not selector.startswith('@'):
            selector = ', '.join(x.strip() if x.strip() in (':root','html','body','*','::selection') else '.product-content ' + x.strip() for x in selector.split(','))
        output += comments + '\n' + selector + '{' + inner + '}'
        cursor = end
    return output

for p in ROOT.rglob('*.html'):
    s = p.read_text(); root = '../' * (len(p.relative_to(ROOT).parts)-1)
    if 'pro' in p.relative_to(ROOT).parts and 'product-content' not in s and 'plugin-page' not in s:
        s = re.sub(r'<style>(.*?)</style>', lambda m: '<style>' + scope_css(m[1]) + '</style>', s, flags=re.S)
        s = s.replace('</head>', f'<link rel="stylesheet" href="{root}shared.css"><link rel="stylesheet" href="{root}navigation.css"><link rel="stylesheet" href="{root}product.css"><script defer src="{root}site.js"></script></head>')
        s = s.replace('<body>', '<body>' + ns['header']('Plugins',root) + '<div class="product-content">', 1)
        s = s.replace('</body>', '</div>' + ns['footer'](root) + '</body>')
        s = re.sub(r'<div class="bar">.*?</div>', '', s, flags=re.S)
    s = re.sub(r'<div class="pane-toc">.*?</div>', '', s, flags=re.S)
    s = s.replace('plugins.html#playground', 'playground/')
    # Source examples and inline JS are reference content, not navigation labels.
    parts = re.split(r'(<(?:pre|code|script)\b[^>]*>.*?</(?:pre|code|script)>)', s, flags=re.S)
    for i in range(0,len(parts),2):
        parts[i] = re.sub(r'\s*[←→↗]\s*', ' ', parts[i])
    s=''.join(parts)
    if '<script type="importmap"' not in s.split('</head>')[0]:
        imports={'@zumer/snapdom':'https://unpkg.com/@zumer/snapdom@latest/dist/snapdom.mjs','@zumer/snapdom/plugins':'https://unpkg.com/@zumer/snapdom@latest/dist/snapdom.mjs'}
        s=s.replace('<head>','<head><script type="importmap">'+json.dumps({'imports':imports})+'</script>',1)
    s=re.sub(r'<script\b[^>]*src="[^"]*(?:copy-code|code-blocks)\.js[^"]*"[^>]*></script>','',s)
    if 'code.css' not in s:
        s=s.replace('</head>',f'<link rel="stylesheet" href="{root}code.css"><script defer data-manual src="{root}assets/prism/prism.min.js"></script><script defer src="{root}code-blocks.js"></script></head>')
    else:
        s=s.replace('</head>',f'<script defer src="{root}code-blocks.js"></script></head>')
    p.write_text('\n'.join(line.rstrip() for line in s.split('\n')))

index=[]
for p in ROOT.rglob('*.html'):
    s=p.read_text()
    title=re.search(r'<title>(.*?)</title>',s,re.S)
    if not title: continue
    body=re.search(r'<(?:article|main)\b[^>]*>(.*?)</(?:article|main)>',s,re.S)
    text=(body[1] if body else s)
    text=re.sub(r'<(?:script|style)\b[^>]*>.*?</(?:script|style)>','',text,flags=re.S)
    text=html.unescape(re.sub(r'<[^>]+>',' ',text))
    text=re.sub(r'\s+',' ',text).strip()
    path=str(p.relative_to(ROOT))
    if path.endswith('index.html'): path=path[:-10] or './'
    index.append({'title':html.unescape(title[1]),'path':path,'text':text})
    for match in re.finditer(r'<section class="pane-topic[^"]*"([^>]*)>(.*?)</section>',s,re.S):
        attrs,content=match.groups()
        topic_id=re.search(r'id="([^"]+)"',attrs)
        topic_title=re.search(r'data-title="([^"]+)"',attrs)
        if topic_id and topic_title:
            content=html.unescape(re.sub(r'<[^>]+>',' ',content))
            index.append({'title':html.unescape(topic_title[1]),'path':path+'#'+topic_id[1],'text':re.sub(r'\s+',' ',content).strip()})
(ROOT/'search-index.json').write_text(json.dumps(index,ensure_ascii=False,separators=(',',':'))+'\n')
