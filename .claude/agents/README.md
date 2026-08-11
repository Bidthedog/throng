# Repo-local specialist agents

Eleven agents, one per area throng actually works in. Each carries the constitutional rules, the file
map and the traps that area has already been bitten by, so a subagent starts where the last session
finished rather than rediscovering `schema-guard.ts` or the blind-Enter trap.

| Agent | Owns |
|---|---|
| `throng-core-architecture` | `@throng/core`, abstractions/ports, DI and composition roots, package boundaries |
| `throng-daemon-persistence` | daemon process, named-pipe RPC, `ipc-contract`, SQLite schema and migrations |
| `throng-terminal-pty` | node-pty/ConPTY, PTY agent, elevation, orphan hygiene, xterm, terminal keyboard |
| `throng-renderer-ui` | React renderer, panes/tabs/panels, menus, theming and icon controls |
| `throng-editor-documents` | CodeMirror 6, document authority, dirty/undo/save, language and indent |
| `throng-config-preferences` | settings, keybindings, themes, metadata registries, preferences editors |
| `throng-explorer-fileops` | explorer tree, watchers, file operations, recycle bin, fileop undo |
| `throng-failure-notices` | failure-cause model, notifications, banners, exit notices, diagnostics logs |
| `throng-e2e-harness` | Playwright-on-Electron suite, harness, shard/parallel plans, flake diagnosis |
| `throng-spec-governance` | Spec Kit artifacts, constitution amendments, FR traceability, docs currency |
| `throng-build-release` | tsc/Vite build, electron-builder + NSIS, CI workflows, verification and publish gates |

## How these relate to skills

Skills own **process** and run in the main session; agents own **area knowledge** and run in their
own context. Where they overlap, the skill wins:

- Running any suite → `throng-testing`, then `running-tests`. The E2E agent describes how specs are
  built, not how runs are conducted.
- Branch, worktree, PR and issue mechanics → `branch-naming`, `worktree-bootstrap`, `worktree-clean`,
  `branch-sync`, `github-issues`, `github-issue-state`.
- Spec Kit commands → the `/speckit-*` skills. `throng-spec-governance` carries the judgement those
  commands assume, not a reimplementation of them.

## Maintaining them

An agent file is only worth its context if it is true. When an area's rules change — a constitution
amendment, a new enforced test, a trap discovered the hard way — update the owning agent in the same
change, the same way `docs/testing.md` is kept current.
