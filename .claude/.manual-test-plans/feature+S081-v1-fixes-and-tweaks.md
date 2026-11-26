# Manual test plan: v1.0.0 fixes and tweaks (spec 081)

Spec: `specs/081-v1-fixes-and-tweaks/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Couldn't-open notices | untested | | | |
| MT-02 | Markdown tables after a background change | untested | | | |
| MT-03 | Sync-scroll highlight on tables and blank lines | untested | | | |
| MT-04 | Title-bar Open and Find buttons | untested | | | |
| MT-05 | Link menu Open In | untested | | | |
| MT-06 | Follow the active preview | untested | | | |
| MT-07 | Faded ignored entries | untested | | | |
| MT-08 | CSV entry row | untested | | | |
| MT-09 | Focus Mode strip on terminals | untested | | | |

## MT-01: Couldn't-open notices

Covers: FR-010, FR-011, FR-012, FR-012a, FR-013, #728
Paths: `packages/ui/src/renderer/editor/missing-file-watcher.tsx`, `packages/ui/src/renderer/editor/use-editor.ts`, `packages/ui/src/renderer/editor/editor-state.ts`, `packages/ui/src/main/editor-coordinator.ts`, `packages/ui/src/main/preview-service.ts`, `packages/ui/src/main/external-delete-settle.ts`

### Steps
1. Open a text file in an editor and the same file's Markdown preview beside it. In a terminal, run `rm <file>; sleep 0.2; printf 'x\n' > <file>`. No notice appears; both panels show `x`, and the editor has no unsaved dot.
2. Run `rm <file>` and wait a second. One "Couldn't open" notice appears and the editor shows its missing-file banner.
3. Recreate the file, then put an editor in Focus Mode in a tab where another editor's file you then delete is hidden. No notice while Focus Mode is on; leave Focus Mode and one notice names that panel.

### Negative cases
- Switching tabs on a workspace whose editors all open raises no notice.
- A notice about a path that is a folder says it is a folder, never "moved, renamed or deleted".

## MT-02: Markdown tables after a background change

Covers: FR-020, FR-021, FR-022, #730
Paths: `packages/ui/src/renderer/preview/table-layout.ts`, `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx`

### Steps
1. Open a Markdown file with several two-column tables of long prose as a preview. Collapse its panel or switch to another tab.
2. Append a table row to the file in another editor and save. Bring the preview back. Every table's columns look as they do on a fresh open.
3. Drag a column's resize handle. The column resizes smoothly and the table keeps its shape.

### Negative cases
- No column is squeezed to nothing or stretched past the panel after expanding.

## MT-03: Sync-scroll highlight on tables and blank lines

Covers: FR-030, FR-031, FR-032, FR-033, #733
Paths: `packages/ui/src/renderer/preview/providers/markdown/**`, `packages/ui/src/renderer/preview/preview-panel.tsx`, `packages/ui/src/renderer/editor/editor-scroll-store.ts`, `packages/ui/src/renderer/editor/editor-scroll-relay.ts`, `packages/core/src/editor/sync-line.ts`

### Steps
1. Open the #733 fixture (paragraphs, then `| | |` / `|---|---|` / three rows, then paragraphs) in an editor with its linked preview, Synchronise Scrolling on and the gutter on.
2. Scroll the preview so a table row sits at the centre and stop. The row is highlighted in both views and its cells do not move or change size.
3. Scroll the editor so each table line in turn is at the centre. The matching preview row lights every time; the header and delimiter lines light the header row.
4. Stop with a blank line between paragraphs at the centre. The next paragraph is highlighted in both views.

### Negative cases
- The highlight's colour and fade time are as before.

## MT-04: Title-bar Open and Find buttons

Covers: FR-040, FR-041, FR-043, FR-044, #725
Paths: `packages/ui/src/renderer/workspace/panel-header-*`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/core/src/icons/**`

### Steps
1. Look at an editor's title bar. At the head of the right-hand icons: Open in OS Default Program, Find in File Explorer, a separator, then Save and Save As.
2. Click Find in File Explorer. The File Explorer expands to the file and selects it. Click Open in OS Default Program. The file opens in your system's program.
3. Look at a Markdown preview's title bar. The same two buttons and separator lead its icons.
4. Narrow the panel. The two buttons and their separator disappear before Save and Save As; widen it and they return.
5. Open the panel menu. It reads **Find in File Explorer**.

### Negative cases
- On an untitled editor both buttons are greyed out and their hover text says to save first.
- Terminal title bars are unchanged.

## MT-05: Link menu Open In

Covers: FR-050, FR-051, FR-052, FR-053, FR-054, #731
Paths: `packages/core/src/links/**`, `packages/ui/src/renderer/links/**`, `packages/ui/src/renderer/explorer/context-menu-items.ts`, `packages/ui/src/renderer/explorer/open-in-rows.ts`

### Steps
1. In a terminal, print a path to a project file and right-click it. Open In ▸ lists the same rows, icons and order as the File Explorer's Open In ▸ for that file.
2. Right-click a link to a folder. Open In ▸ shows the folder rows (OS File Explorer, Terminal, Search).
3. Right-click a link in a Markdown preview. The same Open In ▸ appears.

### Negative cases
- No row appears twice; Open Link, Find in File Explorer and Copy Link stay outside the submenu.
- A URL's link menu is unchanged.

## MT-06: Follow the active preview

Covers: FR-060, FR-061, FR-062, FR-063, #724
Paths: `packages/ui/src/renderer/explorer/file-tree.tsx`, `packages/ui/src/renderer/preview/active-preview-file.ts`, `packages/core/src/config/settings-metadata.ts`

### Steps
1. Open Preferences › Settings › File Explorer. **Follow the active preview** sits under Follow the active editor and is on.
2. Click into a preview of a file deep in the tree. The File Explorer expands to that file and selects it, and typing still goes to the preview.
3. Turn the setting off and activate another preview. The tree does not move.

### Negative cases
- A preview of a file outside the project leaves the tree alone.

## MT-07: Faded ignored entries

Covers: FR-070, FR-071, FR-072, FR-073, #729
Paths: `packages/ui/src/renderer/explorer/**`, `packages/platform-node/src/git-ignore-oracle.ts`, `packages/core/src/config/theme*.ts`

### Steps
1. Open a git project with `node_modules/` and a `*.log` ignored. Those entries are faded; tracked siblings are not. Expand `node_modules/`: everything inside is faded.
2. Add a pattern to `.gitignore` and save. The matching entries fade without a reload.
3. Hover and select a faded entry in each bundled theme. The highlight is as readable as on any other row.

### Negative cases
- A project that is not a git repository shows nothing faded and no notice.

## MT-08: CSV entry row

Covers: FR-080, FR-081, FR-081a, FR-082, FR-083, #732
Paths: `packages/ui/src/renderer/grid/**`, `packages/ui/src/renderer/preview/providers/csv/**`, `packages/core/src/csv/**`

### Steps
1. Open a CSV in the CSV Preview Editor. An empty row with no number sits after the last row, and the panel is not dirty.
2. Click a cell in it and type a value. The row joins the file with the value in its column, and a new empty row appears beneath.
3. Undo once. The row and the value go together.
4. Right-click the empty row's header. Cut and Insert Row Above are greyed out.

### Negative cases
- Clicking around the empty row without typing leaves the file unchanged and clean.

## MT-09: Focus Mode strip on terminals

Covers: FR-090, FR-091, FR-092, #727
Paths: `packages/ui/src/renderer/terminal/terminal-status-bar.tsx`, `packages/ui/src/renderer/terminal/terminal.css`, `packages/ui/src/renderer/editor/editor.css`

### Steps
1. Put a terminal with its status bar shown into Focus Mode. Its status bar takes the highlight colour with a centred "Focus Mode" and the way out, like an editor's.
2. Click a status-bar toggle. It still works.
3. Leave Focus Mode. The bar returns to normal.

### Negative cases
- With the terminal status bar turned off, Focus Mode shows no bar.
