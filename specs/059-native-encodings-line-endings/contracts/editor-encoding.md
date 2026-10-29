# Contract: Editor encoding and line-format IPC

Main ↔ renderer, through the existing editor bridge (`editor-ipc.ts`, preload, `global.d.ts`).
Types are those in [data-model.md](../data-model.md).

## Widened

- `EditorLoadResult.encoding: EncodingId`. It was the literal `'utf8'` (`global.d.ts:808`).
- `toMeta` (`editor-ipc.ts:80-96`) validates `encoding` with `isEncodingId` instead of hard-coding
  `'utf8'`, and rejects `hasBom: true` with `windows1252`.
- The save payload's `lineEnding` is **ignored** by main and removed from the type. Main encodes with
  the authority's line format and the coordinator's encoding.

## New invocations

### `throng:editor:reopenWithEncoding`

Request `{ docKey: string, encoding: EncodingId }`.

Result:
- `{ ok: true }`. The document was reset from disk in that encoding. Every view receives the existing
  reset broadcast, then a meta relay with `encodingChosen: true`.
- `{ ok: false, reason: 'not-decodable', encoding }`. Nothing changed.
- `{ ok: false, reason: 'no-file' }`. The document has no file on disk (FR-026).

The renderer runs the FR-025 dirty-discard confirmation **before** calling. Main does not prompt.

### `throng:editor:saveWithEncoding`

Request `{ docKey: string, encoding: EncodingId, hasBom: boolean }`.

Result:
- `{ ok: true }`. Written. A meta relay follows with the new encoding and `encodingChosen: true`.
- `{ ok: false, reason: 'unrepresentable', encoding, char, line, column }`. Nothing was written.
  The document's encoding is unchanged.
- The existing save failures (`'io'`, `'out-of-tree'`, `'no-location'`) are unchanged.

### `throng:editor:convertLineEndings`

Request `{ docKey: string, target: 'lf' | 'crlf' }`.

Result: `{ ok: true, changed: boolean }`. `changed: false` when the document was already uniformly
`target` (FR-038). When it changed, every view receives a canonical change message (`kind: 'edit'`,
empty `changes`, `lineFormat`), so undo/redo flow through the existing history.

## Save result (widened)

The ordinary save's failure union gains
`{ reason: 'unrepresentable', encoding, char, line, column }`.

## Meta relay (extended)

The existing per-document meta relay carries `encoding`, `hasBom`, `encodingChosen` and
`lineFormat: { lineEnding, mixed: boolean }`. Views render the indicators from it. A view never sends
these back as truth.

## Canonical change message (extended)

`CanonicalChangeMsg` gains optional `lineFormat?: { lineEnding, mixed: boolean }`. It is present on a
conversion and on the undo/redo of one. Replicas apply `changes` (empty for these) as usual and update
their display copy.
