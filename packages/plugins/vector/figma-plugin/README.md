# SnapDOM Vector: Figma plugin

Turns an SVD capture into real Figma layers: frames, text you can still edit,
gradients, radii, shadows, per-side borders and images. Everything lands
positioned; Auto Layout is not inferred.

**Nothing leaves the machine.** The manifest declares
`"networkAccess": {"allowedDomains": ["none"]}`, so the plugin cannot make a
request even if it wanted to. The capture is read from a file you drop or JSON
you paste.

## Loading it

There is no build step: the three files are the plugin.

1. Figma: **Plugins → Development → Import plugin from manifest…**
2. Pick `manifest.json` from this folder.
3. Run it from **Plugins → Development → SnapDOM Vector**.

After editing `code.js` or `ui.html`, close and re-run the plugin. `manifest.json`
changes need a re-import.

## Using it

1. Drop a `.svd` file on the window, or paste its JSON into the box. The file is
   the JSON of `svdToFigma(doc)`. Pasting is the transport verified to work in
   both Figma desktop and Figma web.
2. Read the **preflight**. It is blocking on purpose: before a single node
   exists you see every font that is missing or will be substituted (with the
   number of text blocks and characters riding on it), the layer count, and
   every degradation the engine declared, grouped by code.
3. Decide what to do with each font: accept the substitution, map it to
   something installed, or fall back to the pre-baked outlines or bitmap when
   the document carries them.
4. **Create layers.** The result is selected and zoomed to, and the final screen
   lists everything that was approximated during the build.

## Why some options are greyed out

Outlining and rasterising happen in the **browser**, where the real font is
loaded. The Plugin API has no `outlineText()` (only `outlineStroke`, which is a
different thing) and the sandbox cannot rasterize, so the plugin can only *use*
an outline or bitmap that the capture already contains. When a capture does not
carry one, the option is disabled and says so rather than silently doing
something else.

The same rule explains the font advice: captured font binaries are subsetted to
the glyphs the page used. Uploading one to your Figma account would name it
"Inter" while carrying a fraction of Inter, and every other file would get
silent tofu. The plugin shows the correct internal name and the original URL
instead.

## Files

| File | What it is |
| --- | --- |
| `manifest.json` | `documentAccess: "dynamic-page"` (required for new plugins; the deprecated sync APIs throw without it) and no network access. |
| `code.js` | The sandbox half: validation, font matching and loading, node construction. Classic script, no modules, because the sandbox has no module loader. |
| `ui.html` | The DOM half: file reading, the preflight, progress and the summary. |

## What it refuses

The plugin validates the schema version and **rejects without repairing**. A
document written by a different version of the engine is a hard stop with the
version it found and the version it reads. Repairing it would ship the bug
instead of reporting it.
