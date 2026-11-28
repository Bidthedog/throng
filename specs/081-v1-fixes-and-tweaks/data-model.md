# Data model: v1.0.0 fixes and tweaks

## EditorUiState additions (US2)

| Field | Type | Rule |
|---|---|---|
| `unloadableReason` | refusal reason (018: `missing`, `folder`, `too-large`, `out-of-tree`, `binary`, `utf32`, `not-decodable`) or `undefined` | Set with `unloadableDetail`; kept when an authority `unloadable` verdict carries no reason; cleared with `unloadable`. |
| `historyStandIn` | boolean | True while the panel shows a Back/Forward stand-in for a gone path (044 FR-106d). The tab-open scan skips it. |

## Pending missing report (US2)

Per tab scan: `Map<panelId, reason>` of panels whose file cannot be opened but that Focus Mode hides. Entry removed
when reported (panel shown), when the file opens, or when the panel closes. Reported at most once per entry.

## Settle timer (US2)

Per document (coordinator) and per standalone preview run: at most one pending timer of
`EXTERNAL_DELETE_SETTLE_MS`. Replaced by a newer disk change, cleared on dispose or `beginMove`. On fire: re-read;
present → existing reload path; absent → `markDeleted` / `deleted` notice.

## Ignore verdict (US8)

`Set<relPath>` per explorer root, answered per listing. A node is faded when its path is in the set or any ancestor
is. Re-asked for all listed entries when a `.gitignore` changes. Empty outside a repo.

## Theme token (US8)

`ignoredEntryOpacity`: number, 0.2–1, step 0.05, default 0.6, in every bundled theme. Emitted as
`--throng-explorer-ignored-opacity`.

## Setting (US7)

`explorer.autoRevealActivePreview`: boolean, default `true`, File Explorer group, directly after
`explorer.autoRevealActiveFile`.

## CSV entry row (US9)

View-only row index `records`. Not in `CsvModel`. Writing to it produces `CsvModel.records + 1` with the new record
padded to `width`; line ending and `trailingLineEnding` unchanged (FR-081a).
