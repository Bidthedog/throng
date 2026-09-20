# Phase 1 Data Model: Clickable File Links

**Feature**: 045 | **Date**: 2026-09-18 | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md)

*Round four, 2026-09-19 (maintainer)*: wherever this model says **Copy Link Address**, read **Copy Link
to Clipboard** (spec FR-175, S7). The rest of round four is for `/speckit-plan` to model here.

Types are grouped by **where they live**, because placement is the load-bearing decision (R3, R6):
the grammar and every decision are pure in `packages/core`; the one authority that touches the
filesystem, the home folder and `PATHEXT` is in `packages/ui/src/main`; views are in
`packages/ui/src/renderer`.

Nothing here is persisted. No SQLite migration, no `LAYOUT_SCHEMA_VERSION` change, no
`SHIPPED_DEFAULTS_VERSION` bump (three settings leaves, no theme token — `shipped-defaults.ts:490`
clones `DEFAULT_APP_SETTINGS`, so a new leaf ships without a bump).

Channel payloads are in
[contracts/settings-and-environment.md](./contracts/settings-and-environment.md) §3. (This preamble
pointed at `contracts/link-ipc.md` until 2026-09-18; no such file was ever written, and §3 is where
the three `throng:links:*` channels and their I1–I6 policy live.)

---

## 1. The candidate — `core/src/links/detect.ts` (FR-003 – FR-005, FR-009)

What detection produces before anything has touched a disk.

```ts
/** A span of text that LOOKS like a path. It is not a link until it resolves (FR-006). */
export interface LinkCandidate {
  /** The path as written, with position and trailing punctuation already stripped (FR-004, FR-005). */
  readonly text: string;
  /** Offsets into the line that was scanned; what gets underlined. */
  readonly start: number;
  readonly end: number;
  /** FR-004. Absent when the span carried none. The position is never part of `text`. */
  readonly position?: LinkPosition;
  /** How the position was written, verbatim — FR-032 copies it back in this form. */
  readonly positionText?: string;
}

export interface LinkPosition {
  /** 1-based, as every form in FR-004 writes it. */
  readonly line: number;
  /** 1-based. Absent for `path:line`. */
  readonly column?: number;
}

/**
 * Scan one line. Spans already claimed by a web link are skipped, which is FR-009 stated once
 * rather than left to regex ordering (R1).
 */
export function detectPathCandidates(line: string, claimed: readonly Span[]): LinkCandidate[];
```

**Grammar rules the function owns**, each a unit case:

| Rule | FR |
|---|---|
| relative (`src/foo.ts`, `./foo.ts`, `../docs/x.md`) | FR-003a |
| Windows absolute, either separator (`D:\git\x.ts`, `D:/git/x.ts`) | FR-003b |
| UNC, either separator (`\\server\share\x`, `//server/share/x`) | FR-003c |
| leading `/` incl. `/d/…` and `/mnt/d/…` | FR-003d |
| `~/x.ts` | FR-003e |
| `file://` written as text | FR-003f |
| `:line`, `:line:col`, `(line,col)` | FR-004 |
| trailing `)` `]` `,` `.` `:` `;` dropped; unbalanced brackets dropped; matching quotes make one span, spaces and all | FR-005 |
| a drive colon is part of the path; a trailing `:42:7` is a position **only if the path without it resolves** | Edge case |

That last rule is why `detectPathCandidates` may return **two candidates for one span** —
`C:\x\foo.ts:42` with and without the position — and why resolution, not detection, picks. The
resolver tries the longer reading first and falls back; the ordering is stated in
[contracts/link-resolution.md](./contracts/link-resolution.md) §2.

---

## 2. The resolution request and its answer — `core/src/links/types.ts` (FR-020 – FR-026)

```ts
/** Everything main needs to resolve a candidate, and nothing it should take on trust. */
export interface LinkResolutionRequest {
  /** FR-003's text, or a `file:` URI from an OSC 8 target (FR-011). */
  readonly text: string;
  readonly kind: 'detectedPath' | 'fileHyperlink';
  /** FR-022 / FR-023: the editor's own folder, or the terminal's live cwd. Absent when unknown. */
  readonly baseDirectory?: string;
  /** The panel the link was seen in. Identifies the asker; carries no authority of its own. */
  readonly panelId: string;
  /**
   * FR-021 / I2 (added 2026-09-18). The project the panel belongs to, as an **ID** — main derives
   * the ROOT from it. See the amendment in
   * [contracts/settings-and-environment.md](./contracts/settings-and-environment.md) §3: main holds
   * no panel→project map, and the `authoritative()` precedent takes an id and replaces the root.
   * Absent for a panel with no owning project, which judges every target outside one (M3).
   */
  readonly originProjectId?: string;
}

export interface ResolvedLink {
  /** FR-020: exactly one absolute location. */
  readonly path: string;
  readonly kind: 'file' | 'folder';
  /** FR-021, decided in main against the panel's owning project root. */
  readonly inProject: boolean;
  /** FR-039a, from IExecutableExtensions. A folder is never executable. */
  readonly executable: boolean;
  /** FR-030: whether an enabled preview provider accepts this file's type, and whether it is off. */
  readonly preview: 'none' | 'enabled' | 'disabled';
}

/** FR-006 / FR-013: a candidate that resolves to nothing. Not a failure — a non-link. */
export type LinkResolution = { readonly ok: true; readonly link: ResolvedLink } | { readonly ok: false };
```

`preview` is answered in main by `registry.forPath(path)` plus
`settings.providers[id]?.enabled === true` — the pair `defaultOpenActionFor` already uses
(`core/src/config/preview-settings.ts:283-294`) — so the renderer never imports a provider (044's
guard).

---

## 3. Link targets and the menu — `core/src/links/targets.ts` (FR-030, FR-031)

```ts
export type LinkTarget = 'editor' | 'preview' | 'osExplorer' | 'osDefaultProgram';

export type TargetState = 'offered' | 'disabled' | 'absent';

/** FR-030's table, as one pure function. */
export function linkTargetStates(link: ResolvedLink): Readonly<Record<LinkTarget, TargetState>>;
```

| Target | `offered` when | `disabled` when | else |
|---|---|---|---|
| `editor` | file **and** `inProject` | — | `absent` |
| `preview` | file, `inProject`, `preview === 'enabled'` | `preview === 'disabled'` (044 FR-062) | `absent` |
| `osExplorer` | always | — | — |
| `osDefaultProgram` | `kind === 'file'` | — | `absent` (a folder) |

`preview` is the only target that can be `disabled`: a disabled provider is one setting away from
working, so Principle VI's *disabled when unavailable* applies; every other `absent` case is
structurally meaningless for that link and is not drawn.

Menu composition (FR-031) is `fileLinkMenuItems(link, chord?)` in `core/src/links/menu.ts`,
returning the Contextual run in FR-031's order: **Open Link** (chord only where one is bound, R10),
then each `offered`/`disabled` target by name in FR-030's order, then **Copy Link Address**. Shapes
are pinned in [contracts/menus-and-gestures.md](./contracts/menus-and-gestures.md).

---

## 4. The default link action — `core/src/links/default-action.ts` (FR-050 – FR-055)

> **Superseded 2026-09-18 by §13.1.** The type, the value array and the setting argument below are
> retired with the setting (FR-112); the function keeps its name and becomes the click rule
> (FR-110). This section is kept as the record of what shipped before the change request.

