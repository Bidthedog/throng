# Data Model: Open and navigate

**Feature**: 033 | Phase 1 output

Entities, their fields, and the rules that constrain them. **Nothing here is a new persisted store.**
This feature adds two settings leaves, two key bindings, one theme icon token, and a body of derived
in-memory state — one piece of which (the file index) is large enough to be worth modelling carefully.

---

## 1. Settings (persisted — `settings.json`)

### 1.1 New leaves

Two, both toggles, both shipping **off** (FR-058).

| Key | Type | Default | Control | Group | Requirement |
|---|---|---|---|---|---|
| `editor.navigation.rememberQuickOpenQuery` | boolean | **false** | `toggle` | `Editor · Navigation` | FR-058, FR-060–FR-063 |
| `editor.navigation.rememberGotoLineNumber` | boolean | **false** | `toggle` | `Editor · Navigation` | FR-058, FR-060–FR-063 |

**Schema shape.** `EditorSettings` (`packages/core/src/config/app-settings.ts`) gains a nested
`navigation: EditorNavigationSettings`, giving three-level leaf keys. That depth is not new —
`panes.projects.maxWidth` is already three levels — and `leavesOfDeclared` walks to any depth, so
`settingsLeaves()` picks both up with no change to the completeness machinery.

**Group naming.** `Editor · Navigation` follows the shipped `Editor · Indentation` and
`Editor · Languages`. The `·` convention is formalised only on the theme side
(`THEME_AREA_GROUPS` / `parentArea`); on the settings side a group is the descriptor's `group` string
and sections render in **first-appearance order** in `settings-tab.tsx`, so the two descriptors must sit
adjacently in `SETTINGS_METADATA`, next to the other `Editor · …` groups.

**Parsing.** Both go through the tolerant per-section parser: an absent or non-boolean value falls back
to the shipped default, key by key. Neither declares a `min`/`max`, so 031's read-side bounds guard has
nothing to clamp and no migration exists or is needed.

### 1.2 Settings this feature reads and does not change

| Key | Read by | Why |
|---|---|---|
| `editor.openTarget` (`'lastActive' \| 'new'`) | Quick Open's default target and the target control's preselection | FR-009, FR-010. **No second notion of where a file lands** |
| `explorer.excludeGlobs` | the file index's walk and its rescans | FR-006 — one ignore mechanism, not two |
| `behaviour.submenuHoverMs` | the three-level Open In → Terminal → flavour path | FR-036; already the shared menu's dwell |

---

## 2. Key bindings (persisted — `keybindings.json`)

Two new members of the closed `ActionId` union, in a **new `navigate.` namespace**.

| Action | Default chord | `COMMAND_SCOPES` | Metadata group | Requirement |
|---|---|---|---|---|
| `navigate.quickOpen` | `Ctrl+Shift+T` | `EVERYWHERE` (`editor`, `terminal`, `explorer`) | `Navigate` | FR-002, FR-003 |
| `navigate.gotoLine` | `Ctrl+G` | `EDITOR_ONLY` | `Navigate` | FR-020, FR-025 |

**Why a new namespace rather than an existing one.** `file.*` is the obvious home for "open a file", and
it is the wrong one: `useExplorerKeybindings` accepts **only** `file.*` actions and dispatches them at
the explorer scope, so `file.quickOpen` would be claimed by the tree's handler. `view.*` is pane
toggles; `editor.*` is text editing. `navigate.*` matches the feature, matches the constitution's
**Navigate** menu section, and collides with nothing.

**Three edits beyond the two tables**, each of which is a silent failure if missed:

1. `packages/ui/src/renderer/app.tsx` — `navigate.quickOpen` must join the `HANDLED` allowlist, or the
   window-level capture listener resolves it and then ignores it.
2. `packages/ui/src/renderer/keybindings/scope.ts` — `isPanelScoped` must return **false** for
   `navigate.quickOpen` (it is a window command, like `zoom.*` / `view.*` / `tabs.openPicker`) and
   **true** for `navigate.gotoLine`.
3. `packages/ui/src/renderer/editor/commands.ts` — `navigate.gotoLine` must **not** enter the CodeMirror
   keymap. It is editor-scoped but it is not a text-editing command; it is dispatched by a window
   listener gated on the active pane, the way `editor.save` and `search.find` already are. Adding it to
   the keymap would `preventDefault` the chord inside the view and make the scope gate unreachable.

