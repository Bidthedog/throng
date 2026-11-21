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

| State | Condition | Slider | Box | Message |
|---|---|---|---|---|
| On a stop | value is a stop | live | stored value | none |
| Overridden | within hard bounds, not a stop | greyed, operable, at nearest stop | stored value | none |
| Typing, invalid | text out of hard bounds | unchanged | typed text | bound message |
| Typing, not a number | text not a whole number | unchanged | typed text | "Not a whole number" |

Transitions: drag → stores the stop (→ On a stop); confirm valid → stores (→ On a stop or Overridden); confirm out of
bounds → stores the nearer hard bound; confirm non-number or Escape → restores the stored value; Reset → shipped
default.

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
