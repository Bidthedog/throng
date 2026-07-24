# Data Model: Editor & Terminal Enhancements

Entities this feature adds or extends. Field names follow the codebase's existing conventions.

## Settings (US1) — extends `AppSettings`

`packages/core/src/config/app-settings.ts`. Three new booleans, tolerant-parsed, defaulting On:

| Key | Section | Default | Meaning |
|-----|---------|---------|---------|
| `editor.defaultWordWrap` | `EditorSettings` | `true` | Starting wrap state for a freshly-opened document (FR-002). |
| `editor.showStatusBar` | `EditorSettings` | `true` | Whether the editor per-panel status strip is shown (FR-001b). |
| `terminals.showStatusBar` | `TerminalSettings` | `true` | Whether the new terminal status bar is shown (FR-001b). |

Each also needs a `settings-metadata.ts` `FieldDescriptor` (`control: 'toggle'`, `group` = `'Editor'`
or `'Terminal'`). No schema-version bump (merge-over-defaults).

## Word-wrap state (US1) — in-memory, per document

Owned by the **document authority** (`EditorCoordinator`/`CoordDoc`), never the panel (Principle XI).

- `wordWrap: boolean` on the document — every panel viewing the file reads the one value.
- Seeded from `editor.defaultWordWrap` when a document opens that is **not already open** anywhere; a
  file already open elsewhere adopts that document's current value.
- Not persisted; dropped when the document closes in every panel (FR-003).

## File-operation undo entry (US3) — new

Pure type in `core/fileop-undo/undo-stack.ts`; persisted via migration v8.

```
FileOpUndoEntry =
  | { kind: 'move';   items: { from: absPath; to: absPath }[]; at: epochMs }
  | { kind: 'rename'; from: absPath; to: absPath;               at: epochMs }
  | { kind: 'delete'; items: { originalPath: absPath }[];       at: epochMs }
```

- **Stack**: per `(owner_user, project_id)`, two arrays (undo, redo), each **bounded to 50** (oldest
  drops when full, FR-010). Recording clears redo; redo does not clear (mirror `UndoHistory`).
- **Validation (FR-008), checked before apply, undo *and* redo:** move/rename → destination free and
  source present at the recorded path; delete-restore → the trashed content is still recoverable. Fail
  → refuse, change nothing, raise a persistent `error` notice (FR-008a). Never overwrite.
- **Persistence (v8)**: table `fileop_undo(owner_user, project_id, stack_json, updated_at)`, PK
  `(owner_user, project_id)`, `ON DELETE CASCADE` from `projects`. Load degrades to empty on
  missing/unreadable/old-format (FR-010a).

## Tree-drag payload (US2/US4) — new

Written on tree `dragstart`:

- `dataTransfer['application/x-throng-tree-paths']` = JSON `absPath[]` (selection order).
- Mirror in a renderer drag-state store for the `throng:tree-drop` e2e CustomEvent seam.
- Consumers: terminal drop (US2 → path insert), untyped-panel drop (US4 → open-as-editor). A folder or
  multi-item payload is **rejected** by the panel consumer (US4, FR-011a); the terminal consumer
  accepts multiple (FR-004a).

## Panel ownership & title (US4/US5) — extends `Panel`

`packages/core/src/workspace/model.ts`. No new fields; new behaviour on existing ones:

- **US4** — `convertPanelToProject(layout, panelId, projectId)`: rewrites `originProjectId` from a
  sub-workspace synthetic id to the target project id, then `setPanelType(panelId, 'editor', {filePath})`.
  Must satisfy `validateMainLayout` (INV-4) afterward. Unit-tested.
- **US5** — effective title resolution (view layer): `!titleIsCustom && kind === 'editor'` → open file's
  basename (final extension stripped: `foo.test.ts`→`foo.test`, `Makefile`→`Makefile`,
  `.gitignore`→`.gitignore`, never blank — FR-015). `titleIsCustom` still wins; "Reset Name" clears it.
  The `throng-unsaved-dot` renders beside the title for a dirty editor regardless of naming (FR-017a).

## Commands (US1/US6) — extends `ActionId`

`packages/core/src/config/keybindings.ts`:

| Action | Default chord(s) | Scope | Notes |
|--------|------------------|-------|-------|
| `editor.toggleWordWrap` | `Ctrl+Alt+W` | `{editor}` | Reserved-tier clear (v4.2.0). `{terminal}` scope deferred to #169. |
| `menu.open` | `Shift+F10`, `ContextMenu` | `{explorer,editor,terminal}` | Needs the `app.tsx` Shift-for-function-keys dispatch fix. |

Both need a `keybindings-metadata.ts` `chord()` descriptor (completeness gate) and collision-check clean.

## External-URL seam (US7) — extends existing

- `isSafeExternalUrl`: `https`-only → `https?` (FR-019). Keeps rejecting `javascript:`/`file:`/`data:`.
- Preload bridge `openExternal` hoisted from `window.throng.about.openExternal` → `window.throng.openExternal`.
- `TerminalApi.getLinkAt(x, y): string | null` — the URL under a point, for the link-aware menu (FR-019d).
- Main-process window-open handler: renderer-opened windows denied; `http(s)` routed to `shell.openExternal`.
