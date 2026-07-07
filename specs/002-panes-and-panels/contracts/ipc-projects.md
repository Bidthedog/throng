# Contract: `projects.*` JSON-RPC methods (UI ↔ daemon)

**Transport**: newline-delimited JSON-RPC 2.0 over the Windows named pipe (same channel as
`health.ping`). **Owner**: daemon (single SQLite writer). **Caller**: UI main `daemon-client`,
invoked from the renderer via the preload bridge. Types live in `@throng/ipc-contract/src/projects.ts`.

All methods are scoped to the current `owner_user` (the daemon resolves it via `IUserContext`; the
client does not send it). Unknown methods return JSON-RPC error `-32601` (unchanged from 001).

## Shapes

```ts
interface ProjectDto {
  id: string; name: string; colour: string; rootFolder: string;
  isActive: boolean; createdAt: string; updatedAt: string;   // ISO-8601
}
```

| Method | Params | Result | Errors |
|--------|--------|--------|--------|
| `projects.list` | `{}` | `{ projects: ProjectDto[] }` | — |
| `projects.create` | `{ name, colour, rootFolder }` | `{ project: ProjectDto }` (created, becomes active if first) | `-32602` invalid params (empty name / bad colour) |
| `projects.update` | `{ id, name?, colour?, rootFolder? }` | `{ project: ProjectDto }` | `-32602` invalid; `-32004` not found |
| `projects.delete` | `{ id }` | `{ deletedId, newActiveId: string \| null }` | `-32004` not found |
| `projects.setActive` | `{ id }` | `{ activeId }` | `-32004` not found |

## Behaviour contract (verified by daemon integration tests)

1. `projects.create` with a valid name/colour/rootFolder persists a row and returns it; if it is the
   first project for the user it is returned with `isActive: true`.
2. `projects.list` returns only the calling user's projects, newest-or-stable order.
3. `projects.update` mutates only the provided fields and bumps `updatedAt`.
4. `projects.delete` removes the project **and cascades** its `workspace_layout`; if the deleted
   project was active, `newActiveId` names the next selected project, or `null` if none remain.
5. `projects.setActive` flips `is_active` so exactly one project is active per user.
6. Invalid params (empty `name`, malformed `colour`) → `-32602`; unknown `id` → `-32004`.
7. `health.ping` continues to work unchanged alongside these methods.
