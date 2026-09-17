# Contract: panel navigation history

**Feature**: 044 | **Requirements**: FR-100 – FR-112, SC-007, User Story 7 (#136); iteration 2026-09-15: FR-115 (§8)

The model is in [data-model.md](../data-model.md) §4, and its invariants H1–H10 are the unit
contract. This file is the process contract: who records, who moves, who persists, who purges.

---

## 1. One authority

`NavigationHistoryService` in UI main holds one `NavigationHistory` per editor or preview panel id.
Every window receives each change and mirrors it into `Panel.config.history` for panels its layout
holds, which is what the layout blob persists. There is no per-window viewer registration and no
`detach`: `changed` is broadcast, and a record lives until `purge`. No renderer computes a new history; it only renders one and asks for moves.

## 2. Channels — `throng:history:*`

| Channel | Direction | Payload | Notes |
|---|---|---|---|
| `attach` | invoke | `{ panelId, panelKind: 'editor' \| 'preview', persisted?: PersistedHistory }` → `NavigationHistory` | Adopt-if-absent; `parseHistory(persisted, cap)`. Called by editor panels on mount (T158). **A preview does not call it**: `throng:preview:attach` adopts the same record in main (contracts/preview-ipc.md §1), so there is one attach per panel, not two |
| `purge` | send | `{ panelId }` | Panel destroyed, closed, or its type cleared (FR-110) |
| `setViewState` | send | `{ panelId, viewState }` | Preview only; applied to the current entry (FR-107) |
| `changed` | main → **every window** | `{ panelId, history: NavigationHistory \| null }` | `null` means the record was purged: the mirror removes `config.history` rather than writing an empty list. After every mutation. Broadcast, not sent to viewers only, so a window holding the panel in a background tab (detached, not a viewer) still mirrors a Save-As `rewriteCurrent` or a purge into its layout; a window whose layout does not hold the panel ignores it. Carries paths only, like `throng:files:moved` |

Recording and moving have **no** renderer-facing channel. They happen as consequences of a load
(§3), so no caller can move a position without the panel's content having changed.

## 3. Who records and who moves

### Editors — inside `EditorCoordinator.load`

`throng:editor:load`'s request gains:

```ts
navigation?: { kind: 'history'; index: number; filePath: string };
```

| Outcome of `load` | Without `navigation` | With `navigation` |
|---|---|---|
| Read succeeded | `recordOpen(filePath)` (no-op if already current, FR-103) | `moveTo(index)` if `entries[index].filePath` still `samePath`s `filePath`; otherwise nothing |
| File missing, panel holds it open (041 FR-015) | `recordOpen` | `moveTo(index)` — FR-106d |
| Refused | nothing | nothing |

Everything else in FR-106 follows from **not calling `load`**:

| Situation | Renderer flow | History |
|---|---|---|
| Dirty editor, prompt → **Cancel** | no load | unchanged (FR-106a) |
| Prompt → **Save & open**, save fails | no load | unchanged (FR-106a) |
| Prompt → **Discard & open** / **Save & open** succeeds | `load` with `navigation` | moves (FR-106a) |
| Prompt → **Open in new editor** | a new panel's first load, no `navigation` | new panel: first entry; this panel: unchanged (FR-106a) |
| File open in another editor (`openInto` → `focus`) | no load | unchanged (FR-106b) |
| Binary / too large / outside (`openInto` → `refuse`) | no load; one notice naming the file | unchanged (FR-106c) |

**The one deliberate bypass** (FR-106d): for a history intent only, the renderer ignores `openInto`'s
refusal when its reason is a missing file (`NOT_A_MISSING_FILE`, `core/src/editor/refusal.ts:27`), so
the load runs, the failure banner shows, and the position moves.

### Editors — the consolidated renderer flow

```ts
// packages/ui/src/renderer/editor/open-into-panel.ts
export async function openIntoEditorPanel(
  ws: WorkspaceApi,
  panelId: string,
  absPath: string,
  intent: { kind: 'open' } | { kind: 'history'; index: number },
): Promise<'loaded' | 'cancelled' | 'focusedElsewhere' | 'refused' | 'openedInNew' | 'saveFailed'>;
```

`openFileInTab`'s in-place branch (`editor-open.tsx:197-213`) and `openFileInPanel` (`:285-301`) both
call it; so do Back and Forward.

### Previews — inside `PreviewService`

| Event | History |
|---|---|
| First `attach` of a new preview | `recordOpen(filePath)` (FR-103b) |
| `navigate` with `intent: 'link'` → `shown` | `recordOpen` (FR-090a) |
| `navigate` with `intent: 'history'` → `shown` | `moveTo` (FR-102) |
| Parented ↔ standalone | nothing (FR-103b) |
| `navigate` with `intent: 'heading'` *(iteration 2026-09-15)* — target is the run's current file | `recordJump(leaving, arriving)` — no read, no `emit` (FR-115, §8) |
| `navigate` with `intent: 'history'` onto an entry naming the **run's current file** *(iteration 2026-09-15)* | `moveTo`, then `emit` with that entry's `viewState` — no re-read, no `moveRun` (FR-115, FR-107) |

### Path changes

| Source | Call | FR |
|---|---|---|
| `FilesService.setOnMoved(MovePair[])` (`main.ts:1410`) — the **one combined callback** after `markMoved` and `previewService.moved` (contracts/preview-ipc.md §3) | `rewritePaths` on **every** record | FR-109 |
| Coordinator `repointed` from Save As | `rewriteCurrent` on that editor | R14 |
| A preview following its document's re-point | `rewriteCurrent` on that preview | FR-031, FR-027 |

Each window also receives `throng:files:moved { moves }` and rewrites `config.history`
(`HistoryMirrorSync`) and a preview's `config.filePath` (`PreviewPathSync`) for panels in its own
layout — mounted or not — following the `MovedPathSync` precedent
(`ui/src/renderer/editor/moved-path-sync.tsx:29-54`), which itself is unchanged.

## 4. Back and Forward in the renderer

```text
command navigate.back | navigate.forward  (or header button, header menu item, mouse button 3/4)
  → panel = focused editor or preview panel (FR-105); none → no-op
  → target = targetOf(historyStore.get(panel.id), dir); null → no-op (buttons are disabled anyway)
  → editor:  openIntoEditorPanel(ws, panel.id, target.entry.filePath, { kind: 'history', index: target.index })
  → preview: preview.navigate({ panelId, target: { absPath }, intent: { kind: 'history', index }, leavingViewState })
```

Enabled state for the buttons and menu items is `canGoBack` / `canGoForward` of the mirrored history
(FR-104, FR-111). The buttons are drawn on every editor and preview panel, disabled at the ends.

## 5. Cap

`editor.navigation.historySize` (1–100, ships 10). On change, main calls `applyCap` on every record
and emits `changed` for each that changed (FR-108). `recordOpen` applies the cap as it appends.

## 6. Persistence

- Each window's `HistoryMirrorSync` writes `config.history = serialiseHistory(h)` for panels in its
  layout when `changed` arrives — mounted or not — skipping identical values (so a window does not
  re-save its layout for a panel it does not hold — the guard at `moved-path-sync.tsx:42-47`).
- A preview's `config.filePath` is written by `PreviewPathSync` from `throng:preview:pathChanged`
  (contracts/preview-ipc.md §2) and from `throng:files:moved` — not by `MovedPathSync`, which listens
  to editor sync messages that never name a preview.
- `canonicalisePersistedPaths` canonicalises `config.history.entries[].filePath` (FR-109).
- Restore: an **editor's** persisted history travels **in the same message as its load** —
  `throng:editor:load` carries `history: config.history`, read at the same moment as `filePath`, and
  `EditorCoordinator.load` adopts it (adopt-if-absent) before recording. Ordering between a separate
  attach and the load therefore cannot lose it. `throng:history:attach` remains for mounting without a
  load; a preview adopts through `throng:preview:attach` (§2). *(Amended 2026-09-15 (US7a review).)*
- A preview view that detaches (tab switch, unmount) sends `setViewState` for its current entry first,
  so a re-attach restores where the reader was, not where they last left that entry.
- A layout written before 044 has no `history`; an editor's first load then records its first entry.

## 7. Purge

| Path | Call |
|---|---|
| `destroyPanel` (`ui/src/renderer/workspace/panel-placeholder.tsx:441-467`) | `history.purge(panelId)` |
| Remote destroy (`panel-destroy-sync.tsx:31-41`) | `history.purge(panelId)` — idempotent |
| Clear panel type (`clear-editor-panel-type.ts:32-56`) | `history.purge(panelId)`; `config` deletion removes the persisted copy (`assignment.ts:92-102`) |
| Clear panel type **on a preview** (header menu while its failure banner is up, 030 FR-042c) | the renderer sends `preview.destroyed(panelId)`, whose handler in main purges the history (contracts/preview-ipc.md §1), then clears the type |
| Provider disabled / preview removed by `PreviewProviderSync` → `removePanelsWhere` | `preview.destroyed(panelId)` for loaded panels, which purges in main; unloaded ones vanish with their config |
| Send to Tab, Sync to | **nothing** (FR-110) |

## 8. Heading jumps in a preview *(iteration 2026-09-15 — FR-115, refines FR-101 for previews)*

A preview's history is no longer file-level only: a followed same-document heading link is an entry. An
editor's history is unchanged.

| Reader does | Renderer | Main | History |
|---|---|---|---|
| Ctrl+click / Ctrl+Enter / *Open Link* on `#heading`, heading found | captures `leaving` (the top of the document is `{ line: 0, offsetRatio: 0 }`, never null), scrolls, captures `arriving`; sends `navigate { intent: { kind: 'heading' }, target: { absPath: <current file>, fragment }, leavingViewState, arrivingViewState }` | `PreviewService`: target is the run's current file → `history.recordJump(panelId, leaving, arriving)`; answers `shown` with the current snapshot. Target not the current file (overtaken) → answers the current snapshot, records nothing | `recordJump` (data-model §14.2): an entry for the same file at `arriving`, unless it equals where the reader already was |
| The same on a `file` link naming the file already shown, **with** a fragment | as above | as above | as above |
| The same on a `file` link naming the file already shown, **without** a fragment | scrolls to the top; sends nothing | — | none (FR-103) |
| A heading that is not found | raises `link-missing-heading`; sends nothing | — | none |
| Scrolls, or is scrolled by FR-113's sync | nothing | — | none (FR-101) |
| Back / Forward onto an entry of the same file | `navigate { intent: { kind: 'history', index } }`, as §4 | `moveTo`, `emit` with the entry's `viewState`, no re-read | position moves (FR-102) |
| Back past the first jump in a document | as §4 | the ordinary cross-file path | the previous document is shown, at its recorded place (FR-115, FR-107) |

- `NavigationHistoryService.recordJump` is a **no-op for an editor record**, so H10 (editor entries never
  carry `viewState`) holds by construction.
- The rule of §2 stands: there is still no renderer channel that records or moves history directly.
  `heading` is an intent of `throng:preview:navigate`, whose contract (`preview-ipc.md` §1) gains it.
  *(Updated 2026-09-16 by converge: that edit is no longer pending — it landed in `preview-ipc.md` §1
  before T201, and this sentence still described it as forthcoming.)*
- Save As on a parented preview inside a jump chain: `rewriteCurrent` rewrites the chain's contiguous
  entries for the old path together (H2a, refined in data-model §14.2).
- Cap, purge, persistence and path rewriting (§5–§7) apply to jump entries exactly as to file entries.
