# Tasks: Terminal Startup Commands & Command Memory (025)

Test-first throughout (Principle V): write the failing test, **run it**, confirm it fails for the reason
expected, then make it pass. Layers are the four this repo actually has (research R7) — there is no
component-test stack, so renderer behaviour is proven by E2E and logic is pushed into `@throng/core`.

`[P]` = parallelisable with its neighbours.

---

## Phase A — The rename & its migration (FR-002–FR-002f)

- [x] **T001** Unit (Red): `app-settings` parses a settings blob using the **old** `defaultParams` key and
      yields `defaultShellArguments`; a blob using the new key round-trips; a blob with both prefers the
      new. Fixtures use the old spelling verbatim (FR-002f).
- [x] **T002** Rename in `core/src/config/app-settings.ts`: `TerminalSettings.defaultParams` →
      `defaultShellArguments`, `TerminalFlavourConfig.defaultParams` → `defaultShellArguments`, with
      read-side fallback for both. Add `commandRecipes` and `commandPollMs` with defaults.
- [x] **T003** Unit (Red): a persisted `TerminalPanelConfig` with `params` yields `shellArguments`.
- [x] **T004** Rename `params` → `shellArguments` in `terminal/panel-type.ts` (config + values + form
      input key), `terminal/defaults.ts` (`resolveDefaultParams` → `resolveDefaultShellArguments`,
      `BUILTIN_FLAVOUR_DEFAULT_PARAMS` → `BUILTIN_FLAVOUR_DEFAULT_SHELL_ARGUMENTS`), `terminal/flavour.ts`.
- [x] **T005** Propagate the rename through every consumer: `terminal-ipc.ts`, `terminal-inputs.tsx`,
      `settings-metadata.ts`, `generate-shipped-defaults`, and all existing tests. `git grep -n
      "defaultParams\|\bparams\b"` in terminal paths must come back clean of the old concept.
- [x] **T006** Relabel the UI: "Startup Params" → **"Shell Arguments"** (FR-002/FR-002b). No user-visible
      surface may still say the old name.

## Phase B — Startup Command (US1 · FR-001–FR-014)

- [x] **T007 [P]** Unit (Red): `expandCommandRecipe(['/K','{command}'], 'npm run dev')` →
      `['/K','npm run dev']`; the command stays **one** argv element even with spaces and quotes; a recipe
      with no `{command}` is rejected as invalid.
- [x] **T008 [P]** Unit (Red): `resolveCommandRecipe` precedence — settings override → user flavour's own
      → built-in catalogue → undefined.
- [x] **T009** Implement `core/src/terminal/command-recipe.ts` with the built-in catalogue **as proven in
      research R1** (cmd `/K`; powershell/pwsh `-NoExit -Command`; git-bash `-c … ; exec bash -i`).
- [x] **T010** Unit (Red): `resolveLaunchSpec` — empty command changes nothing (FR-006); command + recipe
      puts it in `args` and sets no `writeOnReady`; command + no recipe sets `writeOnReady` and leaves
      `args` alone (FR-012); never both.
- [x] **T011** Extend `resolveLaunchSpec` accordingly (`LaunchSpec.writeOnReady`).
- [x] **T012** Unit (Red): the Terminal descriptor exposes `startupCommand` and `rememberCommand`,
      defaults them empty/false (FR-015), and carries them into the built config.
- [x] **T013** Extend `terminal/panel-type.ts`; add `'checkbox'` to the descriptor control union.
- [x] **T014** Wire the launch path: `terminal-ipc.ts` passes `startupCommand` + the resolved recipe; the
      renderer writes `writeOnReady` to the PTY once the shell is ready (fallback path only).
- [x] **T015** Add **Startup Command** (text) and **Remember the last running command** (checkbox) to
      `terminal-inputs.tsx`.
- [x] **T016** E2E: a terminal created with a startup command runs it; stopping the command leaves an
      interactive prompt (FR-005); an empty command behaves exactly as today (FR-006).

## Phase C — Command observation (FR-019a–h, FR-022–FR-026)

- [x] **T017 [P]** Unit (Red): `foregroundCommand` picks the most recently started **direct** child;
      ignores grandchildren whose parent has exited (FR-022a); returns null for none.
- [x] **T018 [P]** Unit (Red): `isCapturableCommand` rejects multi-line, over-long and control-character
      command lines (FR-023).
- [x] **T019** Implement `core/src/terminal/command-capture.ts`.
- [x] **T020** Add `ChildProcess` + `listChildProcesses` to `IPtyHost`; extend the shared contract suite
      (`core/src/testing/pty-host-contract.ts`) with the five obligations in contracts C1.
