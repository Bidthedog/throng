# Tasks: Terminal Reload, Reconnect and Defaults

**Feature**: `specs/039-terminal-reload-and-defaults/` | **Branch**: `feature/S039-I293-terminal-reload-and-defaults`

**Format**: `[ID] [P?] [Story] Description` — `[P]` means parallelisable (different files, no ordering
dependency). Every implementation task is preceded by its failing test (TDD), and the test is shown
red before the implementation is written.

**Test layer rule**: write each test at the **lowest layer that reproduces the behaviour**. Most of
this feature is settings resolution and is a unit test; the placeholder is a component test; only
what genuinely needs a window and a real shell reaches E2E.

---

## Phase 1: Setup

- [ ] **T001** Confirm the worktree typechecks and the unit layer is green before adding anything, so
      any red from here is ours. `npm run typecheck && npm run test:unit`. Requires the test baton.

---

## Phase 2: Foundational — the four settings (BLOCKING)

All four settings land in one pass across five touchpoints. Every story depends on this phase; doing
it per story would edit `app-settings.ts` three times and conflict with itself.

- [ ] **T010** Unit (Red): `DEFAULTS.terminals` exposes `defaultRememberCommand: false`,
      `defaultRememberDirectory: true`, `defaultRunAsAdmin: false`, `reloadMode: 'automatic'`.
      → `packages/core/tests/unit/app-settings.test.ts`
- [ ] **T011** Unit (Red): `terminalSettings()` falls back **per field** — a config supplying only
      `reloadMode` keeps the other three at their shipped values; a bad type falls back rather than
      throwing.
