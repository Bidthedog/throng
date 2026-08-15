# Implementation Plan: Settings Write Integrity

**Branch**: `feature/S032-I249-I260-settings-write-integrity` | **Date**: 2026-08-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/032-settings-write-integrity/spec.md`

## Summary

A configuration write carries the whole document, so a caller changing one key rebuilds all of it
from a copy that may already be stale — and reverts every key it did not know about. The fix is to
stop sending documents and start sending **changes**: the renderer says what it changed, the main
process applies that to the document's current persisted content, and a write can no longer contain
an opinion about a key its caller never touched.

Three supporting pieces make that guarantee observable rather than merely true: the config watcher
recovers on its own from a read it could not parse instead of broadcasting defaults; write failures
raise a notice from whichever window issued them rather than only from Preferences; and the test
suite stops being able to destroy the value it is about to assert on.

See [research.md](./research.md) for how each decision was reached and what was rejected.

## Technical Context

**Language/Version**: TypeScript 5.x, ES modules, Node 22 (daemon + Electron main), React 19 (renderer)

**Primary Dependencies**: Electron 43, React 19, InversifyJS (composition roots), CodeMirror 6, xterm.js

**Storage**: JSON documents under the user config root (`settings.json`, `keybindings.json`,
`themes/*.json`, icon packs), written atomically by `FileConfigStore` via temp-file + rename. SQLite
holds projects and layout and is **out of scope**.

**Testing**: Vitest projects — `unit`, `integration`, `contract`; Playwright-on-Electron for E2E.
Gate command is `npm run gate` (lint → typecheck → build → unit → integration → contract → e2e,
fail-fast).

**Target Platform**: Windows 11 (first-class and only shipping target today)

**Project Type**: Desktop application — Electron main + preload + React renderer, plus a detached daemon

**Performance Goals**: A configuration change is observable in every open window within 100 ms of the
write completing, measured by T024a. The gap today is **reported** as ~45 ms in #249 and has not been
instrumented in this repository; it is unbounded when a read fails.

**Constraints**: The renderer is sandboxed and has no `fs` — every write crosses IPC. Writes must stay
confined to the config roots. The atomic temp-file + rename path must be preserved, including its
bounded retry for Windows sharing violations.

**Scale/Scope**: Four configuration document kinds. **Eight** settings write sites — seven in the
renderer and one in the main process (`shipped-defaults-service.ts`), the last of which was missed by
two successive audits that looked only at renderer call sites. Two windows can write the same
document concurrently, plus sub-workspace windows.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*
**Evaluated against Constitution v4.5.0** (ratified 2026-06-25, last amended 2026-08-13 — one day
before this spec, so the amendment is live and not yet exercised by a feature).

All eleven principles, because the constitution requires all eleven and an omitted principle is
indistinguishable from an unexamined one.

| Principle | Bearing | Verdict |
|---|---|---|
| **I. Project-First Context Isolation** | Touches no project boundary; settings are user-scoped and stay so. | **N/A** |
| **II. Platform-Abstracted Core** | Patch application is pure domain — apply segment-addressed changes to a parsed document — and belongs in `@throng/core` with no OS or Electron reference. The IPC adapter stays in `packages/ui/src/main`. | **Pass**, by design |
| **III. Detached, Tagged & Persistent Terminals** | No terminal, PTY or daemon surface is touched. | **N/A** |
| **IV. Native Terminal Support & Auto-Detection** | No shell detection or terminal behaviour. | **N/A** |
| **V. Test-First (NON-NEGOTIABLE)** | The Red step is the deliverable of Phase 2, not a formality inside it. Every user-facing change here — a failure notice reaching the main window and sub-workspace windows — carries E2E coverage; unit evidence alone is explicitly insufficient. | **Pass**, and it is what the plan is organised around |
| **VI. Simple, Modern, Discoverable UX** | Adds no control and no new surface. The only visible change is a notice appearing where one is currently swallowed. | **Pass** |
| **VII. Change Review & Approval** | Delivered on a branch behind PR #262, with the reported-bug gate requiring developer confirmation of the reproduction before production code is edited. | **Pass** |
| **VIII. SOLID/DRY/YAGNI** | One atomic test-write helper, not a third copy. The `remove` change variant was **cut** as speculative generality. The whole-document write is **kept** where it is correct rather than deleted for symmetry — YAGNI cuts both ways. | **Pass** |
| **IX. DI & Composition Root** | The patch applier and the watch policy are injected at the main composition root, never reached for. The watcher keeps taking `store`, `watcher`, `config` and `broadcast` as injected deps. | **Pass** |
| **X. Externalised Configuration** | **Re-argued after analysis.** The re-read attempts and delay are an **injected constant**, not an `AppSettings` key — see below. | **Pass**, with the reasoning changed |
| **XI. Dockable Workspace** | No pane, tab or panel behaviour. | **N/A** |

### Workflow gates

| Gate | Bearing | Action |
|---|---|---|
| **Docs currency** (NON-NEGOTIABLE) | The feature changes when a setting sticks and adds a notice the user will see. README, `docs/` and CONTRIBUTING must be assessed in the same change, and a "no user-facing doc is affected" finding recorded if that is the answer. | T040a |
| **Configuration-editor completeness** (NON-NEGOTIABLE) | Every configurable `AppSettings` key needs an editor descriptor, enforced by the leaf-walking check in `metadata-map.test.ts`. | Satisfied by adding **no** `AppSettings` key — see below |
| **Digit grouping** | Applies to numeric preference controls. No numeric control is added. | **N/A** |

### The Principle X argument, corrected

An earlier draft of this plan asserted that the watcher's retry count and delay were "typed settings
with documented defaults" and simultaneously that they carried "no preferences control". Those two
claims cannot both hold as stated, and the check was passing on the contradiction.

**One correction to the analysis that found it**, verified in the code rather than accepted: it
claimed an `AppSettings` key without a descriptor necessarily reds the completeness gate. It does
not. `SETTINGS_INTERNAL_KEYS` is an established escape hatch — `newProject.lastProjectFolder` is an
`AppSettings` key with no descriptor, deliberately internal, asserted as such at
`packages/core/tests/unit/settings-metadata.test.ts:264`. So putting the policy in `AppSettings` was
*available*.

It is still the wrong choice, for a different and better reason than "the gate would go red". These
two numbers are not configuration at all: no user and no machine needs to vary them, they have no
sensible per-installation value, and the internal-keys list exists for state the app persists about
itself — a remembered folder — not for tuning constants. So they are an **injected constant**
supplied at the main composition root and overridable in tests by injection (Principle IX). Principle
X governs values a user or a machine needs to vary; these are neither, and the plan no longer claims
otherwise.

**No violations to justify.** Complexity Tracking is empty.

### Post-design re-check

Re-evaluated after Phase 1 artifacts were written **and after the analysis pass that rewrote them**.
The contract keeps patch application in core, the data model introduces no OS-specific type, the task
list is test-first throughout, and every user-visible change carries E2E coverage including the
sub-workspace case that the first draft had left on unit evidence alone. **Pass.**

## Project Structure

### Documentation (this feature)

```text
specs/032-settings-write-integrity/
├── plan.md              # This file
├── spec.md              # The requirements
├── research.md          # Phase 0 — decisions and what was rejected
├── data-model.md        # Phase 1 — entities
├── quickstart.md        # Phase 1 — how to validate it end to end
├── contracts/
│   └── config-write.md  # Phase 1 — the renderer↔main write contract
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 — created by /speckit-tasks, not here
```

### Source Code (repository root)

```text
packages/core/src/config/
├── config-patch.ts                # NEW — apply segment-addressed changes to a parsed document (pure)
├── settings-read.ts               # CHANGED — report `unreadable` alongside `corrected`
└── bounds-guard.ts                # CHANGED — add `unreadable` to CorrectionOutcome<T>

packages/core/tests/unit/
├── config-patch.test.ts           # NEW — ordered application, forbidden segments, no-remove
└── settings-read.test.ts          # CHANGED — unreadable vs corrected are distinguishable

packages/ui/src/
├── main/
│   ├── config-write-ipc.ts        # CHANGED — accept a patch; read-modify-write atomically
│   ├── config-watcher.ts          # CHANGED — bounded re-read on an unreadable read
│   └── main.ts                    # CHANGED — inject the watch policy at the composition root
├── preload/preload.cts            # CHANGED — expose writePatch beside write (line 319)
└── renderer/
    ├── config/
    │   ├── write-config.ts        # CHANGED — writeConfigPatch, sharing the per-document chain
    │   └── config-write-notices.ts# CHANGED — mountable outside the Preferences window
    ├── preferences/apply-client.ts# CHANGED — send a change, not a document
    ├── sidebar/projects-panel.tsx # CHANGED — persist one key (line 207)
    ├── app.tsx                    # CHANGED — mount the write-failure subscriber (main window)
    └── subworkspace-app.tsx       # CHANGED — mount it here too

packages/ui/tests/
├── integration/                   # read-modify-write under concurrency; watcher retry; 1k soak
├── contract/                      # the IPC write contract
└── e2e/
    ├── helpers/config-write.ts    # NEW — the ONE atomic test write (hoisted from tab-settings)
    ├── settings-write-integrity.e2e.ts  # NEW — the cross-window clobber, red before green
    ├── config-write-failure.e2e.ts# CHANGED — EXISTING spec, extended (not a new near-duplicate)
    └── preferences-json.e2e.ts    # CHANGED — use the shared helper (lines 122, 151)
```

**Structure Decision**: The existing package boundaries already hold, so nothing moves. Pure patch
application and parse-failure reporting go to `@throng/core` (Principle II); the IPC adapter and the
watcher stay in `packages/ui/src/main`; the renderer keeps its single write chokepoint and gains a
patch entry point beside it. The one genuinely new shared artifact is the E2E config-write helper,
which exists so FR-013's "one implementation" is enforceable by counting rather than by vigilance.

## Delivery order

Ordered so the user-visible defect is fixed first and the unknown-cause investigation cannot block it.

1. **Reproduce (FR-016).** A failing E2E that drives the real clobber across two windows, plus a
   probe that settles R2's hypothesis about defaults being broadcast. Nothing else starts until the
   reproduction is confirmed by the developer — the repo's own rule for a reported bug.

   **The forcing mechanism, stated rather than left to chance.** The race is ~45 ms; the helper
   `createProject()` performs four UI interactions and takes far longer, so a naive test lets the
   broadcast land first and passes. The reproduction therefore pre-fills the project form, changes
   the preference, and *then* clicks save — putting exactly one click between the two writes.
   `notification-prefs.e2e.ts`'s local `appliedInMainWindow()` helper is the proof this works: it
   exists specifically to wait for the main window to adopt the new settings *before* driving it,
   and its docstring names `persistLastProjectFolder` and the stale copy outright. The reproduction
   is that helper's inverse.

   **The contingency, because the baseline says this may not reproduce.** If the reproduction comes
   back green against today's code, the hypothesis is falsified. The response is to stop and report,
   not to build the fix anyway: re-argue from whatever the probe showed, and if the mechanism is
   real but not reachable from the UI, demote the E2E to an integration-level proof and say so. A
   fix for a bug nobody can demonstrate is a change with no evidence behind it.
2. **US1 — the change stays made.** Patch-shaped write through core, main, preload and the two
   clobbering callers. This is the fix.
3. **US2 — the suite cannot lose the change.** One shared atomic E2E write helper; convert the two
   specs; watcher recovery from an unparseable read.
4. **US3 — failures are reported from every window.** Mount the subscriber outside Preferences. **No
   dedup**: each window is a separate renderer process publishing only its own failures, so one
   failed write already yields one notice.
5. **US4 — #250.** Group bisect against the full serial tier, then fix at the cause.
6. **The JSON editor's edit lifecycle (FR-017 – FR-020).** Added by `speckit-iterate` after
   hand-testing, and delivered in the same run.

   **Why it is not a tuning change.** The reported symptom — a conflict banner milliseconds after a
   keystroke — was accurate, and the cause was throng writing the file itself. Applying on a debounce
   means applying half-typed values, because a half-typed value frequently still parses; 031's bounds
   guard then corrects it out of range and writes the correction back. There is no debounce length
   that fixes that, so the write moves to the moment the user LEAVES.

   The trade is that leaving becomes the moment the document is checked, which is why FR-018 blocks
   the three exits and FR-019 has to say what is wrong per value rather than "invalid". FR-018a's
   escape and FR-020's fourth exit exist because a rule that can trap the user, or silently discard
   their work at shutdown, would be a worse defect than the one being fixed.

## What the implementation changed in the plan

Recorded so the diff is reviewable rather than mysterious. All three were found by tests, and each
one is the same shape as the five the analysis rounds catalogued: a claim about a category standing
in for a check of its members.

1. **The write path must NOT use `parseSettingsGuarded`.** Step 6 of the contract says the patched
   document goes through "the same bounds guard the read path uses", and the read path composes the
   guard with `parseAppSettings`. That second half REBUILDS the document from a fixed shape — it
   injects every shipped default the file omitted and drops every key it does not model. Correct for
   a read whose job is to hand the app a complete object; on a write it breaks G1 outright. The guard
   alone is used, and its result only when it actually corrected something.
2. **`resetSetting` and `resetBinding` dropped hand-added keys.** The pure reset helpers take a TYPED
   document, so the raw file had to go through the same rebuild. The typed view now only COMPUTES the
   new leaf; the value is applied to the raw document as a one-key patch.
3. **`themes-tab.tsx` writes settings four times.** Three rounds of audit cleared the file as a
   whole-*theme* writer, which it is, and never asked what its call sites write.

## Complexity Tracking

No constitutional violations, so nothing to justify.
