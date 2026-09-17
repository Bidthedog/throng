# Contract: settings, key bindings and theme tokens

**Feature**: 044 | **Requirements**: FR-005, FR-035b, FR-050 – FR-065, FR-092, FR-096c, FR-104, FR-105, FR-108; iteration 2026-09-15: FR-114, FR-117; iteration 2026-09-16: FR-122d, FR-122f, FR-122c (icon token)

Every configurable thing this feature adds, with the registration each one needs. The completeness
tests (`settings-metadata.test.ts`, `keybindings-metadata.test.ts`, the theme metadata tests) fail in
both directions, so an entry missing here is a build failure rather than a review comment.

---

## Settings

### Static leaves

| Key | Type | Ships as | Range / values | Group · subgroup | FR |
|---|---|---|---|---|---|
| `editor.previews.updateDelayMs` | number | `300` | 0 – 5,000, step 50 | Editor · **Previews** | FR-060 |
| `editor.previews.maxWaitMs` | number | `1000` | 0 – 10,000, step 100 (a slider step is ≥ 1% of its range); read as `max(maxWaitMs, updateDelayMs)` | Editor · **Previews** | FR-060a |
| `editor.previews.copyFormat` | `'rich' \| 'plain'` | `'rich'` | labels *Rich text* / *Plain text* | Editor · **Previews** | FR-035b |
| `editor.navigation.historySize` | number | `10` | 1 – 100, step 1 | `Editor · Navigation` | FR-108 |
| `editor.previews.syncScroll` *(iteration 2026-09-15)* | toggle | `true` | label *Synchronise preview and editor scrolling*; no `enabledWhen` — it is not provider-scoped | Editor · **Previews** | FR-113, FR-114 |

### Generated per provider — `previewSettingsDescriptors(registry)`

For each registered provider `<id>`, in registration order:

| Key | Type | Ships as | Enabled when | FR |
|---|---|---|---|---|
| `editor.previews.providers.<id>.enabled` | toggle | `true` for `markdown` | always | FR-061, FR-062, FR-065 |
| `editor.previews.providers.<id>.defaultOpenAction` | select `'editor' \| 'preview'` | `'editor'` | `enabledWhen: { key: '…<id>.enabled', is: true }` — drawn **disabled**, never hidden; **no descriptor for binary providers** | FR-050, FR-051, FR-061 |
| `editor.previews.providers.<id>.<leaf>` | from the declaration | from the declaration | `enabledWhen: { key: '…<id>.enabled', is: true }` — drawn **disabled**, never hidden | FR-061, FR-071 |

All three rows are **always drawn** (FR-061, amended 2026-09-14). While the provider is disabled its
stored `defaultOpenAction` is kept but **suspended** — its files open in an editor (FR-062).

Shipped instance for Markdown:

| Key | Ships as |
|---|---|
| `editor.previews.providers.markdown.enabled` | `true` |
| `editor.previews.providers.markdown.defaultOpenAction` | `'editor'` |
| `editor.previews.providers.markdown.loadRemoteImages` | `true` |
| `editor.previews.providers.markdown.showFrontMatter` *(iteration 2026-09-15, FR-117)* | `true` |

Labels are the provider's `displayName` prefix: *Markdown: Enabled*, *Markdown: Default open action*
(*Editor* / *Preview*), *Markdown: Load remote images*, *Markdown: Show front matter*. **Not** *Open files with*: that is
`editor.openOnClick`'s label (019 FR-024), which picks the click gesture — two settings under one label
would read as one. *Default open action* is the spec's own term (Terminology, FR-050).

### Registration obligations

- `EditorSettings` gains `previews: PreviewSettings`; `EditorSettings.navigation` gains `historySize`.
- `editorSettings()` (`core/src/config/app-settings.ts:1006-1073`) lists the new leaves — a leaf
  missing there is silently dropped (`:1066`).
