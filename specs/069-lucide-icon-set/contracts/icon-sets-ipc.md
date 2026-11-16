# Contract: icon sets IPC (main ↔ preferences and main windows)

Channels are registered in main and bridged in `preload.cts`, with types in `renderer/global.d.ts`.
Every path is resolved in main from a set **name** that is in the current listing. The renderer never
sends a path.

| Channel | Direction | Request | Response | Errors |
|---|---|---|---|---|
| `throng:iconSets:create` | invoke | `{ name: string, from: 'throng' \| string }` | `{ ok: true }`, then a config broadcast carrying the new set | `{ ok: false, reason: 'invalid-name' \| 'exists' \| 'source-unavailable' \| 'io', message }` |
| `throng:iconSets:override` | invoke | `{ set: string, key: IconKey, replace: boolean }` | `{ ok: true }`, then a broadcast | `{ ok: false, reason: 'exists' }` when the file exists and `replace` is false (the renderer asks, then calls again with `replace: true`); `'unknown-set' \| 'unknown-key' \| 'io'` |
| `throng:iconSets:reload` | invoke | `{}` (any set is ignored) | `{ ok: true }`, then a broadcast | none; a load failure is not an error: it arrives as the set's `error` or `failures` (data-model) |
| `throng:iconSets:rename` | invoke | `{ from: string, to: string }` | `{ ok: true }`, then a broadcast | `'unknown-set' \| 'invalid-name' \| 'exists' \| 'io'` |
| `throng:iconSets:remove` | invoke | `{ set: string }` | `{ ok: true }`, then a broadcast | `'unknown-set' \| 'io'` |
| `throng:iconSets:resetIcon` | invoke | `{ set: string, key: IconKey }` | `{ ok: true }`, then a broadcast | `'unknown-set' \| 'unknown-key' \| 'io'` |
| `throng:iconSets:openFolder` | invoke | `{ set?: string }`. Absent means the sets directory itself | `{ ok: true }`, then a broadcast | `'unknown-set' \| 'io'` |
| `throng:iconSets:backupsPresent` | main → window, held until `…:backupsReady` | `{ count: number }` | none | none |
| `throng:iconSets:backupsReady` | window → main | none | none | none |

Rules:

- `create` validates with `validateIconSetName` (FR-025) against the listing, ignoring case. Copying
  from the default set creates an empty folder. Copying from a user set copies only its `<IconKey>.svg`
  files (FR-024).
- `override` writes `DEFAULT_ICON_SET[key]` to `<set>/<key>.svg` (FR-032), with LF line endings and
  UTF-8. With `replace: false` it never overwrites (FR-033).
- `create` and `override` are refused for `throng` (`'unknown-set'`), because the default set is never a
  folder (FR-021).
- Every handler reads the sets from disk before and after its action, and broadcasts the result
  whether or not the action succeeded (FR-041). A refusal for an unknown set is decided against the
  fresh listing, so a set made outside throng is found.
- `rename` validates `to` like `create`, leaving the set's own name out of the listing, so a change of
  case alone is allowed; on success every theme naming `from` names `to` (FR-042). `remove` moves the
  folder to the OS trash and returns every theme naming it to the default set (FR-043). `resetIcon`
  moves `<set>/<key>.svg` to the OS trash (FR-044).
- `openFolder` first lets the floating windows drop below the file manager (FR-045).
- Every failure is logged in main (`logExpected` for validation, `logCaught` for I/O). Principle XIII.
- The config payload's `iconSets` (data-model *IconSetPayload*) is the only way set contents reach a
  window.
