---
name: throng-build-release
description: Use for the build pipeline, packaging and release — TypeScript project references, the Vite renderer build, the generation scripts, electron-builder and the NSIS per-user installer, the bundled host-Node runtime, installer verification and publish gates, the GitHub Actions workflows and E2E shard planning on CI. Triggers include a broken or slow build, a native module ABI error, "the packaged app cannot find X", adding a runtime dependency, cutting a release or a tag, CI workflow edits, runner minutes, and version stamping.
---

# throng — build, packaging, CI and release

## Build order (`npm run build`)

`tsc -b` (project references across `packages/*`) → `generate:defaults` → `build:renderer` (Vite, in
`@throng/ui`) → `stamp:build` → `generate:version` → `generate:licenses`. Type-checking needs the
*second* pass too: `npm run typecheck` = `tsc -b` **plus** `tsc -p packages/ui/tsconfig.renderer.json`
— the references build alone does not cover the renderer, and `renderer-typecheck-gate.test.ts`
exists to keep that honest.

Generation scripts live in `scripts/` (`generate-shipped-defaults`, `generate-version`,
`generate-licenses`, `stamp-build`, `stage-runtime`, `checksum`, `publish-gates`, `verify-installer`,
`residue-scan`). Regenerate; never hand-edit generated output.

## Packaging — the constraints that make this app unusual

Read the comment block at the top of `electron-builder.yml` before changing anything there. The three
load-bearing decisions:

- **`npmRebuild: false`.** The daemon is a **host-Node** process, not Electron. `better-sqlite3`,
  `node-pty` and `koffi` are built against the host-Node ABI and loaded by a bundled `node.exe`
  staged by `scripts/stage-runtime.mjs`. Rebuilding natives against Electron's ABI breaks the daemon
  and demands a C++ toolchain at package time.
- **`asar: false`.** A plain-Node child cannot `require` from inside an asar archive, and `.node`
  addons must exist as real files. The monorepo `packages/*` layout is preserved under
  `resources/app` so relative resolution still works.
- **`publish: null`.** electron-builder must never publish. Publishing is a separate gated job.

`packaged-runtime-deps.test.ts` and `daemon-runtime-path.test.ts` guard the packaged layout — a new
runtime dependency means checking both.

## Release (docs/releasing.md)

Versioning → packaging → **reconcile** → **verification** (one verdict per artifact) → **QA
sign-off** → publish via `gh release create`, gated by `scripts/publish-gates.mjs`
(`THRONG_QA_SIGNED_OFF`, `THRONG_VERDICT_FILES`, `THRONG_ARTIFACT_DIR`, `THRONG_RELEASE_TAG`,
`THRONG_ALREADY_PUBLISHED`). There is a published **checksum instead of code signing** — that is a
deliberate, documented choice, not an omission to fix.

**A release is a DECLARED SET of artifacts, not a file the pipeline finds** (042). The declaration
is `packages/core/src/config/release-artifacts.ts` — three roles today (`setup`, `portable`,
`archive`), and #361 will add a fourth. Every step resolves by **role** through
`scripts/artifact-set.mjs` (`list`, `resolve`, `reconcile`, `checksums`). Nothing globs, and nothing
resolves by file extension: `nsis` and `portable` both produce a `.exe`, which is exactly why
`ls dist/installer/*.exe | head -n1` was removed from three separate places in `release.yml`.

- **`reconcile` runs straight after packaging and fails in BOTH directions** — a declared artifact
  that was not built, and one that was built but never declared. `npm run package` empties
  `dist/installer` first (`prepackage` → `scripts/clean-dist.mjs`) so a stale artifact from a
  previous release cannot fail a clean build.
- **Verification produces one `ArtifactVerdict` per role**, and a step has THREE outcomes:
  `passed`, `failed`, `not-applicable`. An archive has no installer, and a verdict asserting an
  uninstall that never ran is worse than one that fails honestly. A verdict marking an *applicable*
  step `not-applicable` is **invalid**; a verdict covering only some of the set is a **refusal**,
  not a partial pass.
