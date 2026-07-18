# Implementation Plan: v1.0.0 Bug Sweep — Signals That Were Never Sent

**Branch**: `019-v1-bug-sweep` | **Date**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/019-v1-bug-sweep/spec.md`

## Summary

Six defects, already reproduced and already driven to failing tests against `master @ 87e28a9`. The
suite in the tree is the specification of "done": **1500 unit/integration/contract tests pass, 8 fail,
and all 8 are this feature's guards**. Lint and typecheck are clean. Nothing here starts with writing
a test; it starts with reading the seven files listed in [Project Structure](#source-code-repository-root)
and making them green without breaking the guards sitting green beside them.

Four of the six are one defect: a component establishes a fact and tells nobody. The machinery that
would act on the fact already exists in every case, so the work is **wiring a signal into an existing
path**, not building a path.

- **#87 (US1)** — `FilesService.move`/`rename` complete a move and announce nothing
  (`files-service.ts:84-112`, `:62-82`), while `delete` announces its `removed[]`
  (`files-service.ts:165` → `main.ts:586`). The coordinator's folder watch then infers a *deletion*
  (`editor-coordinator.ts:704`) and force-dirties a buffer the user never edited — inviting a save
  that re-creates the file at the old path and undoes the move. The fix is a `{from,to}` signal
  bracketing the move, plus a `markMoved` on the coordinator that mutates `doc.absPath`, re-keys the
  one-buffer registry, re-watches, and relays the new path — reusing `load()`'s existing re-point
  branch (`editor-coordinator.ts:204-218`) rather than reloading the document.
- **#86 (US2)** — `workspace.save` is debounced 400ms (`workspace-store.tsx:42`) and `flushSave`
  (`workspace-store.tsx:121-133`) is wired only to a project switch and unmount. The ordinary close
  fires on a 250ms timer (`main.ts:661`); 250 < 400. Terminate All survives *by accident* — the prompt
  detains the user past the debounce. The fix is an **awaited** drain in the close handshake, reaching
  every window (C6) and every deferred write a window owns (**C19** — there is more than one; every write is covered, `void`-dropped **or awaited**, because the module does not distinguish (**C26**); and the tallies this chain kept asserting were wrong every time and are struck (**C24**)), with `flushSave` returning the promise it drops on the floor
  and the config writes settled at their **chokepoint** rather than enumerated (**C22–C26**:
  `settleConfigWrites()` flushes the armed timers and awaits `writeChains` — the module's **existing**
  per-doc in-flight map, `write-config.ts:24`, not a new one). Counting them was attempted repeatedly
  and was wrong every time (C19/C20/C21/C22, the last gating the call on "a preferences window" while
  `projects-panel.tsx:208` writes from the workspace one — C23; C24 then found the tally itself false).
  **No tally is stated anywhere; the drain never needed one.**
- **#94 (US3)** — when `PtyAgentHost`'s 15s connect deadline lapses the retry loop simply stops
  (`pty-agent-host.ts:67-74`): no callback, no error, no teardown, while `start()` has already minted
  an optimistic handle so the daemon reports `running`. The fix routes a lapsed connect deadline and a
  lapsed **readiness** budget into the existing `failAllLive` path (`pty-agent-host.ts:78-84`), and
  finally handles the `{ev:'started'}` ack the protocol has always defined and the host has always
  discarded (`pty-agent-protocol.ts:26` → `pty-agent-host.ts:133-135`).
- **#95 (US5)** — `explorer.openMode` has never had a reader; `decideClick(openMode, …)`
  (`open-intent.ts:17`) merely *names its parameter* that, and is only ever fed `editor.openOnClick`.
  The fix deletes the inert setting (C1: dropped, not migrated) and moves the working one into the
  File Explorer group (C2: no key rename, so no migration of a setting that works).

The remaining two build something:

- **#67 (US4)** — the map control **rejects arrays outright** (`map-control.tsx:29-30`) and has no
  text cell, so `terminals.flavours` falls to a JSON textarea and `terminals.disabledBuiltins` asks the
  user to free-type an id the app already knows. The fix **generalises** the one table (C9/FR-020) into
  an explicitly-declared array-of-records mode keyed by `id`, adds the text cell — which incidentally
  repairs `terminals.defaultParams` (C14) — and adds a `listDetectedFlavours()` channel (C10) because
  `listFlavours()` subtracts `disabledBuiltins` and therefore cannot offer a hidden built-in back.
- **#83 (US6)** — no syntax colour is measured against `editorBg`. The premise that the light themes
  are illegible is **false** (150 pairs, zero failures, all ≥6.01:1); the guard gap is real. The fix
  **derives** the pairing list from the token registry (FR-026) at a stated **6.0:1** house threshold
  (C3), gated on every bundled theme bar the by-design carve-out (C4).

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Node 24, React 18, Electron 40+

**Primary Dependencies**: Electron, React, CodeMirror 6, node-pty (ConPTY), Inversify (composition
roots), Playwright 1.61.1 (Electron), Vitest, ESLint (typescript-eslint)

**Storage**: SQLite via the daemon (projects, layouts, document state); human-editable JSON in
`%USERPROFILE%\.throng\` (`settings.json`, keybindings, themes) — overridable with
`THRONG_CONFIG_ROOT`, which is what the #67 E2E drives

**Testing**: Vitest projects `unit` / `integration` / `contract` (all `environment: 'node'`);
Playwright-Electron for E2E. There is **no jsdom/component-test layer** — UI-visible behaviour is
asserted in E2E or via pure functions plus source-text guards (which is exactly the shape of the #95
guard). The seven RED files already exist; see the table below.

**Target Platform**: Windows first (Electron desktop); macOS/Linux must not be foreclosed. Every
OS-specific piece this feature touches (`WindowsDeElevatedLauncher`, `WindowsShellDetection`,
`NodeFileWatcher`) already sits behind a Principle II seam and stays there.

**Project Type**: Desktop application — Electron main + preload + React renderer, plus a detached
daemon (two composition roots).

**Performance Goals**: Stated as budgets, because that is what the tests measure.
- **Shutdown drain**: bounded and **awaited**, never raced. The ordinary close's existing 250ms timer
  stops being the thing that decides whether a write survives (FR-011).
- **Launch failure**: visible within **connect 15s + readiness 15s** worst case 30s (C7). The RED
  integration test waits `15s + 3s` per scenario, so each budget must lapse into a failure on its own.
- **Move re-point**: no reload, no re-read, no user-visible latency — a path mutation on an in-memory
  document.

**Constraints**:
- The RED tests are the contract and must not be rewritten to fit the implementation. The **one**
  exception is forced by C3 and is called out in [Complexity Tracking](#complexity-tracking).
- `PtyAgentHost` is constructed with **two** arguments by the RED integration test
  (`pty-agent-launch-timeout.integration.test.ts:96`), so injected budgets must arrive as an optional
  third parameter with documented defaults.
- The `@admin` E2E (`terminal-de-elevation-hang.e2e.ts`) cannot be verified by any non-elevated run,
  and CI currently excludes it from the only runner that could execute it
  (`playwright.config.ts:55,88`; `ci.yml:157-158` asserts the opposite of what `admin.ts` documents).
- `map-control.tsx` has live keyed-map callers (`editor.indentByLanguage`, `editor.languageByExtension`)
  whose E2E and unit coverage is green today and must stay green (FR-020 forbids a second table).

**Scale/Scope**: 6 issues, 6 user stories, **30** functional requirements (FR-013a was split out of
FR-013 under C15), **28** settled clarifications (C1–C28; C15–C28 were added by the 2026-07-17
cross-artifact repair session and reverse **no C1–C14 decision** — several supersede *each other's*
mechanisms, which the spec records in place rather than by editing history: C22 discards C20/C21's
provider, C24 supersedes a C19 decision, C25 replaces C22's API, C26 replaces C25's signature). 7 test files already written (**20 RED assertions —
8 in the node suite, 12 in E2E — and 19 green regression guards inside the same files**).
Production surfaces touched: `core`, `ui/main`, `ui/renderer` (C19–C26 added the preferences writers
and the write-module chokepoint), `daemon`, `platform-windows`, plus `ci.yml` — named, not counted
(C24). No new package, no new process, no new persisted store.

**No `NEEDS CLARIFICATION` remains.** Every marker the spec carried is resolved by C1–C28; the two
genuine unknowns found while planning (how a generalised record control names its test ids; how a
lapsed budget's *reason* is obtained across a fire-and-forget launch) are resolved from the codebase
and recorded in [research.md](./research.md) §4 and §3. A **third** — whether the agent already emits
the `started` ack T026's budget waits on — was left conditional at planning time and is now also
resolved from the codebase: **it does** (`pty-agent-entry.ts:91`), so US3 is host-side only and T027 is
a confirmation rather than protocol work (research §3, tasks T027).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.* Constitution **v3.15.0**.

| Principle | Assessment |
|---|---|
| **I. Project-First Context Isolation** | PASS. The move signal is scoped to the active project root — `FilesService` already resolves and confines every path against it (`files-service.ts:221-225`), and the signal carries only paths that survived that check. No cross-project leak is introduced. |
| **II. Platform-Abstracted Core** | PASS. New OS work is confined to existing seams: the de-elevated launch stays behind `WindowsDeElevatedLauncher` (`packages/platform-windows/src/windows-de-elevated-launcher.ts`), the watch behind `IFileWatcher`, detection behind `IShellDetection`. `@throng/core` gains only pure functions (flavour-record validation, derived contrast pairings). Path normalisation for move-matching is pure and lives in core, not in a Windows branch (FR-007). |
| **III. Detached, Tagged & Persistent Terminals** | PASS, and directly served. FR-012's failure path routes through `failAllLive`, which is the same mechanism that already stops a crashed agent's sessions from hanging `running` forever and releases the project-root lock. C8 (no relaunch on a never-arrived agent) preserves the existing `close`-path relaunch (`pty-agent-host.ts:64-65`) for the case it was written for — a *crashed* agent — and refuses to turn a systemic failure into a launch loop. FR-013 (`started` ack, not first output) is what keeps a legitimately slow shell from being killed, which the resource-hygiene rule would otherwise be blamed for. |
| **IV. Native Terminal Support & Auto-Detection** | PASS. `listDetectedFlavours()` (C10) exposes the **raw** detection result to the editor; `listFlavours()` — the panel dropdown's source, which subtracts `disabledBuiltins` — is unchanged. FR-017 is only satisfiable because detection and subtraction are separable. |
| **V. Test-First Quality Discipline (NON-NEGOTIABLE)** | PASS — inverted, and legitimately so. Red was written **first**, against `87e28a9`, before any production change: 7 files, 20 RED assertions (8 node-suite + 12 E2E), each confirmed red *for the right reason*. This feature is the Green half of that cycle, then Refactor. Every UI-visible change ships E2E (US1, US2, US4, US5 all have one). The `@admin` rule is honoured: `terminal-de-elevation-hang.e2e.ts` is tagged and elevation-gated, never asserting a hollow baseline — and FR-013a/SC-008 close the gap that made that tag *unrunnable anywhere* (see Complexity Tracking). Test artifacts self-clean (`rmRoot`/`afterAll` in every new file). |
| **VI. Simple, Modern, Discoverable UX** | PASS, and served by US4/US5. C2 puts the surviving control where users already look for it. FR-018's control is a table, not a JSON blob. FR-019's refusals carry a **reason** — "invalid" with no reason is what the RED test explicitly rejects (`preferences-terminal-flavours.e2e.ts:196-198`). |
| **VII. Change Review & Approval** | PASS (untouched). No edit-list behaviour changes. |
| **VIII. SOLID / DRY / YAGNI** | PASS, and DRY is the point of US4 and US6. FR-020 forbids a second table: one control, one mode switch declared by the descriptor. FR-026 replaces a hand-written pairing list with a derived one, and `SYNTAX_TOKENS` (`theme-quality.ts:292-303`) — itself a hand-list — is derived from the registry, closing the same hole one level down. YAGNI: no reordering affordances (C11), no existence-checking of executables (C12), no fleet-wide inert-settings guard (Open Question 9 — a text scan is unsound; see research §7), no `editorSelection` pairings (C5). |
| **IX. DI & Composition Root** | PASS, with one shape to watch. `PtyAgentHost`'s budgets and the drain timeout are **injected from their process's composition root** (`packages/daemon/src/composition-root.ts:142`, `packages/ui/src/main/main.ts`), not read from `process.env` inside the class. The optional-third-parameter default exists so the RED test's 2-arg construction compiles; it references a documented exported constant, the same pattern as `DEFAULT_ATTACH_TIMEOUT_MS` (`ui-settings.ts:19`). No new container, no service locator, no ambient singleton. |
| **X. Externalised Configuration** | PASS. Three new values, all typed-settings members with documented defaults and env overrides: `IUiSettings.shutdownDrainTimeoutMs`, `IDaemonSettings.agentConnectTimeoutMs`, `IDaemonSettings.agentReadyTimeoutMs`. The 15s connect deadline currently hardcoded at `pty-agent-host.ts:36` is **removed** in the process — this feature leaves that principle better satisfied than it found it. The 6.0:1 contrast gate is a build-time constant in core, not runtime configuration (a theme author must not be able to lower the bar their theme is judged against). |
| **XI. Dockable Workspace / One document, one state** | PASS, and the rule is load-bearing here. FR-002 forbids re-loading a moved document precisely because a reload would mint a **second original**: the authority (`DocumentAuthority`) keeps its buffer, dirty state and undo history, and the move is relayed to every view as a derived change (`relaySync(-1, …)` — the same ordered stream `markDeleted` uses at `editor-coordinator.ts:290`). A move is a path mutation on **one** document, broadcast to its replicas; it is never a per-view fact. |
| **Static analysis & linting (v3.13.0)** | PASS. Zero lint/typecheck errors at baseline and required at completion. Note `tsc -b` now type-checks the renderer (`87e28a9`), so a renderer-side type error fails the build rather than hiding. |
| **Documentation currency (v3.10.0)** | **ACTION REQUIRED** — an obligation, not a violation. User-facing behaviour changes: a settings key **disappears** (`explorer.openMode`), a setting moves group, two controls change shape. README's configuration description must be reconciled in this change (ROADMAP.md was retired by master `5856ea5` under constitution 4.0.0, so its edit was dropped on rebase); `docs/testing.md` and `CONTRIBUTING.md` must record how the `@admin` suite is now run in CI (FR-013a). Discharged by tasks, not by a waiver. |
| **Configuration-editor completeness (v3.11.0)** | PASS, and strengthened. `terminals.defaultParams` is today a descriptor that renders an **empty `<select>`** — a key that is nominally described but not actually editable, which is the rule's letter kept and its purpose defeated. C14 fixes it here with a regression test. Removing `explorer.openMode` removes both the key and its descriptor together, so `assertEveryKeyDescribed` stays satisfied in both directions. |
| **Action controls MUST be themeable icons with hover titles (v3.12.0)** | PASS. The record control's add/remove affordances reuse `IconButton` exactly as `map-control.tsx:143-148,201-206` already does. No new inline SVG, no text-labelled action control. The flavour **error** region is a `role="alert"` message, not a control. |
| **Idempotent data migrations (v3.5.0)** | PASS — vacuously, and deliberately. C1 is the *absence* of a migration: `explorer.openMode` is ignored on load and stripped on the next write, which `explorerSettings` (`app-settings.ts:267-285`) already does for unknown keys. Re-loading a stale settings file converges on the same state every time, because nothing is transformed. |
| **A test run MUST be executed once, in full (v3.14.0)** | PASS as a working rule for implementation: capture the full run once, re-run only the 8 failures while fixing, then one full green run as the evidence. A test that flips without a code change is flaky, not fixed. |

**Verdict: PASS. No principle violation requires justification.** Two items are recorded below as
obligations/known conditions rather than violations: documentation currency (discharged by a task) and
the CI elevation gap (which FR-013a exists to close).

## Project Structure

### Documentation (this feature)

```text
specs/019-v1-bug-sweep/
├── plan.md                       # This file
├── spec.md                       # Specification + 28 settled clarifications (C1–C28)
├── research.md                   # Phase 0 — decisions, rationale, rejected alternatives
├── data-model.md                 # Phase 1 — entities in flight (nothing new is persisted)
├── quickstart.md                 # Phase 1 — how to prove all six fixes, by machine then by hand
├── contracts/
│   ├── move-signal.md            # FilesService → EditorCoordinator → renderer (US1)
│   ├── shutdown-drain.md         # the close handshake's drain round-trip (US2)
│   ├── pty-agent-readiness.md    # connect/readiness budgets, the `started` ack, launch reporting (US3)
│   ├── terminal-flavours-ipc.md  # listDetectedFlavours + the flavour record (US4)
│   ├── settings-descriptors.md   # openOnClick move, openMode removal, the records control (US4/US5)
│   └── theme-contrast.md         # the derived pairing set + the 6.0 gate (US6)
└── tasks.md                      # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

