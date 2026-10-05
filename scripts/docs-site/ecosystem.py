ECO = [
 {'label':'Overview','section':'ecosystem','items':[{'t':'Plugins and tools','id':'overview','overview':True}]},
 {'label':'Extend a capture','section':'export','items':[
  {'t':'Official plugins','sub':'The optional plugin package.','lead':'Prepare captured content with filters, timestamps, text replacement, private-field masking and tint. Add HTML snapshots, ASCII art, GIF, video, text or JSON context and annotated element maps. PDF belongs to this package too.','go':('Browse all plugins','../plugins.html#official'),'demo':'capture'},
  {'t':'PDF','sub':'Document export · official plugin.','lead':'Turn captured HTML into paginated documents with selectable text, links, bookmarks and optional form fields. This is the exporter previously offered as PDF Pro.','note':'The updated plugin package is prepared locally and has not been published yet.','go':('Open the PDF page','../pro/pdf/'),'demo':'capture'},
  {'t':'Vector','sub':'Editable artwork · vector plugin.','lead':'Reconstruct text and supported shapes as editable SVG artwork or Figma content. Core SVG preserves HTML through foreignObject; Vector converts supported content into vector elements.','note':'Vector is prepared locally in @zumer/snapdom-plugins/vector and has not been published yet.','go':('Open the Vector page','../pro/vector/'),'demo':'capture'},
  {'t':'Community plugins','sub':'Share your own extension.','lead':'Build a plugin in your own repository and submit it to the directory. Community extensions are maintained by their authors, alongside the official package.','go':('Browse community plugins','../plugins.html#community'),'demo':'capture'}]},
 {'label':'Tools','section':'ecosystem','items':[
  {'t':'SnapDIFF','sub':'Visual regression testing in the browser.','lead':'Compare captures against baselines, inspect changed pixels and use the result in a browser test suite or CI.','demo':'diff',
   'try':'Take a baseline of the card, change its title, then compare. Changed pixels turn red, the rest fades.',
   'does':['Mark elements with <code>data-snap</code> for in-page checks.','Review split, slider and diff views; approve intended changes.','Use a Vitest browser suite with disk baselines to fail CI on visual drift.'],
   'fit':'SnapEye and SnapDIFF both compare pixels. Choose SnapEye for an agent’s capture-and-inspect task; choose SnapDIFF for a maintained set of visual tests and baseline reviews.',
   'links':[('Try the SnapDIFF demo','https://zumerlab.com/snapdiff/'),('Setup and CI guide','https://github.com/zumerlab/snapdiff')]},
  {'t':'SnapEye','sub':'Visual tools for coding agents.','lead':'Capture, compare and record a local app through a CLI or page API. Give a coding agent artifacts and change regions.','demo':'pair',
   'try':'Take a baseline, change the card, then compare to get the before/after pair an agent would receive.',
   'does':['Capture an element before a change, then compare it afterward.','Locate changed regions and inspect the current and diff images.','Record a transition and review its frames, GIF or video.'],
   'fit':'SnapEye does not navigate or click. A browser driver reaches interactive states; SnapEye measures their appearance. Its visual comparison uses SnapDIFF’s diff engine.',
   'links':[('SnapEye setup and API','https://github.com/zumerlab/snapeye'),('Task recipes','https://github.com/zumerlab/snapeye/blob/main/RECIPES.md')]},
  {'t':'SnapSurf','sub':'Web navigation and verification for agents.','lead':'Navigate, locate controls, act and verify what changed. SnapSurf adds browser interaction around capture evidence.','exp':True,'demo':'map',
   'does':['Open a page, find a control, click or type, then verify.','Check changes to content, state, layout and clickability.','Assert expected changes and the absence of unwanted ones.'],
   'fit':'A semantic diff answers whether the observed page changed. It does not replace a pixel comparison against a saved visual baseline. Its managed browser has its own cookies and storage, separate from your everyday browser.',
   'links':[('SnapSurf setup and documentation','https://github.com/zumerlab/SnapSurf')]}]}]

