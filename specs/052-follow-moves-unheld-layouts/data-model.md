# Data Model: Follow Moves Into Unheld Layouts

**Spec**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

There is no schema migration. The new fields are optional JSON members of the existing layout and sub-workspace
content, so an older build ignores them.

## Move pair (existing)

`MovePair { from: string; to: string }` — absolute paths. A folder pair covers every path beneath it, matched by
path segment and by identity rather than spelling (`movedPathOf`, 019 FR-005/FR-007).

## Held set (existing rule, new carrier)

`HeldRecords { projectIds: string[]; subWorkspaceIds: string[] }`, sent as arrays over RPC.
- **Rule**: the active project, plus each open sub-workspace window (research R4).
- **Validation**: unknown ids are ignored.

## Editor panel config — new optional member

| Field | Type | Rule |
|---|---|---|
| `linkedTo` | `string` (panel id) | Present only on a panel showing another panel's document (R7). The panel's `filePath` equals its owner's. |

- On restore, the owner is mounted → link again. The owner is absent → drop `linkedTo` and load `filePath`.
- `movedPanelConfig` rewrites `filePath` as for any editor. `linkedTo` is never rewritten, because panel ids do not
  move.

## Coordinator document state — new

| State | Meaning | Registry claim | Watch | Save |
|---|---|---|---|---|
| ordinary | today's document | its path | yes | normal |
| moved-out (050) | file left its project | none | no | Save As only |
| **replaced** | a Replace landed on its path while it was dirty | none | no | Save As only; a plain Save is refused with "This file was replaced. Use Save As to keep your changes." |

The coordinator also keeps `links: Map<linkedPanelId, ownerPanelId>`. Every relay for an owner's document is also
sent under each linked panel id.

**Transitions**:
- ordinary, dirty, and the path is taken by a Replace → **replaced**.
- ordinary, clean, and the path is taken by a Replace → disposed, and the panel is linked to the mover.
- **replaced**:
  - → Discard → linked to the path's current owner.
  - → its path is restored (undo) while unclaimed → ordinary, still dirty.
  - → Save As → ordinary at the new path.
- linked:
  - → the owner moves away from the path → unlinked. The panel loads its own `filePath` once that path exists again,
    or shows 041's could-not-read state.
  - → the owner closes → the panel becomes the owner.

## Daemon writes

| RPC | Effect | Atomicity |
|---|---|---|
| `workspace.followMoves` | rewrite every unheld record, changed records only | one transaction |
| `workspace.saveSubWorkspace` | upsert one record and keep its position (new → last) | one statement |
| `workspace.deleteSubWorkspaces` | delete the named records | one transaction |
