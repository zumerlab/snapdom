# The SnapStudio page, /snapstudio/: the Chrome extension that puts SnapDOM and its plugins
# behind a side panel. It is released from its own repository to the Chrome Web Store; the
# screenshots under docs/assets/snapstudio/ are that listing's (store/ in the extension's
# repository), so re-export them from there when the listing's change. The privacy policy at
# /snapstudio/privacy/ is a hand-written page the store links to; keep its address.
STUDIO_STORE = 'https://chromewebstore.google.com/detail/snapstudio/alhbgenkncnogdpfgjbldjgohhfodohm'
PATH = 'snapstudio/index.html'
SHOTS = [('1-open', 'Open it beside the page', 'The panel opens next to the page and the picker follows the pointer.'),
         ('2-region', 'Pick what you want', 'One element, a region you drag, what is on screen or the full page.'),
         ('3-png', 'Choose the output', 'An image at up to 4×, a PDF, an editable SVG, Figma layers, a GIF or a video.'),
         ('4-card', 'Turn it into a card', 'A recipe adds the frame, the background and the shadow in one click.'),
         ('5-saved', 'Save or copy', 'The file is saved, and History keeps it so you can get it again.')]
CAN = ['<strong>Capture</strong> one element, a region, what is on screen or the full page. While picking, the up arrow moves to the parent element.',
       '<strong>Export</strong> PNG, JPEG, WebP or SVG; a PDF with selectable text and working links; HTML with its styles; an editable SVG or a paste into Figma; a GIF or a video recorded while you use the page.',
       '<strong>Tidy up first</strong>: leave elements out by clicking them, add a frame, apply a filter, stamp the date, replace text, or mask what was typed in form fields.',
       '<strong>Recipes</strong> are complete setups for common jobs, and you can save your own. The search box finds any setting by name.',
       '<strong>Timed capture</strong> waits so you can open a menu or a tooltip before the picture is taken.',
       '<strong>History</strong> keeps what you copied or saved, on your device, and saves it again in another image type.']

inner = doc_head(['Ecosystem', 'SnapStudio'], 'Chrome extension · free', 'Capture any part of a web page, without writing code.',
                 'SnapStudio is the official browser extension of SnapDOM. Click what you want on any page, choose an output and save it. The capture is made inside your browser by the same engine this site documents.')
inner += ('<div class="pane-content pane-prose">'
          f'<p class="studio-cta"><a class="pane-button studio-add" href="{STUDIO_STORE}" target="_blank" rel="noopener">Add to Chrome</a>'
          '<span>Free. No account. Nothing is uploaded.</span></p>'
          f'<a class="studio-hero" href="{STUDIO_STORE}" target="_blank" rel="noopener"><img src="{rel(PATH, "assets/snapstudio/")}marquee.webp" width="1400" height="560" alt="SnapStudio: capture any part of a web page" decoding="async"></a>')
inner += '<h2>How it works</h2><ol class="studio-shots">' + ''.join(
    f'<li><a href="{rel(PATH, "assets/snapstudio/")}{f}.webp"><img src="{rel(PATH, "assets/snapstudio/")}{f}.webp" width="1280" height="800" loading="lazy" decoding="async" alt="{E(t)}: {E(d)}"></a>'
    f'<h3>{i + 1} · {E(t)}</h3><p>{E(d)}</p></li>' for i, (f, t, d) in enumerate(SHOTS)) + '</ol>'
inner += '<p><kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd> opens SnapStudio from the keyboard. It needs Chrome 116 or newer.</p>'
inner += '<h2>What you can do</h2><ul class="pane-list">' + ''.join(f'<li>{c}</li>' for c in CAN) + '</ul>'
inner += ('<h2>From a capture to code</h2>'
          f'<p>The <code>&lt;&gt;</code> button shows the current capture as SnapDOM code, with the options and plugins you chose, ready to paste into your project. '
          f'Set a capture up by hand in the panel, then keep it as a call to <a href="{rel(PATH, "docs/api/")}">the API</a> with <a href="{rel(PATH, "plugins/")}">the same plugins</a>.</p>')
inner += ('<h2>Privacy and permissions</h2>'
          '<p>SnapStudio collects no data. It has no server, no account and no analytics; your settings and recent captures stay on your device.</p>'
          '<p>It gets access to a tab when you click its icon there, and only there. “Allow on every site” is optional: it keeps the panel working when the tab moves to another site, '
          'and lets captures include pictures hosted on other sites.</p>'
          f'<p class="pane-links"><a href="{rel(PATH, "snapstudio/privacy/")}">Privacy policy</a><a href="{STUDIO_STORE}">Chrome Web Store</a><a href="mailto:hello@zumerlab.com">hello@zumerlab.com</a></p></div>')
SIDE = [('SnapStudio', 'capture', [('./', 'Overview'), (rel(PATH, 'snapstudio/privacy/'), 'Privacy policy')]),
        ('Tools', 'ecosystem', [(rel(PATH, f'tools/{t["slug"]}/'), t['name']) for t in TOOLS] + [(rel(PATH, 'ecosystem/'), 'How they fit together')]),
        ('Plugins', 'export', [(rel(PATH, 'plugins/'), 'All plugins')] + [(rel(PATH, f'plugins/{s}/'), n) for s, n, _, _ in OWN_PAGE])]
LD = {'applicationCategory': 'BrowserApplication', 'operatingSystem': 'Chrome', 'installUrl': STUDIO_STORE, 'sameAs': [STUDIO_STORE],
      'image': SITE + 'assets/snapstudio/marquee.webp', 'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'USD'},
      'publisher': {'@type': 'Organization', 'name': 'Zumerlab', 'url': 'https://zumerlab.com/'}}
standalone(PATH, 'SnapStudio', meta('SnapStudio: the SnapDOM extension for Chrome',
           'Capture any part of a web page with SnapStudio, the official SnapDOM extension for Chrome. Save it as an image, a PDF, an editable SVG, a GIF or a video. Free, and nothing is uploaded.',
           'snapstudio/', 'SoftwareApplication', LD), SIDE, None, 'SnapStudio', 'capture', 'SnapStudio', inner, None,
           pager((rel(PATH, 'ecosystem/'), 'Ecosystem'), (rel(PATH, 'tools/snapdiff/'), 'SnapDiff')))