```ts
export type DefaultLinkAction = 'throng' | 'editor' | 'preview' | 'osExplorer' | 'osDefaultProgram';

export const DEFAULT_LINK_ACTIONS: readonly DefaultLinkAction[] =
  ['throng', 'editor', 'preview', 'osExplorer', 'osDefaultProgram'];

/**
 * What Ctrl+click, the Open Link chord and the plain Open Link item do for THIS link (FR-054).
 * `previewIsDefault` is `defaultOpenActionFor(...) === 'preview'`, computed by the caller so this
 * stays free of the preview registry.
 */
export function resolveDefaultLinkAction(args: {
  readonly setting: DefaultLinkAction;
  readonly link: ResolvedLink;
  readonly hasPosition: boolean;
  readonly previewIsDefault: boolean;
}): Exclude<LinkTarget, never>;
```

The decision, in order — each clause is a unit case:

1. **FR-039 first, and it overrides everything.** `link.executable` → `osExplorer`. Whatever the
   setting says, whatever the fallback order would reach.
2. `setting === 'throng'` → `preview` when `previewIsDefault` **and** `!hasPosition` (FR-051,
   FR-052); otherwise `editor`.
3. Otherwise the named target, if `linkTargetStates(link)[target] === 'offered'`.
4. **FR-053 fallback**, first `offered` in order: `preview → editor → osDefaultProgram → osExplorer`.
   A `disabled` preview counts as not offered. Step 1 has already removed `osDefaultProgram` from
   reach for an executable, so the fallback lands on `osExplorer` for one.

FR-055 is a consequence rather than a clause: `editor` and `preview` are only ever `offered` for an
in-project file, so no route reaches them for anything outside the project.

### How the setting reaches it — a reader, not a value (reconciled 2026-09-18, T130)

`resolveDefaultLinkAction` takes the setting as a plain value, and that is unchanged. What the draft
did not settle is how the **renderer** supplies it, and the shipped shape is a function:

```ts
// ui/src/renderer/links/link-actions.ts
export interface LinkFollowDeps {
  // …
  readonly defaultAction?: () => DefaultLinkAction;         // absent means the shipped value
  readonly previewIsDefault?: (link: ResolvedLink) => boolean;
}

/** Both halves, composed once for BOTH surfaces, over one live read. */
export function linkRouting(
  read: () => LinkRoutingInputs,
): Required<Pick<LinkFollowDeps, 'defaultAction' | 'previewIsDefault'>>;
```

**SC-008 is why it is a reader.** Both surfaces build their deps **once** and hold them for the
panel's whole life — the terminal in a `useMemo` its mount effect reaches through a ref, the editor
in a function the CodeMirror extension closes over — and neither can be rebuilt on a settings change
without tearing down a live shell or a live view. A captured value would therefore freeze
`editor.links.defaultAction` at whatever it was when the panel appeared, and SC-008 requires the
change to land on the **next gesture**, with no restart. `linkRouting` exists so the two surfaces
cannot read the preference differently, which is the failure FR-054 rules out.

---

## 5. The two new ports — `core/src/abstractions/` (FR-025, FR-026, FR-039a)

Full signatures and their contract suites are in
[contracts/platform-ports.md](./contracts/platform-ports.md). Summary:

| Port | File | Methods | Windows impl | Token |
|---|---|---|---|---|
| `IPathForms` | `core/src/abstractions/path-forms.ts` | `homeDirectory`, `fromDriveForm`, `fromFileUrl`, `fromHomeForm` | `platform-windows/src/windows-path-forms.ts` | `UI_TYPES.PathForms` |
| `IExecutableExtensions` | `core/src/abstractions/executable-extensions.ts` | `isExecutable` | `platform-windows/src/windows-executable-extensions.ts` | `UI_TYPES.ExecutableExtensions` |

Contract suites in `core/src/testing/path-forms-contract.ts` and
`core/src/testing/executable-extensions-contract.ts`, in the pure-throw style of
`platform-info-contract.ts:18` (imports nothing, throws
`IPathForms contract violation: …`).

`core/src` names no extension and no drive letter mapping of its own —
`core/tests/unit/no-os-imports.test.ts` already fails the build on an OS import, and a new unit
test asserts that `core/src/links/**` contains none of `PATHEXT`, `.exe`, `.bat`, `.ps1` or `.lnk`.

---

## 6. The main authority — `ui/src/main/file-link-resolver.ts` (R3)

```ts
export class FileLinkResolver {
  constructor(deps: {
    readonly fs: IFileSystem;
    readonly pathForms: IPathForms;
    readonly executables: IExecutableExtensions;
    // The authoritative() precedent: an ID in, a ROOT out (amended 2026-09-18 — it took a panelId,
    // and main has no panel→project map).
    readonly projectRootFor: (originProjectId: string | undefined) => string | null;
    readonly previewRegistry: PreviewProviderRegistry;
    readonly readPreviewSettings: () => PreviewSettings;
  });

  resolve(req: LinkResolutionRequest): Promise<LinkResolution>;

  /** FR-037: re-resolve, re-check existence, then act. Never takes a bare path from the renderer. */
  revealInFileManager(req: LinkResolutionRequest): Promise<LinkActionOutcome>;
  openWithDefaultProgram(req: LinkResolutionRequest): Promise<LinkActionOutcome>;
}

export type LinkActionOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'gone' | 'refused'; readonly path: string };
```

Constructor injection throughout (Principle IX). `projectRootFor` is a function rather than a
service so the resolver stays testable without Electron — the shape `PreviewService` and
`NavigationHistoryService` already take.

`IFileSystem` is **not** in the UI container today (`new NodeFileSystem(...)` at `main.ts:1082`, no
`UI_TYPES` entry). This feature binds it, which closes half of 043's recorded Principle IX shortfall;
see Complexity Tracking in [plan.md](./plan.md).

---

## 7. Renderer state — the per-window resolution cache (FR-070, FR-071)

`ui/src/renderer/links/link-cache.ts`, one module-level store per window, on the `cwd-store.ts`
pattern (`Map` + `useSyncExternalStore`, one shared bridge subscription).

```ts
type CacheKey = string;   // `${kind}\u0000${text}\u0000${baseDirectory ?? ''}\u0000${panelId}`

export const LINK_CACHE_TTL_MS: number;
export function peekLink(req: LinkResolutionRequest): LinkResolution | undefined; // sync; undefined = not yet known
export function requestLink(req: LinkResolutionRequest): void;         // fire-and-forget; fills the cache
export function invalidateLinksUnder(absPath: string): void;           // a watcher event arrived
export function subscribeLinkCache(listener: () => void): () => void;  // the useSyncExternalStore half
export function useLinkResolution(req: LinkResolutionRequest | null): LinkResolution | undefined;
export function __resetLinkCacheForTests(): void;
```

**Reconciled 2026-09-18 (T130)**: `peekLink` was drafted taking the `CacheKey` above and ships
taking the `LinkResolutionRequest` itself; the key stays internal to the module. Handing one out
would make every caller — the terminal's link provider, the editor's visible-range `ViewPlugin` and
`followLink`'s injected `resolve` — responsible for spelling the same four-field encoding, which is
the duplication a cache key exists to remove. `subscribeLinkCache` and `__resetLinkCacheForTests`
are two exports the draft did not name: the first is the `useSyncExternalStore` half of the pattern
§7 already cites, the second is test-only.

- **`peekLink` returning `undefined` is FR-071's "treated as not a link until it answers"** — the
  link provider returns no link and the decoration is not drawn.
- **FR-070's "a cached answer MUST NOT outlive a change to that location"**: entries are dropped by
  `invalidateLinksUnder` on the existing file-watcher broadcast, and an entry older than
  `LINK_CACHE_TTL_MS` is re-requested on the next hover. The TTL is a named constant, not a setting
  (Complexity Tracking).
- The cache is **view state**, per window, holding no content-shaping state (Principle XI).