- `cloneEditor` (`:1093`) deep-clones `previews.providers`; `editor-settings.test.ts` covers it.
- **No new `FieldDescriptor` field**: the existing single-condition `enabledWhen`
  (`core/src/config/metadata.ts:213`, honoured at `settings-tab.tsx:286-290`) expresses FR-061.
  `settings-tab.tsx` reads its metadata from a React context whose default is `SETTINGS_METADATA`, so
  the SC-003 test can render a test registry's descriptors — one generic edit, never repeated per
  provider.
- **`settings-metadata-040.test.ts:167-179` is amended** to permit subgroup `Previews` in the Editor
  group. It currently pins the subgroup to the three status-bar keys.
- `settings-inertness-044.test.ts`: every new key has a descriptor and a reader outside the config
  layer that also names its parent segment (`previews`, `navigation`, `providers`) — the 043 rule,
  because `enabled` collides everywhere.
- **No `SHIPPED_DEFAULTS_VERSION` change is needed for settings** — the parser supplies absent leaves
  (`core/src/config/shipped-defaults.ts:112-115`). The bump below is for icon tokens.

#### Iteration 2026-09-15 — obligations for the two new leaves

- `PreviewSettings.syncScroll` (`core/src/preview/settings-types.ts`); default, descriptor and parse in
  `core/src/config/preview-settings.ts` beside `copyFormat`; listed in `editorSettings()` and copied by
  `cloneEditor` (`core/src/config/app-settings.ts`).
- `showFrontMatter` is one more entry in the Markdown descriptor's own `settings`
  (`core/src/preview/providers/markdown.ts`); default, descriptor and parse are generated — no
  `preview-settings.ts` edit for it (FR-071).
- `settings-metadata.test.ts` REQUIRED list, `settings-inertness-044.test.ts` key list (its header's
  count too), `settings-tab-previews.test.ts` rows, and every test comparing a whole `PreviewSettings` or
  Markdown provider object (`editor-settings.test.ts`, `preview-settings.test.ts`,
  `preview-registry.test.ts`) gain the leaves.
- Readers outside the config layer, for the inertness guard: `preview-panel.tsx` reads
  `settings.editor.previews.syncScroll`; `markdown-body.tsx` reads `providerSettings.showFrontMatter`, handed
  down from `settings.editor.previews.providers[…]`.
- **Still no `SHIPPED_DEFAULTS_VERSION` change** — settings leaves only, no token
  (`shipped-defaults.ts:134-140`).
- **No key binding and no theme token** is added by the iteration. The status-bar readout (FR-118) is text
  in the editor strip's existing readout class, and the image tooltip (FR-120) is a native `title`.

## Key bindings

| Action | Scope | Ships as | Label (group) | FR |
|---|---|---|---|---|
| `preview.open` | `editor`, `explorer` | `[]` | *Open Preview* (Navigate) | FR-005 |
| `navigate.back` | `editor`, `preview` | `['Alt+ArrowLeft']` (shown as stored, like every binding) | *Back* (Navigate) | FR-104, FR-105 |
| `navigate.forward` | `editor`, `preview` | `['Alt+ArrowRight']` (shown as stored) | *Forward* (Navigate) | FR-104, FR-105 |
| `preview.followLink` | `preview` | `['Ctrl+Enter']` | *Open Link* (Navigate) — the same words as the body menu item it accelerates (FR-095), so the key binder and the menu name one command once | FR-096c |

### Registration obligations

- `ActionId` (`core/src/config/keybindings.ts:9-135`), `COMMAND_SCOPES` (`:180-271`),
  `WINDOWS_BINDINGS.bindings` (`:282-416`), `KEYBINDINGS_METADATA` (`keybindings-metadata.ts`).
- **New `DispatchScope` `'preview'`** (`:149`): `EVERYWHERE` (`:153-173`), `SCOPE_NAMES` (`:610`),
  `SCOPE_ORDER` (`:624`); `scopeFromKind` (`ui/src/renderer/keybindings/scope.ts:63-78`) maps
  `'preview'` → `'preview'`.
- `navigate.back` and `navigate.forward` join `WINDOW_HANDLED_ACTIONS`
  (`ui/src/renderer/app.tsx:204-230`), so they are resolved in the capture phase and CodeMirror's
  `Alt-ArrowLeft/Right` (`cursorSyntaxLeft/Right`) never sees them; `editorChordsFor`
  (`scope.ts:214-237`) then drops them from the editor keymap.
