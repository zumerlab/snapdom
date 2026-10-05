IMP = "import { snapdom } from '@zumer/snapdom';\n"
CAPS = [
 {'label':'Overview','section':'capture','items':[{'t':'What SnapDOM can do','id':'overview','overview':True}]},
 {'label':'Choose an output','section':'capture','items':[
  {'t':'Images & canvas','section':'capture','prov':'Core','fmt':'PNG · JPEG · WebP · canvas · Blob','lead':'Save a chart, dashboard or component as an image. Use canvas output as a WebGL texture.','code':"const png = await snapdom.toPng(el);\nconst canvas = await snapdom.toCanvas(el);",'demo':{'method':'toPng'},'go':('Read toPng() in Docs','../docs/api/#methods')},
  {'t':'PDF documents','section':'export','prov':'Plugin','fmt':'PDF with text, links & pages','lead':'Turn an HTML report or invoice into a searchable document. Add page breaks, bookmarks and optional fillable fields.','code':IMP+"import { pdf } from '@zumer/snapdom-plugins/pdf';\n\nconst result = await snapdom(el, { plugins: [pdf()] });\nconst file = await result.toPdf({ page: 'a4' });",'status':'The pdf plugin is prepared and not yet published in @zumer/snapdom-plugins. Run npm run site to try the local build.','demo':{'method':'toPng','transform':'pdf','note':'Exports a real PDF with the official plugin.'},'go':('Open the PDF page','../pro/pdf/')},
  {'t':'HTML snapshots','section':'export','prov':'Plugin','fmt':'A self-contained HTML file','lead':'Save the rendered markup with its styles and resources. Reopen the snapshot without rebuilding your application.','code':IMP+"import { htmlExport } from '@zumer/snapdom-plugins/html-export';\n\nconst result = await snapdom(el, { plugins: [htmlExport()] });\nconst html = await result.toHtml();",'demo':{'method':'toPng','transform':'html','note':'Self-contained HTML exported by the official plugin.'},'go':('Open the html-export plugin','../plugins.html#official')},
  {'t':'GIF & video','section':'record','prov':'Plugins','fmt':'GIF · MP4 or WebM','lead':'Record the live element over time for short animations, demos and review clips.','code':IMP+"import { gifExport } from '@zumer/snapdom-plugins/gif-export';\n\nconst result = await snapdom(el, { plugins: [gifExport()] });\nconst gif = await result.toGif({ fps: 8, duration: 1000 });",'demo':{'method':'toPng','transform':'gif','note':'Records one second of the live element with the GIF plugin. Edit the title during recording.'},'go':('Open the gif-export plugin','../plugins.html#official')},
  {'t':'Context for agents','section':'context','prov':'Plugins','fmt':'Text · JSON · annotated image','lead':'Give an agent the captured text, form state and locations of interactive elements.','code':IMP+"import { agentMap } from '@zumer/snapdom-plugins/agent-map';\n\nconst result = await snapdom(el, { plugins: [agentMap()] });\nconst map = await result.toAgentMap({ image: 'annotated' });",'demo':{'method':'toPng','transform':'map','note':'Annotated output from the agent-map plugin.'},'go':('Open the agent-map plugin','../plugins.html#official')},
  {'t':'ASCII art','section':'export','prov':'Plugin','fmt':'Plain text · coloured HTML','lead':'Represent the captured appearance with a grid of characters.','code':IMP+"import { asciiExport } from '@zumer/snapdom-plugins/ascii-export';\n\nconst result = await snapdom(el, { plugins: [asciiExport()] });\nconst text = await result.toAscii({ width: 80 });",'demo':{'method':'toCanvas','transform':'ascii'},'go':('Open the ascii-export plugin','../plugins.html#official')},
  {'t':'Vector artwork','section':'export','prov':'Plugin','fmt':'SVG shapes · Figma','lead':'Turn captured text and supported shapes into editable SVG artwork or Figma content. Vector is prepared locally in @zumer/snapdom-plugins/vector and has not been published yet.','demo':{'method':'toSvg','transform':'vector','note':'Reconstructs editable vector elements with the official plugin.'},'go':('Open the Vector page','../pro/vector/')}]},
 {'label':'Prepare the copy','section':'prepare','items':[
  {'t':'Keep private content out','prov':'Plugin','lead':'Mask fields, exclude blocks or remove attributes before they reach an image, document or semantic export.','code':IMP+"import { redactInputs } from '@zumer/snapdom-plugins/redact-inputs';\n\nconst result = await snapdom(el, { plugins: [redactInputs()] });\nconst png = await result.toPng();",'demo':{'method':'toPng','prepare':'redact'},'go':('Open the redact-inputs plugin','../plugins.html#official')},
  {'t':'Change text or appearance','prov':'Plugins','lead':'Replace text, apply a filter, blend a colour or add a timestamp to the captured copy. The original interface stays in place.','code':IMP+"import { timestampOverlay } from '@zumer/snapdom-plugins/timestamp-overlay';\n\nconst result = await snapdom(el, { plugins: [timestampOverlay()] });\nconst png = await result.toPng();",'demo':{'method':'toPng','prepare':'retitle','note':'The replace-text plugin changes only the captured copy.'},'go':('Open the replace-text plugin','../plugins.html#official')},
  {'t':'Choose the capture area','prov':'Core','lead':'Capture a single element or a clipped region. Core options also let you exclude selected nodes.','code':"await snapdom.toPng(el, { exclude: ['.demo-input'] });\nawait snapdom.toPng(document.body, { clip: 'viewport' });",'demo':{'method':'toPng','options':{'exclude':['.demo-input']}},'go':('Read exclude in Docs','../docs/options/')}]},
 {'label':'Test & automate','section':'ecosystem','items':[
  {'t':'SnapDIFF','prov':'Separate project','tool':True,'lead':'Compare captures against baselines, inspect changed pixels and use the result in a browser test suite or CI.','go':('See SnapDIFF in Ecosystem','../ecosystem/#snapdiff')},
  {'t':'SnapEye','prov':'Separate project','tool':True,'lead':'Capture, compare and record a local app through a CLI or page API. Give a coding agent artifacts and change regions.','go':('See SnapEye in Ecosystem','../ecosystem/#snapeye')}]},
 {'label':'Work with agents','section':'context','items':[
  {'t':'Describe a captured interface','prov':'Plugins','lead':'Export readable text, state and geometry. An element map can add numbered annotations to an image of the same capture.','code':IMP+"import { contextExport } from '@zumer/snapdom-plugins/context-export';\n\nconst result = await snapdom(el, { plugins: [contextExport()] });\nconst outline = await result.toContext();",'demo':{'method':'toPng','transform':'context','note':'Context exported from the frozen capture.'},'go':('Open the context-export plugin','../plugins.html#official')},
  {'t':'Operate a browser','section':'ecosystem','prov':'Experimental','tool':'SnapSurf','lead':'Navigate, locate controls, act and verify what changed. SnapSurf adds browser interaction around capture evidence.','go':('See SnapSurf in Ecosystem','../ecosystem/#snapsurf')}]}]

