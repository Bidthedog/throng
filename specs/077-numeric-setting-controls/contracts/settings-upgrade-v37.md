# Contract: settings upgrade, shipped-defaults version 37

Runs once when the config root's recorded shipped-defaults version is below 37 (the existing gate in
`shipped-defaults.ts`, `planSettingsUpgrade` / `applySettingsUpgrade`).

For each row of the renamed-keys table in [data-model.md](../data-model.md#renamed-keys-fr-001-fr-002) marked
"migrated":

| Old key present | New key present | Result |
|---|---|---|
| yes | no | new key = old × factor (exact integer); old key removed |
| yes | yes | old key removed; new key kept |
| no | — | nothing |

- A non-numeric old value is replaced by the shipped value for the new key.
- Re-running the upgrade on its own output changes nothing (idempotent re-run assertion,
  `packages/core/tests/unit/settings-upgrade-v37.test.ts`).
- The converted value is not clamped by the upgrade; R5's read-side clamp applies.
