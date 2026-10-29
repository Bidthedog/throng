# Research: Native Encodings and Line-Ending Conversion

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

## R1 — One detection function, returning a format or a refusal

**Decision**: `detectTextFormat(bytes)` in `packages/core/src/editor/text-fidelity.ts` returns either
`{ kind: 'text', encoding, hasBom }` or `{ kind: 'refused', reason: 'utf32' | 'binary' }`, applying
spec FR-002's precedence table top to bottom. `decode` calls it and every other reader of project text
calls `decode` (or `detectTextFormat` alone when it only needs the verdict). `isProbablyBinary` and
`isDecodableUtf8` stop being exported decisions: the first becomes the binary step inside detection,
the second the UTF-8 validity step.

**Rationale**: FR-001 forbids a second detection anywhere. Today three questions ("binary?",
"decodable UTF-8?", "which BOM?") are asked by three functions at different call sites, which is how
the editor came to skip the question 043 asks. One function with one return type makes the refusal
reason a value every path renders the same way (FR-053).

**Alternatives considered**: keeping `isProbablyBinary` and adding `isUtf16`. Rejected: callers would
still have to order the calls themselves, and the precedence (UTF-32 before UTF-16 BOM, UTF-16
pattern before binary) is exactly what callers get wrong.

## R2 — BOM-less UTF-16 heuristic

**Decision**: Over the first 8,000 bytes (the same window as today's binary scan), rounded down to an
even count, with at least 2 code units:

- count zero bytes at even offsets (`zEven`) and odd offsets (`zOdd`), out of `pairs` byte pairs;
- **LE** when `zOdd ≥ 0.3 × pairs` and `zEven ≤ 0.02 × pairs`; **BE** symmetrically;
- and the whole file must then decode under that byte order with a fatal decoder (R3). A failure
  falls through to the binary step.

**Rationale**: ASCII-range text in UTF-16 LE has a zero in every odd byte. A Latin or CJK file still
has zeros in a large share of one side and almost none in the other, because U+0100–U+FFFF code units
whose low byte is zero are rare. Binary formats put zeros on both sides (headers, padding, aligned
integers), which fails the "other side near zero" clause. Requiring a lossless decode as well removes
the residual false positives (odd length, unpaired surrogates). The thresholds are tuned against the
SC-003 fixture set and recorded as named constants with this reason.

**Alternatives considered**: a pure "every other byte is zero" rule (misses any non-ASCII text);
statistical language detection (non-deterministic across versions, out of proportion to the need).

## R3 — Decoders: platform `TextDecoder`, fatal

**Decision**: Decode UTF-8, UTF-16 LE and UTF-16 BE with `new TextDecoder(label, { fatal: true })`
(`utf-8`, `utf-16le`, `utf-16be`), and Windows-1252 with `new TextDecoder('windows-1252')`. A
`TypeError` from a fatal decoder is the FR-014 refusal "not valid <encoding>".

**Rationale**: All four labels are WHATWG Encoding Standard decoders, present in Node 24 (full ICU)
and Chromium, so core stays OS-agnostic (Principle II) with no dependency. Verified in this repo's
Node: `windows-1252` decodes all 256 bytes to 256 code units, mapping 0x80 → U+20AC and the five
undefined bytes to U+0081/U+008D/U+008F/U+0090/U+009D, which is what makes FR-013's round trip
possible. `utf-16be` is supported. The fatal UTF-16 decoder rejects unpaired surrogates and a
trailing odd byte, which is FR-014's edge case.

The UTF-8 path keeps today's whole-file validity check, now fatal. A file that fails it no longer
decodes with replacement characters: it falls through to Windows-1252 (FR-002 row 8).

**Alternatives considered**: `iconv-lite`. Rejected for decoding because the platform already does
it, and see R4 for encoding.

## R4 — Encoders: hand-written, no dependency

**Decision**:

- **UTF-8**: `TextEncoder`, after an FR-021 check that the string holds no lone surrogate, because
  `TextEncoder` silently writes `EF BF BD` for one.
- **UTF-16 LE / BE**: write each UTF-16 code unit as two bytes in the chosen order. A JS string is
  already UTF-16, so this is a byte swap loop. The same lone-surrogate check applies.
- **Windows-1252**: the inverse of the decoder's table, built once at module load by decoding bytes
  0–255 with the platform decoder and indexing the result. Encoding is a map lookup per code unit.
  A miss is FR-021's "cannot represent".

**Rationale**: `TextEncoder` writes UTF-8 only. A UTF-16 encoder is a few lines, and deriving the 1252
encoder from the decoder makes the round trip exact by construction: the encoder is the decoder's
inverse, not a second table that could disagree with it.

**Alternatives considered**: `iconv-lite` (a new runtime dependency in core for three encodings, and
its 1252 table handles the undefined bytes differently from WHATWG — the round trip would then rest
on two libraries agreeing); a hand-typed 1252 table (could drift from the decoder).

## R5 — Finding the first unrepresentable character

**Decision**: `findUnrepresentable(text, encoding)` in core returns `{ char, line, column } | null`.
For Windows-1252: the first code point with no entry in R4's table. For every encoding: the first
lone surrogate. `encode` refuses (throws a typed `UnrepresentableTextError`) rather than substitute;
the save path catches it and raises FR-022's notice. A line is counted in the `\n`-normalised buffer,
1-based, matching the editor's line numbers.

**Rationale**: FR-021/FR-022 need the character and line in the notice, and FR-020 needs `encode`
itself to be incapable of writing a substitute, so no caller can forget the check.

## R6 — Line endings become authority state, with an undo entry that carries them

**Finding**: the buffer is always `\n`-normalised, and `DocumentAuthority.dirty` compares content
only (`document-authority.ts:124-145`). A line-ending conversion therefore changes nothing the
authority can see. Two more findings in the same area:

- `editor-coordinator.ts` `save` (:2154) takes `lineEnding` from the **renderer's** payload, which
  `use-editor.ts:1173` fills from the panel's layout config. A renderer-held value decides what reaches
  disk, which is the peer-owned state Principle XI forbids. With conversion it would also make the
  panel that did not convert write the old ending.
- `editor-service.ts:98` drops `mixedLineEndings` on load and `:165` encodes without it, so saving a
  mixed file from the editor rewrites every disagreeing line to the dominant ending. That contradicts
  016 FR-023b as well as this spec's FR-011.

**Decision**:

1. `DocumentAuthority` owns a **line format**, `{ lineEnding, mixedLineEndings? }`, and a
   `savedLineFormat` set by `markSaved`. `dirty` becomes `!content.eq(savedDoc) || !sameFormat(...)`.
2. `UndoEntry` gains an optional `format: { before, after }`. A conversion is
   `authority.convertLineEndings(target)`: it records an entry with **empty** change sets (length
   preserved) and that `format`, sets the line format, advances the version and returns a canonical
   message with `kind: 'edit'`, empty `changes` and the new `lineFormat`. Undo and redo of such an
   entry restore `before`/`after`. Replicas apply the empty change (a no-op) and take the format from
   the message. The conversion is one entry and never merges (`mergeClass: null`).
3. `save` stops reading `lineEnding` from the payload. The coordinator encodes with the authority's
   line format and the document's encoding. The renderer keeps the values only as a display copy fed
   by the coordinator's meta relay, and writes them into the layout config for session restore.
4. Load keeps `mixedLineEndings` and hands it to the authority. `encode`'s existing rule (positional
   when the break count is unchanged, dominant otherwise, 043 FR-056) is unchanged.
