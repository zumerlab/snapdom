# Converts the existing content pages into the 3-pane template, in place.
# A page keeps its URL, <head> and content. What changes:
#   - the old site header (or the new one, on a rerun) becomes the grouped header;
#   - the hero becomes a DocHeader: breadcrumb, section-coloured title, lead, text links;
#   - the content moves into the reading column, after the sidebar (every page of the
#     section, with only group and page levels) and, where set, a live demo;
#   - a Previous / Next pager and the footer directory close the page.
# Markers (<!-- pane:start --> … <!-- pane:end -->) let a rerun find what it wrote.

SAMPLE_SHADOW = SAMPLE[:SAMPLE.rindex('</div>')] + '<sd-shadow-card></sd-shadow-card></div>'
TRICKY = ('<div class="sample-card tricky-card" data-target><style>.tricky-card h4{margin:0 0 8px;font:700 19px Arial;color:#2D5BFF}'
          '.tricky-card h4::after{content:" · pseudo";color:#E63946;font-size:12px}'
          '.tricky-card .chip{display:inline-block;padding:4px 8px;margin:8px 0;background:#EEF3FF;transform:rotate(-3deg);box-shadow:4px 4px 0 #0F1E4D}</style>'
          '<h4 data-title contenteditable spellcheck="false">Hard parts</h4><div class="chip">transform + shadow</div>'
          '<sd-shadow-card></sd-shadow-card><input value="typed value" aria-label="Typed value" style="margin-top:10px;width:100%;box-sizing:border-box;padding:6px;font:13px Arial"></div>')

