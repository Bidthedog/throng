# Data Model: CSV Grid and Spreadsheet Previews

**Spec**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

## §1 CsvModel (core, derived)

`packages/core/src/csv/csv-model.ts`. Parsed from a CSV document's text; never stored, never an
authority.

| Field | Type | Meaning |
|---|---|---|
| `delimiter` | `',' \| ';' \| '\t'` | Detected (FR-022) or given |
| `lineEnding` | `'\r\n' \| '\n' \| '\r' \| null` | First line ending in the text |
| `trailingLineEnding` | boolean | The last record is followed by a line ending |
| `records`, `width` | number | Record count; widest record's field count |
| `recordStart`, `recordEnd` | Int32Array | Per record: first char; where its line ending starts |
| `recordFieldStart` | Int32Array (`records + 1`) | Per record: index of its first field |
| `fieldStart`, `fieldEnd` | Int32Array | Per field: span, quotes included |
| `fieldQuoted` | Uint8Array | 1 when the field opened with a quote |
| `fault` | `{ line } \| null` | First unterminated quote (FR-046) |

Rules: an empty text has 0 records (the grid shows one empty cell); a blank line is a record of one
empty field; a missing field reads as `''`.

## §2 CsvGridOperation (core, wire)

`packages/core/src/csv/grid-operation.ts`. What the grid asks main to do; main resolves it against the
document's current text (`csv-edit.ts`) into `CsvTextChange[]`.

```ts
type CsvGridOperation =
  | { kind: 'setCells'; cells: { row: number; col: number; value: string }[] } // edit, clear, paste
  | { kind: 'insertRows'; at: number; count: number }                          // Insert Row Above/Below
  | { kind: 'insertColumn'; at: number }                                       // Insert Column Left/Right
  | { kind: 'deleteRows'; from: number; count: number };                       // cut whole rows
```

Validation (main): integers ≥ 0, `count` 1–10,000, at most 1,000,000 cells per paste, values strings.
A refused operation leaves the document unchanged. A document whose text has a `fault` refuses every
operation (`malformed`).

## §3 Grid document (main)

`CsvGridService` (`packages/ui/src/main/csv-grid-service.ts`), per CSV preview run:

| State | Meaning |
|---|---|
| no document | the file is not open in any editor; the run reads the disk (044 FR-023) |
| editor document | an editor holds the file; the run is parented to it; edits apply to it |
| grid document | the service opened the file under `csv-grid:<previewPanelId>` on the first edit; the run is parented to it, reported `parent: null`, `ownsDocument: true` |

Transitions: *no document* → *grid document* on the first edit; *grid document* → *editor document*
when the preview closes while an editor is linked (`handOver`); *grid document* → *no document* when the
preview closes with none (`destroy`, after the dirty-close prompt in the renderer); *editor document* →
*no document* when the editor's document is destroyed (the run falls back to the disk; the next edit
opens a grid document).

## §4 Provider descriptor additions (core)

`PreviewProviderDescriptor` gains, additively:

| Field | Meaning |
|---|---|
| `editable?: true` | Text providers only. The preview edits its document (FR-030): `PreviewService` shows edits at once, the chrome lets the body own paste, cut and drop, and the run may own a grid document |
| `sizeLimitSetting?: string` | Names one of the provider's `number` settings, in MB, that caps what its preview reads (FR-061, FR-062) |
| (074) the Open-in fields | the shipped value and option labels, owned by 074 |

Registered providers:

| id | kind | extensions | own settings |
|---|---|---|---|
| `csv` | text, `editable`, `flowingDocument: false` | `.csv` | — |
| `spreadsheet` | binary | `.xlsx .xlsm .xlsb .xls .ods .fods .numbers` | `firstRowHeader` (toggle, off), `maxPreviewMb` (number 5–500 step 5, ships 25), `sizeLimitSetting: 'maxPreviewMb'` |

## §5 PreviewUpdate / PreviewNotice additions (core wire)

- `PreviewUpdate.ownsDocument?: boolean` — the run follows a grid document (§3). Absent = `false`.
- `PreviewNotice` `too-large` gains optional `{ size, limit }` in bytes (FR-062).

## §6 Workbook (renderer, worker output)

```ts
interface WorkbookSheet { name: string; hidden: boolean; rows: string[][]; width: number }
type WorkbookRead =
  | { ok: true; sheets: WorkbookSheet[] }
  | { ok: false; reason: 'password' | 'malformed' | 'unsupported'; detail: string };
```

## §7 Per-file grid state (persistence)

`document_state.grid_column_widths TEXT NOT NULL DEFAULT ''` (migration v13; `''` means no widths stored).
`DocumentStateDto.gridColumnWidths: Record<string, number> | null` (`null` for `''`). Keys are column indexes;
values are pixel widths at zoom 1, clamped 40–2000. A row is deleted when `language_id` is null and
`grid_column_widths` is `''`.