def eco_topic(p):
    if p.get('overview'):
        cells = [(i['t'], g['section'], 'Experimental' if i.get('exp') else 'Tool' if g['label'] == 'Tools' else 'Plugin', i['id']) for g in ECO[1:] for i in g['items']]
        rows = [('Export an element as an image or file','SnapDOM core + plugins','../capabilities/'),('Check that nothing changed visually','SnapDIFF','#snapdiff'),('Give a coding agent before/after evidence','SnapEye','#snapeye'),('Let an agent reach a state and verify it','SnapSurf (experimental)','#snapsurf')]
        table = ('<div class="compare-table"><table><thead><tr><th scope="col">Job</th><th scope="col">Use</th></tr></thead><tbody>'
                 + ''.join(f'<tr><td>{a}</td><td><a href="{h}">{b}</a></td></tr>' for a, b, h in rows) + '</tbody></table></div>')
        steps = ('<ol class="pane-steps">' + ''.join(f'<li><h3>{a}</h3><p>{b}</p></li>' for a, b in [
            ('1 · Reach the state','SnapSurf opens the page and clicks Settings. Verify that the panel appeared and the controls are available.'),
            ('2 · Inspect the edit','SnapEye captures the open panel before and after the code change. Compare its appearance or record the transition.'),
            ('3 · Keep it checked','SnapDIFF adds the panel to a repeatable visual suite. Review the baseline and check future changes against it.')]) + '</ol>')
        inner = (doc_head(['Ecosystem','Overview'], 'Plugins · Tools', 'Plugins and tools built on SnapDOM.',
                 'Extend a capture with official or community plugins. Export documents with PDF, reconstruct editable artwork with Vector, or use the tools for agents and visual testing.')
                 + index_grid(cells) + '<h2>Choose by the job</h2>' + table
                 + '<h2>One settings panel, three kinds of checks</h2>' + steps
                 + '<p class="pane-para" style="margin-top:20px">Your agent or test harness connects these steps. For an already-open panel, call SnapEye’s in-page API: its URL trigger reloads the page. Keep viewport, data and state consistent, and manage each tool’s baselines separately.</p>')
        return topic(p, p['section'], inner)
    tools = p['group'] == 'Tools'
    meta = 'Experimental' if p.get('exp') else 'Separate project' if tools else '@zumer/snapdom-plugins'
    inner = doc_head(['Ecosystem', p['group'], p['t']], meta, E(p['t']), E(p['lead']))
    inner += f'<div class="provided-by"><span class="topic-sub">{E(p["sub"])}</span>{tag("Experimental") if p.get("exp") else ""}</div>'
    if p.get('note'):
        inner += f'<aside class="callout"><div class="callout-label">Status</div>{E(p["note"])}</aside>'
    if p.get('go'):
        inner += f'<a class="pane-button" href="{p["go"][1]}">{E(p["go"][0])}</a>'
    if p.get('try'):
        inner += f'<h2>Try it here</h2><p>{E(p["try"])}</p>'
    if p.get('does'):
        inner += '<h2>What it does</h2><ul class="pane-list">' + ''.join(f'<li>{d}</li>' for d in p['does']) + '</ul>'
        inner += f'<p>{E(p["fit"])}</p>'
        inner += '<p class="pane-links">' + ''.join(f'<a href="{h}">{E(l)}</a>' for l, h in p['links']) + '</p>'
    mode = p['demo']
    if mode == 'capture':
        demo = {'demo':'capture','method':'toPng','transform': {'PDF':'pdf', 'Vector':'vector'}.get(p['t'])}
    elif mode == 'map':
        demo = {'demo':'capture','method':'toPng','transform':'map','demo-label':'SnapSurf · locate controls','note':'Real agent-map output; this panel demonstrates capture annotations, not the SnapSurf browser driver.'}
    else:
        demo = {'demo':mode}
    return topic(p, 'ecosystem' if tools else p['section'], inner, demo)

ECO_META = '''  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SnapDOM Ecosystem — plugins, SnapEye, SnapSurf &amp; SnapDIFF</title>
  <meta name="description" content="Plugins and tools built on SnapDOM: official and community plugins, PDF and Vector, SnapDIFF for visual regression testing, SnapEye for coding agents and SnapSurf for browser navigation. Try each one live.">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://snapdom.dev/ecosystem/">
  <link rel="help" type="text/plain" href="https://snapdom.dev/llms.txt" title="LLM summary">
  <link rel="help" type="text/plain" href="https://snapdom.dev/llms-full.txt" title="LLM full reference">
  <meta property="og:type" content="website">
  <meta property="og:title" content="SnapDOM Ecosystem — plugins, SnapEye, SnapSurf &amp; SnapDIFF">
  <meta property="og:description" content="Extend a capture with plugins, or use the tools for agents and visual testing. What each one does and how they fit together.">
  <meta property="og:url" content="https://snapdom.dev/ecosystem/">
  <meta property="og:image" content="https://snapdom.dev/assets/og-card.jpg">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": "SnapDOM Ecosystem",
    "url": "https://snapdom.dev/ecosystem/",
    "description": "Plugins and tools built on SnapDOM: SnapEye, SnapSurf and SnapDIFF for coding agents, browser navigation and visual regression testing.",
    "isPartOf": { "@type": "WebSite", "name": "SnapDOM", "url": "https://snapdom.dev/" },
    "mainEntity": {
      "@type": "ItemList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "SnapEye", "url": "https://github.com/zumerlab/snapeye" },
        { "@type": "ListItem", "position": 2, "name": "SnapSurf", "url": "https://github.com/zumerlab/SnapSurf" },
        { "@type": "ListItem", "position": 3, "name": "SnapDIFF", "url": "https://github.com/zumerlab/snapdiff" }
      ]
    }
  }
  </script>'''

page('ecosystem/index.html', 'Ecosystem', ECO_META, ECO, build(ECO, eco_topic), 'Filter ecosystem', 'Ecosystem')
