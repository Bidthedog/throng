# Contract: preview IPC additions (073)

Adds to 044's `contracts/preview-ipc.md`; nothing there changes. All channels are `invoke`, keyed by the
preview panel id main already knows; main resolves the project, the file and the document from its own
run, never from the payload (Principle I).

## `throng:preview:gridEdit`

Request `{ panelId: string; filePath: string; operation: CsvGridOperation }` (data-model §2).

Response:

| Answer | When |
|---|---|
| `{ ok: true; dirty: boolean }` | applied as ONE external edit (one undo step) |
| `{ ok: false; reason: 'changed' }` | `filePath` is not the run's file any more |
| `{ ok: false; reason: 'malformed'; line: number }` | the document's current text has an unterminated quote |
| `{ ok: false; reason: 'invalid' }` | the operation failed validation |
| `{ ok: false; reason: 'unavailable' }` | no run, not a CSV run, moved out of the project, or the file could not be opened as a document (its read refusal is the run's notice) |

On `ok`, main flushes the run at once: the next `throng:preview:update` carries the edited text without
the update delay.

## `throng:preview:gridUndo` / `throng:preview:gridRedo`

Request `{ panelId }`. Response `{ ok: boolean }` — `false` when the run follows no document. Performed
by the document's authority, so the step undone is the document's latest, whichever view made it.

## `throng:preview:gridSave`

Request `{ panelId }`. Response: the coordinator's `SaveResult` shape (`{ ok: true } | { ok: false;
reason; error }`), or `{ ok: true }` with nothing written when the run follows no document (nothing is
unsaved).

## `throng:preview:readSource`

Request `{ panelId, asset? }`. Response `{ ok: true; bytes: Uint8Array; mime: string } | { ok: false; status: 403 |
404 | 413 | 415 }` — answered by the `throng-preview://source` handler itself, so containment, the MIME allowlist
and the size cap are decided once. The cap is `maxFileBytesFor(registry, settings, providerId,
editor.maxOpenFileBytes)`: the provider's own limit where it declares one (the Spreadsheet provider's
`sizeLimitSetting`), else the editor's. A body reads it through the `readSource(asset?)` prop the chrome hands it,
never `window.throng` directly. *(Amended 2026-11-20 at the 073/074/075 merge, to 074's unified read; the single
size-cap field of the numeric-settings rework is still to come.)*

## `PreviewUpdate.ownsDocument`

`true` while the run follows a grid document (data-model §3); then `parent` is `null` and `dirty` is the
document's. The renderer publishes the panel into `editor-state` / `editor-actions` only while it is
`true`, so a document is counted once (044 FR-044).

## Coordinator (main-internal)

- A holder whose id starts `csv-grid:` is a **grid document**: `isOpen` and `openInto` ignore it (an
  editor opened on the file is a new panel that joins it as a link), `documentFor` still reports it (the
  preview follows it).
- `load` takes `recordHistory?: false`, so a grid document records no navigation history.
