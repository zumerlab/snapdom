"""Check local HTML links and fragments."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit

ROOT = Path(__file__).resolve().parents[2] / 'docs'


class Page(HTMLParser):
    def __init__(self, path):
        super().__init__()
        self.ids = set()
        self.links = []
        self.feed(path.read_text())

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            self.ids.add(attrs['id'])
        if tag == 'a' and 'name' in attrs:
            self.ids.add(attrs['name'])
        if tag == 'a' and 'href' in attrs:
            self.links.append(attrs['href'])


pages = {path: Page(path) for path in ROOT.rglob('*.html')}
failures = []
checked = 0
for path, page in pages.items():
    base = 'https://snapdom.dev/' + path.relative_to(ROOT).as_posix()
    for href in page.links:
        target = urlsplit(urljoin(base, href))
        if target.scheme not in ('http', 'https') or target.netloc not in (
                'snapdom.dev', 'www.snapdom.dev'):
            continue
        checked += 1
        destination = ROOT / unquote(target.path).lstrip('/')
        if destination.is_dir():
            destination /= 'index.html'
        reason = None
        if not destination.exists():
            reason = 'missing file'
        elif target.fragment and destination in pages:
            fragment = unquote(target.fragment)
            # HTML defines #top as the document top even without an authored id.
            if fragment.lower() != 'top' and fragment not in pages[destination].ids:
                reason = 'missing fragment'
        if reason:
            failures.append(f'{path.relative_to(ROOT)}: {href} ({reason})')

print(f'{len(pages)} HTML pages, {checked} local links, {len(failures)} failures')
for failure in failures:
    print(failure)
raise SystemExit(bool(failures))