---

## 8. The hovered link — `ui/src/renderer/terminal/hovered-link.ts` (R4)

`hoveredLink` changes type. This is the whole of FR-043 for file links. The `let hoveredLink` and the
DOM work stay in `use-terminal.ts`'s mount effect; the **type and every judgement made about it** ship
in a module of their own, so they can be driven without an xterm, a DOM or a shell
(`ui/tests/unit/terminal-hovered-link.test.ts`).

```ts
// was: let hoveredLink: string | null
export type HoveredLink =
  | { readonly kind: 'web'; readonly uri: string }
  | {
      readonly kind: 'file';
      readonly link: ResolvedLink;
      readonly request: LinkResolutionRequest;
      /** FR-004's position, when the span carried one. Absent on an OSC 8 hyperlink. */
      readonly position?: LinkPosition;
      /** How that position was WRITTEN — FR-032 pastes it back in this form. */
      readonly positionText?: string;
    };

let hoveredLink: HoveredLink | null = null;
```

**Reconciled 2026-09-18 (T130) — the `file` arm carries the position, and the draft's two fields were
not enough.** §5 makes the terminal's context menu compose from *what the pointer rests on*, and two
of its items need the position rather than the resolved path: **Open in Editor** must land on the
line (FR-033), and **Copy Link Address** must paste the position back in the form it was printed
(FR-032). Neither is recoverable from `link.path`, and re-detecting the span when the menu opens
would be a second detection pass that could disagree with the one that drew the underline. So the
hovered value carries what the detector found, and the menu reads it.

| Reader | Where | Change |
|---|---|---|
| `keepsClickFromProgram` | `hovered-link.ts` (called from the mousedown listener) | none — `hovered !== null` now also covers file links, which is the fix |
| `hoveredLinkTipText` | `hovered-link.ts` | wording by kind (R10) |
| `setHovered`'s `^https?://` filter | `use-terminal.ts` | replaced by `classifyTerminalLinkTarget` (R5) |
| `hoveredLinkIdentity` | `hovered-link.ts` | the tooltip delay restarts only when the link genuinely changes |
| `hoveredLinkMenuText` | `hovered-link.ts` | the link's own TEXT for `terminalLinkTarget`, never the resolved path — a `D:\…` path would classify as the scheme `d:` |
| `getHoveredLink()` | `terminal-panel.tsx` | returns the `HoveredLink`, so the menu can compose FR-031 |

**`allowNonHttpProtocols` — an xterm opt-in the draft did not know about.** xterm's `OscLinkProvider`
parses every OSC 8 target and **discards anything that is not `http(s)` before it builds a range**,
unless the link handler asks for the rest. So the whole of US2 was inert in the app — no underline,
no tooltip, a Ctrl+click that did nothing — while every unit test around it passed, because nothing
below E2E constructs an xterm `Terminal`. `linkHandler.allowNonHttpProtocols: true`
(`use-terminal.ts`) is what hands a `file:` hyperlink over at all. xterm's own doc for the option
asks for "proper protection in `activate`", and that protection is what this feature already built:
`classifyTerminalLinkTarget` closes by default, so `javascript:`, `data:`, `mailto:` and every
unknown scheme stay exactly as inert as 024 made them, and a `file:` target goes to main as **text**
to be re-resolved (FR-037) rather than to the OS url opener. The one visible cost is that an inert
scheme now draws xterm's hover underline; it still opens nothing, on any gesture.

---

## 9. Settings — `core/src/config/app-settings.ts` (FR-060, FR-061, FR-080b)

> **Amended 2026-09-18 — see §13.3.** `editor.links.defaultAction` is retired and
> `editor.links.existenceCheckTimeoutMs` is added; the table below is the pre-amendment record.

Three leaves. Each needs four edits in `app-settings.ts` (interface field, `DEFAULT_APP_SETTINGS`
entry, tolerant parse line, and **the field in `cloneTerminals`/`cloneEditor` — a field missing
there is silently dropped on write**) plus exactly one descriptor.

| Key | Type | Ships | Group / subgroup | FR |
|---|---|---|---|---|
| `editor.links.defaultAction` | `DefaultLinkAction` | `'throng'` | Editor · **Links** | FR-050, FR-061 |
| `editor.links.detectInEditors` | `boolean` | `true` | Editor · **Links** | FR-060 |
| `editor.links.detectInTerminals` | `boolean` | `true` | Editor · **Links** | FR-060 |
| `terminals.advertiseHyperlinks` | `boolean` | `true` | Terminal | FR-080b |

**Why the first three sit together under Editor · Links and the fourth does not.** FR-061 requires
the default link action and both detection switches "together in one place", and requires the
hyperlink-advertising switch to live "with the terminal settings, because it changes what a terminal
is started with". `group` + `subgroup` is exactly the mechanism: `groupDescriptors`
(`ui/src/renderer/preferences/group-descriptors.ts:59`) buckets by `group` then `subgroup`, both in
declaration order, and 044 already uses `Editor` + `Previews` the same way.

The enum carries a `readonly` value array beside its type (`DEFAULT_LINK_ACTIONS`, §4) so the parser
and the descriptor cannot drift, and `optionLabels` for the whole set — Title-Casing
`osDefaultProgram` reads wrong, and `metadata.ts:107-120` requires all-or-none.

---

## 10. Key binding — `core/src/config/keybindings.ts` (FR-045, FR-046, FR-062)

No new ActionId. `preview.followLink` keeps its id and its `['Ctrl+Enter']` default; its scope set
gains `editor` (R9), and its metadata description stops saying *"Live in a preview only."*.
`COMMAND_SCOPES['preview.followLink'].has('terminal')` stays **false** — FR-046, and
`keybindings-preview.test.ts:61-67` is left exactly as it is.

---

## 11. Terminal environment — `core/src/terminal/spawn-env.ts` (FR-080 – FR-080d)

```ts
export function hyperlinkAdvertisementEnv(
  baseEnv: Readonly<Record<string, string | undefined>>,
  advertise: boolean,
): Record<string, string> | undefined;
```

Returns `{ FORCE_HYPERLINK: '1' }` iff `advertise` **and** no case-insensitive `FORCE_HYPERLINK` key
is present; `undefined` otherwise. It can return no other key, which is FR-080d by construction.
Merged into `LaunchSpec.env` in `ui/src/main/terminal-ipc.ts`'s `doAttach` — **not** into `baseEnv`,
which a de-elevated terminal never receives (R11).

---

## 12. What is deliberately **not** modelled

- **No persisted state.** A link exists only while the text that names it is on screen.
- **No new panel kind, no new icon or colour token, no new RPC to the daemon.** `packages/daemon`,
  `packages/persistence` and `packages/ipc-contract` are untouched.
- **No link registry.** Links are derived from what is drawn; FR-006 and the "file that exists when
  underlined and is gone when followed" edge case both require the answer to be re-derived, so
  holding a list of live links would be a second source of truth for something the screen already
  owns.

---

## 13. Amendment 2026-09-18 — the click rule, one line scan, network checks

### 13.1 The click rule — `core/src/links/default-action.ts` (FR-110, FR-111, FR-114)

```ts
/** What Ctrl+click, the Open Link chord and the plain Open Link item do for a FILE link. */
export type ClickTarget = 'editor' | 'preview' | 'osExplorer';   // never 'osDefaultProgram' (FR-111)

export function resolveDefaultLinkAction(args: {
  readonly link: ResolvedLink;
  readonly hasPosition: boolean;
  readonly previewIsDefault: boolean;   // defaultOpenActionFor(...) === 'preview', from the caller
}): ClickTarget;
```

The decision, each clause a unit case:

