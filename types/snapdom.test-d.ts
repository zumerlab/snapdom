/**
 * Compile-only type tests for snapdom.d.ts. No runtime assertions — a clean
 * `tsc --noEmit` (via `npm run test:types`) IS the test. Not published (see
 * package.json "files"); not picked up by vitest (name doesn't match *.test.ts).
 *
 * `// @ts-expect-error` lines assert that the given usage must NOT type-check —
 * if the API starts accepting it, tsc fails because the expected error is gone.
 */
import { snapdom } from './snapdom'
import type {
  SnapdomOptions,
  CaptureResult,
  SnapdomPlugin,
  PluginFactory,
  ExportMap,
  CaptureContext,
  BlobType,
  BlobOptions,
  CachePolicy,
  CaptureMeta,
  CaptureStage,
  WarningCode,
} from './snapdom'

declare const el: Element

// CaptureResult carries an index signature, so a removed or mistyped member silently becomes
// `any` and an assignment like `const c: HTMLCanvasElement = await result.toCanvas()` still
// compiles. These two aliases refuse `any`: Equal<any, X> is false, and Expect only takes true.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Expect<T extends true> = T

async function mainCallable() {
  const options: SnapdomOptions = {
    scale: 2,
    dpr: 2,
    outerTransforms: false,
    outerShadows: true,
    clip: 'viewport',
    exclude: ['.skip', (node) => node.tagName === 'SCRIPT'],
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

async function independentFilterOptions() {
  await snapdom(el, { filter: (node) => !node.matches('.private'), filterMode: 'remove' })
  await snapdom.toPng(el, { filterMode: 'remove' })

  // Stored v2 call options keep working, including simultaneous modes and spread objects.
  const legacyFilter = { scale: 1, filter: (node: Element) => !node.matches('.private') }
  await snapdom(el, legacyFilter)
  const legacyMode = { scale: 1, filterMode: 'hide' as const }
  const stored: SnapdomOptions = legacyMode
  await snapdom.toPng(el, { ...legacyFilter, dpr: 1 })

  const combined: SnapdomOptions = {
    exclude: ['.skip', (node) => node.matches('.exclude-too')], excludeMode: 'hide',
    filter: legacyFilter.filter, filterMode: 'remove',
  }
  await snapdom(el, combined)
  // @ts-expect-error A keep predicate must be a function.
  await snapdom(el, { filter: '.private' })
  // @ts-expect-error Only the supported independent layout modes are accepted.
  const invalid: SnapdomOptions = { filterMode: 'collapse' }
  void stored
  void invalid
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

async function invalidateOption() {
  // burst/compress are engine behavior in v3, not public options: only the invalidate
  // escape hatch remains typed.
  const options: SnapdomOptions = { invalidate: true }
  const result: CaptureResult = await snapdom(el, options)
  void result
}

function fastOption() {
  const modes: SnapdomOptions[] = [{ fast: true }, { fast: false }, { fast: 'auto' }]
  // @ts-expect-error fast takes a boolean or 'auto'.
  const unknown: SnapdomOptions = { fast: 'idle' }
  void modes; void unknown
}

function disabledCacheAlias() {
  const options: SnapdomOptions = { cache: false }
  return options
}

// v2 options that v3 removed. Each must be rejected as an excess property; the moment one
// of them is declared again the expected error disappears and tsc fails here.
function removedV2Options() {
  // @ts-expect-error burst is engine behavior in v3, not an option.
  const burst: SnapdomOptions = { burst: true }
  // @ts-expect-error compress is engine behavior in v3, not an option.
  const compress: SnapdomOptions = { compress: false }
  // @ts-expect-error preCache was removed in v3 (snapdom.preCapture() is the only prefetch).
  const preCache: SnapdomOptions = { preCache: {} }
  // @ts-expect-error resolvePicturePlaceholders was removed in v3.
  const picture: SnapdomOptions = { resolvePicturePlaceholders: true }
  // @ts-expect-error v2's 'auto' maps to 'soft' at runtime but is not part of the v3 type.
  const auto: SnapdomOptions = { cache: 'auto' }
  // @ts-expect-error v2's 'full' maps to 'soft' at runtime but is not part of the v3 type.
  const full: SnapdomOptions = { cache: 'full' }
  // @ts-expect-error A keep predicate must be a function (the array form belongs to exclude).
  const stringFilter: SnapdomOptions = { filter: '.private' }
  void burst; void compress; void preCache; void picture; void auto; void full; void stringFilter
}

// Pins that survive the index signature: the declared member types, checked with Equal.
type _cachePolicy = Expect<Equal<CachePolicy, 'soft' | 'disabled'>>
type _cacheOption = Expect<Equal<SnapdomOptions['cache'], CachePolicy | false | undefined>>
type _url = Expect<Equal<CaptureResult['url'], string>>
type _needs = Expect<Equal<CaptureResult['needs'], CaptureStage>>
type _meta = Expect<Equal<CaptureResult['meta'], Readonly<CaptureMeta>>>
type _warnings = Expect<Equal<CaptureResult['warnings'], Array<{ code: WarningCode; message: string; detail?: unknown }>>>
type _toRaw = Expect<Equal<ReturnType<CaptureResult['toRaw']>, string>>
type _toSvg = Expect<Equal<ReturnType<CaptureResult['toSvg']>, Promise<HTMLImageElement>>>
type _toImg = Expect<Equal<ReturnType<CaptureResult['toImg']>, Promise<HTMLImageElement>>>
type _toCanvas = Expect<Equal<ReturnType<CaptureResult['toCanvas']>, Promise<HTMLCanvasElement>>>
type _toBlob = Expect<Equal<ReturnType<CaptureResult['toBlob']>, Promise<Blob>>>
type _toPng = Expect<Equal<ReturnType<CaptureResult['toPng']>, Promise<HTMLImageElement>>>
type _toJpeg = Expect<Equal<ReturnType<CaptureResult['toJpeg']>, Promise<HTMLImageElement>>>
type _toJpg = Expect<Equal<ReturnType<CaptureResult['toJpg']>, Promise<HTMLImageElement>>>
type _toWebp = Expect<Equal<ReturnType<CaptureResult['toWebp']>, Promise<HTMLImageElement>>>
type _download = Expect<Equal<ReturnType<CaptureResult['download']>, Promise<void>>>
type _to = Expect<Equal<ReturnType<CaptureResult['to']>, Promise<any>>>
type _ctxExclude = Expect<Equal<CaptureContext['exclude'], readonly string[]>>
type _ctxPredicates = Expect<Equal<CaptureContext['excludePredicates'], ReadonlyArray<(el: Element) => boolean> | null>>
type _ctxFilter = Expect<Equal<CaptureContext['filter'], ((el: Element) => boolean) | null>>
type _ctxShouldExclude = Expect<Equal<CaptureContext['shouldExclude'], (el: Element) => boolean>>
type _fallbackInfo = Expect<Equal<
  Parameters<Extract<SnapdomOptions['fallbackURL'], (...args: any) => any>>[0],
  { width?: number; height?: number; src?: string; element?: HTMLImageElement }
>>
type _fallbackReturn = Expect<Equal<
  ReturnType<Extract<SnapdomOptions['fallbackURL'], (...args: any) => any>>,
  string | Promise<string>
>>

function warningCodes(result: CaptureResult) {
  const known: WarningCode = 'backdrop-filter-failed'
  const custom: WarningCode = 'my-plugin-code'
  const first = result.warnings[0]
  const detail: unknown = first.detail
  void known; void custom; void detail
}

async function fallbackCallback() {
  await snapdom(el, {
    fallbackURL: async ({ width, height, src, element }) => {
      const w: number | undefined = width
      const h: number | undefined = height
      const s: string | undefined = src
      const img: HTMLImageElement | undefined = element
      void w; void h; void s; void img
      return 'https://example.com/fallback.png'
    },
  })
  await snapdom(el, { fallbackURL: () => 'https://example.com/fallback.png' })
}

async function canonicalBlobFormat() {
  const options: BlobOptions = { format: 'png' }
  const legacy: BlobOptions = { type: 'jpeg' }
  const result = await snapdom(el)
  const blob: Blob = await result.toBlob(options)
  await snapdom.toBlob(el, options)
  await result.toBlob(legacy)
  // @ts-expect-error Only supported image formats are accepted.
  const invalid: BlobOptions = { format: 'pdf' }
  void blob; void invalid
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

function normalizedPluginContext(ctx: CaptureContext) {
  const format: BlobType = ctx.format
  const legacyType: BlobType = ctx.type
  void format; void legacyType
}

function preCaptureHelper() {
  const armed: void = snapdom.preCapture()
  return armed
}

async function canvasTargetOption() {
  const target = document.createElement('canvas')
  await snapdom.toCanvas(el, { canvas: target })
}

void mainCallable
void clipOptionShapes
void independentFilterOptions
void staticNamespaceHelpers
void invalidateOption
void disabledCacheAlias
void removedV2Options
void warningCodes
void fallbackCallback
void canonicalBlobFormat
void pluginShape
void normalizedPluginContext
void preCaptureHelper
void canvasTargetOption
