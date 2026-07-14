# Simplified Chinese Documentation Translation Guide

This document is a reusable reference for people and AI systems maintaining SnapDOM's Simplified Chinese documentation. It records translation decisions established during the technical review requested in [Discussion #450](https://github.com/zumerlab/snapdom/discussions/450) and refined in [PR #455](https://github.com/zumerlab/snapdom/pull/455).

> This is a translation-maintenance guide, not an `AGENTS.md`, `SKILL.md`, prompt, or tool configuration. It does not override the repository's contribution rules.

## Scope

The maintained document pairs are:

| English source | Simplified Chinese translation |
|---|---|
| [`README.md`](README.md) | [`README_CN.md`](README_CN.md) |
| [`FEATURES.md`](FEATURES.md) | [`FEATURES_CN.md`](FEATURES_CN.md) |

The English documents define the intended structure and feature coverage. The implementation remains the source of truth for runtime behavior, option defaults, browser workarounds, and API semantics.

## Core principles

1. **Translate meaning, not sentence structure.** Chinese prose should read as if it were originally written for front-end developers in China.
2. **Preserve technical identifiers exactly.** Do not translate or rewrite API names, option keys, package paths, hooks, HTML tags, CSS properties, CSS values, or code symbols.
3. **Preserve verified human edits.** When syncing a later English change, update the affected Chinese passage instead of regenerating an entire file.
4. **Keep both Chinese documents consistent.** A recurring term should use the same translation in `README_CN.md` and `FEATURES_CN.md` unless the context genuinely requires different wording.
5. **Verify technical claims against code.** If the English wording is ambiguous, inspect the implementation before translating it.
6. **Prefer an explanation over a misleading literal term.** For example, describe visual content that extends outside an element's bounds instead of translating `bleed` mechanically as “出血”.

## What must remain unchanged

Keep these items byte-for-byte equivalent to the English source unless the code itself changes:

- executable code in fenced code blocks;
- import paths such as `@zumer/snapdom/preCache`;
- API and method names such as `snapdom`, `preCache`, `toPng`, and `download`;
- option names such as `outerShadows`, `embedFonts`, and `useProxy`;
- hook names such as `beforeClone` and `afterExport`;
- HTML and SVG names such as `<foreignObject>`, `<canvas>`, and `shadowRoot`;
- CSS syntax such as `backdrop-filter`, `counter()`, `background-clip: text`, and `::placeholder`;
- URLs, issue numbers, version numbers, filenames, and benchmark values.

Code comments and surrounding prose may be translated. After translating a comment, confirm that the executable part of the example is still unchanged.

## Terminology decisions

Use this table as the default glossary. Context still takes priority over mechanical replacement.

| English concept or identifier | Preferred Chinese wording | Notes |
|---|---|---|
| DOM Capture Engine | DOM 截图引擎 | Use in the reader-facing introduction. |
| capture | 捕获 | Use for the internal capture operation or pipeline. |
| embed / embedded | 嵌入 | Example: 嵌入字体. |
| inline / inlined | 内联 | Use when styles, images, or definitions are serialized into the output. |
| rasterize | 光栅化 | Prefer over a literal or unexplained transliteration. |
| cross-origin | 跨源 | Do not replace with the less precise “跨域”. |
| CORS / proxy | 跨源 / 代理 | Preserve `useProxy` and other identifiers. |
| `preCache` | `preCache` | It is a method name, not the general noun “预缓存”. Never translate it. |
| Shadow DOM | Shadow DOM | Keep the established platform term in English. |
| pseudo-element | 伪元素 | Use for `::before`, `::after`, and related concepts. |
| computed style | 计算样式 | Avoid “样式快照” unless the snapshot action is the point. |
| bounding box | 边界框 | Use a descriptive phrase when the geometry is more specific. |
| fallback | 回退方案 | “备用” may be used for a concrete fallback asset. |
| placeholder box | 占位框 | Use “占位空间” when the placeholder is intentionally invisible. |
| tree-shakeable | 支持 Tree Shaking | Do not use “可摇树”. |
| bleed | 超出元素边界的部分 / 边界扩展 | Choose the phrase that explains the actual behavior. |
| drawn replacement | 等效的内联 SVG 图形 | For Firefox checkbox/radio rendering inside `<foreignObject>`. |

When an identifier also resembles an English noun, its role decides the translation:

- `preCache` as a method name stays `preCache`.
- “warm the cache ahead of time” as a general action may be translated as “提前预热缓存”.

## Chinese writing style

