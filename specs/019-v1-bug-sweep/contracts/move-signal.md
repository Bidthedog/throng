# Contract: The move signal — FilesService → EditorCoordinator → renderer

**Feature**: 019 | Governs FR-001…FR-009 | **Tested by**: `packages/ui/tests/e2e/editor-move-repoint.e2e.ts`

The shape to copy is three lines away in the same file: `delete` accumulates `removed[]` and calls
`this.onDeleted?.(removed)` (`files-service.ts:140-165`), wired at `main.ts:586`. This contract is that
one, for moves.

---

## 1. `FilesService` — main process (`packages/ui/src/main/files-service.ts`)

```ts
export interface MovePair { readonly from: string; readonly to: string }   // ABSOLUTE paths

/** Announced before a move is attempted, so a watcher cannot infer a deletion mid-move (FR-004). */
setOnMoveStarted(cb: (absPaths: readonly string[]) => void): void;
/** Announced after — the pairs that ACTUALLY moved (FR-001). May be empty. */
setOnMoved(cb: (moves: readonly MovePair[]) => void): void;
```

### `move(srcRelPaths, destRelDir)` — MUST

- call `onMoveStarted` with every resolved source **absolute** path **before the first `fs.move`**
- accumulate a `MovePair` **as each `this.fs.move(...)` resolves** — not from the requested list.
  `move` returns on the first disallowed item (`:100-105`), so *what was asked for* ≠ *what moved*
- call `onMoved(moved)` in a **`finally`** — on success, on the early `return { error }`, and on a
  thrown failure. The bracket must always close, or a doc stays `movePending` forever and can never
  be dirtied again by a genuine external delete
- skip a same-folder drop exactly as today (`:98-99`) — it moved nothing, so it announces nothing
- keep its current return contract (`{ok:true} | {error}`) and its current early-return-on-error
  behaviour. Continuing past a failure is a behaviour change, not a defect fix

### `rename(relPath, newName)` — MUST (FR-006)

- announce `[{ from: abs, to: join(dirname(abs), name) }]` on success, through the **same** callbacks
- announce **nothing** for the no-op case (`name === basename(abs)`, `:72`)

**MUST NOT**: announce a move the filesystem refused; announce requested-but-unmoved paths; throw
across the bridge (`{error}` only, **004** FR-025 — a failed file operation must surface, not throw; 019's
own FR-025 is a syntax-contrast requirement and is not what this means).

## 2. Wiring (`packages/ui/src/main/main.ts`, beside `:586`)

```ts
filesService.setOnDeleted((absPaths) => editorCoordinator.markDeleted(absPaths));   // EXISTS
filesService.setOnMoveStarted((absPaths) => editorCoordinator.beginMove(absPaths)); // NEW
filesService.setOnMoved((moves) => editorCoordinator.markMoved(moves));             // NEW
```

## 3. `EditorCoordinator` (`packages/ui/src/main/editor-coordinator.ts`)

```ts
/** Bracket open: matched docs tolerate a vanished file until markMoved closes it (FR-004). */
beginMove(absPaths: readonly string[]): void;
/** Re-point every open document named by a pair, or living beneath one (FR-002/FR-005). */
markMoved(moves: readonly MovePair[]): void;
```

### `markMoved` — MUST, per matched doc

| # | Requirement | Reference |
|---|---|---|
| 1 | match by `samePath(doc.absPath, from)` **or** `isUnderPath(doc.absPath, from)` — never raw string equality (FR-007) | `path-id.ts`; `markDeleted` already normalises (`:269-276`) |
| 2 | rewrite the path by **prefix replacement** for a folder move (FR-005) | AC6 |
| 3 | `unregisterPanel(registry, panelId)` **then** `registerOpen(registry, newAbs, {panelId, windowId})` | the pair `save()` uses (`:503-505`) |
| 4 | `doc.absPath = newAbs`, then `this.watchDoc(doc)` — the watch is per-**folder** (`:681-685`) | FR-002 |
| 5 | `relaySync(-1, { panelId, movedTo: newAbs })` — every window, the authority's ordered stream | Principle XI; `markDeleted` uses `-1` at `:290` |
| 6 | clear `movePending` on **every** doc opened by `beginMove`, moved or not | FR-004 |

### `markMoved` — MUST NOT

- re-`load()` the document, or touch `authority` (buffer / dirty / undo history) — **FR-002**, and a
  reload is a second original (Principle XI)
- call `markUnsaved()`, write a recovery snapshot, or raise a notice — **FR-003**. AC5 asserts that a
  clean move leaves **no snapshot at all**
- alter `markDeleted` (`:268-294`) in any way — **FR-009 / AC7**: a file moved or deleted by another
  program stays kept, dirty and recoverable. That path is correct

### `onDiskChange` (`:692-706`) — MUST

- while `doc.movePending`, take the `!res.ok` branch **without** calling `markDeleted` and return
- otherwise behave exactly as today. The existing stale-watch guard (`doc.absPath !== watchedPath`,
  `:694`) already covers the post-re-point case

**MUST NOT**: gain a timer, a grace period, or a retry. FR-011 condemns the "outlast the race" shape
one story over; the bracket is exact because `move()` owns the whole window.

## 4. Renderer (`packages/ui/src/renderer/editor/use-editor.ts`, beside `:779-790`)

```ts
if (typeof msg.movedTo === 'string') { /* the document's path changed; nothing else did */ }
```

**MUST**
- update the panel's config `filePath` so the header pill's `title` becomes the new path (AC1 asserts
  `panel-file-<pid>` has `title` = the new **native-spelled** path; the pill renders
  `toDisplayPath(editorUi.filePath, os)`, `panel-placeholder.tsx:481-483`)
- let that config write ride the existing debounced `workspace.save`, so the **persisted layout**
  carries the new path and a restart reopens the panel on the moved file (FR-008)

**MUST NOT**: set dirty, clear the buffer, re-request a load, or show the missing-file notice
(`editor-missing-notice.ts`). Nothing about a move may make an unedited document look edited.

## 5. Observable contract (what the RED tests read)

| Surface | Expectation | Test |
|---|---|---|
| `window.throng.editor.list()[].absPath` | the **coordinator's** `absPath` — the authority, not the view | AC1/AC2/AC6 (`:85-91`) |
| `editor.openInto({absPath}).action` | new path → `'focus'`; old path → `'open'` | AC4 (`:245-255`) |
| `panel-unsaved-<pid>` | count 0 after any in-app move | AC1/AC2/AC6 |
| `editor-notice-dialog` | count 0 | AC1 |
| `panel-file-<pid>` `title` | the new path | AC1 |
| `<userData>/recovery/<encodeURIComponent(panelId)>` | does **not** exist after a clean move | AC5 (`:291-295`) |
| Ctrl+S after a move | writes to the new path; **nothing** re-created at the old one | AC3 |
| external `renameSync` | dirty, buffer intact, `absPath` **unchanged**, save re-creates at the old path | AC7 — **green today, must stay green** |