The **tests already exist**. They are listed first because they are the specification:

```text
packages/ui/tests/e2e/editor-move-repoint.e2e.ts                 # #87 — 6 RED + AC7 GUARD (green, must stay)
packages/ui/tests/e2e/terminate-all-drain.e2e.ts                 # #86 — 2 RED (ordinary close) + 2 green (pins the asymmetry)
packages/daemon/tests/integration/pty-agent-launch-timeout.integration.test.ts  # #94 — 2 RED, elevation-free
packages/ui/tests/e2e/terminal-de-elevation-hang.e2e.ts          # #94 — @admin, NOT YET EXECUTED anywhere
packages/ui/tests/e2e/preferences-terminal-flavours.e2e.ts       # #67 — 4 RED
packages/core/tests/unit/theme-syntax-body-contrast.test.ts      # #83 — 4 RED + 16 green (locks the measured 150)
packages/core/tests/unit/settings-open-on-click-single-owner.test.ts  # #95 — 2 RED, fix-agnostic
```

Production surfaces, by story:

```text
# US1 — the move signal (#87)
packages/ui/src/main/files-service.ts          # move()/rename(): accumulate ACTUAL moves (delete's removed[] lesson);
                                               #   bracket with onMoveStarted/onMoved
packages/ui/src/main/editor-coordinator.ts     # NEW markMoved(pairs) + beginMove(paths); re-point by PATH MUTATION,
                                               #   reusing load()'s branch (:204-218); onDiskChange (:692-706) tolerates
                                               #   a pending move; markDeleted (:268-294) is UNTOUCHED (AC7)
packages/ui/src/main/main.ts                   # wire setOnMoved → markMoved beside setOnDeleted (:586)
packages/core/src/fs/path-id.ts                # NEW pure: samePath/isUnderPath — one normalisation, not three (FR-007)
packages/ui/src/renderer/editor/use-editor.ts  # handle msg.movedTo (beside :779-790) → update the panel's config path
packages/ui/src/renderer/workspace/…           # the file pill follows via the panel config it already renders

# US2 — the shutdown drain (#86). MORE than one deferred write, not one (C19; "four" was itself wrong —
#   C24). The config writes are settled at their CHOKEPOINT rather than enumerated (C22), in EVERY
#   window rather than a named one (C23). Counting was attempted repeatedly and was wrong every time;
#   no tally appears here or anywhere else (C24).
packages/ui/src/renderer/state/workspace-store.tsx   # flushSave RETURNS its promise (:121-133); expose the drain
packages/ui/src/renderer/config/write-config.ts      # THE CHOKEPOINT (C22–C26 / T017a). writeConfig tracks in-flight
                                                     #   writes in writeChains (:24 — ALREADY EXISTS, C26;
                                                     #   settleConfigWrites awaits it, no new set);
                                                     #   scheduleWrite(id, produce, ms) + cancelWrite(id)
                                                     #   arm timers KEYED PER ConfigDocId (C25 — an id
                                                     #   bound at creation cannot express writeTheme, whose id
                                                     #   comes from the payload at fire time; per-id keying IS
                                                     #   018 FR-023, and it dissolves json-tab's orphan). The
                                                     #   thunk runs at FIRE time; null = do not write (C26 —
                                                     #   json-tab parses and must not write invalid JSON);
                                                     #   cancelWrite backs json-tab's reload abandon (:108).
                                                     #   settleConfigWrites() flushes + awaits ALL of them,
                                                     #   and EVERY window calls it unconditionally (C23).
                                                     #   Replaces the per-tab provider C20/C21 proposed: a design
                                                     #   needing an accurate list was wrong EVERY time (C24 —
                                                     #   nobody counts): miscount; 2-of-3 tab model; an unmount happens;
                                                     #   a preferences-only window gate that would have acked
                                                     #   projects-panel.tsx:208's write in flight). The shared
                                                     #   debounce helper (:93) is UNTOUCHED — its search-input callers
                                                     #   write nothing; scheduleWrite is built on it, for writers only.
packages/ui/src/renderer/preferences/apply-client.ts # applyDebounced + its 250ms debounce DELETED (C24) —
                                                     #   unreachable (zero callers; applyNow cancels it and
                                                     #   writes immediately). Its debounceMs=250 param goes
                                                     #   too — unused param = v3.13.0 lint error (C25).
                                                     #   flush()/cancel() go too, or
                                                     #   tsc -b fails: ApplyClient ends as { applyNow } (C25).
                                                     #   applyNow's writes need NO change — the module set
                                                     #   already covers them, which is the point.
packages/ui/src/renderer/preferences/settings-tab.tsx # drops its unmount cleanup (:115) — the module settles it now
                                                     #   (also touched by US4's dynamicOptions)
packages/ui/src/renderer/preferences/themes-tab.tsx  # writeTheme (:297) — same; 018 FR-023's captured-at-edit-time
                                                     #   guarantee untouched. Drops its unmount cleanup (:302).
packages/ui/src/renderer/preferences/json-tab.tsx    # apply (:54) — same. Its useMemo(…,[docKey]) ORPHANS an armed
                                                     #   timer on a tab switch WITHOUT unmounting; the module set is
                                                     #   what catches it.
packages/ui/src/main/main.ts                         # close handshake (:650-686): drain EVERY window, AWAIT it, then close
packages/ui/src/preload/preload.cts                  # the drain channel (main → renderer request, renderer → main ack)
packages/ui/src/renderer/global.d.ts                 # its bridge types, beside appCloseChoice (:45)
packages/core/src/config/settings.ts                 # IUiSettings.shutdownDrainTimeoutMs
packages/ui/src/main/ui-settings.ts                  # its documented default + env override

# US3 — the failure path (#94)
packages/daemon/src/pty-agent-host.ts                # connect deadline → failAllLive; readiness budget on the `started`
                                                     #   ack (:133-135); no relaunch on a never-arrived agent (C8)
packages/daemon/src/composition-root.ts              # inject the budgets (:142-148); pass the launch-failure reporter
packages/platform-windows/src/windows-de-elevated-launcher.ts   # observable: capture the shim's stderr/exit (FR-015)
packages/core/src/config/settings.ts                 # IDaemonSettings.agentConnectTimeoutMs / agentReadyTimeoutMs
.github/workflows/ci.yml                             # run the @admin suite on the elevated runner (FR-013a / SC-008)
scripts/test-e2e-admin.mjs                           # forward the new agent budgets across the UAC hop (T031a):
                                                     #   Start-Process -Verb RunAs inherits NO environment, so
                                                     #   without this T033's $env: prefix is an inert proof

# US4 — the controls (#67)
packages/core/src/config/metadata.ts           # ControlKind |= 'records'; MapColumn/FieldDescriptor additions
                                               #   (idKey, itemNoun); emptyValueFor('records') → [] — else a
                                               #   clear writes '' into an array (016's F6 again)
packages/core/src/config/settings-metadata.ts  # flavours → records (:159-166); disabledBuiltins → multiselect (:167-175)
packages/core/src/terminal/flavour-record.ts   # NEW pure: validateFlavourRecord (id required, file required, dup id)
packages/ui/src/renderer/preferences/map-control.tsx   # GENERALISED: array-of-records mode; a TEXT cell (fixes
                                                       #   terminals.defaultParams, C14). NOT a second table.
packages/ui/src/renderer/preferences/form-controls.tsx # renderControl gains `case 'records'` (:48). WITHOUT it the
                                                       #   descriptor falls to `default:` and renders [object Object]
                                                       #   — valid descriptor, valid control, nonsense on screen.
packages/ui/src/renderer/preferences/settings-tab.tsx  # dynamicOptions() feeds the detected built-ins (:135-145)
packages/ui/src/main/shell-detection-service.ts        # listDetectedFlavours() — the RAW set (C10)
packages/ui/src/main/main.ts                           # its IPC handler beside :595
packages/ui/src/preload/preload.cts + renderer/global.d.ts   # the new channel

# US5 — one owner (#95)
packages/core/src/config/app-settings.ts       # DELETE ExplorerSettings.openMode (:21,199,269-284); OpenMode's
                                               #   remaining user is decideClick — retype it to the survivor
packages/core/src/config/settings-metadata.ts  # DELETE the explorer.openMode descriptor; editor.openOnClick →
                                               #   group 'File Explorer', label 'Open files with' (C2)
packages/core/src/explorer/open-intent.ts      # decideClick's parameter takes the type it is actually fed

# US6 — the derived guard (#83)
packages/core/src/config/theme-quality.ts      # SYNTAX_TOKENS derived from the registry; SYNTAX_ON_BODY pairings
                                               #   derived (FR-026); SYNTAX_BODY_MIN = 6.0 (C3);
                                               #   assertSyntaxBodyContrast over all themes bar the carve-out (C4)
packages/core/tests/unit/…                     # the existing theme guard suite calls the new assert (FR-027)

# Documentation (constitution v3.10.0 — same change, not a follow-up)
README.md / CONTRIBUTING.md / docs/testing.md  (ROADMAP.md retired by master 5856ea5; constitution 4.0.0)
```

