<p align="center">
  <a href="https://snapdom.dev">
    <img src="https://raw.githubusercontent.com/zumerlab/snapdom/main/docs/assets/newhero.png" width="80%">
  </a>
</p>

<p align="center">
 <a href="https://snapdom.dev">
    <img alt="Website" src="https://img.shields.io/badge/Website-snapdom.dev-2ea44f?style=flat-square">
  </a>
  <a href="https://www.npmjs.com/package/@zumer/snapdom">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@zumer/snapdom?style=flat-square&label=Version">
  </a>
  <a href="https://www.npmjs.com/package/@zumer/snapdom">
    <img alt="NPM weekly downloads" src="https://img.shields.io/npm/dw/@zumer/snapdom?style=flat-square&label=Downloads">
  </a>
  <a href="https://github.com/zumerlab/snapdom/graphs/contributors">
    <img alt="GitHub contributors" src="https://img.shields.io/github/contributors/zumerlab/snapdom?style=flat-square&label=Contributors">
  </a>
  <a href="https://github.com/zumerlab/snapdom/stargazers">
    <img alt="GitHub stars" src="https://img.shields.io/github/stars/zumerlab/snapdom?style=flat-square&label=Stars">
  </a>
  <a href="https://github.com/zumerlab/snapdom/network/members">
    <img alt="GitHub forks" src="https://img.shields.io/github/forks/zumerlab/snapdom?style=flat-square&label=Forks">
  </a>
  <a href="https://github.com/sponsors/tinchox5">
    <img alt="Sponsor tinchox5" src="https://img.shields.io/github/sponsors/tinchox5?style=flat-square&label=Sponsor">
  </a>

  <a href="https://github.com/zumerlab/snapdom/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/github/license/zumerlab/snapdom?style=flat-square">
  </a>
</p>

<p align="center"><a href="README.md">English</a> | 简体中文</p>

# SnapDOM

SnapDOM 是面向 Web 界面的浏览器捕获引擎。它将渲染后的 DOM 状态连同样式、字体和图片保存为可复用的结果。

核心引擎可导出图片和 Canvas；插件可导出自包含的 HTML、页面上下文、供视觉智能体使用的元素映射、PDF 和录制内容。捕获结果也可用于 WebGL 纹理、视觉回归测试和界面过渡。整个过程在页面内运行，使用标准 Web API，核心引擎零依赖。