`chordCollisions` and `keybindings-metadata.test.ts` are the gates; `reset-completeness.test.ts` requires
each new descriptor to resolve to a shipped chord.

---

## 3. Project file index (in memory, UI-main)

The feature's one substantial new entity. **Never persisted** — it is a cache of the filesystem, and a
persisted cache of the filesystem is wrong from the first external change.

```ts
/** One indexed root. Held in UI-main, keyed by absolute root path, ref-counted by subscriber. */
interface RootIndex {
  readonly root: string;              // absolute, OS-form
  status: 'building' | 'ready';       // FR-015 — a modal opened early says so
  paths: string[];                    // root-relative POSIX, FILES only, sorted
  subscribers: Set<number>;           // webContents ids
  watch: Disposable | null;
  quietTimer: Timer | null;           // trailing reconcile
  burstStartedAt: number | null;      // the reconcile's own ceiling (R5)
}
```

| Field | Rule | Requirement |
|---|---|---|
| `root` | Exactly one project root. Every entry is expressed relative to it, so a path outside it cannot be represented | FR-005 |
| `paths` | **Files only.** Folders are not open targets, so indexing them would put unopenable rows in the list | Assumption 1 |
| `paths` | Excludes anything the project's exclusion rules exclude, evaluated by the **same** predicate the tree uses | FR-006, SC-003 |
| `paths` | A symlink is never followed out of the root; a symlinked directory is not descended into | FR-005, and the tree's shipped FR-037 rule |
| `status` | `'building'` from the first subscribe until the initial walk completes; `'ready'` thereafter, including during a rescan | FR-015 |
| lifetime | Created on first subscribe for a root, disposed (watch closed, array dropped) on last unsubscribe | — |
| sharing | Two windows on the **same** root share one `RootIndex`; a sub-workspace on a different root gets its own | FR-017 |

**Renderer-side mirror.** The renderer holds `{ status, paths }` for the one root its window is showing,
patched by deltas. It is view state: not persisted, discarded on project switch, rebuilt by subscribing.

### 3.1 The delta

```ts
interface FileIndexDelta { added: readonly string[]; removed: readonly string[]; }
function diffPaths(previous: readonly string[], next: readonly string[]): FileIndexDelta;  // pure, core
```

Computed in main against the snapshot it last **sent**, not the one it last built — so a delta is never
relative to a state the renderer never saw. An empty delta is not sent at all, which is what makes a
quiescent project cost nothing.

---

## 4. Picker entry (extended, not replaced)

`PickerEntry` is unchanged. Quick Open seeds it as:

| Field | Value | Requirement |
|---|---|---|
| `id` | the root-relative POSIX path — already unique within a root | — |
| `text` | the same path. Matching runs against the **full** path, so a query may name a directory | FR-007 |
| `label` | the same path, so the row shows it and the marks land on what the user can see | FR-007 |
| `meta` | *(unset)* | — |
| `isCurrent` | *(unset)* — "the file you are already in" is not a concept Quick Open needs | — |

`text === label` is deliberate: `picker.tsx` computes `matchSpans` against the **label**, so a label that
differed from the matched text would mark the wrong characters or nothing at all.

---

## 5. Menu section

```ts
export type MenuSection =
  | 'contextual' | 'content' | 'create' | 'destroy' | 'navigate' | 'viewState' | 'application';

export const MENU_SECTION_ORDER: readonly MenuSection[] = [
  'contextual', 'content', 'create', 'destroy', 'navigate', 'viewState', 'application',
];

/** Sections in constitutional order, empty ones dropped. The renderer joins them with dividers. */
export function groupBySection<T>(items: readonly T[], of: (item: T) => MenuSection): T[][];
```

The order is the constitution's (Principle VI, "One section vocabulary for every menu") and FR-047's,
which reproduce each other verbatim. It lives in `@throng/core` so no menu can hold a different opinion.

**The menu-item type changes shape**, which is how FR-049 stops being a convention:

```ts
export interface MenuAction {
  label: string;
  section: MenuSection;        // REQUIRED — an item with no section is a compile error
  onClick?: () => void;
  disabled?: boolean;
  icon?: string;
  shortcut?: string;
  submenu?: MenuAction[];
  testId?: string;
}
export type MenuItem = MenuAction | { separator: true };
```