D = lambda **k: k  # demo settings
SECTIONS = [
 {'name':'Docs', 'menu':'Docs', 'filter':'Filter docs', 'groups':[
   ('Getting started','start',[('docs/index.html','Overview',D(demo='capture',method='toPng',label='snapdom.toPng(card)'))]),
   ('Capture API','capture',[('docs/api/index.html','API reference',D(demo='capture',method='result',label='snapdom(card)')),
                             ('docs/cache/index.html','Cache and preCapture',D(demo='capture',method='toPng',label='Repeat capture'))]),
   ('Options','options',[('docs/options/index.html','Options',D(demo='capture',method='toPng',options={'scale':2},label='{ scale: 2 }'))]),
   ('Plugins','export',[('docs/plugins/index.html','Plugin API',None)])]},
 {'name':'How-to', 'menu':'How-to', 'filter':'Filter recipes', 'groups':[
   ('Overview','start',[('how-to/index.html','How to capture the DOM',None)]),
   ('Basics','start',[('how-to/screenshot-a-div/index.html','Screenshot a div',D(demo='capture',method='toPng')),
                      ('how-to/html-to-png/index.html','Convert HTML to PNG',D(demo='capture',method='toPng')),
                      ('how-to/html-to-svg/index.html','Convert HTML to SVG',D(demo='capture',method='toSvg')),
                      ('how-to/html-to-canvas/index.html','Render HTML to Canvas',D(demo='capture',method='toCanvas')),
                      ('how-to/high-resolution-element/index.html','Capture in high resolution',D(demo='capture',method='toPng',options={'scale':3}))]),
   ('Real content','capture',[('how-to/export-dashboard-as-image/index.html','Export a dashboard',D(demo='capture',method='toPng',options={'scale':2})),
                              ('how-to/export-react-component-as-image/index.html','Export a React component',D(demo='capture',method='toPng')),
                              ('how-to/export-invoice-as-image/index.html','Export an invoice',D(demo='capture',method='toJpg',options={'quality':0.92})),
                              ('how-to/generate-social-card-from-html/index.html','Generate a social card',D(demo='capture',method='toPng')),
                              ('how-to/capture-before-pdf/index.html','Capture before a PDF',D(demo='capture',method='toCanvas',options={'scale':2})),
                              ('how-to/export-chart-as-svg/index.html','Export a chart as SVG',D(demo='capture',method='toSvg')),
                              ('how-to/save-chart-js-as-png/index.html','Save a Chart.js chart',D(demo='capture',method='toPng'))]),
   ('Special cases','ecosystem',[('how-to/capture-element-without-puppeteer/index.html','Capture without Puppeteer',D(demo='capture',method='toPng')),
                                 ('how-to/capture-shadow-dom/index.html','Capture Shadow DOM',D(demo='capture',method='toPng',target='shadow')),
                                 ('how-to/capture-full-page/index.html','Capture a full page',D(demo='capture',method='toPng')),
                                 ('how-to/capture-iframe/index.html','Capture an iframe',D(demo='capture',method='toPng',note='Captures the same-origin srcdoc frame together with its surrounding element.')),
                                 ('how-to/visual-regression-screenshot/index.html','Visual regression',D(demo='diff',label='Baseline and diff'))])]},
 {'name':'Guides', 'menu':'Guides', 'filter':'Filter frameworks', 'groups':[
   ('Overview','options',[('guides/index.html','SnapDOM in your framework',None)]),
   ('Frameworks','options',[('guides/react/index.html','React',D(demo='capture',method='toPng',label='React · toPng()')),
                            ('guides/vue/index.html','Vue',D(demo='capture',method='toPng',label='Vue · toPng()')),
                            ('guides/nextjs/index.html','Next.js',D(demo='capture',method='toPng',label='Next.js · toPng()')),
                            ('guides/svelte/index.html','Svelte',D(demo='capture',method='toPng',label='Svelte · toPng()')),
                            ('guides/angular/index.html','Angular',D(demo='capture',method='toPng',label='Angular · toPng()')),
                            ('guides/lit/index.html','Lit',D(demo='capture',method='toPng',target='shadow',label='Lit · toPng()'))])]},
 {'name':'Compare', 'menu':'Compare', 'filter':'Filter comparisons', 'groups':[
   ('Overview','ecosystem',[('compare/index.html','HTML-to-image libraries',None),('compare/live/index.html','Live benchmark',None)]),
   ('Head to head','ecosystem',[(f'compare/{lib}/index.html', 'vs ' + lib, D(demo='compare',lib=lib,target='tricky',label='SnapDOM · ' + lib,
                                  note='Judge the pixels yourself; one run is not a benchmark.'))
                                for lib in ('html2canvas','html-to-image','dom-to-image','modern-screenshot')]),
   ('Architecture','record',[('compare/puppeteer/index.html','vs Puppeteer',None),('compare/playwright/index.html','vs Playwright',None)])]},
 {'name':'Blog', 'menu':'Blog', 'filter':'Filter posts', 'groups':[
   ('Overview','record',[('blog/index.html','All posts',None)]),
   ('Posts','record',[('blog/snapdom-v3/index.html','SnapDOM v3 is out',None),
                      ('blog/dom-capture-boundaries/index.html','DOM capture boundaries',None),
                      ('blog/huge-page-mosaic/index.html','Tiled rasterization',None),
                      ('blog/painting-without-canvas/index.html','Painting without a canvas',None)])]},
 {'name':'Labs', 'menu':'Labs', 'filter':'Filter labs', 'groups':[
   ('Overview','labs',[('labs.html','All labs',None)]),
   ('Live demos','labs',[('labs/stop-motion/index.html','Stop motion',None),('labs/paint-canvas/index.html','Paint on a capture',None),
                         ('labs/capture-stages/index.html','Capture stages',None),('labs/target-range/index.html','Target range',None)]),
   ('WebGL','labs',[('labs/webgl-live-mirror/index.html','Live mirror',None),('labs/webgl-seamless-dom/index.html','Seamless DOM',None),
                    ('labs/webgl-shatter/index.html','Shattered capture',None)])]},

 {'name':'Showcase', 'menu':'Showcase', 'filter':'Filter demos', 'groups':[
   ('Showcase','labs',[('showcase/index.html','Live demos',D(badge='Showcase',
     lead='Fidelity demos and every export format. Each one runs SnapDOM on the element beside it.'))])]},
 {'name':'Community', 'menu':'Made with', 'filter':'Filter community', 'groups':[
   ('Ecosystem','ecosystem',[('ecosystem/index.html','Plugins and tools','link')]),
   ('Made with','context',[('made-with/index.html','Projects using SnapDOM',None)])]},
 {'name':'Plugins', 'menu':'Plugins', 'filter':'Filter plugins', 'groups':[
   ('Build','capture',[('capabilities/index.html','Capabilities','link')]),
   ('Plugins','export',[('plugins.html','Official plugins',D(end='<!-- ── Plugin detail modal'))]),
   ('Reference','export',[('docs/plugins/index.html','Plugin API','link')])]},
]

START, END = '<!-- pane:start -->', '<!-- pane:end -->'
TARGETS = {'shadow': SAMPLE_SHADOW, 'tricky': TRICKY}

def strip_tags(s):
    return html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', s)).strip())

def rel(frm, to):
    """Relative href from page `frm` to page `to` (both docs-relative file paths)."""
    href = os.path.relpath(to, os.path.dirname(frm) or '.').replace(os.sep, '/')
    return href[:-len('index.html')] or './' if href.endswith('index.html') else href

