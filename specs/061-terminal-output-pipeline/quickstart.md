# Quickstart: Validating Terminal Output Pipeline

Automated checks use `td run`; see `docs/testing.md`. The full gate runs on `gate.yml` against the pushed branch.

## Automated

| Proves | Layer | Expected |
|---|---|---|
| FR-001a, SC-001, FR-062: nothing sent for a terminal with no view | Daemon integration, counting frames at a sink | Zero output frames over the sample |
| FR-005a: output resumes after a socket blip | Daemon integration | Output frames resume after `terminal.subscribe` |
| FR-001, FR-004, FR-005, FR-006: per-window delivery | Unit, `TerminalOutputRoutes` with fake contents | `send` only to routed windows |
| FR-010 – FR-012: no gap, no duplicate | Unit, `TerminalOutputGate` over every interleaving | Each position written once, in order |
| FR-016: limits | Unit, `RetainedOutput` | Latest 10,000 lines; 8 MB ceiling; `\r`-only output stays bounded |
| FR-020 – FR-025: batching | Unit, fake timers | Rate, cap, flush order, first chunk sent at once |
| FR-022: clears | Component, `terminal-clear-keeps-screen` extended | Same result batched as chunk by chunk |
| FR-041: sizing | Unit (clamp), one E2E at forced scale factors | Every row inside the panel |
| SC-007, SC-010: returning to a tab | One E2E | Numbered lines once, in order; latest 10,000 kept |

## Measurement (FR-060, FR-061)

Run `packages/ui/tests/measure/` with its own Playwright config, one visible terminal and N busy background ones
(N = 1, then 20), before any change and after each landing. Add the numbers, machine and load to `spec.md`.

## By hand

1. Run `seq 1 20000` in a terminal, switch to another project and back: the panel holds lines 10001 to 20000 and scrolls
   to the top of them.
2. With a busy program in a background tab, return to it: content appears with no visible scrolling past.
3. Put one of two terminals in a tab into Focus Mode while the other prints, then leave Focus Mode: the output is there.
4. Run `cls` or `clear` in the middle of output: the screen clears and later output stays.
5. On the #162 work machine, maximise a single terminal running Claude Code: output, cursor and typed text stay visible
   without resizing.