**Structure Decision**: No new package, process, layer or persisted entity. Every change lands in the
existing core/main/renderer/daemon split, and each of the four "missing signal" fixes terminates in a
path that already exists (`load()`'s re-point branch, `flushSave`, `failAllLive`, `editor.openOnClick`).
The two "missing thing" fixes add exactly one construct each: an array-of-records **mode** on the
existing table (never a second table — FR-020), and a **derived** pairing set replacing a hand-written
one.

## Phase Ordering

Implementation order follows the RED suite's cost, not user-value priority — with one exception that
is a hard dependency.

1. **US6 (#83) and US5 (#95) first.** Pure-core, unit-tested, no app run needed. They convert 6 of the
   8 node-suite RED assertions and put a fast green bar under the rest.
2. **US3 (#94) next.** Its RED test is elevation-free integration (2 assertions, ~40s), and its CI
   change (FR-013a) must land before anyone can claim the `@admin` half is verified.
3. **US1 (#87)** — the P1 data-loss defect, and the largest E2E surface (7 tests).
4. **US2 (#86)** — depends on nothing, but must land **after** US1: US1's re-point writes the new path
   into the panel config, which rides the very `workspace.save` debounce US2 drains. Fixing the drain
   first would leave US1's persistence assertion (AC5's neighbour, the layout path) passing for the
   wrong reason, and fixing it after proves both.
5. **US4 (#67)** last — the only story that builds a control, and the only one whose blast radius
   (`map-control.tsx`) has green callers to protect.

## Complexity Tracking

> Recorded deferrals, known conditions, and the one place a settled decision contradicts a written
> test. **No constitution violation requires justification.**

| Item | Why it is here | Disposition |
|---|---|---|
| **C3 (6.0:1) contradicts a RED assertion.** `theme-syntax-body-contrast.test.ts:65` asserts `pairing.min` **`toBe(WCAG_AA_BODY)`** — i.e. 4.5. C3 settles the gate at **6.0**. Both cannot hold. | The test was written before the clarification session; its stated intent is "at the body-text threshold, **not a relaxed UI one**" — i.e. it is defending against `WCAG_AA_LARGE_UI` (3.0), not demanding exactly 4.5. A 6.0 gate satisfies that intent *more* strictly. | **Amend that one assertion** to `toBe(SYNTAX_BODY_MIN)` with `expect(SYNTAX_BODY_MIN).toBeGreaterThanOrEqual(WCAG_AA_BODY)` beside it, so the "not relaxed" property is still asserted and the house standard is stated. Nothing else in the file changes; the 16 green measurements stay as written (they gate the 4.5 floor and pass at 6.01+). Reasoned in [research.md §6](./research.md). **The alternative — implementing 4.5 and calling C3 satisfied — is refused**: C3's reasoning is that a 4.5 gate is weaker than the `legibleOn(…, 6)` derivation it exists to protect (`default-themes/index.ts:186-191`). |
| **#87's and #86's E2E cannot run in CI** (scope corrected by **C18**; this row previously claimed "six of the seven" files self-skip and that #67 was among them — **both false**). **Two** files call `skipIfElevated()`: `editor-move-repoint` and `terminate-all-drain`. GitHub's Windows runners run **elevated**, so those two **self-skip there** — a green CI bar says nothing about #87 or #86. **#67's spec has no elevation guard and does execute in CI** (it starts no terminal, so the caveat below does not apply to it); its 4 RED fail CI on this branch today and T046 turns them green there. | Discovered while reading the baseline; it is not caused by 019. The guard is correct (`admin.ts:40-52`: an elevated daemon routes terminals through the agent, so terminal-adjacent assumptions do not hold), but it is applied file-wide to specs that have no terminal in them at all. | **In scope only for #94** (FR-013a/SC-008: the `@admin` suite must actually execute on the elevated runner, count > 0). Narrowing `skipIfElevated()` on the non-terminal specs is **out of scope** — it is a change to the E2E strategy, not a defect fix, and it would risk the 19 green guards in this sweep on an environment nobody here can reproduce. **Tracked**: these specs are verified on a developer's non-elevated run and that must be stated in the PR evidence, not implied by CI. Recommend a follow-up issue to make the elevation guard per-assumption rather than per-file. |
| **`@admin` de-elevation E2E has never been executed.** `terminal-de-elevation-hang.e2e.ts` was authored unrun (the session was not elevated), and CI `grepInvert`s `@admin` (`playwright.config.ts:55`). SC-007 ("an elevated throng opens a *working* non-elevated terminal") is therefore **unproven either way**. | FR-014 says the fail-fast path is the safety net, not the outcome — the test itself refuses to pass on a visible error (`:109-112`). It is entirely possible that de-elevation is *also* broken, in which case FR-012's error is the honest outcome and FR-014 is unmet. | **In scope, and the first thing to run** (quickstart §US3). If de-elevation is genuinely broken, FR-015's captured shim reason is what will say why — that is the requirement's whole purpose. If it cannot be fixed in this feature, FR-014 is **split out as its own issue with the captured reason attached**, and 019 ships FR-012's bounded failure. That would be an honest partial delivery under the Incremental Delivery rule; silently passing on `outcome === 'visible-error'` would not. |
| **`PtyAgentHost` budgets arrive as an optional constructor parameter** rather than a required injected settings object. | The RED test constructs it with two arguments (`pty-agent-launch-timeout.integration.test.ts:96,164`). A required third parameter would not compile there, and rewriting the RED test to accommodate the implementation inverts test-first. | **Accepted, and Principle X is net-improved**: the currently *hardcoded* `Date.now() + 15_000` (`pty-agent-host.ts:36,65`) becomes an injected value from `IDaemonSettings`, with a documented exported default for the 2-arg form — the same pattern as `DEFAULT_ATTACH_TIMEOUT_MS` (`ui-settings.ts:19`). Production always injects. |
| **`terminals.defaultParams` is fixed incidentally** (C14) rather than by its own issue. | Its `control: 'text'` column renders an empty `<select>` (`settings-metadata.ts:185-186` + `map-control.tsx:264-277`) purely because `MapCell` has no text cell — the exact gap FR-018 must close anyway. | **In scope**, with a regression test rather than an issue, per C14. It ships with zero test coverage today, so a test is the deliverable that makes the fix real. |
| **`editorSelection` syntax pairings** (C5) and **flavour reordering** (C11) and a **fleet-wide inert-settings guard** (Open Question 9). | Each is a real gap of the same class as something in this sweep. Each would widen the blast radius past what was reproduced and measured. | **Out of scope; raise as follow-up issues.** OQ9's text-scanning form is *unsound* — attempted during reproduction, 11 false positives, defeated by aliased section objects — so a follow-up must specify typed accessors or a type-graph check, not a grep. The #95 guard test in this feature is the narrow, sound version of it. **Settled as C16**, which also narrows SC-012/FR-022 to the open-on-click claimants: the fleet-wide inert-settings property is not built here, so it is not *claimed* here either. |
| **`WindowsDeElevator` is dead code** (`isAvailable()` hard-returns `false`). | Found during reproduction; noted in the spec's corrections. | **Delete it if and only if nothing references it** — a YAGNI/Principle VIII cleanup that costs one commit and removes a decoy from the next person who debugs this path. If it has a live reference, leave it and raise an issue rather than growing this feature. |
| **A move onto a path that is itself open** is undefined today (spec, Edge Cases). | The move signal makes it *expressible* (two docs would claim one path in the one-buffer registry), where today it is merely unnoticed. | **Out of scope as a feature**, but the design must not corrupt the registry: `markMoved` re-keys via `unregisterPanel` + `registerOpen`, the same pair `save()` uses for Save-As (`editor-coordinator.ts:503-505`). Recorded in [research.md §1](./research.md); recommend an issue for the collision UX. |