def no_arrows(s):
    # The design drops arrow glyphs from link text; code samples keep theirs.
    s = re.sub(r'\s*<span class="arrow"[^>]*>\s*→\s*</span>', '', s)
    return re.sub(r'\s*→\s*(</a>)', r'\1', s)

def heading_ids(body):
    seen = set()
    def add(m):
        attrs, inner = m.group(1) or '', m.group(2)
        found = re.search(r'id="([^"]+)"', attrs)
        hid = found.group(1) if found else slug(strip_tags(inner))[:60]
        while hid in seen: hid += '-2'
        seen.add(hid)
        return (m.group(0) if found else f'<h2 id="{hid}"{attrs}>{inner}</h2>'), hid, strip_tags(inner)
    heads = []
    def sub(m):
        html_, hid, text = add(m)
        heads.append((hid, text))
        return html_
    body = re.sub(r'<h2(\s[^>]*)?>(.*?)</h2>', sub, body, flags=re.S)
    return body, heads

def body_region(src, start, end_marker):
    """(start, end, inner) of the page body after `start`: its <main>, or up to `end_marker`."""
    if end_marker:
        end = src.index(end_marker, start)
        return start, end, src[start:end]
    m = re.search(r'<main\b[^>]*>(.*?)</main>', src[start:], re.S)
    return start + m.start(), start + m.end(), m.group(1)

