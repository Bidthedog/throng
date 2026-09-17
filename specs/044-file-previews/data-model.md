# Phase 1 Data Model: File Previews and Panel Navigation History

**Feature**: 044 | **Date**: 2026-09-14 | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md)

Types are grouped by **where they live**, because placement is the load-bearing decision: pure model
and decisions in `packages/core`, authorities in `packages/ui/src/main`, views in
`packages/ui/src/renderer`. Nothing here reaches `persistence`, `daemon` or `ipc-contract` as a new
type: both persisted fields ride `Panel.config` inside the existing layout blob.

Signatures are shapes, not implementations. Channel payloads are in
[contracts/preview-ipc.md](./contracts/preview-ipc.md) and
[contracts/navigation-history.md](./contracts/navigation-history.md).

---

## 1. Preview provider descriptor — `core/src/preview/provider.ts` (`PREVIEW_KIND` in `core/src/preview/panel-type.ts`)

`PREVIEW_KIND` sits beside the preview panel-type descriptor, as `EDITOR_KIND`, `TERMINAL_KIND` and
`FIND_IN_FILES_KIND` sit beside theirs; there is no separate `kind.ts`.

The core half of a provider: pure data that settings, menus, persistence and main can all read
without a DOM.

```ts
export type PreviewProviderKind = 'text' | 'binary';

export interface ProviderSettingDeclaration {
  /** Leaf name under editor.previews.providers.<id>. Not 'enabled' or 'defaultOpenAction'. */
  leaf: string;
  label: string;
  description: string;
  control: 'toggle' | 'select' | 'number';
  default: boolean | string | number;
  allowedValues?: readonly string[];
  optionLabels?: Readonly<Record<string, string>>;
  min?: number;
  max?: number;
  step?: number;
}

export interface PreviewProviderDescriptor {
  /** Stable; appears in settings keys. Never renamed once shipped. /^[a-z][a-zA-Z0-9]*$/ */
  id: string;
  displayName: string;
  /** Dot-prefixed, lower-case, e.g. ['.md', '.markdown']. Matched case-insensitively. */
  extensions: readonly string[];
  kind: PreviewProviderKind;
  settings?: readonly ProviderSettingDeclaration[];
  /** Names one of `settings` (a toggle) that permits https images. Read by main's request filter. */
  remoteImagesSetting?: string;
  /** Binary providers only: MIME types the source route may serve. */
  sourceMimeTypes?: readonly string[];
}
```

**Validation (at registration — FR-071, FR-072)**

- `id` unique and well-formed; `extensions` non-empty, each `/^\.[a-z0-9][a-z0-9.+-]*$/`.
- **No extension claimed twice** across providers. A duplicate throws
  `Preview providers "<a>" and "<b>" both claim "<ext>"` — naming both (FR-072).
- `settings[].leaf` unique within the provider and not `enabled` / `defaultOpenAction`.
- `remoteImagesSetting`, if present, names a `toggle` in `settings`.
- `kind: 'text'` must not declare `sourceMimeTypes`; `kind: 'binary'` must.

## 2. Provider registry — `core/src/preview/registry.ts`

The `PreviewProviderRegistry` interface is declared in `provider.ts` (§1) so that settings and every
surface can import the type without the implementation; `SHIPPED_PREVIEW_PROVIDERS` is built in
`core/src/preview/providers/index.ts` — the one core registration line.

```ts
export interface PreviewProviderRegistry {
  list(): readonly PreviewProviderDescriptor[];
  get(id: string): PreviewProviderDescriptor | undefined;
  /** By extension only (Assumptions: a language override does not make a file previewable). */
  forPath(path: string): PreviewProviderDescriptor | undefined;
}

export function createPreviewProviderRegistry(
  providers: readonly PreviewProviderDescriptor[],
): PreviewProviderRegistry;              // throws on the FR-072 conflict

// core/src/preview/providers/index.ts
export const SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS: readonly PreviewProviderDescriptor[]; // [markdownProvider] — the ONE registration line
export const SHIPPED_PREVIEW_PROVIDERS: PreviewProviderRegistry;  // createPreviewProviderRegistry(SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS)

/** The provider for a path only while it is enabled; undefined otherwise (FR-062, Assumptions). */
export function enabledProviderFor(
  registry: PreviewProviderRegistry,
  settings: PreviewSettings,
  path: string,
): PreviewProviderDescriptor | undefined;

/** Any provider claiming the path, enabled or not. */
export function providerFor(registry: PreviewProviderRegistry, path: string): PreviewProviderDescriptor | undefined;

export type PreviewAffordance =
  | { state: 'absent' }                                                   // FR-001, FR-003, FR-004, FR-073
  | { state: 'disabled'; reason: 'provider-disabled'; provider: PreviewProviderDescriptor }  // FR-001, FR-003, FR-062
  | { state: 'disabled'; reason: 'preview-open'; provider: PreviewProviderDescriptor }       // FR-012
  | { state: 'enabled'; provider: PreviewProviderDescriptor };

export function previewAffordance(args: {
  registry: PreviewProviderRegistry;
  settings: PreviewSettings;
  absPath: string | undefined;            // undefined: an editor with no file on disk
  projectRoot: string | undefined;
  isFolder: boolean;
  previewOpen: boolean;
  surface: 'editor' | 'explorer';
}): PreviewAffordance;
```

Decision order, first match wins:

| # | Condition | Result |
|---|---|---|
| 1 | no `absPath`, a folder, or outside `projectRoot` | `absent` (FR-003, FR-004) |
| 2 | no provider claims the extension | `absent` (FR-001, FR-003) |
| 3 | `surface: 'editor'` and the provider is `binary` | `absent` (FR-073) |
| 4 | the provider is disabled | `disabled` / `provider-disabled` (FR-001, FR-003, FR-062) |
| 5 | a preview of the file is open | `disabled` / `preview-open` (FR-012) |
| 6 | otherwise | `enabled` |

For the **status-bar button**, `preview-open` renders as *pressed and enabled* (FR-014) rather than
disabled; the menu items render it disabled (FR-012). A `provider-disabled` tooltip names the setting.

