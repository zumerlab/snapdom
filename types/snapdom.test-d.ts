/**
 * Compile-only type tests for snapdom.d.ts. No runtime assertions — a clean
 * `tsc --noEmit` (via `npm run test:types`) IS the test. Not published (see
 * package.json "files"); not picked up by vitest (name doesn't match *.test.ts).
 *
 * `// @ts-expect-error` lines assert that the given usage must NOT type-check —
 * if the API starts accepting it, tsc fails because the expected error is gone.
 */
import { snapdom, preCache } from './snapdom'
import type {
  SnapdomOptions,
  CaptureResult,
  CaptureSession,
  SnapdomPlugin,
  PluginFactory,
  ExportMap,
  CaptureContext,
} from './snapdom'

declare const el: Element

async function mainCallable() {
  const options: SnapdomOptions = {
    scale: 2,
    dpr: 2,
    outerTransforms: false,
    outerShadows: true,
    clip: 'viewport',
    exclude: ['.skip'],
    filter: (node) => node.tagName !== 'SCRIPT',
    cache: 'soft',
  }
  const result: CaptureResult = await snapdom(el, options)

  const raw: string = result.toRaw()
  const img: HTMLImageElement = await result.toSvg()
  const canvas: HTMLCanvasElement = await result.toCanvas({ scale: 1 })
  const blob: Blob = await result.toBlob({ type: 'webp' })
  const png: HTMLImageElement = await result.toPng()
  const jpeg: HTMLImageElement = await result.toJpeg()
  const jpg: HTMLImageElement = await result.toJpg()
  const webp: HTMLImageElement = await result.toWebp()
  await result.download({ filename: 'capture' })
  await result.to('png')
  void raw; void img; void canvas; void blob; void png; void jpeg; void jpg; void webp
}

function clipOptionShapes() {
  const a: SnapdomOptions['clip'] = 'viewport'
  const b: SnapdomOptions['clip'] = { x: 0, y: 0, width: 100, height: 100 }
  const c: SnapdomOptions['clip'] = null
  void a; void b; void c
}

async function staticNamespaceHelpers() {
  await snapdom.toRaw(el)
  await snapdom.toSvg(el)
  await snapdom.toCanvas(el)
  await snapdom.toBlob(el, { type: 'jpeg' })
  await snapdom.toPng(el)
  await snapdom.toJpg(el)
  await snapdom.toWebp(el)
  await snapdom.download(el, { filename: 'x' })

  // toJpeg() only exists on CaptureResult (via dynamic sugar) — the static
  // namespace never defined it, only toJpg. See snapdom-two-branch-audit.
  // @ts-expect-error
  await snapdom.toJpeg(el)
}

async function session() {
  const s: CaptureSession = snapdom.session(el, { scale: 1 })
  const dirty: boolean = s.dirty
  const result: CaptureResult = await s.capture()
  await s.capture({ scale: 2 })
  s.invalidate()
  s.dispose()
  void dirty; void result

  // @ts-expect-error dirty is readonly
  s.dirty = true
}

function pluginShape() {
  const plugin: SnapdomPlugin = {
    name: 'example',
    async beforeSnap(_ctx: CaptureContext) {},
    async beforeClone() {},
    resolveNode(_node, _ctx) {
      return undefined
    },
    defineExports(_ctx): ExportMap {
      return { pdf: async (_ctx2, _opts) => new Blob() }
    },
  }
  const factory: PluginFactory = (_options) => plugin
  snapdom.plugins(plugin, factory, [factory, { foo: 1 }], { plugin: factory, options: {} })
}

async function preCacheHelper() {
  await preCache()
  await preCache(el, { embedFonts: true, iconFonts: [/custom-icons/i], cache: 'full' })
}

void mainCallable
void clipOptionShapes
void staticNamespaceHelpers
void session
void pluginShape
void preCacheHelper
