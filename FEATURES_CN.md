# SnapDOM — 功能特性

**SnapDOM** 捕获、内嵌与导出能力的完整技术总览。SnapDOM 将 DOM 子树序列化为自包含的 SVG（通过 `<foreignObject>`），再栅格化为目标格式——超快速度、零依赖，100% 基于标准 Web API。

> 📖 完整 API、选项与指南：**[snapdom.dev/docs](https://snapdom.dev/docs/)**
>
> 🌐 English: **[FEATURES.md](FEATURES.md)**

## 目录

- [捕获与克隆](#捕获与克隆)
- [样式](#样式)
- [图片与背景](#图片与背景)
- [字体与图标字体](#字体与图标字体)
- [导出格式](#导出格式)
- [选项](#选项)
- [插件系统](#插件系统)
- [缓存与 preCache](#缓存与-precache)
- [跨浏览器处理](#跨浏览器处理)
- [节点级控制属性](#节点级控制属性)

## 捕获与克隆

逐节点深度克隆，为每个节点快照其计算样式，保留浏览器真实渲染的结果。

- **Shadow DOM** —— 遍历 `shadowRoot`，提取并作用域化其 CSS，注入所需的 CSS 自定义属性，并通过 `assignedNodes({ flatten: true })` 解析 `<slot>` 内容（已标记 slot 子树以避免重复克隆）。
- **同源 iframe** —— 内联栅格化（字体从 iframe 自身文档读取）。跨源 iframe 无法读取，会渲染为条纹占位（若关闭 `placeholders` 则为隐藏占位符）。
- **`<canvas>`** —— 快照为 PNG `<img>`（含 Safari 安全重试），保留固有尺寸与 CSS 盒子尺寸。
- **`<video>`** —— 将当前帧绘制为图片；回退到 `poster`；遵循 `object-fit: contain`。
- **`<audio controls>`** —— 替换为按元素尺寸绘制的播放器模拟图。
- **表单控件状态** —— 保留 `<input>` 的 `value` / `checked` / `indeterminate`、`<textarea>` 的值以及 `<select>` 的选中项。复制状态属性（`disabled`、`required`、`readonly`、`min`、`max`、`pattern`、`aria-invalid`），使 `:disabled`、`:required`、`:read-only`、`:invalid`、`:in-range` 样式得以渲染。保留 `::placeholder` 颜色。Firefox 的复选框/单选按钮使用绘制替换。
- **`<img>`** —— 冻结 `srcset`，记录变换前尺寸，作者使用 `%`/`auto` 时冻结像素尺寸，保留 `object-fit` / `object-position`。
- **SVG** —— 将绘制属性（fill、stroke 及其各长写、opacity 变体、fill/clip 规则、markers、visibility、display）复制为内联样式；被 `<use>` 引用的外部 `<defs>` / `<symbol>` 会被内联，使 `var()` 在使用处解析。
- **滚动位置** —— 对已滚动的容器，通过平移内部内容并裁剪溢出来还原；调整 fixed/absolute 后代，并冻结 sticky 页眉/页脚。
- **按设计跳过** —— `meta`、`script`、`noscript`、`title`、`link`、`template`、SnapDOM 沙箱以及嵌套的 `<foreignObject>`。

不可渲染内容会被妥善处理：剔除非法 XML 控制字符、强制 `content-visibility` 为可见以捕获屏幕外内容、并中和根元素外边距。

## 样式

- **计算样式内联** —— 每个节点的完整计算样式都会被快照，并去重为生成的 CSS 类以压缩输出。作者的内联样式会被替换为计算值，使样式表的 `!important` 依然生效。
- **保留细节** —— text-decoration 各长写（line/color/style/thickness、underline-offset、skip-ink）、`-webkit-text-stroke` + `paint-order`，以及（内嵌字体时）font-feature/variation/kerning/variant/optical-sizing 设置。
- **`counter()` / `counters()`** —— 完整的 CSS 计数器解析器（含嵌套的 counter-reset、counter-increment、counter-set 及 counter-style 格式化），用于伪元素 `content`。
- **`-webkit-line-clamp` 与 `text-overflow: ellipsis`** —— 烘焙为真实文本（含 `…`），因为 Firefox 和 Safari 在 `<foreignObject>` 内不遵循它们。
- **变换（transforms）** —— 读取基础及独立的 `translate`/`rotate`/`scale` 为总矩阵，并进行考虑变换原点的包围盒计算（见 `outerTransforms` 选项）。
- **阴影、模糊与轮廓外溢** —— 当 `outerShadows` 开启时，box-shadow、filter 模糊、drop-shadow 与 outline 会扩展 viewBox；否则根阴影会被视觉剥离（见 `outerShadows`）。
- **蒙版、背景与 border-image** —— 见[图片与背景](#图片与背景)。
- **自定义滚动条** —— 注入 `::-webkit-scrollbar` 规则，使自定义滚动条样式显示出来。
- **`excludeStyleProps`** —— 通过 RegExp 或谓词从快照中跳过某些属性（例如剔除所有 CSS 变量）。

## 图片与背景

- **`<img>` 内联** —— 解析 `currentSrc`/`src`，拉取为 data URL、缓存并确保尺寸（分批以遵守 HTTP/1.1 连接数限制）。SVG `<image href>` 同样会内联。
- **背景与蒙版** —— 内联 `background-image`（及 `background` 简写）、`mask` / `-webkit-mask*` 与 `border-image` 中的 `url()` 层，保留多层值与布局长写（position、size、repeat、origin、clip、blend-mode、composite……）。支持 `background-clip: text`。
- **`<picture>` 与懒加载图片** —— 在克隆前将 `<picture>` 源与常见懒加载属性（`data-src`、`data-lazy-src`、`data-original`、`data-hi-res-src`、`data-srcset`……）解析为真实 URL。
- **CORS / 代理** —— 一个不抛错的 fetch 层，具备进行中请求去重、错误缓存、超时与推断凭据。`useProxy` 接受灵活的模板（`{url}`、`{urlRaw}`、`?url=` 后缀等）；已代理的以及 `data:`/`blob:` URL 会被跳过。
- **失败回退** —— 可配置的 `fallbackURL`（字符串或回调），然后是占位框，再然后是隐藏占位符。
- **`compress`** —— 将内联栅格图感知式降采样至其可见分辨率（显示盒 × scale × dpr），保留源编码且永不放大。默认开启；设 `compress: false` 可原样嵌入。
- **解码尺寸保护** —— SVG 栅格尺寸被限制在安全范围（每边最大 16384px，面积约 268M px），超出时会降采样并给出警告。

## 字体与图标字体

- **`@font-face` 内嵌**（`embedFonts`）—— 扫描文档（及 iframe）样式表，仅内嵌**实际使用**的字族/字重/字形/拉伸对应的 `@font-face` 规则，并与**已使用的 Unicode 码点**取交集，从而保持体积精简。支持近似字重匹配与合成斜体回退。
- **图标字体** —— 自动识别 Font Awesome、Material Icons / Symbols、Ionicons、Glyphicons、Feather、Bootstrap Icons、Remix、Heroicons、Layui 与 Lucide（外加启发式规则），并将字形（含连字图标）渲染为图片。可通过 `iconFonts` 选项或 `window.__SNAPDOM_ICON_FONTS__` 扩展识别。
- **`localFonts`** —— 以 `{ family, src, weight?, style?, stretchPct? }` 提供你自己的字体以拉取并内嵌。
- **`excludeFonts`** —— 按 `{ families?, domains?, subsets? }` 排除。
- **跨源样式表** —— 由 `fontStylesheetDomains` 门控（外加已知数学库如 KaTeX/MathJax）。
- **`preCache`** —— 在捕获前预加载图片、背景图片与字体；默认 `embedFonts: true` 且 `cache: 'full'`。

## 导出格式

`snapdom(el)` 调用返回一个可复用的结果对象；一次捕获，多次导出。

| 方法 | 返回 |
|---|---|
| `toRaw()` | 原始 `data:image/svg+xml` URL |
| `toSvg()` / `toImg()` | SVG `HTMLImageElement` |
| `toCanvas()` | `HTMLCanvasElement` |
| `toBlob()` | `Blob`（SVG 文本 blob 或栅格） |
| `toPng()` | PNG 图片 |
| `toJpg()` | JPG 图片（白色背景） |
| `toWebp()` | WebP 图片 |
| `download()` | 触发文件下载 |

同名方法也提供一步式静态快捷方式（`snapdom.toPng(el)`、`snapdom.download(el)`……）。有损格式（JPEG/WebP）会将透明自动填充为白色。下载在 iOS 上回退到 Web Share API。导出通过每会话的串行队列执行，并带有 `beforeExport` / `afterExport` / `afterSnap` 钩子。

## 选项

默认值以 `src/core/context.js` 中的规范化结果为准。

| 选项 | 默认值 | 行为 |
|---|---|---|
| `debug` | `false` | 调试警告 |
| `fast` | `true` | 跳过 idle 延迟以提速 |
| `scale` | `1` | 输出缩放倍数 |
| `exclude` | `[]` | 要排除的 CSS 选择器 |
| `excludeMode` | `'hide'` | `'hide'`（占位）或 `'remove'` |
| `filter` | `null` | 节点谓词 `(node) => boolean` |
| `filterMode` | `'hide'` | `'hide'` 或 `'remove'` |
| `placeholders` | `true` | 为失败图片 / 跨源 iframe 显示占位符 |
| `embedFonts` | `false` | 内嵌匹配的 `@font-face` |
| `iconFonts` | `[]` | 额外的图标字体名称/正则 |
| `localFonts` | `[]` | 用户字体描述符 |
| `excludeFonts` | `undefined` | `{ families, domains, subsets }` |
| `fontStylesheetDomains` | `[]` | 额外的跨源 CSS 域名 |
| `fallbackURL` | `undefined` | 回退图片 URL 或回调 |
| `cache` | `'soft'` | `disabled` / `soft` / `auto` / `full` |
| `useProxy` | `''` | CORS 代理模板/基址 |
| `width` | `null` | 输出宽度（保持宽高比） |
| `height` | `null` | 输出高度 |
| `format` | `'png'` | `png` / `jpg`→`jpeg` / `webp` / `svg` |
| `type` | `'svg'` | 输出类型 `svg` / `img` / `canvas` / `blob` |
| `quality` | `0.92` | 有损编码质量 |
| `dpr` | `devicePixelRatio \|\| 1` | 设备像素比 |
| `backgroundColor` | `null`（jpeg/webp 为 `#ffffff`） | 扁平化背景 |
| `filename` | `'snapDOM'` | 下载文件名基础 |
| `outerTransforms` | `true` | 归一化根 translate/rotate 还是为变换扩展包围盒 |
| `outerShadows` | `false` | 剥离根阴影还是为阴影/模糊/轮廓扩展外溢 |
| `compress` | `true` | 感知式栅格降采样 |
| `safariWarmupAttempts` | `3` | Safari 预热次数（1–3） |
| `excludeStyleProps` | `null` | 跳过样式属性的 RegExp/谓词 |
| `resolvePicturePlaceholders` | `true` | 内置 `<picture>` / 懒加载解析器 |
| `pictureResolver` | `{}` | `{ timeout, concurrency, resolveLazySrc, silent }` |
| `plugins` | — | 每次捕获的插件列表（本地优先） |

## 插件系统

插件是带生命周期钩子的普通对象，可全局注册（`snapdom.plugins(...)`，按 `name` 去重）或按次捕获注册（`{ plugins: [...] }`，本地按名称覆盖全局）。

- **钩子**（按顺序）：`beforeSnap → beforeClone → afterClone → beforeRender → afterRender → beforeExport → afterExport → afterSnap`。
- **自定义导出器** —— 插件的 `defineExports` 可新增或覆盖导出格式；每个都会在结果对象上生成一个 `to<Name>()` 辅助方法，并获得与核心格式相同的导出流程。
- **接受的形式** —— 普通对象、`[factory, options]`、`{ plugin, options }` 或工厂函数。

参见 [`PLUGIN_SPEC.md`](PLUGIN_SPEC.md) 与 [`CONTRIBUTING_PLUGINS.md`](CONTRIBUTING_PLUGINS.md)。

## 缓存与 preCache

- **缓存桶** —— 用于 `image`、`background`、`resource`、`baseStyle` 与 `defaultStyle` 的 FIFO 淘汰映射；用于计算样式与布局测量提示的 `WeakMap`；用于字体的 `Set`；以及一个每会话缓存桶。
- **策略**（`cache` 选项）：
  - `disabled` —— 每次捕获清空所有缓存。
  - `soft`（默认）—— 重置会话的样式/节点映射，保留持久缓存。
  - `auto` —— 仅重置样式/节点映射，同时也保留样式缓存。
  - `full` —— 保留一切。
- **失效机制** —— DOM 与 `<head>` 上的 MutationObserver 加上字体 `loadingdone`/`ready` 事件会提升样式快照的 epoch，从而自动丢弃过期快照。
- **`preCache`** —— 提前预热缓存（默认 `cache: 'full'`）。

## 跨浏览器处理

- **Safari 预热** —— 规避 [WebKit #219770](https://bugs.webkit.org/show_bug.cgi?id=219770)（首次绘制含内嵌字体的 SVG 到 canvas 时是空白）：当内嵌字体或元素含背景/蒙版/canvas 内容时，运行小型预捕获 + `drawImage` 来预热管道。可通过 `safariWarmupAttempts` 配置。
- **Safari canvas** —— 将 box-shadow 改写为 SVG drop-shadow，并在绘制前等待图片合成完成。
- **Firefox** —— 复选框与单选按钮使用绘制替换。
- **iOS** —— `download()` 回退到 Web Share API。

## 节点级控制属性

直接在标记中进行精细控制：

- `data-capture="exclude"` —— 丢弃该节点（按 `excludeMode`）。
- `data-capture="placeholder"` + `data-placeholder-text` —— 渲染占位框而非该节点。
- `data-snapdom-sandbox` / `#snapdom-sandbox` —— 完全跳过。

---

需要完整 API 和每个选项的示例？→ **[snapdom.dev/docs](https://snapdom.dev/docs/)**
