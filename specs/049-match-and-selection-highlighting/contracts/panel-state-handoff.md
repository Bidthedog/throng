# Contract: Panel-State Hand-off

Carries a loaded panel's view and transient UI state from the window that sends it to another window to the
window that receives it (FR-000, FR-000a). Design: [research R3](../research.md#r3--a-main-side-in-memory-panel-state-hand-off-fr-000-fr-000a);
payload: [data-model PanelSnapshot](../data-model.md#panelsnapshot-hand-off-payload-contractspanel-state-handoffmd).

## Preload API — `window.throng.panelState`

```ts
interface PanelStateBridge {
  /** Store snapshots for these panels in main, replacing any earlier unclaimed one per panel. */
  stash(snapshots: readonly PanelSnapshot[]): Promise<void>;
  /** Return and delete main's snapshots for these panel ids; ids with none are absent. */
  claim(panelIds: readonly string[]): Promise<Record<string, PanelSnapshot>>;
}
```

## IPC channels (invoke)

| Channel | Payload | Answer |
|---|---|---|
| `throng:panelState:stash` | `{ snapshots: PanelSnapshot[] }` | `void` |
| `throng:panelState:claim` | `{ panelIds: string[] }` | `Record<string, PanelSnapshot>` |

## Main-side rules (`ui/main/panel-state-handoff.ts`)

1. One entry per panel id; a stash overwrites.
2. A snapshot that is not a plain object, carries a section of the wrong shape, or serialises over 64 KB is
   dropped (logged at debug), never thrown back to the renderer.
3. `claim` deletes what it returns.
4. A destroyed panel's entry is deleted; nothing is written to disk.

## Renderer ordering

| Route | Order |
|---|---|
| `detachToNew` | `stashPanelState(ids)` → `persistSubWorkspaces` → `refresh` → `open(subId)` |
| `syncToExisting` | `stashPanelState(ids)` → `persistSubWorkspaces` → `notifyChanged(subId)` |
| `subworkspace-app` mount and every `reloadKey` remount | `claim(ids of this sub-workspace)` → seed maps (only absent entries) → render `WorkspaceProvider` |

`ids` is the moved panel, or every panel of a moved tab.

## Seeding targets

| Section | Seeded into | Taken by |
|---|---|---|
| `find` | `search-store` sessions (`seedFindSession`) | `attachPanelSearch` → `restore` |
| `editor` | `editor-view-state` map | `use-editor` `initialise()` |
| `terminal` | `terminal-view-state` map | `use-terminal` after scrollback replay |
| `previewSelection` | `preview-selection` map | first draw after mount |
