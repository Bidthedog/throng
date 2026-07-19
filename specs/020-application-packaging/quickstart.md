# Quickstart & Validation: Application Packaging

**Feature**: 020-application-packaging | **Constitution**: v4.0.0

How to build, install, verify, and (dry-run) publish the packaged product, and how each user story is
validated. Detailed field/behaviour definitions live in [data-model.md](./data-model.md) and
[contracts/](./contracts/); this is the run guide.

## Prerequisites

- Windows 11 x64, Node ≥20, `npm ci` completed in the worktree.
- Gates (must be green before packaging): `npm run lint`, `npm run typecheck`, `npm run test:unit`,
  `npm run test:integration`, `npm run test:contract`, `npm run test:e2e`.

## Set the product version (FR-001/005)

Bump the **root `package.json` `version`** (the single source) from `0.0.0` to the release version, e.g.:

```jsonc
// package.json
{ "version": "1.0.0" }
```

The build regenerates the daemon version constant and the installer metadata from it. A guard test fails if
any workspace `package.json` disagrees.

## Build the installer (US2, FR-007/009/038)

```bash
npm run build                 # tsc + renderer + BUILD_ID + generated version constant
npm run package               # NEW — electron-builder NSIS per-user; bundles node.exe + daemon
# → dist/throng-setup-<version>.exe  (self-contained, per-user, no admin)
```

Expected: one `throng-setup-<version>.exe` under the build output, carrying the version in its name, with
the bundled Node runtime + daemon dist + native modules inside.

## Run installer verification (US4, FR-023–027)

```bash
npm run verify:installer      # NEW — install → launch → version → project+terminal → uninstall → residue
# → a VerificationVerdict { version, installerSha256, passed, failedStep } printed and written as an artifact
```

Expected on a known-good package: `passed: true`. On a deliberately broken package (delete a bundled
component before verifying): `passed: false` with `failedStep` naming the failure. **Runs for real on a
clean `windows-latest` CI runner**; locally it exercises the same harness against your machine.

## Dry-run the gated publish (US5, FR-028–037, FR-042)

```bash
npm run publish:check         # NEW — evaluate gates WITHOUT publishing
# real version?  verification verdict passed?  QA sign-off present?  → prints allow/refuse + the unmet gate
node scripts/checksum.mjs dist/throng-setup-1.0.0.exe   # SHA-256 published in the release notes
```

The **actual** publish happens only through `.github/workflows/release.yml`, gated on the `release`
Environment's required-reviewer approval (the human QA sign-off) — it cannot be triggered from a developer
machine or an unreviewed branch (FR-037).

## The "About throng" dialog (US1, FR-003/003a)

Launch throng → **application menu → Help → About throng**. Expected: the About window shows the product
version and build id as **selectable** text, a copyright notice, a licence link, and the full AGPL-3.0
licence text in a **read-only, scrollable** region. The version shown equals `app.getVersion()`.

## Validation matrix (per user story)

| Story | How validated | Layer |
|-------|---------------|-------|
| US1 — the build has a name | Version guard test (all surfaces equal the source); About-dialog E2E | contract + E2E |
| US2 — install on a clean machine | `verify:installer` install→launch→terminal on a fresh runner | CI (D6) |
| US3 — upgrade & remove without loss | Install A → data → install B (data survives); uninstall retains data unless checkbox ticked; downgrade refused | CI (D6) + unit (compare/residue) |
| US4 — prove the installer works | `verify:installer` verdict pass on good / fail-naming-step on broken | unit + CI (D6) |
| US5 — publishing is gated | `publish:check` gate evaluator (each unmet gate refuses, naming it); re-publish refused; checksum matches bytes | unit + CI (D7) |

## Per-user isolation check (FR-013, SC-006)

Two OS user accounts each run throng with live terminals concurrently. Expected: the derived pipe names
differ per user (`\\.\pipe\throng.<token>.daemon`), so neither account's terminals/projects/settings are
visible to or disturbed by the other. Verified by the pipe-endpoint contract test (same token → same name,
different tokens → different names).

## First-run time budget (SC-001, T034f — a manual/real-hardware measure)

**Budget: download → running throng with a live terminal in under 3 minutes**, on a clean Windows 11
machine with no developer tools. This is a real-hardware *outcome* metric, not a suite-automatable
assertion — the verification journey exercises every step, but the wall-clock is confirmed by hand (or by
a timed CI/real-install run). To measure: from a fresh download of `throng-setup-<version>.exe`, time
`double-click → SmartScreen "Run anyway" → install → launch from the shortcut → create a project → spawn a
terminal → see a prompt`. Record the elapsed time on the release; a run exceeding 3 minutes is a
regression to investigate (installer size, first-run seeding, or daemon start-up).
