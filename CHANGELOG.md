### Changelog

All notable changes to this project will be documented in this file. 

#### [v1.9.10-dev.0](https://github.com/zumerlab/snapdom/compare/v1.9.9...v1.9.10-dev.0)

> 29 August 2025

- Code refactor, cache improve, options centralized [`3bd7182`](https://github.com/zumerlab/snapdom/commit/3bd71822cf72614b3bb5993039482fdb05833ceb)
- Improve performance and cache [`8882025`](https://github.com/zumerlab/snapdom/commit/88820259d4000fd36dbf4f59bb4940a6e12e6611)
- Enhance font handling [`cb1e04a`](https://github.com/zumerlab/snapdom/commit/cb1e04af0551f097b44eeb84ba64a97e869b6f60)
- Improve capture fidelity [`e05f027`](https://github.com/zumerlab/snapdom/commit/e05f027b8eb3b5b90e22a9d8ce7a7279f7b1614b)
- fix font fetching [`70dd092`](https://github.com/zumerlab/snapdom/commit/70dd092adb14899031f0596d83ec354c9ab023b9)
- Set compress as default [`7e5ab00`](https://github.com/zumerlab/snapdom/commit/7e5ab007f653f995b09ecbbf7711d69937fdef4a)
- optimice code [`df52437`](https://github.com/zumerlab/snapdom/commit/df524379288fcb08dd19b8957d627a24b898685e)
- Core update: increase X3 speed capture compared 1.9.9 [`94bc57d`](https://github.com/zumerlab/snapdom/commit/94bc57dc53cb63d82532467b4a041ab26da7481a)
- Ensure custom fonts are capured [`8125689`](https://github.com/zumerlab/snapdom/commit/81256893249b2313edfebacb9d68ec6ed4fa9ed2)
- Fix first custom font bug on Safari [`971d976`](https://github.com/zumerlab/snapdom/commit/971d9762dd73263689057e16fb47c00d2e0eba1b)
- Fix bug that affects overall capture fidelity [`35539a5`](https://github.com/zumerlab/snapdom/commit/35539a50da67c30e28c39272a4c1efefbf24a2e2)
- update to avoid vitest issues [`51ef80d`](https://github.com/zumerlab/snapdom/commit/51ef80d24b693ceee3e33d75e2b64ba7037e49ea)

### Changelog

All notable changes to this project will be documented in this file. 

#### [v1.9.9](https://github.com/zumerlab/snapdom/compare/v1.9.8...v1.9.9)

> 14 August 2025

- Improves external fonts handling. Closes #139, closes #146, closes #186 [`#139`](https://github.com/zumerlab/snapdom/issues/139) [`#146`](https://github.com/zumerlab/snapdom/issues/146) [`#186`](https://github.com/zumerlab/snapdom/issues/186)
- Handles srcset. Closes #190 [`#190`](https://github.com/zumerlab/snapdom/issues/190)
- Fix speed regression. [`542ed00`](https://github.com/zumerlab/snapdom/commit/542ed003e3f35c19bd51fd5317f5572c12ba1ac8)
- Handles Blob scr [`fe27239`](https://github.com/zumerlab/snapdom/commit/fe27239ac3efef9a0e9e7f0feeb223dd74fd9086). Closes [`#169`](https://github.com/zumerlab/snapdom/issues/169) 


#### [v1.9.8](https://github.com/zumerlab/snapdom/compare/v1.9.7...v1.9.8)

> 10 August 2025

- fix(types): update `preCache` [`#166`](https://github.com/zumerlab/snapdom/pull/166)
- Fix defs & symbols outside captured element and hidden visibility, closes #178. Stabilize layout before cloning, closes  #179. Fix inline styles, closes #177 [`#178`](https://github.com/zumerlab/snapdom/issues/178) [`#177`](https://github.com/zumerlab/snapdom/issues/177)  [`#179`](https://github.com/zumerlab/snapdom/issues/179)
- Fix icontFont alignment and rendered size. Closes #176 [`#176`](https://github.com/zumerlab/snapdom/issues/176)
- Ensure skip empty pseudo elements. Closes #168 [`#168`](https://github.com/zumerlab/snapdom/issues/168)
- Add basic border-image support. Closes #159 [`#159`](https://github.com/zumerlab/snapdom/issues/159)
- Fix input css styles. Closes #144, closes #147 [`#144`](https://github.com/zumerlab/snapdom/issues/144) [`#147`](https://github.com/zumerlab/snapdom/issues/147)


#### [v1.9.7](https://github.com/zumerlab/snapdom/compare/v1.9.6...v1.9.7)

> 27 July 2025

- Fix input css styles. Closes #144, closes #147 [`#144`](https://github.com/zumerlab/snapdom/issues/144) [`#147`](https://github.com/zumerlab/snapdom/issues/147)
- Fix Safari scale. Closes #133 [`#133`](https://github.com/zumerlab/snapdom/issues/133)
- Fix @font-face. Closes #145 [`#145`](https://github.com/zumerlab/snapdom/issues/145)
- Fix edge case that generates blank images on Safari. Closes #129 [`#129`](https://github.com/zumerlab/snapdom/issues/129)
- Improve pseudo elements detection. Closes # 143 [`539e488`](https://github.com/zumerlab/snapdom/commit/539e488c018a1bf7be05e0d9d969e350c9ed4291)
- Remove default backgroundColor on download(). Ref dissussion #142 [`a875fe3`](https://github.com/zumerlab/snapdom/commit/a875fe31c1c1fc9a1d0d59ef2934b5930a6b7c88)
- Update docs, thanks @kohaiy[`e38d67b`](https://github.com/zumerlab/snapdom/commit/e38d67b0102edf75a9f6e742bd45eacc43be51c1)

#### [v1.9.6](https://github.com/zumerlab/snapdom/compare/v1.9.5...v1.9.6)

> 20 July 2025

- Add options argument to toBlob function. Thanks @rbbydotdev [`#118`](https://github.com/zumerlab/snapdom/pull/118)
- Keep canvas CSS style. Fixes #121. [`#121`](https://github.com/zumerlab/snapdom/issues/121)
- Improve: handles local() source font. See #114 [`c088aa0`](https://github.com/zumerlab/snapdom/commit/c088aa01422bf6ea6c1be70a88d09d540eae5038)
- Improve webcomponent clone [`a0f37a5`](https://github.com/zumerlab/snapdom/commit/a0f37a57079057548e97a973bc6c734b4141769d)
- Perf: unifies cache [`fe3a368`](https://github.com/zumerlab/snapdom/commit/fe3a3680ddef2736fc0176dcbc210fc760149038)
- Improve cache handling. [`183ae2f`](https://github.com/zumerlab/snapdom/commit/183ae2f90debfb472164df01616f2558136a9f8f)
- Adjust cache reset [`ff33ed3`](https://github.com/zumerlab/snapdom/commit/ff33ed374dcc02272225ca0154a84c304e6fc19a)
- Improve regex [`1b4d5ad`](https://github.com/zumerlab/snapdom/commit/1b4d5ada356bce55caecd008df746f891d379c48)
- Add primitive support to css counter. See #120 [`160bc2e`](https://github.com/zumerlab/snapdom/commit/160bc2eaf984051e23031664040ea91166bca061)
- Fix bug background-color on export formats. See #90 [`47a34a9`](https://github.com/zumerlab/snapdom/commit/47a34a971cc875ec4d9eab772266df81a94438e7)
- Fix regression textArea duplication [`1759fd0`](https://github.com/zumerlab/snapdom/commit/1759fd0ae1681e17df946d507ae4d704efff1b18)
- Prevent process local ids. See #128 [`659e862`](https://github.com/zumerlab/snapdom/commit/659e8627bb6545f7843de1bcf808dc6bfb4dff3e)
- Add node version and improve docs. See #123. Thanks @miusuncle [`e457bf6`](https://github.com/zumerlab/snapdom/commit/e457bf64ca2b4294aaf237c165f865ea50cc0c14)


#### [v1.9.5](https://github.com/zumerlab/snapdom/compare/v1.9.3...v1.9.5)

> 14 July 2025

 Fix: add type def for `SnapOptions`. Thanks @simon1uo  [`#111`](https://github.com/zumerlab/snapdom/pull/111)
- Add `checkbox.indeterminate`. Thanks @titoBouzout [`#104`](https://github.com/zumerlab/snapdom/pull/104)
- Add mask-image CSS detection (closes #106) [`#106`](https://github.com/zumerlab/snapdom/issues/106)
- Add slot detection (closes # 97) / Fix textarea content duplication (closes #110) [`#110`](https://github.com/zumerlab/snapdom/issues/110)
- Add html-to-image to benchmark. Closes #103 [`#103`](https://github.com/zumerlab/snapdom/issues/103)

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