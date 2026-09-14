// Repository-only adapter, shared by category tests and the real-page benchmark.
// domlens nests its options: `{ output: { scale } }`. A flat `{ scale: 1 }` is silently
// ignored and the capture comes out at devicePixelRatio — 4x the pixels of every other row
// on a retina screen, and a comparison that is no longer like-for-like. Headless chromium
// runs at DPR 1, which is why this only surfaced in the live lab.
// `viewport.scrollY` pinned to 0: domlens's default viewport reads the window's current
// scroll and the region it cuts comes out offset by exactly that much — on the lab page
// scrolled 300px the table's capture starts at row #9, at 1000px at row #29, against a
// screenshot of the live element (0.00% with the option, at any scroll; html2canvas and
// SnapDOM are scroll-independent with their defaults). Every visitor has scrolled down to
// the Run button, so without it the row compared scroll handling, not rendering.
export async function loadDomlens(toDataUrl) {
  const url = 'https://cdn.jsdelivr.net/npm/domlens.js@0.1.0/+esm'
  const m = await import(/* @vite-ignore */ url)
  return async (el) => toDataUrl(await m.capture(el, { output: { scale: 1 }, viewport: { scrollX: 0, scrollY: 0 } }))
}