def extract(src, opts):
    """Return (before, between, hero, content, after, toc) of an old-style or converted page."""
    if START in src:
        before, rest = src.split(START, 1)
        block, after = rest.split(END, 1)
        hero = json.loads(re.search(r'<!-- hero (.*?) -->', block, re.S).group(1))
        content = block.split('<!-- content -->', 1)[1].split('<!-- /content -->', 1)[0]
        return before, '', hero, content, after, hero.get('toc')
    head_m = re.search(r'<header class="site-shell">.*?</header>', src, re.S)
    rest = src[head_m.end():]
    hero_m = re.search(r'<section class="hero[^"]*"[^>]*>.*?</section>', rest, re.S)
    menu_m = re.search(r'<div id="menu-container">.*?</nav>\s*</div>', rest, re.S)
    toc = None
    if hero_m:
        hero_html = hero_m.group(0)
        cut = (head_m.end() + hero_m.start(), head_m.end() + hero_m.end())
    elif menu_m:
        # Showcase: its intro holds the h1 and a menu of demo anchors, which becomes the toc.
        hero_html = menu_m.group(0)
        cut = (head_m.end() + menu_m.start(), head_m.end() + menu_m.end())
        toc = [(h, strip_tags(t)) for h, t in re.findall(r'<a href="#([^"]+)">(.*?)</a>', hero_html, re.S)]
    else:
        hero_html = ''
        cut = (head_m.end(), head_m.end())
    pick = lambda pat: (re.search(pat, hero_html, re.S) or [None, ''])[1]
    actions = re.findall(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', pick(r'<div class="hero-actions">(.*?)</div>'), re.S)
    hero = {'badge': strip_tags(pick(r'<div class="hero-badge">(.*?)</div>')) or opts.get('badge', ''),
            'title': opts.get('title_html') or pick(r'<h1[^>]*>(.*?)</h1>').strip(),
            'lead': opts.get('lead') or (pick(r'<p class="lead"[^>]*>(.*?)</p>') or pick(r'<p>(.*?)</p>')).strip(),
            'links': [(h, strip_tags(t).replace('→', '').strip()) for h, t in actions]}
    start, end, content = body_region(src, cut[1], opts.get('end'))
    if not hero_html:
        # A page without a hero opens its main with breadcrumbs, the h1 and a first paragraph.
        content = re.sub(r'\s*<p class="crumbs">.*?</p>', '', content, count=1, flags=re.S)
        h1 = re.search(r'<h1[^>]*>(.*?)</h1>\s*(<p>(.*?)</p>)?', content, re.S)
        hero.update(title=h1.group(1).strip(), lead=(h1.group(3) or '').strip())
        content = content[:h1.start()] + content[h1.end():]
    if toc: hero['toc'] = toc
    between = src[head_m.end():cut[0]] + src[cut[1]:start]
    after = re.sub(r'<footer\b.*?</footer>', '', src[end:], flags=re.S)
    return src[:head_m.start()], between, hero, content, after, toc

def convert(section, gi, path, title, demo, flat):
    full = os.path.join(OUT, path)
    src = open(full).read()
    opts = demo or {}
    before, between, hero, content, after, toc = extract(src, opts)
    root = '../' * path.count('/')
    content, heads = heading_ids(no_arrows(content))
    heads = toc or heads
    if not opts.get('demo'): demo = None
    label, sec, _ = section['groups'][gi]

    side = []
    for glabel, gsec, items in section['groups']:
        links = ''
        for p, t, _ in items:
            here = p == path
            links += f'<a href="{rel(path, p)}"{CUR if here else ""}>{E(t)}</a>'
        open_ = any(p == path for p, _, _ in items)
        side.append(f'<div class="sec-{gsec}"><button type="button" class="pane-nav-head" aria-expanded="{str(open_).lower()}"><span class="sec-dot"></span>{E(glabel)}</button><div class="pane-nav-items">{links}</div></div>')
    sidebar_html = (f'<aside class="pane-side"><label class="pane-filter"><span aria-hidden="true">⌕</span><input type="search" placeholder="{section["filter"]}" aria-label="{section["filter"]}"></label>'
                    f'<nav class="pane-nav" aria-label="{section["name"]}">{"".join(side)}</nav></aside>')

    i = [p for p, _, _ in flat].index(path)
    pager = '<nav class="pager" aria-label="Pages">'
    if i > 0: pager += f'<a href="{rel(path, flat[i-1][0])}"><span>Previous</span><strong>{E(flat[i-1][1])}</strong></a>'
    if i < len(flat) - 1: pager += f'<a class="is-next" href="{rel(path, flat[i+1][0])}"><span>Next</span><strong>{E(flat[i+1][1])}</strong></a>'
    pager += '</nav>'

    trail = [section['name']] + ([label] if label not in ('Overview', title, section['name']) else []) + [title]
    crumbs = '<span aria-hidden="true">/</span>'.join(f'<span>{E(t)}</span>' for t in trail)
    links = ''.join(f'<a href="{h}">{E(t)}</a>' for h, t in hero['links'])
    doc_header = (f'<header class="doc-head"><div class="doc-head-bar"><nav class="doc-crumbs" aria-label="Breadcrumb">{crumbs}</nav>'
                  f'<span class="doc-meta">{E(hero["badge"])}</span></div><h1>{hero["title"]}</h1>'
                  + (f'<p class="doc-lead">{hero["lead"]}</p>' if hero['lead'] else '')
                  + (f'<p class="pane-links doc-links">{links}</p>' if links else '') + '</header>')

    attrs = f' data-title="{E(title)}"'
    if demo:
        for k, v in demo.items():
            if k in ('target', 'label', 'end', 'badge', 'lead', 'title_html'): continue
            attrs += f' data-{k}="{E(json.dumps(v) if isinstance(v, dict) else str(v))}"'
        attrs += f' data-demo-label="{E(demo.get("label", title))}"'
    demo_html = demo_panel(TARGETS.get(demo.get('target'))) if demo else ''

    hero_json = json.dumps(hero).replace('--', '-\\u002d')  # "--" would end the comment
    block = (f'{START}<!-- hero {hero_json} -->\n{header(section["menu"], root)}{between}\n'
             f'<main id="main" class="pane{"" if demo else " no-demo"}" data-pane>\n{sidebar_html}\n{demo_html}\n'
             f'<article class="pane-read sec-{sec}"{attrs}>\n{doc_header}\n<div class="pane-content"><!-- content -->{content}<!-- /content --></div>\n{pager}\n</article>\n</main>\n'
             f'{footer(root)}\n{END}')
    out = before + block + after
    # The old header's star counter had its own small fetch script; site.js fills
    # [data-star-count] now. Only short scripts are removed, never page logic.
    out = re.sub(r'\s*<script>((?:(?!</script>).)*)</script>',
                 lambda m: '' if "getElementById('star-count')" in m.group(1) and len(m.group(1)) < 700 else m.group(0), out, flags=re.S)
    links_css = ''.join(f'<link rel="stylesheet" href="{root}{n}">' for n in ('navigation.css', 'panes.css') if f'{root}{n}"' not in out)
    out = out.replace('</head>', f'  {links_css}\n  <script type="module" src="{root}panes.js"></script>\n</head>', 1) if links_css else out
    open(full, 'w').write(out)

for section in SECTIONS:
    flat = [(p, t, d) for _, _, items in section['groups'] for p, t, d in items]
    for gi, (_, _, items) in enumerate(section['groups']):
        for p, t, d in items:
            if d != 'link':
                convert(section, gi, p, t, d, flat)
