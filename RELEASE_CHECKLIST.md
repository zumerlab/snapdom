# Coordinated v3 release checklist

This runbook prepares and reviews a release of **both** `@zumer/snapdom` and
`@zumer/snapdom-plugins`. Preparation is local. Registry publication, dist-tag changes,
Git pushes and site deployment are separate actions. The current preparation does not
authorize or perform them. A green test report is evidence about its recorded inputs,
not approval to replace v2 for everyone.

## 1. Record the candidate and decisions

Complete these fields in the retained release dossier; do not infer unresolved decisions
from package defaults or from this checklist.

| Decision | Required record |
| --- | --- |
| Source | Exact commit; clean/dirty status and patch; explicitly retained untracked source files |
| Core and plugins | Exact package versions, tarball SHA-256 values and compatible peer range |
| Channel | `beta` for opt-in prereleases; separate approval for a stable version on `latest` |
| Baselines | Reviewer/date or approval reference, origin, SHA-256 manifest and browser/OS identity |
| v2 docs | Preserved deployment artifact, permanent versioned URL, legacy URL/redirect policy and verification owner |
| v2 support | **Decision pending:** supported version, fixes/security scope, owner, support duration and communication date |
| Rollback | Recorded previous core/plugins dist-tags, prior site deployment and tested recovery owner |
| Adoption | Named external integrations, tested versions/scenarios and outcomes; local fixtures remain separate evidence |

Do not reuse a package version already present in the registry for different bytes.
Check registry versions/dist-tags immediately before any authorized publication. A
prerelease version such as `3.0.0-beta.N` remains on `beta`; replacing v2 on `latest`
requires a separately reviewed stable candidate. Changing the version changes the
bundle banner and package metadata: rebuild and repeat the gates for that version.

## 2. Freeze inputs and run local gates

Use the reviewed source, the lockfile and the approved visual inputs. Stop concurrent
editing before the final run. Install the lockfile dependencies with `npm ci` in a clean
reproduction environment and install the Playwright browser revisions required by that
lockfile. Preserve the original results if a run fails; a successful retry does not erase
the failure or explain its cause.

```sh
release_stage="$(mktemp -d /tmp/snapdom-release-XXXXXX)"
REQUIRE_VISUAL=1 npm run test:full > "$release_stage/full.log" 2>&1
```

Check the command's exit status before continuing. Keep the test and file totals, reasons
for every skip, visual comparison totals and browser versions. Never enable visual
baseline updates during this run. `REQUIRE_VISUAL=1` rejects missing baselines and fails
when network-dependent coverage cannot run. Its visual tests still permit the documented
pixel tolerance and one retry; do not describe a final pass as universal pixel equality.

If a concurrent run cannot complete because the shared network lane is saturated, retain
its failed report and run the complete suites one browser at a time. Keep every prerequisite
and the same visual/network gates; do not update baselines, lower thresholds, filter out
test files or force the network gate off. A valid sequential alternative is:

```sh
npm run lint && npm run test:types && npm run test:release-checks && npm run test:bundle
REQUIRE_VISUAL=1 BROWSER=chromium npx vitest run --browser.headless --reporter=verbose > "$release_stage/chromium.log" 2>&1
REQUIRE_VISUAL=1 BROWSER=firefox npx vitest run --browser.headless --reporter=verbose > "$release_stage/firefox.log" 2>&1
REQUIRE_VISUAL=1 BROWSER=webkit npx vitest run --browser.headless --reporter=verbose > "$release_stage/webkit.log" 2>&1
```

Run each line only after the preceding command succeeds and preserve prerequisite output
too. Retain all three complete reports and include them in the dossier instead of claiming
the concurrent gate passed. If a visual mismatch passes on a later isolated/sequential
run, report that it did not reproduce; a passing retry alone does not establish that the
original pixel/dimension discrepancy was caused by network conditions.

Run the real Safari smoke separately with Remote Automation already enabled. Start
`safaridriver -p 4447` in a dedicated terminal, then:

```sh
node scripts/safari-release-smoke.mjs > "$release_stage/safari.json"
```

Check its exit status and recorded checks/version, then stop only the driver process
started for this run. Playwright WebKit and macOS Safari are distinct evidence; neither
proves physical iOS coverage.

After the README and plugin documentation are final, retain the **same tarballs tested
as consumer dependencies**, rather than packing a second untested candidate:

```sh
npm run test:pack -- --keep-artifacts "$release_stage/packages" > "$release_stage/pack.log" 2>&1
```

The destination must not exist and its parent must exist. The existing package check
rebuilds `dist/`, verifies archive contents, installs both tarballs offline, checks
strict TypeScript Node16/Bundler resolution, imports the public entrypoints and checks
browser-global isolation. The optional flag retains both tarballs only after those
checks pass. It never publishes them.

Set `release_core` and `release_plugins` to the two actual retained tarball paths, then:

```sh
node scripts/smoke-packed-consumer.mjs \
  --core "$release_core" --plugins "$release_plugins" \
  --out "$release_stage/consumer-smoke"
```

This creates an isolated consumer, installs the exact tarballs offline, and serves their
installed files with no source aliases. Chromium, Firefox and WebKit each exercise:

| Local scenario | Required behavior |
| --- | --- |
| Simple script-tag export | Version, PNG/Blob decoding, canvas dimensions and painted pixels |
| Dashboard with local font/image | Embedded font, inlined image, colored image pixels and output size |
| Official plugins and exclusions | External callback changes honored, HTML/semantic privacy, public content retained, source untouched and earlier result frozen; `exclude` hide and `filter` remove operate together with exclusion precedence and distinct layout effects |

