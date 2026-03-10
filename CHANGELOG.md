### Changelog

All notable changes to this project will be documented in this file. 

#### [v2.1.0](https://github.com/zumerlab/snapdom/compare/v2.0.2...v2.1.0)

> 10 March 2026

- fix(background): inline background-image inside shadow DOM hosts [`#379`](https://github.com/zumerlab/snapdom/pull/379)
- Update URL handling to use location.origin in fonts.js [`#380`](https://github.com/zumerlab/snapdom/pull/380)
- fix: use nodeMap for source-clone alignment in inlinePseudoElements [`#381`](https://github.com/zumerlab/snapdom/pull/381)
- fix(background): properly inline background-image inside shadow DOM hosts [`#318`](https://github.com/zumerlab/snapdom/issues/318)
- update demo site [`4de1850`](https://github.com/zumerlab/snapdom/commit/4de1850d84d1698e8574fe405007fb47d6a677ea)
- feat: classify open issues by importance with priority labels and triage workflows [`246a4c4`](https://github.com/zumerlab/snapdom/commit/246a4c43eef13fe8b654e297f52a639a7ad670b1)
- Add demo in labs section. See #172 [`6c29ba3`](https://github.com/zumerlab/snapdom/commit/6c29ba3bc4776efb536a2aa349b07b06675598ac)
- fix: Enhanced font embedding functionality for dynamically injected stylesheets [`3d4985a`](https://github.com/zumerlab/snapdom/commit/3d4985a6d40963c30ff188207a62ac1e287709ba)
- fix: resolve CSS transform double-scale bug (issue #321) [`d41504b`](https://github.com/zumerlab/snapdom/commit/d41504b8dcf94454a331337c49d74928d533f49a)
- update [`7258114`](https://github.com/zumerlab/snapdom/commit/7258114a4863bf5da241bd1791845b9a9318127d)
- fix: improve demo capture functionality with Safari support and locking mechanism [`2cb3856`](https://github.com/zumerlab/snapdom/commit/2cb3856e55f0f1d8e0d2ac050d549705203fc6ae)
- refactor: update build configuration for legacy and ESM outputs, removing module structure and adding subpath exports [`94f6289`](https://github.com/zumerlab/snapdom/commit/94f62897054f37923c5cd3e4e2d3a57a0fde8db4)
- docs: update README to reflect changes in SnapDOM ESM build structure and usage instructions [`8e5a710`](https://github.com/zumerlab/snapdom/commit/8e5a7103b45ae2d326a93218c977a371407d8cec)
- fix: only change to location.origin when treating inline styles in font.js [`94c91c6`](https://github.com/zumerlab/snapdom/commit/94c91c61d57b79a083c75d27aa3025beb1dcb535)
- fix: validate fallback image data before setting source [`2c754fe`](https://github.com/zumerlab/snapdom/commit/2c754fec37e3ce18c512ff3ee61e386fcf780589)
- fix: ensure image is only appended if data URL is valid [`46957c5`](https://github.com/zumerlab/snapdom/commit/46957c51c49d766db5ad60357f5664a7cf500049)
- update [`353cf65`](https://github.com/zumerlab/snapdom/commit/353cf65a29b6de90c86b25b42b55863746972ecf)
- chore: update module paths in package.json to use .mjs extensions for ESM compatibility [`cd740af`](https://github.com/zumerlab/snapdom/commit/cd740afa662630012e3251db048d82cf6fe60f3e)
- update [`5cdca17`](https://github.com/zumerlab/snapdom/commit/5cdca1743a191f81eb5e68d62033a30959294913)
- Bumped version [`fd7a3da`](https://github.com/zumerlab/snapdom/commit/fd7a3da483ac4d6683d50d1ef8e44a4beaa1d426)
- chore: update contributors list [`3dfb19f`](https://github.com/zumerlab/snapdom/commit/3dfb19fc1db2450fd7521607be82f25904780454)
- update [`19459ea`](https://github.com/zumerlab/snapdom/commit/19459ea546bb65ced8c01a993a53c420e87ddae6)
- chore: update contributors list [`01146ca`](https://github.com/zumerlab/snapdom/commit/01146ca289965f401279998452531a6196d83da0)
- fix: ensure valid CSS text is fetched for font links [`201209f`](https://github.com/zumerlab/snapdom/commit/201209faad857dd21a01ebc2ae5dc740a33819ce)
- Merge pull request #301 from Amyuan23/fix/svg-root-font-size [`5bd53ba`](https://github.com/zumerlab/snapdom/commit/5bd53ba4887dba4664589b51651747809a89f8ab)
- Merge pull request #350 from ZiuChen/fix/remote-katex-font [`3cbbd57`](https://github.com/zumerlab/snapdom/commit/3cbbd577eae0c751fbac41cd3b3ff0aeb251ca0e)
- Merge pull request #378 from FlavioLimaMindera/fix-scale-image-issue-321 [`e53f2f8`](https://github.com/zumerlab/snapdom/commit/e53f2f8c4a83617a14c168c0c2615bde283d4696)
- Update Orbit stylesheet and script to latest version [`d68e15c`](https://github.com/zumerlab/snapdom/commit/d68e15cc084a02677c2b68d5c958030f9942a677)
- chore: update contributors list [`f4eeba0`](https://github.com/zumerlab/snapdom/commit/f4eeba0bdb7a04bb258f3cc88a7781e1b3490758)
- Fix: Inherit root font-size in SVG output [`3bdf300`](https://github.com/zumerlab/snapdom/commit/3bdf300ce417d56b928ea3c1b7258103a35f2445)
- update [`46399d9`](https://github.com/zumerlab/snapdom/commit/46399d9887d882d250e2013edac09febeb99439b)
- update [`1151373`](https://github.com/zumerlab/snapdom/commit/1151373287eae1a1bb29267988c2cf00a3394dd6)
- update [`712f465`](https://github.com/zumerlab/snapdom/commit/712f465b03c9d080f70107d3caa5959ada799ce3)
- chore: update contributors list [`4c4e079`](https://github.com/zumerlab/snapdom/commit/4c4e0792a1ae2b08556b7eaa87ffb20ffe3b99ca)
- update [`24d4fae`](https://github.com/zumerlab/snapdom/commit/24d4fae7cf45d7bfb7c54a0f9035602869713c4d)
- Merge pull request #382 from zumerlab/copilot/classify-open-issues-by-importance [`70f07eb`](https://github.com/zumerlab/snapdom/commit/70f07ebdc37aa6e9cd6cdbfa7aa97a4383c0f3ff)
- Initial plan [`46b302e`](https://github.com/zumerlab/snapdom/commit/46b302e7d195bbd76a766040a94ecf1abf2adacf)
- Merge pull request #374 from kohaiy/patch-1 [`0b21142`](https://github.com/zumerlab/snapdom/commit/0b21142b87d1874aaaa88bc7fc9630eb506ab958)
- Fix formatting in README_CN.md [`9430707`](https://github.com/zumerlab/snapdom/commit/9430707b634b05f69f6a590e03b152c0e5162956)

#### [v2.0.2](https://github.com/zumerlab/snapdom/compare/v2.0.1...v2.0.2)

> 20 January 2026

- Fix bug when captured element is SVG. Closes #324 [`#324`](https://github.com/zumerlab/snapdom/issues/324)
- Improve docs for blob [`#352`](https://github.com/zumerlab/snapdom/issues/352)
- Bumped version [`d2bd093`](https://github.com/zumerlab/snapdom/commit/d2bd093057718ee301cc65c95f5be10311fe9239)

#### [v2.0.1](https://github.com/zumerlab/snapdom/compare/v2.0.0...v2.0.1)

> 26 November 2025

- Fix spaces. Closes #326 [`#326`](https://github.com/zumerlab/snapdom/issues/326)
- Fix download options. Closes #323 [`#323`](https://github.com/zumerlab/snapdom/issues/323)
- Bumped version [`be0380a`](https://github.com/zumerlab/snapdom/commit/be0380aea0e8cc99edf023fe83f4805187716f47)
- chore: update contributors list [`f6c4329`](https://github.com/zumerlab/snapdom/commit/f6c43295f9b6c2e9201df5d4155ace0fa159e1ff)
- Update README.md [`c9f0cfb`](https://github.com/zumerlab/snapdom/commit/c9f0cfb3dfeb9b28390a2f59ea633333bcc47a68)
- chore: update contributors list [`0da6f0e`](https://github.com/zumerlab/snapdom/commit/0da6f0e9316f4b6094d22d943e573a70bed62498)
- add [`82689cc`](https://github.com/zumerlab/snapdom/commit/82689cc75270d5f476d30ed41e27fd778fd86ddc)
- fix compile args [`061ee33`](https://github.com/zumerlab/snapdom/commit/061ee33147338a507a850175caf9d1b28320ec87)
- Fix Safari Image Issue. See #330 [`ba80b6f`](https://github.com/zumerlab/snapdom/commit/ba80b6f66393886298cdb2fc7ce134d1824184f7)
- Minify mjs version [`9155d4f`](https://github.com/zumerlab/snapdom/commit/9155d4fa2e2fc4bb6a0e3d7a991fc75818644084)
- update [`ea7075c`](https://github.com/zumerlab/snapdom/commit/ea7075c32c1d802f0de9d8519de7c0d7d776dc1c)
- Add a re-export for preCache. See #332 [`acc5b79`](https://github.com/zumerlab/snapdom/commit/acc5b79a0c8d38de9f6dea5b98bf1179b54ef671)

### [v2.0.0](https://github.com/zumerlab/snapdom/compare/v2.0.0-dev.4...v2.0.0)

> 18 November 2025

- V2 release!! [`#319`](https://github.com/zumerlab/snapdom/pull/319)
- Preparing main branch for V2 [`#300`](https://github.com/zumerlab/snapdom/pull/300)
- update [`503be19`](https://github.com/zumerlab/snapdom/commit/503be19d2f588971080213f9c3d5697147c33d7b)
- update [`57dd142`](https://github.com/zumerlab/snapdom/commit/57dd142495c76d9f59bcd8e0863746a2aee824e2)
- delete [`60f6b4d`](https://github.com/zumerlab/snapdom/commit/60f6b4d989a5a6983ff3a5fef85e685587612177)
- update [`02c95f8`](https://github.com/zumerlab/snapdom/commit/02c95f8a557ad9419687afeb4d37fec712d41c04)
- Bumped version [`3d3f421`](https://github.com/zumerlab/snapdom/commit/3d3f421c4cfb626aae1ebd2651021d8869da4127)
- Modify update-contributors workflow for dual README [`973b30b`](https://github.com/zumerlab/snapdom/commit/973b30b23bad50ea651fdf447ef1ea26b64d9c45)
- Modify error handling in updateReadmes function [`44e3cc5`](https://github.com/zumerlab/snapdom/commit/44e3cc5096e76f6cf430308a60a483fc93f8c25e)
- chore: update contributors list [`f723a6e`](https://github.com/zumerlab/snapdom/commit/f723a6e593c47b34f652d8ebe4ded088e9a446f4)
- update cdn [`a4468b1`](https://github.com/zumerlab/snapdom/commit/a4468b1ac5c9178ac132dbd2149cf58d46c42f6b)
- chore: update contributors list [`0aa2e11`](https://github.com/zumerlab/snapdom/commit/0aa2e11484c42c307938f0a7205b4b3f7bb7bb6a)
- chore: update contributors list [`00b7909`](https://github.com/zumerlab/snapdom/commit/00b7909708ffbc570c6de02218c848d19967c132)
- update [`535d913`](https://github.com/zumerlab/snapdom/commit/535d913deadae81e1b63d6fc5d1d8a18eb010403)
- update [`a4599be`](https://github.com/zumerlab/snapdom/commit/a4599beb18eb36ac601f36626fdd687d0e62c015)
- Fix link to Chinese README file [`6c9b854`](https://github.com/zumerlab/snapdom/commit/6c9b854ea3d3f8b6a1cae4d4fa4af82bbd19bc3e)
- Update readme_cn.md [`61f48f4`](https://github.com/zumerlab/snapdom/commit/61f48f4bb4d52b8f6ca22a45460dbf00a36f6b4e)
- Fix formatting in readme_cn.md [`66e19d7`](https://github.com/zumerlab/snapdom/commit/66e19d78f4db78d017c3da16d38812e756eea230)
- Rename readme_cn.md to README_CN.md [`3818056`](https://github.com/zumerlab/snapdom/commit/3818056405ca6a8486225a25628ace4c2ec79e42)

#### [v2.0.0-dev.4](https://github.com/zumerlab/snapdom/compare/v2.0.0-dev.3...v2.0.0-dev.4)

> 18 November 2025

- Fix bug when img has height with % units. Closes #268 [`#268`](https://github.com/zumerlab/snapdom/issues/268)
- Feature enable tree-shakeable code [`ebb7b6a`](https://github.com/zumerlab/snapdom/commit/ebb7b6add3b47c75a450e0264d628837303def5d)
- Update docs [`f7e4e71`](https://github.com/zumerlab/snapdom/commit/f7e4e714143ed671c6e2a5dff41234c3a92d67fd)
- add test [`22ed79a`](https://github.com/zumerlab/snapdom/commit/22ed79a50ffd933a0ab620ba735464b1d841b4c6)
- Fix regression to process MathJax [`7ef116c`](https://github.com/zumerlab/snapdom/commit/7ef116cdbbfcba0793cd918b2ba8ad94e063f74f)
- Fix bug See #316 [`7efbede`](https://github.com/zumerlab/snapdom/commit/7efbede5970ed09982c06f8cfa3fe45d990d8fdf)
- Bumped version [`b648837`](https://github.com/zumerlab/snapdom/commit/b64883763e52bef62d91952d4b8e479e144c769a)

#### [v2.0.0-dev.3](https://github.com/zumerlab/snapdom/compare/v2.0.0-dev.2...v2.0.0-dev.3)

> 11 November 2025

- Reorganice helper functions [`d1fd982`](https://github.com/zumerlab/snapdom/commit/d1fd98240459f07897311a42e09c1ad3e3a48c62)
- Perf improvement [`daf0eca`](https://github.com/zumerlab/snapdom/commit/daf0eca47c0d11828e1a702b6d64d8ab7450581d)
- Fix placeholder dimensions when image loading fails [`e44b9d9`](https://github.com/zumerlab/snapdom/commit/e44b9d947efaf28fec8976dc13b398788d461d52)
- Fix translation [`792faef`](https://github.com/zumerlab/snapdom/commit/792faefe7bbed852a9fc2877e9039c8a54c88802)
- Merge pull request #308 from Amyuan23/fix/image-fallback-dimensions [`ae99fd7`](https://github.com/zumerlab/snapdom/commit/ae99fd7acf35659c8e949c10209d3340dfee9a2f)
- Bumped version [`fcc9292`](https://github.com/zumerlab/snapdom/commit/fcc92926450302d031c84d8f8e8a8ce6f7edfa6c)

#### [v2.0.0-dev.2](https://github.com/zumerlab/snapdom/compare/v2.0.0-dev.1...v2.0.0-dev.2)

> 9 November 2025

- Integrate createBackground into toCanvas. Closes #297 [`#297`](https://github.com/zumerlab/snapdom/issues/297)
- Add Chinese translation of README.md (readme_cn.md) [`#298`](https://github.com/zumerlab/snapdom/issues/298)
- Update p [`d48e067`](https://github.com/zumerlab/snapdom/commit/d48e067c5288509391cfef557199bb33263a4773)
- revert [`5b8a97a`](https://github.com/zumerlab/snapdom/commit/5b8a97ae6ae8c54605721229f78e73b7e2c5ad0e)
- update [`7366500`](https://github.com/zumerlab/snapdom/commit/7366500ef1d7fc7274c6a2f03f9026106ee4dc84)
- Use v2 beta with plugins [`365723c`](https://github.com/zumerlab/snapdom/commit/365723c7be6e2dc21988b91145d0d908cc21e0fe)
- Update README.md to V2 [`bec851e`](https://github.com/zumerlab/snapdom/commit/bec851e3972a610d171494504a0291b742247f6c)
- Adjust final dimensions when excludeMode: remove. See #294 [`a860827`](https://github.com/zumerlab/snapdom/commit/a8608271ffd9b891ec815fa7e3130c0e1be45307)
- Improve material icon / symbols. See #304 [`526c4c8`](https://github.com/zumerlab/snapdom/commit/526c4c8e6874b2dab6110c8ac3361a29b1dc91de)
- update [`6005d99`](https://github.com/zumerlab/snapdom/commit/6005d99ba523c69d2527964248867375a29bfdd5)
- Refactor HTML meta tags and scripts for clarity [`4e90b4f`](https://github.com/zumerlab/snapdom/commit/4e90b4f8aa808583e0247a0e33915f137023fe35)
- update plugins demos [`d9a1408`](https://github.com/zumerlab/snapdom/commit/d9a14084fda992f9d441eaa93cca32d060d024e1)
- Add XHTML sanitize. See #282 [`0039301`](https://github.com/zumerlab/snapdom/commit/003930196ed6e11c5dd54fce75d814046a36637d)
- Modify contributor update script for multiple README files [`c39a077`](https://github.com/zumerlab/snapdom/commit/c39a077f8a6362a022ab6b14f37627c5c536bdfc)
- Update index.html [`5ce73e6`](https://github.com/zumerlab/snapdom/commit/5ce73e6853281b870dc8027a1db335fbaa0795ca)
- Add detection to Baidu on iOS. Also detect other apps/browsers on iOS. See #295 [`97e6dff`](https://github.com/zumerlab/snapdom/commit/97e6dffa34440d157b0b2b1afc5267d7b15c1d7b)
- Enhance styles for demo sections and output [`0001dab`](https://github.com/zumerlab/snapdom/commit/0001dabbef6a2912ce979bc34288947a30c73745)
- add support for text-underline-offset. See #303 [`fb603bc`](https://github.com/zumerlab/snapdom/commit/fb603bca971a10577215c436b73ba5468a4255ae)
- add support for text-underline-offset. See#303 [`0b93c0d`](https://github.com/zumerlab/snapdom/commit/0b93c0de7a720a7c6708a50a153de86ba6f2684e)
- Bumped version [`695e28f`](https://github.com/zumerlab/snapdom/commit/695e28f37a464ec191d0f1fa9e4ac9a4842de2c3)
- update [`20dccf1`](https://github.com/zumerlab/snapdom/commit/20dccf1ce95225f3464aae755dceb4ef91e8f5eb)
- Update issue templates [`0ce0f5a`](https://github.com/zumerlab/snapdom/commit/0ce0f5a49027d16bc765441da5789f8cc8580f82)
- update docs [`5b95010`](https://github.com/zumerlab/snapdom/commit/5b95010861311e22f0db6583d182ecfe2a1d5b48)
- Merge pull request #299 from harshasiddartha/translate-readme-chinese [`d92c779`](https://github.com/zumerlab/snapdom/commit/d92c7797f9623316ddefef1a2988900f7c7adbdb)
- chore: update contributors list [`e9bcf56`](https://github.com/zumerlab/snapdom/commit/e9bcf568c8fd29d1424bc1c3a70a34e82b216104)
- Merge pull request #296 from jswhisperer/patch-1 [`74f011e`](https://github.com/zumerlab/snapdom/commit/74f011e7c43b692d339d5d8c5c2015b955f9cf4b)
- Modify README example to use overlayFilterPlugin [`ea331f6`](https://github.com/zumerlab/snapdom/commit/ea331f673d7f0a5f223c79516ccb19bafdaaf355)
- Merge pull request #293 from Amyuan23/fix/font-src-parsing-regex [`4459231`](https://github.com/zumerlab/snapdom/commit/44592311eedb90efa7400786837e835caea9983c)
- fix: improve CSS src property parsing in font faces [`dbe52a1`](https://github.com/zumerlab/snapdom/commit/dbe52a121a7d68441570c02ae32c607907e188dc)
- update [`c65a314`](https://github.com/zumerlab/snapdom/commit/c65a3141a20463fe8ef541057c65815386f9046e)
- chore: update contributors list [`7cac15f`](https://github.com/zumerlab/snapdom/commit/7cac15f36fe44311c4ce14cada863bedd107e4af)
- Merge pull request #280 from mon-jai/patch-1 [`f1a9e15`](https://github.com/zumerlab/snapdom/commit/f1a9e155a80ed4f632e9631eb7d697bfe31a427b)
- Fix typo in the website [`0a8827f`](https://github.com/zumerlab/snapdom/commit/0a8827f83cab6efd7c860e3f8ffb95cac66caa7c)

#### [v2.0.0-dev.1](https://github.com/zumerlab/snapdom/compare/v2.0.0-dev.0...v2.0.0-dev.1)

> 23 October 2025

- Add support for icons with ligature such as material-icons. Closes #275 [`#275`](https://github.com/zumerlab/snapdom/issues/275)
- revert [`7b8c149`](https://github.com/zumerlab/snapdom/commit/7b8c1497c848aade0d9db40da30e5c3251674342)
- update [`b4f4a27`](https://github.com/zumerlab/snapdom/commit/b4f4a2788d57f46ba9e991d3731b4ab511be10cb)
- Replace straighten with outerTransforms, and noShadows with outerShadows [`902f032`](https://github.com/zumerlab/snapdom/commit/902f032a43ed4919701765d89818c7782902b403)
- ok [`52d99d4`](https://github.com/zumerlab/snapdom/commit/52d99d4f1a6b42bef137940dd1c4c0263c420502)
- Bumped version [`423a03f`](https://github.com/zumerlab/snapdom/commit/423a03fff73d07a8e44b0a7414ead576dc82e7b7)
- Fix straighten regression [`60c6569`](https://github.com/zumerlab/snapdom/commit/60c6569ebcfbc9ea562c9bddfe9f01c6ea4136db)

#### [v2.0.0-dev.0](https://github.com/zumerlab/snapdom/compare/v1.9.14...v2.0.0-dev.0)

> 14 October 2025

- Document plugin system [`d87ac01`](https://github.com/zumerlab/snapdom/commit/d87ac01fcf0beb8779afbe2be709aa1b35cf7113)
- First plugin and exporter draft [`5da0948`](https://github.com/zumerlab/snapdom/commit/5da09483b82e18ca0fc6873393b9d6830632fcfc)
- Fix subpixel bug. See #261 [`465950b`](https://github.com/zumerlab/snapdom/commit/465950b18e68ce0faf94b229bd65511128cd18a7)
- update demos with plugins [`50e6c4f`](https://github.com/zumerlab/snapdom/commit/50e6c4f85d74bb769fcd7f753f92a3c5be4536c6)
- Update plugin system [`4e21b47`](https://github.com/zumerlab/snapdom/commit/4e21b475fdc42c6eade9cb4dada5bb5ffeb71978)
- Enhance external SVG defs. See #262 [`cd4a7fb`](https://github.com/zumerlab/snapdom/commit/cd4a7fbf0e2d9fc1651c06d5c5f5a3a8f0f54329)
- First plugin system draft [`9c6b91b`](https://github.com/zumerlab/snapdom/commit/9c6b91bc4352de3d323c0746a4e3040058dad519)
- Fix complex canvas render on Safari. See #263 [`2697207`](https://github.com/zumerlab/snapdom/commit/2697207c98373867bcbb91d4afb73d3820c878d3)
- Enhance CSS vars detection. See #262 [`6655303`](https://github.com/zumerlab/snapdom/commit/665530377bceff05ff9c1570301019bd95370a9c)
- Fix counter CSS reset and bug when exist background-image. See #265 [`3c29997`](https://github.com/zumerlab/snapdom/commit/3c299978e2a4cd4c2daf07d64de5772b28e880b8)
- FIx excludeFonts defs. See #260 [`84b1770`](https://github.com/zumerlab/snapdom/commit/84b1770dd2e6e487e22afcd04c2d34cd0490528c)
- fix local register [`9c4508e`](https://github.com/zumerlab/snapdom/commit/9c4508e0cdeb445b76babd71483fe154e0e2ee3e)
- Enable use built-in exporters in custom exporter [`5c6fe36`](https://github.com/zumerlab/snapdom/commit/5c6fe367101d8dfec710372d2b0a7362da3597a3)
- Fix background-repeat. See #259 [`0ad5fa4`](https://github.com/zumerlab/snapdom/commit/0ad5fa4ee56e417016ce495ea299cf4a3c586f6a)
- update [`8ebd650`](https://github.com/zumerlab/snapdom/commit/8ebd650e3ba770fb2aff9ebd9ac8a7b2e4120796)
- Tidy code [`373ffb6`](https://github.com/zumerlab/snapdom/commit/373ffb62228e33e2e07268d558e76b80f49db09f)
- Bumped version [`97e099a`](https://github.com/zumerlab/snapdom/commit/97e099a15b698a3f9118744ba4b2363252e1f9cb)
- update lint [`54340aa`](https://github.com/zumerlab/snapdom/commit/54340aad797f3e5e881a5febf840efc9df5944ec)
- update lint [`6f2e2b3`](https://github.com/zumerlab/snapdom/commit/6f2e2b38100e34f0769dd41a536c578cc4aa5116)
- Fix export name format jpg -&gt; jpeg [`47d532a`](https://github.com/zumerlab/snapdom/commit/47d532a98be096829b592295527c1a6428d6a5d8)
- update roadmap [`dff59b9`](https://github.com/zumerlab/snapdom/commit/dff59b9ea62fed09a9146fd1e9d897dace30a37b)
- Fix local plugin registration [`0997618`](https://github.com/zumerlab/snapdom/commit/0997618fb2e716ead23bfbe4824bb8365987ccd4)
- update [`718da83`](https://github.com/zumerlab/snapdom/commit/718da83a5393a111ee04c053f20e42e9d5a79b55)

#### [v1.9.14](https://github.com/zumerlab/snapdom/compare/v1.9.13...v1.9.14)

> 5 October 2025

- remove test [`881c366`](https://github.com/zumerlab/snapdom/commit/881c36612bb28bd743ce146b452706450e5ec755)
- test [`1460793`](https://github.com/zumerlab/snapdom/commit/1460793d2077a7e1263d7ade7553e7c405377f3e)
- Bumped version [`c413364`](https://github.com/zumerlab/snapdom/commit/c413364994900c5aef3016749c685f4c09e8b8bf)
- update [`21243a6`](https://github.com/zumerlab/snapdom/commit/21243a6ff2894b372a524733eb62a2bd8ba6dfdd)
- update [`f711d7a`](https://github.com/zumerlab/snapdom/commit/f711d7a7b7fd16d3cdf8d4238527fbe8e0492150)
- Recompile builds [`fca9e00`](https://github.com/zumerlab/snapdom/commit/fca9e00d49bb675d6b6103ba2de3f898c85c5578)
- Chore re compile [`1a4f39b`](https://github.com/zumerlab/snapdom/commit/1a4f39b973d7ac471de39e44ead6f1956a021114)
- Update README.md [`0b40e92`](https://github.com/zumerlab/snapdom/commit/0b40e920f495225174d9922a3e1e5664c5347ea3)
- Merge  branch 'main' of https://github.com/zumerlab/snapdom into main [`7f49642`](https://github.com/zumerlab/snapdom/commit/7f49642fc8b3be92069e49eb4a803169dfa5963e)
- chore: update contributors list [`5f88cbb`](https://github.com/zumerlab/snapdom/commit/5f88cbbdc332aa894fee58e7b7135af4e0bd10bc)

#### [v1.9.13](https://github.com/zumerlab/snapdom/compare/v1.9.12-dev.4...v1.9.13)

> 5 October 2025

- Prepare 1.9.13 release by merging dev branch [`#256`](https://github.com/zumerlab/snapdom/pull/256)
- Improve CSS vars detection. Closes #255 [`#255`](https://github.com/zumerlab/snapdom/issues/255)
- Fix toImg() dimensions when scale==1. Closes #254 [`#254`](https://github.com/zumerlab/snapdom/issues/254)
- eslint code [`c754981`](https://github.com/zumerlab/snapdom/commit/c7549812a018d28809e0e2b314c973abe0cd542c)
- lint tests [`ee974ed`](https://github.com/zumerlab/snapdom/commit/ee974ede694f324f674b688aa7cce16f7ec30a90)
- Enhance web fonts detection on deph relative paths. See #253 [`e2a8c45`](https://github.com/zumerlab/snapdom/commit/e2a8c454fbab7590f39f77da544193f8e5af13ab)
- update [`244ea64`](https://github.com/zumerlab/snapdom/commit/244ea644a40dad56ee7bd7d9333dafbc00a5b7b6)
- Add two new options to control transforms and shadows on root element [`8c9a75f`](https://github.com/zumerlab/snapdom/commit/8c9a75f77940221107a6005e458514cca981b2eb)
- add toSvg() [`122317e`](https://github.com/zumerlab/snapdom/commit/122317eb0301f8375cc23ea8f3fd2361d1b759a4)
- update [`194e2d3`](https://github.com/zumerlab/snapdom/commit/194e2d3cf41e9aac375aedbac221ee5fb39149ec)
- Update README.md [`51c88f2`](https://github.com/zumerlab/snapdom/commit/51c88f26bf46ae716dd1d721ecab453f24397f93)
- update [`fb8b932`](https://github.com/zumerlab/snapdom/commit/fb8b932cec14d467a7a4f0d5c2ff0b75921f8002)
- update [`500333d`](https://github.com/zumerlab/snapdom/commit/500333dbeec531d2583d427df477bbc1e8eaeec2)
- update favico [`c56d5dd`](https://github.com/zumerlab/snapdom/commit/c56d5ddb1a932c35983a8bb2954eb4c827f5d56c)
- Add toSvg() in replacement of toImg() [`10e2043`](https://github.com/zumerlab/snapdom/commit/10e2043182672b42dfbda4268fb17f75bc3b561a)
- Bumped version [`865f188`](https://github.com/zumerlab/snapdom/commit/865f188fb48ac9c24efae1df35b189be38561852)
- Improve relative path detection. See #253 [`34158e0`](https://github.com/zumerlab/snapdom/commit/34158e0f5cf8f797cd49416f090d06d2d233542d)
- update sponsors! [`61ff4b0`](https://github.com/zumerlab/snapdom/commit/61ff4b057a2ead81f2b417b63a612f4a5e763288)
- add lint [`e9159a5`](https://github.com/zumerlab/snapdom/commit/e9159a544278398fbecd2d0009aca5a1d62fbf29)
- Update README.md [`6ae2f9a`](https://github.com/zumerlab/snapdom/commit/6ae2f9ad384d05ab41d91ffb6c3d5021d5e9e255)
- Create CNAME [`0685b19`](https://github.com/zumerlab/snapdom/commit/0685b193f091a504ae362f005649c4ae6cdcc984)
- update hero [`ae9d76d`](https://github.com/zumerlab/snapdom/commit/ae9d76d0396a69c8ae0a37342ac480e144ca8ca5)

#### [v1.9.12-dev.4](https://github.com/zumerlab/snapdom/compare/v1.9.12-dev.3...v1.9.12-dev.4)

> 30 September 2025

- Add basic support to sticky elements. See #232 [`02893e6`](https://github.com/zumerlab/snapdom/commit/02893e60e7f3244c1274d64232e7dbf338a283ec)
- Update types [`19317e6`](https://github.com/zumerlab/snapdom/commit/19317e6ff34599028e627f891ae5a2d28036bac1)
- fix formating [`58ca761`](https://github.com/zumerlab/snapdom/commit/58ca7616e3e82ec81122804264466f33d79c45c2)
- Enhance browser detection. See #251 [`cfe753c`](https://github.com/zumerlab/snapdom/commit/cfe753c280ab0c0cda8aca88978a550257caf23f)
- Fix pseudo capture. See #252 [`e85678e`](https://github.com/zumerlab/snapdom/commit/e85678e54fac6736c3dac8a0eaac8f1607dcbb6a)
- Merge pull request #249 from K1ender/dev [`e497bba`](https://github.com/zumerlab/snapdom/commit/e497bbae30e2c539c53715f9dd0bed585d10cf9a)
- Bumped version [`bd5b609`](https://github.com/zumerlab/snapdom/commit/bd5b609911bd5d38036ea524d4c5e1eef3871eea)

#### [v1.9.12-dev.3](https://github.com/zumerlab/snapdom/compare/v1.9.12-dev.2...v1.9.12-dev.3)

> 26 September 2025

- Captures CSS shadows [`050365f`](https://github.com/zumerlab/snapdom/commit/050365f8ab2087a912c71c468b4b1c234b21dd6a)
- Improve counter simulation [`4c9e21d`](https://github.com/zumerlab/snapdom/commit/4c9e21d6bc0135614b882e1940ce31b64c5e40b2)
- Fix scale, width, height options [`8ef48cb`](https://github.com/zumerlab/snapdom/commit/8ef48cb2e038c286eea9b7ce2baafac30c062a5e)
- update demo [`d2dc2f5`](https://github.com/zumerlab/snapdom/commit/d2dc2f5c23d473ddf0eb07cd7fa3f8190653fd61)
- just run safariWarmup if it is needed [`a32846d`](https://github.com/zumerlab/snapdom/commit/a32846d6f48ab8c583b1f26c41d19f3cff67ab55)
- Safari, in case of scale, width or height options use png to ensure fidelity [`0711a77`](https://github.com/zumerlab/snapdom/commit/0711a7774f6f545cd05e0cce86f3354fe377b02d)
- Bumped version [`f2aff4d`](https://github.com/zumerlab/snapdom/commit/f2aff4ded8a48114721d0d0681cdd1912bef2f5d)
- sanitize container [`a6ba396`](https://github.com/zumerlab/snapdom/commit/a6ba396c52406bf9c5dd0ffd27f9460cd34b028e)

#### [v1.9.12-dev.2](https://github.com/zumerlab/snapdom/compare/v1.9.12-dev.1...v1.9.12-dev.2)

> 22 September 2025

- Fix margin collapsing in some cases. See #243 [`7fe0a3f`](https://github.com/zumerlab/snapdom/commit/7fe0a3ffe6e9827b276f0c0337c60c8c02c4129c)
- Bumped version [`afe5ff8`](https://github.com/zumerlab/snapdom/commit/afe5ff8fdf8b44c71556b3ccda1e7b2c167777b1)

#### [v1.9.12-dev.1](https://github.com/zumerlab/snapdom/compare/v1.9.12-dev.0...v1.9.12-dev.1)

> 20 September 2025

- add cors demo [`885900f`](https://github.com/zumerlab/snapdom/commit/885900f34b8036f16b1fdc966e8450f7b8e0772d)
- Modularize counters [`024a7f9`](https://github.com/zumerlab/snapdom/commit/024a7f9b2d1b4805c7b12b5cbb62f0200295cc8f)
- Improve CSS counter() and counters() handling. See #120, see #235 [`8fb0385`](https://github.com/zumerlab/snapdom/commit/8fb03859301075ea9b096197ec5b4dbca4223a95)
- Add feature, lineClamp. See #241 [`4082cd6`](https://github.com/zumerlab/snapdom/commit/4082cd6c39ff43bcb842a81768e11b858c5e8559)
- change optionsnames [`b36a1db`](https://github.com/zumerlab/snapdom/commit/b36a1dba490abd09ac0c82c357ae4d1aa086122e)
- update installation [`5214091`](https://github.com/zumerlab/snapdom/commit/5214091ac65023c94a9106eb9604c2b43c8128a3)
- Fix width/height options [`7cd2111`](https://github.com/zumerlab/snapdom/commit/7cd21114d1337e48b5d743cb94989feb1a1a0d20)
- Fix bug that hangs snapDOM on some browsers. See #236 [`bc3c400`](https://github.com/zumerlab/snapdom/commit/bc3c400356a6f32f8d1d8a986c9a427e6dd13c7f)
- FIx bug that overrides options.width/heigth. See #241 [`49fbb63`](https://github.com/zumerlab/snapdom/commit/49fbb63ac6c28a66a8e6d9076618bee7b6beab62)
- Improve webFonts render. See #229 [`3082a3a`](https://github.com/zumerlab/snapdom/commit/3082a3ae019f424e127f3c065cbcfa7bad59bb39)
- Bumped version [`b58ce59`](https://github.com/zumerlab/snapdom/commit/b58ce59376a78b07e436430fb1114331961038dc)
- Feat. detect wechat browser. See #223 [`e7c4723`](https://github.com/zumerlab/snapdom/commit/e7c4723a24ad3a9c52da5a2e021c115b354bcf66)
- Ensure donwload file measure. See #241 [`eed1995`](https://github.com/zumerlab/snapdom/commit/eed1995a56664c0ace5d94422ba6bb8b5ef82324)
- add iframe support [`ec59e4b`](https://github.com/zumerlab/snapdom/commit/ec59e4bad3dbb639cde37aed929dccb42b54e6b5)

#### [v1.9.12-dev.0](https://github.com/zumerlab/snapdom/compare/v1.9.11...v1.9.12-dev.0)

> 11 September 2025

- Adding 'exclusionMode' option [`#228`](https://github.com/zumerlab/snapdom/pull/228)
- Try fix fallback images [`67bedd3`](https://github.com/zumerlab/snapdom/commit/67bedd3c7cb6bda3e2291fe494805a58263e6dce)
- Try new approach for solve Safari fonts/images decoding [`5b77738`](https://github.com/zumerlab/snapdom/commit/5b7773847f02809826a9ed459321100cfbd50518)
- Two separate mode: filterMode and excludeMode [`394e7f4`](https://github.com/zumerlab/snapdom/commit/394e7f4ca2171fb1028eb382b2331d4718f6a350)
- Workaround Safari See #231 [`593ad59`](https://github.com/zumerlab/snapdom/commit/593ad59383d0b3adbcb139f6892ae321a08c60d5)
- Bumped version [`98afa53`](https://github.com/zumerlab/snapdom/commit/98afa536253561ec37d8b998356576f39e41dee4)
- update [`aec42ae`](https://github.com/zumerlab/snapdom/commit/aec42ae854551cc8d51f1cc7d1072aba871d1225)
- Update README.md [`f85dfec`](https://github.com/zumerlab/snapdom/commit/f85dfec15f412a7b189baba22129944f84a78a46)
- chore: update contributors list [`4cc5a00`](https://github.com/zumerlab/snapdom/commit/4cc5a008e33a780da3d9a3e4542da456f10da6a5)

#### [v1.9.11](https://github.com/zumerlab/snapdom/compare/v1.9.10...v1.9.11)

> 9 September 2025

- Fix Safari bug that prevents capture [`6a43e59`](https://github.com/zumerlab/snapdom/commit/6a43e59d1c311452c7d16e1adc9bb12bb89132b4)
- update demo [`97156c8`](https://github.com/zumerlab/snapdom/commit/97156c85271e99fa6f777320dff70be0e16d05c7)
- Bumped version [`f4a3482`](https://github.com/zumerlab/snapdom/commit/f4a34820e622e31c9b086bfda7c6b86b1e4381c7)
- update demo [`de6f667`](https://github.com/zumerlab/snapdom/commit/de6f6674827505ed76f819ea843e4004acb6756f)
- fonts safari [`791e506`](https://github.com/zumerlab/snapdom/commit/791e506f07804b6ed0db67962fe6998a60994c7c)

#### [v1.9.10](https://github.com/zumerlab/snapdom/compare/v1.9.10-dev.2...v1.9.10)

> 9 September 2025

- Merge dev branch  [`#225`](https://github.com/zumerlab/snapdom/pull/225)
- update demo [`27f30e3`](https://github.com/zumerlab/snapdom/commit/27f30e3387a460a9a872498580ce5c8d34478e19)
- Strip dev comments [`e02066b`](https://github.com/zumerlab/snapdom/commit/e02066b6ef8e6c2b1d50b86096500f914ac025af)
- increase test coverage [`0c59fa0`](https://github.com/zumerlab/snapdom/commit/0c59fa0d276b7899cf2b721d32e7934e701df76b)
- update test [`3a9f25d`](https://github.com/zumerlab/snapdom/commit/3a9f25da39f0370796d1a203ceedd1c9440af18d)
- update test [`56c244a`](https://github.com/zumerlab/snapdom/commit/56c244ad40e0e5c9fbb8d6fd921edcf3dde86d70)
- Update types defs [`648f4a9`](https://github.com/zumerlab/snapdom/commit/648f4a965106c58c6f63d384bf8db600a661146c)
- Improves mask handling [`f3915ea`](https://github.com/zumerlab/snapdom/commit/f3915ea919b927b5f2ff0a9f3c865beb7b08b231)
- update docs [`e5f3d5d`](https://github.com/zumerlab/snapdom/commit/e5f3d5d88c783c2efbbf1b05dc83f9e30311d2fa)
- Bumped version [`a34651f`](https://github.com/zumerlab/snapdom/commit/a34651f0524e227879ce387ac6cf7843d4cad02d)
- fix backgroundColor regression [`21a6a39`](https://github.com/zumerlab/snapdom/commit/21a6a3923d81d2f733d6bc61136a9d4eda8f1a62)
- Update README.md [`db06c06`](https://github.com/zumerlab/snapdom/commit/db06c06a7161b79ad3a3d5f05e76db8e9edda8a6)

#### [v1.9.10-dev.2](https://github.com/zumerlab/snapdom/compare/v1.9.10-dev.1...v1.9.10-dev.2)

> 8 September 2025

- Fix cache disabled bug. Closes #221 [`#221`](https://github.com/zumerlab/snapdom/issues/221)
- Add extra margin when element has transform [`6688eee`](https://github.com/zumerlab/snapdom/commit/6688eee661de2d91249f9db28948629f421b14b4)
- Feat. handkles css trasnforms and scale rotate new props. Ref #216 [`d151da1`](https://github.com/zumerlab/snapdom/commit/d151da1993f1374d2bae16ed1a076a05f9ff8d45)
- Add same-origin iframe support .See #222 [`f50720f`](https://github.com/zumerlab/snapdom/commit/f50720fe76d8d114c1de31ffe802ade1edd7060e)
- Fix regression that doesnt reset origial translate [`800c427`](https://github.com/zumerlab/snapdom/commit/800c427d327f41fbcc9703dfa5a3e99b9b7c789f)
- Fix duplicated values on textArea [`0915f8d`](https://github.com/zumerlab/snapdom/commit/0915f8d4f1b9e58800407ba28ad86e16b6cc4621)
- 增强图像处理功能，添加图像加载失败时的后备图像源支持，并记录原始图像尺寸以便于使用。更新类型定义以包含新选项。 [`011620a`](https://github.com/zumerlab/snapdom/commit/011620a3c8dbabed9c2e509766c4516205fbad66)
- ✨ feat: [`e3a4556`](https://github.com/zumerlab/snapdom/commit/e3a4556a4085c0968bcce9f54d7d0fb9bbcfc6a7)
- update test [`09904dc`](https://github.com/zumerlab/snapdom/commit/09904dca975c6fe38abf5bd11c4145c157ff185c)
- update defaultImageUrl usage at README.md [`c330fef`](https://github.com/zumerlab/snapdom/commit/c330fef60ffef2a1adb73bb1d05d8418138ea0b0)
- fix again extra margin viewport [`f3d8455`](https://github.com/zumerlab/snapdom/commit/f3d84554856f4b1ab709dac8bb4055227d0309bd)
- MInify styles [`2e01c68`](https://github.com/zumerlab/snapdom/commit/2e01c680f9710c72775633878b0236e26fcca1e6)
- Bumped version [`e5d4bdf`](https://github.com/zumerlab/snapdom/commit/e5d4bdf18d7dff47a5c5079bcc3157f2535993cd)
- remove iframe limitation [`77abf8f`](https://github.com/zumerlab/snapdom/commit/77abf8f617fd1942565ee141406757c3704f45ae)
- Merge pull request #220 from Jarvis2018/main [`adb6455`](https://github.com/zumerlab/snapdom/commit/adb6455fd6ff9db128dda5a59ac7556a16c851fa)
- Merge pull request #215 from xiaobai-web715/dev [`37be327`](https://github.com/zumerlab/snapdom/commit/37be327f7c55ae20ee65001a8469f59284dbe12f)
- Update README.md [`0d41b7e`](https://github.com/zumerlab/snapdom/commit/0d41b7e08151070b1433874534bd70fd801060f1)

#### [v1.9.10-dev.1](https://github.com/zumerlab/snapdom/compare/v1.9.10-dev.0...v1.9.10-dev.1)

> 3 September 2025

- Fix flickering on Safari. Closes #197 [`#197`](https://github.com/zumerlab/snapdom/issues/197)
- Prevents default svg values overwrite custom ones. Closes #217 [`#217`](https://github.com/zumerlab/snapdom/issues/217)
- Feature: add placeholders option to disable rendered placeholder for iframes and fallback images. Closes #137 [`#137`](https://github.com/zumerlab/snapdom/issues/137)
- FIx textarea styles. Closes #212 [`#212`](https://github.com/zumerlab/snapdom/issues/212)
- Bumped version [`7f4c46e`](https://github.com/zumerlab/snapdom/commit/7f4c46e6372313ffb4d0d63a691522469f1b50ba)

#### [v1.9.10-dev.0](https://github.com/zumerlab/snapdom/compare/v1.9.9...v1.9.10-dev.0)

> 29 August 2025

- Code refactor, cache improve, options centralized [`3bd7182`](https://github.com/zumerlab/snapdom/commit/3bd71822cf72614b3bb5993039482fdb05833ceb)
- update tests [`e958433`](https://github.com/zumerlab/snapdom/commit/e958433ec34ec571e8e506172c9e281caabe5bf2)
- update tests [`a24bdab`](https://github.com/zumerlab/snapdom/commit/a24bdab20c92b7b316dc376ac38c80b1720befd5)
- Improve performance and cache [`8882025`](https://github.com/zumerlab/snapdom/commit/88820259d4000fd36dbf4f59bb4940a6e12e6611)
- update test [`271ace7`](https://github.com/zumerlab/snapdom/commit/271ace7bfee7ef7cba2ecfaeee04b424a64c28a3)
- Enhance font handling [`cb1e04a`](https://github.com/zumerlab/snapdom/commit/cb1e04af0551f097b44eeb84ba64a97e869b6f60)
- Improve capture fidelity [`e05f027`](https://github.com/zumerlab/snapdom/commit/e05f027b8eb3b5b90e22a9d8ce7a7279f7b1614b)
- update [`5c21213`](https://github.com/zumerlab/snapdom/commit/5c212137ff06fc0f9fb763491db93ecec7ee71ee)
- fix font fetching [`70dd092`](https://github.com/zumerlab/snapdom/commit/70dd092adb14899031f0596d83ec354c9ab023b9)
- Set compress as default [`7e5ab00`](https://github.com/zumerlab/snapdom/commit/7e5ab007f653f995b09ecbbf7711d69937fdef4a)
- optimice code [`df52437`](https://github.com/zumerlab/snapdom/commit/df524379288fcb08dd19b8957d627a24b898685e)
- Core update: increase X3 speed capture compared 1.9.9 [`94bc57d`](https://github.com/zumerlab/snapdom/commit/94bc57dc53cb63d82532467b4a041ab26da7481a)
- Ensure custom fonts are capured [`8125689`](https://github.com/zumerlab/snapdom/commit/81256893249b2313edfebacb9d68ec6ed4fa9ed2)
- update [`b1bc01a`](https://github.com/zumerlab/snapdom/commit/b1bc01a11c810cac231fc664949ce286135be28b)
- add font test [`320943e`](https://github.com/zumerlab/snapdom/commit/320943ed4abdbb52adfd6f208f7cc1af9fde3197)
- update [`89777df`](https://github.com/zumerlab/snapdom/commit/89777df0c4bf3afe716fa8008e046b50e7e90835)
- update [`a0b3a9c`](https://github.com/zumerlab/snapdom/commit/a0b3a9c1c4d5c3d73f9a85f5da359ea7e917ba4a)
- Fix first custom font bug on Safari [`971d976`](https://github.com/zumerlab/snapdom/commit/971d9762dd73263689057e16fb47c00d2e0eba1b)
- update [`d6a4531`](https://github.com/zumerlab/snapdom/commit/d6a4531ace34bdae14eb0c1819adf76b60e77dd1)
- Fix big that affects overall capture fidelity [`35539a5`](https://github.com/zumerlab/snapdom/commit/35539a50da67c30e28c39272a4c1efefbf24a2e2)
- Bumped version [`6297fe4`](https://github.com/zumerlab/snapdom/commit/6297fe430eb07e4218bfa84f31781202c88aa0a5)
- update to avoid vitest issues [`51ef80d`](https://github.com/zumerlab/snapdom/commit/51ef80d24b693ceee3e33d75e2b64ba7037e49ea)
- update exports to avoid vitest fails [`91a554e`](https://github.com/zumerlab/snapdom/commit/91a554ecb696810591b3916cb14be21074773eb9)
- update [`b1ad47f`](https://github.com/zumerlab/snapdom/commit/b1ad47f31deb4978d5a41eaa2f703c16ff17c70c)

#### [v1.9.9](https://github.com/zumerlab/snapdom/compare/v1.9.8...v1.9.9)

> 14 August 2025

- Improves external fonts handling. Closes #139, closes #146, closes #186 [`#139`](https://github.com/zumerlab/snapdom/issues/139) [`#146`](https://github.com/zumerlab/snapdom/issues/146) [`#186`](https://github.com/zumerlab/snapdom/issues/186)
- Handles srcset. Closes #190 [`#190`](https://github.com/zumerlab/snapdom/issues/190)
- Fix speed regression [`542ed00`](https://github.com/zumerlab/snapdom/commit/542ed003e3f35c19bd51fd5317f5572c12ba1ac8)
- Update tests [`d2bc332`](https://github.com/zumerlab/snapdom/commit/d2bc33213196aed56b65e530a5c0171377e373fe)
- Handles Blob scr [`fe27239`](https://github.com/zumerlab/snapdom/commit/fe27239ac3efef9a0e9e7f0feeb223dd74fd9086)
- Bumped version [`2f8b306`](https://github.com/zumerlab/snapdom/commit/2f8b306269ef3b32fe6d1c89242ec444c99a747b)
- IconFont doc [`9b62a9f`](https://github.com/zumerlab/snapdom/commit/9b62a9f4aaa1dbd58bccc7663f86a8890ac3214f)
- update [`b4a0e4e`](https://github.com/zumerlab/snapdom/commit/b4a0e4e9b368a534a101d59b2ba4d8219ef462b0)
- update [`056d988`](https://github.com/zumerlab/snapdom/commit/056d98822653035de365e343e5bfffe320d5f9c8)
- chore: update contributors list [`76ed282`](https://github.com/zumerlab/snapdom/commit/76ed28218e2e4479753e063836fea04d38d65b52)

#### [v1.9.8](https://github.com/zumerlab/snapdom/compare/v1.9.7...v1.9.8)

> 10 August 2025

- fix(types): update `preCache` [`#166`](https://github.com/zumerlab/snapdom/pull/166)
- Update README.md [`#150`](https://github.com/zumerlab/snapdom/pull/150)
- Fix defs & symbols outside captured element and hidden visibility, closes #178. Stalibize layout before cloning, clses  #179. Fix inline styles, closes #177 [`#178`](https://github.com/zumerlab/snapdom/issues/178) [`#177`](https://github.com/zumerlab/snapdom/issues/177)
- Fix icontFont alignment and rendered size. Closes #176 [`#176`](https://github.com/zumerlab/snapdom/issues/176)
- Ensure skip empty pseudo elements. Closes #168 [`#168`](https://github.com/zumerlab/snapdom/issues/168)
- Add basic border-image support. Closes #159 [`#159`](https://github.com/zumerlab/snapdom/issues/159)
- Fix input css styles. Closes #144, closes #147 [`#144`](https://github.com/zumerlab/snapdom/issues/144) [`#147`](https://github.com/zumerlab/snapdom/issues/147)
- Fix Safari scale. Closes #133 [`#133`](https://github.com/zumerlab/snapdom/issues/133)
- Update README.md, closes #140 [`#140`](https://github.com/zumerlab/snapdom/issues/140)
- Fix @font-face. Closes #145 [`#145`](https://github.com/zumerlab/snapdom/issues/145)
- Fix edge case that generates blank images on Safari. Closes #129 [`#129`](https://github.com/zumerlab/snapdom/issues/129)
- Improves internal styles and class generator [`59efdc1`](https://github.com/zumerlab/snapdom/commit/59efdc1b62764c0a6789b28af849c9556ffc46a3)
- update test [`4204706`](https://github.com/zumerlab/snapdom/commit/420470698e9534bef390c8ed35cd812b0f0609cd)
- Merge pull request #183 from zhanghaotian2018/main [`84a77c8`](https://github.com/zumerlab/snapdom/commit/84a77c822e161a28a1e1d873e36f772cb57bf204)
- Bumped version [`3d96606`](https://github.com/zumerlab/snapdom/commit/3d9660649b41cdb3da52d5bcc6fb00e453ef575d)
- Improve pseudo elements detection. Closes # 143 [`539e488`](https://github.com/zumerlab/snapdom/commit/539e488c018a1bf7be05e0d9d969e350c9ed4291)
- Fix dpr option propagation. Ref #151 [`6780857`](https://github.com/zumerlab/snapdom/commit/67808570be1365e178b6030d62a8c9f8daeba058)
- add a new hero [`57be597`](https://github.com/zumerlab/snapdom/commit/57be59789a19674e181ddb5bed317f570ed7d736)
- Bumped version [`87eee4f`](https://github.com/zumerlab/snapdom/commit/87eee4f0787bb046eff0a5df972ccf6a1b58caa9)
- chore: update contributors list [`cf4b494`](https://github.com/zumerlab/snapdom/commit/cf4b494be856ccf3b29300ac449b942529f5a5e0)
- Remove default backgroundColor on download(). Ref #142 [`a875fe3`](https://github.com/zumerlab/snapdom/commit/a875fe31c1c1fc9a1d0d59ef2934b5930a6b7c88)
- chore: update contributors list [`e1e66dd`](https://github.com/zumerlab/snapdom/commit/e1e66dd42bbb8cf0a3813dc7184b753e26232d82)
- chore: update contributors list [`2be00a7`](https://github.com/zumerlab/snapdom/commit/2be00a7e32ad2c637b9ca820cb72645a502d46ce)
- Update snapdom.d.ts [`e02ecde`](https://github.com/zumerlab/snapdom/commit/e02ecdeeaa20bc16ba0793ab8ae8232593806dac)
- Merge pull request #156 from fu050409/fix/border-check [`2f08c9b`](https://github.com/zumerlab/snapdom/commit/2f08c9b3b1d114c72e3395821365c71468ac8348)
- fix: invalid border-width check [`21333b8`](https://github.com/zumerlab/snapdom/commit/21333b8c1e9c1ff1aa30a5c7f05870cc25076809)
- add roadmap [`9bd4281`](https://github.com/zumerlab/snapdom/commit/9bd42810683d58967019a135fe106137765f2a82)
- Merge pull request #149 from sharuzzaman/patch-1 [`97d9afb`](https://github.com/zumerlab/snapdom/commit/97d9afbe5ea60f16952a5531032df75e8df404e1)
- chore: update contributors list [`cea5b84`](https://github.com/zumerlab/snapdom/commit/cea5b84615a008583e363456120c43c2d9db9bc8)
- chore: update contributors list [`7c49104`](https://github.com/zumerlab/snapdom/commit/7c49104921a700aea92b26b85c625b08438690d0)
- Merge pull request #131 from kohaiy/patch-1 [`e38d67b`](https://github.com/zumerlab/snapdom/commit/e38d67b0102edf75a9f6e742bd45eacc43be51c1)
- chore: credit contributor @rbbydotdev [`37860d5`](https://github.com/zumerlab/snapdom/commit/37860d5b1668817143fa9b944cfa164272062d37)
- chore: credit contributor @miusuncle [`945e241`](https://github.com/zumerlab/snapdom/commit/945e241a5d3ff2bc0573a85c03f7bbf736b57034)

#### [v1.9.7](https://github.com/zumerlab/snapdom/compare/v1.9.6...v1.9.7)

> 20 July 2025

- add options argument to toBlob function [`#118`](https://github.com/zumerlab/snapdom/pull/118)
- Keep canvas style. Fixes #121. [`#121`](https://github.com/zumerlab/snapdom/issues/121)
- Add try/catch on cloneNode. Closes #99 [`#99`](https://github.com/zumerlab/snapdom/issues/99)
- Fix special url names. Closes #29 [`#29`](https://github.com/zumerlab/snapdom/issues/29)
- Improve: handles local() source font. See #114 [`c088aa0`](https://github.com/zumerlab/snapdom/commit/c088aa01422bf6ea6c1be70a88d09d540eae5038)
- improve webcomponent clone [`a0f37a5`](https://github.com/zumerlab/snapdom/commit/a0f37a57079057548e97a973bc6c734b4141769d)
- Handle errors [`6a75af2`](https://github.com/zumerlab/snapdom/commit/6a75af20ce0c3a3781ccd35838e36ab3fabc5919)
- Perf: unifies cache [`fe3a368`](https://github.com/zumerlab/snapdom/commit/fe3a3680ddef2736fc0176dcbc210fc760149038)
- Update tests [`9412679`](https://github.com/zumerlab/snapdom/commit/941267973cd406d07b3ad7364766bfdd59a174f1)
- Add module exports. See #119 [`4bb20cf`](https://github.com/zumerlab/snapdom/commit/4bb20cf7a765403440e7c6f3a70174d3f7e1271a)
- Update browser entry file. See #119 [`134f24d`](https://github.com/zumerlab/snapdom/commit/134f24d714cfedb3b40034f43c97bcbc2cfaf517)
- Chore: remove comments [`c079f87`](https://github.com/zumerlab/snapdom/commit/c079f8768bd5b3142c6aaadb2161eee7cdc69186)
- Improve cache handling. [`183ae2f`](https://github.com/zumerlab/snapdom/commit/183ae2f90debfb472164df01616f2558136a9f8f)
- Adjust cache reset [`ff33ed3`](https://github.com/zumerlab/snapdom/commit/ff33ed374dcc02272225ca0154a84c304e6fc19a)
- Improve regex [`1b4d5ad`](https://github.com/zumerlab/snapdom/commit/1b4d5ada356bce55caecd008df746f891d379c48)
- Add primitive support to css counter. See #120 [`160bc2e`](https://github.com/zumerlab/snapdom/commit/160bc2eaf984051e23031664040ea91166bca061)
- Bumped version [`7d1fae5`](https://github.com/zumerlab/snapdom/commit/7d1fae577de9ac3b339b3585b9d435e05fbd7513)
- Bumped version [`244d68f`](https://github.com/zumerlab/snapdom/commit/244d68fd59b6485003e0592c43dd243fe97754c2)
- update example [`6ebdccf`](https://github.com/zumerlab/snapdom/commit/6ebdccf9275d80d3cf722a492af9b3df4aed2298)
- Fix bug thats inject background-color on formats thats support transparency. See #90 [`47a34a9`](https://github.com/zumerlab/snapdom/commit/47a34a971cc875ec4d9eab772266df81a94438e7)
- docs: add `install playwright browsers` contribute step [`443a17a`](https://github.com/zumerlab/snapdom/commit/443a17a769d08cc26ec1d5ed75d8187beeb8eaf7)
- update devdependencies [`0a88a56`](https://github.com/zumerlab/snapdom/commit/0a88a566bd59bc135aa664afe27c0793f763fbd0)
- Fix regression textArea duplication [`1759fd0`](https://github.com/zumerlab/snapdom/commit/1759fd0ae1681e17df946d507ae4d704efff1b18)
- chore: specify node version [`abd5674`](https://github.com/zumerlab/snapdom/commit/abd56743688b330ac888dc397a8ee1351cca1314)
- Bumped version [`01b6d13`](https://github.com/zumerlab/snapdom/commit/01b6d1304c1adcf01ed72caf81f9a4b9dd75adab)
- Prevent process local ids. See #128 [`659e862`](https://github.com/zumerlab/snapdom/commit/659e8627bb6545f7843de1bcf808dc6bfb4dff3e)
- Merge pull request #123 from miusuncle/feat/node-version [`e457bf6`](https://github.com/zumerlab/snapdom/commit/e457bf64ca2b4294aaf237c165f865ea50cc0c14)

#### [v1.9.6](https://github.com/zumerlab/snapdom/compare/v1.9.6-dev.2...v1.9.6)

> 20 July 2025

- Update update-contributors.yml [`7a08887`](https://github.com/zumerlab/snapdom/commit/7a08887ba63c897cd099bb2684cd6ed5a2eaf839)
- Update update-contributors.yml [`018052c`](https://github.com/zumerlab/snapdom/commit/018052c862584996cc547395204a1caf1acdc704)

#### [v1.9.6-dev.2](https://github.com/zumerlab/snapdom/compare/v1.9.6-dev.1...v1.9.6-dev.2)

> 18 July 2025

- Keep canvas style. Fixes #121. [`#121`](https://github.com/zumerlab/snapdom/issues/121)
- Bumped version [`01b6d13`](https://github.com/zumerlab/snapdom/commit/01b6d1304c1adcf01ed72caf81f9a4b9dd75adab)

#### [v1.9.6-dev.1](https://github.com/zumerlab/snapdom/compare/v1.9.6-dev.0...v1.9.6-dev.1)

> 18 July 2025

- add options argument to toBlob function [`#118`](https://github.com/zumerlab/snapdom/pull/118)
- Add try/catch on cloneNode. Closes #99 [`#99`](https://github.com/zumerlab/snapdom/issues/99)
- Add module exports. See #119 [`4bb20cf`](https://github.com/zumerlab/snapdom/commit/4bb20cf7a765403440e7c6f3a70174d3f7e1271a)
- Merge pull request #123 from miusuncle/feat/node-version [`e457bf6`](https://github.com/zumerlab/snapdom/commit/e457bf64ca2b4294aaf237c165f865ea50cc0c14)
- Handle errors [`6a75af2`](https://github.com/zumerlab/snapdom/commit/6a75af20ce0c3a3781ccd35838e36ab3fabc5919)
- Update tests [`9412679`](https://github.com/zumerlab/snapdom/commit/941267973cd406d07b3ad7364766bfdd59a174f1)
- Bumped version [`244d68f`](https://github.com/zumerlab/snapdom/commit/244d68fd59b6485003e0592c43dd243fe97754c2)
- Fix bug thats inject background-color on formats thats support transparency. See #90 [`47a34a9`](https://github.com/zumerlab/snapdom/commit/47a34a971cc875ec4d9eab772266df81a94438e7)
- docs: add `install playwright browsers` contribute step [`443a17a`](https://github.com/zumerlab/snapdom/commit/443a17a769d08cc26ec1d5ed75d8187beeb8eaf7)
- chore: specify node version [`abd5674`](https://github.com/zumerlab/snapdom/commit/abd56743688b330ac888dc397a8ee1351cca1314)

#### [v1.9.6-dev.0](https://github.com/zumerlab/snapdom/compare/v1.9.5...v1.9.6-dev.0)

> 15 July 2025

- Fix special url names. Closes #29 [`#29`](https://github.com/zumerlab/snapdom/issues/29)
- Perf: unifies cache [`fe3a368`](https://github.com/zumerlab/snapdom/commit/fe3a3680ddef2736fc0176dcbc210fc760149038)
- Adjust cache reset [`ff33ed3`](https://github.com/zumerlab/snapdom/commit/ff33ed374dcc02272225ca0154a84c304e6fc19a)
- Bumped version [`974d6c9`](https://github.com/zumerlab/snapdom/commit/974d6c933fef57bcf53d49d401d979595724ad13)

#### [v1.9.5](https://github.com/zumerlab/snapdom/compare/v1.9.3...v1.9.5)

> 14 July 2025

- Fix: add type def for `SnapOptions`  [`#111`](https://github.com/zumerlab/snapdom/pull/111)
- copy `checkbox.indeterminate` [`#104`](https://github.com/zumerlab/snapdom/pull/104)
- Add mask detection (closes #106) [`#106`](https://github.com/zumerlab/snapdom/issues/106)
- Add &lt;slot&gt; detection (closes # 97). Fix textarea content duplication (closes #110) [`#110`](https://github.com/zumerlab/snapdom/issues/110)
- Add html-to-image to benchmark. Closes #103 [`#103`](https://github.com/zumerlab/snapdom/issues/103)
- Bumped version [`7cfa672`](https://github.com/zumerlab/snapdom/commit/7cfa672149cd4b722e0cac5410457ff609e128b8)
- Reenables all libraries to test [`1baf269`](https://github.com/zumerlab/snapdom/commit/1baf2690fe54795ec809ab890be7661894e0abec)
- Fix: add type def for `SnapOptions` [`3bc06b0`](https://github.com/zumerlab/snapdom/commit/3bc06b05b111f0fb36fc93c3e9395b5976ab4d12)
- chore: update contributors list [`cd52ed5`](https://github.com/zumerlab/snapdom/commit/cd52ed5ece706cd0b56a9ec04da196bd57966b6f)
- Merge pull request #105 from tarwin/main [`e714ac7`](https://github.com/zumerlab/snapdom/commit/e714ac7a395630c6c2181065008c460e2d152928)
- Add html-to-image to benckmark. #103 [`c4fcdd0`](https://github.com/zumerlab/snapdom/commit/c4fcdd0da9de7657c42a90fc40ba2b6cedb550aa)
- Update clone.js [`b8cca28`](https://github.com/zumerlab/snapdom/commit/b8cca2885d97d367bb715c107264131975e72718)
- chore: update docs to show `exclude` and `filter` [`550a5ad`](https://github.com/zumerlab/snapdom/commit/550a5ad14d284441ad20143bfe3c05021e616d1a)
- fix: missing `width` and `height` in types [`9b7d93b`](https://github.com/zumerlab/snapdom/commit/9b7d93b9f3cf87b036086427f885ec40989f3264)
- chore: update contributors list [`054b827`](https://github.com/zumerlab/snapdom/commit/054b82733046ffa7416324707c2989542e76d67c)
- Add Blob Types options [`f5146a8`](https://github.com/zumerlab/snapdom/commit/f5146a87ae4515c9d4443a4189301f569d75f94b)

#### [v1.9.3-next.dev.1.0](https://github.com/zumerlab/snapdom/compare/v1.8.0...v1.9.3-next.dev.1.0)

> 14 July 2025

- Fix: add type def for `SnapOptions`  [`#111`](https://github.com/zumerlab/snapdom/pull/111)
- copy `checkbox.indeterminate` [`#104`](https://github.com/zumerlab/snapdom/pull/104)
- Related #84 [`#100`](https://github.com/zumerlab/snapdom/pull/100)
- Missing `width` and `height` in types [`#94`](https://github.com/zumerlab/snapdom/pull/94)
- Revert "Missing `width` and `height` in types" [`#98`](https://github.com/zumerlab/snapdom/pull/98)
- fix: del ths type check, the element in iframe can not work! [`#77`](https://github.com/zumerlab/snapdom/pull/77)
- Update benchmark. Closes #103 [`#103`](https://github.com/zumerlab/snapdom/issues/103)
- Feat: handles mask-image, mask-box-image-source. Closes #106 [`#106`](https://github.com/zumerlab/snapdom/issues/106)
- Fix: duplicate content in textarea and resize. Closes #110 [`#110`](https://github.com/zumerlab/snapdom/issues/110)
- Add: &lt;slot&gt; clone and fix cloning webcomponents . Closes #97 [`#97`](https://github.com/zumerlab/snapdom/issues/97)
- Improve fetchImages by skiping svg format. Closes #91. Closes #89 [`#91`](https://github.com/zumerlab/snapdom/issues/91) [`#89`](https://github.com/zumerlab/snapdom/issues/89)
- Core update: Capture speed is drammatically increased. Closes #72 [`#72`](https://github.com/zumerlab/snapdom/issues/72)
- Feat: tries differents methods to fetch image, even proxy for CORS denied images. Closes #78. Closes #73 [`#78`](https://github.com/zumerlab/snapdom/issues/78) [`#73`](https://github.com/zumerlab/snapdom/issues/73)
- Add iconFont options and fix doubled icon render. Closes #51, closes #80 [`#51`](https://github.com/zumerlab/snapdom/issues/51) [`#80`](https://github.com/zumerlab/snapdom/issues/80)
- Revert "Add Layui icon font. Closes #74" [`#74`](https://github.com/zumerlab/snapdom/issues/74)
- Add Layui icon font. Closes #74 [`#74`](https://github.com/zumerlab/snapdom/issues/74)
- Add Blob Types. Closes #71 [`#71`](https://github.com/zumerlab/snapdom/issues/71)
- Merge pull request #77 from 17biubiu/patch-1, closes #76 [`#76`](https://github.com/zumerlab/snapdom/issues/76)
- Bug: fixes hidden last line PRE tag. Closes #75 [`#75`](https://github.com/zumerlab/snapdom/issues/75)
- Feat: handles external SVG defs. Fixes #70 [`#70`](https://github.com/zumerlab/snapdom/issues/70)
- Prevents double url encoding. Fixes #68 [`#68`](https://github.com/zumerlab/snapdom/issues/68)
- Chore ci [`6cf0ed5`](https://github.com/zumerlab/snapdom/commit/6cf0ed5f7e5523c79fb293bbddd2fb4f79e96f33)
- Delete package-lock.json [`47ecf89`](https://github.com/zumerlab/snapdom/commit/47ecf897f461afad504ab738296c0f1c4daca4cd)
- move file [`5ed7552`](https://github.com/zumerlab/snapdom/commit/5ed75525a895ec720b4f319b3eeb8c8d43c5c75e)
- Move files [`f36eeab`](https://github.com/zumerlab/snapdom/commit/f36eeab706853bb8e534a13e2658b25a79989e67)
- Add `filter` and `exclude` options for element exclusion. [`a683357`](https://github.com/zumerlab/snapdom/commit/a6833570965606d47db1c05e7d817ef470c80629)
- Create CODE_OF_CONDUCT.md [`0d3f11a`](https://github.com/zumerlab/snapdom/commit/0d3f11a2e55801922e995107f40b1cb151dbe0a3)
- update [`355866f`](https://github.com/zumerlab/snapdom/commit/355866fd073dde644079e45bccb629e98ef51b6c)
- Bumped version [`7cfa672`](https://github.com/zumerlab/snapdom/commit/7cfa672149cd4b722e0cac5410457ff609e128b8)
- Delete .github/workflows/publish-dev.yml [`b723c41`](https://github.com/zumerlab/snapdom/commit/b723c416618b3d2f039ad423065e8bcd5b42fd60)
- Create publish-dev.yml [`89c813d`](https://github.com/zumerlab/snapdom/commit/89c813db5574f5bacb724d31a57c59afa52487d6)
- Update test [`22f4d6d`](https://github.com/zumerlab/snapdom/commit/22f4d6d1b2da0316fe0b1d23077a6645d1704164)
- Add test for fetch images [`45c7678`](https://github.com/zumerlab/snapdom/commit/45c76785018fdc89f4ee2e72ad54f6308fe29590)
- Update issue templates [`7868bb4`](https://github.com/zumerlab/snapdom/commit/7868bb421a6a739af0cbe65cb9469bdc84ead774)
- Add html-to-image to benckmark. #103 [`c4fcdd0`](https://github.com/zumerlab/snapdom/commit/c4fcdd0da9de7657c42a90fc40ba2b6cedb550aa)
- Bumped version [`a296ca0`](https://github.com/zumerlab/snapdom/commit/a296ca05269d628e8ff4e8a43e7e5f102bfb19da)
- Update publish-dev.yml [`852d8d9`](https://github.com/zumerlab/snapdom/commit/852d8d9d11d1e076bccb374f225081929a1c3ea6)
- Update publish-dev.yml [`00c0dbc`](https://github.com/zumerlab/snapdom/commit/00c0dbcb252d3017d1bcfe6cc8fe76d093935c06)
- Update publish-dev.yml [`d8cd306`](https://github.com/zumerlab/snapdom/commit/d8cd30632729acbb5b33e1a8885b3e15241e4a25)
- Update publish-dev.yml [`0a16909`](https://github.com/zumerlab/snapdom/commit/0a169095c1b865cb01ae2c0a92693ea525622fe5)
- Add sponsor [`a222510`](https://github.com/zumerlab/snapdom/commit/a2225104ad3aa28b816a96f31d176ab5563bc7fb)
- Fix scale background-image [`b1ba326`](https://github.com/zumerlab/snapdom/commit/b1ba326a3a3708a8b2958f2588354bdfa8762cc9)
- Reenables all libraries to test [`1baf269`](https://github.com/zumerlab/snapdom/commit/1baf2690fe54795ec809ab890be7661894e0abec)
- Update clone.js [`b8cca28`](https://github.com/zumerlab/snapdom/commit/b8cca2885d97d367bb715c107264131975e72718)
- Update test [`9d63bca`](https://github.com/zumerlab/snapdom/commit/9d63bca73486f092f91309e02ce56bc6037c7149)
- Fix typo [`28ee7fa`](https://github.com/zumerlab/snapdom/commit/28ee7fa444ae61e0c3a1fe03bd2f4a4ada7af759)
- chore: update docs to show `exclude` and `filter` [`550a5ad`](https://github.com/zumerlab/snapdom/commit/550a5ad14d284441ad20143bfe3c05021e616d1a)
- chore [`52d886d`](https://github.com/zumerlab/snapdom/commit/52d886d698881ebde00e70245a8b52081b32b19a)
- Fix: add type def for `SnapOptions` [`3bc06b0`](https://github.com/zumerlab/snapdom/commit/3bc06b05b111f0fb36fc93c3e9395b5976ab4d12)
- chore: update contributors list [`cd52ed5`](https://github.com/zumerlab/snapdom/commit/cd52ed5ece706cd0b56a9ec04da196bd57966b6f)
- Merge pull request #105 from tarwin/main [`e714ac7`](https://github.com/zumerlab/snapdom/commit/e714ac7a395630c6c2181065008c460e2d152928)
- Add layui icon font [`7f6fa5a`](https://github.com/zumerlab/snapdom/commit/7f6fa5a41901c99cd94de1e45762dd7cc9907b8f)
- fix: missing `width` and `height` in types [`9b7d93b`](https://github.com/zumerlab/snapdom/commit/9b7d93b9f3cf87b036086427f885ec40989f3264)
- chore: update contributors list [`054b827`](https://github.com/zumerlab/snapdom/commit/054b82733046ffa7416324707c2989542e76d67c)
- Add Blob Types options [`f5146a8`](https://github.com/zumerlab/snapdom/commit/f5146a87ae4515c9d4443a4189301f569d75f94b)
- chore: update contributors list [`6047a4d`](https://github.com/zumerlab/snapdom/commit/6047a4dc083ccf388f4ef0b1d2b7ff44675f9efa)
- chore: update contributors list [`dadb608`](https://github.com/zumerlab/snapdom/commit/dadb6086beb15dfe14696d27013a629e2a2ab791)
- chore: update contributors list [`c9853ba`](https://github.com/zumerlab/snapdom/commit/c9853ba70f0be822318a8bf28a3cf6b49a0179a6)
- Task, delete console.log [`80f1013`](https://github.com/zumerlab/snapdom/commit/80f10130ec815464fd7f87b3bfa29a0108032b9c)
- chore: update contributors list [`93d3f03`](https://github.com/zumerlab/snapdom/commit/93d3f037a2e688e3a23e93787ee948b4222c3fbf)

#### [v1.8.0](https://github.com/zumerlab/snapdom/compare/v1.7.1...v1.8.0)

> 30 June 2025

- fix: encode same uri multiple times [`#65`](https://github.com/zumerlab/snapdom/pull/65)
- Add Lucide to icon font detection [`#50`](https://github.com/zumerlab/snapdom/pull/50)
- Avoid background-image logic duplication, closes #66 [`#66`](https://github.com/zumerlab/snapdom/issues/66)
- Feat: sanitize rootElement to avoid CSS layout conflicts. Fixes #56, fixes #24 [`#56`](https://github.com/zumerlab/snapdom/issues/56) [`#24`](https://github.com/zumerlab/snapdom/issues/24)
- Fix: canvas style props, closes #63 [`#63`](https://github.com/zumerlab/snapdom/issues/63)
- Feat: handling @import and optimice cache, closes #61 [`#61`](https://github.com/zumerlab/snapdom/issues/61)
- Compile .js to es2015, closes #58 [`#58`](https://github.com/zumerlab/snapdom/issues/58)
- Fix background image handling, closes #57 [`#57`](https://github.com/zumerlab/snapdom/issues/57)
- Improve inlinePseudoElements() to handle decorative properties, closes #55 [`#55`](https://github.com/zumerlab/snapdom/issues/55)
- Add ::first-letter detection, closes #52 [`#52`](https://github.com/zumerlab/snapdom/issues/52)
- test: increases coverage [`7ebc871`](https://github.com/zumerlab/snapdom/commit/7ebc87143101a9e5c8573f5ae76ede2884b59eb8)
- Increase test coverage [`0c63478`](https://github.com/zumerlab/snapdom/commit/0c634785157ca9f611973976000b2f25ba7c9549)
- Improve split multiple backgrounds [`0e67a9b`](https://github.com/zumerlab/snapdom/commit/0e67a9b72fb1ea7ea4a625d5f6dc2eb40438d7cd)
- chore: update contributors list [`da22404`](https://github.com/zumerlab/snapdom/commit/da2240490b46ff4a0747f7db741b822dbc6ba3c4)
- chore: update contributors list [`ec7c275`](https://github.com/zumerlab/snapdom/commit/ec7c27590318df95e7aa903ec7cbd92112b6c2e8)
- Add check [`bf9a888`](https://github.com/zumerlab/snapdom/commit/bf9a888525e99dd663c17455755bb1478f1cb9d7)
- Create update-contributors.js [`453dff0`](https://github.com/zumerlab/snapdom/commit/453dff07d0fd8f333627ed22a6e8a64373dbd62d)
- Document width and  height options [`0f7fb7a`](https://github.com/zumerlab/snapdom/commit/0f7fb7a02d9159a831a1dfc4cfbd9f6f3420bca7)
- Create update-contributors.yml [`b48e334`](https://github.com/zumerlab/snapdom/commit/b48e334043e2a18212620df413b8742d72959468)
- Update [`7da2892`](https://github.com/zumerlab/snapdom/commit/7da2892e69d04903111bbd24421a574e0034a83b)
- Bumped version [`f322f51`](https://github.com/zumerlab/snapdom/commit/f322f51e2369bfdbbc1218c15e8375b0858bf73d)
- Update README.md [`99c51a8`](https://github.com/zumerlab/snapdom/commit/99c51a89e2b486bbfc2810d94350428cbc9595f2)
- Update update-contributors.js [`46a868b`](https://github.com/zumerlab/snapdom/commit/46a868baa45bd068be687b19bbd50cb06ceb9cf0)
- Update update-contributors.js [`2a77e4c`](https://github.com/zumerlab/snapdom/commit/2a77e4c82dab36803b005cc6bceab06689a0e52c)
- chore: update contributors list [`020eff8`](https://github.com/zumerlab/snapdom/commit/020eff873c18fc601c145f957bdc566403e18649)
- Update update-contributors.js [`b4cf877`](https://github.com/zumerlab/snapdom/commit/b4cf87709f632be2e03f40b0af5661393f8f8793)
- chore: update contributors list [`a2d28d9`](https://github.com/zumerlab/snapdom/commit/a2d28d952b18787d8e7aabf1b6d12cd8e45fa436)
- Update doc [`7cf19de`](https://github.com/zumerlab/snapdom/commit/7cf19de5df40735b17958359251c481c1b517d8c)
- Update update-contributors.js [`962c7c6`](https://github.com/zumerlab/snapdom/commit/962c7c6a4e23d5b8a0ef4c72111a617ffac3add4)
- Update README.md [`183de8c`](https://github.com/zumerlab/snapdom/commit/183de8ce06c8df35fcbc3a32bb4204c14a657310)
- Update README.md [`4352ae7`](https://github.com/zumerlab/snapdom/commit/4352ae75fb445857c14c64eb9a2ea7dbe82733c3)
- Update update-contributors.js [`7dca4a1`](https://github.com/zumerlab/snapdom/commit/7dca4a1d3bbaacc14295f0e891095db1b39a76d0)
- Update README.md [`ebb7f32`](https://github.com/zumerlab/snapdom/commit/ebb7f3204892d0d42713e7a2a14d261177a24d31)
- Clean transform RootElement prop [`f293e5b`](https://github.com/zumerlab/snapdom/commit/f293e5be0e3ca6a97d43467976d80175d988916d)
- Check if getStyle is iterable [`24dfe05`](https://github.com/zumerlab/snapdom/commit/24dfe056f6d35fe56ab39325b9c4492f84e64cd5)
- chore: update contributors list [`8ac4aa1`](https://github.com/zumerlab/snapdom/commit/8ac4aa1f5a21373e73f86b22d0cdad8def37a8ea)
- chore: update contributors list [`9987328`](https://github.com/zumerlab/snapdom/commit/9987328a796bb3eb70eb45cda4485dc8f5906688)
- Update README.md [`4b52b87`](https://github.com/zumerlab/snapdom/commit/4b52b87e33b6a2f5d34460b2bff13e47ad011a73)

#### [v1.7.1](https://github.com/zumerlab/snapdom/compare/v1.3.0...v1.7.1)

> 19 June 2025

- Improve inlineBackgroundImages to support multiple background-image values.  [`#46`](https://github.com/zumerlab/snapdom/pull/46)
- Add @font-face / FontFace() deteccion, closes #43 [`#43`](https://github.com/zumerlab/snapdom/issues/43)
- update [`7c5441e`](https://github.com/zumerlab/snapdom/commit/7c5441ed4b2c602bcee60b314162f10412b260c5)
- Add benchmark against html2canvas [`f196afe`](https://github.com/zumerlab/snapdom/commit/f196afeb43b23624680a77e52a80222a476f055d)
- Add description [`bcae4af`](https://github.com/zumerlab/snapdom/commit/bcae4af3ce9e0953fea8410303e6d77fe3e01e3e)
- Update issue templates [`352dba3`](https://github.com/zumerlab/snapdom/commit/352dba3e53452f09fb5d056a0c5fb9216701a0f4)
- add options.crossOrigin [`49f8ac6`](https://github.com/zumerlab/snapdom/commit/49f8ac6524e3f54e67505d048a4ad34c529ab6c9)
- Update issue templates [`d832dbd`](https://github.com/zumerlab/snapdom/commit/d832dbd14df70f07d3f3ec9b62016dc4d19d8c9a)
- Create CONTRIBUTING.md [`9a7be15`](https://github.com/zumerlab/snapdom/commit/9a7be151f6b36abd5a582aebbcaacfe759716c3a)
- handle multiple background image in inlineBackgroundImages function [`95a5490`](https://github.com/zumerlab/snapdom/commit/95a5490f2de5a139f39c0286111eb4e84990fd00)
- Update issue templates [`b69b5a4`](https://github.com/zumerlab/snapdom/commit/b69b5a4cb72e3bd0ca5f8ae5b43448c8aab95752)
- update [`57d6b15`](https://github.com/zumerlab/snapdom/commit/57d6b1529c56e890a43cc427f817c731784f6ca0)
- Update index.html [`f002bca`](https://github.com/zumerlab/snapdom/commit/f002bca6ee6330ae9d6f2550d36ce59414de29b0)
- Update issue templates [`24d478f`](https://github.com/zumerlab/snapdom/commit/24d478f32795b42b13f70b4319b5e2cd0ba3fa70)
- Bumped version [`d109fd7`](https://github.com/zumerlab/snapdom/commit/d109fd739197bbc37089f5acfe65ed10a6f48050)
- Add files via upload [`0aecf4e`](https://github.com/zumerlab/snapdom/commit/0aecf4e46093743ca854397509a8be91e08cb666)
- update [`e444762`](https://github.com/zumerlab/snapdom/commit/e444762ddb173d283b761e13a1e5e16c8853e325)
- Update index.html [`997dab3`](https://github.com/zumerlab/snapdom/commit/997dab3293df81dc906116acbf7b4f388a270b39)
- update [`0355286`](https://github.com/zumerlab/snapdom/commit/035528627f957213d35f1c63d9f73528deb972cf)
- Prevent erasing non url background [`0d626cb`](https://github.com/zumerlab/snapdom/commit/0d626cb32b8958afd7e7fd6f96d5a71c6795113b)
- docs: add @jhbae200 as contributor for PR #46 [`afe3094`](https://github.com/zumerlab/snapdom/commit/afe3094360f14712a55c1be134ab993c094a670b)
- Merge pull request #44 from elliots/support-use-credentials-on-images [`005f23e`](https://github.com/zumerlab/snapdom/commit/005f23e529962d73e7550f9f20e92bdc7c8eb8ab)
- Update index.html [`25d970f`](https://github.com/zumerlab/snapdom/commit/25d970fb1142c07bf10c8d9eba491ecdb3bf3e37)
- update [`ea624c3`](https://github.com/zumerlab/snapdom/commit/ea624c362acb7c0f953f3c202dd78f83c84742ce)
- update [`1cf93b7`](https://github.com/zumerlab/snapdom/commit/1cf93b7e25eaa39878f2334e9c240e98ed98f847)
- update [`3a547df`](https://github.com/zumerlab/snapdom/commit/3a547dfccc46e835ac585057d80b03ef5b324e7b)
- update [`2d4380b`](https://github.com/zumerlab/snapdom/commit/2d4380b4c900d3230a44a5af0380d149e55caca9)
- Update index.html [`bedf815`](https://github.com/zumerlab/snapdom/commit/bedf815299c421e3fe810a480f32bb291aae40b1)
- Update issue templates [`48a56fb`](https://github.com/zumerlab/snapdom/commit/48a56fb7f5006b20e64de6a592ec38c7a59b3cd8)
- Create config.yml [`51700c4`](https://github.com/zumerlab/snapdom/commit/51700c4457abb070df34520887991508ce32ad7f)
- update image [`0ec788c`](https://github.com/zumerlab/snapdom/commit/0ec788c562011990a008edb2b8f9b0cf18da8940)

#### [v1.3.0](https://github.com/zumerlab/snapdom/compare/v1.2.5...v1.3.0)

> 14 June 2025

- fix: double scaled images [`#38`](https://github.com/zumerlab/snapdom/pull/38)
- Fix: background img &  img base64 in pseudo elements, closes #36 [`#36`](https://github.com/zumerlab/snapdom/issues/36)
- Feat: captures input values, closes #35 [`#35`](https://github.com/zumerlab/snapdom/issues/35)
- Improve: Device Pixel Ratio handling, thanks @jswhisperer [`1a14f69`](https://github.com/zumerlab/snapdom/commit/1a14f69d340e935126b5388febe5d711c4b94e14)
- Bumped version [`489be08`](https://github.com/zumerlab/snapdom/commit/489be081e6c7e50f1e4ba08d932d79c0ae242d45)
- Update description [`4db784b`](https://github.com/zumerlab/snapdom/commit/4db784b4250b6eac6da8932e651872147fbc8bc1)

#### [v1.2.5](https://github.com/zumerlab/snapdom/compare/v1.2.2...v1.2.5)

> 9 June 2025

- Fix duplicated font-icon when embedFonts is true, closes #30 [`#30`](https://github.com/zumerlab/snapdom/issues/30)
- Fix url with encode url, closes #29 [`#29`](https://github.com/zumerlab/snapdom/issues/29)
- Fix .toCanvas scale [`fb47284`](https://github.com/zumerlab/snapdom/commit/fb4728463a65620bd4f4f8f50cd8b2263ba7bbe7)
- Bumped version [`75b917a`](https://github.com/zumerlab/snapdom/commit/75b917a4fefc5fa9b55da3c028c43955f0656087)
- Update cdn [`37533a2`](https://github.com/zumerlab/snapdom/commit/37533a2c2a858000e93d8d33009241a4be5f8726)
- add homepage [`aa85c5d`](https://github.com/zumerlab/snapdom/commit/aa85c5d9f1777c437b07e624d874f7f1a0fac6a9)

#### [v1.2.2](https://github.com/zumerlab/snapdom/compare/v1.2.1...v1.2.2)

> 4 June 2025

- Patch: type script definitions, closes #23 [`#23`](https://github.com/zumerlab/snapdom/issues/23)
- Bumped version [`548d7f3`](https://github.com/zumerlab/snapdom/commit/548d7f30a889d34ae4dac28a8dedc43262089325)

#### [v1.2.1](https://github.com/zumerlab/snapdom/compare/v1.1.0...v1.2.1)

> 31 May 2025

- feat(embedFonts): also embed icon fonts when embedFonts is true [`#18`](https://github.com/zumerlab/snapdom/issues/18)
- Fix expose snapdom and preCache on browser compilation, closes #26 [`#26`](https://github.com/zumerlab/snapdom/issues/26)
- Improve icon-font conversion [`7bac4ee`](https://github.com/zumerlab/snapdom/commit/7bac4ee3b152d6364c218aaa6d2bed4ad9997943)
- Fix compress mode [`652cfe9`](https://github.com/zumerlab/snapdom/commit/652cfe9a8947029e31db6b089829fe8da87c0b42)
- Bumped version [`0cd7973`](https://github.com/zumerlab/snapdom/commit/0cd797320b92310d86df0ce6296706d1f7f0ad5d)
- Remove some logs [`4348b39`](https://github.com/zumerlab/snapdom/commit/4348b390ab8bb88c59ba9b0d24adbe58051b277a)
- Chore: delete old comments [`ff81a40`](https://github.com/zumerlab/snapdom/commit/ff81a40e8a1b4baa8bacca2ed2ec59124df40b6e)
- Chore: add dry bump script [`5c421c7`](https://github.com/zumerlab/snapdom/commit/5c421c75a1775a3b8c1fbd6a688fcfe409f676af)

#### [v1.1.0](https://github.com/zumerlab/snapdom/compare/v1.0.0...v1.1.0)

> 28 May 2025

- Add typescript declaration, closes #23 [`#23`](https://github.com/zumerlab/snapdom/issues/23)
- Feat. support scrolling state, closes #20 [`#20`](https://github.com/zumerlab/snapdom/issues/20)
- Fix bug by removing trim spaces, closes #21 [`#21`](https://github.com/zumerlab/snapdom/issues/21)
- fix margin on mobile [`36297c8`](https://github.com/zumerlab/snapdom/commit/36297c89c085f605922f88ac5113f2f176c6a1a9)
- mobile friendly [`42dada8`](https://github.com/zumerlab/snapdom/commit/42dada88bdbe886033890071e8e76499358a6b91)
- Update index.html [`1bf3bc1`](https://github.com/zumerlab/snapdom/commit/1bf3bc1b15f4d28b50363c73410cea25ad589cda)
- Create FUNDING.yml [`ddf914c`](https://github.com/zumerlab/snapdom/commit/ddf914c96727b3a82bbea4694d19dc0eb2b518e3)
- Bumped version [`7a9f3d8`](https://github.com/zumerlab/snapdom/commit/7a9f3d8662099d15bcc2046ba88043eb3d3b1bfb)
- add ga [`6d8a73f`](https://github.com/zumerlab/snapdom/commit/6d8a73fd52997e9e1a91944bd9a46d95c8c8507c)
- Update index.html [`46e4b41`](https://github.com/zumerlab/snapdom/commit/46e4b41209c44766425e96fb9be94e1d1c08b6ae)
- Update index.html [`1a2a04c`](https://github.com/zumerlab/snapdom/commit/1a2a04cbb3f4e81e2713d823d5b8dcdeb508591d)
- Ignore generated screenshots tests [`cce8ead`](https://github.com/zumerlab/snapdom/commit/cce8ead47c470280761a34f7c98f9a2fd0796a34)
- Update index.html [`5dd6749`](https://github.com/zumerlab/snapdom/commit/5dd67495df0a5cd48eda168565a81969d5639f40)
- FIx bug that prevent scale on png format [`77a5265`](https://github.com/zumerlab/snapdom/commit/77a52651bd0ea8ccb451f199bd3d8f9e2478bf84)
- Update README.md [`d8440f3`](https://github.com/zumerlab/snapdom/commit/d8440f3864931509f1b369d7e301d6ecccb63b14)
- update [`ffa3a9a`](https://github.com/zumerlab/snapdom/commit/ffa3a9ad942987a5b52a7c9080914bed912db558)
- Update README.md [`9c79e6e`](https://github.com/zumerlab/snapdom/commit/9c79e6e406ff9cb4df1539480e057b6828ef1788)
- Update index.html [`7585674`](https://github.com/zumerlab/snapdom/commit/7585674ed21bb7009b84d1f948ceed2d5ed5ae69)
- Update index.html [`8f4fb95`](https://github.com/zumerlab/snapdom/commit/8f4fb95a8f839159bd00c3338c7c3dc9fb23071c)
- Update index.html [`eebc2bc`](https://github.com/zumerlab/snapdom/commit/eebc2bc01a6581f25995d5a9e946aa6bde08dfdc)

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

- Update Dev branch [`#11`](https://github.com/zumerlab/snapdom/pull/11)
- Delete functions [`c5040d9`](https://github.com/zumerlab/snapdom/commit/c5040d90b6276daa04e919ca4b0ecdf205f73af9)
- improve cache handling [`27d7b19`](https://github.com/zumerlab/snapdom/commit/27d7b19cfafeed83f4b30a824638ee7edd63e10b)
- add some examples [`3ce9dd2`](https://github.com/zumerlab/snapdom/commit/3ce9dd2807c8b84ed927c186621850a2518dfd2a)
- Reorganice and add helpers [`c4f4182`](https://github.com/zumerlab/snapdom/commit/c4f4182a3e9ce636a2a263a05d75e64b33b25d7b)
- Add tests [`455e7f2`](https://github.com/zumerlab/snapdom/commit/455e7f20e8a72f6a646a7d1e900f41fb22a18666)
- Check if element to capture exists [`dfa96f2`](https://github.com/zumerlab/snapdom/commit/dfa96f2f720238fdff5df6e24b4572691ad6198f)
- Improve capture logic [`79ab1b9`](https://github.com/zumerlab/snapdom/commit/79ab1b9e165dd08a34338fe0d837b0330be48539)
- Update readme [`fdc2877`](https://github.com/zumerlab/snapdom/commit/fdc2877fd9e6fb73bc5d7bc9cf1f4a405f088be0)
- Add preCache [`48bd910`](https://github.com/zumerlab/snapdom/commit/48bd910743a638ae8ce35ab7d617ad05a75d29a2)
- Optimice [`cc638e7`](https://github.com/zumerlab/snapdom/commit/cc638e7f0f2e63a24eeee65ab4d87755e7207dec)
- Bumped version [`3b26632`](https://github.com/zumerlab/snapdom/commit/3b266324c747c4bc139b99e4978493df79a5555c)
- update [`111fdb4`](https://github.com/zumerlab/snapdom/commit/111fdb444b3c6d61dcb0e6bb2e21c871f5e73587)
- Add cache Maps [`091484c`](https://github.com/zumerlab/snapdom/commit/091484c00941822684afc9148a59cb23e4b34627)
- update [`bdbba7a`](https://github.com/zumerlab/snapdom/commit/bdbba7aeff458a60d5a83b5ead2d4f9402492fd3)
- Update README.md [`c1756a9`](https://github.com/zumerlab/snapdom/commit/c1756a9192f8e3af90fd66da7e19c5fb883dbe0a)
- Expose preCache [`1e96db1`](https://github.com/zumerlab/snapdom/commit/1e96db14c6c4e697361ceed2fb6f9c618801a138)
- Chore [`38c08c0`](https://github.com/zumerlab/snapdom/commit/38c08c0c5a9eda486619855b9df47f33f490a921)
- fix url [`bebec7f`](https://github.com/zumerlab/snapdom/commit/bebec7fd70141b3a82d41a5f6cc0849dcfb0c715)
- Update README.md [`fb0ab3a`](https://github.com/zumerlab/snapdom/commit/fb0ab3ae528d4b37223e4eef03135e9be6a62b0b)
- Update README.md [`1a76186`](https://github.com/zumerlab/snapdom/commit/1a76186d938a7a776a33c0e42ecc6813e86a9262)
- Update README.md [`90d18a1`](https://github.com/zumerlab/snapdom/commit/90d18a165725ca3369fb5ebf48c281e0dd1377ae)

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
- Update commented docs [`cfd2272`](https://github.com/zumerlab/snapdom/commit/cfd2272b065e8c11fff1a729c6cbec1f14000668)
- Update README.md [`fef6751`](https://github.com/zumerlab/snapdom/commit/fef6751ffa90d379c8d829998277825daddc27b8)
- update [`26ff7ea`](https://github.com/zumerlab/snapdom/commit/26ff7ea0528d569820bed8748520a7d02c6506cd)
- Update README.md [`3fda999`](https://github.com/zumerlab/snapdom/commit/3fda999bbdefb5aa32186bb07c59249f9a86e7e9)
- Update README.md [`8ee616b`](https://github.com/zumerlab/snapdom/commit/8ee616baf0059eefcf7e83e7930f5ab8f3850eb5)
- Omit delay function - temporary [`0f04721`](https://github.com/zumerlab/snapdom/commit/0f04721c458ba921694ee38117b8e0b8231a8c1a)
- update unpkg url [`13ce66b`](https://github.com/zumerlab/snapdom/commit/13ce66bfee83802c32edfd9019959540d260cf84)
- Bumped version [`9e4f518`](https://github.com/zumerlab/snapdom/commit/9e4f51885bddebd5364fb4ca96647233304e0dc7)
- Update README.md [`3733476`](https://github.com/zumerlab/snapdom/commit/373347665ca89249244038eaf48731f6d7ee37b8)
- Update README.md [`00c74b0`](https://github.com/zumerlab/snapdom/commit/00c74b07881373275d8c0e5144696d594b031e7e)
- Update README.md [`dd2c9c5`](https://github.com/zumerlab/snapdom/commit/dd2c9c5dd507a432e4dc75e67c5d2d311073e791)
- Update README.md [`d271cf7`](https://github.com/zumerlab/snapdom/commit/d271cf77f5747ee69df07785fef34e8c5e63649e)
- Update README.md [`02bf650`](https://github.com/zumerlab/snapdom/commit/02bf6506ae7e3cf03507e10d8f76983c07f39c66)

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