5. `undo-persistence.ts` serialises the optional `format`. Older persisted histories have none and
   restore unchanged.

**Rationale**: one owner of the value (Principle XI), undo through the one history that already
exists, and dirty derived rather than set (the comment at `document-authority.ts:126` is the rule).

**Alternatives considered**: a separate per-document "format undo" stack (two histories, and Undo
would need to know which one is newer); rewriting the buffer to carry `\r` (breaks every consumer that
relies on the `\n` invariant).

## R7 — Encoding is coordinator state, chosen-ness is a flag

**Decision**: `CoordDoc` already holds `encoding` and `hasBom`, written only by load, reload, adopt
and restore. Keep it there, add `encodingChosen: boolean`, and widen `EncodingId` to
`'utf8' | 'utf16le' | 'utf16be' | 'windows1252'`. `hasBom` covers UTF-8 and UTF-16. The panel layout
config already carries `encoding`/`hasBom` for session restore; it gains `encodingChosen`. When it is
true the load passes the encoding explicitly instead of detecting (FR-028). The recovery snapshot
(`editor-recovery.ts`) gains `encoding`, `hasBom`, `encodingChosen` and the line format, all optional
so older snapshots restore with detection.

**No SQL change.** Clarification 3 settled that nothing about the encoding outlives the open document,
so `document_state` gains no column and no migration is written.

**Rationale**: encoding changes only by an explicit read or write of the file (Reopen / Save with
Encoding), so it is not undoable state and does not belong in the history.

## R8 — The IPC widening

**Finding**: `editor-ipc.ts:93` hard-codes `encoding: 'utf8'` in `toMeta`, and `global.d.ts:808`
types `EditorLoadResult.encoding` as `'utf8'`.

