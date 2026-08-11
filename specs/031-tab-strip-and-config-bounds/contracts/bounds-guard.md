# Contract: the generic bounds guard

**Module**: `packages/core/src/config/bounds-guard.ts` (new, pure — no OS, no DOM)

**Requirements**: FR-008, FR-008a–f, FR-009, FR-009a, FR-010, FR-011, FR-012, FR-013, FR-014, FR-041

The single mechanism that enforces every declared bound (FR-009). No other code may clamp a value
whose range is declared in a metadata registry.

## Surface

```ts
export interface Correction {
  path: string;
  kind: 'clamped-min' | 'clamped-max' | 'default-substituted' | 'entry-restored' | 'entry-dropped';
  from: unknown;
  to: unknown;
}

export interface CorrectionOutcome<T> {
  value: T;
  corrected: boolean;
  corrections: Correction[];
}

/**
 * Correct `raw` against every bound the registry declares, returning the corrected document and
 * whether anything moved. Never throws: a document this cannot parse yields `defaults`.
 */
export function applyDeclaredBounds<T>(
  raw: unknown,
  registry: MetadataRegistry,
  defaults: T,
): CorrectionOutcome<T>;
```

## Guarantees

| # | Guarantee | Requirement |
|---|---|---|
| G0 | The bound enforced is **`hardMin ?? min`** and **`hardMax ?? max`**. A descriptor that declares neither behaves exactly as before, so every existing descriptor is unaffected | FR-015b |
| G0a | `diagnostics.maxFileSizeKb` declares `hardMax: 65536`, so a hand-set 64 MB log cap survives — the slider's 4096 ceiling constrains the control, not the file | FR-015a |
| G1 | A value below the enforced minimum returns it; above the enforced maximum returns it | FR-008 |
| G1a | `terminals.linkHoverDelayMs`, `diagnostics.keepFiles` and `search.asYouTypeDebounceMs` resolve to their **declared** ranges (0–2000, 1–20, 0–1000) — none declares a hard bound, and none had a stated reason for parsing wider | FR-015 |
| G2 | Applies to descriptor **columns** as well as leaves — a `map`/`records` entry's column value is corrected against that column's declared range | FR-008a |
| G3 | A malformed entry never invalidates its table; the other entries load | FR-008b |
| G4 | A dropped entry is restored from the shipped default **for its own key** if the defaults carry it, and dropped if not. Entries that loaded correctly are never touched | FR-008c |
| G5 | A value of the wrong type, absent, `null` or non-finite yields the shipped default | FR-011 |
| G6 | A value outside a declared `allowedValues`, or a non-boolean where a boolean belongs, yields the shipped default | FR-012 |
| G7 | **Absence is not malformation.** A key that is simply missing from a *clearable* table is left missing | FR-008f |
| G7a | **A column with no `key` addresses the entry's value itself.** `MapColumn.key` is optional — "omitted for a scalar-valued map" (`metadata.ts:61`) — so a scalar-valued table like `editor.languageByExtension` (`{ label: 'Language', control: 'select' }`) must be corrected against its value, not against a property of it | FR-008a |
| G7b | **A `select` that declares no `allowedValues` has no set to enforce**, so G6 does not fire and nothing is substituted. `editor.languageByExtension`'s column declares none — its valid values are the languages known at runtime, not a static list. A naive G6 would find every mapping "outside the set" and replace it with the default, wiping the one table FR-008f exists to protect | FR-012, FR-008f |
| G7c | A `records` control is corrected per entry against its columns exactly as a `map` is, keyed by its declared identity field rather than by the map key | FR-008a |
| G8 | `corrected` is true iff at least one `Correction` was recorded | FR-013, FR-014 |
| G9 | **Idempotent**: `applyDeclaredBounds(applyDeclaredBounds(x).value)` records no corrections | FR-013d |
| G10 | Never throws, for any input — including a non-object, an array, or a cyclic structure | FR-011 |
| G11 | Adding a bounded descriptor to the registry guards that key with **no change here** | FR-010, FR-041 |
| G12 | A corrected, dropped or restored **table entry** counts as a change, so a file whose only fault is inside a table is still written back | FR-008e |
| G13 | Resetting a setting to its shipped default is unaffected: the default is by definition within its own bound, so the guard is inert on that path and it causes no write-back churn | FR-017 |

## Integration: write-back

**Module**: `packages/ui/src/main/config-store.ts`

`FileConfigStore.read()` currently takes `validate: (raw) => T` and cannot tell a corrected read from
a clean one. The settings read path passes a validator built on `applyDeclaredBounds` and, when
`corrected` is true, writes the corrected document back through the existing `write()`.

| # | Guarantee | Requirement |
|---|---|---|
| W1 | A corrected document is written back, so the file states what is in use | FR-013 |
| W2 | A document with no corrections is **not** rewritten — no churn on a clean start | FR-014 |
| W3 | Correction happens on **every** read, in every process; write-back happens only in UI-main | FR-013a, FR-013b |
| W4 | The write-back goes through the same serialised write path as a Settings-editor save, so the two cannot interleave | FR-013c |
| W5 | Re-reading a written-back document produces no further correction and no further write — the sequence settles after one write | FR-013d |
| W6 | A failed write-back is reported and **not retried in a loop**; the application starts and runs on the corrected values | FR-018 |
| W7 | Correction runs on **every** read, including a reload triggered by the file changing while the app runs — and a correction found on reload is written back too, not only one found at startup | FR-013a |

## Non-goals

- Layout and workspace files. `#227` scopes this to settings; the guard must not be *shaped* so that
  extending to them later needs a second implementation (FR-009a), but it is not wired to them here.
- Schema validation of unknown or misspelled keys.
- Migrating legacy config shapes.

## Test obligations

**Unit** (`packages/core/tests/unit/`) — the enumerating test is the point: it must walk
`SETTINGS_METADATA` and assert G1/G2 for **every** descriptor carrying a bound, rather than listing
settings by hand (SC-004, and FR-008's own acceptance criterion). A test that checks the three
settings this feature adds would pass while the requirement stayed violated elsewhere.

Also unit: G3–G11 including the degenerate `min === max` case, the cyclic input, and idempotency.

**Integration** (`packages/ui/tests/integration/`) — W1, W2, W5 and W6 against a real temp config
root: write an out-of-range file, load, assert the value and the rewritten file; write a clean file,
load, assert **mtime unchanged**; make the file read-only and assert the app still starts.
