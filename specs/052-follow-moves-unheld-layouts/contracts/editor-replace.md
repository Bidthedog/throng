# Contract: Replace Onto an Open File (#111)

**Owner**: `packages/ui/src/main/editor-coordinator.ts`, the renderer editor mount (`use-editor.ts`), and
`MovedPathSync`. Research R7, data model *Coordinator document state*.

## Coordinator

- **`markMoved(moves)`**, for each moved document whose new path is claimed by another panel's document D:
  - D clean → dispose D (its recovery temp is removed). Record `links.set(D.panelId, mover.panelId)`. Relay
    `{ panelId: D.panelId, linkedTo: mover.panelId, reset: stateOf(mover) }` to every window.
  - D dirty → D becomes `replaced`: claim and watch released, buffer kept. Relay
    `{ panelId: D.panelId, replaced: true }`.
  - In both cases the mover registers the path. The registry ends with exactly one claim (FR-010).
- **Relay fan-out**: every relay naming an owner's panel id is also sent once per linked panel id, with that panel's
  id.
- **`dispatchChange`, `undo`, `redo`, `save`, `revert`** for a linked panel id resolve to the owner's document.
- **`destroy(owner)`** with links → the first linked panel becomes the owner. The document is re-keyed and relayed
  as `{ panelId: newOwner, linkedTo: null }`. Every other link is re-pointed to the new owner.
- **`destroy(linked)`** → only the link is removed.
- **`save`, replaced document, no target** → refusal: `{ ok: false, reason: 'replaced', error: 'This file was
  replaced. Use Save As to keep your changes.' }`. Save As saves normally and the document becomes ordinary.
- **`discardReplaced(panelId)`** → drop the buffer and the recovery temp, then link to the path's current owner (or
  load the path if it is unclaimed).
- **`markRestored`, and `markMoved` moving an owner away from a path that has links**:
  - Linked panels whose path is no longer the owner's unlink. Relay `{ panelId, linkedTo: null }`. The renderer then
    loads `filePath` itself.
  - A replaced document whose path is unclaimed again re-claims it, as `moveDetached` does on a return.

## Renderer

- Editor mount: `config.linkedTo` set and the owner open → attach as a view of the owner's document. Otherwise drop
  `linkedTo` from the config and load `filePath`.
- `MovedPathSync` writes `linkedTo` from the relay (set or cleared) into the panel config.
- **Replaced notice**: one inline notice on the panel, "`b.md` was replaced by a moved file. Your unsaved changes are
  kept here.", with **Save As…** and **Discard**. The notice is owned by the panel's document state, not by the move
  (one condition, one notice).
