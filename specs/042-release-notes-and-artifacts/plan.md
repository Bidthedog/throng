# Implementation Plan: Release Notes & Multi-Artifact Publication

**Branch**: `feature/S042-I350-I351-release-notes-and-artifacts` | **Date**: 2026-09-02 |
**Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/042-release-notes-and-artifacts/spec.md`

## Summary

Three changes, in dependency order, each landing behind the one before it.

1. **A declared artifact set, in `@throng/core`.** A release's artifacts become a pure, versioned
   declaration — role, filename, and per-format capabilities — that packaging, verification, the
   publish gates and the release body all resolve against by role. This replaces the three
   independent `ls dist/installer/*.exe | head -n1` resolutions in `release.yml` and is the
   prerequisite for everything else.
2. **Release notes with a defined source.** `CHANGELOG.md` becomes the authoritative, reviewable
   record; the pipeline reads the section for the version being published, refuses when it is
   missing or bound to another version, and composes the release body as *notes + invariant footer*
   with one checksum row per artifact.
3. **Two new artifacts.** `portable` and `zip` electron-builder targets, each with an explicit
   `artifactName` so its filename is declared rather than discovered, and each with a verification
   path proving the same end state the NSIS installer proves today.

**The architectural rule this plan follows is the one the release code already established.** The
decision lives as a pure function in `packages/core/src/config/`; a thin `scripts/*.mjs` CLI supplies
its inputs from the environment; `release.yml` calls the CLI and holds no logic of its own.
`publish-gate.ts` + `publish-gates.mjs` is the worked example, and every new piece here copies its
shape. That is not tidiness — it is the only reason any of this is testable, for the reason set out
under *Provability* below.

## Technical Context

**Language/Version**: TypeScript 5.x (`@throng/core`, strict), Node 20 ESM for the `scripts/*.mjs`
CLIs, YAML for `.github/workflows/release.yml` and `electron-builder.yml`.

**Primary Dependencies**: electron-builder (targets and artifact naming), `gh` CLI (release
creation), the existing `@throng/core` release modules — `publish-gate.ts`,
`verification-verdict.ts`, `product-version.ts`.

**Storage**: `CHANGELOG.md` (the notes source, in-repo, reviewed as a diff); `dist/installer/` (built
artifacts); `verification-verdict.json` (the verdict, already produced per run).

**Testing**: vitest `unit` project for every pure module and every CLI (temp dirs, no network);
`integration` for a real `npm run package` reconcile where the machine allows it. **No E2E tests are
added by this feature** — nothing here is reachable from the application UI, so an E2E would spend an
Electron launch to assert a build artifact. The `@core`/`@extended` budget ratchet is untouched.

**Target Platform**: Windows 11 (020 FR-038). GitHub Actions `windows-2022` runners.

**Project Type**: Desktop application — build and release tooling within it.

**Performance Goals**: Not applicable. The only budget that matters is CI wall-clock: the three new
targets add packaging time to the release lane, not to the per-push `@core` lane.

**Constraints**: See *Provability* — most of this cannot be exercised by a normal push.

**Scale/Scope**: Three artifacts today, growing to four when #361 lands. The declaration must not
assume a fixed count.

## Provability — what can actually be tested, and where

**This is the governing constraint of the whole feature, and it shapes the design rather than being
a caveat on it.** `release.yml`'s publish job runs only on a `refs/tags/v*` push or an explicit
`workflow_dispatch` with `publish: true`. A normal push exercises none of it. So logic left inside
the YAML is logic that can be proved exactly once per release, by releasing — which is why the plan
moves as much as possible out of the YAML and into `@throng/core` and `scripts/`.

| Tier | What it proves | How |
|---|---|---|
| **Unit (local, seconds)** | Everything pure: artifact-set declaration and reconciliation, artifact resolution by role, notes parsing and version binding, body composition, the checksum table, the size cap, the extended publish gate. | vitest `unit`, over fixtures. No filesystem beyond temp dirs. |
| **Unit (local) — the CLIs** | That each `scripts/*.mjs` maps env and argv onto the pure functions and exits with the right code and message. | vitest `unit` driving the CLI's exported `main()` against a temp dir, the way `publish-gates.mjs` is already shaped. |
| **Integration (local, minutes)** | That `npm run package` actually produces the declared set, and that reconcile passes against real files. | vitest `integration`, gated on a packaged output being present; skipped with a stated reason otherwise. |
| **Local, by hand (slow)** | That each artifact format installs/extracts, launches, spawns its daemon from the bundled runtime, opens a terminal, and leaves nothing behind. | `npm run verify:installer` per artifact, on this machine. Documented in quickstart.md. |
| **On a push** | Nothing in this feature. The `@core` E2E lane does not touch the release pipeline. | — |
| **On a `workflow_dispatch` with `publish: false`** | Build → package → reconcile → verify every artifact → **render the release body** and upload it. This is the closest thing to a rehearsal, and FR-006 exists partly to create it: the composed body becomes an inspectable artifact of a non-publishing run. | One dispatch, ~30 min. |
| **Only at a real release** | The `gh release create` call itself, the Environment approval, the prerelease flag, and the published body's rendering on GitHub. | The next tag. |

**The mitigation for that last row is FR-006.** Rendering the exact body before the gated step means
the thing that can only be proved at release is reduced to *"`gh` attached the files and pasted the
text"* — everything upstream of it has been seen. What remains unprovable before the first release is
accepted, and named here rather than discovered.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1.*

| Principle | Assessment |
|---|---|
| **I. Project-First Context Isolation** | Not engaged. No project, workspace or per-project state is touched. |
| **II. Platform-Abstracted Core** | **Engaged, and satisfied by construction.** Every decision — what the artifact set is, whether the found set reconciles, whether notes bind to the version, what the body says — is a pure function in `packages/core/src/config/`. The OS-touching parts (globbing a dist directory, hashing bytes, driving an installer) stay in `scripts/`, which is build tooling outside the app's runtime. No OS call enters core. |
| **III. Detached, Tagged & Persistent Terminals** | Engaged only as a thing to not break: each new artifact's verification must prove the daemon still spawns from the bundled runtime and a terminal works. No change to terminal or daemon code. |
| **IV. Native Terminal Support** | Not engaged. |
| **V. Test-First Quality Discipline** | **Engaged.** Every pure module is written test-first at the unit layer. **No E2E is added**, deliberately: nothing here is reachable from the UI, and the rule is to test at the lowest layer that can prove it. The one thing no layer can prove before a release is named in *Provability* rather than papered over with a test that asserts something else. |
| **VI. Simple, Modern, Discoverable UX** | Engaged obliquely and worth stating: the release body **is** a user-facing surface, and FR-001/FR-007 are its usability requirements. A body a reader cannot skim fails this principle as surely as a cramped dialog would. |
| **VII. Change Review & Approval** | Engaged. The human QA sign-off (020 FR-029) is unchanged in meaning; FR-006 gives the approver more to see, not another gate to pass. |
| **VIII. SOLID, DRY & YAGNI** | Engaged. The three duplicated `head -n1` resolutions are the DRY violation this feature removes. YAGNI: the declaration models three artifacts and the roles they have, not a general packaging abstraction. |
| **IX. Dependency Injection & Composition Root** | **Not engaged, and this is a deliberate exception consistent with what shipped.** `scripts/*.mjs` are build-time CLIs, not application code; they have no container and take their inputs from argv and env, exactly as `publish-gates.mjs` and `verify-installer.mjs` already do. No application composition root is touched. |
| **X. Externalised Configuration** | Engaged in spirit: the artifact set is declared in one authoritative place rather than hardcoded at each call site. It is build configuration, not user configuration, so it does not enter the settings registry and adds no preference-editor descriptor. |
| **XI. Dockable Workspace** | Not engaged. |
| **Documentation currency (NON-NEGOTIABLE)** | **Engaged.** FR-023 and FR-024 require `docs/installation.md` and `docs/releasing.md` in the same change. `README.md` is checked for any claim about what a release contains. `CHANGELOG.md` is new and is a *backward*-looking record — it is explicitly **not** a second forward-looking list, so it does not conflict with the rule that the issue tracker is the only such list. |
| **Configuration-editor completeness (NON-NEGOTIABLE)** | Not engaged. No configurable application setting, key binding or theme token is added. |
| **Displayed quantities digit-grouped (NON-NEGOTIABLE)** | Not engaged. No quantity is displayed in the application. |
| **Themeable icon controls (NON-NEGOTIABLE)** | Not engaged. No action control is added or altered. |
| **Static analysis & linting (NON-NEGOTIABLE)** | Engaged as the standing gate. `npm run gate` is the only thing that establishes done-ness here. |

**Result: PASS.** One deliberate deferral is recorded under Complexity Tracking; no principle is
violated.

## Complexity Tracking

**Deferral — machine-wide installation and the MSI (#361).** Recorded here as the constitution's
incremental-delivery rule requires: the end-state requirement, the feature expected to complete it,
and an open tracked issue.

| | |
|---|---|
| **End-state requirement** | A user can choose between a per-user and a machine-wide install, from every installer format throng ships, and an administrator can drive the machine-wide path non-interactively. |
| **Why not here** | It supersedes 020 FR-040 and FR-012, roughly doubles the install/upgrade/uninstall verification matrix, and requires a stated rule for a machine carrying both installs at once. Spec 020 considered and rejected offering both for exactly those costs; reversing that needs its own specification, not a clause in this one. |
| **Tracked as** | **#361** — open, `enhancement`, `area:infra`, milestone vNext. |
| **Expected to complete it** | The spec written for #361. |
| **Is the requirement weakened?** | No. Nothing in this feature makes machine-wide install harder to add: the artifact set is a declaration with no fixed count, and the verification harness is being made per-format precisely so a fourth format and a second install scope slot in. |

**Consequence to state plainly: #351 ships only in part.** Its portable and archive half lands here;
its MSI half moves to #361. The issue stays open, and a comment on it records the split.

## Project Structure

### Documentation (this feature)

```text
specs/042-release-notes-and-artifacts/
├── plan.md              # This file
├── spec.md              # The specification
├── research.md          # Phase 0 — the decisions and what was rejected
├── data-model.md        # Phase 1 — the artifact set and the notes record
├── quickstart.md        # Phase 1 — how to prove it, per tier
├── contracts/           # Phase 1 — the CLI contracts and the body's shape
│   ├── artifact-set.md
│   ├── release-notes.md
│   └── verification-verdict.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 — NOT created by /speckit-plan
```

### Source Code (repository root)

```text
packages/core/src/config/
├── release-artifacts.ts       # NEW — the declared artifact set; roles, filenames, capabilities,
│                              #       reconciliation, resolution by role. Pure.
├── release-notes.ts           # NEW — parse the notes source, bind to a version, compose the body,
│                              #       apply the size cap. Pure.
├── publish-gate.ts            # EXTENDED — gate inputs gain "the artifact set reconciles" and
│                              #            "notes exist and bind to this version"
├── verification-verdict.ts    # EXTENDED — a verdict covers a SET of artifacts, not one installer
└── product-version.ts         # unchanged

packages/core/tests/unit/
├── release-artifacts.test.ts  # NEW
├── release-notes.test.ts      # NEW
├── publish-gate.test.ts       # EXTENDED
└── verification-verdict.test.ts # EXTENDED

scripts/
├── artifact-set.mjs           # NEW — declare / reconcile / resolve, for the workflow to call
├── release-notes.mjs          # NEW — render the complete release body to a file
├── publish-gates.mjs          # EXTENDED — feeds the two new gate inputs
├── verify-installer.mjs       # EXTENDED — per-format drivers behind one verdict
└── checksum.mjs               # unchanged (already per-file)

electron-builder.yml           # EXTENDED — portable + zip targets with explicit artifactName
.github/workflows/release.yml  # EXTENDED — explicit resolution; render body; publish the set
CHANGELOG.md                   # NEW — the authoritative notes source
docs/installation.md           # EXTENDED — which artifact a reader wants
docs/releasing.md              # EXTENDED — the artifact set, where notes come from, what fails
```

## Phase 0 — Research

The open questions, and what each resolves to, are set out in [research.md](./research.md). In
summary:

- **Where release notes come from** → `CHANGELOG.md`, compiled at release-preparation time and
  committed before the tag. Alternatives (derive from closed issues at publish time; derive from PR
  titles) rejected with reasons.
- **How an artifact is identified** → by a stable **role**, never by extension or glob. Filenames are
  declared with the version interpolated, matching the existing `throng-setup-${version}.${ext}`
  pattern.
- **How a format with no installer is verified** → the verdict's step list becomes per-format: a
  format declares which steps apply, and a step that cannot apply to a format is *absent*, never
  *passed*.
- **Whether `zip` and `portable` are both needed** → yes, and they are different things: `portable`
  is a self-extracting single `.exe` (and therefore the second `.exe`, which is what makes FR-012's
  no-glob rule load-bearing rather than theoretical); `zip` is an ordinary archive.

## Phase 1 — Design & Contracts

- **[data-model.md](./data-model.md)** — the `ReleaseArtifact` / `ReleaseArtifactSet` shape, the
  `ReleaseNotes` record and its version binding, and the extended verdict.
- **[contracts/artifact-set.md](./contracts/artifact-set.md)** — the `artifact-set.mjs` CLI: its
  subcommands, exit codes and messages.
- **[contracts/release-notes.md](./contracts/release-notes.md)** — the `CHANGELOG.md` section format
  the parser accepts, and the exact composition of the release body including the invariant footer.
- **[contracts/verification-verdict.md](./contracts/verification-verdict.md)** — the verdict shape
  once it covers a set, and the per-format step applicability rules.
- **[quickstart.md](./quickstart.md)** — how to prove each tier from *Provability*, in order.

## Phase 2 — Task generation approach

`/speckit-tasks` will decompose this into three sequential groups matching the Summary, each
test-first:

1. **Artifact set** — core module and its tests, the CLI and its tests, then `release.yml`'s three
   resolutions replaced. Landable and valuable with today's single artifact.
2. **Release notes** — core module and tests, `CHANGELOG.md` seeded with the already-published
   versions, the CLI, the gate extension, then the workflow's body composition.
3. **The two artifacts** — builder targets, per-format verification, docs.

Group 1 must land before group 3; group 2 depends on group 1 only for the checksum table.

## Definition of done

`npm run gate` green, quoted, with nothing edited after it. The gate's eight stages are the bar —
not "the unit tests I added pass". Expect the E2E stage to cost ~18 minutes and to be unaffected by
this feature; if it is affected, something in this plan was wrong.
