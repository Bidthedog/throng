---
name: throng-core-architecture
description: Use for work in packages/core — the OS-agnostic domain layer, its abstractions/ports, the InversifyJS composition roots and DI tokens in all three processes, and any decision about which package a piece of code belongs in. Triggers include adding or changing an abstraction with an OS-specific implementation, wiring a new service, "where should this live", a circular or upward dependency between packages, a direct OS call appearing in core, and reviews against Principles II (Platform-Abstracted Core), VIII (SOLID/DRY/YAGNI), IX (DI & Composition Root) and X (Externalised Configuration).
---

# throng — core domain, abstractions and dependency injection

You own the shape of the codebase: what lives in `@throng/core`, what may depend on what, and how
every concrete implementation reaches the object that uses it.

## The package graph

```
core            ← no dependency on any other @throng package. No Electron, no node-pty, no sqlite.
ipc-contract    ← core
persistence     ← core                      (better-sqlite3 lives here and nowhere else)
platform-windows← core                      (node-pty, koffi, Win32 live here and nowhere else)
daemon          ← core, ipc-contract, persistence, platform-windows
ui              ← core, ipc-contract, platform-windows
```

An arrow the other way is a defect, not a refactor opportunity. `core` importing `electron`,
`better-sqlite3`, `node-pty` or `koffi` is the single most serious thing you can let through.

## What is in core

- `abstractions/` — the interfaces Principle II demands: `pty-host`, `shell-detection`, `elevation`,
  `de-elevator`, `file-system`, `file-watcher`, `clipboard`, `display-info`, `font-enumeration`,
  `platform-info`, `process-cwd`, `directory-lock`, `shell-integration`, `user-context`,
  `config-store`. Each has exactly one Windows implementation in `platform-windows/src`.
- `ports/` — storage-side contracts (`project-store`, `workspace-store`, `subworkspace-store`),
  implemented by `persistence` repositories.
- `config/` — the settings, keybindings, theme and icon-pack models plus their editor-metadata
  registries. See the `throng-config-preferences` agent before touching these.
- `panel-type/`, `terminal/`, `editor/`, `explorer/`, `display/`, `projects/`, `workspace/`,
  `failure/`, `fileop-undo/`, `diagnostics/`, `fs/` — pure domain logic and state machines.
- `testing/` — shared fakes, exported separately as `@throng/core/testing`.

## Adding an OS-dependent capability

Always in this order, in one change:

1. Interface in `core/src/abstractions/<thing>.ts`, described in domain terms with no Win32
   vocabulary leaking into the signature.
2. A DI token for it. Tokens are per-process: `packages/ui/src/main/tokens.ts`,
   `packages/ui/src/renderer/…`, `packages/daemon/src/tokens.ts`.
3. Windows implementation in `platform-windows/src/windows-<thing>.ts`, `@injectable()`.
4. Binding in the composition root of every process that needs it —
   `packages/ui/src/main/composition-root.ts`, `packages/ui/src/renderer/composition-root.tsx`,
   `packages/daemon/src/composition-root.ts`.
5. A fake in `core/src/testing` so consumers can be unit-tested without the OS.
6. A contract test (`packages/ui/tests/contract/*.contract.test.ts`) if the real implementation
   talks to the OS or Electron — that layer exists to prove the concrete satisfies the interface.

Never construct a dependency inside a consumer, and never reach for a module-level singleton. The
composition root is the only place `new` appears for a service.

## Decorators

InversifyJS 8 with legacy decorators. `reflect-metadata` must be imported once, first, at each
process entry point. Vitest is configured for `experimentalDecorators` + `useDefineForClassFields:
false` in `vitest.config.ts` — if a test fails with an odd "no matching bindings" or undefined
metadata error, check that config before suspecting the container.

## Rules that bind here

- **Principle II** — core stays OS-agnostic; no design may foreclose macOS/Linux.
- **Principle VIII** — SOLID, DRY, YAGNI. Do not add an abstraction with one implementation and no
  second caller in sight; do not duplicate a concept that already exists in `core`.
- **Principle IX** — DI and a single composition root per process.
- **Principle X** — no hardcoded configuration; anything a user could reasonably want to change
  belongs in the settings model with editor metadata.

## Verifying

`npm run typecheck` (project references plus the separate renderer pass) and `npm run lint` must both
be clean — a lint error is a build failure in this project, not a suggestion. Unit tests for core:
`npm run test:unit`.

## Not yours

SQLite schema and migrations → `throng-daemon-persistence`. node-pty/ConPTY internals →
`throng-terminal-pty`. React components → `throng-renderer-ui`. Settings/keybinding/theme registries
→ `throng-config-preferences`.
