# Phase 1 Data Model: Typed Panels — Editor Panel Type

Entities, types, config additions, and the in-memory coordinator model. **No SQL / no migration** (research
D2/D14): persisted state rides the existing layout blob; unsaved content lives in recovery temp files; the
coordinator state is in-memory in UI main. **No daemon and no `ipc-contract` involvement.**

---

## 1. Panel typing — the Editor kind (core domain — Phase A)

`packages/core/src/workspace/model.ts` already has `PanelKind = 'terminal' | (string & {})` (L25) and
`PanelConfig = Record<string, unknown>` (L32). This feature uses `kind: 'editor'` and a typed
`EditorPanelConfig` (assignable through the same optional `Panel.kind`/`Panel.config`, back-compatible):

```ts
const EDITOR_KIND = 'editor' as const;

// Persisted in Panel.config (rides the layout JSON blob — no migration)
interface EditorPanelConfig {
  filePath?: string;        // real target path; undefined for a never-saved new document
  encoding?: EncodingId;    // detected/last-saved encoding (default 'utf8')
  hasBom?: boolean;         // BOM presence for utf8 (default false for new docs)
  lineEnding?: LineEndingId;// 'lf' | 'crlf' | 'cr' (new-doc default from settings.editor.defaultLineEnding)
}

type EncodingId = 'utf8';           // extensible; this pass ships UTF-8 (± BOM)
type LineEndingId = 'lf' | 'crlf' | 'cr';
```

- **Assignment**: `setPanelType(layout, panelId, 'editor', config)` assigns from the **untyped** state
  (reuses the existing `panel-type/assignment.ts`). Unlike Terminal, **`clearPanelType` is NOT used for
  editors** — the editor never reverts to the form (research D4); the Panel is removed only by
  destroy/close. A newly confirmed Editor Panel gets `config = {}` (a new in-memory doc; `filePath`
  undefined).
- **Persistence**: serialised inside `workspace_layout.layout_json` (no schema change). Old layouts (no
  `kind`) remain valid untyped panels.

### editorPanelType descriptor (core `editor/panel-type.ts`, registered in `panel-type/default-registry.ts`)

```ts
const editorPanelType: PanelTypeDescriptor<EditorValues> = {
  id: 'editor',
  label: 'Editor Panel',
  inputs: [],                                   // no config inputs — confirm creates a new document
  defaults: () => ({}),
  validate: (_v, ctx) => ctx.projectRoot !== null || ctx.rootless ? { ok: true } : { ok: false, errors: {} },
  buildConfig: () => ({}),                       // EditorPanelConfig for a new, empty, unpathed document
};
type EditorValues = Record<string, never>;
```

- Registered alongside `terminalPanelType` in `default-registry.ts` (the single new-type seam). The form's
  `panel-type-form.tsx` gains an `'editor'` branch rendering `<EditorInputs/>` (explanatory copy only), and
  `panel-body.tsx` gains `kind==='editor' → <EditorPanel/>`.

---

## 2. Editor document (runtime — renderer + UI-main coordinator)

The live buffer. Renderer holds the CM6 state; UI main tracks the coordinator view (registry + lock +
recovery). Not a SQL entity.

```ts
interface EditorDocument {
  panelId: string;              // owning Panel (registry key; matches on restore/mirror)
  ownerKind: 'project' | 'subworkspace';
  ownerProjectId?: string;      // set when ownerKind==='project'
  filePath: string | null;      // real target path (null = new/unpathed)
  displayName: string;          // filePath basename, or a "new document" placeholder
  relativeFolder: string | null;// filePath's folder relative to owner root (for the file pill)
  encoding: EncodingId;
  hasBom: boolean;
  lineEnding: LineEndingId;
  dirty: boolean;               // has UNSAVED user changes (drives indicators + lock; NOT the recovery temp)
  recoveryTempPath: string;     // %APPDATA%\throng\recovery\<panelId>
  lockHandle?: LockHandle;      // held while dirty && filePath !== null (FR-028)
}
```

- **Dirty** is set on user edit, cleared on full save (or discard). It gates the unsaved dot (§5), the
  dirty-file lock (§6), and the destroy prompt (FR-006a). The **recovery temp file is not** part of dirty
  (FR-053).
- **Mirror** (FR-034): when a project editor is synced into a sub-workspace, both views reference **one**
  `EditorDocument` (same `panelId`); UI main relays content + dirty across windows (research D12). Cursor/
  scroll/selection are window-local.

---

## 3. Text fidelity (core `editor/text-fidelity.ts` — pure over bytes — Phase A)