**The Markdown descriptor** — `core/src/preview/providers/markdown.ts`:

```ts
{ id: 'markdown', displayName: 'Markdown', extensions: ['.md', '.markdown'], kind: 'text',
  settings: [{ leaf: 'loadRemoteImages', label: 'Load remote images', control: 'toggle', default: true, … }],
  remoteImagesSetting: 'loadRemoteImages' }
```

## 3. Preview settings — types in `core/src/preview/settings-types.ts`, functions in `core/src/config/preview-settings.ts`

```ts
// core/src/preview/settings-types.ts
export type PreviewCopyFormat = 'rich' | 'plain';
export type DefaultOpenAction = 'editor' | 'preview';

export interface ProviderSettings {
  enabled: boolean;                        // FR-065: markdown ships true
  defaultOpenAction?: DefaultOpenAction;   // text providers only; ships 'editor' (FR-050/051)
  [ownLeaf: string]: boolean | string | number | undefined;
}

export interface PreviewSettings {
  updateDelayMs: number;                   // 300,  hard range 0–5000   (FR-060)
  maxWaitMs: number;                       // 1000, hard range 0–10000  (FR-060a)
  copyFormat: PreviewCopyFormat;           // 'rich' (FR-035b)
  providers: Record<string, ProviderSettings>;
}

// Lives on EditorSettings as `previews`; `editor.navigation` gains:
//   historySize: number                   // 10, range 1–100, step 1 (FR-108)

// core/src/config/preview-settings.ts
export function previewSettingsDefaults(registry: PreviewProviderRegistry): PreviewSettings;
export function previewSettingsDescriptors(registry: PreviewProviderRegistry): FieldDescriptor[];
export function parsePreviewSettings(raw: unknown, registry: PreviewProviderRegistry): PreviewSettings;
export function effectiveMaxWaitMs(s: PreviewSettings): number;   // max(maxWaitMs, updateDelayMs) — FR-060a
export function defaultOpenActionFor(
  registry: PreviewProviderRegistry, s: PreviewSettings, path: string,
): DefaultOpenAction;                      // 'editor' unless the file's provider is ENABLED and either
                                            // is binary (FR-051) or is text and says 'preview'
export function remoteImagesPermitted(registry: PreviewProviderRegistry, s: PreviewSettings): boolean;
/** FR-063's trigger: ids of registered providers whose `enabled` went true → false. Pure; main calls it on every settings change. */
export function providersTurnedOff(
  previous: PreviewSettings, next: PreviewSettings, registry: PreviewProviderRegistry,
): readonly string[];
```

*Extended by §14.1 (Iteration 2026-09-15): `syncScroll`, and Markdown's `showFrontMatter`.*

**Rules**

- Parsing is tolerant per leaf (the `app-settings.ts` convention): a bad value takes its default; an
  unknown provider id in `providers` is **preserved** on write (a hand-added or later-build key is
  legitimate — `settings-validity.test.ts:57`) and ignored on read.
- A binary provider has no `defaultOpenAction` leaf and no descriptor for it: its default open action
  is **Preview** while it is enabled, and **Editor** while it is disabled (FR-051).
- Descriptors: `group: 'Editor'`, `subgroup: 'Previews'`; each provider's `defaultOpenAction` and own
  settings carry the **existing** `enabledWhen: { key: 'editor.previews.providers.<id>.enabled', is: true }`,
  so they are drawn **disabled, not hidden**, while the provider is off (FR-061). No new descriptor field.
- `defaultOpenActionFor` returns `'editor'` while the provider is disabled, **without** rewriting the
  stored `defaultOpenAction` — re-enabling restores the user's choice (FR-062).

## 4. Navigation history — `core/src/navigation/history.ts`

```ts
export interface NavigationEntry {
  /** Absolute path, storage canon on disk (FR-068, FR-109). */
  filePath: string;
  /** Preview entries only: provider-owned, JSON, ≤ 1 KiB serialised; dropped if larger (FR-101). */
  viewState?: unknown;
}

export interface NavigationHistory {
  entries: readonly NavigationEntry[];
  /** -1 only when entries is empty. */
  index: number;
}

export const EMPTY_HISTORY: NavigationHistory;

export function recordOpen(h: NavigationHistory, filePath: string, cap: number): NavigationHistory;
export function moveTo(h: NavigationHistory, index: number): NavigationHistory;
export function canGoBack(h: NavigationHistory): boolean;
export function canGoForward(h: NavigationHistory): boolean;
export function targetOf(h: NavigationHistory, dir: 'back' | 'forward'): { index: number; entry: NavigationEntry } | null;
export function applyCap(h: NavigationHistory, cap: number): NavigationHistory;
export function rewritePaths(h: NavigationHistory, moves: readonly { from: string; to: string }[]): NavigationHistory;
export function rewriteCurrent(h: NavigationHistory, filePath: string): NavigationHistory;
export function setCurrentViewState(h: NavigationHistory, viewState: unknown): NavigationHistory;

/** Persisted form: { v: 1, entries, index }. Tolerant: drops bad entries, clamps index, applies cap. */
export function parseHistory(raw: unknown, cap: number): NavigationHistory;
export function serialiseHistory(h: NavigationHistory): PersistedHistory;
```

*Extended by §14.2 (Iteration 2026-09-15): `recordJump`, H11–H15, and H2a refined for jump chains.*

**Invariants** (unit-tested; SC-007 as a property test over random op sequences)

