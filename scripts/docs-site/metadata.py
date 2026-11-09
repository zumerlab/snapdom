"""Build a sitemap from indexable canonical pages; keep real modification dates."""
from datetime import date
from pathlib import Path
import html,re,subprocess,xml.etree.ElementTree as ET
from urllib.parse import urlparse
ROOT=Path(__file__).resolve().parents[2]
DOCS=ROOT/'docs'
NS='http://www.sitemaps.org/schemas/sitemap/0.9'
ET.register_namespace('',NS)
old={}
if (DOCS/'sitemap.xml').exists():
    for entry in ET.parse(DOCS/'sitemap.xml').getroot():
        loc=entry.findtext(f'{{{NS}}}loc'); modified=entry.findtext(f'{{{NS}}}lastmod')
        if loc and modified:old[loc]=modified
changed=set(subprocess.check_output(['git','diff','--name-only','HEAD','--','docs'],cwd=ROOT,text=True).splitlines())
changed.update(subprocess.check_output(['git','ls-files','--others','--exclude-standard','docs'],cwd=ROOT,text=True).splitlines())
today=date.today().isoformat()
# The header, the footer, the sidebar, the font preload and the date stamp itself change on
# every page when the menu or the shared chrome does;
# a page whose own content is unchanged keeps its date. Check committed content too:
# a clean checkout must not depend on running this script before the content commit.
CHROME=re.compile(r'<header class="site-head">.*?</header>|<footer class="site-foot">.*?</footer>|<aside\b[^>]*class="[^"]*\bpane-side\b[^"]*"[^>]*>.*?</aside>|<nav\b[^>]*>.*?</nav>|<a\b[^>]*class="(?:site|docs)-skip"[^>]*>.*?</a>|<link rel="preload"[^>]*>',re.S)
def own(source):
    source=re.sub(r'"dateModified"\s*:\s*"[^"]+"','',source)
    # Preserve examples and scripts, including meaningful whitespace and HTML strings.
    blocks=[]
    def protect(match):
        blocks.append(match[0])
        return f'\0{len(blocks)-1}\0'
    source=re.sub(r'<(?P<raw>pre|code|script|style)\b[^>]*>.*?</(?P=raw)>',protect,source,flags=re.S)
    source=CHROME.sub('',source)
    # Heading ids and focus targets are generated navigation, not article changes.
    source=re.sub(r'\s+(?:id|tabindex|aria-current)="[^"]*"','',source)
    source=re.sub(r'\s+',' ',source).strip()
    return re.sub(r'\0(\d+)\0',lambda match:blocks[int(match[1])],source)

def revision(ref,local):
    result=subprocess.run(['git','show',f'{ref}:{local}'],cwd=ROOT,text=True,capture_output=True)
    return result.stdout if result.returncode==0 else ''

def committed_date(local,previous):
    history=subprocess.check_output(['git','log',f'--since={previous}T00:00:00','--format=%H %cs','--',local],cwd=ROOT,text=True)
    for line in history.splitlines():
        commit,modified=line.split()
        if modified<=previous:continue
        if own(revision(commit,local))!=own(revision(commit+'^',local)):
            return min(modified,today)
    return previous
entries={}
for file in sorted(DOCS.rglob('*.html')):
    source=file.read_text()
    # Redirect stubs point at another page; only destinations belong in the sitemap.
    if re.search(r'<meta\b[^>]*http-equiv=[\"\']refresh[\"\']',source,re.I):continue
    robots=re.search(r'<meta\b[^>]*name=[\"\']robots[\"\'][^>]*content=[\"\']([^\"\']+)',source,re.I)
    if robots and 'noindex' in robots[1].lower():continue
    canonical=re.search(r'<link\b[^>]*rel=[\"\']canonical[\"\'][^>]*href=[\"\']([^\"\']+)',source,re.I)
    if not canonical:continue
    url=html.unescape(canonical[1]); parsed=urlparse(url)
    if parsed.netloc!='snapdom.dev' or parsed.query or parsed.fragment:continue
    local=str(file.relative_to(ROOT))
    modified=committed_date(local,min(old.get(url,today),today))
    if local in changed:
        if own(revision('HEAD',local))!=own(source):modified=today
    # Publication dates stay intact; modification dates also converge on clean checkouts.
    updated=re.sub(r'("dateModified"\s*:\s*")[^"]+("\s*)',
                   lambda match:match[1]+modified+match[2],source)
    if updated!=source:file.write_text(updated)
    entries[url]=modified
result=ET.Element(f'{{{NS}}}urlset')
for url,modified in sorted(entries.items()):
    entry=ET.SubElement(result,f'{{{NS}}}url')
    ET.SubElement(entry,f'{{{NS}}}loc').text=url
    ET.SubElement(entry,f'{{{NS}}}lastmod').text=modified
ET.indent(result,space='  ')
ET.ElementTree(result).write(DOCS/'sitemap.xml',encoding='utf-8',xml_declaration=True)
with (DOCS/'sitemap.xml').open('a') as file:file.write('\n')
