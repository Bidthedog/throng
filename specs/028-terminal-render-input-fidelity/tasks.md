# Tasks: Terminal Render & Input Fidelity (028)

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

Test layers in this repo: `unit` / `integration` / `contract` (vitest projects) and
Playwright-Electron `e2e`. There is no component-test stack, so renderer behaviour is proven by pure
decision functions (unit) plus the real app (e2e). Red before green throughout.

`[P]` = parallelisable with the task above it.

---

## Phase 1 — Diagnosis fences (must fail against master)

- [x] **T001** E2E `terminal-tab-switch-render.e2e.ts`: two tabs, terminals of **different widths**
      (one full-tab, one split), a program painting full-width output in each; switch back and forth
      and assert the newly-shown terminal's rendered rows match its buffer and wrap at its own width.
      Must fail on master. (FR-006, FR-019a, US1)
- [x] **T002** [P] E2E `terminal-wheel-altscreen.e2e.ts`: on the alternate screen with no mouse
      reporting, a wheel notch moves the program's view. Must fail on master. (FR-030/035, US3)
- [x] **T003** [P] E2E `terminal-input-idle.e2e.ts`: activate an idled panel and type in the same
      tick; assert the shell received every character. Deterministic, not a soak. (FR-024a/b, US2)
- [x] **T004** [P] E2E `terminal-link-once.e2e.ts` **extended**: drive the terminal to the alternate
      screen, emit a hyperlink directly, Ctrl+click it, assert exactly one open at the seam. Keep the
      four existing normal-screen fences untouched. (FR-050/055a, US5)
- [x] **T005** Record in `research.md` which probes reddened and which did not, then delete the
      probes that produced no useful failure (FR-006d/006e) and note the ruled-out conditions for the
      issue comments (FR-006f).

## Phase 2 — Core decision functions (unit, pure)

- [x] **T006** Unit `scrollback-tail.test.ts` → `packages/core/src/terminal/scrollback-tail.ts`:
      `appendScrollback` trims to the cap, advances the cut past the next `\n` so a retained tail never
      begins mid-sequence, and yields empty rather than an arbitrary offset when the window holds no
      newline. Cases: CSI straddling the boundary, OSC straddling the boundary, exact-boundary
      newline, under-cap no-op. (data-model)
- [x] **T007** [P] Unit `wheel-decision.test.ts` → `packages/core/src/terminal/wheel-decision.ts`:
      the four-way table (zoom / program / arrows / viewport). (FR-030/032/033/035/035a)
- [x] **T008** [P] Unit: DEC mouse-mode tracking (1000/1002/1003/1006 set and reset, unknown modes
      ignored, reset on session end) extending the existing private-mode helper in `@throng/core`.
      (FR-032)

## Phase 3 — `terminal.repaint` (contract + daemon)

- [x] **T009** Contract `terminal-repaint.contract.test.ts`: unknown panel → ok; exited session → ok
      with **no** `host.resize`; running session → exactly two resizes, the second equal to the
      original grid, `session.grid` unchanged, **no** grid event published, **no** PTY write.
      (contracts/terminal-repaint.md)
- [x] **T010** Implement `terminal.repaint` in `packages/daemon/src/terminal-service.ts` per the
      contract: nudge `rows - 1` (clamped at `MIN_GRID`) then restore. Register on the RPC router.
- [x] **T011** Wire the daemon's scrollback append to `appendScrollback` from T006, replacing the raw
      `slice(-MAX_SCROLLBACK)`.
- [x] **T012** Integration: a replay whose window has lost the alt-screen switch no longer paints
      absolute-positioned deltas onto the normal buffer.

## Phase 4 — Renderer: repaint on attach (#162)

- [x] **T013** Expose `terminal.repaint` through the preload/IPC seam (`packages/ui/src/main`), typed
      on the `window.throng.terminal` bridge.
- [x] **T014** `use-terminal.ts`: after a successful attach to a **running** session, request one
      repaint. Exactly one per attach; never on a cold start (nothing has painted yet), never on an
      exited session. (FR-017/017a, FR-004b)
