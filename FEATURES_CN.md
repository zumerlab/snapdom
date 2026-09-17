# SnapDOM 功能特性

SnapDOM 在浏览器内捕获渲染后的界面状态。核心引擎提供可复用的图片和 Canvas 导出；插件提供 HTML、结构化上下文、元素映射、PDF 和录制功能。

本文是 v3 的技术功能参考。安装与示例见 [README](README.md) 和 [API 文档](https://snapdom.dev/docs/)。[English](FEATURES.md)。

## 捕获与克隆

核心引擎克隆选定的子树，记录计算样式并嵌入资源。`snapdom.fromString()` 也可捕获挂载在屏幕外的 HTML 字符串；这段标记会像页面标记一样被激活，`<img onerror>` 之类的内联事件处理器会在调用方的源中执行。不受信任的 HTML 请先清理。

| 内容 | 捕获行为 |
| --- | --- |
| 开放的 Shadow DOM | 展开 shadow root，限定样式作用域并解析已分配的 slot 内容 |
| 同源 iframe | 捕获 iframe，并从其自身文档中读取资源和字体 |
| 跨源 iframe | 使用等尺寸占位框；`placeholders: false` 时保留不可见的占位空间 |
| Canvas | 捕获当前位图，保留固有尺寸和 CSS 尺寸 |
| 视频 | 可读取时捕获当前帧，否则回退到 poster |
| 音频控件 | 使用绘制的播放器示意图 |
| 表单控件 | 保留当前值、选中/不确定状态、选区及依赖状态的样式 |
| 图片与 picture | 固定已选中的响应式资源和渲染尺寸，包括 `object-fit` 和 `object-position` |
| 内联 SVG | 保留绘制样式，并内联引用的外部定义和符号 |
| 滚动容器 | 保留滚动位置、裁剪和定位后代元素 |

核心会遮蔽密码。其他可见输入值仍会显示，除非由插件或排除规则移除。Firefox 中的复选框和单选按钮使用等效的内联 SVG 图形。

脚本、模板等不参与渲染的节点会被跳过。克隆根元素的外边距会归零，屏幕外的 `content-visibility` 内容也会参与捕获。

## 样式

- 复制计算样式，并将相同样式合并为生成的 CSS 类。保留作者样式的 `!important` 规则和内联样式优先级。
- 捕获伪元素、文字装饰、文字描边、字体可变轴和 OpenType 设置。
- 伪元素内容中的 CSS 计数器支持重置、递增、嵌套和计数器样式。
- SVG 渲染需要时，将行数限制和省略号转换为捕获文本。
- 根元素变换包括独立的 `translate`、`rotate` 和 `scale`，计算边界时会考虑变换原点。根元素的位移会被规范化；`outerTransforms: false` 还会移除旋转，但保留 `scale` 和 `skew`。
- `outerShadows: false` 移除根元素的阴影、轮廓和 `drop-shadow()`，但保留模糊。`true` 包含根元素效果；`'subtree'` 还包含后代元素的阴影。显式裁剪边界不会扩展。
- 背景、蒙版、边框图片、裁剪路径和混合模式保留捕获时的样式。
- 捕获路径支持时会包含自定义滚动条样式，以及 `<meter>`、`<progress>` 和滑块部件（`::-webkit-*` / `::-moz-*` 规则）的样式；已滚动的内容会被捕获，但不包含自定义滚动条。

`reconcile: true` 对照源元素测量带样式的克隆，校正有偏差的盒模型。它可以修复文字换行或布局差异，但需要额外的测量流程。`excludeStyleProps` 根据 RegExp 或判断函数省略指定属性。

## 图片与背景

图片、SVG 图片引用、CSS 背景层、蒙版和边框图片会被嵌入。多层背景保留定位、尺寸、重复和混合设置。`image-set()` 根据页面的设备像素比选择候选资源。

响应式图片使用浏览器已选中的资源，而非备用 `src`，同时也会解析常见的懒加载属性。图片请求复用进行中的任务并缓存资源。`useProxy` 支持代理 URL 或模板；`fallbackURL` 为加载失败的图片提供回退资源。

内联的位图会降采样到捕获所需的分辨率，并尽可能保留原编码格式。只有体积确实更小时才使用缩小后的图片。导出更大尺寸时，可恢复捕获时保存的原图，不会读取实时页面上后来更换的图片。

Canvas 尺寸受浏览器安全限制约束。过大的输出可能被缩小，并发出警告。

## 字体与图标字体

`embedFonts: 'auto'` 嵌入捕获子树实际使用的网页字体。字体处理会匹配字体族、字重、样式、拉伸比例和使用到的 Unicode 范围；纯系统字体的捕获会跳过嵌入。`true` 和 `false` 分别显式开启或关闭网页字体嵌入。

| 选项 | 用途 |
| --- | --- |
| `localFonts` | 提供包含字体族和资源地址的字体描述，可选字重、样式和拉伸比例 |
| `excludeFonts` | 排除字体族、域名或子集 |
| `fontStylesheetDomains` | 为跨源样式表扫描添加域名 |
| `iconFonts` | 通过字体族名称或匹配规则扩展图标字体识别 |

识别出的图标字体会渲染为图片，包括连字图标。资源访问仍受浏览器权限和 CORS 限制。仅通过 JavaScript 创建的字体可能需要通过 `localFonts` 显式提供资源地址。

## 导出格式

同一个捕获结果可以多次导出，无需再次克隆实时页面上的元素。

| 方法 | 返回 |
| --- | --- |
| `toRaw()` / `url` | SVG Data URL |
| `toSvg()` | 以 SVG 为数据源的 `HTMLImageElement` |
| `toCanvas()` | `HTMLCanvasElement` |
| `toBlob()` | 若捕获或导出时未显式指定格式，则返回 SVG `Blob` |
| `toPng()` | PNG `HTMLImageElement` |
| `toJpg()` / `toJpeg()` | JPEG `HTMLImageElement` |
| `toWebp()` | WebP `HTMLImageElement`；浏览器无法编码 WebP 时返回 PNG |
| `download()` | 下载指定格式 |
| `to(name, options?)` | 调用核心或插件导出器 |

静态快捷方法包括 `snapdom.toPng(element)`、`snapdom.toCanvas(element)` 和 `snapdom.download(element)`。`toImg()` 为兼容性而保留，SVG 图片请使用 `toSvg()`。JPEG 和 WebP 默认使用白色背景。iOS 上下载可使用 Web Share API。

SVG 捕获通过 `<foreignObject>` 包含 HTML，非浏览器 SVG 查看器可能无法渲染。`result.meta` 提供冻结的捕获几何信息，用于覆盖层和图片定位。`result.warnings` 提供捕获诊断信息。

## 选项

所有公开选项见[选项参考](https://snapdom.dev/docs/options/)，单次导出的选项见 [API 参考](https://snapdom.dev/docs/api/)。

- 尺寸：`width`/`height` 优先于 `scale`，最终像素尺寸还会乘以 `dpr`。
- 内容：`filter` / `filterMode` 与 `exclude` / `excludeMode` 可同时使用，并各自保留独立模式；`clip` 和 `captureSelection` 进一步控制捕获内容。
- 渲染：`backgroundColor`、`quality`、`outerTransforms`、`outerShadows` 和 `reconcile` 控制输出。
- 资源：字体选项、`useProxy`、`fallbackURL` 和 `placeholders` 控制嵌入及回退方案。
- 复用：`canvas` 接受现有渲染目标，`invalidate` 在无法自动观察的变化后刷新捕获。
- 响应性：`fast: false` 让耗时较长的捕获约每帧暂停一次，页面在捕获期间仍可绘制并响应输入，总耗时基本不变。

## 插件系统

插件可以修改克隆、替换源节点或定义导出器。通过 `snapdom.plugins(...)` 全局注册，或通过 `plugins` 选项局部注册。局部插件先运行，并覆盖同名的全局插件。

| 官方插件 | 输出或效果 |
| --- | --- |
| `html-export` | 包含嵌入样式和字体的捕获 HTML |
| `context-export` | 文本大纲或 JSON 页面上下文 |
| `agent-map` | 图片与元素映射，包含角色、名称、状态和边界框 |
| `pdf-image` | 包含 JPEG 捕获图像的可下载 PDF |
| `gif-export` / `video-export` | 在一段时间内录制当前元素 |
| `ascii-export` | 图像的文本表示 |
| `filter` / `color-tint` / `timestamp-overlay` | 修改克隆的视觉效果 |
| `replace-text` / `redact-inputs` | 替换文字和遮蔽表单值 |

单次捕获插件可声明 `needs: 'clone'` 以跳过渲染。此时核心图片导出不可用，插件仍可返回自己的数据。捕获会运行到所有附加插件所请求的最深阶段。全局注册会拒绝只需 clone 的插件。

会影响捕获的钩子默认禁用自动记忆化，除非插件声明 `pure: true`；仅处理导出的插件保留记忆化。每个结果的导出调用按顺序执行，`afterSnap` 在第一次成功导出后触发一次。

参见[官方插件参考](packages/plugins/README.md)、[钩子契约](PLUGIN_SPEC.md)和[贡献指南](CONTRIBUTING_PLUGINS.md)。

## 缓存与记忆化

符合条件且未变化的元素复用第一次捕获的结果。可安全处理的局部变化只重建受影响的子树，不确定的变化使用完整流程。Canvas、视频、iframe 和可识别的动画会重新捕获。

函数形式的 `filter`、`exclude`、`excludeStyleProps` 和 `fallbackURL` 也会触发新的捕获。每次新捕获都会重新执行适用的回调决策，包括样式和替代图片决策。仅闭包状态改变时无需 `invalidate`；已经返回的结果仍保留原来的捕获状态。

DOM 变化、交互状态、滚动、尺寸变化和资源事件会使相关缓存失效。`sheet.insertRule()` 等编程修改 CSSOM 的操作没有变化通知；下一次捕获请传入 `invalidate: true`。

资源/样式缓存与结果记忆化相互独立。`cache: 'soft'` 为默认值，旧值 `'auto'` 和 `'full'` 映射到它。`cache: 'disabled'` 或 `false` 清空并绕过持久缓存，供调试使用。

`snapdom.preCapture()` 根据用户意图提前准备捕获。它学习在控件按下/点击事件中开始的、符合条件的捕获，之后在指针进入或获得焦点时再次执行。该方法无参数，也不会轮询页面。

## 跨浏览器处理

Safari 的 SVG 图片路径会等待嵌入图片和字体完成绘制，再返回位图结果。Firefox 中原生 SVG 渲染不同的表单控件使用替代图形。编码和 Canvas 尺寸限制仍取决于浏览器。

SnapDOM 有两个渲染引擎，默认使用 SVG。第二个引擎 `html-in-canvas` 通过浏览器原生 Canvas API 绘制同一份已完成处理的克隆；使用 `engine: 'html-in-canvas'` 选择它。

第二个引擎仍处于实验阶段，需要兼容的浏览器开启 Canvas 绘制标志。通过 `SNAPDOM_CANVAS_ENGINE=1` 将它包含在构建中；默认构建只包含 SVG。不支持的捕获会回退到 SVG。

上面的导出表针对 SVG 捕获。成功的原生捕获生成位图：`url` 和 `toRaw()` 返回 PNG 数据 URL，`toSvg()` 和 `toImg()` 返回以 PNG 为源的图片，`toBlob()` 默认返回 PNG。显式请求 SVG Blob 会失败，因为该引擎不序列化 SVG。

## 节点级控制属性

| 属性 | 效果 |
| --- | --- |
| `data-capture="exclude"` | 按选定的 `excludeMode` 排除节点 |
| `data-capture="placeholder"` | 将节点替换为占位框 |
| `data-placeholder-text` | 设置占位框文本 |

SnapDOM 自身用于捕获的辅助节点始终被排除。
