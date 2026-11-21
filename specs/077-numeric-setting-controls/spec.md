# Feature Specification: Consistent numeric setting controls

**Feature Branch**: `feature/S073-S074-S075-file-previews` (worked on the unified 073/074/075 branch; no branch of its own)
**Created**: 2026-11-20
**Status**: Draft
**Input**: The maintainer, 2026-11-20 (verbatim):

1. "Any reference to a setting should use the setting value, rather than a estimate / default. This should be a
   constitution rule." — constitution v7.3.0, Principle X (being added alongside this spec, with its known violations
   listed there).
2. "We need to consolidate the "size" or "length" settings in preferences so they have sensible steps, min and max
   values. It's a little inconsistent across all preferences at the moment."
3. Sizes: "Keep bytes in setting files (for maximum flexibility), but show MB in appropriate increments depending on
   the range of the slider. Every value that makes sense should have an accompanying text box with comma-separated
   bytes shown in it so users can override the byte setting manually if they want to. When this happens, the slider
   should grey out to indicate it has been overridden, but it can still be moved. Bounds are validated manually."
4. Durations: "Everything stored in ms, but as per the size units, every setting should show a slider with the
   appropriate unit of measure and steps depending on the range and type of value. Every sensible setting should have
   the text box override and when overridden, grey out the slider in the same way."
5. Hard bounds: "Hard bounds are validated as typed and the user is informed when they are invalid. If an invalid max
   value is exceeded, the max value is the clamped value, and vice verse."

Input audit: a read-only inventory of every numeric setting (2026-11-20, trees `fbd2d2a2` / `03657a27`): file-size
caps stored in three units (bytes, KB, MB) under two descriptor mechanisms; durations stored in ms, seconds and
minutes; ranges whose default is not a slider stop or whose maximum cannot be reached; clamps in code that disagree
with the descriptor (#227 class); a number control that refuses values outside the slider range, leaving hard bounds
JSON-only; no unit drawn beside any value; text quoting defaults or copies of tables instead of the setting.

## Clarifications

### Session 2026-11-20

- Q: Does 077 cover the print dialog's numeric fields (075: margins, scale, copies)? → A: Bounds only, for now
  (maintainer, 2026-11-20: "Bounds for now, I will review once all the changes are merged"). The print fields get
  declared steps and hard bounds, validated as typed and clamped on confirm (FR-008, FR-009); they keep their own
  inputs, with no slider or override box. → FR-020.

**Resolved at implementation (2026-11-20)** — the maintainer asked to work unattended (12:17), so each was answered by
its default, revised where the code showed the first default was wrong; the orchestrator recorded them, and the
maintainer may still overrule any:

- Q: Is `diagnostics.keepDays` stored in ms like every other duration? → A: **No.** It counts the days throng ran
  (066 FR-019), not a span of time, so it stays a count of days and keeps its key (FR-001). *(First default was yes.)*
- Q: Do counts, lengths, pixels and percentages get the exact-value box? → A: **Yes.** Every numeric setting already
  had the box beside its slider; taking it from some would remove a way in users have (FR-006). *(First default was
  no.)*
- Q: Is the per-range step table in FR-005 right? → A: As written in FR-005, with ms shown up to a 2 s maximum, so
  0–2,000 ms debounces read in ms.
- Q: What happens to a stored value outside the hard bounds (hand-edited JSON)? → A: What 031 / #227 already does:
  the bounds guard brings it to the nearer hard bound when the file is read and writes the correction back (Edge
  Cases). *(First default left the file alone.)*
- Q: What does confirming text that is not a number do? → A: It stores nothing, and the entry stays in the box with
  its message until corrected; Escape restores the stored value (FR-009). An entry is never discarded (040 FR-007,
  018 FR-017), which the first wording of FR-009 would have broken.

### Session 2026-11-21

- Q (maintainer, 08:12): "Move the 'Attention -> Clear Delay' preferences setting under the 'Notifications'
  preferences header." → FR-021. The key is unchanged; the setting keeps its Attention subsection, now under
  Notifications beside the Attention row that announces a mark. The taskbar badge stays under General › Attention.
- Q (maintainer, 08:14): "Move 'Kill Processes' to under 'Resource Monitor'." → FR-022. The key keeps its
  `confirmations.` namespace; only the Preferences group changes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Set a size in MB, or exactly in bytes (Priority: P1)

A user opens **Preferences** and finds every size setting (the editor's maximum file size, each preview's maximum file
size, the diagnostics log limits) drawn the same way: a slider in MB whose steps suit its range, the value beside it in
MB, and a box holding the exact byte count, digit-grouped. Dragging the slider sets a whole step; typing in the box sets
any byte count within the setting's hard bounds. A typed value the slider cannot show greys the slider — it still moves,
and moving it replaces the typed value with that step.

**Why this priority**: The maintainer's first named problem; the size settings are where the three stored units and two
mechanisms live.

**Independent Test**: Open Preferences → Editor; set **Maximum file size** by slider, then type `12,345,678` in its box;
read `settings.json`.

**Acceptance Scenarios**:

1. **Given** Preferences is open, **When** the user looks at any size setting, **Then** it shows a slider in MB, the
   value in MB beside it, and a box with the stored byte count digit-grouped (`10,485,760`).
2. **Given** a size slider, **When** the user drags it, **Then** it moves in that setting's step (e.g. 1 MB below 32 MB,
   5 MB to 250 MB), the box shows the step's byte count, the slider is not greyed, and `settings.json` holds bytes.
