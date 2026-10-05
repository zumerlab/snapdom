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
entries={}
for file in sorted(DOCS.rglob('*.html')):
    source=file.read_text()
    robots=re.search(r'<meta\b[^>]*name=[\"\']robots[\"\'][^>]*content=[\"\']([^\"\']+)',source,re.I)
    if robots and 'noindex' in robots[1].lower():continue
    canonical=re.search(r'<link\b[^>]*rel=[\"\']canonical[\"\'][^>]*href=[\"\']([^\"\']+)',source,re.I)
    if not canonical:continue
    url=html.unescape(canonical[1]); parsed=urlparse(url)
    if parsed.netloc!='snapdom.dev' or parsed.query or parsed.fragment:continue
    local=str(file.relative_to(ROOT))
    if local in changed:
        modified=today
        # Keep the article's modification date aligned with its sitemap entry.
        # Publication dates and untouched pages retain their existing dates.
        updated=re.sub(r'("dateModified"\s*:\s*")[^"]+("\s*)',
                       lambda match:match[1]+modified+match[2],source)
        if updated!=source:file.write_text(updated)
    else:modified=min(old.get(url,today),today)
    entries[url]=modified
result=ET.Element(f'{{{NS}}}urlset')
for url,modified in sorted(entries.items()):
    entry=ET.SubElement(result,f'{{{NS}}}url')
    ET.SubElement(entry,f'{{{NS}}}loc').text=url
    ET.SubElement(entry,f'{{{NS}}}lastmod').text=modified
ET.indent(result,space='  ')
ET.ElementTree(result).write(DOCS/'sitemap.xml',encoding='utf-8',xml_declaration=True)
with (DOCS/'sitemap.xml').open('a') as file:file.write('\n')
