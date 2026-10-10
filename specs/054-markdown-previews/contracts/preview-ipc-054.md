# Contract: preview IPC additions (054)

## `throng:preview:toggleTask` (invoke, renderer → main)

```ts
interface TaskToggleRequest {
  panelId: string;        // the requesting preview panel
  filePath: string;       // absolute path the preview shows
  line: number;           // 0-based source line from data-task-line
  expectChecked: boolean; // state the user saw before clicking
  itemText: string;       // the item's text after the marker, trimmed (relocation fingerprint)
  occurrence?: { index: number; of: number }; // which same-text item, in the DRAWN source (FR-027)
}

type TaskToggleResponse =
  | { ok: true; savedToDisk: boolean }            // savedToDisk=false: applied to an unsaved document
  | { ok: false; reason: 'not-found' | 'ambiguous' | 'changed'
                       | 'readOnly' | 'locked' | 'missing' | 'outOfTree'
                       | 'binary' | 'encoding' | 'io' };
```

Rules:

- Main resolves confinement against the panel's project (Principle I); `outOfTree` otherwise.
- Open document: apply through `EditorCoordinator.applyExternalEdit` as **one** undo entry; save iff the
  document was clean before the edit (FR-025).
- No open document: `textFileRewrite` — decode, edit, encode with the file's encoding, BOM and line
  endings (FR-029); re-check `isOpen` immediately before writing.
- Never writes a line other than the located marker (FR-027). Text one item has → that item; text
  several share → the `occurrence` when their count is unchanged, else `ambiguous` (a stale line can hold
  another item with the same text).
- A clean open document whose save then fails has the toggle taken back out (FR-028: the box keeps its
  state), and the refusal names the save's cause.
- Validation: `line` a non-negative integer ≤ 1,000,000; `itemText` ≤ 1 KiB; `occurrence`, when
  present, two such integers with `index < of`; malformed → `ok:false, reason:'io'` without touching the
  file.

## `PreviewOpenRequest` additions

```ts
target: { mode: 'lastActive' | 'new'; reusePanelId: string | null }  // unchanged shape;
                                                                       // reusePanelId now same-provider only
reveal?: { from: number; to: number; text: string }   // Find in Files (FR-030/031), renderer-local only
```

`reveal` never crosses to main: the renderer stores it as a pending reveal for whichever panel the
response names (`focused`, `navigated`, placed).

## `PreviewService.navigate` (link follow) — FR-008

A target whose provider differs from the run's is answered `{ kind: 'reroute' }`; the renderer performs
an ordinary open of that path (FR-007/FR-004).
