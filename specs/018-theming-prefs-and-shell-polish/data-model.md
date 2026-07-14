# Data Model: Theming, Preferences & Shell Polish (018)

**Phase**: 1 | **Input**: [plan.md](./plan.md), [research.md](./research.md)

Entities are grouped by the strand that owns them. Every entity here is either **new** or **changed**;
untouched entities are not restated.

---

## 1. Theme tokens

### 1.1 Colour tokens — the split

`surface` is **kept** as the pane/panel body role (its shipped copy label is already "Panel surface"), so
the most common role needs no migration and no theme changes. Five roles are carved out of it, plus one
out of `surfaceActive`.

Every new token resolves through a **fallback chain**, so a theme authored before the split keeps its
appearance exactly (FR-008):

```text
theme.colours[new]  ??  theme.colours[parent]  ??  THRONG_THEME.colours[new]
```

**This chain is resolved in the theme-resolution layer, not in CSS.** The variable emitter merges every
theme over the built-in defaults before emitting, so a CSS `var(…, fallback)` can never fire at runtime
(research C2). A pure function in `@throng/core` owns the chain and is unit-tested without a DOM.

| Token | Role | Parent | Replaces (call sites) |
|---|---|---|---|
| `surface` *(kept)* | Pane and panel body | — | `panes.css:17`, `theme.css:639` |
| `menuSurface` | Menus, drop-downs, context menus, typeahead lists | `surface` | `theme.css:961`, `title-bar.css:109`, `preferences.css:454,787` |
| `inputSurface` | Text inputs, selects, search boxes, hex fields | `surface` | `theme.css:310,324,1585`, `preferences.css:220`, `panel-type.css:38` |
| `hoverSurface` | Row hover, icon-button hover, chrome hover | `surface` | `explorer.css:114`, `theme.css:391,815`, `preferences.css:478`, `title-bar.css:89,152` |
| `dialogSurface` | Modal cards, dialog bodies, the find bar | `surface` | `theme.css:1020,1046`, `preferences.css:512`, `find-bar.css:14` |
| `menuItemHoverSurface` | The hovered row **inside** a menu | **`accent`** | `title-bar.css:128`, `preferences.css:474,806` |
| `accentText` | The foreground **on** the accent colour | — | `theme.css:993` (menu-item hover), `theme.css:1219` (modal confirm button) |
| `surfaceActive` *(kept)* | Selected/active row, active panel header, active tab chip | — | `explorer.css:119`, `theme.css:513,1309` |

> **`menuItemHoverSurface`'s parent is `accent`, not `surfaceActive`.** The **shared** menu's item hover
> already uses `var(--accent)` with a hard-coded `#06101f` foreground; only the *bespoke* menus use
> `surfaceActive`. Unifying the menus necessarily picks one, and it picks the shared menu's — that is the
> menu that survives. `accentText` is the foreground that sits on it, a real recurring role hard-coded in
> two places today with no token. See `contracts/theme-tokens.md` for the full reasoning; it is
> authoritative.

**Buttons gain no new token.** The three button sites currently reading `surface`
(`panel-type.css:86`, `theme.css:815,1351`) are re-pointed at the **existing** `buttonBg` /
`buttonHoverBg` tokens. Adding a `buttonSurface` where a shipped token already serves the role would
violate YAGNI and add a token to 15 themes for nothing.

### 1.2 Colour tokens — new roles

