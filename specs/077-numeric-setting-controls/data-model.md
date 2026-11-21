# Data model: Consistent numeric setting controls

## NumericDescriptor (extends the existing settings descriptor)

| Field | Type | Rule |
|---|---|---|
| `storedUnit` | `'bytes' \| 'ms' \| 'count' \| 'characters' \| 'px' \| 'percent'` | Required for every numeric setting (FR-001) |
| `display` | `DisplayUnit` | Required; sizes → `MB`, durations per FR-005 (research R2), `own` otherwise |
| `min`, `max`, `step` | integer, stored unit | `(max − min) % step = 0`; default is a stop (FR-011) |
| `hardMin`, `hardMax` | integer, stored unit | Required; `hardMin ≤ min`, `max ≤ hardMax` (FR-010) |
| `unitLabel` | string | What a `count` counts (`entries`, `columns`, `days`) |
| `label` | string | Carries no unit (FR-013) |

## DisplayUnit

| Unit | Factor from stored | Shown as |
|---|---|---|
| `MB` | 1,048,576 bytes | `25 MB`; off-stop to at most two decimals (`11.77 MB`) — *amended 2026-11-21 (T032), was one decimal (`11.8 MB`)* |
| `ms` | 1 | `125 ms` |
| `s` | 1,000 ms | `1.5 s` |
| `min` | 60,000 ms | `5 min` |
| own unit | 1 | `40 characters`, `520 px`, `80 %`, `10 items` |

## Control state (derived — research R3)

| State | Condition | Slider | Box | Preferences toast |
|---|---|---|---|---|
| On a stop | value is a stop | live | stored value | none |
| Overridden | within hard bounds, not a stop | greyed, operable, at nearest stop | stored value | none |
| Typing, invalid | text out of hard bounds | unchanged | typed text, invalid outline | "<Setting> must be between <lo> and <hi>" |
| Typing, not a number | text not a whole number | unchanged | typed text, invalid outline | "<Setting> must be a whole number" |

Nothing is shown inline beside or beneath the box: the box keeps only its invalid outline and `aria-invalid`, and what
is wrong is said in the Preferences window's toast, naming the setting and what it takes (FR-024). An emptied box is
named only when it is confirmed (FR-009).

Transitions: drag → stores the stop (→ On a stop); confirm valid → stores (→ On a stop or Overridden); confirm out of
bounds → stores the nearer hard bound; confirm non-number → stores nothing and KEEPS the entry, its toast flashing, until
it is corrected (an entry is never discarded — FR-009, 040 FR-007, 018 FR-017); Escape → restores the stored value and
the toast goes; Reset → shipped default.

*Amended 2026-11-21 (T048) — this section said a confirmed non-number restored the stored value, and showed the reason
in an inline Message column. FR-009 (2026-11-20) keeps the entry, and FR-024 (2026-11-21) moved the reason to the toast;
the controls (`form-controls.tsx` NumberControl, `map-control.tsx`) do both, and this section now says so.*

## Renamed keys (FR-001, FR-002)

| Old key | New key | Factor | Migrated |
|---|---|---|---|
| `terminals.attention.quietSeconds` | `terminals.attention.quietMs` | ×1,000 | yes (v37) |
| `resourceMonitor.captureIntervalSeconds` | `resourceMonitor.captureIntervalMs` | ×1,000 | yes |
| `resourceMonitor.historyMinutes` | `resourceMonitor.historyMs` | ×60,000 | yes |
| `diagnostics.maxFileSizeKb` | `diagnostics.maxFileBytes` | ×1,024 | yes |
| `diagnostics.maxTotalMb` | `diagnostics.maxTotalBytes` | ×1,048,576 | yes |
| `editor.previews.syncHighlightSeconds` | `editor.previews.syncHighlightMs` | ×1,000 | no (unreleased) |
| `editor.previews.providers.spreadsheet.maxPreviewMb` | `…spreadsheet.maxPreviewBytes` | ×1,048,576 | no (unreleased) |
