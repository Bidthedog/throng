# Quickstart — Validate the Editor Panel Type (phased)

A run/validation guide (not implementation). It proves each phase end-to-end through the running app.
Prerequisites: the 001–005 monorepo builds and runs (`npm install`; dev via the existing scripts). Details
of types/behaviour live in `data-model.md` and `contracts/`.

## Build & test (per package)

```bash
npm install                      # adds @codemirror/* to @throng/ui (renderer)
npm run build                    # tsc -b across the workspace
npm test                         # vitest unit/contract/integration
npm run test:e2e                 # Playwright-Electron (visible focused window required)
```

Core purity guard (`packages/core/tests/unit/no-os-imports.test.ts`) must stay green — the new
`core/editor/*` and `panel-type/editor` code is pure (no `node:*`/DOM). The daemon is **not** modified;
`user_version` stays **6** (assert in a persistence read-only test).

## Phase A — Editor type + editing + save + encoding/endings

1. Create a Panel → open the **Panel Type** dropdown → confirm **Editor Panel** is listed → select and
   Confirm. **Expect**: a CodeMirror plain-text editor holding an empty new document; the header shows the
   **type pill** then a `new document` file pill. Create a second Editor Panel — the two edit independently.
2. Type text, press **Ctrl+S**. **Expect**: a save-location chooser constrained to the project tree; save
   under the root → the file is written; try to save outside the project tree → **refused**.
3. Open an existing `CRLF` + UTF-8-**with-BOM** file (drop it under the project), edit one line, save.
   **Expect**: BOM + CRLF preserved; untouched lines byte-identical. Repeat with an `LF` no-BOM file. A new
   doc saves as UTF-8/no-BOM with `editor.defaultLineEnding` (default LF).
4. Edit several editors, press **Ctrl+Shift+S**. **Expect**: exactly the `editor.saveAllScope` set saved
   (default: current project); unpathed new docs skipped + reported.
5. Click the **Files & Folders** pane (it highlights as active), then press **Ctrl+S**. **Expect**: the
   editor is **not** saved (shortcut gated by active pane). Click the editor Panel → Ctrl+S now saves.
6. With a saved file dirty, have an external process try to write it. **Expect**: blocked while dirty
   (dirty-file lock); succeeds again after you save.

**E2E**: `editor-basics.e2e.ts`.

## Phase B — Open from tree + one-buffer + prompt + rename fix

1. Set `editor.openOnClick` to **double** → double-click a file → opens in the last active editor; single
   click does not. Set **single** → single click opens. Set **none** → clicking does nothing.
2. Highlight a file, press **Enter** → opens (does **not** rename). Press **Enter** on a **folder** →
   nothing opens, no rename. (Even with `none`, Enter opens a highlighted file.)
3. Open a file already open in another editor (any tab/window). **Expect**: the existing editor is
   focused/raised — no second buffer; **Open In** entries for that file are disabled.
4. Open a file into an editor with **unsaved** changes. **Expect**: the four-choice prompt (discard / save +
   open / keep + open in new editor / cancel), each behaving as specified.
5. Start renaming a file, press **Enter without changing the name**. **Expect**: **no error**, item
   unchanged, no rename attempted. A genuinely changed valid name still renames.

**E2E**: `editor-open.e2e.ts`, `rename-noop.e2e.ts`.

## Phase C — Unsaved indicators + auto-save

1. Edit a file → a **red dot** appears on the Panel (right of the name, before pills), the Tab (between name
   and panel count), and the project (in place of the removed **loaded** dot; unloaded projects keep greyed
   italics, no dot). Save/discard → all dots clear. All three share one style.
2. `editor.autoSave` **off** (default): edits stay pending until Ctrl+S. Turn **on**: stop typing → the file
   is written within the debounce window, the dot clears, confinement respected (a new unpathed doc still
   needs a location before auto-save writes).

**E2E**: `editor-indicators.e2e.ts`.

## Phase D — Menus + destroy prompt

1. Right-click a file → **Open In** shows **OS File Explorer** (moved under here), **Editor Here** (New +
   existing editors of the active tab), **Other Tab** (each tab → New / existing) — only current-project
   targets.
2. On any Panel → **Send to Tab → New Tab** → identical to dragging that Panel onto the tab-strip **+**.
3. Compare an Editor and a Terminal Panel's **Sync to Sub-workspace** cascade — same shape (shared builder).
4. Destroy a **dirty** editor Panel / a Tab with dirty editors → save/discard/cancel prompt naming the
   file(s); **cancel** changes nothing.

**E2E**: `editor-menus.e2e.ts`.

## Phase E — Sub-workspace sync + ownership + recovery

1. Sync a project editor into a sub-workspace → edit in either view → both mirror **one** document (content
   + dirty); never a second buffer.
2. In a sub-workspace, create an owned editor → it saves only **outside** every loaded project; saving into a
   loaded project tree is refused.
3. Open a file in a sub-workspace-owned editor, then create a project whose root contains that file →
   **blocked** with a save-and-close instruction (FR-038).
4. Edit files (don't save) → close the app (**no** unsaved warning) → reopen → each editor restored with its
   in-progress content. Save fully → its recovery temp is removed; the temp never shows an unsaved dot.

**E2E**: `editor-subworkspace.e2e.ts`, `editor-recovery.e2e.ts`.

## Cross-cutting checks
- `@throng/core` stays OS/DOM-free (guard test green).
- `user_version` stays **6** (no migration); the **daemon and `ipc-contract` are unmodified**.
- Every phase's UI change ships passing E2E before the next begins (Principle V).
- Docs currency at close: README (editor-panel capability), ROADMAP ("Rich code editors" → plain-text
  delivered, rich editing still planned), CONTRIBUTING (if toolchain changes).