| Token | Role | Default | Notes |
|---|---|---|---|
| `accentText` | The foreground **on** the accent colour | `#06101f` (throng) | Hard-coded in **two** places today (the shared menu's item hover; the modal confirm button) with no token. Gains a contrast pairing (`accentText` on `accent`). |
| `scrollbarTrack` | Scrollbar trough | `appBg` | The terminal hard-codes `transparent` today — a third hole the spec did not count (research: terminal.css:35). |
| `scrollbarThumb` | Scrollbar thumb | `border` | The terminal borrows `border` today. |
| `scrollbarThumbHover` | Scrollbar thumb, hovered | `textMuted` | The terminal borrows `textMuted` today. |
| `iconColour` | Icon artwork colour — **optional** | *unset* | **Unset means inherit** (FR-029), which is why no existing theme changes appearance. Set means every icon from the pack adopts it. |

`iconColour` is the only **optional** colour token. Its absence is meaningful, so its type is
`string | undefined` and the resolution chain must **not** substitute a default for it — an unset
`iconColour` must reach the DOM as "no `--throng-colour-iconColour` rule", so `.icon { color: inherit }`
continues to bind to the enclosing control.

### 1.3 Icon tokens — **five**, not one

| Token | Role | Used by |
|---|---|---|
| `settings` | The gear/options glyph | The cog menu (FR-015) **and** the File & Folders options icon (FR-040) |
| `windowMinimise` | Window control | The title bar (FR-014b) |
| `windowMaximise` | Window control | The title bar |
| `windowRestore` | Window control | The title bar |
| `windowClose` | Window control | The title bar |

`settings` is one token with two consumers. The cog draws an inline vector today precisely *because* it
does not exist — which is the #56 defect and the reason #58's options icon needs it too.

The four **window controls** were originally deferred, on the reading that operating-system window chrome
is not an "action control". That reading collided with **SC-002**, which claims *zero* icons in the
application draw from an inline vector — so deferring them would have made a success criterion false on
the day it shipped. They are in scope. **Icon tokens do not participate in the colour-distinctness
metric**, so they cost nothing against FR-006.

Adding it requires: a value in `THRONG_THEME.icons`; reachability in all 14 bundled themes (they spread
`THRONG_THEME.icons`, so derivation covers it); a hand-written copy entry; and a shape in the
`throng-svg` pack's map (else it falls back to the generic shape).

### 1.4 The guards these tokens must satisfy

Four tests fire on a new token. The spec named one.

| Guard | Location | What it asserts |
|---|---|---|
| Descriptor completeness | `theme-metadata.test.ts` | Every editable token has exactly one descriptor. **Derived from the built-in theme's leaves** — so a new *required* colour token gets one automatically. **`iconColour` does not**: being optional and unset, it is not a leaf, so it gets no derived descriptor and any hand-added one would land in the audit's `unknown` list. It is surfaced by a **hand-authored** descriptor instead, exactly as the icon-pack selector already is (FR-031a) — and a separate test asserts every optional token is editable, because this audit structurally cannot. |
| **Copy** | `theme-copy.test.ts` | Every token has a hand-written label **and** description. Bans the abbreviations `bg fg bkg fore min max cfg config id num btn sel` (word-boundary, case-insensitive) **in the copy text**, and rejects a description mechanically derivable from the key. The **key itself is not checked** — so `iconColour` is a legal key; its *description* may not say "bg". |
| **All-themes completeness** | `default-themes.test.ts` | Every bundled theme carries a truthy value for every colour and icon key. **`iconColour` is optional and must be excluded from this sweep**, or it fails by design. |
| **Distinctness** | `theme-quality.test.ts` | Asserts `CLOSEST_LEGITIMATE_PAIR_DELTA` **equals** the measured closest-pair delta to 2 dp. Adding tokens moves the mean **even when the new values duplicate existing ones**, so this breaks on a correct change. Both it and `DISTINCTNESS_THRESHOLD` must be **re-derived** (FR-006). |
| **Contrast** | `theme-quality.test.ts` | 8 enumerated pairings, gating 3 themes. `buttonText` on `surfaceActive` is the one pairing touching a split token. |

---

## 2. Editor metadata (preferences)

### 2.1 `ControlKind` gains `slider`

```ts
type ControlKind =
  | 'number' | 'text' | 'toggle' | 'select' | 'multiselect' | 'array'
  | 'colour' | 'font-family' | 'font-size' | 'enum' | 'chord' | 'icon' | 'folder'
  | 'slider';   // NEW
```

**`slider` is an explicit, opt-in control kind.** A descriptor *declares* `control: 'slider'` and must
then also declare `min`, `max` and `step`. A numeric that does not declare it keeps the typed field it
has today.

> **An earlier draft made the slider a property inferred from bounds** — render one for any numeric
> declaring both a min and a max. That was wrong twice. It made the `slider` member of a **closed
> vocabulary** something no descriptor ever set and no code ever read — dead code (Principle VIII) — and
> it forced an invented 2 GiB ceiling onto the max-file-size setting purely so it could take a slider it
> should never have had. Opt-in fixes both: the kind is load-bearing, and a value that ought to be typed
> simply is not declared a slider.

### 2.2 `step` becomes load-bearing

Declared at `metadata.ts:44`, written by 8 descriptors, **read nowhere** (research C19). The slider reads
it.

**A step must be a defensible fraction of the range, and a test must assert that** — not merely that a
step exists. A step of 1024 across a multi-gigabyte range yields two million indistinguishable slider
positions: technically compliant, practically useless. Compare the ratios that work: a 13 px font
stepping by 1, a 300 ms delay stepping by 50.

### 2.3 Which numerics get a slider

| Key | Today | Becomes |
|---|---|---|
| Font sizes, delays, pane widths | bounds + step, typed | **`slider`** — bounds and step already declared and correctly scaled |
| `fonts.weights.*`, `typography.*.weight` | **no bounds at all** | **`slider`**, min 100, max 900, step 100 — the real CSS `font-weight` range |
| `editor.maxOpenFileBytes` | min 1024, **no max** | **stays typed-only, still no maximum.** A slider from 1 KiB to gigabytes moves in megabyte jumps per pixel — worse than the box it replaces — and any ceiling would be invented to serve the control rather than because the system has one, which FR-034 prohibits. It still gains **digit grouping**, which is what actually made `10485760` unreadable. |

### 2.4 Number formatting

```ts
formatGrouped(value: number, locale?: string): string   // 10485760 → "10,485,760"
parseGrouped(text: string, locale?: string): number | null   // exact inverse; null if invalid
```

Pure, in `@throng/core`. **Grouping is strictly a view concern** (FR-038): `parseGrouped` is the exact
inverse of `formatGrouped` for the active locale, so the grouping separator is stripped on the way in and
**never reaches a stored value**. A locale whose separator is `.` cannot corrupt a number, because the
parser is derived from the same locale as the formatter rather than assuming a comma.

---

## 3. The two notice models

Nine idioms collapse to two (FR-048, research C17).

### 3.1 The confirmation model

Modal, blocking, text-labelled decision buttons (the constitution's explicit exception to the
themeable-icon rule — the label *is* the statement of the consequence).

```ts
interface ConfirmChoice {
  readonly label: string;          // states the consequence; never an icon
  readonly value: string;          // what the promise resolves to
  readonly danger?: boolean;
  readonly testId?: string;        // preserved from the surface being migrated
}

interface ConfirmRequest {
  readonly title: string;
  readonly message: string;
  readonly warningMessage?: string;
  readonly details?: ReactNode;    // e.g. the app-close terminal table
  readonly choices?: readonly ConfirmChoice[];   // default: Cancel + Accept
  readonly testIds?: { dialog?: string; accept?: string; cancel?: string };
}

confirm(req: ConfirmRequest): Promise<string | null>;   // null = dismissed
```

The **binary case is the default** and its existing shape is unchanged, which is what lets 13 E2E suites
keep passing untouched. The `choices` array is what absorbs the three n-way modals (FR-048a).

**Mounted in all three windows** — main, sub-workspace, **and preferences**. It is not mounted in
preferences today, which is the entire reason the themes surface grew a rival dialog.

**Surfaces replaced**: the preferences inline confirm strip; the rival preferences modal;
`AppClosePrompt` (3-way + details table); `DirtyCloseDialog` (3-way); `UnsavedOpenDialog` (4-way).

### 3.2 The notification model

Transient, non-blocking, dismissable, themed.

```ts
type NoticeSeverity = 'error' | 'success' | 'info';

interface Notice {
  readonly id: string;
  readonly severity: NoticeSeverity;
  readonly message: string;
  readonly details?: readonly string[];   // e.g. the list of missing files
  readonly testId?: string;               // preserved from the surface being migrated
}

notify(n: Omit<Notice, 'id'>): void;
dismiss(id: string): void;
```

**Severity governs persistence** (FR-048b): `error` persists until dismissed; `success` and `info`
auto-dismiss on a timer. An error notice that silently auto-vanishes would be a worse defect than the
nine idioms being replaced.

**Colours come from `--throng-colour-danger`**, which *is* emitted — **not** from `--danger`, which is a
**dead variable**: referenced **many times across several files** and defined nowhere, so every
`var(--danger, X)` in the codebase silently renders the literal `X` (research C18). The dead alias is
defined or removed in this feature.

> **The count is deliberately not stated here.** Phase 0 said "4 references"; a later pass counted **13**,
> across a **third file** the first count never named — and that 13 itself came from a CSS-only search
> that could not see the `.tsx` references. **The T002 guard produces the real number.** Restating a hand
> count in a design document is how the wrong one propagates, and this feature exists partly because that
> keeps happening.

**Surfaces replaced**: the preferences notice strip; **five** dismissable error strips (projects,
explorer, sub-workspaces, terminal-exit, themes); the non-dismissable restore notice; the editor notice
modal.

### 3.3 What must NOT be merged

`reset to shipped defaults` and the session `revert all` are **different operations** and must remain
described differently (FR-052). They are already distinct today, per-row and per-tab:

- **Reset** answers *"what does throng ship?"*
- **Revert** answers *"what did I open this window with?"*
- **Clear** answers *"nothing, thanks"*

The migration must not collapse their three confirmation strings into one.

---

## 4. Project settings

### 4.1 The dialog — a new surface, not a new stack

**No new IPC operation, no new daemon method, no schema change** (research C10). Everything the dialog
needs already exists:

- `hiddenPaths` already rides on the project record into the renderer.
- `setHidden` is already a **full replace**, not an append. The append behaviour comes entirely from the
  one call site spreading the list.

**Un-hide is** `setHidden(projectId, current.filter(p => p !== target))`.

| Field | Source | Notes |
|---|---|---|
| Project name | The active project record | The dialog **names the project** so the user is never in doubt (FR-042). |
| Hidden paths | `project.hiddenPaths` | Each removable. Removal re-derives the tree with **no restart and no re-fetch** — hidden entries are still in the fetched cache and are dropped only at derive time. |
| Glob-excluded marker | Computed | See below. |

### 4.2 The effective exclusion set, and its trap

```text
effective = (entries on disk) − (global glob matches) − (project hidden paths)
```

The two filters run at **different stages**: globs when the directory is **read**, hidden paths when the
tree is **derived**. So **globs take precedence and are unaffected by un-hiding**.

**The trap** (FR-047a): a path that is both hidden *and* glob-matched will be listed in the dialog, the
user will remove it, and **it still will not reappear**. The dialog therefore marks such a path, because
a remove button that visibly does nothing is a worse defect than the one this story fixes.

### 4.3 Lifecycle

The dialog must not edit a stale project or write to a deleted one (FR-046). The active project is
renderer-session state; on delete it silently becomes `null`. The dialog keys on the project id and
closes when it becomes `null` — matching the explorer's existing remount-on-switch guard.

---

## 5. The drop contract

### 5.1 The seam

```text
File  ──[ webUtils.getPathForFile ]──►  absPath  ──►  pure, path-taking handler
      ▲ the ONE line E2E cannot reach          ▲ everything below here is verified through the app
```

Electron 43 removed `File.path`; `webUtils.getPathForFile` is the only way to get a real path
(research C16). **A file synthesised in the renderer is not an OS file and the extractor returns empty
for it** — so a fabricated drop event *cannot* exercise the real extraction, and a test claiming
otherwise would be asserting a fiction (FR-066a).

### 5.2 The decision, made in main

Confinement is decided in the **main process**, not trusted from the renderer:

```ts
type DropRejection =
  | 'outside-project'      // project-owned panel, file outside its folder
  | 'inside-project'       // sub-workspace panel, file inside a loaded project
  | 'is-folder'            // a folder is not a document
  | 'too-large'            // exceeds editor.maxOpenFileBytes
  | 'not-found';

type DropResolution =
  | { ok: true;  absPath: string }        // realpath-resolved
  | { ok: false; reason: DropRejection };
```

**The path is resolved to its real location (symlinks followed) *before* the ownership rule is applied**
(FR-057), so a link cannot be used to escape a project boundary.

### 5.3 The load path is brought into line

`LoadResult` gains a new reason: **`out-of-tree`**.

This is not cosmetic. Today a rejected load returns a generic I/O reason, which the renderer classifies
as a *missing file* — and that notice is **suppressed** when the user has turned off missing-file
warnings. **The silent no-op FR-061 prohibits already exists** (research C13), and cannot be fixed at the
user interface alone.

The load path also gains what only the save path has today: **realpath resolution**, and the
**outside-all-projects** rule for sub-workspace-owned editors.

**This is a deliberate behaviour change to shipped code**: a sub-workspace editor that could previously
open an in-project file no longer can. It closes a trap in which the refusal only surfaced at save time,
with the user's work already typed.

### 5.4 Multi-file and folder drops

- **Multiple files** → each opens (one buffer per file; an already-open file focuses its existing panel).
- **A folder** → rejected. Opening every file in a folder is an unbounded operation with no obvious
  ceiling, and a folder is not a document.

### 5.5 Coexistence with the two existing drag systems

| System | Mechanism | Collision? |
|---|---|---|
| Panel drag (`@dnd-kit`) | Pointer events only — registers **no** `dragover`/`drop` | **None.** |
| Explorer tree (`react-dnd`) | **Window-level** `dragover` that rewrites `dropEffect` on **every** drag, defaulting to `move`, with no check for whether it is an OS file drag | **Yes.** It is bound on `window` in the bubble phase, so it runs *after* the panel's handler and overwrites `copy` with `move`. It must be gated on `dataTransfer.types.includes('Files')`. |

Mounted only while the explorer is ready — i.e. **main window only**. Sub-workspace windows have no
explorer, so drag behaviour genuinely differs between windows, and both must be covered.
