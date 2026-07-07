# Contract: Editor preload bridge (`editor.*`) — Phases A/B/E

A new **preload bridge** in `packages/ui/src/preload/preload.cts`, a **peer of `files.*`** (NOT daemon
RPC — the editor is UI-main-owned, research D2). Renderer → `ipcRenderer` → UI-main `editor-ipc.ts` →
`editor-service`/`editor-coordinator`. The sandboxed renderer never touches `fs`.

## Methods (invoke → UI main)

```ts
editor.load(req: { panelId; absPath; ownerProjectId?; ownerKind })
  : Promise<{ text; encoding; hasBom; lineEnding; relativeFolder } | { error }>;      // read + detect (D5)
editor.save(req: { panelId; absPath?; text })                                          // absPath omitted → use recorded path
  : Promise<{ ok: true; absPath; encoding; lineEnding } | { ok: false; reason: 'out-of-tree'|'no-location'|'locked'|'io' }>;
editor.saveAll(req: { scope: 'tab'|'project'|'all'; panelIds })                         // FR-023 skip+report
  : Promise<{ saved: string[]; skippedUnpathed: string[]; failed: { panelId; reason }[] }>;
editor.openInto(req: { absPath })                                                       // FR-011a app-wide one-buffer
  : Promise<{ action: 'focus'; panelId; windowId } | { action: 'open'; ownable: boolean }>;
editor.isOpen(absPath): Promise<boolean>;                                               // for disabling Open-In targets
editor.notifyDirty(req: { panelId; dirty; text }): void;                                // renderer → UI main (lock + recovery + indicators + mirror)
editor.list(): Promise<Array<{ panelId; absPath?; dirty; ownerKind }>>;                 // open documents (indicators/menus)
editor.recover(): Promise<Array<{ panelId; text; absPath? }>>;                          // launch-time restore (FR-042)
```

## Push (UI main → renderer)

```ts
editor.onSync(cb: (msg: { panelId; text?; dirty? }) => void): () => void;               // FR-034 mirror (content + dirty)
editor.notifySync(msg: { panelId; text?; dirty? }): void;                               // renderer → UI main relay (fan out to other windows)
```

## Obligations
- `editor.save` **enforces confinement** in UI main (project tree, or outside-all-projects for
  sub-workspace-owned) and **refuses** an out-of-tree target (`reason:'out-of-tree'`); it never writes
  outside the allowed location (SC-003). A new/unpathed save with no chosen location returns
  `reason:'no-location'`.
- `editor.openInto` returns `focus` when the path is already open **anywhere** (FR-011a) and never yields a
  second buffer; `ownable:false` when the path may not be loaded into the requesting context (FR-036).
- `editor.notifyDirty` drives the dirty-file **lock** (acquire/release), the **recovery** temp write, the
  **unsaved indicators**, and the **mirror** relay — atomically per document.
- All channels are UI-main-scoped; **no daemon call and no `ipc-contract` type** is added.

## Contract tests
Renderer-side bridge shape (types); UI-main handler behaviour is covered by `editor-service.md` integration
tests. E2E exercises the round-trips per phase.
