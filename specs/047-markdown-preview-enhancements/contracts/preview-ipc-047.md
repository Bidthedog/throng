# Contract: IPC changes for 047

Extends 044's `contracts/preview-ipc.md`. Everything not named here is unchanged. Every new or
changed channel is covered in `packages/ui/tests/contract/preview-ipc.contract.test.ts`.

## 1. `throng:preview:open` — request gains a target (FR-010 – FR-016)

```ts
interface PreviewOpenRequest {
  absPath: string;
  projectId: string;
  requesterPanelId?: string;
  hasParentLocally: boolean;
  target?: { mode: 'lastActive' | 'new'; reusePanelId: string | null }; // NEW, optional
}
```

- **Absent `target`** behaves exactly as 044 (every existing caller keeps working).
- Main's decision order is unchanged up to the standalone branch: refusals → an existing preview for
  the file is focused (`focused`, FR-013) → a pending reservation → parented placements (044 FR-010,
  FR-053, untouched by 047, FR-012).
- **Standalone branch**: when `target.mode === 'lastActive'` and `reusePanelId` names a live preview
  run **viewed by the requesting window**, main moves that run to `absPath` with intent `{kind:'open'}`
  and answers `{ kind: 'navigated', panelId }`. Otherwise it answers `place` with `besidePanelId: null`
  as today. A `reusePanelId` naming a panel in another window, or no run at all, is ignored — never an
  error.

New answer: `{ kind: 'navigated'; panelId: string }`. The renderer focuses that panel (tab to front
is not needed — it is in the visible tab by construction, FR-015).

**Amendment (FR-081, round 4)** — the request also carries `keepFocus?: true` when the open came from
File Explorer. Only a literal `true` crosses the bridge. Main echoes it on the `throng:preview:focus`
message (an existing preview, FR-013) and on every `throng:preview:place` message (a parented placement
in another window, and the standalone last resort) that this open sends, as `keepFocus: true` beside the
existing fields. A window receiving either with `keepFocus` shows the panel (tab forward, the tab's active
panel) but does not make the workspace the active pane or move the keyboard.

## 2. `throng:preview:navigate` — two new intents (FR-011, FR-020)

`intent: { kind: 'open' } | { kind: 'drop' }` join `link`, `heading`, `history`. Both:

- record history as `link` does (044 FR-103);
- re-bind the run to the new file, un-parenting it as 044 FR-090a (FR-016);
- answer `focusedOther` when the target already has a preview elsewhere (044 FR-090c / FR-023);
- `drop` answers `refused` with the same reason text `throng:editor:resolveDrop` produced when the
  renderer passes a refusal through (confinement is decided before navigate; see §4).

## 3. `throng:preview:resolveWikiTargets` — NEW, invoke (FR-052 – FR-055)

```ts
request:  { panelId: string; targets: { path: string; rooted: boolean }[] }  // ≤ 500 per call
response: { resolved: (string | null)[] } // absolute path per target, or null when unresolved
```

- Resolution uses the run's document folder and its project root (from `Panel.originProjectId`, the
  `authoritative()` precedent) — never a root supplied by the renderer (Principle I).
- Candidates per target: `+.md`, `+.markdown`, exact (FR-052c). A path escaping the project resolves to
  its absolute path **and** is classified `outside` by the renderer's link classification, which then
  raises 044 FR-090e's notice on follow (FR-054).
- A rooted target in a run with no project (sub-workspace) → `null` (FR-052b).
- More than 500 targets: the call answers the first 500 and the rest `null`; the body issues a second
  call. Bounded so a hostile document cannot make main stat unboundedly.

## 4. Drops onto a preview (FR-020 – FR-025)

No new channel. The renderer:

1. resolves each dropped path with the **existing** `throng:editor:resolveDrop` (confinement, folder,
   too-large — same notices as an editor, FR-022);
2. rejects in the renderer any accepted path whose extension no enabled provider matches (the
   drop-refused affordance, no notice — the same as a tree drag refused today);
3. sends the first accepted path as `navigate` with `{kind:'drop'}` for the dropped-on panel;
4. sends each remaining accepted path as `open` with `target: {mode:'new', reusePanelId:null}`
   (FR-024).

## 5. Fold state — NEW, beside word wrap (FR-033, FR-034, FR-041d)

```ts
// renderer → main
'throng:editor:setFoldState'   send   { panelId: string; state: FoldState }
'throng:editor:foldState'      invoke { panelId: string; seed: 'expanded' | 'collapsed' } → FoldState
// main → renderer: carried on the existing EditorSyncMsg broadcast
{ type: 'foldState'; key: string; state: FoldState }
```

- `panelId` names an editor or a preview. Main maps it to a key: an editor or a **parented** preview →
  the document key `file:<path>` (so a preview and its editor share one entry); a **standalone**
  preview → `panel:<id>` (one entry however many windows view the panel). A preview's key changes when
  its parented state changes: becoming parented drops its `panel:` entry; becoming standalone seeds
  `panel:<id>` from the document's current state.
- On Back/Forward main restores a standalone run's `panel:` entry from `PreviewService`'s per-entry
  snapshot (FR-041d) and relays it like any other change.
- `foldState` seeds the entry with `initialFold(seed)` if none exists and returns it (the word-wrap
  `seedDefault` precedent, `editor-ipc.ts:179-187`).
- `setFoldState` stores the state (sorted, pruned by the sender) and relays it to every view on the
  key, **except the sender** (no echo; `applyWordWrapFromSync` precedent).
- The entry is forgotten when no panel shows the document (`forgetWordWrapIfClosed` precedent).
- `FoldState` is validated in main: `base` one of two values, `flipped` an array of ≤ 2,000 strings of
  ≤ 256 chars; anything else is dropped with a log line.
