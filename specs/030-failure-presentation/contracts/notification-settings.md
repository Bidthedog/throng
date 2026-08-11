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

**Property to test**: for any JSON value whatsoever, `parseNotificationSettings` returns an object
with exactly four severities, each with a valid `mode` and a `timeoutMs` within bounds.

## Settings metadata

Eight descriptors under `group: 'Notifications'`:

| Key | Control | Bounds |
|---|---|---|
| `notifications.error.mode` | enum | never / timed / dismiss |
| `notifications.error.timeoutMs` | number | 1500–60000 |
| …the same pair for `warning`, `info`, `success` | | |

`settings-metadata.test.ts` asserts one descriptor per configurable leaf — all eight are mandatory.

## Preferences behaviour

- The `timeoutMs` control is disabled whenever the sibling `mode` is not `timed` (FR-011).
- Committing a `timeoutMs` outside bounds is prevented by the control (FR-010).
- Selecting `never` for `error` or `warning` raises a confirmation naming the consequence; declining
  restores the previous mode (FR-008). `info`/`success` apply with no prompt.

## Runtime contract

`NotificationProvider` reads the settings through the existing renderer settings subscription. A
change applies to notices raised **after** it; live notices keep the behaviour they were raised with
(FR-016).

`AUTO_DISMISS_MS` is deleted. Its absence is the acceptance criterion (#224).
