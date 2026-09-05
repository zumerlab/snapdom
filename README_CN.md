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

本仓库介绍的是 **v3，目前仍为预发布版本**。下方 npm 和 CDN 命令安装的是已发布版本。使用 v3 迁移指南前，请先确认版本；npm 上目前还没有 v3 标签。

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

安装已发布版本：

```sh
npm i @zumer/snapdom
```

也可以在浏览器中加载：

```html
<script src="https://unpkg.com/@zumer/snapdom/dist/snapdom.js"></script>
<script>
  snapdom.toPng(document.querySelector('#card')).then(image => {
    document.body.appendChild(image);
  });
</script>
```

v3 发布之前，可直接使用本仓库：

```sh
npm install
npm run compile
npm run site
```

本地站点使用本地构建产物，官网演示则加载已发布的包。生产环境应固定依赖版本。

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
| `clip` | 未设置 | 捕获视口或页面坐标下的矩形区域 |
| `captureSelection` | `false` | 包含用户的文字选区 |
| `canvas` | 未设置 | 复用现有 Canvas |
| `invalidate` | `false` | 在编程修改 CSSOM 等变化后刷新捕获 |

[完整选项](https://snapdom.dev/docs/options/)还包括阴影、变换、字体、CORS、回退方案和布局校正。

### 导出 HTML 或结构化上下文

官方插件单独发布为 `@zumer/snapdom-plugins`。请使用与核心匹配的版本；本仓库包含 v3 插件源码。

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

`fromString()` 在屏幕外挂载 HTML，并在捕获后移除。请传入可信或已清理的 HTML。

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

主要调用方式仍是 `snapdom(element, options)`。升级前请检查以下变化：

| v2 | v3 | 需要调整的地方 |
| --- | --- | --- |
| 网页字体需要手动开启嵌入 | `embedFonts: 'auto'` | 通常无需调整；仅在需要省略字体时使用 `false` |
| 位图的 width/height 可能再乘以 `scale` | width/height 优先于 scale | 直接传最终尺寸，如用 `width: 400` 替代 `width: 200, scale: 2` |
| 重复捕获记忆化需要手动开启 | 符合条件的捕获自动记忆化 | 在 `sheet.insertRule()` 等无法自动观察的变化后使用 `invalidate: true` |
| `preCache` 用于准备资源 | 已移除；`preCapture()` 学习捕获意图 | 删除 `preCache`；`preCapture()` 不是直接改名后的替代方法 |
| `fast` 选择优化路径 | 已移除 | 删除该选项 |
| `filter` 返回 true 表示保留节点 | `exclude` 返回 true 表示排除节点 | 反转判断函数，并将 `filterMode` 改为 `excludeMode` |
| `cache: 'auto'` 或 `'full'` | 两者均映射为 `'soft'` | 通常可以省略；`'disabled'` / `false` 用于调试 |
| 部分可见输入值会被遮蔽 | 核心只遮蔽密码 | 其他字段需要使用 `redactInputs()` |
| `afterExport` 的返回值可以替换结果 | 钩子返回值被忽略 | 使用 `defineExports` 替换导出器 |

会影响捕获结果的插件暂停自动记忆化，除非声明 `pure: true`。只有确定性钩子才应这样声明；时间戳和读取外部状态的回调需要再次运行。参见 [v3 插件契约](PLUGIN_SPEC.md)。

## 限制

- SnapDOM 需要浏览器 DOM。服务端 Node.js 进程需要浏览器环境才能运行它。
- 跨源图片、字体和样式表必须可读取，或通过适当的代理访问。仅设置 `crossorigin` 不会获得权限，服务器也必须允许访问。跨源 iframe 使用占位框。
- SVG 输出通过 `<foreignObject>` 包含 HTML，适合在浏览器中展示；其他 SVG 查看器和文档工具的支持程度各不相同。
- 输出受浏览器渲染和 Canvas 尺寸限制影响。Safari 无法编码 WebP 时可能回退为 PNG。
- Canvas、视频和其他持续变化的内容会重新捕获。JavaScript 对 CSSOM 的修改无法被自动观察，修改后请使用 `invalidate: true`。
- 核心会捕获可见输入值。语义插件会在文本/映射输出中遮蔽敏感字段值，但如需同时隐藏附带图片中的这些像素，仍需使用 `redactInputs` 或 `exclude`。

详细行为见[技术功能与浏览器处理](FEATURES.md)。

## 性能基准测试

[测量记录](BENCHMARKS.md)分别介绍首次捕获、重复捕获和图片密集场景。[在线对比](https://snapdom.dev/compare/live/)会在你的浏览器中运行，并标明所加载的包版本。

比较时应使用相同场景、输出格式、scale 和 DPR，同时检查图像和耗时。

## 文档

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

`npm run site` 使用本地构建产物提供文档站点。`npm test` 还会应用 lint 修复。实现说明见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 贡献者

<!-- CONTRIBUTORS:START -->
<p>
<a href="https://github.com/tinchox5" title="tinchox5"><img src="https://avatars.githubusercontent.com/u/11557901?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="tinchox5"/></a>
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
<a href="https://github.com/17biubiu" title="17biubiu"><img src="https://avatars.githubusercontent.com/u/13295895?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="17biubiu"/></a>
<a href="https://github.com/av01d" title="av01d"><img src="https://avatars.githubusercontent.com/u/6247646?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="av01d"/></a>
<a href="https://github.com/CHOYSEN" title="CHOYSEN"><img src="https://avatars.githubusercontent.com/u/25995358?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="CHOYSEN"/></a>
<a href="https://github.com/pedrocateexte" title="pedrocateexte"><img src="https://avatars.githubusercontent.com/u/207524750?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="pedrocateexte"/></a>
<a href="https://github.com/claude" title="claude"><img src="https://avatars.githubusercontent.com/u/81847?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="claude"/></a>
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
<a href="https://github.com/hjl12345" title="hjl12345"><img src="https://avatars.githubusercontent.com/u/170017602?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="hjl12345"/></a>
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
