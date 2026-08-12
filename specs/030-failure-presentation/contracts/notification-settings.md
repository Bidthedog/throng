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

`mode` ∈ `"never" | "timed" | "dismiss"`. `timeoutMs` ∈ [1500, 60000].

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

| Key | Control | Bounds |
|---|---|---|
| `notifications.error.mode` | `select` | never / timed / dismiss |
| `notifications.error.timeoutMs` | `slider`, step 750 | 1500–60000 |
| …the same pair for `warning`, `info`, `success` | | |

Two corrections made after meeting the real registry:

- **`select`, not `enum`.** Both exist in `ControlKind`, but every enumerated *setting* uses `select`;
  `form-controls.tsx` routes `enum` to a text fallback.
- **`slider`, not `number`, and the shipped defaults are off-grid.** `slider-descriptors.test.ts`
  fails any descriptor declaring both `min` and `max` with a control other than `slider`, and the step
  guard demands step ≥ 1% of range. Range 58500 → step ≥ 585; landing on both 5000 and 10000 from
  1500 needs a step dividing gcd(3500, 8500) = 500, which is below the floor. **This is arithmetically
  impossible, not a choice.** Step 750 is used: 1.28%, divides 58500 exactly so the maximum stays
  drag-reachable. Consequence to accept knowingly — dragging yields 1500, 2250, 3000…, and the shipped
  5000/10000 are reachable only by typing or by the row's reset. Every other slider in the registry has
  its default on-grid, so this is the first exception. The alternatives are worse: changing the
  defaults contradicts #224, widening `TIMEOUT_MIN_MS` breaks descriptor/clamp agreement, and relaxing
  the guard removes a check that is doing its job.

`NumberControl` renders both a range input and a typed field, so T020's "inert when the mode is not
*Display for*" must disable **both**.

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
