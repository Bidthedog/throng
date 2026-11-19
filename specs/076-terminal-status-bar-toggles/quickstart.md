# Quickstart: validating terminal status-bar toggles (076)

## Automated

Run the light layers from inside the worktree. See CLAUDE.md, *Running tests locally*, and `.test-discipline/adapters.json`.

- Unit: `td run --runner unit --scope file --target` each of:
  - `packages/core/tests/unit/terminal-panel-toggles.test.ts`
  - `packages/core/tests/unit/attention-model.test.ts`
  - `packages/daemon/tests/unit/terminal-attention-ignore.test.ts`
  - `packages/ui/tests/unit/attention-service.test.ts`
  - `packages/ui/tests/unit/terminal-content-menu-toggles.test.ts`
  - the settings and keybinding completeness tests
- Component: `td run --runner component --scope file --target` each of:
  - `packages/ui/tests/component/terminal-status-bar-toggles.test.ts`
  - `packages/ui/tests/component/terminal-toggle-commit.test.ts`
- Integration: none. The daemon wiring is unit-tested through the real `TerminalService` (tasks.md, T022 note).
- No E2E (tasks.md, T031 note). The `pipeline.yml` dispatch runs everything else on every platform.

## By hand

1. **US1, Remember command.** Open a terminal and run `ping -t localhost` (Windows) or `ping localhost`. On the
   status bar, set Remember the last running command to on. Close throng with Terminate all, then reopen. The command
   runs again. Turn the toggle off, run another long command, reopen: it does not run, and the Startup Command is
   unchanged.
2. **US1, Reopen directory.** `cd` somewhere and turn Reopen in the last directory off. Close the terminal: the setup
   form shows the box unticked. Start it: it opens at the project root (or its start directory).
3. **US1, hidden bar.** Turn `terminals.showStatusBar` off. Right-click the terminal: the three checkable items are
   under View & state with the current ticks, and choosing one flips it.
4. **US2.** Put two terminals in one tab and turn Terminal notifications off in the first. Focus another panel, then
   run `printf '\a'; exit 3` in both. Only the second terminal is marked, toasted and counted. Turn Terminal
   notifications back on in the first: its next bell marks it.
5. **US2, withdrawal.** Let a terminal raise a mark, then turn Terminal notifications off from its status bar. The
   mark, its toast and its OS notification go at once. A Flag set from the panel menu stays.
6. **US2, default (Q4).** With an existing terminal that has never had the toggle flipped, turn Preferences → Terminal
   → Terminal notifications by default (just after Reopen in the last directory by default) off. Its toggle shows
   off, and its mark, if any, is withdrawn. Turn the preference back on: the toggle shows on again.
7. **US3.** Narrow the panel until the bar is crowded. Hover a link: the readout truncates and the three toggles stay
   whole. Tab to each toggle; Space and Enter flip it. An on toggle is bright on the pressed background; an off one is
   muted with a diagonal line through it; hovering reads "<setting>: enabled" or "<setting>: disabled". Switch theme:
   the icons recolour.
