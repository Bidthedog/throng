# Contract: Layout Schema v3 + Idempotent Migration

Adds per-type zoom to the per-project layout JSON blob. **No SQLite DDL; `user_version` unchanged.**

## Change

- `WorkspaceLayout.zoom?: { terminal: number; editor: number }` (absent in v2 docs).
- `LAYOUT_SCHEMA_VERSION`: `2 → 3` (`packages/core/src/workspace/model.ts`).

## Migration (`packages/persistence/src/workspace-repository.ts` `migrateLayout`)

```
migrateLayout(doc):
  ... existing v1->v2 (default activePanelId) ...
  if doc.schemaVersion < 3:
      doc.zoom = doc.zoom ?? { terminal: 0, editor: 0 }
      doc.schemaVersion = 3
  return doc
```

## Behavioural assertions (integration — `workspace-layout-v3.integration.test.ts`)

1. **Forward-migrate**: a stored v2 layout (no `zoom`) loads as v3 with `zoom = {terminal:0, editor:0}` and
   `schemaVersion === 3`.
2. **Round-trip**: save a v3 layout with `zoom = {terminal:2, editor:-1}`; reload returns the same values.
3. **Idempotent (v3.5.0)**: running `migrateLayout` on an already-v3 doc is a **no-op** — `zoom` and
   `schemaVersion` are preserved, values not reset or doubled. Re-running twice equals once.
4. **No SQL change**: SQLite `user_version` is unchanged by this feature (asserted alongside existing
   persistence tests).
5. **Clamp on load**: an out-of-range hand-edited `zoom` (e.g. `{terminal: 99}`) is clamped into
   `[ZOOM_MIN_LEVEL, ZOOM_MAX_LEVEL]` before use.
