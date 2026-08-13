# SnapDOM — 功能特性

本文完整介绍 **SnapDOM** 能够捕获、嵌入和导出的内容。SnapDOM 会通过 `<foreignObject>` 将 DOM 子树序列化为自包含的 SVG，再将其光栅化为目标格式。整个过程速度快、零依赖，完全基于标准 Web API。

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

SnapDOM 会逐节点深度克隆 DOM，并记录每个节点的计算样式，从而还原浏览器实际渲染的效果。

- **Shadow DOM** — 遍历 `shadowRoot`，提取 CSS 并限定其作用域，补齐所需的 CSS 自定义属性，再通过 `assignedNodes({ flatten: true })` 解析 `<slot>` 中分配的内容（会标记插槽子树，避免重复克隆）。
- **同源 iframe** — 在当前位置转为位图并嵌入，字体从 iframe 自身的文档中读取。跨源 iframe 无法读取，因此会显示为条纹占位框；关闭 `placeholders` 后则只保留不可见的占位空间。
- **`<canvas>`** — 转存为 PNG 格式的 `<img>`（包含针对 Safari 的重试机制），并保留画布的固有尺寸和 CSS 盒模型尺寸。
- **`<video>`** — 将当前帧绘制为图片；如果失败，则使用 `poster`；同时遵循 `object-fit: contain`。
- **`<audio controls>`** — 按元素尺寸绘制播放器示意图来替代原控件。
- **表单控件状态** — 保留 `<input>` 的 `value` / `checked` / `indeterminate`、`<textarea>` 的值，以及 `<select>` 的选中项。还会复制 `disabled`、`required`、`readonly`、`min`、`max`、`pattern`、`aria-invalid` 等状态属性，使 `:disabled`、`:required`、`:read-only`、`:invalid`、`:in-range` 等伪类样式能够正确渲染。`::placeholder` 的颜色也会保留。由于 Firefox 无法在 SVG `<foreignObject>` 中可靠渲染原生复选框和单选按钮，SnapDOM 会改用等效的内联 SVG 图形，并保留控件状态和强调色。
- **`<img>`** — 固定 `srcset` 的解析结果，记录应用变换前的尺寸；当样式中使用 `%` 或 `auto` 时，将尺寸固定为像素值；同时保留 `object-fit` 和 `object-position`。
- **SVG** — 将 `fill`、`stroke` 及其各子属性、透明度相关属性、`fill-rule` / `clip-rule`、marker、`visibility`、`display` 等绘制属性复制为内联样式。对于 `<use>` 引用的外部 `<defs>` / `<symbol>`，会将定义一并内联，使 `var()` 能在 `<use>` 所在位置正确解析。
- **滚动位置** — 对已经滚动的容器，SnapDOM 会移动其内部内容并裁剪溢出区域，以还原当前滚动位置；同时调整 `fixed` / `absolute` 定位的后代元素，并将 `sticky` 页眉和页脚固定在当前显示位置。
- **有意跳过的内容** — `meta`、`script`、`noscript`、`title`、`link`、`template`、SnapDOM 沙箱，以及嵌套的 `<foreignObject>`。

无法渲染的内容也会得到妥善处理：删除非法的 XML 控制字符，强制让 `content-visibility` 对应的屏幕外内容参与渲染，并将根元素的外边距归零。

## 样式