- Use concise, direct sentences. Split long English sentences when that improves readability.
- Prefer “你” over “您” so the tone stays consistent across developer-facing sections.
- Avoid marketing-heavy phrases such as “最高级别的捕获质量” when a concrete technical description is available.
- Avoid machine-translation expressions such as “可摇树”, “烘焙为真实文本”, “视觉剥离”, “门控”, or “节点谓词”.
- Keep the structural em dash from the English documents as a single `—`. Do not convert it to the Chinese double em dash `——`.
- Use Chinese punctuation in ordinary prose, but do not alter punctuation inside code, URLs, option values, or package paths.
- Keep names such as SnapDOM, SVG, PNG, WebP, Canvas, Blob, Firefox, and Safari in their established forms.
- Use code formatting for identifiers when Markdown structure allows it.

## Maintaining source alignment

The Chinese files should mirror the English documents structurally without becoming literal line-by-line translations.

Preserve:

- section order and heading depth;
- table row order and option coverage;
- fenced code block count and language tags;
- links and link destinations;
- list structure;
- examples, defaults, limitations, and benchmark values.

Chinese heading text may differ, so update the corresponding table-of-contents anchor whenever a heading changes.

Do not silently add technical claims that do not exist in the English source or implementation. If the English source is inaccurate, report or fix the source separately instead of making only the Chinese document diverge.

## Technical verification examples

When a sentence describes behavior rather than wording, inspect the relevant implementation:

- option defaults: [`src/core/context.js`](src/core/context.js);
- capture and cloning behavior: [`src/core/capture.js`](src/core/capture.js) and [`src/core/clone.js`](src/core/clone.js);
- Firefox checkbox/radio SVG replacement: [`src/utils/clone.helpers.js`](src/utils/clone.helpers.js);
- images, fonts, backgrounds, and rasterization: [`src/modules/`](src/modules/);
- export return types and behavior: [`src/exporters/`](src/exporters/).

For example, “Firefox uses an equivalent inline SVG graphic for checkboxes and radio buttons” is grounded in the `<foreignObject>` workaround in `createCheckboxRadioReplacement()`. The translation should explain that behavior instead of using the vague phrase “自绘控件”.

## Recommended update workflow

1. Identify the exact English sections changed since the last Chinese sync.
2. Read the surrounding Chinese section before editing so established wording is preserved.
3. Inspect source code when the change mentions behavior, defaults, browser handling, or internal architecture.
4. Translate the changed meaning into natural Simplified Chinese.
5. Apply the same terminology decision to both Chinese documents where relevant.
6. Compare headings, tables, code blocks, links, and anchors with the English source.
7. Run the checks below.
8. Request native-speaker review when a term has multiple plausible Chinese translations.

## Validation checklist

At minimum, run:

```sh
git diff --check
rg -n '^#{1,6} ' README.md README_CN.md FEATURES.md FEATURES_CN.md
```

Review the structural counts:

```sh
for file in README.md README_CN.md FEATURES.md FEATURES_CN.md; do
  awk '
    /^#{1,6} / { headings++ }
    /^```/ { fences++ }
    /^\|/ { table_rows++ }
    END {
      printf "%s: headings=%d fences=%d table_rows=%d\n",
        FILENAME, headings, fences, table_rows
    }
  ' "$file"
done
```

Matching counts do not prove a correct translation, but mismatched counts usually reveal a dropped section, table row, or code fence.

Also verify manually that:

- executable code still matches the English examples;
- external URLs are unchanged;
- local file links resolve;
- table-of-contents anchors point to real Chinese headings;
- new options or limitations appear in both languages;
- repeated terminology is consistent across both Chinese files.

The following scan highlights known translation regressions for manual review:

```sh
rg -n '——|预缓存|跨域|可摇树|烘焙|视觉剥离|门控|谓词' README_CN.md FEATURES_CN.md
```

Treat matches as review prompts, not automatic failures. A term may still be valid in a different context.

## Using AI responsibly

- Give the AI both the English source and the current Chinese translation. Do not ask it to translate from the English file in isolation.
- Ask it to preserve code identifiers and existing human-reviewed terminology explicitly.
- Limit each pass to the changed sections when syncing a release.
- Verify technical statements against the repository instead of trusting a plausible translation.
- Have a Chinese reader review changes before describing them as manually verified.
- If AI assistance is disclosed in a PR or discussion, name the tool or model accurately and distinguish AI drafting from human review.

## Updating this guide

This guide records defaults, not immutable language rules. When a native-speaker review intentionally changes a recurring term:

1. update both Chinese documents where the term appears;
2. update the glossary or style rule here;
3. explain the decision in the PR so future contributors understand why it changed.

When uncertain, keep the technical identifier, write a clear Chinese explanation around it, and ask for review rather than inventing a translation.