**Decision**: both widen to `EncodingId`, validated by a core `isEncodingId` guard (no zod in this
repo). Three new invocations: `throng:editor:reopenWithEncoding` `{ docKey, encoding }`,
`throng:editor:saveWithEncoding` `{ docKey, encoding, hasBom }` and
`throng:editor:convertLineEndings` `{ docKey, target }`. One relayed field set:
`encoding`, `hasBom`, `encodingChosen`, `lineFormat` on the existing meta relay. See
[contracts/editor-encoding.md](./contracts/editor-encoding.md).

## R9 — The save refusal and its notice

**Decision**: `SaveReason` (`editor-service.ts:47`) gains `'unrepresentable'` carrying
`{ encoding, char, line }`. The renderer does **not** route it through `reportSaveError`'s modal: it
raises an inline banner on the editor through `panel-failure-banner.tsx` with one `confirm` action,
**Save as UTF-8**, which calls `saveWithEncoding({ encoding: 'utf8', hasBom: false })`. The banner
belongs to the document (one per document, every view shows it, *One condition, one notice*). A
second refused save flashes it. It clears when a save succeeds or the content changes so that the
character is gone.

Save All (`editor-save-all.ts`) already saves each document independently, so a refusal stops only
that document. A close that needed the save stays open, because the dirty-close dialog's save
returns failure.

## R10 — Reopen with Encoding

**Decision**: `coordinator.reload(docKey, { encoding })` re-reads through `EditorService.load`, which
gains an optional forced encoding. A fatal-decode failure returns
`{ reason: 'not-decodable', encoding }` and changes nothing (FR-014). On success, `adoptFromDisk`
runs as today: the buffer is reset, undo is cleared, `encodingChosen = true`. The dirty-discard
confirmation (FR-025) runs in the renderer before the call, through `useConfirm`. The existing
"Reload from disk" asks nothing, and this spec does not change it.

## R11 — Status strip

**Decision**: two buttons, `editor-encoding-<panelId>` and `editor-line-ending-<panelId>`, in the
controls group (`status-strip.tsx:597`) before the language button. Labels and accessible names come
from core's `encodingLabel` / `lineEndingLabel`. `status-strip-fit.ts` extends `HIDE_ORDER` to
`[…, 'line', 'lineEnding', 'encoding']`. The two indicators are measured as their own segments rather
than as part of the controls block, so they can drop while the language label and wrap toggle keep
040 FR-024's guarantee. Clicking either opens a small popup menu built from the same menu-item
builders the content menu uses (R12), so the two surfaces cannot disagree.

## R12 — Commands, menu items, chords

**Decision**: four `ActionId`s, scope `EDITOR_ONLY`, **unbound** (`[]`):
`editor.reopenWithEncoding`, `editor.saveWithEncoding`, `editor.convertLineEndingsToLf` and
`editor.convertLineEndingsToCrlf`. Each has a `keybindings-metadata.ts` descriptor and a
`docs/key-bindings.md` row with `*(unbound)*`. Content-menu items go in the `viewState` section
beside Set Language (`content-menu.ts:222`): *Reopen with Encoding…*, *Save with Encoding…*,
*Convert to LF* and *Convert to CRLF*, with the current ending's item checked. The two encoding items
open an encoding picker modelled on the language picker, with the current encoding marked.
**No `shipped-defaults.ts` change**, since no shipped default changes.

## R13 — The other readers

**Decision**: `file-search-service.ts:997` skips only a `refused` verdict and searches the decoded
text of everything else. `text-file-rewrite.ts:57-58` refuses `refused` verdicts with their reason,
and encodes with the file's own encoding. A replacement that introduces a character the file's
encoding cannot hold refuses that file with reason `'unrepresentable'`. `replace-commit-service.ts`
`FailedCommit.reason` gains that value, and `'encoding'` keeps its slot for a lossless-decode
failure. The preview inherits from `EditorService.load` (`main.ts:1664`) and needs no change of its
own. The not-text wording is shared through one core table `refusalMessage(reason)`, used by the
editor notice, the preview notice and the replace report (FR-053).

**Inventory (T045)**: `git grep` over `packages/*/src` for `readBytes(`, `new TextDecoder` and
`readFile(…'utf8')`. Project text is read at exactly `editor-service.ts:94`,
`file-search-service.ts:989` and `text-file-rewrite.ts:56`, and all three are tasked.
`preview-protocol.ts:181` serves a preview's source bytes to the preview frame **untouched**: it never
decodes, so it is outside FR-001. Every other hit reads config or JSON, the clipboard, or terminal
output, none of which are project files.