| # | Invariant | FR |
|---|---|---|
| H1 | `entries.length === 0 ⇔ index === -1`; otherwise `0 ≤ index < entries.length` | — |
| H2 | `recordOpen` with a path `samePath` to the current entry returns `h` unchanged | FR-103 |
| H2a | After `rewriteCurrent` or `rewritePaths`, no two adjacent entries name one file (`samePath`) **unless they already named one file before it** — a preview's jump chain (FR-115, §14.2). A **chain** is a stretch of adjacent entries that named one file before the rewrite (a single entry when there is no jump); a **run** is a stretch of adjacent entries that name one file after it. Each run keeps one chain whole, every entry with its `viewState` — the chain holding `index` when the run holds it, else the run's first chain — and drops the rest; `index` moves back by the entries dropped before it. So same-path merging never fuses two jump entries in one file at different positions. *(Added 2026-09-15 (adversarial review, core M3): a Save As onto the previous file left `[a.md, a.md]`, where Back visibly did nothing. Widened 2026-09-15 (review of fix batch B, M-3): a rename onto a file the history still named produced `[a.md, a.md]`. Reconciled 2026-09-15 (iteration, FR-115): runs merge by chain, not by entry.)* | FR-102, R14, FR-115 |
| H3 | `recordOpen` otherwise discards `entries[index+1…]`, appends, sets `index` to the new last — even if the path occurs earlier | FR-103 |
| H4 | `moveTo` changes `index` only; `entries` is identical by reference | FR-102 |
| H5 | `moveTo(moveTo(h, i), h.index)` equals `h` | FR-102, SC-007 |
| H6 | `applyCap(h, n)` keeps at most `n` entries, drops **oldest first**, never the current entry, and shifts `index` accordingly | FR-108 |
| H7 | `rewritePaths` rewrites an entry whose path equals a move's `from`, or lies under it when `from` is a folder; order is kept, and `index` changes only when H2a merges entries — a jump chain moves whole. *(Amended 2026-09-15 (review of fix batch B, M-3; iteration, FR-115).)* | FR-109 |
| H8 | `rewriteCurrent` on an empty history is `recordOpen` | R14 (a new document's first Save As) |
| H9 | `viewState` survives `moveTo` and `rewritePaths`; it is only ever set on the current entry | FR-107 |
| H10 | Editor entries never carry `viewState` | FR-101 |

## 5. Link and image classification — `core/src/preview/links.ts`

```ts
export type PreviewLink =
  | { kind: 'external'; url: string }                            // http:, https:, mailto: (FR-091)
  | { kind: 'file'; absPath: string; fragment?: string }         // inside the project (FR-090)
  | { kind: 'heading'; fragment: string }                        // same document (FR-090f)
  | { kind: 'outside'; target: string }                          // resolves outside the project (FR-090e)
  | { kind: 'inert' };                                           // anything else (FR-091)

export function classifyPreviewLink(href: string, ctx: { docPath: string; projectRoot: string }): PreviewLink;

export type PreviewImage =
  | { kind: 'project'; relPath: string }                         // FR-084
  | { kind: 'remote'; url: string }                              // https only, only while permitted (FR-092)
  | { kind: 'blocked' };                                         // FR-084, FR-092, FR-093

export function resolvePreviewImage(
  src: string, ctx: { docPath: string; projectRoot: string; remoteImages: boolean },
): PreviewImage;

export function headingSlug(text: string, taken: Set<string>): string;           // GitHub-style, de-duplicated
export function markdownHeadingLine(text: string, fragment: string): number | null;  // FR-090d
export function languageForFenceInfo(info: string): string;                       // language id or 'plaintext'
```

## 6. Request policy — `core/src/preview/request-policy.ts`

```ts
export function decideRendererRequest(
  req: { url: string; resourceType: string },
  // rendererDir: the directory the renderer's own files load from (the packaged dist/renderer),
  // resolved by main; remoteImages from remoteImagesPermitted (§3)
  policy: { rendererDir: string; remoteImages: boolean },
): 'allow' | 'cancel';

/**
 * `mimeAllowlist` is the image allowlist for the asset route, and the provider's `sourceMimeTypes`
 * for the source route; the caller (main's protocol handler) chooses it, so this function never sees a
 * provider. An empty allowlist for the source route is how a text provider is refused (403).
 */
export function resolvePreviewAsset(
  route: { kind: 'asset'; relPath: string } | { kind: 'source' },
  ctx: { projectRoot: string; docPath: string; mimeAllowlist: readonly string[] },
): { ok: true; absPath: string; mime: string } | { ok: false; status: 403 | 404 | 415 };
```

`resolvePreviewAsset`'s containment is a string decision. Its caller must `realpath` both the project
root and the returned `absPath` and re-check containment before serving (the symlink/junction guard,
contracts/preview-ipc.md §4).

`OPEN_RESERVATION_TIMEOUT_MS` (10 000) and `MAX_VIEW_STATE_BYTES` (1 024) are named constants, recorded
as a Principle X deviation in the plan's Complexity Tracking.

## 7. Titles — `core/src/workspace/panel-title.ts` (extended)

```ts
// panelDisplayTitle gains a 'preview' branch:
//   parented   → `${parentDisplayTitle} - Preview`   (FR-031)
//   standalone → `${derivedEditorTitleFor(filePath)} - Preview`
// Truncation shortens the name part only; ' - Preview' is never cut, and the name keeps at least one
// character, so at a limit ≤ 10 the title exceeds it (FR-032, amended).
export const PREVIEW_TITLE_SUFFIX = ' - Preview';

/** The same title in halves, so a header marks the NAME (`name… - Preview`), never the suffix (FR-032). */
export interface PreviewTitleParts { name: string; suffix: string; nameTruncated: boolean }
/** null wherever panelDisplayTitle composes no preview title; name + suffix always equals its result. */
export function previewTitleParts(panel: Panel, sources?: PanelTitleSources, maxNameLength?: number): PreviewTitleParts | null;
```

The parent's display title is an **input** (from the preview update, §10), never looked up from a
stored link — there is none (FR-013).

## 8. Layout operations — `core/src/workspace/operations.ts` (extended)

```ts
/** New panel split beside an existing one (FR-010: 'right'; FR-015c: 'left'). */
export function addPanelBeside(layout: WorkspaceLayout, targetId: string, edge: 'left' | 'right', panel: Panel): WorkspaceLayout;

/**
 * FR-063/FR-064/FR-067. Removes matching panels exactly as closing them by hand would (removePanel:
 * slot collapses, an emptied tab closes). A match that is the workspace's LAST panel in its LAST tab
 * is replaced by a new untyped placeholder panel (fresh id from `newPanelId`, default title) — 002
 * FR-016. `newPanelId` is caller-supplied, as every id in operations.ts is (`NewTabIds`), and is called
 * only when a replacement is needed. Idempotent.
 */
export function removePanelsWhere(
  layout: WorkspaceLayout,
  predicate: (p: Panel) => boolean,
  newPanelId: () => string,
): WorkspaceLayout;
```

## 9. Persisted panel config — `core/src/workspace/model.ts` (extended)

```ts
export type PreviewPanelConfig = {
  /**
   * The file the preview currently shows. Same key as the editor's, so CONFIG_PATH_KEYS covers it (FR-068).
   * Written by each window's PreviewPathSync from the broadcast `throng:preview:pathChanged` and from `throng:files:moved`.
   * On restore it is a FALLBACK: the current entry of `history` wins when present (contracts/preview-ipc.md §1).
   */
  filePath?: string;
  /** Mirror of main's authority, written by the window (FR-066, FR-109). */
  history?: PersistedHistory;
  /**
   * The `projectId` of the layout the window that OPENED this preview was showing — a project id, or
   * `subworkspace:<id>`. Written once by `placePreview`, never rewritten; absent on a layout written
   * before it, where the origin rule alone decides, as it did then.
   * Read by `viewEndsPreview` (contracts/preview-ipc.md, `destroyed`): it is the only thing that tells a
   * preview a sub-workspace window opened — its run is that window's to end — from a project preview
   * synced into it, which is a second view of a run the project still shows. Both are project-owned
   * panels in a `subworkspace:<id>` layout, and after a relaunch the window remembers nothing else
   * (FR-012, FR-014). *(Added 2026-09-16 (review of the 2026-09-15 iteration, finding 2).)*
   */
  placedInLayoutProjectId?: string;
};

export type EditorPanelConfig = {
  // … existing fields …
  history?: PersistedHistory;              // FR-109
};

export type PersistedHistory = { v: 1; entries: { filePath: string; viewState?: unknown }[]; index: number };
```

**What is deliberately NOT persisted**: whether the preview is parented, the parent's panel id or
title, the rendered content, any dirty flag, the notice, and the scroll position outside history
entries. Their absence is what makes FR-066's "derived afresh on restore" and FR-043/FR-044 true by
construction. `placedInLayoutProjectId` is not an exception to that: it records which WINDOW opened the
panel, which no restart can derive, and says nothing about the run.

`LAYOUT_SCHEMA_VERSION` stays **3**. `canonicalisePersistedPaths` walks `config.history.entries[].filePath`.

```ts
// core/src/workspace/persisted-paths.ts
/** The file a persisted preview shows: history's current entry, else filePath (the attach precedence). */
export function previewPathOf(config: PreviewPanelConfig | undefined): string | undefined;
```

Every consumer that asks "which file is this persisted preview?" — `attach`, the FR-067 restore filter,
the FR-063 unloaded-layout purge — uses `previewPathOf`, so the three cannot disagree.

---

## 10. `PreviewService` state — `ui/src/main/preview-service.ts`

```ts
interface PreviewRun {
  panelId: string;                          // the PREVIEW panel's id
  projectId: string;                        // Panel.originProjectId — Principle I
  projectRoot: string;                      // resolved in main, never from the renderer
  filePath: string;                         // current file; mirrors history's current entry
  providerId: string;
  source:
    | { kind: 'document'; documentPanelId: string }   // parented — DERIVED from the editor registry
    | { kind: 'disk'; watch: Disposable };            // standalone
  revision: number;                         // monotonically increasing per run
  lastSent: PreviewContent | null;
  dirty: boolean;                           // only ever copied from the document (FR-040)
  notice: PreviewNotice | null;
  scheduler: SettleScheduler;               // R13
  viewers: Set<number>;                     // web-contents ids
}

interface PreviewServiceState {
  runs: Map<string, PreviewRun>;            // by preview panel id
  byPath: Map<string, string>;              // canonical path → preview panel id (FR-012)
  pending: Map<string, string>;             // path → reserving request, released on attach or timeout
  editorTitles: Map<string, string>;        // editor panel id → display title (FR-031)
}
```

**State transitions of a run's `source`**

```text
            attach / navigate (file has a document)
   ┌───────────────────────────────────────────────┐
   │                                               ▼
 [disk] ──── registered(path, docPanelId) ────▶ [document]        FR-013a
   ▲                                               │
   └──── unregistered(path) ── re-read disk ───────┘              FR-013b (dirty → false, title → standalone form)

 [document] ── repointed(from, to) ──▶ [document @ to]            FR-013c: rename, move OR Save As — byPath re-keyed,
                                                                  history.rewriteCurrent, title and provider re-matched;
                                                                  no enabled provider for `to` → notice 'no-provider' (FR-027)
 [disk]     ── moved(from, to) ──────▶ [disk @ to]                FR-013c (in-app move, via FilesService.setOnMoved), FR-109
 [any]      ── navigate(link)  ──────▶ re-derived for the new file; history.recordOpen   FR-090a, FR-103b
 [any]      ── read fails ───────────▶ same source, notice set                            FR-026
```

```ts
type PreviewContent =
  | { kind: 'text'; text: string }                           // text providers
  | { kind: 'resource'; url: string };                       // binary providers: throng-preview://source/<id>?rev=N

type PreviewNotice =
  | { kind: 'unreadable' | 'deleted' | 'too-large' | 'not-text' }   // FR-026 (from LoadResult.reason)
  | { kind: 'no-provider' }                                          // FR-027
  | { kind: 'link-missing-file' | 'link-outside'; target: string }   // FR-090e
  | { kind: 'link-missing-heading'; target: string }                 // FR-090e/f — raised by the RENDERER (onNotice), never by main:
                                                                     //   main does not parse headings, so a link to an existing file is `shown`
  | { kind: 'history-refused'; target: string; reason: string };     // FR-106c
```

## 11. `NavigationHistoryService` state — `ui/src/main/navigation-history-service.ts`

```ts
interface HistoryRecord {
  panelId: string;
  panelKind: 'editor' | 'preview';
  history: NavigationHistory;
}
// Map<panelId, HistoryRecord>. No viewer set: `changed` is broadcast to every window. Adopt-if-absent on attach; purge on destroy/close/clear-type;
// applyCap on settings change; rewritePaths from main's combined onMoved callback; rewriteCurrent called by
// EditorCoordinator at an editor's Save-As re-point and by PreviewService on a preview's.
```

## 12. Renderer state

| Store | Lives in | Holds | Written by |
|---|---|---|---|
| `preview-store.ts` | per window | `Map<previewPanelId, { content, revision, dirty, parent: { panelId, title } \| null, notice, filePath, providerId, viewState? }>` — no Back/Forward state (that is `history-store`'s alone) | `throng:preview:update` only |
| `preview-open-store.ts` | per window | `Set<canonical path>` of files with an open preview | `throng:preview:openChanged` |
| `history-store.ts` | per window | `Map<panelId, NavigationHistory>` | `throng:history:changed` only; mirrored into `Panel.config.history` by `HistoryMirrorSync` |

*Extended by §14.4 (Iteration 2026-09-15): `editor-scroll-store.ts`.*

**No preview publishes to `editor-state.ts`** (`ui/src/renderer/editor/editor-state.ts:17,82`), so the
tab dot, the project dot and the Files & Folders marker — all read from that store
(`editor-state.ts:190-200`, `tab-group.tsx:123`, `projects-panel.tsx:141`) — count a document once
(FR-044, SC-006).

## 13. Renderer provider view — `ui/src/renderer/preview/provider-view.ts`

The renderer half of a provider. Registered by id in `ui/src/renderer/preview/providers/index.ts`;
`provider-views.test.ts` asserts its key set equals `SHIPPED_PREVIEW_PROVIDERS`' ids (the
`language-loaders.test.ts` precedent).

```ts
export interface PreviewProviderView {
  id: string;
  /** Loaded on first use (R21). */
  load(): Promise<PreviewBody>;
  /** Body menu offers Copy / Select All only when true. */
  textSelection: boolean;
  /** FR-035a: the provider's export profile for rich copy; loaded on first use. Absent → rich copy is plain text only. */
  exportHtml?(selection: DocumentFragment): Promise<string>;
}

export interface PreviewBodyProps {
  panelId: string;
  content: PreviewContent;
  filePath: string;
  projectRoot: string;
  providerSettings: ProviderSettings;
  initialViewState: unknown;                         // FR-107 — from the last PreviewUpdate.viewState (attach, history navigate)
  onViewStateCapture(capture: () => unknown): void;  // called by the panel when leaving an entry
  onFollow(link: PreviewLink): void;                 // FR-090, FR-091
  onNotice(notice: PreviewNotice): void;             // FR-090e/f
  onLinkMenu?(link: PreviewLink, at: { x: number; y: number }): void;   // FR-095: the panel owns the link menu
  onDrawn(filePath: string): void;                   // REQUIRED to call: after every draw a body calls exactly one of onDrawn or onBodyFailure (heading lookup, focus-fragment, Try again outcome)
  onBodyFailure(error: unknown): void;               // the body could not load or render: the panel shows its failure banner (Try again re-loads)
}
export type PreviewBody = React.ComponentType<PreviewBodyProps>;
```

The panel chrome — header, status bar, notices, menus, Back/Forward, zoom, copy routing, keyboard
scope — belongs to `preview-panel.tsx` and is identical for every provider (FR-070).

*Extended by §14.4 (Iteration 2026-09-15): two optional props, `syncLine` and `onLinkTarget`.*

---

## 14. Iteration 2026-09-15 (FR-113–FR-120)

*Additive. §3, §4, §12 and §13 above are unchanged; this section states what each gains. Design and
rationale: plan.md, Iteration 2026-09-15; research.md R23–R28.*

### 14.1 Settings (extends §3)

```ts
// core/src/preview/settings-types.ts — PreviewSettings gains:
syncScroll: boolean;                       // true (FR-114). Every text provider; no enabledWhen.

// core/src/preview/providers/markdown.ts — the Markdown descriptor's own settings gain, beside loadRemoteImages:
{ leaf: 'showFrontMatter', label: 'Show front matter', control: 'toggle', default: true }   // FR-117
// → editor.previews.providers.markdown.showFrontMatter, generated by previewSettingsDescriptors,
//   enabledWhen: { key: 'editor.previews.providers.markdown.enabled', is: true }
```

**Rules**
- `parsePreviewSettings`: a non-boolean `syncScroll` takes `true` (tolerant per leaf, as §3).
- `cloneEditor` copies `previews.syncScroll` (a primitive; the providers deep clone is unchanged).
- Neither leaf needs a `SHIPPED_DEFAULTS_VERSION` change (absent leaves take their default).

### 14.2 Navigation history (extends §4)

```ts
/**
 * FR-115 — a followed same-document heading in a PREVIEW. In order:
 *   0. An empty history is returned unchanged.
 *   1. Put `leaving` on the current entry (as setCurrentViewState).
 *   2. If the current entry now equals the entry before it (same file, jsonEqual viewState) — the reader
 *      scrolled back to where an earlier jump left them — drop the current entry (index − 1).
 *   3. If the current entry (after 2) has a jsonEqual viewState to `arriving`, stop: no entry is added —
 *      and if the NEWER neighbour has now become that same place, drop it too, or H12 would be false on
 *      the forward side. (Added 2026-09-16 by converge: the code has always done this, pinned by
 *      navigation-history.test.ts:522-533 and commented at history.ts:281-296; this step omitted it.)
 *   4. Discard entries newer than index, append { filePath: current.filePath, viewState: arriving },
 *      set index to it, and apply the cap.
 * A viewState over the 1 KiB bound is dropped as keepableViewState already drops it.
 */
export function recordJump(
  h: NavigationHistory, leaving: unknown, arriving: unknown, cap: number,
): NavigationHistory;
```

**Invariants added** (unit-tested; the SC-007 property test gains a `recordJump` op)

| # | Invariant | FR |
|---|---|---|
| H11 | `recordJump` on an empty history returns it unchanged | FR-115 |
| H12 | After `recordJump`, no two **consecutive** entries name the same file with `jsonEqual` view states | FR-115 |

> **H12 holds after any operation** *(narrower until 2026-09-16; closed by T219, commit `0bf8f58f`)*.
> FR-115's fourth sentence — *"Two consecutive entries for the same file and the same position MUST NOT
> be recorded"* — is unconditional, and the merge used to run only inside `recordJump`, leaving three
> routes that reach `setCurrentViewState` without it: the link intent and the history intent in
> `preview-service.ts`, and the detaching-view effect through `navigation-history-ipc.ts`. Each could
> leave a same-file, same-place pair, which the reader met as a Back or Forward press that visibly did
> nothing. `recordCurrentPlace` (`mergeCurrentPlace` around the current entry, newer neighbour first,
> then older) now runs inside `NavigationHistoryService.setCurrentViewState` — the single way into a
> history from outside — so every route is covered and a fourth cannot acquire the defect. The merge
> belongs to the **write**, not to `recordOpen`/`moveTo`: applied after the record, the equal pair on
> the link route is already two steps back and no longer adjacent. `recordJump` composes the same
> helper as its step 1 and is not merged twice.
| H13 | `recordJump` otherwise discards `entries[index+1…]`, appends one entry for the **current** file, sets `index` to the new last, and applies the cap (H6) | FR-115, FR-108 |
| H14 | `moveTo` across entries of one file changes `index` only (H4 holds unchanged); `targetOf` treats a same-file neighbour like any other | FR-102, FR-115 |
| H15 | `parseHistory` keeps consecutive entries for one file when their view states differ | FR-109, FR-115 |

**Refined**
- **H2a** *(refined 2026-09-15, iteration)*: `rewriteCurrent(h, filePath)` first rewrites the **contiguous
  run of entries around `index` that name the current entry's old path** — a jump chain is one document's
  positions — keeping each entry's `viewState`; H2a's merge then applies to neighbours **outside** that
  run that name the new path. Without a jump chain the run is the current entry alone, so every existing
  H2a case is unchanged.
- **H10** holds as written: editor entries never carry `viewState` — `NavigationHistoryService.recordJump`
  is a no-op for an editor record (§14.3), so no editor history ever reaches `recordJump`.
- **H2** holds as written: `recordOpen` is not changed.

### 14.3 `NavigationHistoryService` (extends §11)

```ts
recordJump(panelId: string, leaving: unknown, arriving: unknown): void;
// No-op unless the record exists and panelKind === 'preview'. Broadcasts `changed` only when the
// reducer returned a different history.
```

`moveTo`'s stale check (`:128-133`) is **unchanged** — it compares the path only. A stale index could
already name the right file at the wrong place before this iteration (a path may recur in a history,
H3); jump entries make that more frequent but not new, and the renderer's index comes from a mirror that
`throng:history:changed` refreshes on every mutation. Not widened (Principle VIII).

### 14.4 Renderer state and props (extends §12 and §13)

| Store | Lives in | Holds | Written by |
|---|---|---|---|
| `editor/editor-scroll-store.ts` | per window | `Map<editorPanelId, number>` — the editor view's top visible source line, **0-based**; one stored number per panel, so `useSyncExternalStore` identity holds | `use-editor.ts` scroll listener (rAF-throttled) and view registration; `forgetEditorTopLine` at unmount |

```ts
// PreviewBodyProps gains (both optional — a body that ignores them is still a conforming body, FR-070):
/** FR-113 — the parent editor's top visible source line (0-based) while sync applies; null/undefined otherwise. */
syncLine?: number | null;
/** FR-118 — the display target of the followable link under the pointer ('hover') or holding keyboard focus ('focus'); null when that one has left. */
onLinkTarget?(source: 'hover' | 'focus', target: string | null): void;
```

Panel-local (not a store): `preview-panel.tsx` keeps `{ hover: string | null; focus: string | null }`,
both cleared when the panel's file changes, and passes `hover ?? focus` to `PreviewStatusBar` as `readout`
(contracts/menus-and-controls.md §8).

### 14.5 Link and image attributes (extends §5 and security-policy Layer 2)

| Attribute | Set by | Value | Read by |
|---|---|---|---|
| `data-throng-target` | the link hook, on a followable `a` only | `displayTarget(target)` — the link title's text without its hint | the Markdown body, for `onLinkTarget` (FR-118) |
| `title` on `img` | the image hook, when no ancestor is a followable link | `displayTarget(authored src)`, then ` — ` and the authored image title (bidi controls stripped) when present; only the authored title when no authored `src` survived | the browser's tooltip; copied to the alt-text span by `showAltText` (FR-120) |

### 14.6 Wire types (extends §10; the IPC contract change landed in `contracts/preview-ipc.md` §1 before T201)

```ts
// core/src/preview/wire-types.ts — PreviewNavigateRequest (:85-90):
intent: { kind: 'link' } | { kind: 'history'; index: number } | { kind: 'heading' };   // + 'heading'
arrivingViewState?: unknown;   // NEW — 'heading' only: where the jump landed. For 'heading', both view states are always sent; the top of the document is { line: 0, offsetRatio: 0 }, never null
// target.absPath for 'heading' is the run's current file; target.fragment the heading as written.
// Response: { kind: 'shown'; update } — the run's current snapshot, whatever the reducer decided.
```

## 15. Iteration 2026-09-16 (FR-121, FR-122, T222)

*Additive. §14.4's store is extended, not replaced. Design and rationale: plan.md, Iteration
2026-09-16; research.md R30–R33.*

### 15.1 Editor scroll store (extends §14.4)

| Store | Lives in | Holds | Written by |
|---|---|---|---|
| `editor/editor-scroll-store.ts` | per window | `Map<editorPanelId, { line: number; fromSync: boolean }>` (object replaced only when a field changes, so snapshot identity holds) and `Map<editorPanelId, EditorScroller>` | `editor-scroll-relay.ts` (publish, register); `forgetEditorTopLine` at unmount also unregisters |

```ts
export interface EditorTopLine { line: number; fromSync: boolean }   // line 0-based, as before
export type EditorScroller = (line: number) => void;
publishEditorTopLine(panelId: string, line: number, fromSync?: boolean): void;   // same value twice → no emit
editorTopLineOf(panelId: string): EditorTopLine | null;
useEditorTopLine(panelId: string | null): EditorTopLine | null;
registerEditorScroller(panelId: string, scroller: EditorScroller): () => void;
/** FR-121a — false when this window has no ready view of that editor; nothing is queued then. */
requestEditorTopLine(panelId: string, line: number): boolean;
```

`editor/editor-scroll-relay.ts` (new, framework-free):

```ts
attachEditorScrollRelay(view: RelayView, panelId: string, deps: { raf; caf }): {
  ready(): void;          // the view's initial placement has run: register the scroller, apply a held request
  onUpdate(u: { docChanged: boolean; geometryChanged: boolean }): void;   // republish (FR-121f)
  dispose(): void;        // remove listeners, forget the line, unregister
};
```

**Rules**
- **R-E1** Every `scroll` on `scrollDOM`, and every update with `docChanged || geometryChanged`,
  publishes `editorTopLine(view)` at most once per animation frame.
- **R-E2** The scroller clamps `line` to the document, and does nothing if `editorTopLine(view)` already
  equals it (FR-121g). Otherwise it dispatches `{ effects: EditorView.scrollIntoView(lineStart, { y:
  'start' }) }` — no `selection`, no `changes`, no `focus()` (FR-121b) — and arms the echo mark.
- **R-E3** While the mark is armed, publishes carry `fromSync: true`. It lapses at the first publish after
  the dispatch's scroll, or one frame after a dispatch that produced no `scroll` event (R31).
- **R-E4** A request made before `ready()` is held (the latest wins) and applied by `ready()`.

> **As shipped — converge 2026-09-16 (round 2).** The block above was the design; the code departs from it
> in five places, all deliberate, and this note is what a reader should build against.
> - **`ready()` does not register the scroller.** `attachEditorScrollRelay` registers it **at attach**, so
>   `requestEditorTopLine` answers `true` as soon as the view is mounted and a request made before the
>   view's initial placement is **held** (R-E4) rather than refused. Registering at `ready()` would have
>   made such a request return `false` and be dropped, contradicting R-E4. `ready()` only applies the held
>   request; `use-editor.ts` calls it from `refreshLanguage`'s `.finally`, after the #144 anchor is
>   re-asserted, for the mount's placement only. The comment on `ready()` above should read *"the view's
>   initial placement has run: apply a held request"*.
> - **R-E2's effect carries `yMargin: 0`** — `scrollIntoView(lineStart, { y: 'start', yMargin: 0 })`.
>   CodeMirror's default 5px margin left the line above showing, so `editorTopLine` named it (found by the
>   T237 E2E, pinned in `editor-scroll-relay.test.ts`).
> - **R-E3's lapse has a second frame.** With no `scroll` event, the mark lapses one frame after the
>   dispatch **if `scrollTop` has not moved**; if it moved but the event has not yet arrived, it waits one
>   more frame (CodeMirror writes `scrollTop` in its measure pass and `scroll` fires on the next frame).
> - **R-E5 (new, `b3bfb70b`) — a request that moved nothing is answered.** When the lapse finds
>   `scrollTop` unmoved, and when a request is clamped onto the line already at the top (still no
>   dispatch, so FR-121g holds), the relay publishes the view's current line with `fromSync: true`. An
>   echo already means "where the editor went, as far as it could"; without the answer, a preview waiting
>   on an adoption (FR-121h) never saw it settle and the pair stayed unsynchronised. A viewport that moved
>   without its event still gets its second frame and never publishes an unmoved answer.
> - **The store also carries the document's line count** (analysis U2): `publishEditorDocLines`,
>   `editorDocLinesOf`, `useEditorDocLines`. The chrome compares it with the drawn text's line count and,
>   while they differ, keeps handing the body the line from before the edit and drops requests, so a
>   preview whose text is behind the document never follows a renumbered line against old numbering.
> - Signature detail: the third parameter is `frames: RelayFrames` (`{ raf, caf }`).