1. `link.kind === 'folder'` → `osExplorer`.
2. `!link.inProject` → `osExplorer`.
3. `previewIsDefault && !hasPosition && link.preview === 'enabled'` → `preview`.
4. Otherwise → `editor`.

`link.executable` is not read (FR-114). `DefaultLinkAction` and `DEFAULT_LINK_ACTIONS` are deleted;
so is `LinkFollowDeps.defaultAction` and the `defaultAction` half of `linkRouting` (§4's
reconciliation note) — the reader existed only to make a changing setting reach the next gesture,
and there is no setting. `previewIsDefault` stays a reader, because 044's per-provider setting still
changes live. Web links do not pass through this function: a web link's click is the open-external
seam, always.

### 13.2 One line scan — `core/src/links/web-url.ts`, `core/src/links/scan-line.ts` (FR-102, FR-104)

```ts
export interface WebLinkSpan { readonly uri: string; readonly start: number; readonly end: number }

export const WEB_URL_REGEX: RegExp;                       // moved from terminal-url.ts, unchanged
export function detectWebLinks(line: string): readonly WebLinkSpan[];

export interface ScannedLine {
  readonly web: readonly WebLinkSpan[];
  readonly paths: readonly LinkCandidate[];               // never overlapping a web span (FR-009)
}
export function scanLinkLine(line: string): ScannedLine;
```

Pure and total, like `detectPathCandidates` (D8). The terminal's `claimedByWebLinks` and the editor's
per-line scan in `link-decorations.ts` both become calls to `scanLinkLine`; the `WebLinksAddon` is
loaded with `WEB_URL_REGEX`. The editor draws a web span as a link without asking main — a web link
is not resolved (§6.1 of [contracts/link-resolution.md](./contracts/link-resolution.md)).

The editor's decoration carries the kind, so the `mousedown` handler, the chord and the menu can tell
a web span from a file link:

```ts
// ui/src/renderer/editor/link-decorations.ts
type EditorLinkAt =
  | { readonly kind: 'web'; readonly uri: string; readonly from: number; readonly to: number }
  | { readonly kind: 'file'; /* as today */ };
```

### 13.3 Settings — the `Editor · Links` block (FR-112, FR-113, FR-120)

```ts
export interface EditorLinkSettings {
  // defaultAction — RETIRED (FR-112). A persisted value is dropped by the parse (FR-113).
  detectInEditors: boolean;               // FR-060, unchanged
  detectInTerminals: boolean;             // FR-060, unchanged
  existenceCheckTimeoutMs: number;        // FR-120 — ships 2000, bounded 250–25000
}
```

Four edits for the new leaf (interface, default, tolerant parse, `cloneEditor`) plus one descriptor;
the same four deletions for the retired one. Full descriptor text in
[contracts/settings-and-environment.md](./contracts/settings-and-environment.md) §6.1.

### 13.4 Outcomes gain `unreachable` — `core/src/links/types.ts` (FR-120, FR-124)

```ts
export type LinkResolution =
  | { readonly ok: true; readonly link: ResolvedLink }
  | { readonly ok: false; readonly reason?: 'unreachable' };      // absent = does not exist

export type LinkActionOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'gone' | 'refused' | 'unreachable'; readonly path: string };
```

The renderer's cache stores an `unreachable` answer like any non-link, for the ordinary TTL; that
expiry **is** FR-122's back-off.

### 13.5 Volume-root state — `ui/src/main/file-link-resolver.ts` (FR-121, FR-122)

Main-process memory only, never persisted, never sent to a renderer:

```ts
// per volume root (node:path parse(p).root — `\\server\share\` or `C:\`)
interface RootState {
  readonly stuckSince: number;    // a stat under this root outlived the timeout and has not settled
}
// Map<root, RootState>; size bounded by MAX_TIMED_OUT_LINK_CHECKS (core/src/links/limits.ts) = 2
```

