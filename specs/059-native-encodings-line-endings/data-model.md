# Data Model: Native Encodings and Line-Ending Conversion

## EncodingId (core, widened)

`'utf8' | 'utf16le' | 'utf16be' | 'windows1252'`. With `hasBom`, five user-visible formats:

| encoding | hasBom | Label (FR-031) | BOM bytes |
|---|---|---|---|
| utf8 | false | `UTF-8` | — |
| utf8 | true | `UTF-8 with BOM` | `EF BB BF` |
| utf16le | true/false | `UTF-16 LE` | `FF FE` |
| utf16be | true/false | `UTF-16 BE` | `FE FF` |
| windows1252 | false (always) | `Windows-1252` | — |

`isEncodingId(x)` guards IPC input. `hasBom: true` with `windows1252` is invalid and rejected.

## TextFormatVerdict (core)

```
{ kind: 'text', encoding: EncodingId, hasBom: boolean }
| { kind: 'refused', reason: 'utf32' | 'binary' }
```

Returned by `detectTextFormat(bytes)` (FR-002 precedence). `decode(bytes, forced?)` adds
`'not-decodable'` (with the encoding) for a forced encoding that fails a fatal decode (FR-014).

## DecodedFile (core, extended)

`text` (`\n`-normalised), `encoding`, `hasBom`, `lineEnding`, `mixedLineEndings?`. The existing
shape, with `encoding` widened.

## LineFormat (main — authority-owned)

`{ lineEnding: LineEndingId, mixedLineEndings?: readonly LineEndingId[] }`

- Held by `DocumentAuthority`, with `savedLineFormat` captured by `markSaved`.
- Equality: same `lineEnding` and element-wise equal `mixedLineEndings` (both absent counts as equal).
- `dirty = !content.eq(savedDoc) || !lineFormatEq(lineFormat, savedLineFormat)`.
- After `convertLineEndings(target)`: `{ lineEnding: target }`, with no mixed record (FR-037).

## UndoEntry (main, extended)

Adds `format?: { before: LineFormat, after: LineFormat }`. A conversion entry has empty
`changes`/`inverted` (`ChangeSet.empty(doc.length)`), `mergeClass: null` and `format` set. Persisted
by `undo-persistence.ts` as an optional `format` field. Its absence means a text-only entry.

## CoordDoc (main, extended)

Existing `encoding`, `hasBom`, plus `encodingChosen: boolean` (FR-028). It is written only by load,
reload/reopen, adopt, restore and saveWithEncoding. `lineEnding` is no longer read from a save
payload. Line format is the authority's.

## EditorPanelConfig (core layout, extended)

Existing `encoding?`, `hasBom?`, `lineEnding?`, plus `encodingChosen?: boolean`. A display and
session-restore copy, written from the coordinator's relay, never sent back as the truth.

## Recovery snapshot (main, extended)

`{ version, text, history?, encoding?, hasBom?, encodingChosen?, lineFormat? }`. Older snapshots lack
the new fields and restore through detection (FR-015).

## Unrepresentable (core)

`{ encoding, char: string, line: number, column: number }` (1-based). It is thrown inside
`UnrepresentableTextError` by `encode`, and returned by `findUnrepresentable`.

## SaveReason / FailedCommit.reason (main, extended)

- `SaveReason`: `'out-of-tree' | 'no-location' | 'io' | 'unrepresentable'`. The last carries `Unrepresentable`.
- `FailedCommit.reason` gains `'unrepresentable'`. `'encoding'` now means a lossless-decode failure only.

## State transitions — a document's format

```
open ──detect──▶ {encoding, hasBom, chosen=false, lineFormat}
  ├─ Reopen with Encoding(e) ─ok──▶ {e, chosen=true}, buffer reset, undo cleared
  │                          └fail─▶ unchanged, refusal shown
  ├─ Save with Encoding(e,b) ─ok──▶ {e, b, chosen=true}, saved
  │                          └unrep─▶ unchanged, banner shown, nothing written
  ├─ Convert(t) ──────────────────▶ lineFormat={t}, dirty, undoable
  ├─ external reload ─────────────▶ re-read in current encoding; detect again only if that fails
  └─ close in every panel ────────▶ forgotten (clarification 3)
```
