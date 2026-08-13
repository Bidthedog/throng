# Contract: Notification settings

The user-facing configuration surface for #224. Consumed by Preferences (generically, from
`SETTINGS_METADATA`) and by `NotificationProvider`.

## Persisted shape

`settings.json` → `notifications`:

```json
{
  "notifications": {
    "error":   { "mode": "dismiss", "timeoutMs": 5000 },
    "warning": { "mode": "dismiss", "timeoutMs": 5000 },
    "info":    { "mode": "timed",   "timeoutMs": 10000 },
    "success": { "mode": "timed",   "timeoutMs": 5000 }
  }
}
```

`mode` ∈ `"never" | "timed" | "dismiss"`. `timeoutMs` ∈ [3000, 30000] — **any integer in that
closed range**, on or off the slider’s step grid.

## Parse contract

`parseNotificationSettings(raw: unknown): NotificationSettings` — total, never throws.

| Given | Returns |
|---|---|
| `undefined` / `null` / not an object | All four severities at their shipped defaults |
| `{ error: { mode: 'never' } }` | `error.mode = 'never'`, `error.timeoutMs` = default; other three default |
| `{ info: { mode: 'timed', timeoutMs: 900 } }` | `info.timeoutMs` = 10000 (out of range → default) |
| `{ info: { mode: 'sometimes' } }` | `info.mode` = `'timed'` (unrecognised → default) |
| `{ fatal: {...} }` | Ignored; the four known severities resolve normally |
| `{ error: 5 }` — a severity whose value is not an object | That severity's defaults; the rest honoured |
| `{ info: { timeoutMs: 10000.4 } }` | Rounded, matching `diagnosticsSettings`' existing `Math.round` |
| `{ info: { timeoutMs: Infinity } }` | Out of range → that severity's default |

The returned object is **fresh** — a caller mutating it cannot corrupt the shared defaults. (These
four rows were added after Phase 2: the original table was silent on all of them, and every one is
something a hand-edited `settings.json` produces.)

**Property to test**: for any JSON value whatsoever, `parseNotificationSettings` returns an object
with exactly four severities, each with a valid `mode` and a `timeoutMs` within bounds.

## Settings metadata

Eight descriptors under `group: 'Notifications'`:

| Key | Control | Options / bounds |
|---|---|---|
| `notifications.error.mode` | `select` | `never` / `timed` / `dismiss`, labelled **Never display** / **Display for** / **Dismiss only** |
| `notifications.error.timeoutMs` | `slider`, step 500 | 3000–30000 |
| …the same pair for `warning`, `info`, `success` | | |

Three corrections made after meeting the real registry:

- **`select`, not `enum`.** Both exist in `ControlKind`, but every enumerated *setting* uses `select`;
  `form-controls.tsx` routes `enum` to a text fallback.
- **The three modes need DECLARED labels.** `SelectControl` Title-Cases the stored token for any
  static enum, which renders the modes as "Never / Timed / Dismiss" — not the names FR-001 gives, and
  "Dismiss" reads as a verb. `FieldDescriptor.optionLabels` (added by this feature) carries the
  per-value display names; the stored values are unchanged. The descriptors take them from
  `DISPLAY_MODE_LABELS`, which lives beside `DISPLAY_MODES` so a fourth mode cannot be added without
  one. Whole set or nothing — a partial map renders a dropdown in two registers at once, and
  `settings-metadata.test.ts` fails any descriptor that supplies less than all of its values.
- **`slider`, not `number`, and the range is what makes the step legal.**
  `slider-descriptors.test.ts` fails any descriptor declaring both `min` and `max` with a control
  other than `slider`, and the step guard demands step ≥ 1% of range. Across 3000–30000 that floor is
  270, so **step 500** is legal; it divides 27000 exactly, so the maximum is drag-reachable; and both
  shipped defaults sit ON the grid — 3000 + 4×500 = 5000, 3000 + 14×500 = 10000 — so a user who has
  dragged the thumb can always drag back to what the app came with.

  This is the reason the bounds moved. Under the earlier 1500–60000 range the floor was 585, so 500
  was illegal and landing on both 5000 and 10000 from 1500 needed a step dividing
  gcd(3500, 8500) = 500: arithmetically impossible, and the range was documented as accepting that
  the shipped defaults were off-grid and reachable only by typing or by the row's reset. 3000–30000
  removes the exception rather than recording it.

**The step constrains the SLIDER, not the setting.** `NumberControl.parse` checks `min` and `max` and
nothing else, so the typed field beside the thumb accepts any integer in the closed range — 3567
commits, persists and reads back unrounded, and is replaced only when the user next drags. Both halves
render for one value, so T020's "inert when the mode is not *Display for*" must disable **both**.

`settings-metadata.test.ts` asserts one descriptor per configurable leaf — all eight are mandatory.

## Preferences behaviour

- The `timeoutMs` control is disabled whenever the sibling `mode` is not `timed` (FR-011).
- Committing a `timeoutMs` outside bounds is prevented by the control (FR-010).
- Selecting `never` for `error` or `warning` raises a confirmation naming the consequence (FR-008).
  `info`/`success` apply with no prompt.
- **Declining writes nothing** — it does not write the old value back. "Restores the previous mode"
  reads as an action and implementing it as one would be wrong: the control is React-controlled from
  `settings`, which has not changed, so declining restores it for free. An explicit restore-write
  would mean both buttons touch `settings.json`, which is a dialog that changes the setting whichever
  one you press.
- A disabled control needs a disabled **state**, not just a disabled input: the stale `-invalid`
  message beneath it is suppressed too, since a complaint about a box nobody can type into is wrong
  by construction.

## Runtime contract

`NotificationProvider` reads the settings through the existing renderer settings subscription. A
change applies to notices raised **after** it; live notices keep the behaviour they were raised with
(FR-016).

`AUTO_DISMISS_MS` is deleted. Its absence is the acceptance criterion (#224).