A root enters the map when its check loses the timeout race and leaves it when that `stat` settles,
whichever way. While present, checks under it answer `unreachable` without calling `IFileSystem`.
While the map is full, a check under a **network (UNC)** root not in it also answers `unreachable`
at once rather than risking a third stuck thread. A local drive root (`C:\`) is never gated by a full
map — it is stat-ed as usual — and a root that answers normally never enters it, so a healthy local
drive is never gated.

`FileLinkResolverDeps` gains `readLinkSettings: () => EditorLinkSettings`, on the
`readPreviewSettings` pattern, so the timeout is read per check (SC-008, amended).

---

## 14. Amendment 2026-09-18, second round — logical lines, marks, tokens, flavours

### 14.1 The terminal provider reads logical lines (FR-130 – FR-132)

```ts
// ui/src/renderer/terminal/file-link-provider.ts — the slice of xterm it reads grows by one field
export interface LinkProviderTerminal {
  readonly buffer: { readonly active: {
    getLine(index: number): { translateToString(trimRight?: boolean): string; readonly isWrapped: boolean } | undefined;
  } };
}

/** One logical line: its first buffer row, and each row's text in order. */
interface LogicalLine { readonly firstRow: number; readonly rows: readonly string[] }
```

A span at offset `o` in the joined text maps to `(x, y)` by walking `rows` lengths. `ProvidedLink.range`
keeps xterm's 1-based inclusive shape; `start.y` and `end.y` may now differ. `HoveredLink` is
unchanged — it names the target, not the rows.

### 14.2 At-rest marks and the idle scan (FR-136, FR-137)

```ts
// ui/src/renderer/terminal/link-idle-scan.ts
export function createLinkIdleScan(deps: {
  readonly onWriteQuiet: (listener: () => void, quietMs: number) => () => void; // write-quiet signal, never the data
  readonly viewportRows: () => { readonly top: number; readonly bottom: number };
  readonly scanRow: (bufferRow: number) => void;   // the provider's own ask, cache-backed
}): { dispose(): void };

// ui/src/renderer/terminal/link-marks.ts — one decoration per row a link occupies
export function syncLinkMarks(links: readonly ProvidedLink[], state: 'rest' | 'hover'): void;
```

`LINK_IDLE_SCAN_MS` sits in `core/src/links/limits.ts` beside `LINK_CACHE_TTL_MS` and
`MAX_LINK_CANDIDATES_PER_LINE`.

### 14.3 Theme tokens (FR-138)

| Token | Parent when unset | Area | Used by |
|---|---|---|---|
| `linkUnderline` | `accent` | General | at-rest underline, both panel types |
| `linkUnderlineHover` | `linkUnderline` | General | hover underline, both panel types |

Published as `--throng-colour-linkUnderline` / `--throng-colour-linkUnderlineHover`, on the existing
`tokens.css` pattern. Adding tokens triggers the `SHIPPED_DEFAULTS_VERSION` rule this plan
previously avoided (T182).

### 14.4 A terminal's link base directory (FR-142 – FR-144)

```ts
// the site a terminal panel judges links against (TerminalLinkSite, terminal-link-activation.ts)
baseDirectory = flavourReportsDirectory(flavourId, settings.terminals.shellIntegration)
  ? cwdStore.get(panelId)      // observed (cmd) or reported via OSC 9;9 (pwsh, windows-powershell, git-bash)
  : undefined;                 // never the stale launch directory; R5 then tries the project root alone
```

**Caution — a user-defined WSL flavour does NOT take the `undefined` branch today.**
`flavourReportsDirectory` answers `true` for any flavour absent from both integration maps (it
assumes such a shell moves its real directory, as `cmd` does), and `wsl.exe` does not. FR-144
therefore needs one more input: a platform answer to "is this flavour WSL?" (the shell detection
already distinguishes WSL's `System32\bash.exe`), consulted for the **link base only**:

```ts
baseDirectory = flavourReportsDirectory(id, integration) && !platform.isWslFlavour(flavour)
  ? cwdStore.get(panelId) : undefined;
```

The name and home of that platform answer are settled in T189; 025's own callers of
`flavourReportsDirectory` are not changed by 045.

---

## 15. Amendment 2026-09-18, third round — extended readings, the WSL flag, dead hyperlinks, D4

Source: the corpus probe ([research.md](./research.md) O11); FR-150 – FR-154, D3, D4. Rules are in
[contracts/link-resolution.md](./contracts/link-resolution.md) §8 and
[contracts/platform-ports.md](./contracts/platform-ports.md) §6.

### 15.1 Extended readings — `core/src/links/detect.ts`, `limits.ts` (FR-150)

`LinkCandidate` does **not** change shape. An extended reading is simply another candidate, emitted
before the unextended one, exactly as §1's two position readings are; `text`, `start` and `end`
describe that reading, so the underline covers only the reading that resolves.

```ts
// core/src/links/limits.ts — beside LINK_CACHE_TTL_MS, MAX_LINK_CANDIDATES_PER_LINE, LINK_IDLE_SCAN_MS
/** FR-150. How many whitespace-separated words an anchored token may be extended by. */
export const MAX_PATH_SPACE_WORDS: number;
```

§1's grammar table gains a row:

| Rule | FR |
|---|---|
| an **anchored** token (drive, UNC, leading `/`, `~/`, `./`, `../`, `file:`, `FileSystem::`) also yields readings extended across single spaces, longest first, up to `MAX_PATH_SPACE_WORDS` words; never into another anchored word, a web span, a quote or an unbalanced bracket; a bare word never extends | FR-150 |

### 15.2 The resolution context and request gain the WSL flag (FR-151, FR-152)

```ts
// core/src/links/resolve.ts
export interface LinkResolutionContext {
  readonly baseDirectory?: string;
  readonly projectRoot: string | null;
  readonly pathForms: IPathForms;           // gains fromMountTable, qualifyRooted,
                                            // fileUrlLocalPath, loopbackFromFileUrl (platform-ports §6.1)
  /** FR-151. A WSL terminal: skip Git's mount table and the platform reading. */
  readonly wslFlavour?: true;
}

// core/src/links/types.ts — §2's request, one field added
export interface LinkResolutionRequest {
  // … text, kind, baseDirectory, panelId, originProjectId (§2) …
  /** FR-151. Set by a terminal whose flavour the platform identifies as WSL. Can only narrow. */
  readonly wslFlavour?: true;
}
```

`FileLinkResolver` copies `req.wslFlavour` into the context; the whitelist rule is
[contracts/settings-and-environment.md](./contracts/settings-and-environment.md) §7.1 (I7). The
editor never sets it. `WindowsPathForms` gains a constructor collaborator — the Git install root, from
shell detection — and caches the mount table it reads.

### 15.3 A dead hyperlink's hover state — `ui/src/renderer/terminal/` (FR-154)

§8's `HoveredLink` does **not** gain a "dead" arm. A dead OSC 8 target never becomes a `HoveredLink`
at all — `hoveredLink` stays `null` over it, which is what makes G6 (a Ctrl+click reaches the program)
fall out of `keepsClickFromProgram` unchanged. The judgement is made where the OSC 8 hover arrives
(`use-terminal.ts`'s `linkHandler.hover`): `classifyTerminalLinkTarget` for the scheme, then
`peekLink` for a `file:` target — only `{ ok: true }` sets `hoveredLink` or draws a mark.

*Superseded by this section:* §8's closing sentence, "The one visible cost is that an inert scheme
now draws xterm's hover underline". That cost is withdrawn (FR-154); `allowNonHttpProtocols` stays on.

### 15.4 The app's shell integration (D4)

```ts
// ui/src/main — the composition's construction, replacing `new ElectronShellIntegration(shell)`
new ElectronShellIntegration(shell, undefined /* the default on-disk stat */, {
  launcher: new WindowsDeElevatedLauncher(/* … */),
  isElevated: () => new WindowsElevation().isElevated(),
});
```

`DeElevationOptions` (`electron-shell-integration.ts:42-46`) is unchanged; what changes is that the app
supplies it. The shape of any factory T218 extracts to make this testable is T218's to choose.

### 15.5 Corrections to earlier sections found while amending (no behaviour change)

These sections describe states later amendments changed, and were not marked. Each is corrected here
rather than edited in place:

- **Preamble, "no `SHIPPED_DEFAULTS_VERSION` bump (… no theme token …)"** and **§12, "no new icon or
  colour token"** — superseded by §14.3: the second round adds two theme tokens and T182 bumps the
  version.
- **§5's port table** lists `IExecutableExtensions` with `isExecutable` only; it has two members since
  T130 (`executableExtensions` too — platform-ports §2), and `IPathForms` has eight after §15.2.
- **§13.2, "the `WebLinksAddon` is loaded with `WEB_URL_REGEX`"** — superseded by the second round:
  T177 unloads `WebLinksAddon` and throng's own provider serves web spans from `scanLinkLine`
  ([plan.md](./plan.md) Complexity Tracking, second round). §13.2's sentence described the step
  before that one.
- **§6's `LinkActionOutcome`** reads `'gone' | 'refused'`; §13.4 added `'unreachable'`.

---

## 16. Amendment 2026-09-19, round four — classes, settings, the hint, the Link menu

Nothing above is rewritten. §14.2's idle scan, §13's renderer cache and §15.1's extended readings are
**superseded** by §16.1 and §16.5 ([plan.md](./plan.md) round four, *What is removed*).

### 16.1 Detection — `core/src/links/detect.ts`, `known-extensions.ts`

```ts
export const KNOWN_FILE_EXTENSIONS: ReadonlySet<string>;      // lower-case, no dot (the RED test's oracle)
export interface DetectOptions { readonly knownExtensions?: ReadonlySet<string>; }
export function detectPathSpans(line: string, options?: DetectOptions): string[];  // the test's API
export interface KnownExtensionEdits { readonly added: readonly string[]; readonly removed: readonly string[]; }
export function resolveKnownExtensions(shipped: ReadonlySet<string>, edits: KnownExtensionEdits): ReadonlySet<string>;
```

`resolveKnownExtensions`: normalise each entry (trim, lower-case, strip one leading `.`, drop empties);
`removed` containing `*` removes every shipped entry; result `(shipped ∪ added) − removed`. Pure; unit.

### 16.2 Resource class — `core/src/links/resource-class.ts`

```ts
export type ResourceClass = 'web' | 'loopback' | 'unc' | 'onDevice' | 'protocol';
export function resourceClass(target: string, allowlist: ReadonlySet<string>, refused: ReadonlySet<string>): ResourceClass | null;
```

`null` = not a link (refused, not allowlisted, empty, malformed). Refused is applied after the allowlist.

### 16.3 Sanitising — `core/src/links/sanitise.ts`

```ts
export type Sanitised = { readonly ok: true; readonly value: string } | { readonly ok: false; readonly why: 'control' | 'nul' | 'malformed' };
export function sanitiseLinkTarget(raw: string): Sanitised;
```

### 16.4 Settings — `core/src/config/app-settings.ts` (`links` block)

| Leaf | Type | Default | Control |
|---|---|---|---|
| `editor.links.protocolAllowlist` | `string[]` | `['mailto','tel','slack']` | `array` / `text`, clearable |
| `editor.links.knownFileExtensions.added` | `string[]` | `[]` | `array` / `text`, clearable |
| `editor.links.knownFileExtensions.removed` | `string[]` | `[]` | `array` / `text`, clearable |

Tolerant parse: a non-array leaf falls back to its default; non-string items are dropped. Retired leaves:
none. `SHIPPED_DEFAULTS_VERSION` is not moved by these (tolerant parse fills them).

*Superseded 2026-09-20 (round five) by §17.1: the two `knownFileExtensions` rows become one leaf holding
the extensions themselves, with the old shape migrated on read; the allowlist row is unchanged, and
`terminals.linkHoverDelayMs` becomes a retired leaf (§17.4). `SHIPPED_DEFAULTS_VERSION` is still not
moved, for the same reason stated here.*

### 16.5 Terminal marks — `ui/src/renderer/terminal/link-view-marks.ts`

```ts
export interface LinkViewMarksDeps {
  readonly onRender: (listener: (rows: { start: number; end: number }) => void) => () => void;
  readonly onBufferChange: (listener: () => void) => () => void;
  readonly logicalLinesInView: () => readonly LogicalLine[];      // text + cell map, from §14.1
  readonly scan: (text: string) => readonly LinkSpan[];            // scanLinkLine with current options
  readonly draw: (marks: readonly MarkedLink[]) => void;           // link-marks.ts
  readonly clear: () => void;
  readonly now: () => number; readonly schedule: (fn: () => void, ms: number) => () => void;
}
```

State: `idle → pending(trailing) → idle`; a buffer change runs `clear` then an immediate pass.

### 16.6 The link hint — `ui/src/renderer/links/link-hint-store.ts`

```ts
export interface LinkHintState { readonly text: string; readonly anchor: { readonly right: number; readonly bottom: number }; readonly id: number; }
export function showLinkHint(text: string, anchor: { right: number; bottom: number }): void;  // replaces any current hint
export function hideLinkHint(): void;
```

Transitions: `none —show→ shown —(LINK_HINT_MS | Ctrl down | link Ctrl+click | show | scroll | blur)→ none`.
Theme tokens: `linkHintBackground`, `linkHintText`, `linkHintBorder` (descriptors; parents
`notificationBackground`/`foreground`/`border` or the nearest existing surface tokens).

### 16.7 The Link menu — `core/src/links/menu.ts`

```ts
export type LinkMenuItemId = 'openLink' | 'openInNew' | 'openInActive' | 'openInEditor' | 'openPreview'
  | 'osExplorer' | 'osDefaultProgram' | 'openProgram' | 'copyLink';
export interface LinkMenuContext {
  readonly cls: ResourceClass | 'anchor';
  readonly resolution: { readonly kind: 'file' | 'folder'; readonly inProject: boolean; readonly executable: boolean;
                         readonly preview: 'enabled' | 'disabled' | 'none' } | null;   // null = unresolved
  readonly openEditors: readonly { readonly id: string; readonly name: string }[];
  readonly chord?: string;
}
export function buildLinkMenu(ctx: LinkMenuContext): readonly LinkMenuItem[];   // FR-170's order
```

`FileLinkMenuItem`'s `'copyLinkAddress'` id is superseded by `'copyLink'` (FR-175).

### 16.8 Outcomes — `core/src/links/types.ts`

`LinkActionOutcome`'s refused arm gains `reason?: string` (the OS's words, T229). `LinkResolution` gains
nothing; `'unreachable'` (§13.4) now arises only at click and menu-open.

### 16.9 Corrections after analysis *(2026-09-19; §16.2 and §16.5 kept, amended here)*

- §16.2: `refused` is core's half **∪** the platform's, as fetched by the renderer (research R34), and
  never contains `file`; `file:` targets classify as `onDevice` before refusal is applied.
- §16.5: `LinkViewMarksDeps` gains
  `readonly oscLinksInView: () => readonly { readonly range: LinkRange; readonly uri: string }[];` — xterm's
  OSC 8 ranges for the rows in view; each is kept when `resourceClass(uri, …)` is non-null (FR-163).
- New: `ui/src/renderer/links/refused-schemes-client.ts` — `refusedSchemes(): ReadonlySet<string>`
  (core's half until main answers, then the union).

### 16.10 Corrections after analysis, second pass *(2026-09-19)*

- §16.1: `detectPathCandidates(line, options)` implements FR-173 / FR-179 and returns `LinkCandidate`s;
  `detectPathSpans` maps them to their trimmed texts. `MAX_PATH_SPACE_WORDS` caps the whole span.
- §16.8: the refused arm gains **`osReason?: string`** (not `reason`, which is the arm's discriminant).
  Contracts `platform-ports.md` §7.2's `{ ok: false, reason }` reads `{ ok: false, osReason }`.
- Resolution outcome at a follow (spec FR-158a, FR-160's note): `open-in-throng` | `reveal-folder` (as
  itself) | `reveal-file` (parent, selected) | `reveal-parent-unchecked` | `not-found-notice`.

### 16.11 Corrections after analysis, third pass *(2026-09-19)*

- §16.8's "`LinkResolution` gains nothing" stands for the IPC shape: the follow's outcome names in
  §16.10 are renderer/main vocabulary; `not-found-notice` travels as the existing `gone`.
- `linkHoverText(destination, chord, scheme?)` where `destination` is `'activeEditor' | 'newEditor' |
  'preview' | 'heading' | 'osExplorer' | 'browser' | 'handler' | 'stays'`.
- `LinkMenuContext` gains `readonly openLink: () => void` — the surface's own Ctrl+click action.
- `ScanOptions` = `{ knownExtensions?, allowlist?, refused? }`.

### 16.12 Corrections after analysis, fourth pass *(2026-09-19)*

- §16.10's outcomes: `reveal-folder` applies to a folder **anywhere**, in the project included (FR-160a);
  add `unreachable-notice` (an in-project first reading timed out — travels as the existing
  `unreachable`, FR-124).
- §16.7: `LinkMenuContext` gains
  `readonly applicable: { readonly inProjectByName: boolean; readonly previewByExtension: 'enabled' | 'disabled' | 'none'; readonly executableByExtension: boolean }`;
  with `resolution: null` the applicable target items are emitted **disabled** (FR-170a).
- §16.6: the hint hides on a **user** scroll only (FR-165d's note), not on output scrolling.
- `core/src/links/protocol-uri.ts`: `detectProtocolSpans(line, allowlist, refused)` per FR-159a.
  *(Round five: the same module gains `detectBareEmailSpans` / `bareEmailsAreLinks` — §17.7. A bare
  address's `uri` is **not** its own text, which nothing else in this document does.)*
- `classifyTerminalLinkTarget` (`core/src/links/classify.ts`) is retired into `resourceClass` (plan,
  fourth pass).

### 16.13 Corrections after analysis, fifth pass *(2026-09-19)*

- §16.6's token parents: `linkHintBackground` → `surfaceActive`, `linkHintText` → `text`,
  `linkHintBorder` → `border` (all existing `TOKEN_PARENT` targets' peers in `core/src/config/theme.ts`).
- The menu-open reply for an unresolved link (`gone` / `unreachable`) gains
  `executableByExtension: boolean` and `previewByExtension: 'enabled' | 'disabled' | 'none'`, feeding
  §16.12's `applicable` (FR-170a, FR-170b).

### 16.14 Corrections after analysis, sixth pass *(2026-09-19)*

- §16.13's "`gone` / `unreachable`" names the wrong type. The menu-open reply is `LinkResolution`; its
  failure arm `{ ok: false; reason?: 'unreachable' }` (absent `reason` = not found) gains
  `executableByExtension: boolean` and `previewByExtension: 'enabled' | 'disabled' | 'none'`. `gone`
  remains `LinkActionOutcome`'s, for a follow.
- §16.8's and §16.11's "`LinkResolution` gains nothing" is superseded for that failure arm only.

### 16.15 Corrections after analysis, seventh pass *(2026-09-19)*

- "The refused arm" in §16.8 / §16.10 / plan pass 2 / T260: `LinkActionOutcome` has **one** failure arm,
  `{ ok: false; reason: 'gone' | 'refused' | 'unreachable'; path }`. It gains an optional
  `osReason?: string`, set only when `reason` is `'refused'` and the OS gave one. No arm is split out.
- `oscLinksInView()` (§16.9) passes each OSC 8 target through `sanitiseLinkTarget` before
  `resourceClass`, so a crafted OSC 8 target is never drawn clickable (FR-156's render-side half).

### 16.16 Corrections after analysis, eighth pass *(2026-09-19)*

- §16.12's `applicable` gains `readonly folderByGrammar: boolean` — true for a path ending in a separator
  or equal to the project root (FR-168b, FR-170c); when true, Open In ▸ and Open Preview are not drawn.

### 16.17 Corrections after analysis, ninth pass *(2026-09-19)*

- §16.11's "`not-found-notice` travels as the existing `gone`" is superseded: a follow awaits
  `throng:links:resolve`; not-found is its failure arm with no `reason`, did-not-answer is
  `reason: 'unreachable'`; `gone` stays `LinkActionOutcome`'s, returned only by `throng:links:open` when a
  file vanished between the resolve and the open.
- `HoveredLink` drops its resolved `link` field; it carries the grammar's `LinkResolutionRequest` and
  position only.
- §16.4: allowlist entries are normalised per spec FR-159b (trim, lower-case, one trailing `:` / `://`
  removed, empties ignored).
