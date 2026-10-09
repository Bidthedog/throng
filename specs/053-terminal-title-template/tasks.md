---
description: "Task list for 053 — terminal panel titles from a template"
---

# Tasks: Terminal panel titles from a template

**Input**: Design documents from `specs/053-terminal-title-template/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: test-first throughout (Constitution V). Each implementation task is preceded by the failing test that
proves it, at the lowest layer that shows it (plan.md *Testing*).

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

None — existing packages, no dependency.

---

## Phase 2: Foundational (blocking every story)

**Purpose**: the pure core every surface renders through.

- [x] T001 [P] Failing unit tests for the template language — scanning, nesting, `??`, literals, every error row and every worked example in contracts/title-template.md — in `packages/core/tests/unit/title-template.test.ts`
- [x] T002 Implement `parseTitleTemplate`, `renderTitleTemplate`, `validateTitleTemplate` and `DEFAULT_TERMINAL_TITLE_TEMPLATE` (default `({command} | ){shell}( (({path})))`) in `packages/core/src/terminal/title-template.ts`, exported from `packages/core/src/terminal/index.ts` and `packages/core/src/index.ts` (FR-005 – FR-008, FR-009)
- [x] T003 [P] Failing unit tests for `commandDisplay(line) → { command, app }`: a quoted full path (`"C:\WINDOWS\system32\PING.EXE" -t host` → `ping -t host` / `ping`), a bare command, an unquoted path, an empty line — in `packages/core/tests/unit/command-display.test.ts`
- [x] T004 Implement and export `commandDisplay` in `packages/core/src/terminal/command-capture.ts`, reusing `splitCommand` and `bareName` (FR-003, FR-011)
- [x] T005 [P] Failing unit tests for `shortenPath(path, limit)`: fits unchanged; drops middle folders keeping root and last folder with `…`; falls back to an end cut when root plus last folder exceed the limit; counts graphemes; `\` and `/` alike, a drive root, a UNC root and a POSIX root; plus `lastFolder` for `{folder}` over the same forms — in `packages/core/tests/unit/path-shorten.test.ts`
- [x] T006 Implement `shortenPath` in `packages/core/src/text/path-shorten.ts`, exported from `packages/core/src/index.ts` (FR-012)
- [x] T007 Failing unit tests for the three settings: defaults (`terminals.titleTemplate` = the default template, `titleCommandMaxLength` = 40, `titlePathMaxLength` = 40, sliders 10–200 step 5), read-side parse of each leaf, and `checkSettingsText` reporting an invalid template through the descriptor's `validate` — in `packages/core/tests/unit/terminal-title-settings.test.ts`
- [x] T008 Add `validate?: (value: unknown) => string | null` to `FieldDescriptor` in `packages/core/src/config/metadata.ts`; call it in `checkSettingsText` (`packages/core/src/config/settings-validity.ts`); add the three leaves to `TerminalSettings`, `DEFAULT_APP_SETTINGS`, `terminalSettings` and `cloneTerminals` (`packages/core/src/config/app-settings.ts`) and their descriptors, the template's with `control: 'text'` and `validate: validateTitleTemplate` (`packages/core/src/config/settings-metadata.ts`) (FR-014, FR-008)
- [x] T009 Failing unit tests for `panelDisplayTitle` on a terminal panel given `sources.terminal` — the default template while running and idle, a custom template, an empty render falling back to `{shell}`, an unparsable template rendering as the default, `{command}`/`{path}` shortened to their limits, the whole name still bounded by `maxNameLength`, every placeholder's value (`{app}`, `{arch}`, `{folder}`, `{project}`, `{admin}`), US2's acceptance scenarios 1–3 exactly as written (SC-004), and no `sources.terminal` naming the panel exactly as today — in `packages/core/tests/unit/panel-display-title.test.ts`
- [x] T010 Extend `PanelTitleSources` with `terminal?: { values: TerminalTitleValues; template: string; limits: { command: number; path: number } }` and render it in `resolveTitle` for terminal panels (`packages/core/src/workspace/panel-title.ts`); parse results are memoised by template text (FR-001, FR-009, FR-012)

**Checkpoint**: core renders any template from given values; nothing in the UI changed yet.

---

## Phase 3: User Story 1 — Every terminal says what is running in it (P1) 🎯 MVP

**Goal**: with the default template, every shell's panel names its running command, shell and directory.

**Independent test**: one terminal per built-in shell running `ping localhost -t`, names read; stopped, read again.

- [x] T011 [P] [US1] Failing unit test: `readProcessTable`'s rows carry `executablePath`, and `executableArch` maps PE machine `0x8664`/`0x014c`/`0xAA64` to `x64`/`x86`/`arm64`, anything else or a read failure to `null`, cached by path — fixture bytes, no real executable — in `packages/platform-windows/tests/unit/executable-arch.test.ts`
- [x] T012 [US1] Add `executablePath?` to `ChildProcess` and optional `executableArch?(path): Promise<string | null>` to `IPtyHost` (`packages/core/src/abstractions/pty-host.ts`); select `ExecutablePath` in `readProcessTable` and implement `executableArch` over a new `packages/platform-windows/src/executable-arch.ts` in `packages/platform-windows/src/node-pty-host.ts` (FR-003 `{arch}`)
- [x] T013 [P] [US1] Failing daemon unit test: the command observation publishes `arch` for the chosen process, republishes when only `arch` changes, publishes `arch: null` when idle, and a host without `executableArch` yields `null` — in `packages/daemon/tests/unit/terminal-command-poll.test.ts`
- [x] T014 [US1] Return the chosen process alongside the command (a `foregroundProcess` sibling of `foregroundCommand` in `packages/core/src/terminal/command-capture.ts`); publish `{ panelId, command, arch }` from `packages/daemon/src/terminal-service.ts` / `terminal-events.ts`; add `arch` to `TerminalCommandNotification` (`packages/ipc-contract/src/terminal.ts`), the preload `onCommand` type (`packages/ui/src/preload/preload.cts`) and `global.d.ts` (contracts/command-notification.md)
- [x] T015 [US1] Store `arch` beside the command and add version hooks to `packages/ui/src/renderer/terminal/command-store.ts` and `packages/ui/src/renderer/terminal/cwd-store.ts`, following `title-store.ts`'s `useTerminalTitleVersion`
- [x] T016 [P] [US1] Failing component test: a terminal panel's header name for the default template — idle (`Git Bash (C:/proj)`), with an observed command (`ping localhost -t | Git Bash (C:/proj)`), after the command clears, after a cwd change — the terminal panel-type icon beside it (FR-002), and no `panel-cwd-<id>` element; a remounted terminal whose new session has not been observed shows no command from the previous one (FR-016); a stopped terminal and an empty panel are named as today; `{admin}` only when `runAsAdmin` and throng is elevated; the header title's `title` attribute carries the unshortened name (research R5); the tab strip shows the same name — in `packages/ui/tests/component/terminal-panel-title.test.ts`
- [x] T017 [US1] New `packages/ui/src/renderer/terminal/title-context.ts`: `terminalTitleValues(panel, ctx)` gathering command, arch, title, shell, cwd, project and admin from the stores, plus a module store for the template and limits fed from settings; `panelTitleSources` and `usePanelDisplayNames` (`packages/ui/src/renderer/workspace/use-panel-display-names.ts`) pass `sources.terminal` and subscribe to the command, cwd and template versions (FR-001, FR-013, FR-016)
- [x] T018 [US1] Header: `packages/ui/src/renderer/workspace/panel-placeholder.tsx` names a terminal through the same sources and drops the `panel-cwd-<id>` span (FR-010); remove its now-unused CSS in `packages/ui/src/renderer/theme.css`
- [x] T019 [US1] Re-point the E2E reads of `panel-cwd-<id>` to the header title (research R5) in `packages/ui/tests/e2e/open-in-terminal.e2e.ts`, `terminal-command-memory.e2e.ts`, `terminal-directory-memory.e2e.ts`, `terminal-reload-mode.e2e.ts` and `packages/ui/tests/unit/e2e-elevation-guards.test.ts`

**Checkpoint**: US1 independently testable.

---

## Phase 4: User Story 2 — The user decides what a terminal's name says (P2)

**Goal**: the template and limits are editable in Preferences, refused when invalid, and applied at once.

**Independent test**: change the template in Preferences; open terminals rename; an invalid one is refused.

- [x] T020 [P] [US2] Failing component test: the Preferences text control for `terminals.titleTemplate` refuses `({shell}` with `Unclosed bracket at 0` (`control-terminals.titleTemplate-invalid`) and commits nothing; a valid template commits — in `packages/ui/tests/component/preferences-text-validate.test.ts`
- [x] T021 [US2] `TextControl` calls the descriptor's `validate` before committing and shows its message as `NumberControl` does, in `packages/ui/src/renderer/preferences/form-controls.tsx` (FR-008)
- [x] T022 [P] [US2] Failing component test: a settings change to the template or a limit re-renders every open terminal's name without remount, in `packages/ui/tests/component/terminal-panel-title.test.ts` (FR-013, SC-003)
- [x] T022a [US2] Feed the template module store from the config provider in `packages/ui/src/renderer/terminal/title-context.ts`, so every window follows a settings change (research R2)

**Checkpoint**: US1 and US2 independently testable.

---

## Phase 5: User Story 3 — The template is documented where it is set (P3)

- [x] T023 [US3] Write the template setting's description (every placeholder, one line each; groups, `??`, doubled brackets; the default as the example; groups opening or closing together need a space between their brackets; `??` has no literal form) in `packages/core/src/config/settings-metadata.ts`, and the three settings' rows plus the same syntax note in `docs/preferences.md` — load `throng-docs` first (FR-015)
- [x] T024 [US3] Run `packages/ui/tests/unit/docs-currency.test.ts` and the throng-docs audit for the three new keys

---

## Phase 6: Polish & cross-cutting

- [x] T025 Short gates on the whole branch: lint, typecheck, build, unit, component (running-tests *Gate scheduling*)
- [x] T026 Extend the branch's manual test plan with 053's groups (planning-manual-tests)

## Dependencies

- T002 ← T001; T004 ← T003; T006 ← T005; T008 ← T007, T002; T010 ← T009, T002, T004, T006.
- US1: T012 ← T011; T014 ← T013, T012; T015 ← T014; T017 ← T016, T010, T015; T018 ← T017; T019 ← T018.
- US2: T021 ← T020, T008; T022a ← T022, T017.
- US3: T023 ← T008; T024 ← T023.

## Parallel opportunities

- T001, T003, T005 (three new test files) together; then T002, T004, T006 (three different source files).
- T011 (platform-windows) and T016 (renderer) once Phase 2 is done.

## Implementation strategy

MVP is US1: Phase 2 then Phase 3 — the default template, live in every shell. US2 adds editing and validation;
US3 the documentation.

## Phase 7: Convergence

- [x] T027 Render an executable path inside `{title}` by its bare name (cmd titles itself `C:\WINDOWS\system32\cmd.exe - …`), failing unit test first in `packages/core/tests/unit/panel-display-title.test.ts`, per FR-011 (partial)

## Phase 8: Expressions with C# operators (clarification session 2)

- [x] T028 Rewrite the failing truth table in `packages/core/tests/unit/title-template.test.ts` for contracts/title-template.md: text as typed, expressions in brackets and after a placeholder, `?:` `??` `||` `&&` `!` with C# precedence, string literals with placeholders, `""` and braces, every error row and worked example (FR-005 – FR-008)
- [x] T029 Rewrite `packages/core/src/terminal/title-template.ts` to pass T028, with the new `DEFAULT_TERMINAL_TITLE_TEMPLATE`; update the default-dependent cases in `packages/core/tests/unit/panel-display-title.test.ts` and `terminal-title-settings.test.ts` (FR-009)
- [x] T030 Failing component test, then the change: `{title}` is a title set after the running command started — empty at a prompt, empty for a shell's own title, set when the program titles itself, cleared when the command ends — in `packages/ui/src/renderer/terminal/title-store.ts` / `command-store.ts` / `title-context.ts`, test in `packages/ui/tests/component/terminal-panel-title.test.ts` (FR-003)
- [x] T031 Failing component test, then the change: a descriptor's `wide` puts its control on one full-width line under the description; `terminals.titleTemplate` is wide — `packages/core/src/config/metadata.ts`, `settings-metadata.ts`, `packages/ui/src/renderer/preferences/settings-tab.tsx`, `preferences.css`, test in `packages/ui/tests/component/preferences-text-validate.test.ts` (FR-014)
- [x] T032 Rewrite the template setting's description and `docs/preferences.md` *Terminal title templates* for the operators and quoting rule (FR-015)
- [x] T033 Update the manual test plan's MT-11 – MT-13 for the new default, operators and the wide field
- [x] T034 Short gates on the whole branch
