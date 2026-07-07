# Quickstart & Validation: Panes & Panels Workspace

**Feature**: 002-panes-and-panels | **Date**: 2026-06-26

A validation/run guide proving the feature works end-to-end. It assumes the 001 bootstrap runs
(daemon + UI launch, SQLite initialises). Implementation details live in `tasks.md`; full shapes
in [data-model.md](./data-model.md) and [contracts/](./contracts/).

## Prerequisites

- Node.js 20 LTS, Windows 11, repo cloned, `npm install` (now also pulls React, Vite, `@dnd-kit`).
- Build: `npm run build` (renderer now bundled by Vite; main/preload/daemon by `tsc`).
- Run everything: `npm start` (daemon + Electron UI). The DB lives at `%APPDATA%/throng/throng.db`;
  launch advances `user_version` to **2** (migration v2) on first run.

## Tests (all green is the bar — Principle V)

```bash
npm test                 # all layers
npm run test:unit        # core workspace/projects domain + renderer state (bulk of value)
npm run test:integration # persistence v2 + daemon projects.* / workspace.* round-trips
npm run test:contract    # IUserContext, IDisplayInfo, IPC method contracts
npm run test:e2e         # Playwright-Electron: project switch, tabs/splits/DnD, restart; detach (US4)
```

## Manual validation scenarios (map to Success Criteria)

### US1 — Projects (SC-001/002)
1. Launch → empty "no projects" state. Create **Project A** (name + colour) → sidebar lists it,
   workspace opens A's empty workspace, A's colour is the active accent.
2. Create **Project B**, switch A↔B → the Workspace Pane and the sidebar Terminals list swap per
   project; only the active project shows. Rename/recolour B; delete A → app stays valid.
3. Restart → project list and active project restored from the local profile.

### US2 — Tabs & split placeholder Panels (SC-003/004/005, SC-013/014)
4. In a project, **add a Tab** → it starts with one empty **untyped** placeholder Panel.
5. **Add a placeholder Panel**, then drag it to a Panel's edge → the Tab splits (e.g. four
   quadrants); drag Panels between split slots and between Tabs; reorder Tabs by dragging.
6. Remove a Panel → its split slot collapses; remove a Tab's last Panel → the Tab disappears; the
   workspace never becomes empty. No Panel ever shows an editor/terminal type.
7. Drop feedback appears within ~100 ms of reaching a valid target (SC-012); all by mouse only.

### US3 — Per-project persistence (SC-006/011)
8. Arrange A and B differently, restart → each project restores its own Tabs/splits/active-tab/sizes
   with no cross-project contamination.
9. Corrupt/remove a project's `layout_json` (or simulate) → that project opens the default empty
   workspace without crashing and reports the prior layout could not be restored.

### US4 — Sub-workspaces (P3; SC-007/008/009/010) — *separable follow-up (002b)*
10. Detach a Tab and a Panel into separate windows; focusing any window raises the whole group.
11. Put Panels from A and B into one sub-workspace (cross-project allowed). Reattach a Panel → it
    returns only to its **original project**; the main workspace stays single-project.
12. Restart → sub-workspaces restore onto a **visible** display; closing one returns its Panels to
    their original projects without loss.

## Expected outcomes

- All test layers pass green.
- The workspace docking (US1–US3) is fully usable in a single window.
- US4 multi-window behaviour works, or is cleanly deferred to 002b without affecting US1–US3.