[文档与演示](https://snapdom.dev/) · [技术功能](FEATURES.md) · [官方插件](packages/plugins/README.md) · [English](README.md)

本仓库介绍的是 **v3.x.x**。下方迁移指南以 **v2.x.x** 为比较基准。[v2 源码](https://github.com/zumerlab/snapdom/tree/v2)和 [v2 文档](https://snapdom.dev/v2/)仍可访问。

## 可以用它做什么

| 用途 | 输出 | 提供方 |
| --- | --- | --- |
| 分享卡片、图表、发票或仪表盘 | SVG、PNG、JPG、WebP、Canvas 或 Blob | 核心引擎 |
| 将捕获结果用于纹理、覆盖层或过渡效果 | Canvas 与捕获几何信息 | 核心引擎 |
| 保存页面片段，供以后展示 | 包含捕获样式和字体的 HTML | `html-export` 插件 |
| 为智能体或日志提供页面内容 | 文本/JSON 上下文，或附带元素映射的图片 | `context-export` / `agent-map` 插件 |
| 下载文档或录制变化中的内容 | 基于图片的 PDF、动画 GIF 或浏览器编码的视频 | `pdf-image` / `gif-export` / `video-export` 插件 |

图片、HTML 和上下文导出使用捕获时保存的状态。GIF 和视频插件则在一段时间内持续捕获当前元素。

## 快速开始

```js
import { snapdom } from '@zumer/snapdom';

const card = document.querySelector('#card');
const image = await snapdom.toPng(card);
document.body.appendChild(image);
```

需要多种输出时，捕获一次即可：

```js
const result = await snapdom(card);

const image = await result.toPng();
const canvas = await result.toCanvas();
const blob = await result.toBlob({ format: 'png' });
await result.download({ format: 'jpg', filename: 'card' });
```

即使源元素随后发生变化，结果对象仍保留这次捕获。再次调用 `snapdom(card)` 才会捕获新状态。

## 安装

安装核心，并按需安装官方插件；两者的主版本号必须一致：

```sh
npm i @zumer/snapdom@latest @zumer/snapdom-plugins@latest
```

也可以在浏览器中加载：

```html
<script src="https://unpkg.com/@zumer/snapdom@latest/dist/snapdom.js"></script>
<script>
  snapdom.toPng(document.querySelector('#card')).then(image => {
    document.body.appendChild(image);
  });
</script>
```

以 ES Module 形式从 CDN 加载：

```js
import { snapdom } from 'https://esm.sh/@zumer/snapdom@latest';
import { htmlExport } from 'https://esm.sh/@zumer/snapdom-plugins@latest/html-export';
```

`https://unpkg.com/@zumer/snapdom@latest/dist/snapdom.mjs` 提供同一份模块。这些示例加载核心和插件的最新发布版本。

如需用本仓库的本地构建运行文档站点：

```sh
npm install
npm run compile
npm run site
```

本地站点使用本地构建产物，官网演示则加载已发布的包。

### 构建产物

| 文件 | 用途 |
| --- | --- |
| `dist/snapdom.mjs` | 用于导入和打包工具的 ES Module |
| `dist/snapdom.js` | 通过 script 标签加载，提供 `window.snapdom` |
| `types/snapdom.d.ts` | TypeScript 类型声明 |

没有 CommonJS 构建产物。`@zumer/snapdom/plugins` 与包的主入口共用同一份运行时和插件注册表。

## 基本用法

### 选择输出格式

| 结果对象的方法 | 返回 |
| --- | --- |
| `toPng()`、`toJpg()`、`toWebp()` | `HTMLImageElement` |
| `toSvg()` | 以 SVG 为数据源的 `HTMLImageElement` |
| `toCanvas()` | `HTMLCanvasElement` |
| `toBlob()` | 若捕获或导出时未显式指定格式，则返回 SVG `Blob` |
| `toRaw()` / `url` | 捕获结果的 SVG Data URL |
| `download()` | 下载所选格式 |
| `to(name, options?)` | 按名称调用核心或插件导出器 |

`snapdom.toPng(element, options)` 等快捷方法在一次调用中完成捕获和导出。结果对象还提供 `toJpeg()`，作为 `toJpg()` 的别名。`toImg()` 仍然可用；导出 SVG 图片时建议使用 `toSvg()`。

### 设置尺寸与内容

```js
const result = await snapdom(card, {
  width: 800,
  dpr: 1,
  backgroundColor: '#ffffff',
  exclude: '.capture-ignore',
  excludeMode: 'remove'
});
```

`width` 和 `height` 指定输出尺寸；只设置一个时保持宽高比。只有两者都未设置时才应用 `scale`，最终像素尺寸还会乘以 `dpr`。

| 常用选项 | 默认值 | 用途 |
| --- | --- | --- |
| `scale` / `dpr` | `1` / 设备像素比 | 输出分辨率 |
| `width` / `height` | 未设置 | 输出尺寸 |
| `embedFonts` | `'auto'` | 嵌入捕获内容实际使用的网页字体 |
| `backgroundColor` | 透明；JPG/WebP 为白色 | 输出背景 |
| `exclude` | 无 | 选择器或判断函数；`true` 表示排除 |
| `excludeMode` | `'hide'` | 保留不可见的占位空间，或设为 `'remove'` |
| `filter` | 无 | 判断函数；`true` 保留节点，`false` 过滤节点 |
| `filterMode` | `'hide'` | 独立控制被 `filter` 过滤节点的布局方式 |
| `clip` | 未设置 | 捕获视口或页面坐标下的矩形区域 |
| `captureSelection` | `false` | 包含用户的文字选区 |
| `canvas` | 未设置 | 复用现有 Canvas |
| `invalidate` | `false` | 在编程修改 CSSOM 等变化后刷新捕获 |
| `fast` | `true` | 设为 `false` 时，长时间捕获期间页面仍可响应 |

[完整选项](https://snapdom.dev/docs/options/)还包括阴影、变换、字体、CORS、回退方案和布局校正。

### 分段导出超长页面

Canvas 的高度上限在 Safari 中是 16,384px，在 Chrome 和 Firefox 中是 32,767px。超过上限时，单张图片会被整体缩小。如需保持完整分辨率，先捕获一次，再用 `crop` 分段导出：

```js
const capture = await snapdom(article);
const { contentX, contentY, w0, h0 } = capture.meta;
const pieceHeight = 4000; // CSS px

for (let y = 0; y < h0; y += pieceHeight) {
  const canvas = await capture.toCanvas({
    scale: 2,
    dpr: 1,
    crop: { x: contentX, y: contentY + y, width: w0, height: Math.min(pieceHeight, h0 - y) }
  });
  // 保存或上传这一段，然后继续
}
```

`crop` 是一个矩形，不是开关。它使用 `capture.meta` 的坐标，每次调用返回一个 canvas。捕获只执行一次，重复的只是栅格化。请让 `pieceHeight × scale × dpr` 保持在上限以内，并显式设置 `dpr`，因为它默认等于设备像素比。[分块原理](https://snapdom.dev/blog/huge-page-mosaic/)。

### 导出 HTML 或结构化上下文

官方插件单独发布为 `@zumer/snapdom-plugins`，主版本号必须与核心一致；插件声明了对 v3 核心的 peer 依赖。插件源码位于本仓库的 `packages/plugins/`。

```js
import { htmlExport, contextExport } from '@zumer/snapdom-plugins';

const result = await snapdom(card, {
  plugins: [htmlExport(), contextExport({ format: 'json' })]
});

const html = await result.toHtml();
const context = await result.toContext();
```

同一套插件系统也支持覆盖层、内容遮蔽和自定义导出器。同名的局部插件优先于全局插件。参见[官方插件参考](packages/plugins/README.md)和[插件规范](PLUGIN_SPEC.md)。

### 捕获 HTML 字符串

```js
const result = await snapdom.fromString('<article>Hello</article>');
const image = await result.toPng();
```

`fromString()` 在屏幕外挂载 HTML，并在捕获后移除。这段字符串会像你自己编写的页面标记一样被解析和激活：`<img onerror>` 之类的内联事件处理器会在调用方的源（origin）中执行，挂载被移除后也可能继续执行。不受信任的 HTML 请先清理，例如使用 DOMPurify。

### 用于 WebGL 纹理

```js
const canvas = document.createElement('canvas');
const texture = new THREE.CanvasTexture(canvas);
texture.colorSpace = THREE.SRGBColorSpace;

async function refresh(element) {
  await snapdom.toCanvas(element, { canvas, scale: 1, dpr: 1 });
  texture.needsUpdate = true;
}
```

`result.meta` 包含捕获几何信息，可用于将导出的图片覆盖到原界面上。[实验示例](https://snapdom.dev/labs.html)展示了纹理、镜像和过渡效果。

## v3 有哪些新变化

- 符合条件且未变化的捕获会复用第一次的结果。可安全处理的局部变化只重建受影响的子树，其他变化使用完整捕获流程。
- 使用到的网页字体会自动嵌入；纯系统字体的捕获会跳过这一步。
- 样式处理减少了重复读取，每次捕获的状态也相互隔离，以支持并发捕获。
- Safari 图片解码和绘制保留了针对该浏览器的处理。
- `snapdom.preCapture()` 可根据用户意图提前准备捕获。当捕获在控件的按下/点击事件中开始时，它会学习这个控件；之后悬停或获得焦点时，就会提前准备同一次捕获。

```js
snapdom.preCapture();
button.onclick = () => snapdom.toPng(card);
```

图片压缩和资源缓存仍会自动处理，但光栅化与图片编码依然需要时间。参见[性能测量](BENCHMARKS.md)和[缓存指南](https://snapdom.dev/docs/cache/)。

SnapDOM 有两个渲染引擎：默认的 **SVG**，以及通过浏览器原生 Canvas API 绘制同一份捕获克隆的 **html-in-canvas**。使用 `engine: 'html-in-canvas'` 选择第二个引擎。

第二个引擎仍处于实验阶段：需要兼容的浏览器开启 Canvas 绘制标志，并使用 `SNAPDOM_CANVAS_ENGINE=1` 编译构建。默认构建只包含 SVG。不支持的捕获会回退到 SVG。成功的原生捕获生成位图，因此其 URL 和 `toRaw()` 返回 PNG，而非序列化的 SVG。详情见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 从 v2 迁移

主要调用方式仍是 `snapdom(element, options)`。本指南以 **v2.x.x** 为迁移基准。升级前请检查以下变化：

| v2 | v3 | 需要调整的地方 |
| --- | --- | --- |
| 网页字体需要手动开启嵌入 | `embedFonts: 'auto'` | 通常无需调整；仅在需要省略字体时使用 `false` |
| 位图的 width/height 可能再乘以 `scale` | width/height 优先于 scale | 直接传最终尺寸，如用 `width: 400` 替代 `width: 200, scale: 2` |
| 使用 `burst` 手动开启重复捕获记忆化 | 符合条件的捕获自动记忆化；`burst` 不再记录在文档中，也不再受支持 | 删除 `burst`（引擎仍会读取它供内部使用，请勿依赖），并在 `sheet.insertRule()` 等无法自动观察的变化后，用 `invalidate: true` 重新捕获一次 |
| `preCache` 用于准备资源 | 已移除；`preCapture()` 学习捕获意图 | 删除 `preCache`；`preCapture()` 不是直接改名后的替代方法 |
| `fast: false` 通过空闲回调进行克隆 | `fast: false` 约每帧让出一次主线程，总耗时基本不变 | 保留 `fast: false` |
| `filter` / `filterMode` 可与 `exclude` / `excludeMode` 同时使用 | 两种控制及其独立模式仍受支持；`exclude` 还支持判断函数 | 保留原有规则和模式；需要时再使用新增判断函数形式 |
| `cache: 'auto'` 或 `'full'` | 两者均映射为 `'soft'` | 通常可以省略；`'disabled'` / `false` 用于调试 |
| `compress` 控制内嵌图片降采样 | 图片优化自动进行；`compress` 不再记录在文档中，也不再受支持 | 删除 `compress`；引擎仍会读取它供内部使用，请勿依赖 |
| `resolvePicturePlaceholders` / `pictureResolver` 配置懒加载图片预处理 | 在克隆节点上解析响应式和懒加载图片；这些选项不再记录在文档中，也不再受支持 | 删除这些选项，自定义加载和超时策略应在应用中、捕获前完成；引擎仍会读取 `resolvePicturePlaceholders` 供内部使用，请勿依赖 |
| 部分可见输入值会被遮蔽 | 核心只遮蔽密码 | 其他字段需要使用 `redactInputs()` |
| `afterExport` 返回值成为下一个钩子的参数，但不改变调用者收到的结果 | 返回值被忽略；钩子收到同一份导出参数 | 不再通过返回值串联钩子；用 `defineExports` 生成不同输出 |
| 插件 v2.x.x 提供 `@zumer/snapdom-plugins/html-in-canvas` | 该子路径已移除 | 使用兼容的自定义构建和核心的实验性 `engine: 'html-in-canvas'`；默认构建使用 SVG |
| TypeScript 导出 `PluginExportFacade` | 该类型名称已移除；`ctx.exports` 仍提供核心导出器 | 在 `defineExports` 中使用类型推导，或使用 `NonNullable<CaptureContext['exports']>` |

### 同时使用 filter 和 exclude

与 v2 一样，`filter` 和 `exclude` 是独立的控制项。`filter(node)` 返回 true 表示保留节点，返回 false 表示过滤掉节点；`filterMode` 决定被过滤节点如何影响布局。`exclude` 用选择器或判断函数指定额外排除的节点；其判断函数返回 true 表示排除。`excludeMode` 决定这些排除如何影响布局。一次捕获中可以同时使用两个控制项，并为它们设置不同模式：

```js
// v2 和 v3 均支持：隐藏私有字段，移除工具栏。
await snapdom(card, {
  filter: node => !node.matches('[data-private]'),
  filterMode: 'hide',
  exclude: ['.toolbar'],
  excludeMode: 'remove'
});
```

`'hide'` 保留不可见的占位空间；`'remove'` 删除节点并允许剩余内容重新排版。两者都会排除节点内容。v3 还允许 `exclude` 混合选择器和判断函数，例如 `exclude: ['.toolbar', node => node.dataset.export === 'omit']`，任意规则匹配即可排除节点。这是可选的扩展，不会替代 `filter`，也不会合并两个模式。单独提供 CSS 效果的 `filter` 插件仍然可用。

两个模式都默认为 `'hide'`。对每个节点，先检查 `data-capture="exclude"`，再检查 `exclude`，最后检查 `filter`。首个排除决定所用模式，并停止对该节点继续检查：即使 `filter` 也会以不同模式过滤该节点，只要先匹配 `exclude`，就使用 `excludeMode`。`filter` 保留 v2 的真值规则：任何假值返回都会过滤节点。

### 读取应用动态状态的回调

当 `filter`、`exclude`、`excludeStyleProps` 或 `fallbackURL` 使用函数时，每次新的捕获都会重新执行所需流程，让适用的回调读取当前应用状态，不复用旧捕获或先前回调的样式、替代图片决策。仅回调闭包状态改变时，无需使用 `invalidate`。这种即时性有代价：`filter`、`exclude`、`excludeStyleProps` 或 `fallbackURL` 使用函数时，该捕获会关闭记忆化和差异化重捕获，因此带判断函数的轮询循环每一轮都要付出一次完整捕获的开销。规则能用选择器表达时，请传选择器，以保留复用：

```js
let privateMode = false;
const options = {
  exclude: node => privateMode && node.matches('[data-private]'),
  excludeMode: 'remove'
};
const before = await snapdom(card, options);
privateMode = true;
const after = await snapdom(card, options); // 使用当前策略
```

`before` 仍保留原来的捕获状态；再次导出它不会应用新策略。请使用 `after` 这样的新捕获。节点排除和样式属性判断函数应保持同步并返回布尔值。直接修改 CSSOM 等无法自动观察的变化，仍需要 `invalidate: true`。

会影响捕获结果的插件暂停自动记忆化，除非声明 `pure: true`。只有确定性钩子才应这样声明；时间戳和读取外部状态的回调需要再次运行。参见 [v3 插件契约](PLUGIN_SPEC.md)。

## 限制

- SnapDOM 需要浏览器 DOM。服务端 Node.js 进程需要浏览器环境才能运行它。
- 跨源图片、字体和样式表必须可读取，或通过适当的代理访问。仅设置 `crossorigin` 不会获得权限，服务器也必须允许访问。跨源 iframe 使用占位框。
- SVG 输出通过 `<foreignObject>` 包含 HTML，适合在浏览器中展示；其他 SVG 查看器和文档工具的支持程度各不相同。
- 输出受浏览器渲染和 Canvas 尺寸限制影响；超长页面见[分段导出超长页面](#分段导出超长页面)。Safari 无法编码 WebP 时可能回退为 PNG。
- Canvas、视频和其他持续变化的内容会重新捕获。JavaScript 对 CSSOM 的修改无法被自动观察，修改后请使用 `invalidate: true`。
- 核心会捕获可见输入值。语义插件会在文本/映射输出中遮蔽敏感字段值，但如需同时隐藏附带图片中的这些像素，仍需使用 `redactInputs` 或 `exclude`。

详细行为见[技术功能与浏览器处理](FEATURES.md)。

## 性能基准测试

[测量记录](BENCHMARKS.md)分别介绍首次捕获、重复捕获和图片密集场景。[在线对比](https://snapdom.dev/compare/live/)会在你的浏览器中运行，并标明所加载的包版本。

比较时应使用相同场景、输出格式、scale 和 DPR，同时检查图像和耗时。

## 文档

- [v2 文档归档](https://snapdom.dev/v2/)与 [v2 源码](https://github.com/zumerlab/snapdom/tree/v2)
- [API](https://snapdom.dev/docs/api/)与[选项](https://snapdom.dev/docs/options/)
- [框架指南](https://snapdom.dev/guides/)与[使用示例](https://snapdom.dev/how-to/)
- [官方插件](packages/plugins/README.md)、[插件规范](PLUGIN_SPEC.md)与[插件贡献指南](CONTRIBUTING_PLUGINS.md)
- [架构](ARCHITECTURE.md)与[技术功能](FEATURES.md)

## 开发

在本仓库中运行：

```sh
npm install
npx playwright install
npm run compile
npm run lint
npm run test:types
npm run test:bundle
BROWSER=all npx vitest run __tests__ --browser.headless
npm run test:pack
```

`npm run site` 使用本地构建产物提供文档站点。`npm test` 检查 lint，但不会修改文件；如需自动修复，请运行 `npm run lint:fix`。实现说明见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 贡献者

<!-- CONTRIBUTORS:START -->
<p>
<a href="https://github.com/tinchox5" title="tinchox5"><img src="https://avatars.githubusercontent.com/u/11557901?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="tinchox5"/></a>
<a href="https://github.com/claude" title="claude"><img src="https://avatars.githubusercontent.com/u/81847?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="claude"/></a>
<a href="https://github.com/pdufour" title="pdufour"><img src="https://avatars.githubusercontent.com/u/1239145?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="pdufour"/></a>
<a href="https://github.com/FlavioLimaMindera" title="FlavioLimaMindera"><img src="https://avatars.githubusercontent.com/u/96424442?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="FlavioLimaMindera"/></a>
<a href="https://github.com/Jarvis2018" title="Jarvis2018"><img src="https://avatars.githubusercontent.com/u/36788851?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="Jarvis2018"/></a>
<a href="https://github.com/tarwin" title="tarwin"><img src="https://avatars.githubusercontent.com/u/646149?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="tarwin"/></a>
<a href="https://github.com/Amyuan23" title="Amyuan23"><img src="https://avatars.githubusercontent.com/u/25892910?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="Amyuan23"/></a>
<a href="https://github.com/kohaiy" title="kohaiy"><img src="https://avatars.githubusercontent.com/u/15622127?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="kohaiy"/></a>
<a href="https://github.com/airamhr9" title="airamhr9"><img src="https://avatars.githubusercontent.com/u/57371081?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="airamhr9"/></a>
<a href="https://github.com/jswhisperer" title="jswhisperer"><img src="https://avatars.githubusercontent.com/u/1177690?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="jswhisperer"/></a>
<a href="https://github.com/K1ender" title="K1ender"><img src="https://avatars.githubusercontent.com/u/146767945?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="K1ender"/></a>
<a href="https://github.com/mosuzi" title="mosuzi"><img src="https://avatars.githubusercontent.com/u/43341701?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="mosuzi"/></a>
<a href="https://github.com/ninecc" title="ninecc"><img src="https://avatars.githubusercontent.com/u/18310590?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="ninecc"/></a>
<a href="https://github.com/17biubiu" title="17biubiu"><img src="https://avatars.githubusercontent.com/u/13295895?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="17biubiu"/></a>
<a href="https://github.com/av01d" title="av01d"><img src="https://avatars.githubusercontent.com/u/6247646?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="av01d"/></a>
<a href="https://github.com/CHOYSEN" title="CHOYSEN"><img src="https://avatars.githubusercontent.com/u/25995358?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="CHOYSEN"/></a>
<a href="https://github.com/pedrocateexte" title="pedrocateexte"><img src="https://avatars.githubusercontent.com/u/207524750?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="pedrocateexte"/></a>
<a href="https://github.com/domialex" title="domialex"><img src="https://avatars.githubusercontent.com/u/4694217?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="domialex"/></a>
<a href="https://github.com/stypr" title="stypr"><img src="https://avatars.githubusercontent.com/u/6625978?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="stypr"/></a>
<a href="https://github.com/mon-jai" title="mon-jai"><img src="https://avatars.githubusercontent.com/u/91261297?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="mon-jai"/></a>
<a href="https://github.com/puneetdixit200" title="puneetdixit200"><img src="https://avatars.githubusercontent.com/u/236133619?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="puneetdixit200"/></a>
<a href="https://github.com/RexSkz" title="RexSkz"><img src="https://avatars.githubusercontent.com/u/27483702?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="RexSkz"/></a>
<a href="https://github.com/RinZ27" title="RinZ27"><img src="https://avatars.githubusercontent.com/u/222222878?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="RinZ27"/></a>
<a href="https://github.com/sharuzzaman" title="sharuzzaman"><img src="https://avatars.githubusercontent.com/u/7421941?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="sharuzzaman"/></a>
<a href="https://github.com/simon1uo" title="simon1uo"><img src="https://avatars.githubusercontent.com/u/60037549?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="simon1uo"/></a>
<a href="https://github.com/titoBouzout" title="titoBouzout"><img src="https://avatars.githubusercontent.com/u/64156?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="titoBouzout"/></a>
<a href="https://github.com/ZiuChen" title="ZiuChen"><img src="https://avatars.githubusercontent.com/u/64892985?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="ZiuChen"/></a>
<a href="https://github.com/adajoy" title="adajoy"><img src="https://avatars.githubusercontent.com/u/26210079?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="adajoy"/></a>
</p>
<!-- CONTRIBUTORS:END -->

## 赞助者

特别感谢 [@megaphonecolin](https://github.com/megaphonecolin)、[@sdraper69](https://github.com/sdraper69)、[@reynaldichernando](https://github.com/reynaldichernando)、[@gamma-app](https://github.com/gamma-app)、[@jrjohnson](https://github.com/jrjohnson) 和 [@ryanander](https://github.com/ryanander) 对本项目的支持！

如果你也愿意支持这个项目，可以[成为赞助者](https://github.com/sponsors/tinchox5)。

## 支持我们

如果 SnapDOM 帮你节省了时间，欢迎在 GitHub 上点一个星标，让更多开发者发现它。

用 SnapDOM 构建了项目？欢迎把这个徽章添加到你的 README：

[![Built with SnapDOM](https://img.shields.io/badge/built%20with-SnapDOM-blue)](https://snapdom.dev)

```md
[![Built with SnapDOM](https://img.shields.io/badge/built%20with-SnapDOM-blue)](https://snapdom.dev)
```

### 使用 SnapDOM 的项目

以下项目正在使用 SnapDOM：

- [LobeHub](https://github.com/lobehub/lobehub) — AI 智能体平台
- [Hugging Face Chat UI](https://github.com/huggingface/chat-ui) — HuggingChat 界面，使用 SnapDOM 截取作品预览
- [Sealos](https://github.com/labring/sealos) — AI 原生云操作系统
- [Tencent tmagic-editor](https://github.com/Tencent/tmagic-editor) — 低代码页面编辑器
- [Playroom](https://github.com/seek-oss/playroom) — SEEK 推出的 JSX 设计工具
- [GPT-Vis](https://github.com/antvis/GPT-Vis) — 蚂蚁集团 AntV 推出的、面向 AI 的数据可视化工具
- [Rabby Wallet](https://github.com/RabbyHub/Rabby) — 面向 EVM 链的浏览器钱包
- [uMap](https://github.com/umap-project/umap) — OpenStreetMap 地图制作工具
- [ListenBrainz](https://github.com/metabrainz/listenbrainz-server) — MetaBrainz 推出的音乐收听记录服务
- [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) — 思维导图核心库，推荐使用 SnapDOM 导出图片
- [Kong UI Components](https://github.com/Kong/public-ui-components) — Kong 仪表盘渲染器使用 SnapDOM 导出 PDF
- [SnapDIFF](https://zumerlab.com/snapdiff/) — 浏览器内的视觉回归测试工具 *（由 Zumerlab 开发）*

完整案例见 **[snapdom.dev/made-with](https://snapdom.dev/made-with/)**。如果你的项目也在使用 SnapDOM，欢迎[提交 PR](https://github.com/zumerlab/snapdom/pulls)添加到列表中，仅收录真实、可验证的项目。

## 许可证

MIT © Zumerlab
