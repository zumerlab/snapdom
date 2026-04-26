/**
 * Experimental plugin for WICG html-in-canvas (issue #172).
 * Uses drawElementImage() to render the snapdom clone directly into canvas,
 * bypassing SVG/foreignObject.
 *
 * Requires: Chrome with chrome://flags/#canvas-draw-element enabled.
 * @see https://github.com/WICG/html-in-canvas
 */

const PLUGIN_NAME = 'html-in-canvas'

/**
 * The WICG canvas-place-element spec evolved: Chrome ~130+ exposes drawElement(),
 * earlier flagged builds shipped drawElementImage(). Detect either.
 * @returns {'drawElement'|'drawElementImage'|null}
 */
function detectDrawApi() {
  try {
    const c = document.createElement('canvas')
    const ctx = c.getContext('2d')
    if (!ctx) return null
    if (typeof ctx.drawElement === 'function') return 'drawElement'
    if (typeof ctx.drawElementImage === 'function') return 'drawElementImage'
    return null
  } catch {
    return null
  }
}

/**
 * @returns {import('../../src/core/plugins.js').Plugin}
 */
export function htmlInCanvasPlugin() {
  const drawApi = detectDrawApi()
  const available = !!drawApi
  if (!available) {
    console.warn('[snapdom] html-in-canvas plugin: drawElement / drawElementImage not available. Enable chrome://flags/#canvas-draw-element')
  }

  return {
    name: PLUGIN_NAME,

    beforeRender(state) {
      if (!available) return
      if (!state.clone || !state.element) return
      state.options.__htmlInCanvas = {
        clone: state.clone,
        baseCSS: state.baseCSS || '',
        fontsCSS: state.fontsCSS || '',
        classCSS: state.classCSS || '',
        element: state.element,
        w0: null,
        h0: null
      }
    },

    afterRender(state) {
      if (!available) return
      const meta = state.options?.meta
      const stored = state.options?.__htmlInCanvas
      if (meta && stored) {
        stored.w0 = meta.w0
        stored.h0 = meta.h0
      }
    },

    async defineExports(ctx) {
      if (!available) return {}
      const stored = ctx.__htmlInCanvas
      if (!stored) return {}

      return {
        htmlInCanvas: async (opts = {}) => {
          const { clone, baseCSS, fontsCSS, classCSS, element } = stored
          const w0 = stored.w0 ?? element?.offsetWidth
          const h0 = stored.h0 ?? element?.offsetHeight
          const scale = opts.scale ?? ctx.scale ?? 1
          const dpr = opts.dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)

          const rect = element?.getBoundingClientRect?.()
          const width = w0 ?? rect?.width ?? 100
          const height = h0 ?? rect?.height ?? 100
          const outW = Math.round(width * scale * dpr)
          const outH = Math.round(height * scale * dpr)

          const canvas = document.createElement('canvas')
          canvas.width = outW
          canvas.height = outH
          canvas.setAttribute('layoutsubtree', '')

          const wrapper = document.createElement('div')
          wrapper.style.cssText = `width:${width}px;height:${height}px;overflow:visible;box-sizing:border-box;`
          wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')

          const styleTag = document.createElement('style')
          styleTag.textContent = `${baseCSS}${fontsCSS}svg{overflow:visible;}${classCSS}`
          wrapper.appendChild(styleTag)

          const cloneCopy = clone.cloneNode(true)
          wrapper.appendChild(cloneCopy)

          canvas.appendChild(wrapper)

          // Append directly to body, taken out of flow with position:fixed + z-index:-1
          // so it sits behind the page's content (covered by body/main backgrounds)
          // while still being painted. visibility:hidden / opacity:0 / left:-9999px
          // skip the paint pass and trigger "No cached paint record".
          canvas.style.cssText = 'position:fixed;top:0;left:0;z-index:-1;'
          document.body.appendChild(canvas)

          try {
            canvas.getBoundingClientRect()
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))

            const ctx2d = canvas.getContext('2d')
            const fn = ctx2d && (ctx2d[drawApi] || ctx2d.drawElement || ctx2d.drawElementImage)
            if (typeof fn !== 'function') {
              throw new Error('drawElement / drawElementImage not available on this canvas context')
            }
            ctx2d.save()
            ctx2d.scale(dpr * scale, dpr * scale)
            fn.call(ctx2d, wrapper, 0, 0, width, height)
            ctx2d.restore()
            return canvas
          } catch (e) {
            if (e && /paint record/i.test(e.message || '')) {
              throw new Error('Browser had no paint record for the element. Make sure the document is fully loaded and visible before calling html-in-canvas (drawElement requires a real paint pass).')
            }
            throw e
          } finally {
            try { canvas.remove() } catch {}
          }
        }
      }
    }
  }
}

export default htmlInCanvasPlugin
