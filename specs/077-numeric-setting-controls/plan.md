# Implementation Plan: Consistent numeric setting controls

**Branch**: `feature/S073-S074-S075-file-previews` (unified branch; 077 has no branch of its own) | **Date**: 2026-11-20 |
**Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/077-numeric-setting-controls/spec.md`

## Summary

Every numeric setting gets one descriptor shape: a stored unit (bytes, ms, or its own count/length/px/% unit), a display
unit chosen from its range, slider bounds that a test proves sane, and hard bounds. One `NumberControl` draws the slider
in the display unit, the value with its unit, and — for sizes and durations — an exact-value box in the stored unit that
greys the slider when it holds an off-stop value, validates as typed and clamps on confirm. Released keys stored in
seconds, minutes, days, KB or MB move to ms or bytes through the shipped-defaults upgrade (version 36 → 37). Code that
re-clamps a setting is removed so the descriptor is the only bound, and every text quoting a setting value reads the
setting (constitution 7.3.0, Principle X).

## Technical Context

**Language/Version**: TypeScript 5.x (strict), Node 22, Electron, React 19
**Primary Dependencies**: `@throng/core` config layer (`settings-metadata.ts`, `metadata.ts`, `shipped-defaults.ts`,
`number-format.ts`); renderer preferences editor (`form-controls.tsx`, `settings-tab.tsx`)
**Storage**: `settings.json` under the config root (atomic writes, hot reload — unchanged)
**Testing**: vitest unit (descriptors, upgrade, unit maths), component (control behaviour), integration (upgrade on a
real config root); no E2E (no window-level behaviour changes)
**Target Platform**: Windows, Linux, macOS (no per-OS code)
**Project Type**: Electron desktop monorepo (`packages/core`, `packages/ui`, `packages/daemon`, `packages/persistence`)
**Performance Goals**: typed validation per keystroke within one frame (no async)
**Constraints**: no separator ever stored (constitution 4.5.0); slider maths in stored units, so no floating-point drift
reaches the file
**Scale/Scope**: 49 numeric Preferences settings, 10 preview-provider numeric settings, 3 print-dialog fields

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.* Constitution 7.2.1 on disk; 7.3.0
(Principle X: a reference to a setting uses its value) is being added alongside and is checked here as if adopted.

| Principle | Status | How |
|---|---|---|
| V Test-first | ✅ | Each FR has a unit or component test task before its code task; the migration carries an idempotent re-run test |
| VI Simple, discoverable UX | ✅ | One control for every numeric setting; units drawn, not hidden in labels; inline message beside the box |
| VIII SOLID/DRY | ✅ | One size-cap mechanism (FR-018); one bound per setting (FR-016); one unit-conversion module |
| IX DI & composition root | ✅ | No new services; upgrade runs where the shipped-defaults upgrade already runs |
| X Externalised configuration (incl. 7.3.0) | ✅ | Every bound is in the descriptor; every quoted value reads the setting; known 7.3.0 violations fixed (FR-014) |
| XII Responsive UI | ✅ | Validation is synchronous and local; no IPC per keystroke |
| XIII Every failure leaves a trace | ✅ | An out-of-bounds stored value is logged once with `logExpected` when it is clamped on read |
| Gate: configuration-editor completeness | ✅ | Hard bounds become editable from Preferences (today JSON-only, `form-controls.tsx:376`) |
| Gate: digit grouping (4.5.0/5.4.0) | ✅ | Box and messages through `formatGrouped`/`parseGrouped`; `drop.ts` refusal fixed |
| Gate: documentation currency | ✅ | `docs/preferences.md` updated in the same change (FR-019) |

No violations; Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/077-numeric-setting-controls/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── numeric-control.md
│   └── settings-upgrade-v37.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code (repository root)

```text
packages/core/src/config/
├── metadata.ts                 # NumericDescriptor: storedUnit, display, unitLabel, hardMin/hardMax
├── numeric-units.ts            # NEW — display-unit table, toDisplay/fromDisplay, stop maths, bound messages
├── settings-metadata.ts        # every numeric descriptor re-declared (ranges per research R6)
├── settings.ts / app-settings.ts  # renamed keys; second clamps removed (explorer popover, syncHighlight)
├── preview-settings.ts         # one size-cap mechanism (maxFileBytesSetting only)
└── shipped-defaults.ts         # SHIPPED_DEFAULTS_VERSION 37: renames + unit conversion
packages/ui/src/renderer/preferences/
└── form-controls.tsx           # NumberControl: display slider, unit, exact-value box, greyed state, inline message
packages/ui/src/renderer/preview/preview-notice.tsx   # too-large notice in the setting's display unit
packages/ui/src/renderer/resource-monitor/…           # interval menu from descriptor stops
packages/daemon/src/…notifications… / diagnostics rotation   # second clamps removed
packages/ui/src/renderer/print-preview/…              # print fields: bounds, typed validation, clamp (FR-020)
docs/preferences.md
```

**Structure Decision**: Existing packages only; one new core module, `numeric-units.ts`, holds every unit conversion
and bound message so the control, the notice and the docs test share one source.

## Complexity Tracking

None.

## Amendments (2026-11-21, convergence T036 — additive)

What shipped after this plan was written, and where it differs from the text above:

- **FR-024 — the Preferences toast replaces the inline message.** Constitution row VI's "inline message beside the
  box" and `form-controls.tsx`'s "inline message" in the source tree are superseded: what is wrong with a box's entry
  is said in the Preferences window's toast through `packages/ui/src/renderer/preferences/field-notice.ts`
  (`useFieldNotice`, one card per box), and the box keeps only its invalid outline and `aria-invalid`. The same toast
  serves the text boxes, list entries, the JSON list box, the key and record tables' add boxes and, since T030, the
  per-language indent table's number cells. FR-008's wording and bound-naming survive in the toast's sentence
  (`typedProblem` in `numeric-units.ts`).
- **FR-025 — list and table settings edit in a modal**, `packages/ui/src/renderer/preferences/list-editor.tsx`, over
  a draft (Save / Ctrl+Enter, Cancel / Escape).
- **FR-021–FR-023, FR-026, FR-027** — placement changes in `settings-metadata.ts` and `settings-tab.tsx`, and the
  project row and popover in the Projects pane; tasks T038–T044 trace each to its commit.
- **Shipped-defaults version.** 077's upgrade (renames and unit conversion, `contracts/settings-upgrade-v37.md`) is
  version 37, as the Summary and source tree say. `SHIPPED_DEFAULTS_VERSION` is **38** now: a later theme change
  (#105, `1b255c98`, selected code readable in every bundled theme) bumped it again. The 077 migration still runs at 37.
