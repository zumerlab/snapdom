// A real hi-DPI screen on the 1x runner. Stubbing devicePixelRatio alone is device emulation,
// which the svg engine deliberately does not zoom (#526): liveLayoutZoom in src/engines/svg.js
// also asks the live grid, through the computed width of a 0.5px border on an internal probe.
// So this stubs both. The caller restores `devicePixelRatio` and `window.getComputedStyle`.

/** Report `dpr` as devicePixelRatio and a layout grid finer than CSS pixels. */
export function stubHiDPI(dpr) {
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => dpr })
  const gcs = window.getComputedStyle
  window.getComputedStyle = function (el, pseudo) {
    const cs = gcs.call(this, el, pseudo)
    // Only the probe: an element whose own inline style asks for a 0.5px top border.
    if (pseudo || el?.style?.borderTopWidth !== '0.5px') return cs
    return new Proxy(cs, { get: (t, k) => k === 'borderTopWidth' ? '0.5px' : Reflect.get(t, k) })
  }
}
