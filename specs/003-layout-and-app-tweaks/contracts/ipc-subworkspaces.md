# Contract — `subworkspace.*` JSON-RPC + workspace schema v2

New daemon JSON-RPC methods over the existing named pipe, and the layout-schema bump carried by the
existing `workspace.*` methods. Shapes live in `@throng/ipc-contract`.

## Types

```
SubWorkspaceMeta { id: string; name: string; colour: string;
                   bounds: { x:number; y:number; width:number; height:number; displayId?:string } }
```

## Methods

### `subworkspace.list`
- Params: `{ ownerUser: string }`
- Result: `{ subWorkspaces: SubWorkspaceMeta[] }`
- Lists all persisted sub-workspaces for the user (for the sidebar list at startup — metadata only,
  windows opened lazily).

### `subworkspace.rename`
- Params: `{ id: string; name: string }` → Result: `{ ok: true }`
- `name` non-empty after trim.

### `subworkspace.recolour`
- Params: `{ id: string; colour: string }` → Result: `{ ok: true }`
- `colour` from the shared palette.

### `subworkspace.delete`
- Params: `{ id: string }` → Result: `{ ok: true }`
- Removes the sub-workspace and its persisted tabs/panels. Caller (UI) performs the relocation
  warning first; the daemon just deletes.

## workspace.* schema v2 (existing methods, extended payload)

- `workspace.load` result and `workspace.save` params carry the layout JSON at **schema v2**
  (each `Tab` includes `activePanelId`). The daemon/repository migrates v1→v2 on load (default
  `activePanelId` = first panel) and always saves v2.

## Notes

- Creation of a sub-workspace is **not** a dedicated RPC: detach produces a sub-workspace whose
  bounds/tabs are persisted via the existing sub-workspace persistence path (002) plus the new
  `name`/`colour` (auto-assigned). `subworkspace.*` covers the post-creation management surface.
- **Destroy Project guard**: the UI determines whether a project has panels in any sub-workspace by
  inspecting `subworkspace.list` + each sub-workspace's panels' `originProjectId`; if any match,
  Destroy Project is refused and the offending sub-workspaces/tabs are named (FR-025a). (No
  server-side enforcement needed; the daemon never deletes a project with the UI guard in place.)

**Contract tests**: round-trip rename/recolour/delete persist across reload; `list` returns
metadata only; `workspace.load` of a v1 document yields a valid v2 document with `activePanelId`
populated.