- **内联计算样式** — 固化每个节点的计算样式，再合并相同样式并生成 CSS 类，以减小输出体积。源元素上的内联样式会替换为计算后的值，确保样式表中的 `!important` 仍按浏览器计算结果生效。
- **扫描出的属性全集** — 先对文档的作者样式做一次扫描，得出页面实际可能影响到的属性集合，于是每个节点的快照只需读取约 50 个属性，而不是约 400 个。同一次扫描还会得出各伪元素的选择器判定，用一次 `matches()` 取代每个节点三次 `getComputedStyle`。两者都按文档和样式纪元缓存。
- **保留样式细节** — 保留 `text-decoration` 的具体属性（`line`、`color`、`style`、`thickness`、`underline-offset`、`skip-ink`）、`-webkit-text-stroke`、`paint-order`；嵌入字体时，还会保留字体特性、可变轴、字距调整、变体和光学尺寸等设置。
- **`counter()` / `counters()`** — 内置完整的 CSS 计数器解析器，支持嵌套的 `counter-reset`、`counter-increment`、`counter-set` 和 `counter-style` 格式化，用于生成伪元素的 `content`。
- **`-webkit-line-clamp` 与 `text-overflow: ellipsis`** — 直接转换为带 `…` 的实际文本，因为 Firefox 和 Safari 无法在 `<foreignObject>` 中正确应用这些样式。
- **变换** — 将 `transform` 与独立的 `translate` / `rotate` / `scale` 合并为完整矩阵，并在计算边界框时考虑变换原点（见 `outerTransforms` 选项）。
- **阴影、模糊和轮廓的边界扩展** — 开启 `outerShadows` 后，会扩大 `viewBox` 以容纳 `box-shadow`、`filter: blur()`、`drop-shadow()` 和 `outline` 超出元素边界的部分；否则会移除根元素上的这些视觉效果（见 `outerShadows`）。
- **蒙版、背景与 `border-image`** — 见[图片与背景](#图片与背景)。
- **自定义滚动条** — 注入 `::-webkit-scrollbar` 规则，使自定义滚动条样式显示出来。
- **`excludeStyleProps`** — 通过正则表达式或判断函数跳过某些样式属性（例如排除所有 CSS 变量）。
- **`reconcile`** — 将带样式的克隆结果挂载到屏幕外，逐节点与真实 DOM 对比测量，只把尺寸出现偏差的盒模型钉定为真实值，可修复少见的文字重新换行/布局漂移问题，代价是捕获耗时大约翻倍；默认关闭。如果 snapdom 检测到某次捕获对已知可能需要该选项的元素做了宽度软化处理，会通过 `console.warn` 提示一次。

## 图片与背景

- **内联 `<img>`** — 解析 `currentSrc` / `src`，获取图片并转为 Data URL，缓存结果，同时确保尺寸正确。请求会分批处理，以避免超过 HTTP/1.1 的连接数限制。SVG 的 `<image href>` 也会一并内联。
- **背景与蒙版** — 内联 `background-image`（以及 `background` 简写）、`mask` / `-webkit-mask*` 和 `border-image` 中各层的 `url()`，保留多层值以及 `position`、`size`、`repeat`、`origin`、`clip`、`blend-mode`、`composite` 等相关布局属性。支持 `background-clip: text`。
- **`<picture>` 与懒加载图片** — 克隆前，将 `<picture>` 的资源和常见懒加载属性（`data-src`、`data-lazy-src`、`data-original`、`data-hi-res-src`、`data-srcset` 等）解析为实际的资源 URL。
- **跨源 / 代理** — 内置不会向外抛出异常的资源请求层，支持合并并发的相同请求、缓存错误、超时控制和自动判断凭据。`useProxy` 支持多种模板写法（`{url}`、`{urlRaw}`、以 `?url=` 结尾等）；已经过代理的 URL 以及 `data:` / `blob:` URL 会被跳过。
- **加载失败时的回退方案** — 依次尝试可配置的 `fallbackURL`（字符串或回调）、占位框，最后保留不可见的占位空间。
- **感知降采样** — 按图片的实际显示分辨率（显示区域 × `scale` × `dpr`）对已内联的位图重新采样，保留原始编码格式且绝不放大，只有在结果确实更小的时候才采用。这是引擎行为而非选项：被丢弃的像素本来就无法在输出中显示。
- **`image-set()` / `-webkit-image-set()`** — 在 `background-image` 和伪元素 `content` 中，会内联与当前设备像素比匹配的候选图片，而不是简单取第一个出现的 `url()`。
- **解码尺寸保护** — 将 SVG 光栅化时，尺寸会限制在安全范围内（单边最大 16384 px，总面积约 2.68 亿像素）；超出限制时会自动缩小并发出警告。

## 字体与图标字体

- **嵌入 `@font-face`**（`embedFonts`） — 扫描文档和 iframe 中的样式表，只嵌入与**实际使用**的字体系列、字重、样式和拉伸比例相匹配的 `@font-face` 规则，并裁剪到**实际用到的 Unicode 码点**范围，从而减小输出体积。支持近似字重匹配，并可在缺少斜体字形时合成斜体。
- **图标字体** — 自动识别 Font Awesome、Material Icons / Symbols、Ionicons、Glyphicons、Feather、Bootstrap Icons、Remix、Heroicons、Layui 和 Lucide，并通过补充规则识别其他图标字体；随后将字形（包括连字图标）渲染为图片。可通过 `iconFonts` 选项或 `window.__SNAPDOM_ICON_FONTS__` 扩展识别范围。
- **`localFonts`** — 通过 `{ family, src, weight?, style?, stretchPct? }` 传入自定义字体信息，供 SnapDOM 获取并嵌入。
- **`excludeFonts`** — 可按 `{ families?, domains?, subsets? }` 排除字体。
- **跨源样式表** — `fontStylesheetDomains` 用于指定允许读取字体样式表的额外跨源域名；KaTeX、MathJax 等已知数学库也在支持范围内。
- **`preCache`** — 捕获前预加载图片、背景图和字体；`embedFonts` 默认为 `'auto'`，语义与捕获时一致。

## 导出格式

`snapdom(el)` 调用返回一个可复用的结果对象；一次捕获，多次导出。

| 方法 | 返回 |
|---|---|
| `toRaw()` | 原始 `data:image/svg+xml` URL |
| `toSvg()` / `toImg()` | SVG `HTMLImageElement` |
| `toCanvas()` | `HTMLCanvasElement` |
| `toBlob()` | `Blob`（包含 SVG 文本或光栅化图像） |
| `toPng()` | PNG 图片 |
| `toJpg()` | JPG 图片（白色背景） |
| `toWebp()` | WebP 图片 |
| `download()` | 触发文件下载 |

同名方法也提供一次性静态快捷调用（`snapdom.toPng(el)`、`snapdom.download(el)` 等）。JPEG / WebP 等有损格式会自动用白色填充透明区域。iOS 上下载时会使用 Web Share API 作为回退方案。同一捕获会话内的导出任务会进入串行队列，并依次触发 `beforeExport` / `afterExport` / `afterSnap` 钩子。

## 选项

默认值以 `src/core/context.js` 中的规范化结果为准。

| 选项 | 默认值 | 行为 |
|---|---|---|
| `debug` | `false` | 输出调试警告 |
| `scale` | `1` | 输出缩放倍数（仅在既未设置 `width` 也未设置 `height` 时生效） |
| `exclude` | `[]` | 需要排除的节点：CSS 选择器和/或判断函数 `(el) => true`（返回 `true` 表示排除），两种形式可混用 |
| `excludeMode` | `'hide'` | `'hide'`（保留布局空间）或 `'remove'`（移除节点） |
| `filter` | `null` | 节点过滤函数 `(node) => boolean` |
| `filterMode` | `'hide'` | `'hide'`（保留布局空间）或 `'remove'`（移除节点） |
| `placeholders` | `true` | 为加载失败的图片 / 跨源 iframe 显示占位符 |
| `embedFonts` | `false` | 嵌入匹配的 `@font-face` |
| `iconFonts` | `[]` | 额外的图标字体名称或正则表达式 |
| `localFonts` | `[]` | 自定义字体描述信息 |
| `excludeFonts` | `undefined` | 字体排除规则 `{ families, domains, subsets }` |
| `fontStylesheetDomains` | `[]` | 允许读取字体样式表的额外跨源域名 |
| `fallbackURL` | `undefined` | 备用图片 URL 或回调 |
| `cache` | `'soft'` | `soft`（结构性默认）或 `disabled`（调试/测试用的关闭开关）。`auto` / `full` 作为旧版别名仍被接受，并映射为 `soft` |
| `useProxy` | `''` | 跨源代理模板或基础地址 |
| `width` | `null` | 输出宽度（保持宽高比） |
| `height` | `null` | 输出高度 |
| `format` | `'png'` | `png` / `jpg` → `jpeg` / `webp` / `svg` |
| `type` | `'svg'` | 输出类型 `svg` / `img` / `canvas` / `blob` |
| `quality` | `0.92` | 有损编码质量 |
| `dpr` | `devicePixelRatio \|\| 1` | 设备像素比 |
| `backgroundColor` | `null`（jpeg/webp 为 `#ffffff`） | 背景填充色 |
| `filename` | `'snapDOM'` | 下载文件名（不含扩展名） |
| `outerTransforms` | `true` | 规范化根元素的位移/旋转，或扩展边界以容纳变换 |
| `outerShadows` | `false` | 移除根元素的阴影，或扩展边界以容纳阴影/模糊/轮廓 |
| `clip` | `null` | 只捕获指定区域：`'viewport'`（用户当前看到的部分）或页面坐标下的 `{x,y,width,height}`。视口外的子树会在样式处理和资源内联之前被剪除，因此比整体捕获更快 |
| `engine` | `'svg'` | `'canvas'` 启用实验性的 WICG canvas-place-element 引擎。它不包含在发布产物中（见下文），不可用时自动回退到 SVG 流程 |
| `reconcile` | `false` | 对照真实 DOM 测量克隆结果，把尺寸有偏差的盒模型钉定为真实大小（捕获耗时大约翻倍） |
| `invalidate` | `false` | 为自动追踪无法感知的变化强制触发一次全新捕获，并清空按样式纪元缓存的快照 |
| `excludeStyleProps` | `null` | 用于跳过样式属性的正则表达式或判断函数 |
| `resolvePicturePlaceholders` | `true` | 内置 `<picture>` / 懒加载解析器 |
| `pictureResolver` | `{}` | `{ timeout, concurrency, resolveLazySrc, silent }` |
| `plugins` | — | 当前捕获使用的插件列表（局部插件优先） |

## 插件系统

插件是包含生命周期钩子的普通对象，可以全局注册（`snapdom.plugins(...)`，按 `name` 去重），也可以只为单次捕获注册（`{ plugins: [...] }`，同名的局部插件会覆盖全局插件）。

- **钩子**（按顺序）：`beforeSnap → beforeClone → afterClone → beforeRender → afterRender → beforeExport → afterExport → afterSnap`。
- **自定义导出方法** — 插件的 `defineExports` 可以新增或覆盖导出格式；每种格式都会在结果对象上生成对应的 `to<Name>()` 方法，并复用与内置格式相同的导出流程。
- **支持的写法** — 普通对象、`[factory, options]`、`{ plugin, options }` 或工厂函数。
- **捕获运行到哪一步**（`needs`）— 插件可声明 `'dom'`（只读实时页面，不克隆）、`'clone'`（冻结的克隆树，不出像素）或 `'render'`（默认：完整流程）。捕获会运行到所有已附加插件声明的最深一步，因此不带插件的捕获行为完全不变。低于 `'render'` 时不会产生图像：`url` 与所有导出方法都会抛错并指出是哪个插件，`result.needs` 则报告实际运行到哪一步。之所以值得声明：克隆约占一次捕获的 89%，只读实时页面的插件（例如语义导出）可以整个跳过它。

参见 [`PLUGIN_SPEC.md`](PLUGIN_SPEC.md) 与 [`CONTRIBUTING_PLUGINS.md`](CONTRIBUTING_PLUGINS.md)。

## 缓存与 preCache

- **缓存区** — `image`、`background`、`resource`、`baseStyle` 和 `defaultStyle` 使用按 FIFO 顺序淘汰的 `Map`；计算样式和布局测量提示使用 `WeakMap`；字体使用 `Set`；此外还有本次捕获会话专用的缓存区。
- **策略**（`cache` 选项）— v3 的缓存是引擎结构的一部分，不再是调优开关：
  - `soft`（默认） — 每次捕获使用独立的会话，配合按内容寻址的持久缓存。
  - `disabled` — 关闭所有缓存，仅用于调试和测试。
  - `auto` / `full` — 为兼容 v2 仍被接受，并静默映射为 `soft`。
- **失效机制** — DOM 和 `<head>` 上的 `MutationObserver`，以及字体的 `loadingdone` / `ready` 事件，都会递增样式版本号（epoch），从而自动丢弃过期快照。CSSOM 层面的修改（`sheet.insertRule`、`rule.style.x = …`）不改动任何节点，任何观察者都看不到：这正是 `invalidate: true` 的用途，它会清空按纪元缓存的快照。
- **`preCache`** — 提前预热缓存；`embedFonts` 默认为 `'auto'`，语义与捕获时一致，此处不再接受缓存策略参数。
- **重复捕获记忆化** — 引擎默认行为，无需任何选项：同一元素被反复捕获时，snapdom 会自动开始记忆化（限定范围的 `MutationObserver`，以及对 `<video>`、图片、字体、滚动、窗口尺寸、`<head>` CSS 和动画的追踪）；当只有部分子树发生变化时，差分重建只重做这些子树，输出与完整捕获逐字节一致。对于自动追踪无法感知的变化（canvas 像素绘制、以编程方式修改 CSSOM），传入 `invalidate: true` 强制一次全新捕获。

## 跨浏览器处理

- **Safari 验证绘制** — 针对 [WebKit #219770](https://bugs.webkit.org/show_bug.cgi?id=219770) 的绘制时规避方案：`toCanvas` 会以探测方式反复小幅绘制，直到检测到实际像素（有上限），因此等待时间正好是 WebKit 所需的时间。无需预热，也没有配置项。
- **Safari canvas** — 将 `box-shadow` 转换为 SVG `drop-shadow`，并在绘制前等待图片合成完成。
- **Firefox** — 原生复选框和单选按钮无法在 SVG `<foreignObject>` 中可靠渲染时，改用等效的内联 SVG 图形。
- **iOS** — `download()` 无法直接下载时，改用 Web Share API。

## 节点级控制属性

可以直接在 HTML 标记中精细控制节点的捕获方式：

- `data-capture="exclude"` — 按 `excludeMode` 隐藏或移除该节点。
- `data-capture="placeholder"` + `data-placeholder-text` — 用占位框替代该节点。
- `data-snapdom-sandbox` / `#snapdom-sandbox` — 完全不参与捕获。

---

需要完整 API 和每个选项的示例？→ **[snapdom.dev/docs](https://snapdom.dev/docs/)**
