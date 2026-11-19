---
description: "Task list for 076 — terminal status-bar toggles"
---

# Tasks: Terminal Status-Bar Toggles

**Input**: Design documents from `specs/076-terminal-status-bar-toggles/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Required. Principle V is non-negotiable. Every implementation task follows its failing test, at the lowest
layer that proves it (research R10).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1, US2, US3 (spec.md)

## Phase 1: Setup

- [x] T001 Add the icon keys `rememberCommand` (Lucide `history`), `rememberDirectory` (Lucide `folder-clock`) and
  `terminalNotifications` (Lucide `bell`, plain; the off state's struck-through line is CSS, FR-002):
  - art in `packages/core/src/icons/default-set/<key>.svg`
  - entries in `packages/core/src/icons/default-set/SOURCES.json`
  - keys and descriptions in `packages/core/src/icons/icon-keys.ts`
  - lines in `packages/core/src/icons/icon-sets-README.txt`
  - then `npm run generate:icons`, which writes `packages/core/src/icons/default-icon-set.generated.ts`

  The existing icon completeness tests (`icon-tokens-exist` and the default-set tests) must pass.

## Phase 2: Foundational (blocks every story)

- [x] T002 [P] Write the failing unit test `packages/core/tests/unit/terminal-panel-toggles.test.ts`. It covers:
  - the order Remember command, Reopen directory, Terminal notifications (FR-001)
  - each row's command id, icon key and label
  - `resolveTerminalToggles`: a stored boolean wins, and an absent or non-boolean value takes the preference (FR-003)
  - `terminalToggleTitle` gives "<label>: enabled", "<label>: disabled" and the " (<chord>)" suffix (FR-002)
- [x] T003 Implement `packages/core/src/terminal/panel-toggles.ts` (research R1) and export it from
  `packages/core/src/index.ts`.
- [x] T004 [P] Extend `packages/core/tests/unit/terminal-memory.test.ts` and
  `packages/core/tests/unit/panel-type-descriptor.test.ts`, failing first:
  - `readTerminalPanelConfig` returns `notifications`. "Only a real boolean counts as the panel's own value":
    absent resolves to `defaults.notifications`.
  - The form gains a `notifications` checkbox after `rememberDirectory`, seeded from memory and else from the
    defaults.
  - `buildConfig` writes `notifications: boolean`.
- [x] T005 Implement T004:
  - `TerminalPanelConfig.notifications` and the form input in `packages/core/src/terminal/panel-type.ts`
  - `TerminalPanelDefaults.notifications` in `packages/core/src/panel-type/descriptor.ts`
  - `SHIPPED_TERMINAL_PANEL_DEFAULTS.notifications = true`
- [x] T006 [P] Write the failing component test `packages/ui/tests/component/workspace-commit-panel-config.test.ts`.
  `commitPanelConfig(panelId, patch)` must:
  - apply the patch
  - save the layout at once, without waiting for the autosave debounce
  - resolve `true` when `client.save` resolves and `false` when it rejects
  - resolve `true` without saving when nothing changed
- [x] T007 Implement `commitPanelConfig` in `packages/ui/src/renderer/state/workspace-store.tsx` (research R4). Add it
  to `WorkspaceContextValue` and to every test double of that context that the typechecker flags.

**Checkpoint**: the shared toggle shape, resolution and immediate commit exist.

## Phase 3: User Story 1 — change what a running terminal remembers (P1) 🎯 MVP

**Goal**: The Remember command and Reopen directory toggles on the status bar, in the menu and as commands. Each flips
the panel's stored value without restarting the terminal.

**Independent Test**: spec US1. In a component test, flip each toggle, then check the committed patch, the menu's
check and the capture decision at `end()`.

- [x] T008 [P] [US1] Write the failing component test
  `packages/ui/tests/component/terminal-status-bar-toggles.test.ts`. `TerminalStatusBar` with `toggles` renders:
  - a `terminal-status-bar__toggles` group after the left group
  - one `IconButton` per toggle, in order, with `aria-pressed`, title and `aria-label` per
    contracts/status-bar-and-menu.md and testId `terminal-toggle-<id>-<panelId>`
  - a click, Space or Enter calls that toggle's `onToggle`
- [x] T009 [US1] Implement the toggle group in `packages/ui/src/renderer/terminal/terminal-status-bar.tsx` and its
  layout in `packages/ui/src/renderer/terminal/terminal.css`: the right group does not shrink, and the left group
  truncates. Remove the stale "#169 word-wrap lands here" note from the component comment.
- [x] T010 [P] [US1] Write the failing unit test `packages/ui/tests/unit/terminal-content-menu-toggles.test.ts`.
  `terminalContentMenu` with `toggles` must add the checkable items:
  - in the `viewState` section, after *Refresh / redraw terminal*, in order
  - with `checked` from the resolved value, the chord as `shortcut`, and testId `menu-item-<label>`
  - present whether a start failure is live or not
  - each item's `onClick` runs that toggle's flip (FR-005)
- [x] T011 [US1] Implement T010 in `packages/ui/src/renderer/terminal/terminal-content-menu.ts`.
- [x] T012 [P] [US1] Write the failing component test `packages/ui/tests/component/terminal-toggle-commit.test.ts`.
  A mounted `TerminalPanel` must:
  - show the resolved values (explicit config wins, absent takes the preference)
  - on a Remember command or Reopen directory click, call `commitPanelConfig(panelId, { rememberCommand: !resolved })`
    or the directory equivalent, and touch no other panel and no setting (FR-008)
  - on a commit that resolves `false`, revert to the previous stored value (absent stays absent) and raise
    `notice-terminal-toggle-failed`, naming the setting (FR-004)
- [x] T013 [US1] Wire the toggles in `packages/ui/src/renderer/terminal/terminal-panel.tsx`:
  - resolve with `resolveTerminalToggles`
  - one `flipToggle(id)` that commits, then reverts and notifies on failure
  - pass the toggles to `TerminalStatusBar` and to `terminalContentMenu`
  - read the current config through a ref inside `end()`'s capture decision (FR-011, research R9)
- [x] T014 [P] [US1] Extend the keybinding tests (`packages/core/tests/unit/keybindings-metadata.test.ts`,
  `packages/core/tests/unit/keybindings-tiers.test.ts` and the scope tests), failing first:
  - `terminal.toggleRememberCommand`, `terminal.toggleRememberDirectory` and `terminal.toggleNotifications` exist
  - each is `TERMINAL_ONLY`, has an empty default binding on every platform map, a descriptor (group Terminal, "Unbound
    by default."), and is a member of `WINDOW_HANDLED_ACTIONS` (FR-006)
- [x] T015 [US1] Implement T014 in `packages/core/src/config/keybindings.ts` and
  `packages/core/src/config/keybindings-metadata.ts`. Update `packages/ui/tests/shared/window-chords.ts` if it lists
  the set.
- [x] T016 [P] [US1] Write the failing unit test `packages/ui/tests/unit/terminal-toggle-registry.test.ts`:
  - register, run and unregister per panel
  - running for an unknown panel reports unavailable
- [x] T017 [US1] Implement `packages/ui/src/renderer/terminal/terminal-toggle-registry.ts`. Register each panel's flip
  from `terminal-panel.tsx`. Add the three `runAction` cases to
  `packages/ui/src/renderer/keybindings/window-dispatcher.tsx`: target the focused panel as `panel.destroy` does, and
  return `'unavailable'` when there is nothing to run.

**Checkpoint**: US1 works with the status bar shown or hidden.

## Phase 4: User Story 2 — silence one noisy terminal (P1)

**Goal**: The Terminal notifications toggle, menu item, command, setup-form checkbox and preference. A panel whose
notifications are off raises nothing, and its existing mark is withdrawn when they turn off.

**Independent Test**: spec US2. Run daemon unit and integration tests with two panels, one silenced, plus main's
`AttentionService` unit tests for withdrawal.

- [x] T018 [P] [US2] Extend `packages/core/tests/unit/app-settings.attention.test.ts` and
  `packages/core/tests/unit/settings-metadata.test.ts`, failing first. They cover `terminals.defaultNotifications`:
  - "boolean", "shipped `true`", group Terminal, no subgroup, directly after `terminals.defaultRememberDirectory`, a
    toggle with a description, not gated on `terminals.attention.enabled`
  - a non-boolean value keeps the fallback
  - `panel-type-defaults-match-settings.test.ts` pins `SHIPPED_TERMINAL_PANEL_DEFAULTS.notifications` to it
- [x] T019 [US2] Implement T018:
  - the setting in `packages/core/src/config/app-settings.ts`
  - its descriptor in `packages/core/src/config/settings-metadata.ts`
  - `npm run generate:defaults` if the shipped defaults are generated
  - seed `terminalDefaults.notifications` in `packages/ui/src/renderer/panel-type/panel-type-form.tsx`
  - carry `notifications` into `terminalMemory` in `end()` in `terminal-panel.tsx`
- [x] T020 [P] [US2] Extend `packages/daemon/tests/unit/terminal-attention.test.ts` (or add
  `terminal-attention-ignore.test.ts`), failing first:
  - `mergeAttentionConfig` reads `notifyByDefault` tolerantly
  - `publish` drops a signal whose panel's `storedNotifications` is `false`, or `undefined` with
    `notifyByDefault: false`
  - a dropped signal is not recorded in the ledger when detached
  - `readLedger` omits entries for panels whose notifications are off now
  - `ignoredOf(panelIds)` returns the subset whose notifications resolve off
  - a `storedNotifications` that throws is logged and resolves by the preference
  - a signal pending in a rate window when the panel's notifications turn off is dropped, and turning them back on
    afterwards does not replay it (FR-023)
- [x] T021 [US2] Implement T020:
  - `AttentionProducerConfig.notifyByDefault` in `packages/core/src/attention/attention-types.ts`, with its default in
    `defaultAttentionConfig`
  - the gate and `ignoredOf` in `packages/daemon/src/terminal-attention.ts`
  - `TERMINAL_ATTENTION_IGNORED_METHOD` and its types in `packages/ipc-contract/src/terminal.ts`, registered in
    `packages/daemon/src/terminal-service.ts`, with `-32602` on malformed params
  - `storedNotifications` from the saved layouts in `packages/daemon/src/composition-root.ts`
- [x] T022 *(replaced by `packages/daemon/tests/unit/terminal-attention-ignore.test.ts`; see the note below)* [P] [US2] Extend `packages/daemon/tests/integration/terminal-attention-storm.integration.test.ts` with two
  sessions, one silenced by its stored config. Only the other publishes `terminal.attention` (SC-003).
- [x] T023 [P] [US2] Extend `packages/core/tests/unit/attention-model.test.ts`, failing first. `withdrawPanel(panelId)`
  clears a `terminal` producer mark on that panel and leaves a `user` Flag and other panels' marks (FR-022).
- [x] T024 [US2] Implement `AttentionModel.withdrawPanel` in `packages/core/src/attention/attention-model.ts`.
- [x] T025 [P] [US2] Extend `packages/ui/tests/unit/attention-service.test.ts`, failing first:
  - `panelIgnored(panelId)` withdraws the terminal mark and dismisses its toast and OS notification
  - `pushConfig` sends `notifyByDefault`, taken from `terminals.defaultNotifications`
  - `onSettingsChanged` with `terminals.defaultNotifications` true → false pushes the config, asks
    `terminal.attentionIgnored` with the terminal-marked panel ids, and withdraws those returned
  - a failing query is logged and withdraws nothing
- [x] T026 [US2] Implement T025:
  - `packages/ui/src/main/attention-service.ts`
  - the `throng:attention:panelIgnored` handler in `packages/ui/src/main/main.ts`
  - `attention.panelIgnored` in `packages/ui/src/preload/preload.cts`, and the renderer's `window.throng` type wherever
    it is declared
- [x] T027 [US2] Extend `packages/ui/tests/component/terminal-toggle-commit.test.ts`, failing first, then implement in
  `terminal-panel.tsx`:
  - a successful commit that turns Terminal notifications off calls `window.throng.attention.panelIgnored(panelId)`
  - turning them on, or a failed commit, does not
  - the Terminal notifications toggle is the third button and the third menu item
  - with notifications off, the panel's own exit display and the "Command not remembered" failure notice are unchanged
    (FR-024)
- [x] T028 [P] [US2] Extend `packages/ui/tests/unit/panel-type-form.test.ts`, failing first. The setup form shows an
  "Terminal notifications" checkbox (testid `terminal-notifications`), ticked for a new panel at the shipped
  preference, seeded by the preference for a new panel and by memory for a closed one.
  Then fix whatever `terminal-inputs.tsx` or `panel-type-form.tsx` needs.

**Checkpoint**: US2 works end to end, including with no window open, because the daemon gate covers the detached
ledger.

## Phase 5: User Story 3 — one row that looks and behaves alike (P2)

**Goal**: Consistent order, naming, keyboard reach and width behaviour.

**Independent Test**: spec US3, as a component test.

- [x] T029 [P] [US3] Extend `packages/ui/tests/component/terminal-status-bar-toggles.test.ts`, failing first:
  - Tab reaches each toggle in order
  - the right group's computed `flex-shrink` is `0`, and the readout's is non-zero with `overflow: hidden` /
    `text-overflow: ellipsis` (FR-007)
  - each toggle draws its icon through the theme icon set, with no inline colour (FR-002, SC-006); on is the
    full-contrast text colour on the pressed background, off is the muted text colour with the CSS-drawn diagonal line
- [x] T030 [US3] Adjust `packages/ui/src/renderer/terminal/terminal.css` and the component until T029 passes. Run
  `css-variables-defined`, `icon-call-sites` and `button-token-exclusion`.

## Phase 6: Polish & cross-cutting

- [x] T031 *(replaced — no E2E written; see the note below)* Write `packages/ui/tests/e2e/terminal-status-bar-toggles.e2e.ts`, tagged `@extended @persistence`. It flips
  Remember command off from the status bar, checks the menu item is unchecked, relaunches on the same config root, and
  sees the toggle still off (SC-002). Then:
  - add it to `packages/ui/tests/e2e/parallel-plan.json` (it drives a context menu)
  - re-seed `packages/ui/tests/e2e/e2e-budget.json`
  - run `packages/ui/tests/unit/e2e-tags.test.ts` and `tier-plan.test.ts`

  The E2E itself runs only in `pipeline.yml`.
- [x] T032 [P] Docs (FR-050), via `throng-docs`:
  - `docs/preferences.md`: Terminal notifications by default
  - `docs/key-bindings.md`: the three unbound commands
  - the terminal section of the user docs: the toggles and their menu items

  Run `packages/ui/tests/unit/docs-currency.test.ts`.
- [x] T033 Run lint and typecheck (`npm run lint`, `npm run typecheck`). Then review the branch diff against the
  spec, plan, contracts and constitution, and fix what is found.
- [x] T034 Write the manual test plan with `test-discipline:planning-manual-tests`, covering quickstart.md's by-hand
  steps with each group's `Covers:` naming FR and SC ids.

### Notes from implementation

- **T022.** The storm integration test is a wall-clock cost soak at the regression tier, and adding a silenced panel
  to it proves nothing about cost. The wiring it would have shown — two real sessions through the real
  `TerminalService` and RPC router, one silenced by its stored value, only the other publishing — is asserted in
  `terminal-attention-ignore.test.ts` with the shared attention harness (writing-tests: no duplicate proof).
- **T031.** No E2E was written. Restart persistence is the layout's ordinary save and load, which existing tests
  already prove for every panel-config field. What 076 adds is the write: an immediate, explicit save. The component
  tests show it carries the value (`workspace-commit-panel-config.test.ts`, `terminal-toggle-commit.test.ts`).
  The menu with the status bar hidden is a component test too. Nothing left needs a real window (throng-testing:
  *Choosing the layer*), so `e2e-budget.json` and `parallel-plan.json` are unchanged.
- **T027, FR-024.** The silencing gate exists only at the daemon's attention publish, and is unit-tested there. The
  exit display (`exit-store`) and the capture notice in `end()` have no notifications input at all, so a component assertion
  that they are "unchanged" would have nothing to fail against. FR-024 holds by construction, and the review pass
  checked that it does.
- **US3 width.** The flavour label now shrinks after the readout instead of never. 045 T280's guard in
  `link-target-readout.test.ts` was restated: the label still cannot wrap, and it clips with an ellipsis.

## Dependencies & execution order

- Phase 1 has no dependency. It must land before T009, which uses the icon keys.
- Phase 2 blocks every story: T003 before T009, T011 and T013; T005 before T013 and T019; T007 before T013.
- US1 (Phase 3), then US2 (Phase 4): US2's toggle reuses US1's wiring (T013, T017).
- US3 (Phase 5) refines what US1 rendered.
- Phase 6 comes last.

## Parallel opportunities

- T002, T004 and T006 (three different test files).
- Within US1: T008, T010, T014 and T016.
- Within US2: T018, T020, T022, T023, T025 and T028. The daemon, core-model and main-service work is independent.

## Implementation strategy

MVP = Phases 1 to 3: the two #669 toggles on the status bar, the menu and the commands. US2 then adds #673 on the
same rails, and US3 tightens the row. Each phase ends with its light tests green and a commit.
