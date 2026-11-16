# Manual test plan: macOS support (spec 070)

Spec: `specs/070-macos-support/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Linux looks and behaves as before | signed off | 0d8e63cd69b1 | 2026-11-16 | |

macOS itself has no group: by the maintainer's decision it is proved by CI on hosted macOS runners only (spec 070
FR-002). This group checks the one platform the maintainer can test by hand, Linux, through the code macOS shares
with it.

## MT-01: Linux looks and behaves as before

Covers: FR-039
Paths: `packages/ui/src/main/main.ts`, `packages/ui/src/main/about-window.ts`, `packages/ui/src/main/preferences-window.ts`, `packages/ui/src/main/app-menu.ts`, `packages/ui/src/main/app-menu-template.ts`, `packages/ui/src/main/composition-root.ts`, `packages/ui/src/renderer/title-bar/**`, `packages/ui/src/renderer/preferences/**`, `packages/ui/src/renderer/config/**`, `packages/core/src/config/keybindings.ts`, `packages/core/src/config/keybindings-metadata.ts`, `packages/ui/src/main/files-service.ts`, `packages/platform/src/index.ts`, `packages/platform-node/src/posix/**`, `packages/platform-linux/src/**`

### Steps
1. Start throng from this branch on Linux (`npm start`). The main window has throng's own title bar with its window
   controls on the right, and no system title bar above it.
2. Open **About** and **Preferences** from the title-bar cog. Each opens frameless, with throng's own title bar, as
   on master.
3. Open **Preferences → Key Bindings**. The groups and rows are the ones master shows: no **Application** group, and no
   Open Settings or Install/Uninstall 'throng' command rows.
4. Open a terminal panel. Your usual shell starts at the project folder, and `Ctrl+C` and `Ctrl+R` reach it.
5. In the File Explorer, rename `readme.md` to `README.md`. The rename succeeds and the tree shows the new case.
6. In the File Explorer, delete a file, then undo. The file goes to the Trash and comes back.

### Negative cases
- No **Use Option as Meta** setting appears in **Preferences → Settings → Terminal**.
- Ctrl chords such as `Ctrl+S` in an editor still act; nothing reads `Cmd` anywhere in the Key Bindings editor.