- §16.3: `sanitiseLinkTarget` never refuses shell metacharacters in a path (FR-156b).

### 16.18 Corrections after analysis, tenth pass *(2026-09-19)*

- New reply type `LinkFollowOutcome` (`core/src/links/types.ts`), returned by `throng:links:follow`:
  `{ kind: 'openInThrong'; link: ResolvedLink } | { kind: 'revealed' } | { kind: 'notFound'; path: string }
  | { kind: 'unreachable'; path: string } | { kind: 'refused'; path: string; osReason?: string }` — §16.10's
  outcomes as data. One bounded pass per follow (FR-161).

### 16.19 Corrections after analysis, eleventh pass *(2026-09-19)*

- §16.17's first bullet ("a follow awaits `throng:links:resolve`") is superseded for follows by §16.18
  (`throng:links:follow`); it still holds for the Link menu's opening.
- §13.5's "expiry **is** FR-122's back-off" is superseded: the renderer cache is gone, and the volume-root
  state gains `leftAloneUntil: number` (ms epoch), set to settle-time + `LINK_ROOT_BACKOFF_MS` (spec FR-122a).

### 16.20 Corrections after analysis, twelfth pass *(2026-09-19)*

- §16.19's `leftAloneUntil` lives in its own `Map<root, number>`, apart from §13.5's stuck-root map, and
  does not count toward `MAX_TIMED_OUT_LINK_CHECKS`; an entry is dropped once its time has passed.