- **Release notes come from `CHANGELOG.md`**, committed before the tag so they are reviewed as a
  diff. `scripts/release-notes.mjs` composes the body; it never writes prose and never falls back to
  another version's notes. Publication is refused when the notes are missing, empty, or headed with
  a different version.
- **The gate has five conditions**, the four cheap ones before the human: real version → artifact
  set reconciles → verified → notes bind to this version → QA sign-off.

When running `verify-installer.mjs` on a developer machine, two things look like product bugs and
are not: the launch probe needs its own `--user-data-dir` (Electron keys the single-instance lock to
`userData`, which a *packaged* build does not isolate, so it collides with any throng already
running), and the residue scan attributes processes **by path** because a throng running from
somewhere else is a different installation. Neither can occur on a clean runner.

**Verifying the `portable` role has three rules, and breaking any one of them produces a failure that
looks exactly like a broken package.** Seven runs were spent learning them; the build was never at
fault, and launching a portable throng normally opens a window every time.

1. **Copy the unpacked tree before stopping the launcher.** The launcher deletes its unpack
   directory when it exits, so unpack → kill → drive the unpacked exe destroys what it is about to
   test. The probe then starts, attaches a debugger and quits as its files disappear.
2. **Wait for the tree to settle before copying.** `throng.exe` appears first and the remaining
   ~135 MB lands behind it; copying on first sight takes a torn read that starts, attaches, and then
   hangs forever waiting for a file that was never copied.
3. **Pass NO `PORTABLE_EXECUTABLE_DIR` / `PORTABLE_EXECUTABLE_FILE`.** Supplying them — which is
   what the launcher does, and looks obviously correct — makes the app exit 1 the instant Playwright
   attaches. The `archive` role is the same binary driven the same way without them, and passes.

`--keep-residue` is how you check the residue scan can still fail: it leaves the tree in place and
`residue-scan` must come back `failed`. A pass there means the scan is looking somewhere the app
never was, and its ordinary green is worthless.

## CI (`.github/workflows/ci.yml`)

Jobs: **Plan E2E** → **Lint & type-check** → **Unit / component / integration / contract** (builds
first, for the daemon-spawning layers' `BUILD_ID`) → **E2E (@core)**, plus **E2E (@admin,
elevated)**. Windows runners, one worker, 1920×1080 forced, an alias-free temp dir.

**There is one E2E job, not three shards** (034 FR-057). Sharding bought ~12 minutes down to ~4-5 at
THREE TIMES the runner-minutes, plus a ~3-4 minute `npm ci` + build toll per shard before any test
ran (#103) — a trade that does not pay for a ≤50-test critical lane. `shard-plan.json`,
`THRONG_E2E_SHARDS`, `THRONG_E2E_GROUP`, the blob reporter, `THRONG_E2E_BLOB_OUT`, the `merge-e2e`
job and `blob-report-naming.test.ts` are all gone with it; the last four existed only because three
shards wrote one filename (#216).

CI runs `--grep @core`. The rest of the suite runs in full at **release** (`release.yml`), where
wall-clock is on nobody's critical path. Do not reintroduce a matrix without re-measuring the trade.

`scripts/ci-e2e-run.ps1` implements the constitution's infrastructure-fault rule: retry the lane once
**only** when its report shows 0 unexpected and 0 flaky, comment the retry on issue #75, stay red
otherwise. That rule is Principle V and has nothing to do with sharding — it merely used to live in
the shard script.

## Spending runner minutes well

**Run it locally before you push it** — the full E2E suite is ~21 minutes locally (measured
2026-08-18 at 229 spec files), while CI runs only the 50-test `@core` lane in four to five minutes.
The one thing local runs genuinely cannot answer is elevation: a developer machine is normally not
elevated, GitHub's runners always are.

There is **no way to skip a CI job any more** — the `[ci-admin-only]` marker and the `plan` job that
read it are gone (034 FR-057). The marker existed to avoid spending ~36 runner-minutes on three
12-minute shards; there are no shards, so it would now skip one short job while making the gating
lane something a commit message could switch off.

## Not yours

Writing or fixing tests → `throng-e2e-harness`. Product code in any package → the owning area agent.
Branch/PR mechanics → the `branch-sync` and `running-tests` skills.