### 15.2 Preview body props (extends §14.4)

```ts
// PreviewBodyProps gains (optional — a body that ignores them still conforms, FR-070):
/** FR-121f — the source line of the block now at the top, for a scroll this body did not make to follow syncLine. */
onTopLineChange?(line: number): void;
/** FR-121e/h — how the body treats a place it is handed; see §15.3. Absent = 'restore' (FR-107 as shipped). */
placePolicy?: 'restore' | 'editorLineIfTop' | 'editorLine';
```

`syncLine` (§14.4) becomes `EditorTopLine | null` at the chrome and stays a **number** at the body: the
chrome drops `fromSync` values before passing a line down (they are echoes of the body's own request),
but keeps the latest value for the same-block check it hands the body as `syncLine`.

> **As shipped — converge 2026-09-16 (round 2).** The body contract grew beyond the two rows above. All
> additions are optional, so a body that ignores them still conforms (FR-070).
>
> | Prop | Shape | Meaning | FR |
> |---|---|---|---|
> | `syncEcho` | `boolean?` | `syncLine` is an **echo** — where the editor went to follow this preview, or as far as it could get. The body records it as the editor's line and never scrolls to it. The chrome hands echoes down marked rather than dropping them (the paragraph below said "drops"), because a dropped echo would make a later identical non-echo line look unchanged. | FR-121c, FR-121g |
> | `onTopLineChange` | `(line) => boolean \| void` | As above, but it may answer **`false`**: the chrome could not act yet, because the body compared its block against an editor line the chrome has not handed down. The body reports again on the next `syncLine`. This closes a race where the post-draw report ran before React committed the render releasing a renumbered line. | FR-121f, FR-121g |
> | `onTopLineRead` | `(read: () => number \| null) => void` | The body hands the chrome a reader for the source line of its current top block (`null` before a draw), which the chrome uses to place a newly adopted editor where the preview already is. | FR-121h |
>
> **When the body reports after a live update** (`fe0fff59`). A draw that keeps the reader's place
> (FR-024) reports through `onTopLineChange` in two cases only: the kept block was **renumbered**
> (`remapAnchorLine` changed the anchor's line), or a report was **deferred** while this text was on its
> way (the U2 hold above). Otherwise the restore, and any clamp the engine applies to it, is treated as the
> body's own scroll (P5) — so a preview sitting at its end, short of the editor's block, no longer pulls
> the editor back to its clamped top block on every keystroke (FR-121c's "a side that could not reach the
> requested place never pulls the other back"). A report already due for a real reader scroll still runs.

**Renderer-only tag** in `preview/preview-store.ts`: `PreviewPanelState.viewStateSource?: 'attach' |
'update'`, set by the attach call site and by every other apply. Never sent over IPC.

### 15.3 Pure decisions — `renderer/preview/scroll-sync-policy.ts` (new) and `scroll-anchor.ts` (extended)

```ts
// scroll-anchor.ts
topBlockLine(scroller: HTMLElement): number | null;          // data-source-line of the block at the viewport top
blockLineFor(body: HTMLElement, line: number): number | null; // greatest data-source-line ≤ line
isTopOfDocument(place: unknown): boolean;                    // null, or { line: 0, offsetRatio: 0 } — NOT undefined (analyze C2: absent = a link or an update, never a step)

// scroll-sync-policy.ts
shouldFollow(a: { previewTopBlock: number | null; editorLineBlock: number | null }): boolean;  // blocks differ
shouldDrive(a: { previewTopBlock: number | null; editorLineBlock: number | null }): boolean;   // blocks differ
// Called ONLY for an update that carries a history place (the `viewState` key is present), never for a
// followed link or a live update (analyze C2).
placeOnStep(a: { place: unknown; crossFile: boolean; synced: boolean; editorLine: number | null }):
  { kind: 'editorLine'; line: number } | { kind: 'restore'; place: unknown } | { kind: 'top' };
pairStart(a: {
  firstUpdate: boolean; drawn: boolean;
  parentBefore: string | null; parentNow: string | null;
  navigationSeqBefore?: number; navigationSeqNow?: number;
}): 'editor' | 'preview' | 'none';
```

> **"The block at the viewport top" — defined 2026-09-16 (hands-on round 3, "off by one
> occasionally").** Measured in a real layout, the old choice — the deepest block straddling the top
> edge, else the last block that *started above* it — reported a block that had scrolled wholly out of
> sight whenever the edge sat in the margin between two blocks, or a fraction of a pixel above the next
> one (8 of 40 wheel steps on the preview; 6 of 40 when the preview was following the editor, where
> the follow leaves the target 0.1–0.4 px low). Sync then sent the editor one block early, and a live
> update restored the preview to the hidden block's bottom — a visible jump. **The block at the top is
> now the first block the reader can see**, with a 1 px tolerance: the deepest block straddling the
> edge; else the nearest block starting below it; only if none, the last one started above.
> `captureScrollAnchor` chooses the same block, and its `offsetRatio` may be negative (the block starts
> below the edge), so a capture and restore over unchanged content moves nothing (FR-024). This refines
> FR-113 and FR-121b's block mapping; it changes no requirement.

```ts
```

| # | Rule | FR |
|---|---|---|
| P1 | `placeOnStep`: `crossFile && synced && editorLine !== null && isTopOfDocument(place)` → `editorLine`; `isTopOfDocument(place)` otherwise → `top` (a same-file top step then drives the editor to the top, FR-115 with FR-121f); else `restore`. **The `crossFile` condition is the reading proposed in spec.md's FR-121e planning note (analyze C1) and awaits the maintainer's ruling**; if FR-121e's same-file clause is confirmed as written, drop `crossFile` from the first branch | FR-121e, FR-107, FR-115 |
| P2 | `pairStart`: first update already parented → `editor`; `parentBefore === null`, `parentNow !== null`, same `navigationSeq`, `drawn` → `preview` (adoption); a parent change with `navigationSeq` moved → `preview` (a link or a step, not an opening); `parentNow === null` → `none` | FR-121h, FR-121f |
| P3 | While the pair is `editor`-started and not yet paired, a place tagged `attach` is not restored over the editor's line, and no scroll is relayed | FR-121h |
| P4 | `shouldFollow` / `shouldDrive` are `false` when either block is `null` or the two are equal | FR-121g |
| P5 | A scroll the body made to apply `syncLine` or an `editorLine` placement is never reported through `onTopLineChange` | FR-121c, FR-121g |

> **As shipped — converge 2026-09-16 (round 2).** `isTopOfDocument` is defined in
> `scroll-sync-policy.ts`, not `scroll-anchor.ts`, because the chrome imports the policy and must import
> no provider module; `scroll-anchor.ts` re-exports it. P1's `crossFile` condition is **kept**: the
> controller ruled on 2026-09-16 that the narrowing stands (spec.md FR-121e, *Ruled 2026-09-16*), so "awaits
> the maintainer's ruling" above now reads "ruled by the controller; the maintainer's confirmation is
> outstanding and is asked at quickstart §9 step 4 (T253)". P5 also covers a live update's kept place,
> per §15.2's note.

### 15.4 Wire (extends §10 and `contracts/preview-ipc.md` §2)

`PreviewUpdate.viewState` on a **`history`** navigate is the target entry's place **or `null`** — never
absent. `null` = "a step onto an entry with no saved place". Everywhere else the field keeps its meaning
(present on `attach` when a place exists; absent otherwise). No type change (`unknown`).

### 15.5 Settings, bindings, tokens (extends §3 and §14.1)

- `editor.previews.syncScroll` — unchanged shape and default; description text changes (FR-122f).
- `ActionId` gains `'preview.toggleSyncScroll'`; scope `HISTORY_PANELS`; ships `[]`.
- `ThemeIcons` gains `syncScroll`. `SHIPPED_DEFAULTS_VERSION` 9.
- Write: `writeConfigPatch({ kind: 'settings' }, [{ path: ['editor', 'previews', 'syncScroll'], value }])`
  from `renderer/preview/sync-scroll-toggle.ts` only (outside Preferences).
