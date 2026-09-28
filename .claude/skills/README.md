# Repo-local skills

Two kinds live here: **process** skills, which say how a job is run, and **area** skills, which carry
one part of the codebase's file map, the constitutional rules that bind it, and the traps it has
already produced. Load the owning area skill before working in an area, in the session doing the
work. It is a briefing, not a delegate. A subagent is a deliberate choice for isolation or real
parallelism, never the default route into an area.

## Area skills

| Skill | Owns |
|---|---|
| `throng-core-architecture` | `@throng/core`, abstractions/ports, DI and composition roots, package boundaries |
| `throng-daemon-persistence` | daemon process, named-pipe RPC, `ipc-contract`, SQLite schema and migrations |
| `throng-terminal-pty` | node-pty/ConPTY, PTY agent, elevation, orphan hygiene, xterm, terminal keyboard |
| `throng-renderer-ui` | React renderer, panes/tabs/panels, menus, theming and icon controls |
| `throng-editor-documents` | CodeMirror 6, document authority, dirty/undo/save, language and indent |
| `throng-config-preferences` | settings, keybindings, themes, metadata registries, preferences editors |
| `throng-explorer-fileops` | explorer tree, watchers, file operations, recycle bin, fileop undo |
| `throng-failure-notices` | failure-cause model, notifications, banners, exit notices, diagnostics logs |
| `throng-spec-governance` | Spec Kit artifacts, constitution amendments, FR traceability, docs currency |

## Process skills

| Skill | Owns |
|---|---|
| `throng-testing` | running suites and hands-on sessions; E2E harness knowledge in `references/e2e-harness.md` |
| `throng-release` | cutting a release; build, packaging and CI knowledge in `references/build-and-packaging.md` |
| `throng-docs` | the documentation set and its audit before every PR and release |
| `throng-clear-dev-state` | wiping a dev instance's processes and data |
| `speckit-*` | the Spec Kit commands |

Where an area skill and a process skill overlap, the process skill wins. Branch, worktree, PR and
issue mechanics belong to the user-level `git-workflow` and `github-workflow` skills.

## When delegating anyway

A subagent that works in an area loads that area's skill first; say so in its brief. These were
agents until 046, each with its own model, and the reasoning still holds when choosing `model` for
the Agent call:

- **Opus** for terminal-pty, daemon-persistence, core-architecture, editor-documents,
  config-preferences, spec-governance and E2E harness work. Their failures are silent: orphaned
  processes, migrations, layering, document authority, keybinding upgrades and chord matching,
  flake races, governance judgement. Config-preferences moved to Opus in 046 after its
  saved-bindings upgrade and chord-capture work produced two Critical review findings on Sonnet.
- **Sonnet** is enough for renderer-ui, explorer-fileops, failure-notices and build work. It is
  high-volume and checklist-shaped, and build-failing tests or the installer verification gate
  guard it.

## Maintaining them

A skill is only worth loading if it is true. When an area's rules change — a constitution amendment,
a new enforced test, a trap discovered the hard way — update the owning skill in the same change.
