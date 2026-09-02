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

## 🚀 v3 有哪些新变化

v3 把捕获引擎彻底重写了一遍。API 的形态没变，v2 的调用方式仍然可用，但这是一个**行为确实发生变化的大版本**，把线上的捕获逻辑升级之前，请先看 [从 v2 迁移](#从-v2-迁移)。

**全面更快。**
- **首次捕获最多快 2 倍。** 引擎先对样式表做一次扫描，得出页面实际可能用到的 CSS 属性，于是每个节点的样式快照只读取约 50 个属性，而不是约 400 个：这是任何 DOM 捕获中开销最大的一环。
- **重复捕获几乎不花时间。** 同一个元素捕获几次之后，snapdom 会自动开始记忆化：内容没变的重复捕获立即返回；内容*确实*变了的时候，**差分重建**只重做发生变化的子树（在频繁更新的仪表盘上快约 5 倍），输出与完整捕获**逐字节一致**。
- 失效追踪是自动且完整的：DOM 变更、`<video>` 帧、图片与字体加载、滚动、视口尺寸变化、`<head>` 中的 CSS 改动，以及 CSS/WAAPI 动画都在追踪范围内。没有新 API 要学，也不需要任何配置。内联图片同样会自动降采样到实际显示分辨率（保留原编码格式，在 Worker 中完成）。

**默认更忠实于原页面。**
- **网页字体自动嵌入**（`embedFonts: 'auto'`）。捕获结果所依赖的那份 SVG 是一个独立文档，看不到页面已加载的字体。在 v2 中，除非你主动开启，网页字体文字会以回退字体的度量悄悄渲染。v3 会检测是否用到了网页字体，并只嵌入真正需要的部分；纯系统字体的页面完全不付出这份开销。
- **Safari 部分重写。** 隐藏的三次预热捕获已经去掉，取而代之的是验证绘制：WebKit 需要多久就等多久，一帧不多（首次捕获快约 2 倍）。而且 `toSvg()` 在 Safari 上现在返回真正的**矢量 SVG**，不再悄悄光栅化成 PNG。
- **每次捕获的状态互相隔离。** 造成捕获之间互相干扰的那个模块级可变会话已经不存在，状态改为放在贯穿整条流水线的会话对象上，因此这一类竞态在结构上无法再出现。`iconFonts` 是最后一个例外，现在也改为按捕获编译，并发捕获传入不同列表时不会再互相干扰。
- 输出也更小：同样的内容，SVG 体积最多减少 **27%**。

**更简单。**
那些需要调优知识才能用好的选项，已经自己退出了 API：重复捕获的记忆化和图片压缩现在就是引擎的固有行为，`cache` 收敛成一个调试开关，`fast` 则被移除。最好的选项，是你永远不需要去了解的那个。

**并且为下一步做好了准备。**
实验性的 `engine: 'canvas'` 通过 WICG canvas-place-element API（Chrome 需开启实验开关）用浏览器自身的绘制器输出结果：原生表单控件像素级还原，也没有 SVG 带来的各种怪癖。但目前 Chromium 会无条件污染画布，读不回像素，因此每次捕获都会回退到常规流程；既然这些字节现在还不可能执行，该引擎**不包含在发布产物中**。需要时用 `SNAPDOM_CANVAS_ENGINE=1 npm run compile` 自行构建。

## 从 v2 迁移

v2 的调用方式仍然可用，未知选项会被忽略而不是报错。发生变化的是这些行为：

| 变化 | 你需要做什么 |
| --- | --- |
| `embedFonts` 默认值变为 `'auto'`（原先是关闭）。网页字体文字现在会真正嵌入，而不是以回退字体的度量渲染。 | 通常无需处理。除非你依赖的正是那种回退渲染效果，那就传 `embedFonts: false`。 |
| `cache` 收敛为 `'soft'`（默认）和 `'disabled'`。`'auto'` / `'full'` 仍被接受，并静默映射为 `'soft'`。 | 去掉这个选项即可；调试时可以用 `cache: 'disabled'`。 |
| `fast` 已被移除。 | 删掉它，它原本的行为现在是无条件生效的。 |
| 同一元素在 2 秒内被捕获三次之后会自动记忆化，内容变更则触发差分重建。 | 一般无需处理。对于任何观察者都看不到的变化（`sheet.insertRule()`、直接修改 `rule.style.x`、canvas 像素绘制），传入 `invalidate: true`。 |
| 内联的位图默认会降采样到实际显示分辨率。 | 无需处理。原始编码格式会被保留，也绝不会放大。 |
| **`width`/`height` 的优先级现在高于 `scale`。** v2 会把两者相乘（`{ width: 800, scale: 2 }` 光栅化出 1600px 宽）；v3 把 `width`/`height` 视为绝对输出尺寸，只有两者都没设置时才应用 `scale`。这同时修正了 v2 的不一致：`toCanvas` 会乘以 `scale`，而 `toImg`/`toSvg` 会忽略它。 | 如果你依赖的是相乘后的结果，直接传最终尺寸（`width: 1600`）。 |
| 带有渲染类钩子的插件会暂停自动记忆化，除非声明 `pure: true`。 | 如果你的钩子是确定性且幂等的，加上 `pure: true`。 |
| **`filter` 与 `filterMode` 已移除，不再生效。** 它们与 `exclude`/`excludeMode` 是同一个决定的两扇门，只是极性相反（返回 `true` 表示保留）。传入时会打印警告而不是静默忽略：一个悄悄停止遮蔽的遮蔽选项是最糟的结果。 | 反转判断函数：`filter: el => keep(el)` 改写为 `exclude: el => !keep(el)`；`filterMode` 改为 `excludeMode`。 |
| 浏览器以明文绘制的输入值（`email`、`tel`、`cc-*`、`one-time-code`）现在会被原样捕获。core 只遮蔽 `type="password"`，因为该控件本来就绘制成圆点，遮蔽不损失任何保真度。 | 需要原来的遮蔽行为，请使用 `@zumer/snapdom-plugins` 中的 `redactInputs` 插件。 |

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
- [v3 有哪些新变化](#-v3-有哪些新变化)
- [从 v2 迁移](#从-v2-迁移)
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

**子路径导入**（同一个运行时的再导出，方便使用：无论从哪条路径导入，插件注册表和缓存都只有一份）：
```js
import { preCache } from '@zumer/snapdom/preCache';
import { registerPlugins, clearPlugins, getGlobalPlugins } from '@zumer/snapdom/plugins';
```
插件 API 也从根路径导出，`snapdom.plugins(...)` 会进行全局注册：
```js
import { snapdom, registerPlugins } from '@zumer/snapdom';
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
- **[选项](https://snapdom.dev/docs/options/)** — 逐项介绍所有捕获选项（`scale`、`dpr`、`embedFonts`、`useProxy`、`exclude`、`compress`、`outerTransforms`、`outerShadows`、`cache`……），并附有示例。
- **[插件](https://snapdom.dev/docs/plugins/)** — 如何构建、注册和发布自定义插件及导出格式。社区插件见[插件页面](https://snapdom.dev/plugins.html)。
- **[缓存与 preCache](https://snapdom.dev/docs/cache/)** — 控制多次捕获之间的缓存，并通过 `preCache` 提前加载所需资源。

### API 速览

`snapdom(el, options?)` 返回一个可复用对象（`toPng`、`toSvg`、`toCanvas`、`toBlob`、`toJpg`、`toWebp`、`download`、`to(name)`、`toRaw()`、`url`、`meta`、`warnings`、`needs`）。其中 `meta` 是冻结的渲染几何信息（viewBox 尺寸、逻辑捕获框、精确的 `contentX`/`contentY` 原点、解析后的裁剪窗口），文档类导出器需要它来在图像上定位内容。单次导出可使用快捷方法：

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
| `scale` | `number` | `1` | 输出缩放倍数（仅在既未设置 `width` 也未设置 `height` 时生效：这两个选项表示绝对输出尺寸，优先级更高） |
| `dpr` | `number` | `devicePixelRatio` | 栅格化输出的像素密度 |
| `width` / `height` | `number` | `null` | 目标输出尺寸（只设置一个时保持宽高比） |
| `backgroundColor` | `string` | `null`（JPEG/WebP 为 `#ffffff`） | 背景填充色 |
| `quality` | `number` | `0.92` | JPEG/WebP 质量（0–1） |
| `format` | `'png' \| 'jpeg' \| 'webp' \| 'svg'` | `'png'` | `download()` 使用的格式 |
| `type` | `string` | `'svg'` | `toBlob()` 的 Blob 类型（`'png'`、`'jpeg'`…） |
| `filename` | `string` | `'snapDOM'` | 下载文件名 |
| `embedFonts` | `boolean \| 'auto'` | `'auto'` | 内联 `@font-face`，让文字以真实字体渲染。`'auto'` 只在捕获内容确实用到网页字体时才嵌入（纯系统字体的页面会完全跳过这一步）；`true` 强制嵌入，`false` 关闭 |
| `iconFonts` | `string \| RegExp \| array` | `[]` | 图标字体的字体族（始终内嵌） |
| `localFonts` | `array` | `[]` | 显式指定字体：`{ family, src, weight?, style? }` |
| `excludeFonts` | `object` | — | 按字体族 / 域名 / 子集跳过字体 |
| `exclude` | `string \| (el) => boolean \| 两者组成的数组` | `[]` | 从捕获中排除的节点：CSS 选择器和/或判断函数（返回 `true` 表示排除），两种形式可混用 |
| `excludeMode` | `'hide' \| 'remove'` | `'hide'` | 被排除节点的处理方式 |
| `clip` | `'viewport' \| {x, y, width, height}` | `null` | 只捕获指定区域，视口外内容会被裁剪 |
| `useProxy` | `string` | `''` | 跨源图片使用的 CORS 代理前缀 |
| `fallbackURL` | `string \| fn` | — | 加载失败的 `<img>` 的兜底图片 |
| `cache` | `'disabled'` | *(结构性默认)* | `'disabled'`（或 `false`）会关闭所有缓存，仅用于调试和测试。v3 的缓存是引擎结构的一部分，不再是调优开关；`'soft'` / `'auto'` / `'full'` 仍被接受，并映射到默认行为 |
| `outerTransforms` | `boolean` | `true` | 在输出中保留根元素的平移/旋转 |
| `outerShadows` | `boolean` | `false` | 扩展边界以包含根元素的阴影/模糊/描边 |
| `reconcile` | `boolean` | `false` | 对照真实 DOM 测量克隆结果，把尺寸出现偏差的盒模型钉定为真实大小，可修复少见的文字重新换行/布局漂移问题，代价是捕获耗时大约翻倍 — 如果 snapdom 检测到某次捕获可能受益于此选项，会通过 `console.warn` 提示一次 |
| `invalidate` | `boolean` | `false` | 为自动追踪无法感知的变化（canvas 像素绘制、以编程方式修改 CSSOM）强制触发一次全新捕获，并清空按样式纪元缓存的快照。无需配合任何其他选项 |
| `engine` | `'svg' \| 'canvas'` | `'svg'` | **实验性**：在浏览器支持时，`'canvas'` 通过 WICG canvas-place-element API 用浏览器自身的绘制器输出位图（原生表单控件像素级还原），不可用时自动回退到 SVG 流程。目前 Chromium 会无条件污染画布，因此该引擎不包含在发布产物中，需要用 `SNAPDOM_CANVAS_ENGINE=1 npm run compile` 自行构建 |
| `plugins` | `array` | — | 单次捕获插件（按名称覆盖全局插件）。插件可声明 `needs: 'clone' \| 'render'`，即捕获需要运行到哪一步。默认 `'render'`（完整流程）；低于该值时不会产生图像，所有导出方法都会抛错，`result.needs` 报告实际运行到哪一步 |

📖 **[完整 API 和全部选项（附示例）→ snapdom.dev/docs](https://snapdom.dev/docs/)**

## 限制

* 外部图片需要允许跨源访问；如果被跨源拦截，可使用 `useProxy` 选项。
* Safari 不支持以 WebP 导出时，会回退为 PNG。
* SnapDOM 对 `@font-face` CSS 规则的支持较完善；如需使用 JavaScript `FontFace()`，请参阅 [`#43`](https://github.com/zumerlab/snapdom/issues/43) 中的解决方案。
* **Safari**：首次把带嵌入字体或图片的 SVG 绘制到 canvas 时可能为空（[WebKit #219770](https://bugs.webkit.org/show_bug.cgi?id=219770)）。SnapDOM 在绘制时用验证绘制（ink probe）处理，无需预热、没有配置项；首次捕获在 WebKit 需要时只多等几帧。
* **自定义滚动条样式**（`::-webkit-scrollbar`）：仅当元素**尚未滚动**时保留。元素滚动后，SnapDOM 会捕获当前视口中的内容，但不会包含滚动条。


## 性能基准测试

所有库都跑到**同一个终点——PNG data URL**，各自使用默认配置、scale 1、锁定版本。这条规则是整张
表的基础：SnapDOM 的 `toRaw` 返回的是 SVG url，跳过了栅格化和编码，而在大场景里这一步大约占总耗
时的一半。拿它去比别人已经完成的 PNG，正是基准表偏向发布方的原因。

**测试环境：** Chromium（Playwright）、无头模式、DPR 1、Apple Silicon。每个数值是**四轮完整测试
的中位数**，单位毫秒，越低越好。绝对耗时会随 CPU 和浏览器变化，值得引用的是比值。

> **自己动手跑一遍：**[snapdom.dev/compare/live](https://snapdom.dev/compare/live/) 会在你自己的
> 浏览器里运行同一套对比——相同的适配器、相同的场景、相同的像素校验器——并输出一张可以直接贴到
> issue 里的表格。

### 稳定状态——重复捕获同一个元素

| 库 | 复杂卡片 | 500 行表格 | 简单节点（1200×800） |
| --- | --- | --- | --- |
| **SnapDOM** | **11.1** | **183.0** | 12.9 |
| domlens.js 0.1.0 | 18.0 | 192.3 | 123.4 |
| modern-screenshot 4.7.0 | 30.0 | 534.2 | **12.1** |
| dom-to-image-more 3.10.2 | 32.3 | 703.8 | 17.8 |
| html-to-image 1.11.13 | 49.8 | 1,432.7 | 17.6 |
| html2canvas 1.4.1 | 83.8 | 363.1 | 90.4 |
| @renoun/screenshot 0.3.3 | 144.3 | 636.6 | 78.1 |
| dom-to-image 2.6.0 | 156.8 | 918.0 | 129.6 |
| dom-to-image-modern 1.0.2 | 157.2 | 924.5 | 131.6 |

三个场景里有两个差距小到必须明说。大表格上 SnapDOM 以 1.05× 领先——在内联样式处理阶段被收窄之前
（见下文），这一格曾以同样的幅度落后，而且两者的多轮波动区间至今仍有重叠。简单节点上
modern-screenshot 名义上快 0.8 ms：那个场景几乎没有内容要捕获，衡量的主要是所有库都要付出的
PNG 编码成本，名次在不同轮次之间会互换。复杂卡片是唯一拉开明显差距的场景，1.62×。

### 真实场景

| 场景 | SnapDOM | 次快 | 其余 |
| --- | --- | --- | --- |
| CSS 密集页面——1 万条作者样式规则、240 张仅靠 class 上样式的卡片 | **129.3** | domlens 165.5 | modern-screenshot 291.0 · dom-to-image-more 337.4 · html-to-image 590.0 |
| Shadow DOM——150 个开放 shadow root、嵌套 3 层、约 3000 个节点 | **12.1** | domlens 64.2 | modern-screenshot 120.1 · html2canvas 140.8 · dom-to-image-more 162.0 · html-to-image 432.8 |
| Web 字体——包含 Inter 400/700 与等宽代码片段的文章 | **11.3** | modern-screenshot 27.4 | dom-to-image-more 28.6 · html-to-image 39.6 |
| 图片网格——40 张同源 PNG，通过 HTTP 加载 | **57.7** | modern-screenshot 65.1 | dom-to-image-more 73.6 · domlens 75.3 · html-to-image 85.5 |
| 轮询——对同一个仪表盘连续捕获 20 次 | **19.8** | modern-screenshot 112.4 | dom-to-image-more 334.5 · domlens 490.3 |
| 深层嵌套树——16 条链 × 10 层，约 2,100 个节点 | 656 | **html2canvas 306** | domlens 666 · modern-screenshot 913 · html-to-image 1,356 |

轮询是唯一一行 SnapDOM 使用**默认配置**、开启记忆化的场景：每个 tick 都重新捕获同一个元素的仪表盘，
正是 auto-burst 与差分重捕获存在的意义。关掉记忆化（`burst: false`）后同样的循环需要 27.4 ms——
记忆化在这里带来 1.39× 的收益，而不是「未栅格化」的对比所暗示的数量级差距，因为每个 tick 仍然要
付出栅格化和 PNG 编码的成本。

CSS 密集场景对 domlens 领先 1.28×，图片网格则比看上去更接近：面对 40 张真实的 HTTP 图片，所有库都在
等同样的网络请求。网格留在表里，正是因为 SnapDOM **没有**大幅拉开差距的场景才最值得知道。

**深层嵌套树是 SnapDOM 唯一彻底落后的场景，慢 2.15×**——而且输给的是在其他每一行都最慢的
html2canvas。这个场景取自 domlens 自己的基准测试语料，他们的 README 也诚实地给出了原因：在这么大
的一张捕获里，绝大部分时间是浏览器在栅格化一张几十兆像素的 SVG 图像，而不是库自身在做的事。所有
基于 `<foreignObject>` 的实现都要付这笔账——domlens 的 SVG 引擎、modern-screenshot、
html-to-image 和 SnapDOM 都落在 656 ms 到 1,356 ms 之间；而 html2canvas 直接把盒子画到 canvas 上，
从不构建那张图像，306 ms 就结束了。这是本文里最清楚的一个例子：架构成本，而不是实现成本。

按阶段拆开看：SnapDOM 的流水线产出 SVG url 只用 **约 97 ms**，浏览器随后花 **800–1,200 ms** 栅格化
那张图像，PNG 编码约 90 ms。这一行超过 85% 的时间是一次 `drawImage`，期间我们自己的代码一行都没在
跑；而且这笔开销并不与像素数成正比，这也是它只在这里暴露出来的原因。同一份文档按 1× / 0.5× /
0.25× 的像素渲染，耗时分别是 547 / 147 / 51 ms；但一份*更小*的文档在同样的 4.2 Mpx 下只要 39 ms：
Chrome 会为每个 tile 重放整份绘制记录，所以成本随「显示项 × tile 数」增长，外加约 40 ms 的固定
开销。由此得到的交叉点大约在 **1,000 个节点 / 约 8 Mpx**。在这条线以下，SnapDOM 的领先幅度随场景
变小而扩大——同一场景在 1、2、4 条链时是 11 / 24 / 64 ms，对方是 74 / 87 / 115 ms；在这条线以上，
栅格化是一堵墙，再怎么优化流水线也够不到。

### 冷启动与稳定状态——唯一打平的一格

一次性使用的用户真正感受到的，是元素的**第一次**捕获，而不是第五次。每轮都换新元素、大表格、所有
库都输出 PNG：

| 测试项 | 毫秒 |
| --- | --- |
| domlens.js——每次捕获都换新元素 | **211.6** ← 冷启动最快 |
| SnapDOM——新元素 + `cache: 'disabled'` | 216.4 |
| SnapDOM——每次捕获都换新元素 | 218.6 |
| modern-screenshot——每次捕获都换新元素 | 595.1 |
| *SnapDOM——重复捕获同一元素，作为参照* | *150.8* |

**在冷启动的大表格上 domlens 领先 1.03×——已在轮次间的噪声范围之内。** 在内联样式处理阶段被收窄到
真正需要重新解析的属性之前，这个差距是 1.10×；那一步是逐节点执行的，所以冷启动和稳定状态同样为它付账。
SnapDOM 冷启动开销中剩下的大部分，是约 7.7 Mpx 的 `<foreignObject>` 栅格化与编码——再怎么优化流水线
也去不掉；他们常驻的 UA 默认样式探测则买下了最后那几毫秒。之所以单独写出来，是因为这是唯一一格名次
仍会在轮次之间互换的。只要同一个元素被捕获第二次，SnapDOM 就明显拉开：150.8 ms 对他们的 211.6 ms。

### 能力矩阵——由像素验证，而不是由 README 验证

每项能力都会在测试夹具里画出自己的标记色，校验器再去捕获得到的 PNG 中数这些像素。它会先证明自己
能够说「不」：同一个夹具在移除全部能力后重建，六项都必须报告为缺失。默认配置，chromium。

| 库 | Shadow DOM | 伪元素 | conic-gradient | slot 分发内容 | adoptedStyleSheets | 已绘制的 `<canvas>` | 首次捕获 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **SnapDOM** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 7 ms |
| modern-screenshot 4.7.0 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 8 ms |
| domlens.js 0.1.0 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 15 ms |
| dom-to-image-more 3.10.2 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 26 ms |
| html-to-image 1.11.13 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 31 ms |
| @renoun/screenshot 0.3.3 | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | 18 ms |
| html2canvas 1.4.1 | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | 61 ms |
| dom-to-image 2.6.0 | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | 109 ms |
| dom-to-image-modern 1.0.2 | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | 111 ms |

表格反映的是**默认配置**下的行为；html2canvas 在设置 `foreignObjectRendering: true` 后能通过
conic-gradient 和 `adoptedStyleSheets` 两项。结果也会因引擎而异——`BROWSER=all` 会为每个引擎单独
记录一张表。

### 这些表格遵守的规则

1. **同一个输出阶段。** 每一项都以 PNG data URL 结束，SnapDOM 也不例外。
2. **同样的像素量。** `scale: 1` **并且** `dpr: 1`。SnapDOM 的 `dpr` 默认取 `devicePixelRatio`，
   否则在高分屏上它编码的像素会是其他库的四倍。
3. **默认配置、锁定版本。** 不为任何一个库开小灶；调优后的配置单独成行并标注。
4. **记忆化默认关闭**（`burst: false`），只有轮询场景例外——那里它正是被测对象，并且已在标签里写明。

上面的数字来自一个纯净的测试环境。真实页面——它自己的样式表、它自己的 Web 字体——会让上述每一个库
都慢得多；在线实验室是在真实页面内部做捕获，所以它给出的数字普遍会高于这张表。这个差距里曾经有很大
一块是 SnapDOM 独有的：文档里只要存在一条作者 `::before` 规则——哪怕它一个节点都匹配不到——整次捕获
就会多走一遍递归的树遍历，500 行表格从 75 ms 涨到 197 ms，而 html2canvas 完全不受影响。现在 pseudo
处理阶段问的是「**被捕获的子树里**有没有节点可能匹配」，而不是「**文档**里有没有提到 pseudo」，这项
惩罚已经消失（197 → 66 ms）。规则确实匹配到节点的捕获保持不变：那种情况下遍历仍然必须执行。

### 运行基准测试

```sh
git clone https://github.com/zumerlab/snapdom.git
cd snapdom
npm install
npm run test:benchmark                                   # 全部
npx vitest bench __tests__/category.benchmark.js --browser.headless --watch=false
npx vitest run __tests__/category.capabilities.test.js --browser.headless --reporter=verbose
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