```ts
interface DecodedFile { text: string; encoding: EncodingId; hasBom: boolean; lineEnding: LineEndingId; }

function detectEncoding(bytes: Uint8Array): { encoding: EncodingId; hasBom: boolean }; // UTF-8 ± BOM this pass
function decode(bytes: Uint8Array): DecodedFile;                    // detect + decode + detect line ending
function detectLineEnding(text: string): LineEndingId;             // dominant of LF/CRLF/CR
function encode(text: string, opts: { encoding: EncodingId; hasBom: boolean; lineEnding: LineEndingId }): Uint8Array;
function newDocumentDefaults(defaultLineEnding: LineEndingId): { encoding: EncodingId; hasBom: boolean; lineEnding: LineEndingId };
// = { encoding: 'utf8', hasBom: false, lineEnding: defaultLineEnding }
```

- **Load** (UI-main `editor-service`): read raw bytes via `IFileSystem` → `decode` → record encoding/BOM/
  ending on the `EditorDocument`.
- **Save**: `encode(text, recorded opts)` and write bytes — **preserves** the file's original encoding/BOM
  and line-ending style, editing only changed lines (SC-005). New docs use `newDocumentDefaults`.

---

## 4. Confinement, save-scope, one-buffer, overlap (core — pure)

```ts
// editor/confinement.ts (Phase A/E)
function isWithinTree(absPath: string, root: string): boolean;
function isOutsideAllProjects(absPath: string, allProjectRoots: string[]): boolean;
function resolveSaveConfinement(doc: EditorDocument, roots: { ownerRoot: string | null; allProjectRoots: string[] })
  : { allowed: (candidate: string) => boolean; kind: 'in-owner-tree' | 'outside-all-projects' };

// editor/save-scope.ts (Phase A)
type SaveAllScope = 'tab' | 'project' | 'all';
function editorsInScope(scope: SaveAllScope, ctx): string[];       // panelIds to save
// returns { saved, skippedUnpathed } at the service layer
// Sub-workspace-owned editors (no owning project) are in scope ONLY for 'tab' (by tab membership);
// 'project'/'all' cover project-owned editors only (FR-023).

// editor/open-registry.ts (Phase B) — pure logic; state held by UI-main coordinator
interface OpenDocRegistry { byPath: Map<string /*abs*/, { panelId: string; windowId: string }>; }
function openOrFocus(reg: OpenDocRegistry, absPath: string, request): { action: 'focus'; target } | { action: 'open' };
function isOpenAnywhere(reg: OpenDocRegistry, absPath: string): boolean;   // drives Open-In disabling

// editor/overlap.ts (Phase E, FR-038)
function projectRootWouldContainOpenEditor(newRoot: string, openSubWsEditors: { filePath: string }[]): { blocked: boolean; files: string[] };
```

- **Confinement** (FR-021/022/036): project-owned → `isWithinTree(path, ownerRoot)`; sub-workspace-owned →
  `isOutsideAllProjects(path, allRoots)`. Enforced in UI main before every write; the new-doc save chooser
  is constrained to `allowed`.
- **Save-All** (FR-023): resolve `editorsInScope`, save pathed, **skip + report** unpathed.
- **One buffer app-wide** (FR-011a): the coordinator consults `openOrFocus`; already-open → focus/raise;
  Open-In targets disabled when `isOpenAnywhere`.

---

## 5. Unsaved indicators (core `editor/indicators.ts` — Phase C)

```ts
function panelUnsaved(doc: EditorDocument | undefined): boolean;          // doc?.dirty === true
function tabUnsaved(tabEditors: EditorDocument[]): boolean;               // any dirty
function projectUnsaved(projectEditors: EditorDocument[]): boolean;       // any dirty in the project (across its tabs)
```

- A single **themeable red dot** (`colours.unsavedDot`) rendered: on the **Panel** right of the name,
  before pills (`panel-placeholder.tsx`); on the **Tab** between name and panel count (`tab-group.tsx`); on
  the **project** in place of the removed "loaded" dot (`projects-panel.tsx` — the `project-item__loaded`
  element at L412-419 is replaced by the unsaved dot; unloaded projects keep `project-item--unloaded`
  greyed italics with **no** dot). All three share one style class.

---

## 6. Config, theme & keybindings (Phase A/C)

`settings.json` → `AppSettings.editor` (new section; tolerant validator like `terminalSettings`):

```ts
interface EditorSettings {
  openOnClick: 'single' | 'double' | 'none'; // default 'single'
  autoSave: boolean;                          // default false
  autoSaveDebounceMs: number;                 // default 500 (injected debounce, FR-060 / Principle X)
  saveAllScope: 'tab' | 'project' | 'all';    // default 'project'
  defaultLineEnding: 'lf' | 'crlf' | 'cr';    // default 'lf'
  maxOpenFileBytes: number;                   // default 10485760 (10 MiB) — too-large threshold, FR-062
}
// DEFAULT_APP_SETTINGS.editor = { openOnClick: 'single', autoSave: false, autoSaveDebounceMs: 500, saveAllScope: 'project', defaultLineEnding: 'lf', maxOpenFileBytes: 10485760 }
```