- **Terminal tiers**: none of the chords is reserved or shadowable and none is scoped to `terminal`
  — no exception to record (`core/tests/unit/terminal-reserved-keys.test.ts`).
- **Window chord manifest**: not engaged — arrows and Enter are outside `keepsShift`
  (`ui/tests/unit/window-chord-manifest.test.ts:100`).
- **Collisions**: `keybindings-collision.test.ts` — `Ctrl+Enter` is unbound elsewhere; `Alt+Enter`
  and `Ctrl+Alt+Enter` (`search.replaceCurrent`/`replaceAll`, PANELS) do not overlap the `preview` scope.
- **No new binding touches a shipped one**, so `parseKeybindings` fills them in on upgrade
  (`keybindings.ts:474-486`).

### Not bindings, and why

- **Mouse buttons 3/4** are pointer input on the panel root, performing `navigate.back`/`forward`
  (FR-105). They are documented in the keyboard reference, not in the key binder.
- **Copy and Select All** in a preview are the platform gestures (`copy` event, Ctrl+A) scoped to the
  preview body — the editor has no rebindable copy action either.

## Theme tokens

### Icon tokens — 4 new, `EXPECTED_ICON_TOKEN_COUNT` 65 → 69

| Token | Used by | Why new |
|---|---|---|
| `preview` | editor status-bar button; *Open Preview*; *Open In → Preview*; preview panel type icon | a new action |
| `refresh` | preview header *Refresh* | `retry` means *Try again* and is offered beside it while the failure banner is up (030 FR-042c) |
| `navigateBack` | header Back button; *Back* menu item | `chevronLeft` is the tab strip's step control — a different action |
| `navigateForward` | header Forward button; *Forward* menu item | as above |

**Reused, not new**: `editorPanel` for *Open in Editor* / *Go to Editor* (the editor for this file);
`copy` and `selectAll` for the body menu; the terminal link menu's existing tokens for *Open Link* /
*Copy Link Address*; `zoomIn`/`zoomOut`/`zoomReset`, `send`, `detach`, `destroy`, `folderOpen`.

Obligations: a value in `THRONG_THEME.icons` (`core/src/config/theme.ts:353-525`), copied to the
other fourteen by `makeTheme` (`default-themes/index.ts:501`); label and description in
`theme-copy.ts` (`assertNamingConvention`, `theme-metadata.ts:153`); `icon-tokens-exist.test.ts`,
`menu-icon-tokens.test.ts`, `no-inline-artwork` stay green.

### Colour tokens — none

Rendered Markdown uses existing tokens only (research R17). `preview.css` names no colour literal,
including as a `var()` fallback; `preview-css-tokens.test.ts` fails on one.

**Every text colour sits on `editorBg`, and every text colour is a token `theme-quality.ts` already
measures against `editorBg` on every shipped theme** — `editorFg` (`editor text on editor background`)
or a `syntax*` token (`SYNTAX_ON_BODY`). That is what makes SC-005 true by construction, with no new
contrast pairing: the rendered document is legible exactly where the editor's Markdown highlighting is.
Links and quotes take the colours `highlight-style.ts` already gives them in the editor.

| Element | Token(s) |
|---|---|
| Body | `--throng-colour-editorBg`, `--throng-colour-editorFg`; font `--throng-font-paneText-*` |
| Headings | `editorFg`, weight as the editor's Markdown headings |
| Code (inline and blocks) | font `--throng-font-editor-*`; background `editorBg` (no fill of its own); block outlined by a `border` rule |
| Syntax in blocks | `throngHighlightStyle` (`syntax*`) |
| Links | `syntaxFunction`, underlined (`highlight-style.ts:54`) |
| Block quotes | text `syntaxComment`, italic (`highlight-style.ts:58`); rule `border` |
| Tables, horizontal rules, front matter table | rules `border`; text `editorFg` |
| Focus indicator | `accent` — an outline only, never a text colour |
| Notices | the shared panel notice/failure tokens |

