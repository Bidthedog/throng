# Data model: Markdown preview extensions

## Callout type registry entry (core, `preview/callouts.ts`)

| Field | Type | Rule |
|---|---|---|
| `id` | `CalloutTypeId` (`'note' \| 'abstract' \| … \| 'quote'`) | canonical, lower case, unique |
| `aliases` | `readonly string[]` | lower case; unique across every entry's id and aliases (FR-019a) |
| `title` | `string` | default title when the marker names the canonical id with no title |
| `icon` | `IconKey` | `callout<Id>` (e.g. `calloutNote`); must exist in `ICON_KEYS` |
| `role` | `CalloutRole` | one of the seven |

`CalloutRole` = `'neutral' | 'info' | 'accent' | 'success' | 'question' | 'warning' | 'danger'`, each with
theme token `colours.callout<Role>`.

`resolveCalloutType(written: string) → { entry, known: boolean }` — case-insensitive; unknown → `note`.
`calloutTitle(written, title?)` → the title per FR-002 (title text; else the canonical entry's title when the
written type is the canonical id; else the written type in title case).

## Callout (rendered)

Written type, canonical type, title (inline HTML), fold sign (`''`, `'+'`, `'-'`), source line, body
(optional), fold state (view state, body-owned, keyed `<line>:<sign>`).

## Math expression

| Field | Rule |
|---|---|
| `mode` | `inline` \| `display` |
| `source` | TeX between the delimiters, verbatim |
| `delimiters` | as written (`$`, `$$`, `` $` ``, fence) — for plain-text copy and the off state |
| `line` | display only: document line (`data-source-line`) |
| output | typeset HTML (sanitised) or `{ error: message }` |

## Print capability (core, on `PreviewProviderDescriptor`)

`print?: 'document' | 'pages'` — absent: cannot print (FR-062). `document`: the view supplies a flowing
document throng paginates; `pages`: the view supplies ready-made PDF pages.

## Printable output (core, `preview/print.ts`)

```text
PrintableOutput =
  | { kind: 'document'; html: string; fit: 'width' | 'page'; remoteImages: readonly string[] }
  | { kind: 'pages'; pdf: Uint8Array }
PrintJobRequest = { title: string; output: PrintableOutput }
```

`html` is a complete document built by the renderer's printable builder (contract `print.md`).

## Print settings (core, `preview/print.ts`)

| Field | Type | Default | Persisted |
|---|---|---|---|
| `printer` | `string \| null` | OS default printer | yes; falls back to default when missing |
| `pageSize` | `'A3' \| 'A4' \| 'A5' \| 'Letter' \| 'Legal' \| 'Tabloid'` | `A4` | yes |
| `orientation` | `'portrait' \| 'landscape'` | `portrait` | yes |
| `margins` | `{ preset: 'default' \| 'none' \| 'minimum' \| 'custom'; custom: { top, right, bottom, left } }` (mm, 0–50) | `default`, custom 10 each | yes |
| `scale` | `{ fitWidth: boolean; percent: number }` (10–200) | `fitWidth: true`, 100 | yes |
| `copies` | integer 1–99 | 1 | yes |
| `pages` | `{ all: true } \| { all: false; ranges: string }` (`1-3,5`) | all | **no** — every window starts at All |

File: `userData/print-settings.json` = `{ "version": 1, "settings": { …the persisted fields } }`. Parse rules:
unreadable or wrong shape → defaults (logged); each field validated alone, an invalid one takes its default;
a printer not in the OS list → the default printer.

## Print job (main, `print-controller.ts`)

`id` (random), `parent` window, `request`, temp HTML path, last PDF path, state
`open → previewing → printing → closed`. Exactly one job at a time (the window is single, FR-071).

## Print palette (core, `preview/print-palette.ts`)

A frozen copy of a `ThemeColours` object — every colour token, written out as literal values seeded from the
shipped Light theme, never a reference to it. The printable builder turns it into the same
`--throng-colour-<token>` custom properties the theme provider sets (`toCssVariables`), so every preview style
reads print colours unchanged.
