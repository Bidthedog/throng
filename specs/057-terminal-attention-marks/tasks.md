---
description: "Tasks for 057 — panel attention marks and terminal attention signals"
---

# Tasks: Panel Attention Marks and Terminal Attention Signals

**Input**: `specs/057-terminal-attention-marks/` — [spec.md](./spec.md), [plan.md](./plan.md),
[research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/),
[quickstart.md](./quickstart.md)

**Tests**: Required (Principle V, test-first). Every behaviour task is preceded by its failing test,
at the layer research R16 assigns.

**Boundaries** (step 7 routing): **CORE** = `packages/core` attention/terminal/abstractions, plus
`packages/ipc-contract` and `packages/daemon`. **CONFIG** = `packages/core/src/config/*` and `docs/`.
**MAIN** = `packages/ui/src/main` and `packages/ui/src/preload`. **UI** = `packages/ui/src/renderer`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelisable (different files, no dependency on an unfinished task)
- **[Story]**: US1–US7 from spec.md

---

## Phase 1: Setup

- [x] T001 [P] Create `packages/core/src/attention/attention-types.ts` with `AttentionSignalName` (`'processExited' | 'commandFinished' | 'bell' | 'notification' | 'progressEnded' | 'unseenOutput' | 'outputQuiet'`), `AttentionKind` (`'attention' | 'failed'`), `AttentionSignal`, `AttentionMark`, `FocusReport`, `AttentionLedgerEntry`, `AttentionProducerConfig` exactly as data-model.md, and export them from `packages/core/src/index.ts` [CORE]
- [x] T002 [P] Add `TERMINAL_ATTENTION_NOTIFICATION = 'terminal.attention'`, `TERMINAL_ATTENTION_CONFIG_METHOD`, `TERMINAL_ATTENTION_LEDGER_METHOD`, `TERMINAL_ATTENTION_SYNC_METHOD` and their param/result types to `packages/ipc-contract/src/terminal.ts` per contracts/daemon-attention.md; also add the missing `observedAt?: number` to the `terminal.command` params interface [CORE]

---

## Phase 2: Foundational (blocks every story)

### Settings (CONFIG)

- [x] T003 [CONFIG] Write failing tests in `packages/core/tests/unit/app-settings.attention.test.ts`: defaults, tolerant parse (booleans by `typeof`, delivery in `['inApp','os','both']`, whole numbers), and clone survival for all 14 keys in data-model.md § Settings (`attention.clearDelayMs` 0–10000 default 1000; `attention.delivery.attention`/`.failed` default `'both'`; `attention.osNotifications` true; `attention.taskbarBadge` true; `terminals.attention.enabled` true; `terminals.attention.signals.{processExited,commandFinished,bell,notification,progressEnded}` true; `.unseenOutput`/`.outputQuiet` false; `terminals.attention.quietSeconds` 10–600 default 10)
- [x] T004 [CONFIG] Implement the `attention` slice and `terminals.attention` fields in `packages/core/src/config/app-settings.ts` (type, `DEFAULT_APP_SETTINGS`, parse, `cloneTerminals` and a clone for the new slice), with an `ATTENTION_DELIVERIES` const array; export the new types from `packages/core/src/index.ts`
- [x] T005 [CONFIG] Add descriptors in `packages/core/src/config/settings-metadata.ts`: mechanism keys `group: 'Attention'`; producer keys `group: 'Terminal'`, `subgroup: 'Attention'`, per-signal toggles `enabledWhen: { key: 'terminals.attention.enabled', is: true }`, descriptions stating exact/heuristic and, for Command finished, 025 FR-019d's staleness window (FR-061); sliders: clear delay min 0 max 10000 step 100, quiet min 10 max 600 step 10; delivery `allowedValues` with `optionLabels` "In App Notification" / "OS Notification" / "Both". Run `settings-metadata.test.ts`, `slider-descriptors.test.ts`, `reset-completeness.test.ts`
- [x] T006 [CONFIG] Add one row per key to `docs/preferences.md`: a new `## Attention` section for `attention.*`, and rows in the `## Terminal` table for `terminals.attention.*`, then run `packages/ui/tests/unit/docs-currency.test.ts`

### Theme tokens (CONFIG)

- [x] T007 [CONFIG] Write failing expectations: bump `EXPECTED_COLOUR_TOKEN_COUNT` to 80 and `EXPECTED_ICON_TOKEN_COUNT` to 85 in `packages/core/tests/unit/default-themes.test.ts`, and add `packages/core/tests/unit/theme-attention-tokens.test.ts` asserting `attentionMark`, `attentionFailedMark`, `icons.attention`, `icons.attentionFailed` and `icons.goToPanel` exist in every bundled theme and that the two colours differ in each
- [x] T008 [CONFIG] Add the colour tokens to `THRONG_THEME.colours` in `packages/core/src/config/theme.ts` and to `makeTheme` in `packages/core/src/config/default-themes/index.ts`; the icon tokens to `THRONG_THEME.icons`; copy in `packages/core/src/config/theme-copy.ts`; area placement in `packages/core/src/config/theme-metadata.ts` (`GENERAL_COLOURS`); bump `SHIPPED_DEFAULTS_VERSION` to 24 in `packages/core/src/config/shipped-defaults.ts` with a history comment
- [x] T009 [MAIN] Add SVG shapes for `attention`, `attentionFailed` and `goToPanel` to `SVG_SHAPES` in `packages/ui/src/main/icon-pack-service.ts`

### Mark model (CORE)

- [x] T010 [P] [CORE] Write failing tests in `packages/core/tests/unit/attention-model.test.ts` with an injected clock: raise creates a mark; a raise on an attended panel is ignored (FR-004, focused panel in a focused window, judged at the raise); repeat raise replaces reason and makes the kind sticky Failed (FR-002); `panelFocused` clears (FR-005); a mark existing when its panel becomes active is armed and clears after `clearDelayMs` of continuous activity in a focused window (FR-006); a mark raised while the panel is already active and unfocused is NOT cleared by the dwell, and is cleared by the next "becomes active" dwell or a focus; window refocus does not arm; losing active restarts the dwell; `withdraw('terminal')` clears all (FR-008, FR-063); panel destroyed and project deleted clear (FR-007); `clearDelayMs: 0` clears on becoming active
- [x] T011 [CORE] Implement `packages/core/src/attention/attention-model.ts` (pure, immutable state plus events out: `marksChanged`, `markCleared(panelId)`) to pass T010
- [x] T012 [P] [CORE] Write failing tests in `packages/core/tests/unit/attention-holders.test.ts`: holder kind for a set of panel ids (Failed wins, FR-014); per-project aggregation including unloaded projects (FR-012); category aggregation including rows a minimised category hides (FR-013); badge count and label ("9+" above 9, FR-039); tooltip lines `<Panel> — <project>: <reason>[ '<detail>'] (<Kind>)` for several marks (FR-015)
- [x] T013 [CORE] Implement `packages/core/src/attention/attention-holders.ts` to pass T012

