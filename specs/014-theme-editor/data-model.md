# Phase 1 Data Model: Theme Editor — Restore & Create Controls

This feature adds **no** persisted schema. It introduces in-memory view/decision types (pure, in
`@throng/core`) and reuses feature 010's result types. Persistence remains one JSON file per theme under
`configRoot/themes/<name>.json`, written only through feature 010's atomic primitive.

## Entities (in-memory, pure — `packages/core/src/config/theme-editor-model.ts`)

### ThemeRow

One entry in the Themes-tab picker (a dropdown `<option>`).

| Field | Type | Notes |
|-------|------|-------|
| `name` | `string` | Theme name (also the on-disk file stem). |
| `kind` | `'built-in' \| 'custom'` | `built-in`: name ∈ reserved set. `custom`: name ∉ reserved. |

Derivation: `classifyThemes(present: string[], reserved: string[]): ThemeRow[]`.
- Every `present` name → an entry (`built-in` if `reserved.includes(name)`, else `custom`),
  preserving `present` order. Deterministic and stable.
- A **deleted built-in produces no entry at all** (FR-005a): it is recovered only by Restore All, so
  there is nothing to select for it.

Which action controls the toolbar shows depends on the **kind of the selected** entry (there is one
shared set of controls, not per-row ones — FR-012):

| selected `kind` | Activate on select | Restore | Clone | Rename | Delete |
|-----------------|--------------------|---------|-------|--------|--------|
| `built-in` | ✔ | ✔ (confirm) | ✔ | — (built-ins keep reserved names) | ✔ (delete → leaves the list; only Restore All brings it back) |
| `custom` | ✔ | — | ✔ | ✔ (name dialog) | ✔ (gone for good) |

**Restore All** is always available regardless of the selection, and is visually separated from the
controls above (it acts on every built-in, not on the selection) with its own icon token.

### ThemeNameValidation

Result of validating a proposed Clone/rename name.

| Field | Type | Notes |
|-------|------|-------|
| `ok` | `boolean` | `true` when the name is acceptable. |
| `reason` | `'empty' \| 'reserved' \| 'duplicate'` (only when `ok:false`) | `empty`: blank/whitespace. `reserved`: name ∈ reserved built-in set (incl. deleted built-ins). `duplicate`: name already used by another **custom** theme. |

Derivation: `validateThemeName(name: string, ctx: { reserved: string[]; existing: string[]; renamingFrom?: string }): ThemeNameValidation`.
- Trim; empty → `{ok:false, reason:'empty'}`.
- Matches a `reserved` name → `{ok:false, reason:'reserved'}`.
- Matches any `existing` present theme (excluding `renamingFrom`) → `{ok:false, reason:'duplicate'}`.
- Otherwise `{ok:true}`.

All comparisons are **case-insensitive** and run against **every** present theme, not just custom
ones (FR-007a) — a theme name is a file name, and `Throng.json` is the same file as `throng.json` on
Windows, so a case-sensitive check would allow a clone to silently overwrite a built-in.

Helper: `cloneName(source: string): string` → `` `${source} - Clone` ``. The renderer computes the
selection range of the trailing `"Clone"` word for pre-selection in the dialog.

## Reused types (feature 010 — no change)

- `reservedThemeNames(d?): string[]`, `isReservedThemeName(name, d?): boolean` — the reserved built-in
  name set (`Object.keys(shipped.themes)`), including any built-in the user has deleted.
- `RestoreResult = { ok:true } | { ok:false; failedPath:string; error:string }` — returned by
  `restoreAllThemes()` and the new `restoreTheme(name)`.

## New service result (feature 010 service — `restoreTheme`)

`restoreTheme(name)` returns `RestoreResult`, plus one guard value for a non-built-in target:

| Outcome | Value |
|---------|-------|
| Restored / recreated OK | `{ ok:true }` |
| Locked/unwritable file | `{ ok:false, failedPath:'themes/<name>.json', error:<msg> }` |
| `name` not a reserved built-in | `{ ok:false, failedPath:'', error:'not-reserved' }` (writes nothing) |

## State transitions (theme lifecycle as the editor sees it)

```text
built-in (edited)  --per-theme restore (confirm)-->  built-in (shipped values)
built-in (present) --delete (confirm)------------>   ABSENT (not listed; name stays reserved)
ABSENT (built-in)  --Restore All (confirm)------->   built-in (shipped values)   [the ONLY way back]
any present theme  --Clone--> name dialog --confirm valid name-->  new custom (copy of source)
custom             --rename--> name dialog --confirm valid name-->  custom (renamed)
custom             --delete (confirm)------------>   GONE (no shipped record; unrecoverable)
(all built-ins)    --Restore All (confirm)------->   every built-in at shipped values; deleted ones recreated; customs untouched (atomic)
```

Invariants:
- A `custom` entry's name is never in the reserved set (enforced by `validateThemeName` at create/rename
  and by the store's `checkRename`/`isSafeThemeName` at write time).
- A deleted **built-in** is absent from the picker but its name stays **reserved**, so no new theme may
  take it; only Restore All brings it back. A deleted **custom** theme has no shipped record and is gone
  for good.
- Restore All and per-theme restore never modify or remove any `custom` theme.
- Restore All (and the single-theme restore beneath it) are idempotent: re-running against an
  already-restored state converges (010).
