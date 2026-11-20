# Contract: the per-preview-type "Open … in" preference (074 FR-016 – FR-019)

Owned by spec 074; consumed by spec 073 (CSV, spreadsheet) and every later provider.

## Setting

| | |
|---|---|
| Key | `editor.previews.providers.<id>.defaultOpenAction` (unchanged; no migration) |
| Type | `DefaultOpenAction = 'editor' \| 'preview' \| 'os'` |
| Offered | text provider: `editor`, `preview`, `os` — binary provider: `preview`, `os` |
| Option labels | `editor` "Throng Editor" · `preview` descriptor `previewOptionLabel` ?? "Throng Preview" · `os` "Default OS Program" |
| Label | `Open ${filesNoun} in`, `filesNoun` from the descriptor, default `"${displayName} files"` |
| Shipped | descriptor `defaultOpenAction` ?? (`'editor'` for text, `'preview'` for binary) |
| Parse | a value the provider does not offer → the provider's shipped value |
| `enabledWhen` | the provider's `enabled` toggle (drawn disabled, not hidden, while off) |

Shipped providers: Markdown `Markdown files` / `editor`; Mermaid `Mermaid files` / `preview`; Image
`images` / `preview`; SVG `SVG files` / `preview`; PDF `PDFs` / `preview`; HTML `HTML files` /
`preview`. Spec 073: CSV `CSVs` / `preview` with `previewOptionLabel: 'Throng Preview Editor'`.

## Behaviour — `defaultOpenActionFor(registry, previews, path)`

| Provider for `path` | Answer |
|---|---|
| none, or disabled | `'editor'` (the caller's existing route: editor, or 067's open-unsupported-in-OS rule) |
| enabled | the stored value if offered, else the shipped value |

| Entry point | `editor` | `preview` | `os` |
|---|---|---|---|
| Files & Folders open gesture / Enter | editor | preview (`preview.open`) | OS default program, no panel |
| Quick Open | editor | preview | OS default program (answers "opened") |
| Link followed in a preview (067 FR-131 path) | editor | preview | OS default program |
| Find in Files result | editor at match | preview where the provider can reveal, else editor | **editor at match** (FR-019) |
| Open In → New Editor / Preview / Open in OS Default Program | always what it names | | |

The OS route is `osLinkActions().openInOsDefaultProgram({ text: absPath, kind: 'detectedPath', … })`;
its failure raises the one notice `linkFailureReport` shapes (067 FR-018).

## Descriptor fields (core, `PreviewProviderDescriptor`)

```ts
defaultOpenAction?: DefaultOpenAction; // shipped value; now valid for binary providers too
filesNoun?: string;                     // "images", "PDFs"; default `${displayName} files`
previewOptionLabel?: string;            // default "Throng Preview"
```