Theme (`core/config/theme.ts`) — new tokens with defaults + CSS vars via `toCssVariables`:

| Token | Kind | Default intent |
|-------|------|----------------|
| `colours.editorBg` | colour | editor surface background |
| `colours.editorFg` | colour | default text |
| `colours.editorCursor` | colour | caret |
| `colours.editorSelection` | colour | selection highlight |
| `colours.unsavedDot` | colour | the shared unsaved red dot (Panel/Tab/project) |
| `colours.activePaneHighlight` | colour | the active-pane highlight (Files & Folders pane when active, FR-015/SC-006) |

Keybindings (`core/config/keybindings.ts`) — new `ActionId`s `editor.save` (**Ctrl+S**), `editor.saveAll`
(**Ctrl+Shift+S**), dispatched in `app.tsx` **only when a Panel (not Files & Folders) is the active pane**
(research D7).

---

## 7. UI-main coordinator & recovery (in-memory + disk — Phases A/B/E)

Held by the UI-main **editor coordinator** (`editor-coordinator.ts`); not persisted in SQLite.

```ts
interface EditorCoordinatorState {
  registry: OpenDocRegistry;                    // path → { panelId, windowId } (app-wide one-buffer)
  docs: Map<string /*panelId*/, EditorDocument>;// live document metadata (dirty, lock, recovery)
}
```

- **Recovery** (`editor-recovery.ts`, FR-041/042/043): debounced write of each open doc's content to
  `%APPDATA%\throng\recovery\<panelId>`, **independent of autosave**; on launch, reconcile against the
  persisted editor Panels (match by `panelId`) — restore in-progress content, delete temps for
  saved/closed docs. The temp never marks a doc dirty (FR-053).
- **Cross-window sync** (FR-034): `editor.notifySync(panelId, patch)` → UI main → other windows'
  `editor.onSync` (content + dirty), mirroring `panel-*-sync`.
- **Dirty-file lock** (§6/FR-028): coordinator `acquire`s `IFileLock` when a doc becomes `dirty && filePath`
  and `release`s on save/destroy.

## 7b. Dirty-file lock (UI main, in-memory — FR-028)

```ts
// core/abstractions/file-lock.ts
interface IFileLock { acquire(absPath: string): LockHandle; release(h: LockHandle): void; }
// WindowsFileLock: hold a file handle without share-write/delete (analogue of WindowsDirectoryLock)
```

- Acquired when a document with a real path becomes **dirty**; released when it becomes **clean** (saved) or
  its Panel is **destroyed/closed**. A clean or unpathed document holds no lock.

---

## 8. State transitions (editor panel)

```
[untyped Panel] --select 'Editor Panel' + Confirm--> [typed: editor, config {}, new in-memory doc]     (A)
new doc --user edits--> dirty (recovery temp written; NO lock yet — unpathed)                          (A/E)
doc --Ctrl+S / Save-As (confined)--> saved: filePath set, clean, encoding/ending recorded, temp removed (A)
saved doc --user edits--> dirty (acquire IFileLock on filePath; recovery temp written)                 (A, FR-028)
dirty doc --Ctrl+S / auto-save--> saved: written (encoding/ending preserved), clean, lock released      (A/C)
open file from tree (already open anywhere) --> focus/raise the existing editor (no 2nd buffer)         (B, FR-011a)
open file into dirty editor --> 4-choice prompt (discard / save+open / open-in-new / cancel)            (B, US9)
project editor --Sync to sub-workspace--> mirrored: one doc, many views (content+dirty synced)          (E, FR-034)
dirty editor/tab/project --destroy/delete--> prompt save/discard/cancel (cancel = no-op)                (D, FR-006a)
app close with unsaved editors --> no warning; recovery temps hold content                              (E, FR-040)
app launch --> reconcile recovery temps → restore unsaved content; clean temps for saved docs           (E, FR-042/043)
create project overlapping an open sub-ws-owned editor's file --> BLOCKED (save+close first)            (E, FR-038)
```

---

## 9. What is NOT modeled (out of scope)

- No `editors` SQLite table / migration (research D14) — `user_version` stays 6.
- No **daemon** entity and **no `ipc-contract`** module (research D2) — the feature is UI-main + renderer.
- No syntax highlighting / language model, no Markdown preview — deferred ("Rich code editors" ROADMAP).
- No collaborative/multi-user document model beyond the single-user same-`panelId` mirror (FR-034).
