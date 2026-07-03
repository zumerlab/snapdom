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

# snapDOM

**SnapDOM** 是新一代的 **DOM 捕获引擎（DOM Capture Engine）**——是 **html2canvas**、**dom-to-image** 和 **html-to-image** 的快速、现代替代方案。  
它可以将任意 DOM 子树转换为自包含的结构，并导出为 SVG、PNG、JPG、WebP、Canvas、Blob，或通过插件系统生成 **任何自定义格式**——超高速、模块化、可扩展、零依赖。

SnapDOM 会保留样式、字体、背景图像、伪元素、Shadow DOM 等所有视觉特性，并通过可扩展的架构实现强大的灵活性和最高级别的捕获质量。

> 📖 **[文档、指南与在线演示 → snapdom.dev](https://snapdom.dev)**

## 功能特性

完整的 DOM 捕获，内嵌样式、伪元素和字体；导出为 SVG、PNG、JPG、WebP、`canvas` 或 Blob——超快速度、零依赖，100% 基于标准 Web API。

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
- [安装](#安装)
- [构建产物](#构建产物)
- [基本用法](#基本用法)
- [文档](#文档) — 完整的 API、选项、插件和缓存参考见 [snapdom.dev/docs](https://snapdom.dev/docs/)
- [限制](#限制)
- [性能基准测试](#性能基准测试)
- [开发](#开发)
- [贡献者](#贡献者)
- [赞助者](#赞助者)
- [许可证](#许可证)

## 安装

### NPM / Yarn (稳定版)

```bash
npm i @zumer/snapdom
yarn add @zumer/snapdom
```

### NPM / Yarn (开发版)

想要提前体验新功能和修复：

```bash
npm i @zumer/snapdom@dev
yarn add @zumer/snapdom@dev
```

⚠️ `@dev` 标签通常包含在正式发布前的改进，但可能不够稳定。

### CDN (稳定版)

```html
<!-- 压缩的 构建 -->
<script src="https://unpkg.com/@zumer/snapdom/dist/snapdom.js"></script>

<!-- ES 模块构建 -->
<script type="module">
  import { snapdom } from "https://unpkg.com/@zumer/snapdom/dist/snapdom.mjs";
</script>
```

### CDN (开发版)

```html
<!-- 压缩的 UMD 构建（开发版） -->
<script src="https://unpkg.com/@zumer/snapdom@dev/dist/snapdom.js"></script>

<!-- ES 模块构建（开发版） -->
<script type="module">
  import { snapdom } from "https://unpkg.com/@zumer/snapdom@dev/dist/snapdom.mjs";
</script>
```


## 构建产物

| 变体 | 文件 | 使用场景 |
|------|------|----------|
| **ESM**（可摇树） | `dist/snapdom.mjs` | 打包工具（Vite、webpack），`import` |
| **IIFE**（全局） | `dist/snapdom.js` | script 标签、传统 `require` |

**打包工具 (npm)：**
```js
import { snapdom } from '@zumer/snapdom';  // → dist/snapdom.mjs
```

**script 标签 (CDN)：**
```html
<script src="https://unpkg.com/@zumer/snapdom/dist/snapdom.js"></script>
<script> snapdom.toPng(document.body).then(img => document.body.appendChild(img)); </script>
```

**子路径导入**（仅需部分功能时可减小体积）：
```js
import { preCache } from '@zumer/snapdom/preCache';
import { plugins } from '@zumer/snapdom/plugins';
```


## 基本用法

| 模式 | 适用场景 |
|------|----------|
| **可复用** `snapdom(el)` | 一次克隆 → 多次导出（PNG + JPG + 下载）。 |
| **快捷** `snapdom.toPng(el)` | 单次导出，代码更简洁。 |

### 可复用的捕获

一次捕获，多次导出（不会重新克隆）：

```js
const el = document.querySelector('#target');
const result = await snapdom(el);

const img = await result.toPng();
document.body.appendChild(img);
await result.download({ format: 'jpg', filename: 'my-capture.jpg' });
```

### 一步式快捷方法

直接导出单一格式：

```js
const png = await snapdom.toPng(el);
const blob = await snapdom.toBlob(el);
document.body.appendChild(png);
```

## 文档

完整参考托管在 **[snapdom.dev/docs](https://snapdom.dev/docs/)**，以保持同步且可搜索：

- **[API 参考](https://snapdom.dev/docs/api/)** — `snapdom()` 可复用对象、快捷方法和导出器专用选项。
- **[选项](https://snapdom.dev/docs/options/)** — 每个捕获选项（`scale`、`dpr`、`embedFonts`、`useProxy`、`exclude`/`filter`、`compress`、`outerTransforms`、`outerShadows`、`cache`…）均附示例说明。
- **[插件](https://snapdom.dev/docs/plugins/)** — 构建、注册并发布自定义插件和导出格式。社区插件见[插件页面](https://snapdom.dev/plugins.html)。
- **[缓存与 preCache](https://snapdom.dev/docs/cache/)** — 控制捕获之间的缓存并预加载资源。

### API 速览

`snapdom(el, options?)` 返回一个可复用对象（`toPng`、`toSvg`、`toCanvas`、`toBlob`、`toJpg`、`toWebp`、`download`、`url`）。单次导出可使用快捷方法：

| 方法 | 说明 |
| ------------------------------ | --------------------------------- |
| `snapdom.toSvg(el, options?)`  | 返回 SVG `HTMLImageElement` |
| `snapdom.toCanvas(el, options?)` | 返回 `Canvas`                    |
| `snapdom.toBlob(el, options?)` | 返回 SVG 或栅格 `Blob`            |
| `snapdom.toPng(el, options?)`  | 返回 PNG 图片                     |
| `snapdom.toJpg(el, options?)`  | 返回 JPG 图片                     |
| `snapdom.toWebp(el, options?)` | 返回 WebP 图片                    |
| `snapdom.download(el, options?)` | 触发下载                         |

📖 **[完整 API 和全部选项 → snapdom.dev/docs](https://snapdom.dev/docs/)**

## 限制

* 外部图片应该是 CORS 可访问的（使用 `useProxy` 选项处理 CORS 拒绝）
* 在 Safari 上使用 WebP 格式时，将回退到 PNG 渲染。
* `@font-face` CSS 规则得到良好支持，但如果需要使用 JS `FontFace()`，请参阅此解决方案 [`#43`](https://github.com/zumerlab/snapdom/issues/43)
* **Safari**：启用 `embedFonts` 或包含背景/蒙版图片的捕获会较慢，因 [WebKit #219770](https://bugs.webkit.org/show_bug.cgi?id=219770)（字体解码时机）。SnapDOM 通过预捕获和 `drawImage` 预热管道；可通过 `safariWarmupAttempts` 调整（默认 3）。
* **自定义滚动条样式**（`::-webkit-scrollbar`）：仅在元素*未滚动*时生效。若已滚动，将捕获视口内容且不显示滚动条。


## ⚡ 性能基准测试（Chromium）

**设置说明。** 在 Chromium 上使用 Vitest 基准测试，仓库测试。硬件可能影响结果。
数值为**平均捕获时间（毫秒）** → 越低越好。

### 简单元素

| 场景                 | SnapDOM 当前版本 | SnapDOM v1.9.9 | html2canvas | html-to-image |
| ------------------------ | --------------- | -------------- | ----------- | ------------- |
| 小尺寸 (200×100)          | **0.5 ms**      | 0.8 ms         | 67.7 ms     | 3.1 ms        |
| 模态框 (400×300)          | **0.5 ms**      | 0.8 ms         | 75.5 ms     | 3.6 ms        |
| 页面视图 (1200×800)     | **0.5 ms**      | 0.8 ms         | 114.2 ms    | 3.3 ms        |
| 大滚动 (2000×1500) | **0.5 ms**      | 0.8 ms         | 186.3 ms    | 3.2 ms        |
| 超大尺寸 (4000×2000)   | **0.5 ms**      | 0.9 ms         | 425.9 ms    | 3.3 ms        |


### 复杂元素

| 场景                 | SnapDOM 当前版本 | SnapDOM v1.9.9 | html2canvas | html-to-image |
| ------------------------ | --------------- | -------------- | ----------- | ------------- |
| 小尺寸 (200×100)          | **1.6 ms**      | 3.3 ms         | 68.0 ms     | 14.3 ms       |
| 模态框 (400×300)          | **2.9 ms**      | 6.8 ms         | 87.5 ms     | 34.8 ms       |
| 页面视图 (1200×800)     | **17.5 ms**     | 50.2 ms        | 178.0 ms    | 429.0 ms      |
| 大滚动 (2000×1500) | **54.0 ms**     | 201.8 ms       | 735.2 ms    | 984.2 ms      |
| 超大尺寸 (4000×2000)   | **171.4 ms**    | 453.7 ms       | 1,800.4 ms  | 2,611.9 ms    |


### 运行基准测试

```sh
git clone https://github.com/zumerlab/snapdom.git
cd snapdom
npm install
npm run test:benchmark
```


## 开发

**源码结构：**
- `src/api/` – 公共 API（`snapdom`、`preCache`）
- `src/core/` – 捕获流程、克隆、准备、插件
- `src/modules/` – 图片、字体、伪元素、背景、SVG
- `src/exporters/` – toPng、toSvg、toBlob 等
- `dist/` – 构建产物（`snapdom.js`、`snapdom.mjs`、`preCache.mjs`、`plugins.mjs`）

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
npx playwright install   # 浏览器测试所需
npm test
npm run test:benchmark
```

详细指南请参阅 [CONTRIBUTING](https://github.com/zumerlab/snapdom/blob/main/CONTRIBUTING.md)。


## 贡献者 🙌

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
<a href="https://github.com/harshasiddartha" title="harshasiddartha"><img src="https://avatars.githubusercontent.com/u/147021873?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="harshasiddartha"/></a>
<a href="https://github.com/karasHou" title="karasHou"><img src="https://avatars.githubusercontent.com/u/27048083?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="karasHou"/></a>
<a href="https://github.com/jhbae200" title="jhbae200"><img src="https://avatars.githubusercontent.com/u/20170610?v=4&s=100" style="border-radius:10px; width:60px; height:60px; object-fit:cover; margin:5px;" alt="jhbae200"/></a>
</p>
<!-- CONTRIBUTORS:END -->

## 💖 赞助者

特别感谢 [@megaphonecolin](https://github.com/megaphonecolin)、[@sdraper69](https://github.com/sdraper69)、[@reynaldichernando](https://github.com/reynaldichernando)、[@gamma-app](https://github.com/gamma-app)、[@jrjohnson](https://github.com/jrjohnson) 和 [@ryanander](https://github.com/ryanander) 对本项目的支持！

如果您也想支持这个项目，您可以[成为赞助者](https://github.com/sponsors/tinchox5)。

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=zumerlab/snapdom&type=Date)](https://www.star-history.com/#zumerlab/snapdom&Date)

## 许可证

MIT © Zumerlab
