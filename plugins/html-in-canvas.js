/**
 * Experimental plugin for WICG html-in-canvas (issue #172).
 * Uses drawElementImage() to render the snapdom clone directly into canvas,
 * bypassing SVG/foreignObject.
 *
 * Requires: Chrome with chrome://flags/#canvas-draw-element enabled.
 * @see https://github.com/WICG/html-in-canvas
 */

const PLUGIN_NAME = 'html-in-canvas'

function isDrawElementImageAvailable() {
  try {
    const c = document.createElement('canvas')
    const ctx = c.getContext('2d')
    return ctx && typeof ctx.drawElementImage === 'function'
  } catch {
    return false
  }
}

/**
 * @returns {import('../src/core/plugins.js').Plugin}
 */
export function htmlInCanvasPlugin() {
  const available = isDrawElementImageAvailable()
  if (!available) {
    console.warn('[snapdom] html-in-canvas plugin: drawElementImage not available. Enable chrome://flags/#canvas-draw-element')
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

          const container = document.createElement('div')
          container.id = 'snapdom-html-in-canvas-temp'
          container.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden;'
          container.appendChild(canvas)
          document.body.appendChild(container)

          try {
            await new Promise(r => requestAnimationFrame(r))
            const ctx2d = canvas.getContext('2d')
            if (!ctx2d || typeof ctx2d.drawElementImage !== 'function') {
              throw new Error('drawElementImage not available')
            }
            ctx2d.save()
            ctx2d.scale(dpr * scale, dpr * scale)
            ctx2d.drawElementImage(wrapper, 0, 0, width, height)
            ctx2d.restore()
            return canvas
          } finally {
            try {
              document.body.removeChild(container)
            } catch {}
          }
        }
      }
    }
  }
}

export default htmlInCanvasPlugin