### Scanner (CORE)

- [x] T014 [P] [CORE] Write failing tests in `packages/core/tests/unit/attention-scan.test.ts` for research R2's grammar: BEL outside OSC is a bell; BEL terminating an OSC is not; OSC 9 text is a notification; `9;9;…`, `9;4;…` and any `^\d+(;|$)` payload is not (FR-060a); 9;4 set→remove is progress completed (Attention), 9;4;2 is error (Failed), a bare remove is nothing; OSC 777 notify with title and body; OSC 99 final chunk with `p=title`/`p=body`; ESC \ terminator; sequences split across chunks; an unterminated OSC beyond 4 KB is dropped; sanitising per FR-068 (control characters stripped, one line, 200 characters with ellipsis, empty becomes null)
- [x] T015 [CORE] Implement `packages/core/src/terminal/attention-scan.ts` (stateful per session, `scan(chunk) → AttentionHit[]`, fast path on `indexOf(0x07)` / `indexOf('\x1b]')`) to pass T014
- [x] T016 [P] [CORE] Add a benchmark test `packages/core/tests/unit/attention-scan.bench.test.ts` measuring 10 MB of mixed output with and without 1,000 bells per 64 KB, asserting the scanner's per-MB cost stays under a stated bound and recording the numbers in the test output (SC-004, Principle XII)

### OS ports (CORE)

- [x] T017 [P] [CORE] Create `packages/core/src/abstractions/system-notifier.ts` (`ISystemNotifier`, `NoSystemNotifier`) and `packages/core/src/abstractions/taskbar-badge.ts` (`ITaskbarBadge`, `NoTaskbarBadge`) per contracts/app-attention.md, exported from `packages/core/src/index.ts`

**Checkpoint**: settings, tokens, model, holders, scanner and ports exist and are unit-tested.

---

## Phase 3: User Story 1 — See which project needs me (P1) 🎯 MVP

**Goal**: a bell in a background project's terminal marks its project row (and minimised category
header); focusing the panel clears it. Includes the daemon producer pipeline every later story uses.

**Independent test**: spec US1 "Independent Test".