3. **Given** a size setting, **When** the user types `12,345,678` in its box and confirms (Enter or leaving the box),
   **Then** `settings.json` holds `12345678`, the value beside the slider reads `11.8 MB`, and the slider is greyed
   but still enabled.
4. **Given** a greyed slider, **When** the user drags it, **Then** the box takes the step's byte count and the slider is
   no longer greyed.
5. **Given** any notice, description or label that names a size limit, **When** it is shown, **Then** it quotes the
   setting's current value in the unit the setting is shown in (the editor or a preview's limit in MB with its bytes,
   never a shipped default).

---

### User Story 2 - Set a duration in its own unit, or exactly in ms (Priority: P1)

Every duration setting (hover delays, debounces, animation lengths, polling intervals, timeouts, the attention quiet
period, the resource monitor's capture interval and history) is stored in milliseconds and drawn as a slider in the unit
that suits its range — ms for sub-second values, seconds for longer ones, minutes for the longest — with a box holding the
exact ms value, overriding as sizes do.

**Why this priority**: The maintainer's second named problem; durations are stored in four units today.

**Independent Test**: Open Preferences; set **Attention: quiet period** by slider and by typing `45,500` in its box;
read `settings.json`.

**Acceptance Scenarios**:

1. **Given** a duration under two seconds at its maximum, **When** shown, **Then** its slider and value are in ms.
2. **Given** a duration whose maximum is minutes, **When** shown, **Then** its slider and value are in seconds or
   minutes and its box holds ms (`45,500`).
3. **Given** a typed ms value that is not a slider stop, **When** confirmed, **Then** the slider greys exactly as a size
   slider does.

---

### User Story 3 - A bad value is named as it is typed, then clamped (Priority: P1)

Typing into any numeric box is checked keystroke by keystroke against the setting's hard bounds. A value outside them
shows an inline message naming the bound ("Up to 262,144,000 bytes"), and confirming it stores the nearer bound instead —
the maximum for a value above it, the minimum for one below it. Text that is not a number is never stored.

**Why this priority**: The maintainer's stated bounds rule; without it the override box can store nonsense.

**Independent Test**: Type `999,999,999,999` into a size box and press Enter; read the message and `settings.json`.

**Acceptance Scenarios**:

1. **Given** a numeric box, **When** the typed value exceeds the hard maximum, **Then** an inline message says so,
   naming the maximum, while the user is still typing.
2. **Given** that state, **When** the user confirms, **Then** the stored value is the hard maximum and the message clears.
3. **Given** a value below the hard minimum, **When** confirmed, **Then** the hard minimum is stored.
4. **Given** text that is not a whole number in the box's unit (letters, a second decimal point), **When** typed,
   **Then** the message says it is not a number; confirming stores nothing and keeps the entry and its message
   (never discarded, 040 FR-007) until it is corrected, and Escape restores the last stored value.

---

### User Story 4 - Every numeric setting has sensible steps and bounds (Priority: P2)

Every numeric setting — sizes, durations, counts, lengths, pixel widths, percentages — has a slider whose shipped
default lies on a stop, whose maximum can be reached, whose step suits the range, and whose unit is drawn beside the
value. Its label no longer carries the unit in brackets.

**Independent Test**: The slider-descriptor test passes for every numeric setting; a reviewer reads the Preferences
window from top to bottom.

**Acceptance Scenarios**:

1. **Given** any numeric setting, **When** its slider is at the shipped default, **Then** the value is a stop.
2. **Given** any numeric setting, **When** dragged to the right end, **Then** the stored value is its slider maximum.
3. **Given** any numeric setting, **When** shown, **Then** its unit (`ms`, `s`, `MB`, `px`, `%`, `characters`, `items`)
   is drawn beside the value and not repeated in the label.

---

### User Story 5 - What the app does matches what Preferences says (Priority: P2)

A value accepted in Preferences is the value the app uses: no second clamp in code narrows or replaces it, and no
surface (a toolbar list, a description, a notice) offers or quotes a different set of values.

**Independent Test**: Set **Explorer: popover delay** to its maximum and hover a file; set the resource monitor's
capture interval to 7 s and open the monitor's interval menu.

**Acceptance Scenarios**:

1. **Given** a value within a setting's hard bounds, **When** the app reads it, **Then** it uses that value unchanged.
2. **Given** the resource monitor's capture interval set to a value, **When** its toolbar offers intervals, **Then** it
   offers the same steps the Preferences slider does and shows the current value checked.

---

### User Story 6 - Settings stored in older units keep their meaning (Priority: P1)

A user whose `settings.json` holds a duration in seconds or minutes, or a log limit in KB or MB, finds the same
effective value after upgrading, now stored in ms or bytes.

**Independent Test**: Start the app on a config root holding `terminals.attention.quietSeconds: 30` and
`diagnostics.maxFileSizeKb: 2048`; read `settings.json` and the Preferences rows.

**Acceptance Scenarios**:

1. **Given** an older settings file, **When** the app starts, **Then** each renamed key holds the same value in the new
   unit (30 s → 30,000 ms; 2,048 KB → 2,097,152 bytes) and the old key is gone.
2. **Given** an already-upgraded file, **When** the app starts again, **Then** nothing changes.

---

### Edge Cases

- A stored value outside the hard bounds (hand-edited JSON): read as the nearer bound and written back, as the
  bounds guard already does for every declared bound (031, #227).
- A stored value between the slider maximum and the hard maximum: valid; the slider is greyed at its right end.
- A range that crosses a unit boundary (e.g. 0–10 s): the slider uses one unit for its whole range — the unit of
  its maximum — so steps stay even.
- Locale grouping: the box parses the active locale's grouping (constitution 4.5.0); a separator never reaches the file.
- A size box receiving a fraction of a byte, or a duration box a fraction of a ms: refused as not a whole number.
- Reset to default: restores the stored default, un-greys the slider, clears any message.

## Requirements *(mandatory)*

### Functional Requirements

**Stored units**

- **FR-001**: Every size setting MUST be stored in bytes; every duration setting in milliseconds. Shipped keys and
  their unit:
  - Sizes: `editor.maxOpenFileBytes`, `editor.previews.providers.{image,svg,pdf,html}.maxFileBytes`,
    `editor.previews.providers.spreadsheet.maxPreviewBytes` (replacing `maxPreviewMb`),
    `diagnostics.maxFileBytes` (replacing `maxFileSizeKb`), `diagnostics.maxTotalBytes` (replacing `maxTotalMb`).
  - Durations: every `*Ms` key, plus `terminals.attention.quietMs` (replacing `quietSeconds`),
    `resourceMonitor.captureIntervalMs` (replacing `captureIntervalSeconds`), `resourceMonitor.historyMs` (replacing
    `historyMinutes`) and `editor.previews.syncHighlightMs` (replacing `syncHighlightSeconds`). `diagnostics.keepDays`
    counts days throng ran and stays a count (Clarifications).
- **FR-002**: A key released in a shipped version and renamed by FR-001 MUST be migrated on start-up by the shipped
  settings upgrade (the shipped-defaults version gate): the old value converted exactly, the old key removed, and a
  second run a no-op. Keys not yet released (073, 074 and 075's) change without a migration.
- **FR-003**: "MB" MUST mean 1,048,576 bytes everywhere it is shown, and Preferences MUST say so once
  (the Preferences documentation and the size rows' description).

**The control**

- **FR-004**: Every numeric setting MUST be drawn by the one numeric control: a slider in the setting's **display unit**,
  the value in that unit beside it with the unit drawn, and — where FR-006 gives it one — a box holding the stored value
  in the stored unit, digit-grouped.
- **FR-005**: The display unit and step MUST be declared per setting, and chosen from its range: sizes in MB (steps of
  1 MB up to 32 MB, 5 MB up to 250 MB, 50 MB beyond — a setting uses one step across its slider); durations in ms when
  the slider maximum is 2 s or less (steps of 10, 25, 50 or 100 ms), in s up to 10 minutes (steps of 0.5, 1, 5 or 10 s),
  in minutes beyond (steps of 1 minute). Counts, lengths, pixels and percentages keep their own unit.
- **FR-006**: Every numeric setting MUST have the override box (Clarifications: the box stays on counts, lengths, pixels
  and percentages too).
- **FR-007**: A stored value that is not a slider stop (typed in the box, or found in the file) MUST grey the slider
  (drawn as overridden, still operable); moving the slider stores that stop and un-greys it.
- **FR-008**: The box MUST validate as the user types against the setting's **hard bounds** and say inline, beside the
  box, what is wrong — "Up to 262,144,000 bytes", "At least 1,024 bytes", "Not a whole number" — naming the bound in the
  box's unit, digit-grouped.
- **FR-009**: Confirming a value (Enter, or leaving the box) MUST store it when within the hard bounds; above the hard
  maximum it MUST store the hard maximum, below the hard minimum the hard minimum; text that is not a number MUST store
  nothing and stay in the box with its message until corrected (an entry is never discarded — 040 FR-007, 018
  FR-017, which this does not supersede). Escape MUST restore the last stored value. An emptied box is named only when
  confirmed.
- **FR-010**: Every numeric setting MUST declare hard bounds. Where none is stated, the hard bounds are the slider's
  minimum and maximum. A value between the slider maximum and the hard maximum is valid (FR-007 greys the slider).

**Ranges and steps**

- **FR-011**: Every numeric setting's shipped default MUST be a slider stop, and its slider maximum MUST be reachable
  (maximum − minimum a whole number of steps). The slider-descriptor test MUST enforce both for every setting.
- **FR-012**: The ranges in the audit's table MUST be adopted; in particular: hover dwells 0–1,500 ms in 25 ms steps;
  debounces 0–2,000 ms in 25 ms; the Markdown heading jump 0–1,500 ms in 50 ms; the CSV long-cell threshold 0–1,000
  characters in 10s; per-language indent columns in steps of 1; every file-size cap with a hard minimum of 1 KB and a
  hard maximum of 2 GB (2,147,483,648 bytes).
- **FR-013**: A setting's unit MUST be drawn by the control, not carried in its label ("Popup delay", not "Popup delay
  (ms)").

**One meaning per value (constitution v7.3.0 Principle X)**

- **FR-014**: Every surface that names a setting's value — a notice, a description, a menu, a toolbar list, a tooltip,
  the docs — MUST quote the setting's current value, never a shipped default, an estimate or a copied table. Known
  violations to fix: the too-large notice; the capture-interval description that copies the band table; the "5 MB
  steps" text; the drop refusal's ungrouped digits.
- **FR-015**: The too-large notice MUST name the file's size and the limit in the unit the limit is shown in Preferences
  (MB with its bytes), digit-grouped — one wording for every provider.
- **FR-016**: A value within a setting's hard bounds MUST reach the code that uses it unchanged: no second clamp, floor
  or fallback that disagrees with the descriptor (the explorer popover delay, the scroll-sync highlight parse, the
  notifications integer bound, diagnostics rotation, the capture-interval resolver). Bounds live in the descriptor only.
- **FR-017**: The resource monitor's interval menu MUST offer the same values as its Preferences slider and mark the
  current value, whatever it is.
- **FR-018**: One provider size-cap mechanism MUST serve every preview provider: the provider names the bytes setting
  that caps it; the separate MB mechanism is removed.

**Print dialog (075)**

- **FR-020**: The print dialog's numeric fields (margins, scale, copies) MUST declare steps and hard bounds, validate as
  typed with the FR-008 message and clamp on confirm per FR-009. They keep their own inputs: no slider, no override box.
  "As typed" keeps 075 FR-066's timing: the check runs once typing pauses (or the field is left), and a pause never
  clamps; leaving the field or Enter confirms. ArrowUp and ArrowDown move by the declared step (margins 1 mm, scale 5%,
  copies 1), within the bounds.

**Placement**

- **FR-021**: *(2026-11-21.)* **Clear delay** (`attention.clearDelayMs`) MUST sit in Preferences under
  **Notifications › Attention**, and `docs/preferences.md` MUST document it in the Notifications section. Its key,
  default, bounds and control are unchanged. *(Supersedes 057 FR-108's and round 4's "taskbar badge and clear delay
  stay under Attention" and 069 FR-068's General › Attention for the clear delay alone; the taskbar badge stays
  under General › Attention.)*
- **FR-022**: *(2026-11-21.)* **Kill processes** (`confirmations.killProcesses`) MUST sit in Preferences in the
  **Resource Monitor** group, and `docs/preferences.md` MUST document it in the Resource Monitor section. Its key,
  values and default are unchanged. *(Supersedes 055 FR-063b's "in Preferences' Confirmations group".)*

**Documentation**

- **FR-019**: `docs/preferences.md` MUST give every numeric setting's stored unit, display unit, range, step and hard
  bounds, and quote sizes in MB with their bytes.

### Key Entities

- **Numeric setting descriptor**: stored unit (bytes, ms, count, characters, px, %), display unit and scale, slider
  minimum, maximum and step, hard minimum and maximum, and what a count counts.
- **Display unit**: a unit and its factor from the stored unit (MB = 1,048,576 bytes; s = 1,000 ms; minute = 60,000 ms).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of numeric settings pass the slider-descriptor test: default on a stop, maximum reachable, unit
  declared, hard bounds declared.
- **SC-002**: Zero size settings stored in a unit other than bytes and zero durations stored in a unit other than ms.
- **SC-003**: Any byte or ms value within hard bounds can be set from Preferences without editing JSON.
- **SC-004**: Zero code paths clamp a setting to a bound different from its descriptor's.
- **SC-005**: Every text that names a setting's value shows the current value — checked by a test per known surface.
- **SC-006**: An upgraded settings file keeps every effective value exactly (each migrated key round-trips).

## Assumptions

- *(Derived)* Counts, lengths, pixels and percentages keep their stored unit; the maintainer named sizes and durations.
- *(Derived)* MB means MiB (1,048,576), as the code already computes it; the label stays "MB".
- *(Derived)* The audit's ranges are adopted unless clarification changes them.
- 075's print settings: bounds only (FR-020), per the 2026-11-20 clarification; the maintainer reviews them after the merges.
- Constitution v7.3.0 (Principle X: a reference to a setting uses its value) lands before this spec's plan.