- The renderer exposure for the allowlisted-scheme channels is `window.throng.linkUri`, not
  `window.throng.links` (whose members stay `resolve`, `reveal`, `open`, plus `follow`).

### 16.21 Corrections after analysis, fourteenth pass *(2026-09-19)*

- `LinkFollowOutcome` (§16.18) gains two arms: `{ kind: 'rejected' }` — a request failing I1's whitelist
  or root derivation; the renderer raises nothing (no user gesture can build one) and logs a diagnostic —
  and `{ kind: 'failed'; path: string; message: string }` — the service threw; one failure notice names
  the path (the failure-cause model's wording).
- §16.7 / §16.12: `LinkMenuContext.resolution` is `ResolvedTarget | null | 'pending'` — `'pending'` before
  main answers (FR-170c: renderer-known rows only, rows 5/6 absent), `null` unresolved (FR-170a: applicable
  rows disabled), a value resolved. `buildLinkMenu` alone decides every state, so surfaces never filter.

### 16.22 Corrections after analysis, fifteenth pass *(2026-09-19)*

- §16.21's `rejected` answers a request failing I1's **whitelist** only (text, kind, panelId — the checks
  `link-ipc.ts` `sanitise()` makes) or refused by main's `sanitiseLinkTarget`. An unknown or absent
  `originProjectId` is **not** a refusal: its root is `null` and every target is judged out-of-project
  (I2 / M3), so the follow reveals as usual.
- `failed` on `follow` differs from `reveal` / `open`, which answer `{ ok: false, reason: 'refused' }` when
  the service throws: intended — `follow` has its own outcome type, and `failed` carries the message the
  failure-cause model words, where `refused` is reserved for the OS declining (FR-036).
- `ResolvedTarget` (§16.21) names §16.7's inline `resolution` object literal. A folder by grammar
  (FR-158d) is given the synthesised value `{ kind: 'folder', inProject, executable: false, preview:
  'none' }` — never `null` — so FR-170a never draws a disabled row 5 on a folder; web, loopback, protocol
  and anchor links are decided by their class alone and carry `resolution: null` with every target row
  absent.

---

## 17. Amendment 2026-09-20, round five — one hover, one extension list, the cwd predicate

Nothing above is rewritten. §16.1's `DetectOptions`, §16.4's settings table and §16.11's `ScanOptions`
are **superseded** by §17.1 – §17.3; §9's settings table gains one retirement (§17.4).

### 17.1 Settings — `core/src/config/app-settings.ts` (`links` block), FR-182, FR-181

| Leaf | Type | Default | Control |
|---|---|---|---|
| `editor.links.knownFileExtensions` | `string[]` | `[...KNOWN_FILE_EXTENSIONS]` — the shipped list itself | `array` / `text`, clearable |

This **replaces** §16.4's two leaves, `…knownFileExtensions.added` and `…knownFileExtensions.removed`,
and the `KnownExtensionEditSettings` interface that typed them (deleted, with its re-export).

```ts
// app-settings.ts — the whole migration, on read (019 FR-023's mechanism)
function knownFileExtensionsSetting(v: unknown, fallback: readonly string[]): string[];
//  an array           → kept as typed; `[]` is a deliberate "no extension", never a fallback trigger
//  { added?, removed? } → [...resolveKnownExtensions(KNOWN_FILE_EXTENSIONS, edits)]   (round four's shape)
//  anything else      → [...fallback]
```

`cloneLinks` copies the array (`[...l.knownFileExtensions]`) — a leaf missing from the clone is silently
dropped on write, §9's standing trap. `editor.links.existenceCheckTimeoutMs` keeps its **key**, default,
bounds and control; only its label (**Link resolution timeout**) and description change (FR-181).

### 17.2 The accessor — `core/src/links/known-extensions.ts` (FR-182a, FR-182b)

```ts
export function knownFileExtensionsSet(entries: readonly string[]): ReadonlySet<string>;
```

Trims, lower-cases and strips one leading dot per entry, dropping empties — the same `normaliseExtension`
`resolveKnownExtensions` uses, and the deliberate twin of `protocolAllowlistSet` (§16.12): **one accessor
per list setting**. Every reader goes through it — `link-scan-options.ts` for both surfaces and
`FileLinkResolver.knownExtensions()` in main — so one setting cannot widen one scan and not another.
`resolveKnownExtensions` and `REMOVE_ALL_SHIPPED` survive **for the migration alone**.

`linkScanKey` (the scan-options identity the view pass compares) is
`JSON.stringify([links.protocolAllowlist, links.knownFileExtensions])` — two members, not three.

### 17.3 Detection is told one thing — `core/src/links/detect.ts`, `scan-line.ts` (FR-183)

```ts
export interface DetectOptions {
  readonly knownExtensions?: ReadonlySet<string>;
  readonly namesKnownDirectory?: (text: string) => boolean;   // round five
}

// ScanOptions = { knownExtensions?, allowlist?, refused?, namesKnownDirectory? }   (supersedes §16.11)
```

`scanAcrossSpaces` gains the predicate as its last parameter and one local, `directoryEnd`. Its loop is
unchanged except that a word which would have ended the scan now `break`s rather than returning `null`,
so a landing already found survives; a **terminator** (FR-173d / FR-173e) still returns at once, and
otherwise the **furthest** qualifying landing is returned — "longest landing wins" (FR-183b).
`MAX_PATH_SPACE_WORDS` still caps the whole span.

The predicate is the renderer's, `namesTerminalDirectory(cwd)` in
`ui/src/renderer/terminal/terminal-link-activation.ts` (FR-183d): both sides are folded through
`absolutePathByName` (`ui/src/renderer/links/path-by-name.ts`), separators collapsed, trailing separators
dropped, lower-cased; the test is *candidate equals target, or target starts with candidate followed by
`/`* — equality or an ancestor **at a separator boundary**, the trailing separator being what stops
`D:\a\test` extending into `D:\a\tester` (FR-183c). It is memoised on the cwd string, because it is
built on the render path. `undefined` cwd → `undefined` predicate → the case table, exactly (FR-183e).

Threaded by `file-link-provider.ts` (from `site.baseDirectory`) and `link-view-marks.ts` (from a new
`cwd?: () => string | undefined` reader on the `terminalViewScan` bag), both fed by
`terminalLinkBaseDirectory` over `cwd-store.ts` — which already gates on whether the flavour reports a
directory (FR-023, FR-144). Main is unchanged: `readingsOf` already falls back to the text verbatim.

### 17.4 The hover, and one retirement (FR-169a, FR-169b)

- `LinkMarksDeps.host` widens to carry `title?: string`; `LinkMarks.sync` takes a fourth argument,
  `hoverTitle?: string | null`, and writes the host's `title` while a link is hovered, clearing it on
  leave and on `dispose`. The host is the `.terminal-panel` element.
- One string feeds both the title and the status-bar readout: `hoveredLinkReadoutText` in
  `terminal/hovered-link.ts` (FR-169a(ii)). The editor's title is `linkFirstReadingByName` (a web link's
  is its uri); the Markdown preview's is the `displayTarget` its readout already carries.
