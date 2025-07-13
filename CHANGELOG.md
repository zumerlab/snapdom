### Changelog

All notable changes to this project will be documented in this file. 

#### [v1.9.5](https://github.com/zumerlab/snapdom/compare/v1.9.3...v1.9.5)

> 14 July 2025

- Fix: add type def for `SnapOptions`. Thanks @simon1uo  [`#111`](https://github.com/zumerlab/snapdom/pull/111)
- Add `checkbox.indeterminate`. Thanks @titoBouzout [`#104`](https://github.com/zumerlab/snapdom/pull/104)
- Add mask-image CSS detection (closes #106) [`#106`](https://github.com/zumerlab/snapdom/issues/106)
- Add slot detection (closes # 97) / Fix textarea content duplication (closes #110) [`#110`](https://github.com/zumerlab/snapdom/issues/110)
- Add html-to-image to benchmark. Closes #103 [`#103`](https://github.com/zumerlab/snapdom/issues/103)


#### [v1.9.3](https://github.com/zumerlab/snapdom/compare/v1.8.0...v1.9.3)

> 10 July 2025

- Add `filter` and `exclude` options for element exclusion. Thanks @simon1uo  [`#100`](https://github.com/zumerlab/snapdom/pull/100)
- Missing `width` and `height` in types. Thanks @tarwin [`#94`](https://github.com/zumerlab/snapdom/pull/94)
- fix: type check. Thanks @17biubiu [`#77`](https://github.com/zumerlab/snapdom/pull/77)
- Core update: Capture speed is drammatically increased. Closes #72 [`#72`](https://github.com/zumerlab/snapdom/issues/72)
- Core update: tries differents methods to fetch image, even proxy for CORS denied images. Important: `crossOrigin` is now inbuilt into fetchImages(), no longer needed as option. Closes #78. Closes #73 [`#78`](https://github.com/zumerlab/snapdom/issues/78) [`#73`](https://github.com/zumerlab/snapdom/issues/73)
- Improve fetchImage() by skiping svg format. Closes #91. Closes #89 [`#91`](https://github.com/zumerlab/snapdom/issues/91) [`#89`](https://github.com/zumerlab/snapdom/issues/89)
- Add iconFont options and fix doubled icon render. Closes #51, closes #80 [`#51`](https://github.com/zumerlab/snapdom/issues/51) [`#80`](https://github.com/zumerlab/snapdom/issues/80)
- Add Layui icon font. Closes #74 [`#74`](https://github.com/zumerlab/snapdom/issues/74)
- Add Blob Types. Closes #71 [`#71`](https://github.com/zumerlab/snapdom/issues/71)
- Bug: fixes hidden last line PRE tag. Closes #75 [`#75`](https://github.com/zumerlab/snapdom/issues/75)
- Feat: handles external SVG defs. Fixes #70 [`#70`](https://github.com/zumerlab/snapdom/issues/70)
- Prevents double url encoding. Fixes #68 [`#68`](https://github.com/zumerlab/snapdom/issues/68)
- Fix scale background-image [`b1ba326`](https://github.com/zumerlab/snapdom/commit/b1ba326a3a3708a8b2958f2588354bdfa8762cc9)

#### [v1.8.0](https://github.com/zumerlab/snapdom/compare/v1.7.1...v1.8.0)

> 30 June 2025

- Fix: encode same uri multiple times.  Thanks @pedrocate! [`#65`](https://github.com/zumerlab/snapdom/pull/65)
- Avoid background-image logic duplication, closes #66 [`#66`](https://github.com/zumerlab/snapdom/issues/66)
- Improve split multiple backgrounds [`0e67a9b`](https://github.com/zumerlab/snapdom/commit/0e67a9b72fb1ea7ea4a625d5f6dc2eb40438d7cd)
- Fix background image handling, closes #57 [`#57`](https://github.com/zumerlab/snapdom/issues/57)
- Feat: sanitize rootElement to avoid CSS layout conflicts. Fixes #56, fixes #24 [`#56`](https://github.com/zumerlab/snapdom/issues/56) [`#24`](https://github.com/zumerlab/snapdom/issues/24)
- Clean transform RootElement prop [`f293e5b`](https://github.com/zumerlab/snapdom/commit/f293e5be0e3ca6a97d43467976d80175d988916d)
- Fix: canvas style props, closes #63 [`#63`](https://github.com/zumerlab/snapdom/issues/63)
- Feat: handling @import and optimice cache, closes #61 [`#61`](https://github.com/zumerlab/snapdom/issues/61)
- Compile .js to es2015, closes #58 [`#58`](https://github.com/zumerlab/snapdom/issues/58)
- Improve inlinePseudoElements() to handle decorative properties, closes #55 [`#55`](https://github.com/zumerlab/snapdom/issues/55)
- Add ::first-letter detection, closes #52 [`#52`](https://github.com/zumerlab/snapdom/issues/52)
- Add Lucide to icon font detection. Thanks @domialex! [`#50`](https://github.com/zumerlab/snapdom/pull/50)


#### [v1.7.1](https://github.com/zumerlab/snapdom/compare/v1.3.0...v1.7.1)

> 19 June 2025

- Improve inlineBackgroundImages() to support multiple background-image values. Thanks @jhbae200!  [`95a5490`](https://github.com/zumerlab/snapdom/commit/95a5490f2de5a139f39c0286111eb4e84990fd00)
- Add @font-face / FontFace() deteccion, closes #43 [`#43`](https://github.com/zumerlab/snapdom/issues/43)
- Add options.crossOrigin.  Thanks @elliots! [`49f8ac6`](https://github.com/zumerlab/snapdom/commit/49f8ac6524e3f54e67505d048a4ad34c529ab6c9)
- Fix prevent erasing non url background [`0d626cb`](https://github.com/zumerlab/snapdom/commit/0d626cb32b8958afd7e7fd6f96d5a71c6795113b)


#### [v1.3.0](https://github.com/zumerlab/snapdom/compare/v1.2.5...v1.3.0)

> 14 June 2025

- fix: double scaled images [`#38`](https://github.com/zumerlab/snapdom/pull/38)
- Fix: background img &  img base64 in pseudo elements, closes #36 [`#36`](https://github.com/zumerlab/snapdom/issues/36)
- Feat: captures input values, closes #35 [`#35`](https://github.com/zumerlab/snapdom/issues/35)
- Improve: Device Pixel Ratio handling, thanks @jswhisperer [`1a14f69`](https://github.com/zumerlab/snapdom/commit/1a14f69d340e935126b5388febe5d711c4b94e14)


#### [v1.2.5](https://github.com/zumerlab/snapdom/compare/v1.2.2...v1.2.5)

> 9 June 2025

- Fix duplicated font-icon when embedFonts is true, closes #30 [`#30`](https://github.com/zumerlab/snapdom/issues/30)
- Fix url with encode url, closes #29 [`#29`](https://github.com/zumerlab/snapdom/issues/29)
- Fix .toCanvas scale [`fb47284`](https://github.com/zumerlab/snapdom/commit/fb4728463a65620bd4f4f8f50cd8b2263ba7bbe7)


#### [v1.2.2](https://github.com/zumerlab/snapdom/compare/v1.2.1...v1.2.2)

> 4 June 2025

- Patch: type script definitions, closes #23 [`#23`](https://github.com/zumerlab/snapdom/issues/23)

#### [v1.2.1](https://github.com/zumerlab/snapdom/compare/v1.1.0...v1.2.1)

> 31 May 2025

- feat(embedFonts): also embed icon fonts when embedFonts is true [`#18`](https://github.com/zumerlab/snapdom/issues/18)
- Fix expose snapdom and preCache on browser compilation, closes #26 [`#26`](https://github.com/zumerlab/snapdom/issues/26)
- Improve icon-font conversion [`7bac4ee`](https://github.com/zumerlab/snapdom/commit/7bac4ee3b152d6364c218aaa6d2bed4ad9997943)
- Fix compress mode [`652cfe9`](https://github.com/zumerlab/snapdom/commit/652cfe9a8947029e31db6b089829fe8da87c0b42)
- Bumped version [`0cd7973`](https://github.com/zumerlab/snapdom/commit/0cd797320b92310d86df0ce6296706d1f7f0ad5d)


#### [v1.1.0](https://github.com/zumerlab/snapdom/compare/v1.0.0...v1.1.0)

> 28 May 2025

- Add typescript declaration, closes #23 [`#23`](https://github.com/zumerlab/snapdom/issues/23)
- Feat. support scrolling state, closes #20 [`#20`](https://github.com/zumerlab/snapdom/issues/20)
- Fix bug by removing trim spaces, closes #21 [`#21`](https://github.com/zumerlab/snapdom/issues/21)
- Fix bug that prevent scale on png format [`77a5265`](https://github.com/zumerlab/snapdom/commit/77a52651bd0ea8ccb451f199bd3d8f9e2478bf84)

### [v1.0.0](https://github.com/zumerlab/snapdom/compare/v1.0.0-pre.1747581859131...v1.0.0)

> 19 May 2025

- format code [`146fd95`](https://github.com/zumerlab/snapdom/commit/146fd95ec93d6b842acb28272aad43f787dc954a)
- new demo gallery [`b8b2b6e`](https://github.com/zumerlab/snapdom/commit/b8b2b6eb4373999af5e67fc87418d6c6ab96199f)
- Update code documentation [`6f933bc`](https://github.com/zumerlab/snapdom/commit/6f933bca3f1e9a9054f2e0e63807dfd52dda6270)
- Add benchmarks section [`6becbb1`](https://github.com/zumerlab/snapdom/commit/6becbb12014d3cf33ec49264ca088486f08a5ce1)
- Update documentation - add precache() [`a689566`](https://github.com/zumerlab/snapdom/commit/a6895665858f9eb574b0195dc918cef680c1651b)
- Bumped version [`50d48c0`](https://github.com/zumerlab/snapdom/commit/50d48c05458e971a16375ca89da08eedad049e0c)
- chore [`9f76e0c`](https://github.com/zumerlab/snapdom/commit/9f76e0cb1e7761604693588092ac8b1796cc892e)
- update [`d84d395`](https://github.com/zumerlab/snapdom/commit/d84d39599abbd8fbd31727ff3a6650278ec0e28c)

#### [v1.0.0-pre.1747581859131](https://github.com/zumerlab/snapdom/compare/v0.9.9...v1.0.0-pre.1747581859131)

> 18 May 2025

- Fix retina and scale bug, closes #15 [`#15`](https://github.com/zumerlab/snapdom/issues/15)
- Improve public API, closes #16 [`#16`](https://github.com/zumerlab/snapdom/issues/16)
- Fix bug to render canvas with precache compress mode, closes #13 [`#13`](https://github.com/zumerlab/snapdom/issues/13)
- Update to reflect new public API [`b6024cb`](https://github.com/zumerlab/snapdom/commit/b6024cb800b848103411d4e8f4be9a7ffdb84f48)
- Update tests and benckmarks [`f06a0f8`](https://github.com/zumerlab/snapdom/commit/f06a0f835e42036a19761152cf5bf941b53d2f27)
- Add helper to check Safari [`6c9ee04`](https://github.com/zumerlab/snapdom/commit/6c9ee0484c598dd56d52e62f3de37499024ad5e5)
- Remove preWarm [`d3bd582`](https://github.com/zumerlab/snapdom/commit/d3bd582c144775617fc6221c4504466eb4cd6bef)
- Bumped version [`fb0855d`](https://github.com/zumerlab/snapdom/commit/fb0855d55eafdbcae79f537b7e1a51e2cd4d1dfc)

#### [v0.9.9](https://github.com/zumerlab/snapdom/compare/v0.9.8...v0.9.9)

> 14 May 2025

- Bumped version [`676b00d`](https://github.com/zumerlab/snapdom/commit/676b00d71b5b51ea3a90c1aa95776a9b226378a3)
- Fix bug on collectUsedTagNames() [`d627f18`](https://github.com/zumerlab/snapdom/commit/d627f18b6c0512545ab695bfae660cac8f64a9f0)
- update [`c0e64d0`](https://github.com/zumerlab/snapdom/commit/c0e64d00905898660db68f054f5f5598c3fb9581)
- Fix menu options [`8e87681`](https://github.com/zumerlab/snapdom/commit/8e876810c721fa0306c0f7d1b427ba6b111f8afe)

#### [v0.9.8](https://github.com/zumerlab/snapdom/compare/v0.9.7...v0.9.8)

> 14 May 2025

- Add font example [`26c59c8`](https://github.com/zumerlab/snapdom/commit/26c59c864aeaae80b54c22ace32e96396cb9eae6)
- Bumped version [`0819d89`](https://github.com/zumerlab/snapdom/commit/0819d89bc52af1417e31b54e695af8491b709969)
- update tests [`3cd5b70`](https://github.com/zumerlab/snapdom/commit/3cd5b70427613d7d595dd15736cb545db6411d88)
- Fix capture output format [`2afa36a`](https://github.com/zumerlab/snapdom/commit/2afa36a1c41ff798ded5b7f8ecef1632e08ab716)
- Update index.html [`0345fb1`](https://github.com/zumerlab/snapdom/commit/0345fb1f177297db0e17141c5737f9b3b510e6ca)
- Add demo site [`88d0faa`](https://github.com/zumerlab/snapdom/commit/88d0faa1b27db0d305e8b78c7280c8a5e83384a5)
- Disable user zoom [`3813580`](https://github.com/zumerlab/snapdom/commit/381358028159c51b9ed0da11e25928da490170fb)

#### [v0.9.7](https://github.com/zumerlab/snapdom/compare/v0.9.2...v0.9.7)

> 14 May 2025

- improve cache handling [`27d7b19`](https://github.com/zumerlab/snapdom/commit/27d7b19cfafeed83f4b30a824638ee7edd63e10b)
- Reorganice and add helpers [`c4f4182`](https://github.com/zumerlab/snapdom/commit/c4f4182a3e9ce636a2a263a05d75e64b33b25d7b)
- Add tests [`455e7f2`](https://github.com/zumerlab/snapdom/commit/455e7f20e8a72f6a646a7d1e900f41fb22a18666)
- Check if element to capture exists [`dfa96f2`](https://github.com/zumerlab/snapdom/commit/dfa96f2f720238fdff5df6e24b4572691ad6198f)
- Improve capture logic [`79ab1b9`](https://github.com/zumerlab/snapdom/commit/79ab1b9e165dd08a34338fe0d837b0330be48539)
- Update readme [`fdc2877`](https://github.com/zumerlab/snapdom/commit/fdc2877fd9e6fb73bc5d7bc9cf1f4a405f088be0)
- Add preCache [`48bd910`](https://github.com/zumerlab/snapdom/commit/48bd910743a638ae8ce35ab7d617ad05a75d29a2)
- Optimice [`cc638e7`](https://github.com/zumerlab/snapdom/commit/cc638e7f0f2e63a24eeee65ab4d87755e7207dec)
- Bumped version [`3b26632`](https://github.com/zumerlab/snapdom/commit/3b266324c747c4bc139b99e4978493df79a5555c)
- Add cache Maps [`091484c`](https://github.com/zumerlab/snapdom/commit/091484c00941822684afc9148a59cb23e4b34627)



#### [v0.9.2](https://github.com/zumerlab/snapdom/compare/v0.9.2-pre.1746130901718...v0.9.2)

> 1 May 2025

- chore [`2f788af`](https://github.com/zumerlab/snapdom/commit/2f788afd3b25ae6391af6a41086e0b5c3595a701)

#### [v0.9.2-pre.1746130901718](https://github.com/zumerlab/snapdom/compare/v0.9.1...v0.9.2-pre.1746130901718)

> 1 May 2025

- This PR dramatically improves the speed and accuracy of snapDOM. It increases the result size and may produce some long tasks, but it provides a solid foundation to address these side effects in the future. [`#6`](https://github.com/zumerlab/snapdom/pull/6)
- Add as draft new default approach - not implemented [`6f4ec41`](https://github.com/zumerlab/snapdom/commit/6f4ec41c7146525c9db5cfce103e131bb3f19616)
- Add tests [`bdd5a7f`](https://github.com/zumerlab/snapdom/commit/bdd5a7f491561966cd04bf72ca74185dc8e5a766)
- Feat: captures icon fonts [`7b39e5f`](https://github.com/zumerlab/snapdom/commit/7b39e5fb964bc023f6d6fad555b357de5ab113f0)
- Omit process default styles - temporary [`2953196`](https://github.com/zumerlab/snapdom/commit/2953196e00aa6bf9d026df95089d3fc81812f24d)
- update to v.0.9.2 [`e0179a1`](https://github.com/zumerlab/snapdom/commit/e0179a160e361a1e7d58ee5e83747f385cacb887)
- Add options as Object and allow bgColor on jpg and webp [`e5abaa7`](https://github.com/zumerlab/snapdom/commit/e5abaa72de77f75ebe6901935c5f539cda253db2)
- Omit delay function - temporary [`0f04721`](https://github.com/zumerlab/snapdom/commit/0f04721c458ba921694ee38117b8e0b8231a8c1a)

#### [v0.9.1](https://github.com/zumerlab/snapdom/compare/v0.9.0...v0.9.1)

> 27 April 2025

- update [`d90fcb9`](https://github.com/zumerlab/snapdom/commit/d90fcb97bdeb75a2adaaa14b25bd6ebced4a70e2)
- Bumped version [`99c286a`](https://github.com/zumerlab/snapdom/commit/99c286a8883ede66ff93aa96a62d008411e4ded0)
- fix change files prop [`548adbe`](https://github.com/zumerlab/snapdom/commit/548adbe9490b0ed4fd7e9fb77e7d6e69a6dc28c9)
- update [`f70a917`](https://github.com/zumerlab/snapdom/commit/f70a9173c7b11d659e6bf80c6ef60b9f71e652b7)

#### v0.9.0

> 27 April 2025

- first public version [`aac1d99`](https://github.com/zumerlab/snapdom/commit/aac1d997836362dd008d6372173c9dd84a76197f)
- Initial commit [`fb1c063`](https://github.com/zumerlab/snapdom/commit/fb1c06307b4b822bb898477beca46f88109ac196)