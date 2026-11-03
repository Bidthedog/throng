# Implementation Plan: Linux Support in Dev Mode

**Branch**: `feature/S062-I23-linux-dev-mode` | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/062-linux-dev-mode/spec.md`

## Summary

throng gains a second platform implementation set beside Windows. A new `@throng/platform-linux` package implements
every operating-system interface; a new `@throng/platform` package selects one set at startup and refuses an unimplemented
platform; a new leaf `@throng/platform-node` holds the code both sets share. Pure core rules that differ by platform (path
identity, IPC addressing, shipped bindings) read one set of host traits configured at each process's composition root, with
Windows values as the default, so Windows behaviour and every existing Windows test are untouched by construction. Linux gets
its own contract, integration and E2E suites and its own CI lanes running on a real X server under a window manager, with the
Electron sandbox on through a scoped AppArmor profile.

## Technical Context

**Language/Version**: TypeScript 7 (`@typescript/native`), Node ≥ 22.12 (CI 24), Electron 44.

**Primary Dependencies**: node-pty (already portable), better-sqlite3, xterm.js 6, InversifyJS 8. No new runtime dependency:
Linux facts come from `/proc`, `fc-list`, `gio`/`xdg-open` through Electron's `shell`, and the freedesktop Trash layout.

**Storage**: SQLite at `$XDG_DATA_HOME/throng[-dev]/throng.db`; settings at `$XDG_CONFIG_HOME/throng[-dev]` (FR-013).

**Testing**: vitest (`unit`, `unit-isolated`, `component`, `integration`, `contract`), Playwright-Electron E2E with `@core` and
`@extended` lanes, plus a new `@linux` category tag for Linux-only specs.

**Target Platform**: Ubuntu 26.04 LTS x86-64, GNOME on Wayland through XWayland (reference); `ubuntu-24.04` hosted runner in CI,
which has the same AppArmor user-namespace restriction, so CI proves the profile script as well as the suite.

**Project Type**: Electron desktop application, npm-workspaces monorepo.

**Performance Goals**: SC-006, under 100 ms typed-character latency with 10 terminals. `/proc` sampling stays within 055's
collector budget.

**Constraints**: FR-003 (sandbox stays on), FR-009 (no Windows change), FR-007 (no OS branches in core logic), Principle III (no
orphans), Principle V (lowest layer owes the assertion).

**Scale/Scope**: 24 platform source files have Linux counterparts; 1652 test files exist, of which 365 mention a Windows form;
Windows-only tests get a stated guard (FR-042), neutral ones get fixed rather than skipped.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design: unchanged.*

| Principle | Result | How |
|---|---|---|
| I Project-first | Pass | No project model change. |
| II Platform-abstracted core; both OSes delivered together | Pass, this feature is the closing work | Every OS service sits behind a core interface; macOS gets seams and a refusal, not an implementation (FR-049, FR-050). |
| III Terminal hygiene | Pass | Linux process-tree end proved by process-level tests against `/proc` (R6). |
| IV Keyboard belongs to the terminal | Pass | Linux changes only desktop-reserved chords; each replacement is checked against both reserved tiers (R10). No new shadowable exception. |
| V Test layering | Pass | Contract suites per seam; E2E only for what needs a window. New E2E specs pay into the ratchet. |
| VI Reachability | Pass | No command is removed. Absent capabilities hide their control only where the capability is absent. |
| VIII SOLID/DRY/YAGNI | Pass with one record below | New packages each have a second consumer on day one. |
| IX DI and composition root | **Justified violation** under the constitution's Complexity Tracking rule, as 043 did for `IFileSystem` | Host traits are one module-level value set once per process, and `host-traits-entries.test.ts` proves every entry sets it. |
| X Externalised configuration | Pass | Wayland mode is a setting with editor metadata; endpoints and folders keep their `THRONG_*` overrides. |
| XI, XII | Pass | No panel or notice model change; failures reach the existing failure model. |

Governing requirements searched before writing: 020 FR-013 (per-user pipe), 050 FR-018f (replace-mode label), 055 FR-010/FR-011
(collector seam), 016 FR-017e (bindings by platform), 058 (instance lock namespace). None is contradicted; the spec's
Supersessions section records the three it replaces.

## Project Structure

### Documentation (this feature)

```text
specs/062-linux-dev-mode/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── platform-services.md
│   ├── host-traits.md
│   └── ci-lanes.md
└── tasks.md
```

### Source Code

```text
packages/
├── platform-node/        NEW  shared Node code: user context, file log, off-loop exec, process tree, /proc-free helpers
├── platform-linux/       NEW  one class per core interface, plus trash restore and orphan snapshot
│   └── tests/{contract,integration}/
├── platform/             NEW  selectPlatform(): Windows | Linux | refusal
├── platform-windows/          re-exports what moved to platform-node; behaviour unchanged
├── core/src/platform/    NEW  host traits; path-id, pipe-endpoint, keybindings read them
├── core/src/config/keybindings.ts   LINUX_BINDINGS beside WINDOWS_BINDINGS
├── core/src/terminal/    recipes, history and default args gain bash, zsh, fish, sh, dash
├── core/src/testing/     shared contracts rewritten in behaviour terms where they named Windows spellings
├── daemon/src/           composition root and agent entry select through @throng/platform; reap-orphans gets a Linux snapshot
└── ui/src/main/          composition root, instance paths, trash restore, root refusal, Wayland switch
scripts/
├── linux/apparmor-profile.sh   NEW  install, status, remove
├── preflight-start.mjs         NEW  plain-language refusal before Electron aborts
└── gate.mjs, playwright-global-*.mjs, run-e2e-local.mjs   platform branches for process clean-up
.github/workflows/{ci.yml,gate.yml}   Linux jobs added; Windows jobs byte-identical
```

**Structure Decision**: extend the existing `platform-*` package pattern. Selection lives in its own package so `platform-windows`
and `platform-linux` never see each other and neither composition root branches on the OS.

## Delivery order

1. **Foundation**: packages, selection, host traits, data folders, endpoints. Windows suite stays green at each commit.
2. **Daemon and terminals**: Linux PTY host, shells, cwd, orphan reap, root refusal.
3. **Window**: AppArmor script, preflight, XWayland default, app starts and stays up.
4. **Files**: path identity, trash and restore, links, permissions, wording.
5. **Bindings**, fonts, then Resource Monitor.
6. **Suites and CI**: neutral tests made portable, Windows tests guarded, Linux suites and lanes added.
7. **Docs and known differences list**.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Principle IX: `core/src/platform/host-traits.ts` is module-level state set once per process | `samePath`, `normaliseForCompare`, `defaultPipeName` and the shipped bindings are pure functions with dozens of call sites inside reducers, renderer state and module-level constants | Threading a parameter through every caller rewrites Windows code paths for no Windows benefit and risks FR-009. Inferring case rules from the path's spelling forecloses macOS, which is POSIX-rooted and case-insensitive by default (FR-049). |
| Three new packages | Sharing, Linux code and selection have opposite dependency directions | Linux importing `platform-windows` breaks Principle II; selection inside either platform package is a cycle. |
