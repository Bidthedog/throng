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

Versioning → packaging → **verification** (`verify-installer`, producing `verification-verdict.json`)
→ **QA sign-off** → publish via `gh release create`, gated by `scripts/publish-gates.mjs`
(`THRONG_QA_SIGNED_OFF`, `THRONG_VERDICT_FILE`, `THRONG_RELEASE_TAG`, `THRONG_INSTALLER_FILE`,
`THRONG_ALREADY_PUBLISHED`). There is a published **checksum instead of code signing** — that is a
deliberate, documented choice, not an omission to fix.

## CI (`.github/workflows/ci.yml`)

Jobs: **Plan E2E** → **Lint & type-check** → **Unit / integration / contract** (builds first, for the
daemon-spawning layers' `BUILD_ID`) → **E2E ×3 shards** → merged report, plus **E2E (@admin,
elevated)**. Windows runners, one worker per shard, 1920×1080 forced, an alias-free temp dir, blob
reports uploaded per shard (`THRONG_E2E_BLOB_OUT`, and see `blob-report-naming.test.ts` for the
collision fix in #216).

Shards come from `packages/ui/tests/e2e/shard-plan.json`, **not** Playwright `--shard`: splitting by
test count in file order once produced 3.7 / 8.3 / 36-minute thirds and a job timeout. Rebalance the
plan from measured durations when it drifts.

`scripts/ci-e2e-shard.ps1` implements the constitution's infrastructure-fault rule: retry a shard once
**only** when its report shows 0 unexpected and 0 flaky, comment the retry on issue #75, stay red
otherwise.

## Spending runner minutes well

**Run it locally before you push it** — the full E2E suite is ~10 minutes locally against ~12 minutes
per shard on CI. The one thing local runs genuinely cannot answer is elevation: a developer machine
is normally not elevated, GitHub's runners always are. For those, put **`[ci-admin-only]`** anywhere
in the commit message — it skips the three shards and the merged report, keeping lint, the unit
layers and the elevated suite, turning ~36 runner-minutes into ~4. Drop the marker before merging so
the full suite runs.

## Not yours

Writing or fixing tests → `throng-e2e-harness`. Product code in any package → the owning area agent.
Branch/PR mechanics → the `branch-sync` and `running-tests` skills.
