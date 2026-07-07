# Contract: `workspace.*` JSON-RPC methods (UI ↔ daemon)

**Transport / owner / caller**: same as [ipc-projects](./ipc-projects.md). Types in
`@throng/ipc-contract/src/workspace.ts`. Scoped to the current `owner_user`.

The **layout document** is the per-project Tab/split/Panel tree defined in
[data-model.md](../data-model.md) §1. It is sent/stored whole (research D4/D5).

## Shapes

```ts
interface WorkspaceLayoutDto {
  projectId: string;
  schemaVersion: number;
  tabs: TabDto[];           // ordered, length >= 1
  activeTabId: string;
}
// TabDto.root is a SplitNodeDto | PanelRefDto (recursive); Panels are untyped this iteration.
interface SubWorkspaceDto {
  id: string;
  bounds: { x: number; y: number; width: number; height: number; displayId: string };
  tabs: TabDto[];           // may reference panels from multiple originProjectIds
}
```

| Method | Params | Result | Errors |
|--------|--------|--------|--------|
| `workspace.load` | `{ projectId }` | `{ layout: WorkspaceLayoutDto, restored: boolean }` | `-32004` project not found |
| `workspace.save` | `{ projectId, layout: WorkspaceLayoutDto }` | `{ ok: true }` | `-32602` invalid layout |
| `workspace.loadSubWorkspaces` | `{}` | `{ subWorkspaces: SubWorkspaceDto[] }` | — |
| `workspace.persistSubWorkspaces` | `{ subWorkspaces: SubWorkspaceDto[] }` | `{ ok: true }` | `-32602` invalid |

## Behaviour contract (verified by daemon integration tests)

1. `workspace.load` for a project with no saved layout (or an unparseable one) returns the **default
   empty workspace** (one Tab, one untyped placeholder Panel) with `restored: false`; a valid saved
   layout returns it with `restored: true` (FR-018/029).
2. `workspace.save` round-trips: a subsequent `workspace.load` returns an equivalent document
   (tabs, order, active tab, split tree, sizes preserved) — SC-004/SC-006.
3. The daemon **rejects** a `workspace.save` whose layout violates INV-4 (a main-workspace layout
   containing a Panel whose `originProjectId` ≠ `projectId`) with `-32602` — enforcing
   "main workspace never mixes projects" at the persistence boundary as defence-in-depth (the core
   already prevents producing such a layout).
4. `workspace.persistSubWorkspaces` / `loadSubWorkspaces` round-trip sub-workspace records including
   `bounds` (US4). Display validity is enforced at restore time by the UI main via `IDisplayInfo`,
   not by the daemon.
