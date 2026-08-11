# Contract: grapheme counting and the name limit

**Modules**: `packages/core/src/text/grapheme.ts` (new, pure) · `packages/core/src/workspace/panel-title.ts` (extended)

**Requirements**: FR-033, FR-033a–c, FR-034–FR-040a

## Surface

```ts
/** Number of grapheme clusters — what a user would point at and call characters. */
export function countGraphemes(text: string): number;

/**
 * The first `limit` grapheme clusters. Cuts only on a cluster boundary, so the result never
 * contains a split surrogate pair, a halved emoji, or an accent parted from its letter.
 * Adds no ellipsis and no marker. Idempotent at a fixed limit.
 */
export function truncateGraphemes(text: string, limit: number): string;

/** True when `text` was longer than `limit` — drives the render-time ellipsis, never the value. */
export function wasTruncated(text: string, limit: number): boolean;
```

`panelDisplayTitle()` gains the limit so every panel-name source is bounded at the one place that
resolves them (R8):

```ts
export function panelDisplayTitle(
  panel: Panel,
  sources?: PanelTitleSources,
  maxNameLength?: number,   // omitted → unbounded, preserving current callers until they are migrated
): string;
```

## Guarantees

| # | Guarantee | Requirement |
|---|---|---|
| N1 | Counting is by grapheme cluster: ten emoji count as ten, not twenty or forty | FR-033a |
| N2 | A cut never falls inside a cluster. The result may be one character **shorter** than the limit, which is correct rather than a rounding error | FR-033b |
| N3 | The same counting rule governs the rename cap and every truncation, so a name the user could type is never one the app then shortens | FR-033c |
| N4 | The result contains no ellipsis or marker of any kind | FR-037a |
| N5 | **Idempotent**: truncating an already-truncated name at the same limit changes nothing, so successive reductions cannot accumulate markers | FR-037b |
| N6 | `wasTruncated` is false for a name exactly at the limit | FR-037d |
| N7 | A limit of `0` or a negative limit yields `''` without throwing; a non-finite limit is treated as unbounded | defensive |
| N8 | `panelDisplayTitle` bounds its **result**, whatever the source — user override, live shell title, flavour label, or file path | FR-037 |
| N9 | **Trailing whitespace left by the cut is trimmed**, so a cut landing after a space cannot make two names render identically. Leading whitespace is untouched — the user typed that. Trimming can only shorten, so it never breaches the limit | FR-037e |

## Where the limit is applied

| Site | Behaviour | Requirement |
|---|---|---|
| Tab rename field | Live cap; input stops at the limit. Counter shown within 10 of it | FR-035, FR-035a |
| Panel rename field | Identical | FR-035g |
| Rename **commit** | Applies the limit, so a field opened on an over-long name cannot reintroduce one | FR-035f |
| Paste | Inserts as much as fits; counter reads at-limit | FR-036, FR-036a |
| Tab name read from the layout | Truncated for display | FR-037, FR-038 |
| `panelDisplayTitle()` | Truncated for display | FR-037, R8 |

## Persistence

| # | Guarantee | Requirement |
|---|---|---|
| NP1 | Shortening on read does **not** rewrite the stored name | FR-040 |
| NP2 | The shortened form is persisted only when the layout is next written **for another reason** | FR-040 |
| NP3 | Loading a layout is not such a reason — open and close with no other change leaves stored names as they were | FR-040a |
| NP4 | An over-long name in a saved layout loads successfully; it is never rejected and never errors | FR-038 |

## The rename counter

| # | Guarantee | Requirement |
|---|---|---|
| C1 | Hidden while the name is more than 10 characters from the limit | FR-035b |
| C2 | Shown, with used-against-total, from 10 remaining onwards; reads at-limit when full | FR-035a |
| C3 | **Not an error state** — no error styling, no notice, no blocked commit | FR-035c |
| C4 | Counts in grapheme clusters, so it can never disagree with what the field permits | FR-035d |
| C5 | Tracks the limit changing while the field is open | FR-035e |
| C6 | At a limit of 10 it is visible from the first character. Correct, not a bug | spec Edge Cases |

## Test obligations

**Unit**: N1–N8 and C4, with a fixture set covering ASCII, CJK, a ZWJ family emoji, a
skin-tone-modified emoji, a regional-indicator flag, and a base letter plus combining accent — each
straddling the limit boundary, which is the only place N2 can fail.

**E2E**: the rename cap and counter for both tabs and panels (C1–C3, C5); an over-long name in a
seeded layout loading truncated (NP4); lower-then-raise reversibility (NP1, NP3); and the persistence
transition (NP2) — lower the limit, cause an unrelated layout save, raise it, assert the names stayed
short.

**ID namespace note**: these persistence guarantees are `NP*`, not `P*`. `contracts/tab-strip.md` §6
already uses `P1`–`P10` for per-tab *presentation*, and tasks citing a bare `(P1)` were ambiguous
between the two — flagged by `/speckit-analyze` as I1.
