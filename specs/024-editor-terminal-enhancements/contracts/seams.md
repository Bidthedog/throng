# Contracts: seams this feature adds or extends

One file; the feature's seams are small and interrelated. Each is testable at the layer named.

## 1. Filesystem seam — `IFileSystem.restoreFromTrash` (US3, NEW)

`packages/core/src/abstractions/file-system.ts`

```
restoreFromTrash(originalAbsPath: string, deletedAt: number): Promise<void>
```

- **Pre**: the item was sent to the OS recycle bin (via `trash`) and has not been purged.
- **Post**: the item is back at `originalAbsPath`; the destination was free beforehand.
- **Throws / rejects** when the content is no longer recoverable (purged) or the destination is taken —
  the caller (undo engine) turns this into the FR-008 refusal, never an overwrite.
- **Contract test** (`core/src/testing/file-system-contract.ts`, run against a real temp dir by each
  impl): create → `trash` → `restoreFromTrash` → assert the file is back with its content; and
  restore-after-purge → rejects. Windows impl: PowerShell `Shell.Application` recycle-bin verb.
  Unimplemented platforms reject with a well-known "unsupported" error so the undo degrades cleanly.

## 2. File-op undo engine (US3, NEW pure module)

`core/fileop-undo/undo-stack.ts` — pure, unit-tested. Operations:

```
record(stack, entry): stack            // pushes to undo, clears redo, bounds to 50
undo(stack): { entry, stack } | null   // pops undo → redo
redo(stack): { entry, stack } | null   // pops redo → undo
validate(entry, world): Ok | Refuse    // FR-008, before any apply
serialise(stack) / parse(json): stack  // v8 persistence; parse degrades to empty (FR-010a)
```

`world` is an injected probe (`exists`, `isRecoverable`) so the engine stays pure and testable without
touching disk. Bound = 50 per project (FR-010). Applying an entry is the *caller's* job (drives
`FilesService`/`IFileSystem` + the editor re-point callbacks); the engine only decides *what* and *whether*.

## 3. Undo persistence — migration v8 (US3)

`packages/persistence/src/migrations/v8-fileop-undo.ts` + `FileOpUndoRepository`.
Table `fileop_undo(owner_user, project_id, stack_json, updated_at)`, PK `(owner_user, project_id)`,
CASCADE from `projects`. `LATEST_VERSION` 7 → 8. Integration test mirrors `migration-v7.integration.test.ts`.

## 4. Keybinding commands (US1/US6)

`packages/core/src/config/keybindings.ts` + `keybindings-metadata.ts`:
- `editor.toggleWordWrap` — `['Ctrl+Alt+W']`, scope `{editor}`.
- `menu.open` — `['Shift+F10', 'ContextMenu']`, scope `{explorer,editor,terminal}`.
Contract = the existing keybindings unit suites: completeness (descriptor present), scope, collision,
platform. **Plus** `app.tsx` dispatch must pass `shift` for function keys (else `Shift+F10` never matches).

## 5. Settings (US1)

`editor.defaultWordWrap`, `editor.showStatusBar`, `terminals.showStatusBar` — booleans, default `true`.
Contract = `settings-metadata.test.ts` completeness (every leaf described) + `editor-settings.test.ts`
/ `app-settings.terminals.test.ts` parser tests (default-when-absent, honour `false`, reject non-boolean).

## 6. Tree-drag payload (US2/US4)

MIME `application/x-throng-tree-paths` = JSON `absPath[]`, plus a renderer drag-state mirror and a
`throng:tree-drop` CustomEvent `{ panelId, paths }` e2e seam (mirrors `throng:os-drop`). Terminal
consumer inserts quoted paths via `window.throng.terminal.write`; panel consumer opens as editor and
rejects folders/multi-item.

## 7. External-URL seam + window-open denial (US7)

- `isSafeExternalUrl`: accept `https?://`, reject all other schemes (unit test).
- Preload: `window.throng.openExternal(url)` (hoisted from `about`).
- `TerminalApi.getLinkAt(x,y): string | null`.
- Main process: every `BrowserWindow.webContents.setWindowOpenHandler(({url}) => { if http(s) → shell.openExternal; return {action:'deny'} })`.
  Contract = e2e `app.evaluate` asserting `getAllWindows().length` unchanged after a link activation /
  `window.open`, and `shell.openExternal` intercepted with the right URL.

## 8. Panel ownership op (US4)

`convertPanelToProject(layout, panelId, projectId): WorkspaceLayout` — pure core op; rewrites
`originProjectId`, then types the panel as an editor. Post-condition: `validateMainLayout` passes
(INV-4). Unit test in `core/tests/unit/`.
