# Implementation Plan: Terminal Render & Input Fidelity

**Branch**: `feature/S028-I162-terminal-render-input-fidelity` | **Date**: 2026-07-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/028-terminal-render-input-fidelity/spec.md`

## Summary

Five v1.0.0 terminal defects, one complaint: the terminal needs a nudge before it behaves.
[research.md](./research.md) establishes the causes by reading the shipped paths, and the answer for
#162 is not what the issue assumed.

**An inactive tab is not hidden — it is unmounted** (`tab-group.tsx:738` renders only the active
tab). So a tab switch disposes every terminal view and rebuilds it, and the rebuild reconstructs the
screen by replaying a **raw 64 KB byte tail** of session output. That tail is sliced at a byte count,
so it can begin mid-escape-sequence; and once a full-screen program's `CSI ?1049h` has aged out of the
window, the replay paints absolute-positioned deltas onto the **normal** buffer. Nothing corrects it,
because `recomputeGrid` sends no PTY resize when the grid has not moved — so the program is never told
to redraw and keeps sending deltas. A divider drag cures it because a grid change is a SIGWINCH.

The fix is therefore: **ask the program to repaint instead of reconstructing its screen from bytes.**
One daemon operation (`terminal.repaint`) nudges the grid and restores it, forcing a full redraw at
the correct size. The automatic path (#162, on attach) and the manual action (#163, menus + `Ctrl+F5`)
share it. The byte tail additionally gets a safe cut so a replay never starts mid-sequence.
#187 is a separate design gap — the wheel is inert on the alternate screen — closed by translating
notches to arrow keys. #200 is fenced and instrumented, then fixed at the focus seam. #198 extends its
existing fences to the alternate screen and is gated on the maintainer's own check.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Node 22, ES modules

**Primary Dependencies**: Electron 40, React 18, @xterm/xterm 6 (+ addon-fit, addon-search,
addon-web-links), Vite 7 (renderer), node-pty (daemon PTY host)

**Storage**: per-user local config + SQLite-backed daemon state; this feature adds none

**Testing**: vitest projects `unit` / `integration` / `contract`; Playwright-Electron for E2E
(`packages/ui/tests/e2e`). No component-test stack exists — renderer logic is proven by pure-logic
unit tests over extracted decision functions plus real-app E2E

**Target Platform**: Windows 11 first (ConPTY); OS specifics stay behind Principle II abstractions

**Project Type**: Electron desktop app, npm workspaces monorepo (`packages/core`, `daemon`, `ui`)

**Performance Goals**: activation reconciliation ≤ ~16ms main-thread per activation for ≤4 terminals
and never blocking the switch (SC-012); no measurable regression under heavy output (SC-009)

**Constraints**: a view never sizes itself (008 FR-009/FR-010/FR-013 — the daemon owns the grid);
no input may be injected to force a redraw (FR-044); no scrollback, selection, cursor or focus loss
(FR-043)

**Scale/Scope**: 5 issues, 4 diagnosed defects, ~10 source files, 4 test layers

## Constitution Check

*GATE: checked before Phase 0 and re-checked after Phase 1 design.*

| Principle | Assessment |
|---|---|
| **III. Detached, tagged & persistent terminals** | PASS. `terminal.repaint` never spawns, kills or re-attaches a session; it resizes and restores. A repaint on a dead session is a no-op, so no path can resurrect or orphan a process. |
| **IV. Native terminal support & auto-detection** | PASS, with one recorded addition. `Ctrl+F5` is not in the reserved tier (`Ctrl+C/D/Z/A/E/W/U/K/R/L/Q`) and no shipped binding takes it, but it *is* a key a program could receive, so it joins the enumerated **shadowable exceptions** in the same increment (FR-008) — a MINOR constitution amendment. Bare `F5` is deliberately not taken (FR-049d). The wheel→arrow translation sends keys a real arrow press would send, so cross-flavour parity is unaffected. |
| **V. Test-first quality discipline** | PASS. Every defect gets a reproduction that fails first (FR-006/006a). The wide-search probes are deleted once they have done their job (FR-006d) but never a test that pins an invariant (FR-006e). UI changes ship with E2E. The #200 soak is opt-in by design (FR-024a) and stated as such rather than quietly skipped. |
| **VI. Simple, modern, discoverable UX** | PASS. "Refresh / redraw terminal" is a discrete panel action, so it takes a **menu item in both menus** (FR-040/041) with `Ctrl+F5` as an accelerator over them, never a substitute (FR-049c). |
| **XI. Dockable workspace / one document, one state** | PASS. The agreed grid stays the single authority; FR-004a narrows its *inputs* to visible views without letting any view size itself (FR-004c). |
| **Configuration-editor completeness** | PASS. The new command gets a keybinding descriptor so the preferences editor exposes it (FR-049). |
| **Themeable icon controls** | N/A — menu items, not icon buttons. |
| **Documentation currency** | Required: the redraw action and its chord are user-facing, so `docs/` and the README's shortcut coverage are updated in the same change. |

**No violations.** Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/028-terminal-render-input-fidelity/
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0 — the diagnosis, with the code evidence
├── data-model.md        # Phase 1 — entities and state
├── quickstart.md        # Phase 1 — how to validate it by hand
├── contracts/
│   └── terminal-repaint.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
packages/core/src/
├── config/keybindings.ts                 # + terminal.redraw → Ctrl+F5 (TERMINAL_ONLY)
├── config/keybinding-metadata.ts         # + editor descriptor for the new command
└── terminal/
    ├── scrollback-tail.ts                # NEW — safe cut for the replay tail
    └── wheel-decision.ts                 # NEW — pure wheel routing decision

packages/daemon/src/
└── terminal-service.ts                   # + terminal.repaint (grid nudge), safe tail on append

packages/ui/src/
├── main/preload + ipc                    # + terminal.repaint passthrough
└── renderer/terminal/
    ├── use-terminal.ts                   # repaint-on-attach, wheel handler, mouse-mode tracking,
    │                                     #   focus-on-pointerdown, diagnostics counters
    ├── terminal-panel.tsx                # + "Refresh / redraw terminal" in both menus
    └── diagnostics.ts                    # NEW — FR-009 counters

packages/ui/tests/
├── unit/          scrollback-tail, wheel-decision, mouse-mode tracking, menu model, keybindings
├── integration/   repaint routing, diagnostics counters
├── contract/      terminal.repaint RPC shape + no-op on a dead session
└── e2e/           terminal-tab-switch-render, terminal-redraw-action, terminal-wheel-altscreen,
                   terminal-input-idle (fast gate) + terminal-input-soak (opt-in),
                   terminal-link-once (extended to the alt screen)
```

**Structure Decision**: the existing three-package workspace. Pure decision functions go to
`@throng/core` so they are unit-testable without a DOM; the daemon owns the grid nudge because it owns
the PTY; the renderer only asks. This keeps Principle II intact — no OS specifics move into the
renderer.

## Phase ordering (FR-007a)

Each stage ends green and mergeable:

1. **Diagnosis fences** — reproductions that fail against master.
2. **P1**: #162 (repaint on attach + safe tail) and #200 (focus seam + fast gate).
3. **P2**: #187 (wheel) and #163 (menus + `Ctrl+F5` + constitution amendment).
4. **#198** — alt-screen fence; disposition gated on the maintainer (FR-055b).

## Complexity Tracking

No constitutional violations; nothing to justify.