The report records tarball hashes and actual browser versions. It also retains separate
native browser and SnapDOM images. These are representative **local integration tests**;
they are not reports of external adoption, tests of every framework, or exhaustive
visual parity. Existing package type checks close another local integration boundary.
Real applications, device coverage and user feedback require their own evidence.

## 3. Collect a reproducible local dossier

```sh
node scripts/collect-release-evidence.mjs \
  --out "$release_stage/evidence" \
  --core-tarball "$release_core" --plugins-tarball "$release_plugins" \
  --baseline-approval "$release_baseline_approval" \
  --log "$release_stage/full.log" \
  --log "$release_stage/pack.log" \
  --log "$release_stage/safari.json" \
  --log "$release_stage/consumer-smoke/report.json"
```

Set `release_baseline_approval` to a real reviewer/date or approval reference. Omit the
flag while that decision is pending; the collector records missing evidence instead of
approving anything. For a dirty preparation tree, add `--include-untracked path/to/file`
for **each explicitly reviewed new source/test/script file** needed to reconstruct it.
Unselected untracked files are listed and flagged. The collector requires explicit
`--include-visual-input path` for every local visual demo or asset absent from the source
archive, including ignored fixtures. Review these paths; they are retained locally for
validation, without adding them to a public package. Other ignored files are not swept
into the source archive. Use `--require-clean` for a final clean-checkout
release dossier after the separately authorized commit exists.

The collector performs only local reads/copies. It does not build, pack, test, publish,
launch browsers, or upload evidence. It refuses an existing output directory, stale
bundles, missing visual inputs, mismatching core/plugin tarball bytes, or a checkout
changing during collection. Its `manifest.json` is written last; absence means the
collection is incomplete. `missingEvidence` must be reviewed even when collection exits
successfully. Baseline approval is an operator attestation, never inferred from a pass.

Retain the whole dossier, including `source/HEAD.tar.gz`, the binary working-tree patch,
selected untracked and visual-input archives (if any), bundles, tarballs, `baselines.tar.gz`, baseline hashes,
validation reports and environment metadata. Verify the manifest's SHA-256 values before
using a copied dossier. To reproduce in a **new empty directory**, extract HEAD, apply
the patch with `git apply --binary` when nonempty, extract explicitly selected untracked
files and `source/visual-inputs-selected.tar.gz` when present, then extract `baselines.tar.gz`
at that checkout root. Check every hash in `visual-inputs.json` and require the same
visual test inventory per browser as its `demosPerBrowser` value; an exit code of zero
alone cannot establish equivalent coverage. Restore dependencies from
the included lockfile with `npm ci`, install matching browsers and rerun the gates with
baseline updates disabled. Font rasterization can depend on OS/browser versions; retain
that identity with the baselines. Dependency downloads and browser installation still
need caches or network: the evidence archive is not a complete offline build toolchain.

There is no automatic release-test workflow in the repository as of this runbook's
creation. A clean-checkout reproduction with the retained approved baselines closes the
local-input gap; setting up CI and artifact retention remains an operational follow-up.

## 4. Preserve v2 before changing the public default

- Preserve a deployable copy of the currently served v2 documentation and its assets.
  Record the artifact hash, current deployment identity and a tested versioned URL.
- Keep v2 API, installation and migration links reachable. Verify legacy links and
  redirects against the preserved deployment; archiving source alone is insufficient.
- Prepare the v3 site with exact compatible core/plugin versions. Check script-tag,
  ESM and official plugin examples, and make the version selector lead to both versions.
- Resolve the v2 support fields in section 1 before promoting v3 as the default. Do not
  invent an end-of-support date or promise a maintenance window in release copy.

## 5. Registry/CDN checks after a separately authorized publication

These checks are **pending publication**. Local URL rewrites and installed tarballs
cannot prove availability of unpublished registry versions or CDN transformations.

1. Save current registry versions and dist-tags for both packages, including previous
   `latest` and `beta` values. Confirm that both chosen new versions are unused.
2. Publish the reviewed core tarball to `beta`, then the matching plugin tarball to
   `beta`, using explicit tags. npm does not publish the pair atomically: if either step
   fails, stop promotion and record the partial state. Do not move `latest` during this
   prerelease phase.
3. Install both exact versions into a fresh consumer **from the registry**. Compare
   fetched tarball bytes/integrity with the retained candidates and rerun the package
   entrypoint/type/runtime checks against what was fetched.
4. Open the exact CDN URLs used by the release website, including core script-tag/ESM,
   plugin root/subpaths and recording dependencies. Confirm HTTP success, content types,
   correct runtime version, compatible core identity and working captures/exports.
   Verify the actual rendered public site after deployment; the local site server can
   substitute checkout files and hide CDN/version mistakes.
5. For a stable candidate, verify the accepted external integration evidence and all
   earlier decisions before separately approving `latest`. Confirm both package tags
   after promotion, check default installs, and record the public documentation state.
   Core and plugins require coordinated tag updates, even if their version numbers differ.

Do not use a generic `npm publish` from a working directory in place of publishing the
retained reviewed tarball. Do not run `release:push` as a validation step: it commits and
pushes. Publication/hosting tooling must carry explicit intended versions and tags.

## 6. Recovery and limits

Record the previous versions/tags and documentation deployment **before** promotion.
If a blocking regression appears, the release owner can restore the previously recorded
tags for both packages and restore the preserved site deployment, then verify a fresh
default install and public documentation. Publish a corrected version and migration
guidance as appropriate; deleting a release is not the normal rollback mechanism.

Changing a dist-tag affects future resolutions of that tag. It does not change exact
version pins, existing lockfiles, installed applications or already cached CDN responses.
It cannot undo screenshots or data already exported. A v3 application may use APIs absent
in v2, so downgrading requires an application-specific check. Retain the affected artifacts,
failure evidence and support communication; do not overwrite them with the recovery run.
