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

**SnapDOM** 是新一代的 **DOM 截图引擎**，也是 **html2canvas**、**dom-to-image** 和 **html-to-image** 的快速、现代替代方案。
它能把任意 DOM 子树连同浏览器实际渲染出的样式、字体、图片和伪元素一起打包，生成不依赖原页面的结果，再导出为 SVG、PNG、JPG、WebP、Canvas 或 Blob；还可以通过插件导出为**任意自定义格式**。整个引擎速度快、模块化、易扩展，而且零依赖。

> 📖 **[文档、指南与在线演示 → snapdom.dev](https://snapdom.dev)**

## 功能特性

完整捕获 DOM，并嵌入样式、伪元素和字体；可导出为 SVG、PNG、JPG、WebP、`canvas` 或 Blob。速度快、零依赖，完全基于标准 Web API。

👉 **完整的技术功能清单见 [FEATURES_CN.md](FEATURES_CN.md)。**

## 官网与在线演示

[https://snapdom.dev](https://snapdom.dev)


## 快速开始

**一行代码将任意 DOM 元素导出为 PNG：**

```js
import { snapdom } from '@zumer/snapdom';

const img = await snapdom.toPng(document.querySelector('#card'));
document.body.appendChild(img);
```

**可复用捕获**（一次克隆，多次导出）：

```js
const result = await snapdom(document.querySelector('#card'));
await result.toPng();      // → HTMLImageElement
await result.toSvg();      // → SVG 图片
await result.download({ format: 'jpg', filename: 'card.jpg' });
```

---

## 目录

- [快速开始](#快速开始)
- [功能特性](#功能特性)
- [官网与在线演示](#官网与在线演示)
- [安装](#安装)
- [构建产物](#构建产物)
- [基本用法](#基本用法)
- [文档](#文档) — 完整的 API、选项、插件和缓存参考见 [snapdom.dev/docs](https://snapdom.dev/docs/)
- [限制](#限制)
- [性能基准测试](#性能基准测试)
- [开发](#开发)
- [贡献者](#贡献者)
- [赞助者](#赞助者)
- [支持我们](#支持我们)
- [许可证](#许可证)

## 安装

### NPM / Yarn（稳定版）

```bash
npm i @zumer/snapdom
yarn add @zumer/snapdom
```

### NPM / Yarn（开发版）

如需提前体验新功能和修复：

```bash
npm i @zumer/snapdom@dev
yarn add @zumer/snapdom@dev
```

⚠️ `@dev` 标签通常会提前包含尚未发布的改进，但稳定性可能不及正式版。

### CDN（稳定版）

```html
<!-- 压缩版 -->
<script src="https://unpkg.com/@zumer/snapdom/dist/snapdom.js"></script>

<!-- 压缩版 ES Module -->
<script type="module">
  import { snapdom } from "https://unpkg.com/@zumer/snapdom/dist/snapdom.mjs";
</script>
```

### CDN（开发版）

```html
<!-- 压缩版（开发版） -->
<script src="https://unpkg.com/@zumer/snapdom@dev/dist/snapdom.js"></script>

<!-- 压缩版 ES Module（开发版） -->
<script type="module">
  import { snapdom } from "https://unpkg.com/@zumer/snapdom@dev/dist/snapdom.mjs";
</script>
```


## 构建产物

| 变体 | 文件 | 使用场景 |
|------|------|----------|
| **ESM**（支持 Tree Shaking） | `dist/snapdom.mjs` | 打包工具（Vite、webpack）、`import` |
| **IIFE**（全局变量） | `dist/snapdom.js` | `<script>` 标签、传统 `require` |

**打包工具（npm）：**
```js
import { snapdom } from '@zumer/snapdom';  // → dist/snapdom.mjs
```

**`<script>` 标签（CDN）：**
```html
<script src="https://unpkg.com/@zumer/snapdom/dist/snapdom.js"></script>
<script> snapdom.toPng(document.body).then(img => document.body.appendChild(img)); </script>
```

**子路径导入**（只使用部分功能时，打包体积更小）：
```js
import { preCache } from '@zumer/snapdom/preCache';
import { plugins } from '@zumer/snapdom/plugins';
```


## 基本用法

| 模式 | 适用场景 |
|------|----------|
| **可复用调用** `snapdom(el)` | 克隆一次，多次导出（如 PNG、JPG 和下载）。 |
| **快捷方法** `snapdom.toPng(el)` | 只导出一次，代码更简洁。 |

### 可复用捕获

捕获一次，多次导出（无需重复克隆）：

```js
const el = document.querySelector('#target');
const result = await snapdom(el);

const img = await result.toPng();
document.body.appendChild(img);
await result.download({ format: 'jpg', filename: 'my-capture.jpg' });
```

### 一次性快捷方法

只需要一种格式时，可直接导出：

```js
const png = await snapdom.toPng(el);
const blob = await snapdom.toBlob(el);
document.body.appendChild(png);
```

## 文档

完整参考文档位于 **[snapdom.dev/docs](https://snapdom.dev/docs/)**，会随版本同步更新，也支持站内搜索：

- **[API 参考](https://snapdom.dev/docs/api/)** — `snapdom()` 返回的可复用对象、快捷方法，以及各导出方法的专用选项。
- **[选项](https://snapdom.dev/docs/options/)** — 逐项介绍所有捕获选项（`scale`、`dpr`、`embedFonts`、`useProxy`、`exclude`/`filter`、`compress`、`outerTransforms`、`outerShadows`、`cache`……），并附有示例。
- **[插件](https://snapdom.dev/docs/plugins/)** — 如何构建、注册和发布自定义插件及导出格式。社区插件见[插件页面](https://snapdom.dev/plugins.html)。
- **[缓存与 preCache](https://snapdom.dev/docs/cache/)** — 控制多次捕获之间的缓存，并通过 `preCache` 提前加载所需资源。

### API 速览

`snapdom(el, options?)` 返回一个可复用对象（`toPng`、`toSvg`、`toCanvas`、`toBlob`、`toJpg`、`toWebp`、`download`、`url`）。单次导出可使用快捷方法：

| 方法 | 说明 |
| ------------------------------ | --------------------------------- |
| `snapdom.toSvg(el, options?)`  | 返回包含 SVG 的 `HTMLImageElement` |
| `snapdom.toCanvas(el, options?)` | 返回 `HTMLCanvasElement`        |
| `snapdom.toBlob(el, options?)` | 返回包含 SVG 或位图数据的 `Blob`  |
| `snapdom.toPng(el, options?)`  | 返回 PNG 图片                     |
| `snapdom.toJpg(el, options?)`  | 返回 JPG 图片                     |
| `snapdom.toWebp(el, options?)` | 返回 WebP 图片                    |
| `snapdom.download(el, options?)` | 触发下载                         |

### 选项速览

所有选项均为可选，可传入 `snapdom(el, options)` 或任意快捷方法。

| 选项 | 类型 | 默认值 | 说明 |
| ---- | ---- | ------ | ---- |
| `scale` | `number` | `1` | 输出缩放倍数 |
| `dpr` | `number` | `devicePixelRatio` | 栅格化输出的像素密度 |
| `width` / `height` | `number` | `null` | 目标输出尺寸（只设置一个时保持宽高比） |
| `backgroundColor` | `string` | `null`（JPEG/WebP 为 `#ffffff`） | 背景填充色 |
| `quality` | `number` | `0.92` | JPEG/WebP 质量（0–1） |
| `format` | `'png' \| 'jpeg' \| 'webp' \| 'svg'` | `'png'` | `download()` 使用的格式 |
| `type` | `string` | `'svg'` | `toBlob()` 的 Blob 类型（`'png'`、`'jpeg'`…） |
| `filename` | `string` | `'snapDOM'` | 下载文件名 |
| `embedFonts` | `boolean` | `false` | 内联 `@font-face`，让文字以真实字体渲染 |
| `iconFonts` | `string \| RegExp \| array` | `[]` | 图标字体的字体族（始终内嵌） |
| `localFonts` | `array` | `[]` | 显式指定字体：`{ family, src, weight?, style? }` |
| `excludeFonts` | `object` | — | 按字体族 / 域名 / 子集跳过字体 |
| `exclude` | `string[]` | `[]` | 从捕获中排除的 CSS 选择器 |
| `filter` | `(el) => boolean` | `null` | 保留判断函数（返回 `false` 则丢弃节点） |
| `excludeMode` / `filterMode` | `'hide' \| 'remove'` | `'hide'` | 被排除节点的处理方式 |
| `clip` | `'viewport' \| {x, y, width, height}` | `null` | 只捕获指定区域，视口外内容会被裁剪 |
| `compress` | `boolean` | `true` | 将内联图片降采样到其可见分辨率 |
| `useProxy` | `string` | `''` | 跨源图片使用的 CORS 代理前缀 |
| `fallbackURL` | `string \| fn` | — | 加载失败的 `<img>` 的兜底图片 |
| `cache` | `'soft' \| 'auto' \| 'full' \| 'disabled'` | `'soft'` | 多次捕获之间的缓存策略 |
| `outerTransforms` | `boolean` | `true` | 在输出中保留根元素的平移/旋转 |
| `outerShadows` | `boolean` | `false` | 扩展边界以包含根元素的阴影/模糊/描边 |
| `fast` | `boolean` | `true` | 跳过空闲等待，加快捕获速度 |
| `plugins` | `array` | — | 单次捕获插件（按名称覆盖全局插件） |

📖 **[完整 API 和全部选项（附示例）→ snapdom.dev/docs](https://snapdom.dev/docs/)**

## 限制

* 外部图片需要允许跨源访问；如果被跨源拦截，可使用 `useProxy` 选项。
* Safari 不支持以 WebP 导出时，会回退为 PNG。
* SnapDOM 对 `@font-face` CSS 规则的支持较完善；如需使用 JavaScript `FontFace()`，请参阅 [`#43`](https://github.com/zumerlab/snapdom/issues/43) 中的解决方案。
* **Safari**：启用 `embedFonts`，或待捕获元素包含背景图/蒙版图时，受 [WebKit #219770](https://bugs.webkit.org/show_bug.cgi?id=219770)（字体解码时机）影响，捕获速度会变慢。SnapDOM 会预先执行少量捕获并调用 `drawImage` 来预热渲染流程；预热次数可通过 `safariWarmupAttempts` 调整（默认为 3）。
* **自定义滚动条样式**（`::-webkit-scrollbar`）：仅当元素**尚未滚动**时保留。元素滚动后，SnapDOM 会捕获当前视口中的内容，但不会包含滚动条。


## 性能基准测试

**测试环境：**在 Chromium 中运行仓库内的 Vitest 基准测试。实际结果可能受硬件影响。
表中数值为**平均捕获耗时（毫秒）**，越低越好。

### 简单元素

| 场景                 | SnapDOM 当前版 | SnapDOM v1.9.9 | html2canvas | html-to-image |
| ------------------------ | --------------- | -------------- | ----------- | ------------- |
| 小尺寸（200×100）          | **0.5 ms**      | 0.8 ms         | 67.7 ms     | 3.1 ms        |
| 模态框（400×300）          | **0.5 ms**      | 0.8 ms         | 75.5 ms     | 3.6 ms        |
| 页面视图（1200×800）     | **0.5 ms**      | 0.8 ms         | 114.2 ms    | 3.3 ms        |
| 大型滚动区域（2000×1500） | **0.5 ms**      | 0.8 ms         | 186.3 ms    | 3.2 ms        |
| 超大尺寸（4000×2000）   | **0.5 ms**      | 0.9 ms         | 425.9 ms    | 3.3 ms        |


### 复杂元素

| 场景                 | SnapDOM 当前版 | SnapDOM v1.9.9 | html2canvas | html-to-image |
| ------------------------ | --------------- | -------------- | ----------- | ------------- |
| 小尺寸（200×100）          | **1.6 ms**      | 3.3 ms         | 68.0 ms     | 14.3 ms       |
| 模态框（400×300）          | **2.9 ms**      | 6.8 ms         | 87.5 ms     | 34.8 ms       |
| 页面视图（1200×800）     | **17.5 ms**     | 50.2 ms        | 178.0 ms    | 429.0 ms      |
| 大型滚动区域（2000×1500） | **54.0 ms**     | 201.8 ms       | 735.2 ms    | 984.2 ms      |
| 超大尺寸（4000×2000）   | **171.4 ms**    | 453.7 ms       | 1,800.4 ms  | 2,611.9 ms    |


### 运行基准测试

```sh
git clone https://github.com/zumerlab/snapdom.git
cd snapdom
npm install
npm run test:benchmark
```


## 开发

**源码结构：**
- `src/api/` — 公开 API（`snapdom`、`preCache`）
- `src/core/` — 捕获流程、克隆、预处理与插件
- `src/modules/` — 图片、字体、伪元素、背景与 SVG
- `src/exporters/` — `toPng`、`toSvg`、`toBlob` 等导出方法
- `dist/` — 构建产物（`snapdom.js`、`snapdom.mjs`、`preCache.mjs`、`plugins.mjs`）

**构建：**
```sh
git clone https://github.com/zumerlab/snapdom.git
cd snapdom
git checkout dev
npm install
npm run compile
```

**测试：**
```sh
npx playwright install   # 浏览器测试需要
npm test
npm run test:benchmark
```

详细指南请参阅 [CONTRIBUTING](https://github.com/zumerlab/snapdom/blob/main/CONTRIBUTING.md)。


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
<a href="https://github.com/elliots" title="elliots"><img src="https://avatars.githubusercontent.com/u/622455?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="elliots"/></a>
<a href="https://github.com/stypr" title="stypr"><img src="https://avatars.githubusercontent.com/u/6625978?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="stypr"/></a>
<a href="https://github.com/mon-jai" title="mon-jai"><img src="https://avatars.githubusercontent.com/u/91261297?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="mon-jai"/></a>
<a href="https://github.com/puneetdixit200" title="puneetdixit200"><img src="https://avatars.githubusercontent.com/u/236133619?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="puneetdixit200"/></a>
<a href="https://github.com/RinZ27" title="RinZ27"><img src="https://avatars.githubusercontent.com/u/222222878?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="RinZ27"/></a>
<a href="https://github.com/sharuzzaman" title="sharuzzaman"><img src="https://avatars.githubusercontent.com/u/7421941?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="sharuzzaman"/></a>
<a href="https://github.com/simon1uo" title="simon1uo"><img src="https://avatars.githubusercontent.com/u/60037549?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="simon1uo"/></a>
<a href="https://github.com/titoBouzout" title="titoBouzout"><img src="https://avatars.githubusercontent.com/u/64156?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="titoBouzout"/></a>
<a href="https://github.com/ZiuChen" title="ZiuChen"><img src="https://avatars.githubusercontent.com/u/64892985?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="ZiuChen"/></a>
<a href="https://github.com/adajoy" title="adajoy"><img src="https://avatars.githubusercontent.com/u/26210079?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="adajoy"/></a>
<a href="https://github.com/harshasiddartha" title="harshasiddartha"><img src="https://avatars.githubusercontent.com/u/147021873?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="harshasiddartha"/></a>
</p>
<!-- CONTRIBUTORS:END -->

## 赞助者

特别感谢 [@megaphonecolin](https://github.com/megaphonecolin)、[@sdraper69](https://github.com/sdraper69)、[@reynaldichernando](https://github.com/reynaldichernando)、[@gamma-app](https://github.com/gamma-app)、[@jrjohnson](https://github.com/jrjohnson) 和 [@ryanander](https://github.com/ryanander) 对本项目的支持！

如果你也愿意支持这个项目，可以[成为赞助者](https://github.com/sponsors/tinchox5)。

## 支持我们

如果 SnapDOM 帮你节省了时间，欢迎在 GitHub 上点一个 ⭐。这能让更多开发者发现它，也是我们唯一的请求。

用 SnapDOM 构建了项目？欢迎把这个徽章添加到你的 README：

[![Built with SnapDOM](https://img.shields.io/badge/built%20with-SnapDOM-blue)](https://snapdom.dev)

```md
[![Built with SnapDOM](https://img.shields.io/badge/built%20with-SnapDOM-blue)](https://snapdom.dev)
```

### 使用 SnapDOM 的项目

SnapDOM 已用于 290 多个公开仓库的生产环境（见 [GitHub 依赖关系图](https://github.com/zumerlab/snapdom/network/dependents)）。以下列出部分有代表性的项目，每个项目都已通过其自身的 `package.json` 核实：

- [LobeHub](https://github.com/lobehub/lobehub) — AI 智能体平台
- [Trilium Notes](https://github.com/TriliumNext/Trilium) — 层级式个人知识库
- [Sealos](https://github.com/labring/sealos) — AI 原生云操作系统
- [Tencent tmagic-editor](https://github.com/Tencent/tmagic-editor) — 低代码页面编辑器
- [Playroom](https://github.com/seek-oss/playroom) — SEEK 推出的 JSX 设计工具
- [GPT-Vis](https://github.com/antvis/GPT-Vis) — 蚂蚁集团 AntV 推出的、面向 AI 的数据可视化工具
- [Rabby Wallet](https://github.com/RabbyHub/Rabby) — 面向 EVM 链的浏览器钱包
- [uMap](https://github.com/umap-project/umap) — OpenStreetMap 地图制作工具
- [ListenBrainz](https://github.com/metabrainz/listenbrainz-server) — MetaBrainz 推出的音乐收听记录服务
- [SnapDIFF](https://zumerlab.com/snapdiff/) — 浏览器内的视觉回归测试工具 *（由 Zumerlab 开发）*

完整案例见 **[snapdom.dev/made-with](https://snapdom.dev/made-with/)**。如果你的项目也在使用 SnapDOM，欢迎[提交 PR](https://github.com/zumerlab/snapdom/pulls) 添加到列表中 — 仅收录真实、可验证的项目。

## 许可证

MIT © Zumerlab
