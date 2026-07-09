# Contract: `IFontEnumeration` OS seam (core abstraction + Windows impl)

**Abstraction**: `packages/core/src/abstractions/font-enumeration.ts`. **Contract suite**:
`packages/core/src/testing/font-enumeration-contract.ts`. **Windows impl**:
`packages/platform-windows/src/windows-font-enumeration.ts`. Bound in the **UI-main** composition root
(Principle II/IX). Feeds the `%APPDATA%\throng\fonts.json` cache and the font-family typeahead (FR-038a/b).

## Interface

```ts
interface IFontEnumeration {
  listInstalledFamilies(): Promise<string[]>;   // installed font-family names; order unspecified
}
```

## Contract guarantees (suite; run against every impl)

1. **Returns a string array** — possibly empty; **never throws** (enumeration failure → `[]`, so the picker
   falls back to a curated list rather than crashing — FR-038a).
2. **Family names, de-duplicated** — no empty strings; each entry is a usable CSS font-family name.
3. **Idempotent / side-effect-free** — repeated calls return equivalent results; no files written by the
   seam itself (caching is the caller's job).

## Usage (UI main — non-blocking, cached)

- At startup UI main calls `listInstalledFamilies()` **in the background** (not awaited on the startup path —
  SC-010) and writes `%APPDATA%\throng\fonts.json`.
- `config.listFonts()` returns the cache (empty if not yet written).
- A **restart** re-runs enumeration and refreshes the cache (no live refresh — FR-038a).

## Typeahead matcher (pure, separate module `config/font-typeahead.ts`)

```ts
matchFamilies(query: string, families: readonly string[]): string[];
```

- Split `query` on whitespace into tokens; keep a family iff **every** token is a **case-insensitive
  substring** of the family name (order-independent). Empty query → all families. (FR-038b: `ar` → "Arial",
  "Gamar"; `ar es` → "Ariales", "Esarame".)
