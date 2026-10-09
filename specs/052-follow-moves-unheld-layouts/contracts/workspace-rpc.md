# Contract: Workspace RPC Additions

**Owner**: `packages/daemon/src/workspace-service.ts`, method constants in `packages/ipc-contract/src/workspace.ts`.
Research R2, R3, R8.

## `workspace.followMoves`

```ts
params: {
  moves: Array<{ from: string; to: string }>;
  held: { projectIds: string[]; subWorkspaceIds: string[] };
  /** R4 — restrict the walk to these records, regardless of `held` (a renderer's in-flight save). */
  only?: { projectIds?: string[]; subWorkspaceIds?: string[] };
}
result: { changedProjectIds: string[]; changedSubWorkspaceIds: string[]; skipped: number }
```

- Runs in one better-sqlite3 transaction. No other daemon request runs in between.
- **Projects**: for every project not in `held.projectIds`:
  - load its layout;
  - skip it if it did not restore;
  - rewrite its tabs with `moveLayoutTabs` (including R6's collision rule);
  - save it only if something changed.
- **Sub-workspaces**: every sub-workspace not in `held.subWorkspaceIds` is rewritten the same way. Only the changed
  rows are written, and positions are kept.
- **Project roots for 050 FR-035** come from the daemon's own project store, not the caller.
- **Failures**: a record that fails is skipped unchanged, counted in `skipped` and logged (FR-009). An empty `moves`
  writes nothing.
- **Idempotent**: the same call twice writes nothing the second time.

## `workspace.saveSubWorkspace`

```ts
params: { subWorkspace: SubWorkspace }   // the whole record, owner taken from the daemon
result: { ok: true }
```

- Upserts one row by id. An existing row keeps its `position`; a new row is appended last.
- Applies the same `migratePanelTitles` as `persistSubWorkspaces`.

## `workspace.deleteSubWorkspaces`

```ts
params: { ids: string[] }
result: { ok: true; deleted: string[] }
```

## Callers moved (R3)

| Caller | Was | Becomes |
|---|---|---|
| `SubWorkspaceWorkspaceClient.save` | load-all, replace own, persist-all | `saveSubWorkspace(own)` |
| `detach-context.tsx` detach | load-all, append, persist-all | `saveSubWorkspace(new)` |
| `detach-context.tsx` sync-to-existing | load-all, replace one, persist-all | `saveSubWorkspace(updated)` |
| `detach-context.tsx` purge-panel | load-all, strip, persist-all | `saveSubWorkspace` per survivor, `deleteSubWorkspaces(emptied)` |
| `preview-purge.ts` | load-all, strip, persist-all | the same pair |
| `moved-layout-walk.ts` | load/save per record | `followMoves` |
