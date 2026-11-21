# Research: Consistent numeric setting controls

Decisions taken unattended (maintainer, 2026-11-20 12:17: "Continue unattended"). Each pending clarification in the
spec runs on its default; a change to one touches the decision named beside it.

## R1 — Slider maths in stored units

- **Decision**: The slider's min, max and step are declared in the stored unit (bytes, ms); the display unit only
  formats the value. Display-unit steps (1 MB, 25 ms, 1 s) are written as stored-unit multiples.
- **Rationale**: A stop is always a whole byte or ms, so no float rounding (e.g. 0.1 MB) can reach the file, and the
  "is this a stop" test is integer arithmetic.
- **Alternatives**: Slider in display units with conversion on commit — rejected: 11.8 MB round-trips to a different
  byte count.

## R2 — Display unit chosen per descriptor, not at run time

- **Decision**: Each descriptor names its display unit (`MB`, `ms`, `s`, `min`, `days`, or its own unit). A unit test
  checks the choice against the FR-005 rule (ms up to a 2 s maximum; s up to 10 min; min beyond; MB for every size).
- **Rationale**: The rule is enforced but the descriptor stays readable; a run-time switch would change the unit as a
  user drags.
- **Alternatives**: Auto-scaling display (switching from ms to s mid-slider) — rejected (spec edge case: one unit per
  slider).

## R3 — Override state is derived, never stored

- **Decision**: "Overridden" means `(value − min) % step ≠ 0` or `value > max` or `value < min` (within hard bounds).
  Nothing extra is written to `settings.json`.
- **Rationale**: The file holds one number per setting (constitution X); the greyed state follows from it, so a
  hand-edited value greys the slider too (FR-007).
- **Alternatives**: An `overridden` flag beside the value — rejected: two sources of truth.

## R4 — Validation and clamping in one pure function

- **Decision**: `numeric-units.ts` exports `checkTyped(text, descriptor) → {ok, value} | {error, message, clampTo}`.
  The control shows `message` while typing and stores `clampTo` on confirm; non-numbers return no `clampTo` and the
  control stores nothing, keeping the entry until it is corrected or Escape restores the stored value (FR-009; amended
  2026-11-21, T048 — this said the control restored the stored value). What is wrong is said in the Preferences toast,
  not inline (FR-024).
- **Rationale**: Unit-testable without a DOM; the same function backs the print fields (FR-020).
- **Alternatives**: Per-control logic — rejected (the current `parse` returns `null` for out-of-range and drops input).

## R5 — Out-of-bounds stored values (pending clarification 4)

- **Decision (revised at implementation)**: Nothing new. The existing bounds guard (`bounds-guard.ts`, 031 / #227)
  already clamps a stored value to the descriptor's hard bounds on read and writes the correction back; 077 only gives
  more settings hard bounds. T016 becomes a check that the guard covers them.
- **Rationale**: This is the single clamp FR-016 keeps; it lives with the descriptor, not at each consumer.

## R6 — Ranges (from the audit, pending clarification 3)

| Setting class | Slider | Step | Hard bounds |
|---|---|---|---|
| Hover dwells (submenu, tab/explorer/notification/resource-monitor popovers) | 0–1,500 ms | 25 ms | 0–10,000 ms |
| Debounces (find as-you-type, find-in-files settle, preview update) | 0–2,000 ms | 25 ms | 0–10,000 ms |
| Markdown heading jump | 0–1,500 ms | 50 ms | 0–5,000 ms |
| Scroll-sync highlight | 0–10 s | 0.5 s | 0–60 s |
| Attention quiet period | 10 s–10 min | 10 s | 1 s–1 h |
| Capture interval | 2–60 s | 1 s | 2–60 s |
| Monitor history | 1–30 min | 1 min | 1–30 min |
| Diagnostics keep (a count of days; clarification 1) | 1–30 days | 1 day | 1–30 days |
| Editor / preview file-size caps | 5–250 MB | 5 MB | 1 KB–2 GB |
| Spreadsheet cap | 5–500 MB | 5 MB | 1 KB–2 GB |
| Diagnostics file / total | 0.25–4 MB / 50–2,000 MB | 0.25 MB / 50 MB | 1 KB–64 MB / 1 MB–64 GB |
| CSV long-cell threshold | 10–1,000 characters | 10 | 1–100,000 |
| Tab chevron repeat delay, tab hover activation | 100–1,500 / 0–1,500 ms | 50 / 25 ms | to 10,000 ms |

Find debounce default moves 120 → 125 ms to sit on a stop; submenu dwell max 2,000 → 1,500; resource-monitor popover
0–5,000/50 → 0–1,500/25. Defaults otherwise unchanged.

## R7 — Migration (FR-002)

- **Decision**: `SHIPPED_DEFAULTS_VERSION` 36 → 37. `planSettingsUpgrade` gains a rename-and-convert step for released
  keys: `terminals.attention.quietSeconds`, `resourceMonitor.captureIntervalSeconds`, `resourceMonitor.historyMinutes`,
  `diagnostics.maxFileSizeKb`, `diagnostics.maxTotalMb`. Converts exactly (×1,000, ×60,000, ×1,024, ×1,048,576), removes the old key, and does nothing when the new key is present. Unreleased keys
  (073/074/075: `maxPreviewMb`, `syncHighlightSeconds`) change with no migration.
- **Rationale**: The existing gate already writes once per version and is idempotent by construction.

## R8 — One preview size cap (FR-018)

- **Decision**: Drop `sizeLimitSetting`; the spreadsheet provider names `maxPreviewBytes` through `maxFileBytesSetting`.
  `hasOwnSizeCap` and `maxFileBytesFor` lose their MB branch.

## R9 — Values quoted in text (FR-014, FR-015, FR-017)

- **Decision**: `numeric-units.ts` exports `formatSetting(value, descriptor)` (e.g. `25 MB (26,214,400 bytes)`,
  `1.5 s`). The too-large notice, the capture-interval description and the docs test use it. The resource monitor's
  interval menu lists the descriptor's stops and checks the current value even when it is off-stop.
- **Rationale**: A copied table or default is the 7.3.0 violation class; deriving from the descriptor removes it.

## R11 — Derived values keep their units (implementation, 2026-11-20)

- **Decision**: Only settings keys and the model fields that mirror them are renamed. Values derived from them keep
  their own units and convert at the boundary: the resource collector's `configure` message (`intervalSeconds`,
  `historyMinutes`), the resolved monitor settings and the retention policy. The log-size environment variables the
  main process hands its children move to bytes (`THRONG_LOG_MAX_BYTES`, `THRONG_LOG_MAX_TOTAL_BYTES`) so an exact
  byte value reaches them unrounded.

## R12 — No override flag (implementation, 2026-11-20)

- **Decision**: Every numeric control keeps the exact-value box it already had; the descriptor needs no `override`
  field (clarification 2, revised). A display unit of `own` with an optional `unitLabel` covers counts.

## R10 — Print dialog (FR-020)

- **Decision**: Print fields get descriptors (steps, hard bounds) in the print-preview model and use `checkTyped`; their
  inputs stay compact number fields. Covered by component tests only.
