# Quickstart / Validation Guide: Shipped Defaults

This feature ships **no UI**. Validation is by the automated test layers plus a manual config-directory
inspection. Prerequisites: Node >= 20, `npm ci` at repo root.

## Run the automated suites

```bash
npm run test:unit          # pure core: record fidelity, reserved names, reset/fill/upgrade plans
npm run test:integration   # ShippedDefaultsService against a real FileConfigStore (temp configRoot)
npm run test:contract      # record-vs-definitions fidelity contract
npm run test:e2e           # unchanged; this feature adds no UI and no new E2E
```

Expected: all green. The integration layer runs serially (OS-heavy config).

## What the tests prove (maps to spec)

| Scenario | Layer | Spec |
|----------|-------|------|
| Record deep-equals the live definitions (throng carries `iconPack:'throng'`) | unit/contract | FR-004, SC-007 |
| `reservedThemeNames` = all built-ins incl. a deleted one | unit | FR-006/007/007a |
| restore-all leaves a custom theme byte-identical | integration | FR-008, SC-002 |
| restore-all recreates a deleted built-in | integration | FR-008, SC-001/003 |
| restore-all resets an edited built-in to shipped values | integration | FR-008, SC-001 |
| whole-operation rollback when one theme path is locked/unwritable | integration | FR-012/012a, SC-005/013 |
| reset one binding changes only that action | unit+integration | FR-009, SC-004 |
| reset one setting (dotted path) changes only that leaf; unknown path ⇒ no-default | unit+integration | FR-010/011/016, SC-004 |
| first-run seed equals shipped artifacts + writes version marker | integration | FR-015, SC-011 |
| upgrade adds a newly-shipped theme without touching existing values | integration | FR-015a, SC-012 |
| upgrade materialises a new property into a built-in AND a custom theme | integration | FR-015a, SC-012 |
| upgrade is idempotent (2nd run changes nothing) | integration | FR-015a, SC-012 |

## Manual validation (`npm start`)

The config root is `%USERPROFILE%\.throng` (override with `THRONG_CONFIG_ROOT`). Use a throwaway root
to avoid touching your real config:

```powershell
$env:THRONG_CONFIG_ROOT = "$env:TEMP\throng-manual"
```

1. **First-run seeding** — delete/rename the config root, run `npm start`, then inspect the root:
   `settings.json`, `keybindings.json`, `themes\` with one file per built-in (throng + 14), and
   `defaults-state.json` = `{ "version": 1 }`. Expect them to match the shipped defaults.
2. **Hand-edit survives restart (upgrade never overwrites)** — edit a built-in, e.g. set
   `themes\Matrix.json` `colours.accent` to `#ff00ff`; restart. Expect the edit to **survive** (upgrade
   is additive only; it does not reset your value).
3. **Deleted built-in is NOT silently recreated** — delete `themes\Snake.json`; restart. Expect it to
   **stay deleted** (only an explicit Restore-All recreates it; startup upgrade only adds themes when
   the shipped *version* advanced, and re-adding a still-current deleted theme is not part of it).
   Note: whether a routine restart re-adds a deleted built-in depends on the version marker — with an
   unchanged version it is not re-added; this is the behaviour that distinguishes upgrade from
   Restore-All. (Restore-All is exercised by the `014-theme-editor` control, not in this feature.)
4. **New-property materialisation** — simulate an upgrade by bumping `SHIPPED_DEFAULTS_VERSION` locally
   and adding a colour token to a theme definition, then restart with an existing config: expect the
   new token written into existing `themes\*.json` (built-ins from their shipped value, customs from
   the throng base) while every pre-existing value is unchanged, and `defaults-state.json` version
   bumped. (This is what feature `009`'s two new gutter tokens will do in production.)
5. **Version marker** — confirm `defaults-state.json` exists and its `version` equals the current
   `SHIPPED_DEFAULTS_VERSION`.

Reset the override when done: `Remove-Item Env:\THRONG_CONFIG_ROOT`.