- [x] T018 [US1] Write failing daemon integration tests in `packages/daemon/tests/integration/terminal-attention.integration.test.ts` (real `TerminalService`, fake PTY host): a BEL chunk publishes one `terminal.attention` `{ signal: 'bell', projectId }`; a burst of 1,000 BELs in 250 ms publishes one (R3); with `terminal.attentionConfig { enabled: false }` nothing is published and the scanner does not run; a switched-off signal is not published; the signal carries `panelTitle` (core `panelDisplayTitle` over the panel's stored layout, "Terminal" when absent) and `projectName`; a bell, a notification and a progress end are each published with no view attached to the terminal (FR-067a); the bytes published on `terminal.output` are identical with attention on and off (FR-067) [CORE]
- [x] T019 [US1] Wire the scanner into the output handler in `packages/daemon/src/terminal-service.ts` (per-session scanner state, rate limiter at 250 ms per panel per signal, config held in the service) and register `terminal.attentionConfig` in `packages/daemon/src/ipc-server.ts`; publish through `packages/daemon/src/terminal-events.ts` [CORE]
- [x] T020 [US1] Write failing tests in `packages/ui/tests/unit/attention-service.test.ts` with a fake clock, fake notifier, fake badge and a fake broadcast: a signal for an unattended panel creates a mark and broadcasts `throng:attention:changed`; a focus report naming that panel as focused in a focused window clears it; a signal for the attended panel is ignored; producer config is pushed on connect and on a `terminals.attention.*` change; a FocusReport hosting a marked panel under another project moves the mark's `projectId` and replaces its title; a panel destroy or project delete clears its marks without notifying (FR-007); with default settings, a transcript of typing, completion bells, prompt redraws and short commands in the focused panel of a focused window yields zero marks (SC-003, US4 AS5) [MAIN]
- [x] T021 [US1] Implement `packages/ui/src/main/attention-service.ts` (drives the core model, receives `terminal.attention` from `packages/ui/src/main/daemon-events.ts`, handles `throng:attention:focus`, broadcasts via `broadcastToWindows`, pushes `terminal.attentionConfig`), and construct and bind it in `packages/ui/src/main/composition-root.ts` / `packages/ui/src/main/tokens.ts` [MAIN]
- [x] T022 [US1] Expose the preload `attention` namespace (`onChanged`, `reportFocus`, `onToast`, `onFocusPanel`, `goTo`, `onBadgeRequest`) in `packages/ui/src/preload/preload.cts` per contracts/app-attention.md [MAIN]
- [x] T023 [P] [US1] Write failing component tests in `packages/ui/tests/component/attention-focus-reporter.test.ts`: the reporter sends one coalesced `FocusReport` per frame with the focused panel (null when focus is in the Files or Projects pane), each shown tab's active panel, hosted panels as `{ panelId, projectId, title }` (the renderer's display title) and window focus [UI]
- [x] T024 [US1] Implement `packages/ui/src/renderer/attention/attention-store.ts` (module store fed by `attention.onChanged`), `packages/ui/src/renderer/attention/use-attention.ts` (value-compared selectors `usePanelMark`, `useMarkForPanels`, `useProjectMarkKey`, `useCategoryMark`), and `packages/ui/src/renderer/attention/focus-reporter.tsx`, mounted in both `packages/ui/src/renderer/composition-root.tsx` roots [UI]
- [x] T025 [P] [US1] Write failing component tests in `packages/ui/tests/component/attention-mark.test.ts` for `AttentionMark`: Attention and Failed icons by token, accessible name and tooltip from `attention-holders` (FR-015), not colour alone (FR-016), visibly distinct from `.throng-unsaved-dot` and able to sit beside it (FR-017) [UI]
- [x] T026 [US1] Implement `packages/ui/src/renderer/attention/attention-mark.tsx` and its CSS in `packages/ui/src/renderer/theme.css` (`var(--throng-colour-attentionMark)` / `attentionFailedMark`, legible on a selected project row's colour fill per FR-017) [UI]
- [x] T027 [US1] Write failing component tests in `packages/ui/tests/component/projects-panel-attention.test.ts`: a marked project row shows the mark (active, loaded and unloaded-with-running-terminals styles); a minimised category header marks for a hidden marked row and for a visible one (FR-013); Failed wins on the row (US1 AS7) [UI]
- [x] T028 [US1] Render the mark on project rows and category headers in `packages/ui/src/renderer/sidebar/projects-panel.tsx` [UI]
- [x] T029 [US1] Write failing daemon integration tests in `packages/daemon/tests/integration/terminal-attention-ledger.integration.test.ts`: `terminal.attentionSync` replaces the ledger; a BEL, a notification and an unexpected non-zero exit (kind Failed) while no events sink is attached are each stored `whileDetached` and returned by `terminal.attentionLedger`, then the flag clears; `terminal.kill`, `killAll` and project delete drop entries; the ledger caps at 1,000 (FR-066, FR-091) [CORE]
- [x] T030 [US1] Implement the ledger and the two RPCs in `packages/daemon/src/terminal-service.ts` and `packages/daemon/src/ipc-server.ts` [CORE]
- [x] T031 [US1] Extend `packages/ui/tests/unit/attention-service.test.ts` with failing cases: on connect the service reads the ledger and restores marks without notifications (FR-038); the mark set is synced to the daemon debounced at 250 ms; then implement them in `packages/ui/src/main/attention-service.ts` [MAIN]

**Checkpoint**: US1 works end to end for the bell.

---

## Phase 4: User Story 2 — Which tab and which panel (P1)

**Independent test**: spec US2 "Independent Test".

- [x] T032 [P] [US2] Write failing component tests in `packages/ui/tests/component/panel-box-attention.test.ts`: a marked panel's header shows the mark for every panel type, and the mark is absent once cleared (FR-003) [UI]
- [x] T033 [US2] Render the mark in the panel header in `packages/ui/src/renderer/workspace/panel-placeholder.tsx` [UI]
- [x] T034 [P] [US2] Write failing component tests in `packages/ui/tests/component/tab-chip-attention.test.ts`: a tab chip marks while any of its panels is marked (FR-010); the left/right overflow control shows a marked-hidden indicator alongside its count when a marked tab is scrolled out on that side (FR-011); the tab picker and tab popover mark their rows; a 200-tab strip recompute stays within a stated long-task bound (Principle XII) [UI]
- [x] T035 [US2] Render the mark on `TabChip` and the overflow controls in `packages/ui/src/renderer/workspace/tab-group.tsx` (reusing `syncStrip`'s measurement to know which side hides each tab), and on rows in `packages/ui/src/renderer/workspace/tab-picker.tsx` and `packages/ui/src/renderer/workspace/tab-popover.tsx` [UI]
- [x] T036 [US2] Add `packages/ui/tests/unit/attention-mark-call-sites.test.ts` (modelled on `unsaved-dot-call-sites.test.ts`) so every holder site renders `AttentionMark` with the same title, label and testid shape, and an unlisted site fails [UI]

---

## Phase 5: User Story 3 — Be told when I am looking elsewhere (P1)

**Independent test**: spec US3 "Independent Test".

- [x] T037 [P] [US3] Write failing contract tests in `packages/ui/tests/contract/system-notifier.contract.test.ts` and `packages/ui/tests/contract/taskbar-badge.contract.test.ts`, run against the no-op and the recording fake: show/close/click round-trip; set/clear [MAIN]
- [x] T038 [US3] Implement `packages/ui/src/main/electron-system-notifier.ts` (Electron `Notification`) and `packages/ui/src/main/electron-taskbar-badge.ts` (`setOverlayIcon` on every window with a taskbar button, with the FR-039 description), bind them in `packages/ui/src/main/composition-root.ts` with recording fakes under `THRONG_E2E_ATTENTION_OS=record`, and call `app.setAppUserModelId('com.throng.throng')` at startup in `packages/ui/src/main/main.ts` [MAIN]
- [x] T039 [US3] Extract the restore/show/focus sequence (`main.ts:666-682`) into `packages/ui/src/main/window-raise.ts` with a unit test `packages/ui/tests/unit/window-raise.test.ts`, and replace the inline copies in `packages/ui/src/main/main.ts` [MAIN]
- [x] T040 [US3] Extend `packages/ui/tests/unit/attention-service.test.ts` with failing cases for delivery (FR-030–FR-032): `inApp` → toast; `os` → OS notification when no window is focused, else toast; `both` → toast and, when no window is focused, OS notification; `attention.osNotifications: false` downgrades `os` to `inApp`; one toast and one OS notification per panel, updated on a repeat raise (FR-035); a clear dismisses the toast and closes the OS notification (FR-036); the toast goes to the focused window, else the main window; then implement them in `packages/ui/src/main/attention-service.ts` [MAIN]
- [x] T041 [US3] Extend `packages/ui/tests/unit/attention-service.test.ts` with failing cases for the badge (FR-039): the count across all projects, Failed style when any is Failed, cleared at zero, unaffected by delivery and the OS switch, off when `attention.taskbarBadge` is false, restored marks counted; then implement them, requesting the image over `throng:attention:badgeImage` [MAIN]
- [x] T042 [P] [US3] Write failing component tests in `packages/ui/tests/component/attention-toasts.test.ts`: a `raise` op calls `notify` with `instanceKey: 'attention:<panelId>'`, severity `info` (Attention) or `error` (Failed) per FR-037, the subject through `formatSubject`, and a `goToPanel` `IconButton` with a title in the tab order (030 FR-032b), Dismiss still present (030 FR-060); `update` patches the same card; `dismiss` removes it; two panels give two toasts [UI]
- [x] T043 [US3] Implement `packages/ui/src/renderer/attention/attention-toasts.tsx`, mounted beside `NotificationProvider` in both roots of `packages/ui/src/renderer/composition-root.tsx` [UI]
- [x] T044 [P] [US3] Write failing unit tests in `packages/ui/tests/unit/attention-badge-renderer.test.ts` (jsdom canvas stub): the renderer draws the count ("9+" above 9) with the theme's mark colour for the kind and returns a PNG data URL [UI]
- [x] T045 [US3] Implement `packages/ui/src/renderer/attention/badge-renderer.ts` and answer `attention.onBadgeRequest` in the main window (a sub-workspace window when the main window is closed) [UI]
- [x] T046 [US3] Extend `packages/ui/tests/unit/attention-service.test.ts` with failing cases for `goTo(panelId)` (FR-034, FR-080a): a panel hosted by a sub-workspace window raises that window and sends `throng:attention:focusPanel`; otherwise the main window is raised and told to switch project; a panel that no longer exists only dismisses the notification; an OS notification click calls `goTo`; then implement them using `window-raise.ts` [MAIN]
- [x] T047 [P] [US3] Write failing component tests in `packages/ui/tests/component/attention-focus-panel.test.ts`: `onFocusPanel` for a panel in the current layout calls `focusLocalPanel` and the panel takes focus (clearing its mark through the focus report); for another project, including one in a minimised category, it calls `switchProject`, waits for the layout, then focuses the panel, and the category stays minimised (FR-080a) [UI]
- [x] T048 [US3] Implement the `onFocusPanel` handler in `packages/ui/src/renderer/attention/attention-navigation.ts`, mounted in both roots [UI]

---

## Phase 6: User Story 4 — Choose what raises a mark (P1)

**Independent test**: spec US4 "Independent Test".

- [x] T049 [P] [US4] Write a failing test `packages/core/tests/unit/settings-inertness-057.test.ts` (pattern `settings-inertness-054.test.ts`): each of the 14 keys is read by the code that governs it [CONFIG]
- [x] T050 [US4] Extend `packages/daemon/tests/integration/terminal-attention.integration.test.ts` with failing cases for Unseen output and Output went quiet (R4): `unseenOutput` emits on the first chunk after at least 1 s without output; `outputQuiet` emits once output has been silent for `quietMs` after activity, and is measured afresh after each burst; neither is emitted while switched off; then implement both in `packages/daemon/src/terminal-service.ts` [CORE]
- [x] T051 [US4] Extend `packages/ui/tests/unit/attention-service.test.ts` with failing cases: switching `terminals.attention.enabled` off withdraws every terminal mark and dismisses their notifications (FR-063); switching one signal off keeps existing marks (US4 AS4); then implement them [MAIN]
- [x] T052 [P] [US4] Write failing component tests in `packages/ui/tests/component/preferences-attention.test.ts`: the Attention group and the Terminal › Attention subgroup list every setting with its description; the per-signal toggles are disabled while the master switch is off [UI]

---

## Phase 7: User Story 5 — Know when a long-running command finishes (P2)

**Independent test**: spec US5 "Independent Test".

- [x] T053 [US5] Extend `packages/daemon/tests/integration/terminal-attention.integration.test.ts` with failing cases (fake process observer): command → null publishes `commandFinished` with the command name (FR-065); command → command publishes nothing; the first command → null after a launch with a startup command carries `startup: true` (FR-065a); a `terminal.write` before that clears the startup flag; a terminal with no view attached anywhere is still observed while an events sink is attached (FR-062 regression guard); then implement them in `observeCommand` and the launch path of `packages/daemon/src/terminal-service.ts` [CORE]
- [x] T054 [US5] Extend `packages/ui/tests/unit/attention-service.test.ts` with a failing case: a `startup: true` signal raises the mark and counts on the badge but raises no toast and no OS notification (FR-038a); a later signal on the same panel notifies as usual; then implement it [MAIN]

---

## Phase 8: User Story 6 — Know when a terminal ends (P2)

**Independent test**: spec US6 "Independent Test".

- [x] T055 [US6] Extend `packages/daemon/tests/integration/terminal-attention.integration.test.ts` with failing cases: an exit with `unexpected: true` publishes `processExited` with the code, kind Failed for non-zero and Attention for zero; every throng-initiated end (`terminal.kill`, `killAll`, `killForProject`, app-close terminate all, `shutdown`) publishes nothing (FR-064); `terminal.exit` is unchanged; then implement it in `handleExit` in `packages/daemon/src/terminal-service.ts` [CORE]
- [x] T056 [US6] Write a failing component test in `packages/ui/tests/component/terminal-exit-attention.test.ts`: focusing an exited, marked panel clears the mark and leaves 005's exit notice as it is (US6 AS3) [UI]

---

## Phase 9: User Story 7 — Jump to what needs me (P3)

**Independent test**: spec US7 "Independent Test".

- [x] T057 [P] [US7] Write failing tests in `packages/core/tests/unit/attention-next.test.ts` for `nextMarkedPanel(position, order, marks)`: project-list order, then tab order, then panel order, after the current position, wrapping round; sub-workspace panels after their project's layout panels; none marked returns null (FR-080) [CORE]
- [x] T058 [US7] Implement `packages/core/src/attention/attention-next.ts` [CORE]
- [x] T059 [CONFIG] Add `focus.nextMarkedPanel` to `packages/core/src/config/keybindings.ts` (`ActionId`, `COMMAND_SCOPES` EVERYWHERE, `WINDOWS_BINDINGS` `Ctrl+Shift+Alt+G`, `WINDOW_HANDLED_ACTIONS`, `ACTION_TIER` tier 1) and its entry in `packages/core/src/config/keybindings-metadata.ts` (group "Navigate", label "Go to Next Marked Panel"); update the pinned tables in `packages/core/tests/unit/keybindings-tiers.test.ts` and `keybindings-048.test.ts`; claim the chord in `packages/ui/tests/shared/window-chords.ts`; run `keybindings-collision.test.ts`, `terminal-reserved-keys.test.ts`, `window-chord-manifest.test.ts`, `scope.test.ts`
- [x] T060 [P] [CONFIG] Audit Ctrl+Shift+Alt+G against the AltGr+Shift fourth level on the US, UK, German, French and Polish layouts (046 R22's method), record the result in research.md R15, and add the row plus the disclosure line to `docs/key-bindings.md`; run `docs-currency.test.ts`
- [x] T061 [P] [US7] Write failing component tests in `packages/ui/tests/component/attention-next-command.test.ts`: the command focuses the next marked panel in the current project, or switches project and then focuses; with nothing marked it does nothing and raises no notice (US7 AS2); a press in a terminal reaches the dispatcher [UI]
- [x] T062 [US7] Implement the `focus.nextMarkedPanel` case in `packages/ui/src/renderer/keybindings/window-dispatcher.tsx` using `attention-next.ts` and `attention-navigation.ts` [UI]
- [x] T063 [US7] Write a failing component test in `packages/ui/tests/component/cog-menu-next-marked.test.ts` (the row is listed in the cog menu's Application section, shows its chord, is disabled with zero marks and enabled with one, and runs the command), then add the cog-menu row "Go to Next Marked Panel" (icon token `attention`, shows its chord via `firstBinding`, disabled while nothing is marked) to `packages/ui/src/renderer/title-bar/cog-menu-items.ts`, and amend the pinned cog shape in `packages/ui/tests/unit/menu-sections.test.ts` (five Application items to six) and `menu-icon-tokens.test.ts` as a recorded supersession (FR-082) [UI]

---

## Phase 10: Polish & cross-cutting

- [x] T064 [P] Write the E2E spec `packages/ui/tests/e2e/attention-marks.e2e.ts` (`@extended @terminal`, serial tier, own app): a delayed bell in project A's terminal while in project B marks A's row within 1 s of the bell (SC-002) and raises one in-app toast; activating the toast's link lands on A's terminal and the mark clears. OS delivery is not asserted here, because a test cannot rely on the window being unfocused; T040 covers it. Re-seed `packages/ui/tests/e2e/e2e-budget.json` and register the spec in `packages/ui/tests/e2e/parallel-plan.json` if it drives a real shell [UI]
- [x] T065 Add a daemon integration measurement to `packages/daemon/tests/integration/terminal-attention.integration.test.ts`: output throughput for 10 s of a 1,000/s bell storm with attention on versus off, asserting the difference is within a stated noise bound and that one signal is published (SC-004) [CORE]
- [x] T066 [P] Update `docs/architecture.md` (the `terminal.attention` notification, the daemon ledger, main's attention service and the two OS ports), `docs/quick-start.md` (a tour line, and how to make a program such as Claude Code ring the bell or notify, linking to its own documentation rather than copying it), and `README.md` (one feature line); run `docs-currency.test.ts` [CONFIG]
- [x] T067 Run `quickstart.md`'s automated section and fix anything it finds

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2 → stories.** T001 blocks everything typed. T004 blocks T005 and every
  settings reader. T011, T013 and T015 block US1.
- **US1 (Phase 3) blocks US2–US7.** It builds the daemon → main → renderer pipeline.
- **US2 and US3** are independent of each other after US1. **US4–US6** extend the daemon and service
  and are independent of each other. **US7** needs US3's navigation (T048).
- **Phase 10** after all stories.

## Parallel Opportunities

- Phase 2: T003 (CONFIG), T007 (CONFIG, different files), T010/T012/T014 (CORE tests), T017.
- Within US1: T023 and T025 (different component test files) while T019/T021 proceed.
- Across boundaries, the step-7 agents work concurrently: CORE (daemon tasks), MAIN (service),
  UI (holders), CONFIG (keybindings, docs).

## Implementation Strategy

MVP is US1 (a bell marks the project row, across a closed window). Then US2 and US3 make it usable
day to day, US4 makes it controllable, and US5–US7 add the remaining signals and navigation. Each
phase ends green on the tests covering it. The short gates run once at the end.

---

## Phase 11: Convergence

- [x] T068 Send the current mark set to a window when its renderer finishes loading (main, `packages/ui/src/main/attention-service.ts` + `main.ts`), and have the renderer store pull the current set when its bridge registers (`packages/ui/src/renderer/attention/attention-store.ts`, preload `attention.getMarks`), so a window opened, torn off or reloaded after marks were raised shows them per FR-066, FR-091, FR-012, US1/AC4 (partial)
- [x] T069 Re-request the taskbar badge image when a window's badge answerer registers or its renderer loads, and retry after a null reply, so restored marks are counted on the badge per FR-039, US3/AC7 (partial)
- [x] T070 Raise Output went quiet only when output arrived while the panel was unattended (the daemon's quiet signal carries the activity time; main checks the panel was unattended then) per FR-060 Terminal signals table (partial)
- [x] T071 Order marked panels in a project the window has not loaded by that project's layout once it is switched to, not by raise time, per FR-080, research R14 (partial)

---

## Phase 12: Iterate 2026-10-19 — the mark in the dot's place, blinking (FR-092 – FR-094)

From hand-testing MT-01 (spec Session 2026-10-19). Renderer only.

- [x] T072 [US1] Test first: in `packages/ui/tests/component/projects-panel-attention.test.ts`, a marked row shows its mark inside `.project-item__switch` where `.project-item__dot` was, the dot is absent while marked and back once the mark clears, and the unsaved dot stays in the name row (FR-092, US1/8); the existing "beside the unsaved dot's slot" placement test is superseded by it
- [x] T073 [US1] Show the mark in place of the colour dot on every marked row in `packages/ui/src/renderer/sidebar/projects-panel.tsx` (a `ProjectRowLead` holder in `packages/ui/src/renderer/attention/holder-marks.tsx` that renders the mark or the dot), keeping the surface-active backing disc on the highlighted row for FR-017 legibility (FR-092)
- [x] T074 [US2] Test first: in `packages/ui/tests/unit/attention-mark-css.test.ts`, `.throng-attention-mark` animates `opacity` only on a 2 s cycle (slower than `.throng-unsaved-dot`'s), and a `prefers-reduced-motion: reduce` block stops it at full opacity (FR-093, US2/6)
- [x] T075 [US2] Blink every mark slowly in `packages/ui/src/renderer/theme.css`, still under reduced motion (FR-093)
- [x] T076 [US1] Test first, in `packages/ui/tests/unit/attention-mark-css.test.ts`: the highlighted row's colour dot is ringed at least 2px in the row's contrast colour (`currentColor`, which 046 FR-072a sets to black or white); then thicken the ring in `packages/ui/src/renderer/theme.css` (FR-094, US1/9)

---

## Phase 13: Iterate 2026-10-19, round 2 — clear on focus, hover popovers (FR-095 – FR-098)

From hand-testing (spec Session 2026-10-19, round 2). One defect against FR-092, four additions.

- [x] T077 [US1] Test first: in `packages/core/tests/unit/attention-model.test.ts`, a mark whose panel becomes active (tab or project switch) without focus is NOT cleared however long it stays active; it clears once its panel has been the focused panel in a focused window continuously for `clearDelayMs`; losing focus before then restarts the delay; `clearDelayMs: 0` clears on focus; superseded FR-005 / FR-006 cases are rewritten to FR-095 (FR-095, US1/10)
- [x] T078 [US1] Count the clear delay from focus, not from being active, in `packages/core/src/attention/attention-model.ts`, and retire the `armed` field from `AttentionMark` in `packages/core/src/attention/attention-types.ts` (FR-095)
- [x] T079 Describe the clear delay as focus time in `packages/core/src/config/settings-metadata.ts` (`attention.clearDelayMs`), `docs/preferences.md` (Attention) and `docs/architecture.md` (Attention marks) (FR-095)
- [x] T080 [US1] Defect against FR-092: the project-row mark must occupy exactly the colour dot's box (10 × 10 px, no margin) so marking a row never moves its text — test first in `packages/ui/tests/unit/attention-mark-css.test.ts`, then `packages/ui/src/renderer/theme.css` (FR-092)
- [x] T081 [US2] Test first, then drop the native tooltip from a panel header's mark, keeping its accessible name, in `packages/ui/src/renderer/attention/attention-mark.tsx` and `packages/ui/src/renderer/attention/holder-marks.tsx`; cover in `packages/ui/tests/component/panel-box-attention.test.ts` (FR-096, US2/7)
- [x] T082 [US1] Test first, then a hover/keyboard-focus popover on a project row's mark, modelled on `packages/ui/src/renderer/workspace/tab-popover.tsx` (portaled, `clampToViewport`, held invisible until placed, `pointer-events: none`, registered in `floating-surfaces.test.ts`): one line per marked panel in layout order with its kind's icon, name and reason, replacing the row mark's native tooltip; new `packages/ui/src/renderer/attention/attention-popover.tsx`, `packages/ui/tests/component/attention-popover.test.ts` (FR-097, US1/11)
- [x] T083 [US1] Test first, then the same popover on a category header's mark, grouped by project in list order, in `packages/ui/src/renderer/attention/attention-popover.tsx` and `packages/ui/src/renderer/attention/holder-marks.tsx` (FR-098, US1/12)
- [x] T084 [US3] Test first: in `packages/core/tests/unit/negotiation-scan.test.ts`, `scanKeyboardNegotiation` records DEC 1004 as `focusReporting` (on at `CSI ?1004h`, off at `CSI ?1004l`, among other modes in one sequence, split across chunks); then add the field in `packages/core/src/terminal/negotiation-scan.ts` (FR-099)
- [x] T085 [US3] Test first: in `packages/daemon/tests/integration/terminal-attention.integration.test.ts`, a new `terminal.attentionFocus { attended: string[] }` RPC makes the daemon write `CSI O` to a session with 1004 on when it leaves the attended set and `CSI I` when it returns, never the same state twice, nothing when 1004 is off, and `CSI O` at once when a program turns 1004 on while unattended; the writes do not clear `startupPending`; then implement in `packages/daemon/src/terminal-service.ts` / `packages/daemon/src/terminal-attention.ts` and `packages/ipc-contract/src/terminal.ts` (FR-099)
- [x] T086 [US3] Test first: in `packages/ui/tests/unit/attention-service.test.ts`, main sends `terminal.attentionFocus` with the full attended set whenever it changes (focus report, window focus change, window close) and on daemon (re)connect; then implement in `packages/ui/src/main/attention-service.ts` (FR-099)
- [x] T087 [US3] Stop the view forwarding xterm's own `CSI I` / `CSI O` in `packages/ui/src/renderer/terminal/use-terminal.ts` (the daemon is the one source, FR-099), with a unit or component test pinning that the view drops them; update `docs/architecture.md` (Attention marks) for the new RPC (FR-099)

---

## Phase 14: Iterate 2026-10-19, round 3 — names, wording, toasts, cycling (FR-100 – FR-106)

From hand-testing (spec Session 2026-10-19, round 3). One defect against FR-092, seven additions.

- [x] T088 [US1] Test first, then per-kind toast display settings `attention.toasts.{attention,failed}.{mode,timeoutMs}` in `packages/core/src/config/app-settings.ts` and `settings-metadata.ts`, read by `packages/ui/src/renderer/attention/attention-toasts.tsx` through the notice `display` override; documented in `docs/preferences.md` (FR-103)
- [x] T089 [US1] Test first, then describe a bell as "Wants your attention" in `packages/core/src/attention/attention-holders.ts` (FR-101)
- [x] T090 [US1] Test first, then carry `tabTitle` and `doing` on every signal, mark and ledger entry: the daemon resolves the tab with the panel's names (`packages/daemon/src/composition-root.ts`) and captures `doing` (the program's window title, else the terminal's last command) at raise time (`packages/daemon/src/terminal-service.ts`, `terminal-attention.ts`); the model keeps both and a hosted panel refreshes `tabTitle` (`packages/core/src/attention/attention-model.ts`, `attention-types.ts`) (FR-100, FR-102)
- [x] T091 [US1] Test first, then show `doing` after the reason in toasts and Windows notifications, left out when unknown or already the reason's detail, in `packages/ui/src/main/attention-service.ts` and a core formatter in `attention-holders.ts` (FR-102)
- [x] T092 [US1] Test first, then each popover line reads "Tab › Panel" and the reason with `doing`, in `packages/ui/src/renderer/attention/attention-popover.tsx`; the renderer's focus report carries each hosted panel's tab title (`focus-reporter.tsx`) (FR-100, FR-102)
- [x] T093 [US2] Test first, then the FR-097 popover on a tab-strip overflow control's mark, listing that side's hidden marked panels (FR-104)
- [x] T094 [US1] Defect against FR-092: the project-row mark's glyph must fit the colour dot's square exactly — nothing drawn outside it — in `packages/ui/src/renderer/theme.css`, with `attention-mark-css.test.ts`
- [x] T095 [US1] Test first, then clicking a project row's or category header's mark goes to its next marked panel, wrapping (FR-105)
- [x] T096 [US1] Test first, then remove Go to Next Marked Panel from the cog menu and offer it in a marked project's context menu with its chord (FR-106, superseding FR-082); update the cog menu's pinned rows and `docs/key-bindings.md` if it names the cog row
- [x] T097 Extend the manual test plan with groups for FR-100 – FR-106 and the FR-092 defect

---

## Phase 15: Iterate 2026-10-19, round 4 — notifications in one place, announce once (FR-107 – FR-112)

From hand-testing (spec Session 2026-10-19, round 4). One defect against FR-092, six additions.

- [x] T098 [US1] Defect against FR-092, with FR-107: the project-row mark takes the colour dot's box with no rounding, clipping or backing, and the layout is unchanged; on the selected row it is drawn in the row's contrast colour, in `packages/ui/src/renderer/theme.css`, with `attention-mark-css.test.ts`
- [x] T099 [US3] Test first, then announce a mark once: a later raise on a panel still marked updates the mark and any toast still showing, silently, and raises no new toast or Windows notification, in `packages/ui/src/main/attention-service.ts` (FR-112)
- [x] T100 Test first, then the settings model: `notifications.os`, `notifications.<severity>.os` and `notifications.attention.{mode,timeoutMs,os}` with defaults and a tolerant parse, retiring the unreleased `attention.delivery.*`, `attention.toasts.*` and `attention.osNotifications`, in `packages/core/src/notice/display-mode.ts`, `packages/core/src/config/app-settings.ts` and `settings-metadata.ts` (descriptors carry a shared row); inertness test; `docs/preferences.md` (FR-108 – FR-111)
- [x] T101 [US4] Test first, then the Notifications rows: descriptors sharing a row render on one line — display mode, duration (inert unless Display for), Also in the OS — with one Reset / Revert for the row, the global OS switch above them, and 030 FR-008's consent intact, in `packages/ui/src/renderer/preferences/settings-tab.tsx` (FR-108, FR-109)
- [x] T102 [US3] Test first, then ordinary notices reach the OS: a notice of a type with OS on is also sent to main, which raises a Windows notification through `ISystemNotifier` while no throng window is focused and the global switch is on; activating it brings throng forward; the FR-008 consent text says so (FR-110)
- [x] T103 [US3] Test first, then attention reads `notifications.attention` and `notifications.os` for both kinds of mark, in `packages/ui/src/main/attention-service.ts` and `packages/ui/src/renderer/attention/attention-toasts.tsx` (FR-111)
- [x] T104 Extend the manual test plan with groups for FR-107 – FR-112, and rework MT-03, MT-05 and MT-14 for the moved settings

---

## Phase 16: Iterate 2026-10-20, round 5 — OS Notify (FR-113)

- [x] T105 [US4] Test first, then label each row's OS switch **OS Notify**, describe when it shows, and make it inert (greyed, label too, value kept) while `notifications.os` is off, in `packages/core/src/config/settings-metadata.ts`, `packages/ui/src/renderer/preferences/settings-tab.tsx` and `preferences.css`; `docs/preferences.md`; the manual plan's MT-17 (FR-113)

---

## Phase 17: Iterate 2026-10-20, round 6 — a bigger flag, plainer notifications (FR-114, FR-115)

- [x] T106 [US1] Test first, then draw the project-row glyph at 16 × 16 over the dot's unchanged 10 × 10 slot, in `packages/ui/src/renderer/theme.css` with `attention-mark-css.test.ts`; MT-09 (FR-114)
- [x] T107 [US3] Test first, then head toasts and Windows notifications with the panel title over "Wants your attention" (Failed: what failed), with no kind or project, in `packages/core/src/attention/attention-holders.ts` (`notificationText`), `packages/ui/src/main/attention-service.ts` and `packages/ui/src/renderer/attention/attention-toasts.tsx`; MT-03 (FR-115)

---

## Phase 18: Iterate 2026-10-20, round 7 — the live title, and the detail back (FR-116)

- [x] T108 [US3] Defect against FR-115, with FR-116: test first, then name a mark with the panel header's live title at the raise — the hosting window's, else the daemon's from the terminal's live window title — and add the program's message and what the terminal was doing to the notification text, in `packages/core/src/attention/attention-model.ts`, `attention-holders.ts`, `packages/daemon/src/terminal-attention.ts`, `terminal-service.ts` and `composition-root.ts`; MT-03 (FR-116)

---

## Phase 19: Iterate 2026-10-20, round 8 — one line under the title (FR-117)

- [x] T109 [US3] Test first, then make a notification's text one line — the program's message, "<command> has finished", or "Wants your attention" (Failed: what failed) — in `packages/core/src/attention/attention-holders.ts` (`notificationText`); MT-03 (FR-117)

---

## Phase 20: Iterate 2026-10-21, round 9 — marked headers, popover layout, fuller notification heading

- [x] T110 [US2] Test first, then fill a marked panel's header with its mark's colour, in `packages/ui/src/renderer/workspace/panel-placeholder.tsx` (`data-attention`) and `theme.css`; MT-20 (FR-118)
- [x] T111 [US1] Test first, then lay a mark's popover out as "Tab - Title" over the indented notification line, with rules between entries and projects, in `packages/ui/src/renderer/attention/attention-popover.tsx` and `theme.css`; MT-11 (FR-119)
- [x] T112 [US3] Test first, then head toasts and Windows notifications "Project — Tab — Title", in `packages/ui/src/main/attention-service.ts` and `packages/ui/src/renderer/attention/attention-toasts.tsx`; MT-03 (FR-120)

---

## Phase 21: Iterate 2026-10-21, round 10 — popover icon placement, toast go-to placement

- [x] T113 [US1] Test first, then pin a popover entry's icon to the top of the entry, in `packages/ui/src/renderer/theme.css`; MT-11 (FR-121)
- [x] T114 [US3] Test first, then give a notice its own `controls` before Copy and Dismiss and move the toast's go-to there, in `packages/ui/src/renderer/common/notification.tsx`, `packages/ui/src/renderer/attention/attention-toasts.tsx` and `theme.css`; MT-03 (FR-122)

---

## Phase 22: Iterate 2026-10-21, round 11 — no native tooltip on a mark; Claude Code's idle threshold

- [x] T115 [US2] Test first, then drop the mark's native `title` on every holder, in `packages/ui/src/renderer/attention/attention-mark.tsx` and `holder-marks.tsx`; MT-02 (FR-123)
- [x] T116 [US3] Document Claude Code's `messageIdleNotifThresholdMs` for a notification as Claude finishes, in `docs/quick-start.md`

---

## Phase 23: Iterate 2026-10-24, round 12 — manual Flag, numbered marks, toast body link, announce once (FR-124 – FR-134)

From issues #522, #523, #524, #525 (spec Session 2026-10-24, round 12; plan *Round 12 addendum*; research R18 – R22). One defect (#524, against FR-112 / FR-134), eleven new requirements. Boundaries: [CORE] core + main, [DAEMON] persistence + daemon + ipc-contract, [UI] renderer.

### Defect

- [x] T117 [US3] [CORE] Defect #524 against FR-112 / FR-134: test first in `packages/ui/tests/unit/attention-service.test.ts` — a mark restored from the ledger, then raised again while unattended, raises no toast and no `notifier.show`; same for a startup-command mark (red today), and for a terminal raise on a manually flagged panel — then announce only when the raise created the mark and drop the `announced` set, in `packages/ui/src/main/attention-service.ts` (R21)

### Core and main

- [x] T118 [CORE] Test first, then widen `AttentionMark.producer` to `'terminal' | 'user'` and add `heldSinceRaise`; `AttentionModel.flag()` (no-op on a marked panel), `restoreFlags()` (unheld), the held dwell in `settle()`, and `ledgerEntries()` returning terminal marks only, in `packages/core/src/attention/attention-types.ts` and `attention-model.ts`, with `packages/core/tests/unit/attention-model.test.ts` (FR-125, FR-127, R20)
- [x] T119 [P] [CORE] Test first, then holder state carries `count` (marked panels beneath; `9+` is the renderer's), in `packages/core/src/attention/attention-holders.ts` with its unit test (FR-131)
- [x] T120 [CORE] Test first, then `AttentionService.flag()`: raise a user mark, persist it with `attention.flagSet`, announce nothing; call `attention.flagClear` whenever a user mark clears by any route; restore with `attention.flagList` on every daemon (re)connect (a restored flag reads "Flagged", whatever later signals said — the row holds no reason *[derived]*); a unit assertion that a Windows-notification click on a mark raises its window and sends `focusPanel` (FR-124's restated FR-034); the terminal master switch leaves user marks; plus the `throng:attention:flag` channel and preload `attention.flag`, in `packages/ui/src/main/attention-service.ts`, `packages/ui/src/main/main.ts` and `packages/ui/src/preload/preload.cts` (FR-125, FR-126, FR-128; depends on T118, T122)

### Persistence and daemon

- [x] T121 [P] [DAEMON] Test first, then migration v11 `attention_flag` (idempotent; fixture proving an old store upgrades and a re-run is a no-op) and `AttentionFlagRepository`, in `packages/persistence/src/migrations/v11-attention-flags.ts`, `migration-runner.ts` and `packages/persistence/src/attention-flag-repository.ts` (FR-128, R19)
- [x] T122 [DAEMON] Test first, then `attention.flagList` / `flagSet` / `flagClear` in `packages/ipc-contract/src/terminal.ts` (or a new `attention.ts` exported from its index), routed in the daemon's composition root, with project deletion dropping its rows, and the contract test in `packages/ui/tests/contract/` (contracts/daemon-attention.md; depends on T121)

### Renderer

- [x] T123 [UI] Test first (component), then the toast card body goes to the panel and Copy / Dismiss do not navigate; remove the go-to control, keeping Copy and Dismiss where they are; retire the `goToPanel` icon token if nothing else uses it, in `packages/ui/src/renderer/attention/attention-toasts.tsx`, `packages/ui/src/renderer/common/notification.tsx` and `theme.css` (FR-124, R18)
- [x] T124 [UI] Test first (component), then **Flag** in every panel's header context menu, in the **View & state** section — a menu item with no command, like the failure banner's rows; FR-125 makes a binding optional *[derived]* — sending `attention.flag` with the panel's project, tab and title, in `packages/ui/src/renderer/workspace/panel-header-menu.ts` (FR-125; depends on T120)
- [x] T125 [UI] Test first (component + CSS), then the numbered flag on project rows and minimised category headers (digits inside, `9+`, blinking, Failed style), legible at the default UI scale, in the reserved slot, still drawn from the registry's `attention` / `attentionFailed` icon in theme-token colours with the digits laid over it (no inline SVG, no hardcoded colour); no-reflow (FR-133) asserted as CSS rules — the flag and pill slots keep their size when empty (`visibility: hidden`, fixed width) — and legibility judged by hand in MT-03, in `packages/ui/src/renderer/attention/attention-mark.tsx`, `holder-marks.tsx`, `packages/ui/src/renderer/sidebar/projects-panel.tsx` and `theme.css` (FR-131, FR-133; depends on T119)
- [x] T126 [UI] Test first, then every category header shows a pill with its total project count, replacing 046 FR-051a's "shown of total" (its existing tests updated to the new rule), and a minimised header is paler than an expanded one in every bundled theme, with the theme-quality contrast check kept green, in `projects-panel.tsx` and `theme.css` (FR-129, FR-130, FR-133)
- [x] T127 [UI] Test first, then tab chips: the numbered flag (the same registry icon and theme tokens as T125), and a panel-count pill only when the tab holds two or more panels, both in reserved width so the chip never resizes, in `packages/ui/src/renderer/workspace/tab-group.tsx` and `theme.css` (FR-131, FR-132, FR-133; depends on T119)

### Close

- [x] T128 Docs: `docs/preferences.md` / `docs/quick-start.md` mention Flag and the numbered marks where the attention feature is described; `docs-currency.test.ts` green
- [x] T129 Widen the round-12 manual test plan groups' `Paths:` to the files that implement them

## Phase 24: Iterate 2026-10-24, round 13 — one numbered circle in place of the flag (FR-135 – FR-139)

From hand-testing round 12 (MT-03, MT-04 at 63bd9532; spec Session 2026-10-24 (round 13); plan *Round 13 addendum*). No defect; five new requirements. Boundaries: [THEME] core theme, [UI] renderer — both done by the orchestrator.

- [ ] T130 [THEME] Test first, then retire the `attentionFailedMark` colour token and the `attention` / `attentionFailed` icon tokens: out of `theme.ts`, every default theme, `theme-metadata.ts`, `theme-copy.ts` and the icon-pack service, into `REMOVED_COLOUR_TOKENS` / `REMOVED_ICON_TOKENS` in `theme-ops.ts` (a stored theme carrying them loads with them dropped), the token-count tests and `CLOSEST_LEGITIMATE_PAIR_DELTA` re-measured, in `packages/core/src/config/` with its unit tests (FR-139)
- [ ] T131 [THEME] Test first, then `toCssVariables` emits `--throng-attention-mark-text`, the `readableTextOn` black or white for the theme's resolved `attentionMark`, in `packages/core/src/config/theme.ts` with a unit test over every bundled theme (FR-136)
- [ ] T132 [UI] Test first (component + CSS), then `AttentionMark` is a solid circle with no `Icon`: fill `attentionMark`, the count as its text in `--throng-attention-mark-text` when `showCount`, no number on a panel header, one 14 px size shared with `.project-item__dot` (the row slot 14 px, the 16 px glyph rule gone), every `failed` CSS variant collapsed to the attention one (mark, selected-row override, panel header tint, popover icon), the popover row's kind icon removed, `badge-renderer.ts` reading `attentionMark` for both kinds, and still distinct from the 8 px unsaved dot, in `packages/ui/src/renderer/attention/attention-mark.tsx`, `attention-popover.tsx`, `badge-renderer.ts`, `theme.css` and `packages/ui/tests/component/attention-count-css.test.ts` (FR-135, FR-136, FR-137, FR-138; depends on T131)
- [ ] T133 [UI] Test first, then the Flag and Go to Next Marked Panel menu items carry no `icon`, in `packages/ui/src/renderer/workspace/panel-header-menu.ts` and `packages/ui/src/renderer/sidebar/project-menu.ts` (FR-139; depends on T130)
- [ ] T134 Docs: `docs/quick-start.md` describes the numbered circle in place of the flag; `docs-currency.test.ts` green
- [ ] T135 Widen MT-03 / MT-04 `Paths:` to the files that implement round 13
