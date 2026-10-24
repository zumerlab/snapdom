# stream

A live element as a canvas that repaints only what changed. For WebGL textures, video overlays
and anything else that needs the DOM as pixels, many times a second.

```js
import { stream } from '@zumer/snapdom-plugins/stream';

const live = stream(panel, {
  scale: 2,
  onFrame(frame) {
    // frame.canvas is updated in place; frame.rects lists what changed, in canvas pixels.
  },
});
await live.ready;
// ...
live.stop();
```

## How it works

The first frame is a full capture. After that, every change (mutations, typing, focus, hover,
running animations) is traced to the nearest box that can be repainted on its own, and only
that subtree is captured and drawn into its rect. A frame that cannot be patched exactly is a
full frame, and `frame.reason` says why (`'root resized'`, `'no host for <div.x>'`, ...).
A keyframe in idle time heals anything the change tracking could not see, at most every 2 s
and never more than 2% of the main thread.

Every patched frame is meant to match a full capture of the same DOM state pixel for pixel.
The test suite checks exactly that on Chromium, Firefox and WebKit.

Measured on a 1000px grid with one card changing per frame, median per frame:

| cards | Chromium full / patch | Firefox | WebKit |
|---|---|---|---|
| 400 | 11.7 / 4.2 ms | 28 / 4 ms | 20 / 4 ms |
| 2000 | 52.9 / 4.9 ms | 119 / 5 ms | 90 / 4 ms |

## Options

All [capture options](https://snapdom.dev/) apply (`scale`, `dpr`, `embedFonts`, `exclude`,
...), plus:

| option | default | |
|---|---|---|
| `onFrame(frame)` | | called after each repaint: `{ full, reason, rects, ms, canvas }` |
| `fps` | every animation frame | upper bound on repaints per second |
| `patches` | `true` | `false` repaints full frames only, for comparison |

`stream()` returns `{ canvas, ready, stats, stop() }`.

## WebGL

`streamTexture(gl)` keeps a texture in step with the stream. On WebGL2 it uploads only the
changed rects (4% of the texture per frame in the WebGL demo, against 100%).

```js
import { stream, streamTexture } from '@zumer/snapdom-plugins/stream';

const tex = streamTexture(gl);
stream(panel, { onFrame: (frame) => tex.update(frame) });
// draw with tex.texture
```

## Video

Composite `live.canvas` over anything with `drawImage`, and record the result:

```js
import { recordCanvas } from '@zumer/snapdom-plugins/stream';

const rec = recordCanvas(output, { fps: 30, duration: 10000 });
const blob = await rec.done; // MP4 or WebM, whichever the browser records
```

## WebRTC

The composited canvas is a video track like a camera's, so an HTML overlay travels inside the
video to every viewer, with no desktop software and no server-side render:

```js
const track = output.captureStream(30).getVideoTracks()[0];
track.contentHint = 'detail'; // graphics are text: keep the resolution
peerConnection.addTrack(track, new MediaStream([track]));
```

`demos/stream-webrtc.html` sends one tab's program to viewer tabs this way.

## Overlay templates

A stage and four broadcast graphics, as plain DOM with a small controller each. Every box that
changes is opaque and the lower third slides with `left`, so a score, a clock tick or a slide
costs a patch, not a full frame.

```js
import { stream, overlayStage, scoreboard, lowerThird, ticker, liveBadge } from '@zumer/snapdom-plugins/stream';

const stage = overlayStage({ width: 1920, height: 1080, theme: { accent: '#facc15' } });
const score = scoreboard({ home: 'HOME', away: 'AWAY' });
const lower = lowerThird({ name: 'Alex Morgan', role: 'Commentator' });
stage.append(score.el, liveBadge().el, lower.el, ticker({ items: ['Kick-off at 18:00'] }).el);
document.body.append(stage);

score.clock.start();
score.add('home');
lower.set({ name: 'Jamie Rivera' });
lower.hide();

const live = stream(stage, { onFrame });
```

Theme through CSS variables on the stage: `accent`, `panel`, `panel-2`, `text`, `ink`, `live`,
`font`.

## As an export

`streamExport()` adds `toStream()` to a capture result, next to `toMp4()` and `toGif()`:

```js
import { streamExport } from '@zumer/snapdom-plugins/stream';

const result = await snapdom(panel, { plugins: [streamExport()] });
const live = await result.toStream({ onFrame });
```

## Limits

- Patches need a box that can be repainted standalone. A change inside a transparent box with
  no solid backdrop, under a positioned element, or that moves its siblings is a full frame.
- Programmatic CSSOM edits (`insertRule`, `rule.style`) produce no signal; the keyframe heals
  them.
- Text ink that spills past a box edge onto a pixel shared with a neighbour waits for the
  keyframe.
- Needs SnapDOM with the `__subpixel` layout option (the release after 3.3.7). On an older core
  the stream still runs, but patches at fractional positions are not pixel-exact.

Demos: `demos/stream-webgl.html`, `demos/stream-overlay.html`, `demos/stream-webrtc.html`,
`demos/stream-lab.html`.