## R14 — Test layers

| What | Layer | Where |
|---|---|---|
| Detection, codecs, round trip, 256-byte 1252, BOM-less heuristic, binary fixtures (SC-001–SC-003) | unit | `packages/core/tests/unit/text-fidelity.test.ts` + `text-format-fixtures.test.ts` |
| `findUnrepresentable`, labels, refusal table | unit | same |
| 5 MB decode timing (SC-005) | unit | `text-fidelity-perf.test.ts`, relative to UTF-8 |
| Authority line format, conversion undo/redo, dirty | unit | `packages/ui/tests/unit/document-authority-line-format.test.ts` |
| Load → edit → save per encoding; mixed preserved; Save/Reopen with Encoding; refusal; recovery | integration | `packages/ui/tests/integration/editor-encoding.integration.test.ts` |
| Replace commit and task toggle on UTF-16 / 1252 | integration | `replace-commit-encoding.integration.test.ts` |
| Indicators, labels, a11y names, hide order, popup items | component | `status-strip-encoding.test.ts`, extended `status-strip-fit.test.ts` |
| Content menu items and checked state | component | `content-menu-encoding.test.ts` |
| Save-blocked banner, one notice, Save as UTF-8 action | component | `encoding-save-banner.test.ts` |
| Keybinding descriptors and scope | unit | the existing completeness tests cover the new ids |
| Open UTF-16 file → indicator → convert → save, end to end | E2E | `editor-encoding.e2e.ts`, `@extended @editor`, one test; budget re-seeded |

## R15 — Documentation

`docs/key-bindings.md` (four rows), `docs/preferences.md` Status Bar section (the bar now shows encoding
and line endings), `docs/architecture.md` "Editor and documents" (the detection function and the
authority-owned line format). The `throng-docs` audit runs before the PR.

## R16 — Which "error" decides a shared notice (FR-054, 2026-10-25)

**Decision**: inside the operation branch of `groupKey`, add the failure's `causeKey` when it has a
cause, else its message. Without either, the key is unchanged.

**Rationale**: the message alone would split one missing project root into an editors' notice and a
terminals' notice, because the two reporters word it differently — the storm 030 FR-029 removed. Every
casualty of a missing root already carries `path-missing:<root folder>` (`missing-file-watcher.tsx`
supplies the kind, `useReportPanelFailure` the root name), so the cause keeps them together. Refusals
(`binary`, `utf32`, `not-decodable`) carry no cause and differ by message, so they split, which is
what the user asked for.

**Alternatives**: the message only (splits one cause across reporters); the cause only (refusals have
none, so they would still merge); a new notice per failure (drops FR-029 entirely).

## R17 — Encoding in the authority, and a per-line record that follows edits (FR-055, FR-061)

**Decision 1 — the authority owns the encoding.** `DocumentAuthority` holds `{encoding, hasBom}` and its
saved value, beside the line format; `dirty` compares both. Change Encoding records an undo entry with
empty change sets and `encoding: {before, after}`, exactly as a conversion carries `format`. The
coordinator's `doc.encoding` / `doc.hasBom` fields go, read from the authority instead.
*Alternative rejected*: keeping `doc.encoding` and syncing it after undo — two copies of one fact.

**Decision 2 — the record maps through every change.** `mapLineEndings` walks a `ChangeSet` over the
old document: the line breaks inside a replaced range are dropped, and the breaks in the inserted text
take the inserting ending — the dominant one for an ordinary edit, the chosen one for Insert Line
Break. Changes apply from the last to the first, so earlier indices stay valid. A record whose entries
are all one ending collapses to uniform. The dominant ending (`lineEnding`) is unchanged by edits.

**Decision 3 — an edit that changes the record stores `format {before, after}`.** Undo cannot re-derive
it: an undone deletion re-inserts its break, and mapping would give that break the dominant ending, not
the one it had. A merged typing run keeps the run's first `before` and the latest `after`.

**Decision 4 — Insert Line Break is main's edit**, like a conversion: the renderer sends the carets, the
authority applies the change and the ending together, and the canonical message carries both.

**Decision 5 — View Whitespace is a view extension**: CodeMirror's `highlightWhitespace` for spaces and
tabs, `highlightSpecialChars` widened to the C0 controls, VT, FF and U+FEFF, and a line-end widget
showing that line's ending from the document format; the BOM mark is a widget at offset 0 while
`hasBom`. Per panel, never part of the document.

**Decision 6 — Save with Encoding is removed**, not kept as an alias: Change Encoding then Save does the
same in two steps, and FR-055 supersedes it.
