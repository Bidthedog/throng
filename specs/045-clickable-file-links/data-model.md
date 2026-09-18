# Phase 1 Data Model: Clickable File Links

**Feature**: 045 | **Date**: 2026-09-18 | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md)

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
  existenceCheckTimeoutMs: number;        // FR-120 — ships 2000, bounded 250–30000
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
While the map is full, a check under a root **not** in it also answers `unreachable` at once rather
than risking a third stuck thread; a root that answers normally never enters it, so a healthy local
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
