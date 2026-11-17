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

## Release (overview: docs/releasing.md; reasoning: .claude/skills/throng-release/references/)

**Cutting one is the `throng-release` skill's running order, not this file's** — it holds the running order,
the version rules and the fix-and-retry loop. What follows is the area knowledge that runbook assumes.

Versioning → packaging → **reconcile** → **verification** (one verdict per artifact) → publish via
`gh release create`, unattended, gated by `scripts/publish-gates.mjs` (`THRONG_VERDICT_FILES`,
`THRONG_ARTIFACT_DIR`, `THRONG_RELEASE_TAG`, `THRONG_ALREADY_PUBLISHED`) and by the tag being on
`master`. There is a published **checksum instead of code signing** — that is a
deliberate, documented choice, not an omission to fix.

**A release is a DECLARED SET of artifacts, not a file the pipeline finds** (042). The declaration
is `packages/core/src/config/release-artifacts.ts` — seven roles (`setup`, `msi`, `portable`,
`archive`, `deb`, `rpm`, `tarball`), the two Windows installers each with two install scopes. The Linux layout (version
folders of hard links, the launcher, the maintainer scripts in `packaging/linux/`) and why it is that shape are
`specs/063-linux-packaging/research.md`. Every step resolves by **role** through
`scripts/artifact-set.mjs` (`list`, `list --combinations`, `resolve`, `reconcile`, `checksums`).
How the setup and the MSI are customised is in [artifact-set.md](artifact-set.md#how-the-installers-are-customised). Nothing globs, and nothing
resolves by file extension: `nsis` and `portable` both produce a `.exe`, which is exactly why
`ls dist/installer/*.exe | head -n1` was removed from three separate places in `release.yml`.

- **`reconcile` runs straight after packaging and fails in BOTH directions** — a declared artifact
  that was not built, and one that was built but never declared. `npm run package` empties
  `dist/installer` first (`prepackage` → `scripts/clean-dist.mjs`) so a stale artifact from a
  previous release cannot fail a clean build.
- **Verification produces one verdict per artifact-and-scope combination**, plus a coexistence
  verdict, and a step has FOUR outcomes: `passed`, `failed`, `not-applicable`, `unproven` (one named
  runner-limited step only). An archive has no installer, and a verdict asserting an
  uninstall that never ran is worse than one that fails honestly. A verdict marking an *applicable*
  step `not-applicable` is **invalid**; a verdict covering only some of the set is a **refusal**,
  not a partial pass.
- **Release notes come from `CHANGELOG.md`**, committed before the tag so they are reviewed as a
  diff. `scripts/release-notes.mjs` composes the body; it never writes prose and never falls back to
  another version's notes. Publication is refused when the notes are missing, empty, or headed with
  a different version.
- **The gate has five conditions**, none of them human: real version → artifact set reconciles →
  verified → notes bind to this version → the tag is on `master` (spec 065).

When running `verify-installer.mjs` on a developer machine, two things look like product bugs and
are not: every launch the probe makes needs its own `THRONG_PIPE_NAME` (the one-running-throng lock
follows the pipe namespace, so a packaged probe on the default pipe just focuses the throng you have
open and exits) — `verify-installer.mjs` sets it, with `--user-data-dir`, `THRONG_CONFIG_ROOT` and
`THRONG_DATABASE_PATH`, on every launch; and the residue scan attributes processes **by path** because a throng running from
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

## CI — three workflows (spec 072)

- **`ci.yml`** — pull requests only, Linux: **lint** (lint + type-check), **unit**, **component** (two
  shards), **contract** (builds first, for the daemon's `BUILD_ID`), **integration** (the
  `critical-path` subset, named on the command line, no build) and **CI verdict**. No E2E.
- **`pipeline.yml`** — nightly and on dispatch, and called by `release.yml`: every layer on Windows,
  Linux and macOS; E2E sharded per platform through `THRONG_E2E_SHARD` (Windows 4, Linux 2, macOS 2 per
  release by default), `@admin` in its own elevated job, calibration, then every build and verify job.
- **`release.yml`** — a `v*` tag only: `on-master`, the `pipeline` call, then sign, publish, deploy.

**Sharding came back across runners (072).** Spec 034 removed it (FR-057) when the gating lane was a
≤50-test `@core` run that could not pay a shard's `npm ci` + build toll (#103). The full suite on one
Windows runner took 46 minutes, which does. Each shard runs both tiers on its share of the files.

`scripts/ci-e2e-run.ps1` implements the constitution's infrastructure-fault rule: retry the lane once
**only** when its report shows 0 unexpected and 0 flaky, comment the retry on issue #75, stay red
otherwise. That rule is Principle V and has nothing to do with sharding — it merely used to live in
the shard script.

## Spending runner minutes well

**E2E runs on CI, not on the workstation before a push.** No E2E runs on a pull request; every E2E
test runs in `pipeline.yml` — nightly, on dispatch, and inside every release. Locally, run at most the one spec covering the
change, at one worker, when a lower layer cannot show the failure — the root `CLAUDE.md`'s *Running
tests locally* owns that rule. Elevation is the thing only CI can answer either way: a developer
machine is normally not elevated, GitHub's runners always are.

There is **no way to skip a CI job any more** — the `[ci-admin-only]` marker and the `plan` job that
read it are gone (034 FR-057). The marker existed to avoid paying for three shards; there are no
shards, so it would now skip one short job while making the gating lane something a commit message
could switch off.

## Not yours

Writing or fixing tests → `throng-testing`. Product code in any package → the owning area skill.
Branch/PR mechanics → the `branch-sync` and `running-tests` skills.