- **Deleted**: the `.terminal-link-tip` element, its CSS block, `LINK_TIP_LEAVE_GRACE_MS`, the two tip
  timers and the delay reader; and the `.terminal-link-tip` entry in the floating-surfaces registry,
  which now has no element of throng's to have an opinion about.
- **Retired setting** (§9's table): `terminals.linkHoverDelayMs` — leaf, default, parse line, clone
  field, descriptor and its `parseAppSettings` clamp, all gone; a persisted value is dropped on read and
  absent after the next write (FR-169b).

### 17.5 The switches (FR-180)

The switch for a panel type is read at four seams and gates **every** kind: `linkHitsBetween`
(editor — an early `return []`), `linksOnLine` (terminal provider — likewise), `terminalViewScan`
(terminal marks — a shared `NOTHING_SCANNED` constant), and the three OSC 8 closures in
`use-terminal.ts` (`setHoveredUri`, `openTerminalLink`, `oscLinksInView`) over one `linksEnabled()`
reader. A kind added later that passes none of these escapes the switch (FR-180a).

### 17.6 The affordance (FR-184)

No token is added. Terminal and editor resting underlines are
`color-mix(in srgb, var(--throng-colour-linkUnderline) 45%, transparent)` — `border-bottom` in
`terminal.css`, `textDecorationColor` in the editor's `linkTheme` — and solid `linkUnderlineHover` on
hover. The Markdown preview may name only `editorFg`, `editorBg`, `syntax*`, `border` and `accent` and
no colour function at all (`preview-css-tokens.test.ts`, SC-005), so it uses `border` at rest and
`syntaxFunction` on hover. `SHIPPED_DEFAULTS_VERSION` stays **11** (FR-184b).

### 17.7 A bare email address — `core/src/links/protocol-uri.ts`, `scan-line.ts` (FR-185, FR-186, D7)

```ts
export function detectBareEmailSpans(line: string, claimed: readonly Span[]): ProtocolLinkSpan[];
export function bareEmailsAreLinks(allowlist: ReadonlySet<string>, refused: ReadonlySet<string>): boolean;
```

**`ProtocolLinkSpan.uri` is not always `line.slice(start, end)`, and this is the span that breaks it.**
§13.2's `WebLinkSpan` and §16.12's written protocol spans both carry their own text as their target, so
a reader may reasonably assume the two are equal — they are not, for a bare address: the **range** is
the address as written, and the **uri** is `mailto:` plus that address (FR-185a). It is the shape an
OSC 8 hyperlink has had since §8: the text a reader sees and the target a click follows are two
strings. Anything deriving a target by re-slicing the line is wrong here; read `uri`.

**Claiming and publishing are separate in `scanLinkLine` (FR-186).** The order is: web spans, then
written protocol spans (allowlist-gated, minus any overlapping a web span), then bare addresses, which
skip any range already claimed. Then:

- `protocol` (**published**) = written spans + bare addresses **only when** `bareEmailsAreLinks`, sorted
  by start;
- `claimed` (**passed to the path grammar as taken**) = web + written + **every** bare address, sorted
  by start — whatever the allowlist says.

`detectBareEmailSpans` is therefore deliberately **ungated**: gating it made the address a path again
the moment `mailto` was removed. This is the same asymmetry the scan already had for a refused scheme,
now stated as a rule rather than left as a property of one function.

Grammar (FR-185b): local part `[A-Za-z0-9._%+-]+` — note the absence of `/` and `\`, which is what keeps
a path out — `@`, then one or more dot-terminated labels and a final label of letters only; a match is
discarded when the character before it is a word character, so `D:\p\a.b@c.com\x.ts` and `@scope/pkg`
never match. Pure and total, like every other detector here (contract rule D8).

### 17.8 What a readout may claim — `ui/src/renderer/links/path-by-name.ts` (FR-187, defect D8)

`linkFirstReadingByName` is the one function behind the status-bar readout (§16.11) **and** the hover
title (§17.4), so its answer is what both publish. Its order, with step 3 changed:

| Step | Text | Reads as |
|---|---|---|
| 1 | an absolute spelling, drive forms included | itself (R2, FR-176) |
| 2 | a home form (`~/…`) | as written (FR-025 is `IPathForms`') |
| 3 | **any other rooted path** | **as written** — *was* the project root (R6 / FR-024) |
| 4 | relative | joined onto the base directory, else the project root (R5 / R10) |
| 5 | nothing to resolve against | as written |

**Step 3 names no location because it cannot know one.** `resolveCandidate` tries the project root
first and falls through to `IPathForms.fromMountTable`; which reading wins is a fact about the disk,
and a hover resolves nothing (FR-155). So the old step 3 published a **candidate** as a
**destination** — `/tmp` read `<project>\tmp` and opened the temp folder. By name the class cannot be
narrowed: `/tmp` and `/help` are one shape, and the renderer has no mount-table port by design
(Principle II).

`clickTargetByName` — which words the plain-click **hint** — still sends the same text down its
relative branch and answers `editor`. That is the **known gap** recorded under FR-187, reported and
deliberately not fixed here.
