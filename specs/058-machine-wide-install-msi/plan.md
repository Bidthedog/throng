# Implementation Plan: Machine-Wide Installation & the MSI

**Branch**: `feature/S058-I361-I351-machine-wide-install-msi` | **Date**: 2026-10-20 |
**Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/058-machine-wide-install-msi/spec.md`

## Summary

Four changes, in dependency order:

1. **One running throng per user, across every copy.** A per-user instance pipe replaces the
   userData-keyed lock as the authority, Electron's lock is still held so pre-058 copies are excluded
   too, a second launch of a different copy raises an inline notice in the running window, the
   portable build joins the user's namespace, and a daemon of a different build from another copy is
   replaced rather than treated as foreign. This is app code, testable at every layer, and it is the
   part every format depends on.
2. **Both scopes in the setup.** electron-builder's NSIS install-mode page is turned on
   (`allowElevation: true`), and four template behaviours that contradict the spec — the cross-scope
   uninstall, the silent decline, the silent prompt, the kill-on-upgrade — are replaced through a
   two vendored template includes shadowed in from `installer.nsh`, pinned by a guard test.
3. **The MSI.** electron-builder's `msi` target already authors a dual-purpose package; a
   `msiProjectCreated` hook rewrites the generated WiX project for the elevated default, per-scope
   folders and names, the in-use check, the scope-dialog elevation relaunch and a de-elevated launch.
4. **The pipeline and the runbook.** The declared set gains the MSI role and scopes; verification
   becomes a per-combination matrix on clean runners with a genuine standard account, plus a
   coexistence job; the publish gate requires every combination's verdict; the release body says who
   each download is for; `docs/` and the `throng-release` runbook move in the same change.

**The architectural rule is the one 042 established**: every decision is a pure function in
`packages/core/src/config/`, a thin `scripts/*.mjs` or packaging hook supplies its inputs, and the YAML
and NSIS hold as little logic as they can. That is what makes the installer behaviour testable without
building an installer.

## Technical Context

**Language/Version**: TypeScript 7 (`@typescript/native`, strict) for `@throng/core` and
`@throng/ui`; Node 24 ESM for `scripts/*.mjs` and the packaging hook (`.cjs`, which electron-builder
`require`s); NSIS 3 script for the setup; WiX 3 source (as electron-builder emits it) for the MSI;
YAML for `release.yml` and `electron-builder.yml`.

**Primary Dependencies**: electron-builder / `app-builder-lib` 26.17.0 (`nsis` and `msi` targets,
`nsis.include`, `msiProjectCreated`), Electron 44 (`requestSingleInstanceLock`, `second-instance`),
Node `net` (named pipes), PowerShell CIM (`Win32_Process`, `GetOwner`) inside the in-use helper,
`Start-Process -Credential` in the verification harness.

**Storage**: none new. The data folder is unchanged (`%APPDATA%\throng`, `%USERPROFILE%\.throng`);
installers write their own registry entries (`HKCU`/`HKLM` uninstall keys) as today.

**Testing**: vitest `unit` (every pure module, the MSI transforms against a captured template output,
the vendored-template guard, the CLIs' `main()`), `component` (the different-copy notice),
`integration` (the instance pipe between real processes; daemon adoption across builds and paths),
**one** E2E (`single-instance.e2e.ts`, `@extended @window`, two launches sharing a namespace). The
installers themselves are proved by the release matrix (research D11) and, for the restart path, by
hand (quickstart §6). The `@core` budget is untouched; `e2e-budget.json` is re-seeded for the one
`@extended` spec.

**Target Platform**: Windows 10 1809+ / Windows 11, x64 (020 FR-038). Hosted runners `windows-2022`.

**Project Type**: Desktop application — app main process, packaging and release tooling.

**Performance Goals**: the instance check adds no perceptible launch time — one pipe `listen`, and on a
secondary launch one connect and one line (target: a second launch exits within 1 s of starting).

**Constraints**: hosted runners are administrators with UAC disabled and cannot reboot mid-job
(research D9, D11); nothing may edit `node_modules`; nothing may write to a machine-wide install root
at run time (FR-014).

**Scale/Scope**: four artifacts, six verification combinations plus one coexistence run; any number
of copies per machine; one running instance per user.

## Provability — what is proved where

| Tier | Proves | How |
|---|---|---|
| Unit (seconds) | the declared set, combinations, verdicts, gate; MSI transforms; in-use classification; namespace and copy identity; the vendored-template pin | vitest `unit` |
| Component | the notice renders, re-flashes rather than duplicating, dismisses | vitest `component` |
| Integration (local) | the instance pipe between two real processes; daemon replacement by build, path and orphan state | vitest `integration` |
| E2E (local, release lane) | second launch → no second window, focus, notice | `single-instance.e2e.ts` |
| Packaging (local) | four artifacts produced, reconcile passes | `npm run package` + `reconcile` |
| Release rehearsal (CI, `publish: false`) | every combination installs, launches, isolates, upgrades in use, uninstalls cleanly; coexistence; the rendered body | `release.yml` dispatch |
| By hand (VM) | completion after restart; the interactive refusal; declining elevation in each installer's UI | quickstart §6 |
| Only at a real release | `gh release create` attaching four files | the next tag |

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1.*

| Principle | Assessment |
|---|---|
| **I. Project-First Context Isolation** | Not engaged. Every copy opens the same per-user data; no project state changes. |
| **II. Platform-Abstracted Core** | **Engaged, satisfied.** Copy identity, namespace, in-use classification, combinations, verdicts and MSI transforms are pure in `@throng/core`. The pipe, the process query, `msiexec` and NSIS stay in `packages/ui/src/main`, `scripts/` and `packaging/`. |
| **III. Detached, Tagged & Persistent Terminals** | **Engaged.** The daemon stays detached, per-user and session-scoped (FR-012). FR-021a deliberately ends a different build's terminals, the same trade a stale build already makes; FR-016a forbids terminating another account's. The portable namespace change keeps #429's protection via the orphan check (research D6). |
| **IV. Native Terminal Support** | Not engaged. |
| **V. Test-First Quality Discipline** | **Engaged.** Every pure module test-first at unit; the instance guard proved between real processes at integration; one E2E for the user-visible behaviour. What only a reboot can prove is named (quickstart §6), not papered over. |
| **VI. Simple, Modern, Discoverable UX** | **Engaged.** The different-copy notice and the installers' messages say what is wrong and what to do; scope labels make copies tell-apart-able. |
| **VII. Change Review & Approval** | Engaged; QA sign-off unchanged in meaning. |
| **VIII. SOLID, DRY & YAGNI** | **Engaged.** One in-use helper serves both installers; one combination list serves the matrix and the gate. Vendoring is limited to the two template files with no hook (Complexity Tracking). |
| **IX. Dependency Injection** | Engaged for the instance guard: built in the main process's composition path with its OS edges injected (pipe server/client, window focus, notice sink) so it is integration-testable. Build scripts and the packaging hook are tooling, not application code, as in 042. |
| **X. Externalised Configuration** | Not engaged — no setting is added. The MSI's scope uses the standard `ALLUSERS` / `MSIINSTALLPERUSER` properties, documented in `docs/installation.md`. |
| **XI. Dockable Workspace** | Not engaged. |
| **XII. Responsive UI** | Engaged lightly: the instance check runs before any window and costs one pipe operation. |
| **Single instance** (constraint) | **Satisfied, and strengthened** — now holds across copies and switches. |
| **Per-user local storage** (constraint) | **Satisfied** — one data folder per user, every copy. |
| **Documentation currency** | **Engaged.** `docs/installation.md`, `docs/environment.md`, `docs/releasing.md`, `CHANGELOG.md`, the `throng-release` skill and its references, in this change; `throng-docs` audit before the PR leaves draft. |
| **Configuration-editor completeness** | Not engaged. |
| **Displayed quantities digit-grouped** | Not engaged (a version string is not a quantity). |
| **Themeable icon controls** | Engaged only if the notice carries a dismiss control: it uses the existing themed icon control the failure notices use. |
| **Static analysis & linting** | Standing gate. `npm run gate` establishes done-ness. |

**Result: PASS**, with one justified complexity entry below. Re-checked after Phase 1: unchanged.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Two electron-builder NSIS template files (`installSection.nsh`, `multiUserUi.nsh`) vendored into `packaging/nsis/` and shadowed in through `installer.nsh` | The template uninstalls the per-user copy on every all-users install and has no hook to stop it (FR-017); its elevation-declined branch has its message commented out (FR-010a); its silent all-users path prompts (FR-010). Research D3. | `nsis.include` macros cannot reach those code paths; two setups break FR-001; patching `node_modules` is undone by `npm ci`. The guard test (`nsis-vendored-templates.test.ts`) pins the upstream version and file hashes so an upgrade forces a re-review. |

## Project Structure

### Documentation (this feature)

```text
specs/058-machine-wide-install-msi/
├── plan.md               # this file
├── spec.md
├── research.md           # D1–D13
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── install-switches.md
│   ├── instance-lock.md
│   └── verification-matrix.md
├── checklists/requirements.md
└── tasks.md              # /speckit-tasks
```

### Source Code (repository root)

```text
packages/core/src/config/
├── release-artifacts.ts        # EXTENDED — `msi` role, scopes, audience, combinationsOf()
├── verification-verdict.ts     # EXTENDED — new steps, `unproven`, RUNNER_LIMITED_STEPS, combination verdicts
├── publish-gate.ts             # EXTENDED — combinations + coexistence verdicts
├── release-notes.ts            # EXTENDED — audience column in the download table
├── install-in-use.ts           # NEW — classify processes using an install root (research D9)
├── msi-project.ts              # NEW — pure transforms over the generated .wxs (research D1, D2, D4, D9, D10)
├── instance-identity.ts        # NEW — namespace → lock name, copy identity, launch message, notice text
└── pipe-endpoint.ts            # unchanged
packages/core/tests/unit/        # one test file per module above, plus fixtures/msi-template-output.wxs

packages/ui/src/main/
├── instance-guard.ts           # NEW — the pipe lock + legacy lock + launch handling (contracts/instance-lock.md)
├── single-instance.ts          # REPLACED by instance-guard.ts
├── instance-paths.ts           # CHANGED — portable suffix removed (research D6)
├── daemon-lifecycle.ts         # CHANGED — #192 guard narrowed to dev-tree daemons (research D7)
└── main.ts                     # CHANGED — uses instance-guard; forwards the notice to the renderer
packages/daemon/src/            # CHANGED — health.ping reports `packaged`
packages/ui/src/renderer/       # NEW — the different-copy notice (failure-notice surface)
packages/ui/tests/{unit,component,integration,e2e}/

packaging/
├── installer.nsh               # CHANGED — shadows the two files below (!addincludedir + !cd); customCheckAppRunning (copy-scoped, in-use helper); data deletion in the current user's context
├── nsis/UPSTREAM.md            # NEW — pinned upstream version and hashes
├── nsis/installSection.nsh     # NEW (vendored, modified) — no cross-scope uninstall; /REBOOTOK; scope labels
├── nsis/multiUserUi.nsh        # NEW (vendored, modified) — FR-010a message; silent no-elevation → 740
├── msi-project.cjs             # NEW — electron-builder msiProjectCreated hook → @throng/core msi-project
└── in-use.mjs                  # NEW — lists processes under an install root with owners; shipped in the install

electron-builder.yml            # CHANGED — msi target + block, nsis.allowElevation, msiProjectCreated
scripts/
├── artifact-set.mjs            # EXTENDED — list --combinations
├── verify-installer.mjs        # EXTENDED — --scope, MSI driver, second account, in-use, coexistence
└── publish-gates.mjs           # EXTENDED — combinations + coexistence
.github/workflows/release.yml   # CHANGED — matrix verify job, coexistence job, derived verdict list

docs/installation.md, docs/environment.md, docs/releasing.md, CHANGELOG.md
.claude/skills/throng-release/SKILL.md and references/{artifact-set,verification,publishing,build-and-packaging}.md
```

**Structure Decision**: the existing monorepo layout. New pure logic goes in `packages/core/src/config/`
beside its 042 siblings; the boundary pieces go where their kind already lives.

## Phase 0 — Research

[research.md](./research.md). In summary:

- **D1/D2** — electron-builder's MSI target already authors a dual-purpose package, so the per-user MSI
  needs no elevation and FR-003a's stop-and-ask does not trigger. The elevated default is set from
  Windows Installer's own `ALLUSERS=2` rule; `ALLUSERS=1` / `MSIINSTALLPERUSER=1` are the explicit switches.
- **D3** — the NSIS template contradicts FR-017, FR-010 and FR-010a in code paths without hooks;
  two files are vendored, pinned by a guard test.
- **D4** — per-installer, per-scope folders, entries and shortcut labels.
- **D5–D8** — the instance pipe, the legacy lock for older copies, the notice, the portable namespace,
  the narrowed #192 guard, and why dev and test runs need no new mechanism.
- **D9/D10** — one in-use helper for both installers; restart completion is by hand; de-elevated launch;
  the MSI elevates at the scope dialog so a decline can return to it.
- **D11** — a per-combination matrix on clean runners, a genuine standard account via
  `Start-Process -Credential`, and the coexistence job.

## Phase 1 — Design & Contracts

- [data-model.md](./data-model.md) — the extended artifact and verdict model, combinations, in-use
  classification, instance identity.
- [contracts/install-switches.md](./contracts/install-switches.md) — every switch and exit code.
- [contracts/instance-lock.md](./contracts/instance-lock.md) — namespace, lock, legacy lock, notice.
- [contracts/verification-matrix.md](./contracts/verification-matrix.md) — combinations, steps,
  harness flags, gate refusals.
- [quickstart.md](./quickstart.md) — how each tier is proved.

## Phase 2 — Task generation approach

Five groups, each test-first:

1. **Instance guard** (core identity → guard → main wiring → notice → daemon `packaged` → #192
   narrowing → portable namespace → E2E). Independent of packaging; it runs beside group 2 rather
   than waiting for it (tasks.md places it in Phase 4 for story order, and its dependency notes say
   so).
2. **Release model** (artifact set + combinations → verdict + `unproven` → gate → notes audience →
   `artifact-set.mjs`, `publish-gates.mjs`).
3. **Setup** (vendored templates + guard test → install-mode page → labels → in-use helper + core
   classifier → copy-scoped app check → silent `740` → data deletion context).
4. **MSI** (transform module against the captured template → hook → electron-builder block → reconcile).
5. **Verification and pipeline, then docs** (`verify-installer` scope/MSI/second account/in-use/
   coexistence → `release.yml` matrix → docs, changelog, runbook).

Group 2 can run beside group 1; groups 3 and 4 depend on group 2's model; group 5 on everything.

## Definition of done

`npm run gate` green on the head commit, quoted with its run URL, plus a `release.yml` rehearsal
(`publish: false`) green across every combination and the coexistence job, with any `unproven` step
named. The by-hand checks in quickstart §6 belong to the manual test plan.
