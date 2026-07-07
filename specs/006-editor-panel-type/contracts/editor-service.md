# Contract: UI-main editor-service & coordinator — Phases A/B/E

UI-main modules (`ui/src/main/editor-service.ts`, `editor-coordinator.ts`, `editor-recovery.ts`), wired in
the UI-main composition root. Own file I/O (via the existing **`IFileSystem`**), the app-wide open-document
registry, confinement enforcement, the dirty-file lock, recovery temp files, and the cross-window sync
relay. **No daemon.**

## editor-service (file I/O + confinement)

**Obligations**
- **Load**: read raw bytes via `IFileSystem`; `decode` (research D5) → `{ text, encoding, hasBom,
  lineEnding, relativeFolder }`. A non-text/undecodable file returns a clear "cannot open as text"
  indication (edge case), never a corrupted buffer. A very large file opens responsively or reports
  too-large without hanging.
- **Save**: `encode(text, recorded encoding/BOM/lineEnding)` → write bytes. **Preserves** the original
  encoding/BOM and line-ending style (only changed lines differ, SC-005). New docs use
  `newDocumentDefaults(settings.editor.defaultLineEnding)`.
- **Confinement**: before writing, check `resolveSaveConfinement` — project-owned → within owner tree;
  sub-workspace-owned → outside every loaded project. **Refuse** out-of-tree (never write outside). The
  new-doc save-location chooser is constrained to the allowed tree by construction.
- **Save-All**: resolve `editorsInScope(scope)`, save pathed, **skip** unpathed, **report** both.

## editor-coordinator (registry + lock + sync)

**Obligations**
- **App-wide one buffer** (FR-011a): `byPath: Map<absPath, { panelId, windowId }>`. `openInto` returns
  `focus` if the path is open anywhere (raise that window/Panel), else `open`. Registry entry added on
  open/create-with-path, removed on close/destroy or path change.
- **Dirty-file lock** (FR-028): on `notifyDirty(dirty=true)` with a real path → `IFileLock.acquire`; on
  save (clean) or destroy → `release`. Clean/unpathed → no lock.
- **Cross-window mirror** (FR-034): relay `notifySync` (content + dirty) for a `panelId` to that panel's
  **other** windows (`editor.onSync`) — no echo to the origin — mirroring `panel-*-sync`.
- **Ownership** (FR-035/036): a project's file may only be loaded into an editor of that project (or reach a
  sub-workspace via sync); refuse otherwise.

## editor-recovery (crash/close survival)

**Obligations**
- Debounced write of each open doc's content to `%APPDATA%\throng\recovery\<panelId>`, **regardless** of
  `autoSave` (FR-041). The temp is **not** a dirty signal (FR-053).
- **On launch**: reconcile against persisted editor Panels — restore in-progress content (match by
  `panelId`), and **delete** temps for fully-saved / no-longer-open docs (FR-042/043).
- Removed on **full save** and on **editor close without unsaved content**.

## project-overlap guard (FR-038, Phase E)

- On **create project**, if the new root would contain a file open in a **sub-workspace-owned** editor
  (`projectRootWouldContainOpenEditor`), **block/defer** creation and instruct the user to save + close
  that editor first.

## Integration tests
Save round-trips encoding/BOM/CRLF/LF on a real temp file (unchanged lines byte-identical); confinement
refuses out-of-tree and outside-project targets; one-buffer registry focuses across **two BrowserWindows**;
recovery writes, restores after a simulated relaunch, and cleans temps on save; the file lock (via
`IFileLock`) blocks an external write while dirty; project-overlap block fires. Temp roots self-clean.