`preview-css-tokens.test.ts` pins both halves: no background other than `editorBg`, and no `color`
outside `editorFg` / `syntax*`.

### Shipped defaults — `SHIPPED_DEFAULTS_VERSION` 7 → 8

Required for the four icon values to reach an installed build (`shipped-defaults.ts:25-83`). No
existing value moves, so **no frozen `V7` record** is needed and `upgrade()`'s guarded rewrites are
untouched. `shipped-defaults-fidelity.contract.test.ts:35` and `shipped-defaults-seed-upgrade.test.ts:47`
read the constant, not the literal.

---

## Iteration 2026-09-16 — FR-122 (toggle surfaces), FR-121 (two-way)

*Additive; the tables above stand except where a row says "refines".*

### Setting — description only *(refines the static-leaves row for `editor.previews.syncScroll`)*

| Key | Change |
|---|---|
| `editor.previews.syncScroll` | Label unchanged. **Description** becomes: *"Keep a preview and its editor at the same place in the file, in both directions: scrolling either one scrolls the other. Also switched by Synchronise Scrolling in the editor's and the preview's menus, and by the button beside the preview button on their status bars."* (FR-122f). Still no `enabledWhen` (FR-122a). Shape, default and parse unchanged. |

*Converge 2026-09-16 (round 2): the shipped description ends "…and by the **Synchronise Scrolling
button** on their status bars", not "the button beside the preview button" (analysis T1: name the control,
not its position). `preview-settings.test.ts` asserts the old phrase is gone.*

`preview-settings.test.ts` asserts the description contains *both directions* and names *Synchronise
Scrolling* and the status-bar button — substrings, so wording can be polished without a test edit.
Written from outside Preferences **only** by `renderer/preview/sync-scroll-toggle.ts`, as a one-key patch
(032 FR-001). Revert All Preferences reverts it like any descriptor-carrying key (032 FR-001a; plan
decision 3; `revert-plan.test.ts`).

### Key binding — one new

| Action | Scope | Ships as | Label (group) | FR |
|---|---|---|---|---|
| `preview.toggleSyncScroll` | `editor`, `preview` (`HISTORY_PANELS`) | `[]` | *Synchronise Scrolling* (Editor) — the menu item's words; *Editor* beside *Toggle word wrap* | FR-122d |

Obligations: `ActionId`, `COMMAND_SCOPES`, `WINDOWS_BINDINGS.bindings`, `KEYBINDINGS_METADATA`
(description: *"Turn synchronised scrolling between editors and their previews on or off, everywhere.
Live in an editor or a preview. Unbound by default."*). Resolved by `preview-commands.tsx`'s window
handler, not installed in CodeMirror (as `preview.open`). It acts, and calls `preventDefault`, only when
the active panel shows the toggle (FR-122a). **Terminal tiers**: not scoped to `terminal`, ships unbound
— no exception. **Collisions**: none (unbound). `parseKeybindings` fills it on upgrade.
`keybindings-preview.test.ts`, `keybindings-metadata.test.ts`, `keybindings-collision.test.ts`.

### Icon token — one new, `EXPECTED_ICON_TOKEN_COUNT` 69 → 70

| Token | Used by | Why new |
|---|---|---|
| `syncScroll` | the editor's and the preview's status-bar toggle; *Synchronise Scrolling* in all four menus | a new action; no existing glyph means "scroll two views together" |

Obligations as for the four above: `THRONG_THEME.icons`, `theme-copy.ts` label and description,
`icon-tokens-exist.test.ts`, `menu-icon-tokens.test.ts`, `no-inline-artwork`.

### Shipped defaults — `SHIPPED_DEFAULTS_VERSION` 8 → 9

For the one icon value to reach an install that already holds an 8 marker — which, although 8 has not
shipped, is every hand-testing build of this branch (043's 6 → 7 precedent, `shipped-defaults.ts:104-121`).
Additive only: no existing value moves, no frozen `V8` record. A `shipped-defaults-upgrade.test.ts` case:
a theme file at version 8 without `icons.syncScroll` gains it; one that has it keeps its value.

### Colour tokens — none. Settings leaves — none.