- [x] **T021** Implement `listChildProcesses` in `WindowsPtyHost` — **async**, one `Win32_Process` query
      carrying `CommandLine` + `CreationDate`. Must not touch the existing synchronous `listChildPids`
      (that stall is #190).
- [x] **T022** Forward it across the agent protocol (`pty-agent-protocol/-entry/-host`).
- [x] **T023** Add `terminal.command` to the IPC contract; publish from `terminal-events.ts`.
- [ ] **T024** Integration (Red→Green): `terminal-service` publishes a command change on the shared poll,
      only on change, suspended when `sinkCount === 0` with the last value retained (FR-019f), and takes a
      final observation on an observable teardown (FR-019g). Interval comes from `commandPollMs` (FR-019c).
- [x] **T025** Preload bridge `onCommand` + renderer `command-store.ts` (twin of `cwd-store.ts`).

## Phase D — The memory rule (US2 · FR-015–FR-018, FR-025)

- [x] **T026** Unit (Red): **the six worked examples** from the spec, as six cases over `captureDecision`
      — plus memory-off never saves (FR-018) and an uncapturable command leaves the saved value alone.
- [x] **T027** Implement `captureDecision`.
- [x] **T028** Unit (Red): `clearPanelType` **preserves** `terminalMemory` while still clearing `kind`
      and `config`; `setTerminalMemory` merges; a fresh panel inherits nothing (FR-007d).
- [x] **T029** Add `Panel.terminalMemory` + `setTerminalMemory`; make `clearPanelType` preserve it.
- [x] **T030** Renderer: promote observations into `terminalMemory` at terminal end, per the rule.
- [x] **T031** Pre-fill the empty-panel form from `terminalMemory` (FR-007a) — flavour, shell arguments,
      startup command, checkbox.
- [ ] **T032** E2E: the five memory rows in quickstart Scenario 3, plus the memory-off row.
- [x] **T033** E2E: closing a terminal returns a **pre-filled** form; editing it changes what next runs.

## Phase E — Directory memory (US3 · FR-027–FR-032)

- [x] **T034** Unit (Red): a remembered cwd that is missing, not a directory, or outside the project root
      falls back to the root (FR-030); absent memory → root (FR-031).
- [x] **T035** Persist `lastCwd` from the existing `terminal.cwd` stream; use it as the start directory.
- [x] **T036** E2E: directory memory proven against the persisted layout for EVERY built-in flavour,
      plus the opt-out and the integration-disabled gating (FR-027a/FR-032e).

## Phase F — Observability (FR-026a–e)

- [x] **T037** Unit (Red): a capture decision produces a diagnostics record naming the rule that fired,
      including the no-op cases (FR-026a).
- [x] **T038** Implement logging; raise a toast **only** for machinery failures not visible in the
      terminal (FR-026b), never for the ordinary nothing-was-running no-op (FR-026c), never blocking
      teardown (FR-026d), and silently skipped when there is no surface (FR-026e).

## Phase G — Coverage (FR-042–FR-045, closes #113)

- [x] **T039** E2E: a **user-defined** flavour (a distinct id pointing at `cmd.exe`) actually launches —
      the gap #113 records.
- [x] **T040** E2E: the same user-defined flavour launches **with** a startup command (FR-043).
- [x] **T041** Full gates: lint, typecheck, unit, integration, contract, E2E. Compare E2E against the
      recorded 9-failure baseline, not against zero.

---

## Dependencies

A → B → C → D. E depends on C's observation plumbing only. F depends on D. G last.
T007/T008 and T017/T018 are the parallelisable pure-logic pairs.

---

## Status at hand-off

**Shipped and verified**: Phases A–G. lint 0 errors, typecheck clean, **unit 1551**, integration
360, contract 60, new E2E spec 6/6.

Full E2E: **6 failed, 6 flaky, 561 passed**, against a pre-existing baseline of **9 failed, 8
flaky, 550 passed** recorded before any change. All 6 remaining failures are in that original 9 —
no new failure was introduced.

### An adversarial review found five Criticals, all real

This is the part worth reading. The feature passed 1546 unit tests and a 6/6 E2E spec while its
headline capability was **broken in the common cases**. An independent reviewer with no memory of
the implementation found:

1. **Command memory was dead for every de-elevated terminal.** `PtyAgentHost` identifies a terminal
   by a synthetic counter, not an OS pid, so the real ppids coming back from the agent could never
   match and `foregroundCommand` returned null forever — on an elevated daemon, which is throng's
   own normal case. Fixed by re-parenting direct children onto the key at the agent seam.
2. **The renderer subscribed to command notifications at the first terminal END**, by which point
   every notification had been dropped — so the first capture of every session silently saved
   nothing. Fixed by arming the bridge on mount.
3. **Nothing survived an abrupt end.** Observations lived only in memory and were persisted solely
   at teardown, which defeats the entire reason FR-019 asks for continuous tracking. `US2 scenario
   7` and `SC-004` could not pass. Fixed by persisting the observation as it changes and resolving
   a stranded one on next mount.
4. **`terminals.commandPollMs` was inert** — the daemon read `%APPDATA%	hrong\settings.json`,
   but the config root is `%USERPROFILE%\.throng[-dev]`. Every launch hit ENOENT, the catch
   swallowed it, and the slider changed nothing. Fixed by passing the resolved root to the daemon.
5. **Cost scaled linearly with terminal count** — one `powershell.exe` spawn per terminal per
   interval, against a docstring claiming the opposite. FR-019a and SC-011 were both false. Fixed
   by sharing one process snapshot across a polling pass.

Also fixed: a stale cross-terminal capture that could re-promote an already-exited command
(FR-017), a `writeOnReady` failure that was swallowed with a comment claiming the terminal would
show it (it would not), the missing `readTerminalPanelConfig` migration tests, the orphaned
`Terminals` settings group, remaining `Default params` labels, dead exports, and a literal NUL byte
that made `command-capture.test.ts` binary and invisible to diff and review.

**The lesson recorded honestly**: the gap listed below as "coverage, not behaviour" was hiding
broken behaviour. Unit tests over `captureDecision` proved the rule while the value fed to it was
never produced. A contract test for `listChildProcesses` — deferred as T020 — is precisely what
would have caught the first Critical; it is now written.

### Still open

- **T024** — no integration test for the poll's timer wiring.
- **T032 / T036** — the five memory rows and the two-panel directory restore are still not driven
  through the real app end to end. Given what the review found, these are the highest-value
  remaining work, not a nicety.