PIPELINE = ('<div class="pipeline">'
 '<div class="pipeline-box"><span class="pipeline-eyebrow"><span class="sec-dot" style="background:rgba(15,30,77,.3)"></span>Your source</span><strong>A rendered HTML interface</strong><p>An element, component, report or dashboard with its CSS and resources.</p></div>'
 '<span class="pipeline-link" aria-hidden="true"><i></i><i></i></span>'
 '<div class="pipeline-box is-engine sec-capture"><span class="pipeline-eyebrow"><span class="sec-dot"></span>SnapDOM core</span><strong>Capture its current state</strong><p>Styles, fonts, images, layout and control values.</p></div>'
 '<span class="pipeline-link" aria-hidden="true"><i></i><i></i></span>'
 '<div class="pipeline-box"><span class="pipeline-eyebrow">Choose your result</span><ul>'
 + ''.join(f'<li class="sec-{s}"><span class="sec-dot"></span>{a}<small>{b}</small></li>' for a, b, s in [('Image / canvas','Core','capture'),('PDF document','Plugin','export'),('HTML snapshot','Plugin','export'),('GIF / video','Plugins','record'),('Text / element map','Plugins','context')])
 + '</ul></div></div>')

def cap_topic(p):
    if p.get('overview'):
        grid = index_grid([(g['label'], g['section'], f"{len(g['items'])} topic{'s' if len(g['items']) > 1 else ''}", g['items'][0]['id']) for g in CAPS[1:]])
        inner = (doc_head(['Capabilities','Overview'], 'Core · Plugins · Tools', 'Start with HTML.<br>Get the result you need.',
                 'SnapDOM captures a rendered interface in your browser. Use the core for images, add a plugin for other outputs, or connect a tool to test and automate the work.')
                 + PIPELINE + '<h2>Four ways in</h2>' + grid + '<h2>What comes with the core?</h2>'
                 '<p>SnapDOM runs inside the page. It captures styles, web fonts, pseudo-elements, SVG, canvas, open Shadow DOM, accessible iframe content and form state. You choose output resolution and reuse the captured result.</p>'
                 + code('core.js', "const shot = await snapdom(element);\nconst file = await shot.toBlob({ format: 'png' });"))
        return topic(p, p['section'], inner)
    inner = doc_head(['Capabilities', p['group'], p['t']], p.get('fmt', p['prov']), E(p['t']), E(p['lead']))
    inner += f'<div class="provided-by"><span>Provided by</span>{tag(p["prov"])}</div>'
    if p.get('code'):
        inner += '<h2>How it looks in code</h2>' + code('example.js', p['code'])
    if p.get('status'):
        inner += f'<aside class="callout"><div class="callout-label">Status</div>{E(p["status"])}</aside>'
    if p.get('tool'):
        name = p['tool'] if isinstance(p['tool'], str) else p['t']
        inner += f'<aside class="callout"><div class="callout-label">Separate project</div>{name} is not part of @zumer/snapdom. It uses captures for a different part of the workflow.</aside>'
    label, href = p['go']
    inner += f'<a class="pane-button" href="{href}">{E(label)}</a>'
    d = p.get('demo')
    return topic(p, p['section'], inner, d and {'demo':'capture','method':d.get('method'),'options':d.get('options'),'prepare':d.get('prepare'),'transform':d.get('transform'),'note':d.get('note')})

CAP_META = '''  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SnapDOM Capabilities — images, PDF, HTML, recordings and agent context</title>
  <meta name="description" content="What you can make from a SnapDOM capture: images and canvas from the core, PDF, HTML snapshots, GIF, video, ASCII and agent context from plugins, and tools for testing and automation. Each topic runs a live demo.">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://snapdom.dev/capabilities/">
  <link rel="help" type="text/plain" href="https://snapdom.dev/llms.txt" title="LLM summary">
  <meta property="og:type" content="website">
  <meta property="og:title" content="SnapDOM Capabilities">
  <meta property="og:description" content="Start with HTML. Get the result you need: images, documents, recordings and context for agents.">
  <meta property="og:url" content="https://snapdom.dev/capabilities/">
  <meta property="og:image" content="https://snapdom.dev/assets/og-card.jpg">
  <meta name="twitter:card" content="summary_large_image">'''

import os
os.makedirs(f'{OUT}/capabilities', exist_ok=True)
page('capabilities/index.html', 'Capabilities', CAP_META, CAPS, build(CAPS, cap_topic), 'Filter capabilities', 'Capabilities')