- [x] **T015** Integration: one attach → exactly one repaint request; a cold start → none.
- [x] **T016** Make T001 pass. Full E2E re-run of the terminal suite for collateral damage.

## Phase 5 — Renderer: input fidelity (#200)

- [x] **T017** `diagnostics.ts` (FR-009): integer counters for reconciliation triggers and
      `input.written` / `input.acked`, exposed on `window.__throngTerminalDiagnostics`, no allocation
      per keystroke, nothing rendered. Unit-test the counter module.
- [x] **T018** Focus seam: the panel's own pointer-down synchronously moves focus into the terminal's
      input surface, so a key pressed in the same tick cannot land on `document.body`. (FR-020/021/025)
- [x] **T019** Make T003 pass; assert via the counters that written == acked and that the **backstop
      counter did not advance** (FR-014b, FR-009b).
- [x] **T020** Opt-in soak `terminal-input-soak.e2e.ts`: 50 repetitions per flavour, gated behind an
      env flag, printing its repetition count and flavours. (FR-024a/024c, SC-003)

## Phase 6 — Renderer: wheel (#187)

- [x] **T021** Track mouse-reporting modes in `use-terminal.ts` at the existing `CSI ? … h/l` snoop
      (T008's helper).
- [x] **T022** Attach a custom wheel handler routing by T007's decision; on `arrows`, send three
      arrow presses per notch, indistinguishable from a real arrow key, and **never** on the normal
      buffer (FR-035c).
- [x] **T023** Make T002 pass; add E2E coverage that a wheel at a shell prompt types nothing
      (FR-035c) and that Ctrl+wheel zoom is unaffected (FR-033).

## Phase 7 — The redraw action (#163)

- [x] **T024** Register command `terminal.redraw` in `packages/core/src/config/keybindings.ts` with
      default `Ctrl+F5`, scope `TERMINAL_ONLY`; add its editor descriptor so the preferences editor
      exposes it. Unit-test the binding and scope, and that bare `F5` is not taken (FR-049a/d).
- [x] **T025** Add "Refresh / redraw terminal" to **both** the terminal's own context menu and the
      panel header menu, targeting exactly one terminal (FR-040/040a/041), landing in a sensible
      section. Unit-test the menu model.
- [x] **T026** E2E `terminal-redraw-action.e2e.ts`: present in both menus; corrects the T001 condition;
      scrollback length, selection, cursor, focus, panel sizes all unchanged; a running program
      uninterrupted; nothing typed; repeat-safe on a healthy terminal; inert in editor and tree.
      (FR-042–047, FR-049a, US4)
- [x] **T027** Constitution amendment (FR-008): add `Ctrl+F5` to Principle IV's enumerated shadowable
      exceptions, MINOR bump, with the sync-impact report entry.

## Phase 8 — #198 and close-out

- [x] **T028** Make T004 pass or, if the condition cannot be reached, state the gap plainly in the
      artifacts and prepare the maintainer briefing: the original report, both measurements, the
      ruled-out mechanism, the untested condition, and exactly what to do and look for (FR-055a–c).
- [x] **T028a** Backstop disposition (FR-014/014a/014c): with reconciliation now event-driven, the 2s
      repaint is replaced by a slower visible-only backstop whose period is **stated**, or removed.
      Justify the choice against the measured cause in `research.md`. Unit-test the period is what the
      spec says it is.
- [x] **T028b** Activation cost (SC-012): measure the reconciliation's main-thread cost for a tab of
      four terminals and assert it stays within one frame and never blocks the switch.
- [x] **T029** Documentation currency: `docs/` and README updated for the redraw action and its chord.
- [x] **T030** Full gates — lint, typecheck, unit + integration + contract, full E2E — captured once
      and read (Principle V). Any flake named, not rounded up.
- [x] **T031** Issue comments: the diagnosis on #162, the wheel finding on #187, the input finding on
      #200, and the #198 briefing (FR-002, FR-006f).