Builders return `MenuAction[]`; they can no longer place a divider, because their return type has no
member that is one. `ContextMenu` derives the dividers per level — including inside every submenu — so
FR-050 ("only at a real section boundary; never at the start or end; none in a single-section menu")
falls out of `groupBySection` returning one group rather than being remembered by seven authors.

`separator` keeps its rendering exactly as today: `<li className="context-menu__separator"
role="separator" aria-hidden />`, no `testId`, and excluded from the keyboard's `enabled` array — which
is FR-051, already shipped and now covered by an assertion.

Per-menu, per-item adjudication is in [contracts/menu-sections.md](./contracts/menu-sections.md).

---

## 6. Remembered modal input (in memory, per window)

```ts
interface RememberedInput {
  quickOpenQuery: string | null;   // the last query that OPENED a file
  gotoLineNumber: number | null;   // the last number that was GONE TO
}
```

| Rule | Requirement |
|---|---|
| Lives in `packages/ui/src/renderer/navigate/navigation-store.ts`, for the running application only, per window | FR-062 |
| **Never written to disk** and never crosses a process boundary | FR-062 |
| Only an **accepted** value is recorded — a query abandoned with Escape is not | FR-061 |
| Discarded when its setting is turned **off**, so the modal cannot reopen carrying something just switched off | FR-063 |
| `quickOpenQuery` is additionally discarded when the **active project changes** — its candidate set was project-scoped | FR-062 |
| Surfaced only when its setting is on; otherwise the modal opens empty | FR-057 |
| When surfaced, the value is present and **fully selected**, and Quick Open shows its results rather than an empty list | FR-060 |

---

## 7. The one-modal slot

```ts
type NavigationModal =
  | { kind: 'quickOpen'; invokedFrom: { editorPanelId: string } | null }
  | { kind: 'gotoLine'; panelId: string }
  | null;
```

One slot, in the same store. Opening either while the other is open **replaces** it, so exactly one
modal is on screen and neither can be opened twice (FR-066).

`invokedFrom` is captured at open time and decides whether the target control is drawn at all
(FR-010, FR-011) — "the currently active editor" has no meaning when the chord came from a terminal or
the tree.

**Scope note, decided here because the spec is silent**: the slot governs the two **new** modals only.
The tab picker (031) keeps its own local `pickerOpen` state, and this feature does not coordinate with
it — bringing a third surface under the slot would change shipped behaviour outside this feature's
scope. Recorded so the omission is a decision rather than an oversight.

---

## 8. Terminal start directory (extended, not re-modelled)

A new **source**, not a new mechanism.

```ts
export type TerminalPanelConfig = {
  flavourId: string;
  flavourLabel?: string;
  shellArguments: string;
  startupCommand?: string;
  rememberCommand?: boolean;
  rememberDirectory?: boolean;
  runAsAdmin?: boolean;
  startDirectory?: string;   // NEW — absolute; set when the panel was created from a tree node
};
```

`startDirectory` is persisted with the panel so a restored panel restarts where it was created, and it
travels to main on the existing `AttachRequest`. The resolution order is
**`rememberedCwd ?? startDirectory ?? projectRoot`**, run through the shipped

```ts
resolveStartDirectory(root, requested, directoryExists): string
```

so containment (FR-032 — a path resolving outside the root is refused and the root is used instead) and
the fallback-with-a-reason (FR-034 — `fallbackToReport` surfaces `cwdFallback` on the attach envelope)
are inherited rather than re-implemented. The only change in `terminal-ipc.ts` is which value is passed
as `requested`.

**Precedence is a decision, stated**: a remembered cwd wins because it can only exist if the user turned
remembering on *and* the shell has since moved, which is the more recent fact. On first launch there is
no remembered cwd, so the tree node's directory applies — which is the case FR-031 is about.

---

## 9. Theme icon token

| Token | Default glyph | Where | Requirement |
|---|---|---|---|
| `icons.quickOpen` | a magnifier-over-document glyph | `THRONG_THEME.icons`, `THEME_TOKEN_COPY`, and the built-in icon pack's SVG set in `icon-pack-service.ts` | FR-018b |

`icon-tokens-exist.test.ts` fails on a static `<Icon token="…">` naming a token that is not in
`THRONG_THEME.icons`, and `no-inline-artwork.test.ts` fails on an inline SVG — so the themeable-icon
rule is enforced by the build, not by review.
