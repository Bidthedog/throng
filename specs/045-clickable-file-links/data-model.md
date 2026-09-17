# Phase 1 Data Model: Clickable File Links

**Feature**: 045 | **Date**: 2026-09-18 | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md)

Types are grouped by **where they live**, because placement is the load-bearing decision (R3, R6):
the grammar and every decision are pure in `packages/core`; the one authority that touches the
filesystem, the home folder and `PATHEXT` is in `packages/ui/src/main`; views are in
`packages/ui/src/renderer`.

Nothing here is persisted. No SQLite migration, no `LAYOUT_SCHEMA_VERSION` change, no
`SHIPPED_DEFAULTS_VERSION` bump (three settings leaves, no theme token — `shipped-defaults.ts:490`
clones `DEFAULT_APP_SETTINGS`, so a new leaf ships without a bump).

Channel payloads are in [contracts/link-ipc.md](./contracts/link-ipc.md).

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
  /** The panel the link was seen in. Main derives the OWNING PROJECT from it — never the renderer. */
  readonly panelId: string;
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
    readonly projectRootFor: (panelId: string) => string | null;   // the authoritative() precedent
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

export function peekLink(key: CacheKey): LinkResolution | undefined;   // sync; undefined = not yet known
export function requestLink(req: LinkResolutionRequest): void;         // fire-and-forget; fills the cache
export function invalidateLinksUnder(absPath: string): void;           // a watcher event arrived
export function useLinkResolution(req: LinkResolutionRequest | null): LinkResolution | undefined;
```

- **`peekLink` returning `undefined` is FR-071's "treated as not a link until it answers"** — the
  link provider returns no link and the decoration is not drawn.
- **FR-070's "a cached answer MUST NOT outlive a change to that location"**: entries are dropped by
  `invalidateLinksUnder` on the existing file-watcher broadcast, and an entry older than
  `LINK_CACHE_TTL_MS` is re-requested on the next hover. The TTL is a named constant, not a setting
  (Complexity Tracking).
- The cache is **view state**, per window, holding no content-shaping state (Principle XI).

---

## 8. The hovered link — `ui/src/renderer/terminal/use-terminal.ts` (R4)

`hoveredLink` changes type. This is the whole of FR-043 for file links.

```ts
// was: let hoveredLink: string | null
type HoveredLink =
  | { readonly kind: 'web'; readonly uri: string }
  | { readonly kind: 'file'; readonly link: ResolvedLink; readonly request: LinkResolutionRequest };

let hoveredLink: HoveredLink | null = null;
```

| Reader | Line today | Change |
|---|---|---|
| `keepLinkClickFromProgram` | `:844` | none — `hoveredLink !== null` now also covers file links, which is the fix |
| the tooltip text | `:311` | wording by kind (R10) |
| `setHovered`'s `^https?://` filter | `:369` | replaced by `classifyTerminalLinkTarget` (R5) |
| `getHoveredLink()` → `terminalLinkTarget` | `terminal-panel.tsx:268` | returns the `HoveredLink`, so the menu can compose FR-031 |

---

## 9. Settings — `core/src/config/app-settings.ts` (FR-060, FR-061, FR-080b)

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
