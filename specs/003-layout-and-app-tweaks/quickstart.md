# Quickstart — Layout and app tweaks (validation guide)

Runnable validation that the feature works end-to-end. Commands use the existing npm scripts.
References: [spec.md](./spec.md), [data-model.md](./data-model.md), [contracts/](./contracts).

## Prerequisites

- Node 20 LTS, npm; Windows 11.
- `npm install` at the repo root.
- Build: `npm run build`. Tests: `npm test` (Vitest), `npm run test:e2e` (Playwright-Electron).

## Automated checks (must pass)

- **Unit** (`@throng/core`): active-panel set/reset; destroy confirmation resolution
  (none/single/double, panel active-gating); folder exclusivity (identical/ancestor/descendant,
  create+edit); AppSettings/Keybindings/Theme parse + default-merge + malformed fallback; keybinding
  event→action resolution; theme token→CSS-var resolution.
- **Integration**: migration **v4** (sub_workspaces name/colour) + idempotency; sub-workspace repo
  round-trip (rename/recolour/delete/list); layout **schema v1→v2** load migration; UI-main config
  store read/write + watcher fires on change (temp dir).
- **Contract**: `IConfigStore`, `IFileWatcher`, `subworkspace.*` IPC shapes.
- **E2E** (scenarios below).

## Manual / E2E validation scenarios

1. **Theming (whole app)**: launch → all surfaces use throng colours/fonts/icons (no hardcoded
   colours). Edit `themes\throng.json` (change `accent`) and save → the app re-paints **live**
   (no restart) within ~0.5 s. (SC-008)
2. **Hot-reload other config**: edit `keybindings.json` (change `zoom.in`) → new chord works without
   restart; a malformed save keeps the last-good config and shows a non-fatal notice. (SC-008)
3. **Drag ghost**: drag a panel → a translucent snapshot follows the cursor alongside drop
   indicators; drag a tab past the window edge → the ghost keeps following across the desktop;
   drop → ghost gone. (SC-001)
4. **Active panel**: click a panel → it highlights (theme `surfaceActive`); switch tabs and back →
   each tab restores its own active panel; focus a sub-workspace → its active panel is global.
   (SC-002)
5. **Status bar (every window)**: main window shows project / tab / panel and "No project" when
   none; a sub-workspace shows its name+colour then the active panel's origin project / tab / panel.
   (SC-003)
6. **Collapsible panes**: resize the File Explorer Pane, restart → width restored; Hide each pane →
   collapses to a rail with the rotated label ("Projects & Terminals" / "Files & Folders") + Show;
   with no project the left sidebar is shown and the right pane is collapsed-but-expandable. (SC-004)
7. **Destroy flows**: context-menu "Destroy Panel" and the header × run the same flow with a red
   button; Destroy Tab lists panel count + states; Destroy Project (default `double`) shows the
   summary then "Yes, I'm absolutely sure" / "No, I concede"; set `destroyProject:"single"` → only
   the summary; `"none"` → immediate. Destroying a project with panels in a sub-workspace is refused
   and names the sub-workspaces/tabs. (SC-005)
8. **Folder exclusivity**: create/edit a project at `D:\test`, then attempt `D:\test`,
   `D:\test\sub`, or a parent of `D:\test` → rejected with the folder field highlighted. (SC-006)
9. **Sub-workspaces**: detach a panel → a sub-workspace window opens and appears in the sidebar list
   with an auto name+colour; rename/recolour it; close the window → it stays in the list and reopens
   with contents; delete from the list → relocation warning then removal; restart → sub-workspaces
   listed but not opened until clicked; close the main window → all sub-workspaces close. (SC-007)
10. **Single instance + lazy load**: launch a second instance → it exits silently (no window/focus);
    at startup no project is selected and nothing is loaded; click a project → it loads and stays in
    memory when switching away. (SC-009)
11. **Resize handle**: the left/middle handle sits on the pane boundary and resizes cleanly.
    (SC-010)

## Done = all automated checks green + scenarios 1–11 observed.