- [ ] **T012** Unit (Red): `cloneTerminals()` copies all four. *(A field missing here is dropped on a
      settings write — spec 032's territory.)*
- [ ] **T013** [P] Unit (Red): each of the four has a descriptor in `settings-metadata.ts` under
      `group: 'Terminal'`, with a label and a non-empty description; the FR-047 completeness test
      still passes.
- [ ] **T014** Implement T010–T013: `TerminalSettings` (`app-settings.ts:61`), `DEFAULTS.terminals`
      (`:~409`), `terminalSettings()` (`:622`), `cloneTerminals()` (`:678`), and four descriptors in
      `settings-metadata.ts` (`:558+`). Green T010–T013.
- [x] **T015** ~~Resolve OQ-2~~ — **decided (spec D-4)**: `reloadMode` is
      `control: 'select', allowedValues: ['automatic', 'manual']`, because it names both states and
      `select` is already the file's dominant pattern for a closed value set.

**Checkpoint**: four settings readable, writable, round-tripping, and visible in the settings editor.
No behaviour has changed yet.

---

## Phase 3: User Story 1 — New Panel defaults (#223) 🎯 MVP

**Goal**: the three checkboxes seed from preferences; an absent per-Panel value resolves to the
preference; 025 FR-015's safeguard is real again.

### Tests (Red first)

- [ ] **T020** Unit (Red): `readTerminalPanelConfig(raw, defaults)` resolves an **absent**
      `rememberCommand` to `defaults.defaultRememberCommand` — **not** to `true`. Explicit `true` and
      explicit `false` are both unchanged. (FR-005a, D-2)
      → `packages/core/tests/unit/terminal-memory.test.ts`
- [ ] **T021** Unit (Red): the same for `rememberDirectory` and `runAsAdmin` — resolution changes,
      observable behaviour does not, because their shipped defaults match today's literals.
- [ ] **T022** Unit (Red): **the FR-047a safeguard is in force.** On a clean config, a fresh terminal
      Panel with no memory resolves `rememberCommand` to `false`. 025 FR-047a permits a captured
      command to re-run with no prompt *only* while FR-015 is real, so this asserts the safeguard
      rather than trusting the requirement. **Explicitly requested; do not fold into T020.**
- [ ] **T023** Unit (Red): `terminalPanelType.defaults(ctx)` seeds the three form values from the
      preferences when `ctx.terminalMemory` is absent, and from the memory when it is present
      (FR-005, 025 FR-007a unchanged).
      → `packages/core/tests/unit/panel-type-descriptor.test.ts`
- [ ] **T024** [P] Unit (Red): the seeds are identical for every flavour — no per-flavour path
      (FR-003).
- [ ] **T025** [P] Component (Red): with the daemon unelevated and `defaultRunAsAdmin: true`, the New
      Panel admin control is still **disabled** (FR-008).
      → `packages/ui/tests/component/terminal-panel-type-inputs.test.ts`

### Implementation

- [ ] **T026** Change `readTerminalPanelConfig(raw)` → `readTerminalPanelConfig(raw, defaults)` and
      resolve absent values against the preferences. Update every call site to pass the settings.
- [ ] **T027** `terminalPanelType.defaults()` reads the preferences instead of the literals
      `'true'` / `'true'` / `'false'` (`panel-type.ts:139-143`).
- [ ] **T028** **Update the tests that pin the old default**, in the same commit as the supersession
      and citing it: `terminal-memory.test.ts:152`, `panel-type-descriptor.test.ts` (44, 55, 111, 119),
      `panel-type-form.test.ts` (46, 63, 89). These are the record of the behaviour being changed, not
      collateral.
- [ ] **T029** Delete the stale citation at `panel-type.ts:83` / `:139` — `parseTerminalConfig` does
      not exist. Replace with the real reason and a pointer to 039 FR-005a. (Spec *Supersessions*, and
      it is half of #307.)

**Checkpoint**: US1 independently shippable. #223's seven acceptance criteria testable.

---

## Phase 4: User Story 2 — Reload automatically or on demand (#293)

**Goal**: Manual mode starts no terminal and offers Reload on each dormant panel.

### Tests (Red first)

- [ ] **T030** Unit (Red): with `reloadMode: 'automatic'`, the decision function says "start" for
      every terminal on project open — today's behaviour, asserted so US2 cannot regress it (FR-021).
- [ ] **T031** Unit (Red): with `reloadMode: 'manual'`, it says "dormant" for every terminal
      (FR-022), and dormancy is **not** a failure state (FR-029).
- [ ] **T032** [P] Component (Red): a dormant terminal panel renders a placeholder naming the panel
      with a **Reload** affordance, and renders **no** failure banner (FR-023, FR-029).
      → `packages/ui/tests/component/`
- [ ] **T033** [P] Unit (Red): the Reload action is registered as a **command**, so it has a menu item
      as well as the button (FR-024).
- [ ] **T034** Unit (Red): reloading a dormant terminal goes through the **same** start path an
      automatic reload uses (FR-025).
- [ ] **T035** Unit (Red): a dormant Panel serialises with its name, type and layout position, and
      still dormant, across a save/load round trip (FR-027). Resolve **OQ-3** first.
- [ ] **T036** E2E (Red) — **the only E2E US2 earns**: with Manual selected, opening a project starts
      **zero** shells and zero `conhost` processes (FR-026). Nothing below this layer can observe a
      real process table. Tag `@extended @terminal`; add to `parallel-plan.json` only if it does not
      drive a real long-running shell.

### Implementation

- [ ] **T037** The reload decision reads `reloadMode` at project open (FR-029a — next open, no restart).
- [ ] **T038** The dormant panel state and its placeholder; Reload command + menu item; the shared
      start path (FR-023 – FR-025).
- [ ] **T039** Persist dormancy with the Panel (FR-027); a project switch away and back does not wake
      it (FR-028).

**Checkpoint**: US2 independently shippable.

---

## Phase 5: User Story 3 — Reconnect when the path returns (#237)

**Goal**: a terminal that failed on an unresolvable cwd starts itself when the path returns.

### Tests (Red first)

- [ ] **T040** Unit (Red): a start that fails because the cwd could not be resolved arms a watch on
      that directory, or its nearest existing ancestor (FR-030).
- [ ] **T041** Unit (Red): a start that fails for **any other** reason — missing shell binary,
      permission denied — arms **no** watch and never retries (FR-035). *The anti-thrash assertion.*
- [ ] **T042** Unit (Red): the watch fires **at most one** retry (FR-030, bounded).
- [ ] **T043** Unit (Red): the watch is disposed when the terminal starts by any route, when the Panel
      is destroyed, and when the project closes (FR-042). *No leaked watches.*
- [ ] **T044** Unit (Red): recovery reuses the Panel's remembered type and configuration — no
      regression to #204 / 029 FR-004a (FR-034).
- [ ] **T045** Unit (Red): a **dormant** terminal is not started by a path-availability event
      (FR-036). *The US2 × US3 interaction; neither issue could have stated it alone.*
- [ ] **T046** Unit (Red): a path event in project A starts no terminal in project B (FR-037,
      Principle I).
- [ ] **T047** Unit (Red): recovery raises **no** per-panel notice (FR-033), and the failure banner
      clears when it succeeds (FR-038).
- [ ] **T048** Integration (Red): terminals in tabs **never rendered in this session** recover
      (FR-032). This is the criterion that rules out the mount-time pull route, so it must be asserted
      somewhere that can hold unrendered tabs.
- [ ] **T049** E2E (Red) — **only if** T040–T048 cannot demonstrate it: a real terminal recovers in
      the directory it was configured for after the folder is restored (FR-031). State the reason
      before writing it; a real filesystem event and a real shell may make this the lowest layer that
      reproduces.

### Implementation

- [ ] **T050** Arm the watch on a cwd-resolution failure only; nearest existing ancestor when the
      directory itself is absent (FR-030, FR-035).
- [ ] **T051** One bounded retry through the ordinary start path — not a shortcut through the daemon
      (FR-041); reuse the remembered config (FR-034).
- [ ] **T052** Dispose on start, destroy and project close (FR-042).
- [ ] **T053** Quiet: no per-panel notice; banner clears on success (FR-033, FR-038). ↻ Retry
      unchanged (FR-039).
- [ ] **T054** Say in the UI that this is a fresh shell, not a resumed session, where that is not
      self-evident (FR-040).

**Checkpoint**: all three stories complete.

---

## Phase 6: Polish & cross-cutting

- [ ] **T060** Confirm no new setting is inert — each has a reader outside the config layer (FR-051,
      and do not hand #108 a counter-example).
- [ ] **T061** E2E tag audit: every new E2E test carries a significance tag (`@core` / `@extended`)
      **and** a category tag, or `e2e-tags.test.ts` fails the build. Re-seed
      `packages/ui/tests/e2e/e2e-budget.json` in the same commit if the count moves.
- [ ] **T062** Add any preferences-window or context-menu spec to
      `packages/ui/tests/e2e/parallel-plan.json`, or `tier-plan.test.ts` fails the build.
- [ ] **T063** Update `docs/` for the four new settings and the dormant state.
- [ ] **T064** **Rebase onto spec 038** (#290 / #279 / #280) once it lands, before opening the PR.
      Expect conflicts in `settings-metadata.ts` and the terminal panel lifecycle.
- [ ] **T065** `npm run gate` — the only thing that establishes done-ness. **Ask the supervisor for
      the baton first**; ~18 min for E2E alone and two other sessions share this machine. Quote the
      stage summary when reporting.

---

## Dependencies

```
Phase 1 → Phase 2 (blocking, all stories)
           ├─ Phase 3 (US1) ─┐
           ├─ Phase 4 (US2) ─┤→ Phase 6
           └─ Phase 5 (US3) ─┘   (US3's T045 depends on US2's dormant state)
```

- **US1** is independent of US2 and US3 and is the MVP.
- **US2** is independent of US1 and US3.
- **US3** depends on **US2** for FR-036 only (a dormant terminal must not be woken). Everything else
  in US3 is independent.
- `[P]` tasks within a phase touch different files and may run together.

## Notes

- **The baton is machine-wide.** One test, lint, typecheck or build command at a time across all
  three live sessions. Take it, use it, release promptly.
- **A stale `packages/core/dist` makes E2E disagree with unit tests about a constant** — vitest
  resolves `@throng/core` to source, the Electron app loads `dist`. If that happens:
  `rm packages/core/tsconfig.tsbuildinfo && rm -rf packages/core/dist`, rebuild.
- **T028 is not optional tidying.** Those tests are correct today; they change because the spec says
  why, in the same commit as the supersession.
