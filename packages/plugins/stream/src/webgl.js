/**
 * A WebGL texture fed by a stream: uploads only the rects a frame changed.
 *
 * WebGL2 reads a sub-rectangle of a canvas source through the unpack parameters, so a patch
 * frame costs its own pixels on the bus, not the texture's. demos/stream-webgl.html: 4% of
 * a 1000x1976 texture per frame against 100% re-uploading it. WebGL1 has no row length, so
 * there every frame uploads the whole canvas.
 * @module plugins/stream/webgl
 */

/**
 * Create a texture and the `update(frame)` that keeps it in step with a stream.
 * @param {WebGLRenderingContext|WebGL2RenderingContext} gl
 * @param {{filter?: number}} [options] - TEXTURE_MIN/MAG_FILTER, default gl.LINEAR.
 * @returns {{texture: WebGLTexture, width: number, height: number, update: (frame: {full: boolean, rects: {x:number,y:number,width:number,height:number}[], canvas: HTMLCanvasElement}) => number}}
 *   `update` returns the pixels it uploaded.
 */
export function streamTexture(gl, options = {}) {
  const texture = gl.createTexture()
  const filter = options.filter ?? gl.LINEAR
  const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const state = { texture, width: 0, height: 0, update }

  function update(frame) {
    const c = frame.canvas
    gl.bindTexture(gl.TEXTURE_2D, texture)
    if (frame.full || !webgl2 || c.width !== state.width || c.height !== state.height) {
      state.width = c.width
      state.height = c.height
      if (webgl2) {
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0)
        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0)
        gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0)
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c)
      return c.width * c.height
    }
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, c.width)
    let uploaded = 0
    for (const r of frame.rects) {
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, r.x)
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, r.y)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, r.y, r.width, r.height, gl.RGBA, gl.UNSIGNED_BYTE, c)
      uploaded += r.width * r.height
    }
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0)
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0)
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0)
    return uploaded
  }

  return state
}
