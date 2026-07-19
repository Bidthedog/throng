# Phase 1 — Data Model

Theme *values* are the only persisted state. Grouping, labels, descriptions, and the migration are model/view logic. This rewrite keeps the shipped area model (§1–§4) and adds the fold-in refactor (§5–§10).

## §1 — The closed, ordered area set

`THEME_AREA_GROUPS` (`theme-metadata.ts`), display order (General first, Icons last):

```
General            (sub-groups: "General · Buttons · Confirm|Cancel|Destroy")
Editor             (sub-group: "Editor · Syntax")
Main panel / workspace
Sub-workspace      (allowed; no token today)
Terminal
File Explorer      (the Files & Folders pane)
Preferences
Projects / sidebar (the Sidebar/Projects pane)
Search
Icons              (last; rendered by IconSection)
```

- A descriptor's **area** = its `group` string before the first `" · "` (`Editor · Syntax` → `Editor`; `General · Buttons · Confirm` → `General`). Validity = area ∈ `THEME_AREA_GROUPS`.
- Section order = `THEME_METADATA` order; `buildThemeMetadata` sorts by `(area index, full group string, original index)`, stable — so `General` precedes `General · Buttons · …`, `Editor` precedes `Editor · Syntax`.

## §2 — Token → area assignment (`areaForToken(key)`)

Explicit-or-fail (SC-003): unplaced tokens return `undefined` → sentinel `"(unassigned)"` → `assertThemeAreaGroups` fails naming them. Rules (first match wins):

| Match | Area / group |
|---|---|
| `icons.*` or `colours.iconColour` | **Icons** |
| `colours.{confirm,cancel,destroy}Button*` | **General · Buttons · {Confirm,Cancel,Destroy}** |
| `typography.<role>` | by role table (§2a) |
| `fonts.*` | **General** |
| `sizes.iconPx`, `sizes.scrollbarPx` | **General** |
| `colours.syntax*` | **Editor · Syntax** |
| `colours.editor*` | **Editor** |
| `colours.terminal*` | **Terminal** |
| `colours.searchMatch*` | **Search** |
| `colours.<name>` in Main panel / File Explorer table (§2b) | that area |
| `colours.<name>` in the General colour set (§2c) | **General** |
| else | `undefined` → sentinel → guard fails |

**§2a Typography role → area**: `editor`→Editor, `terminal`→Terminal, `paneTitle/tab/panel/paneText`→Main panel / workspace, `projectName/projectPath`→Projects / sidebar, `button`→General, `dialog`→Preferences.

**§2b Explicit colour table**: `activePanelBorder`, `activePanelBorderInactive`, `railBg`→Main panel / workspace; `activePaneHighlight`→File Explorer; `sidebarBg`→Projects / sidebar.

**§2c General colour set** (post-refactor — the *only* way into General; **`menuSurface`, `dialogSurface`, and the four legacy `button*` are removed**; the 18 button tokens are in §2's Buttons rule, not here):
`accent`, `accentText`, `appBg`, `border`, `danger`, `dangerText`, `errorSurface`, `errorText`, `hoverSurface`, `inputSurface`, `menuItemHoverSurface`, `scrollbarThumb`, `scrollbarTrack`, `statusBarBg`, `success`, `surface`, `surfaceActive`, `text`, `textMuted`, `unsavedDot`.

## §3 — Naming/description convention (US5, FR-018/019/020)

**Fixed `<Property>` vocabulary** (the closing word(s) of a label; defined once in `theme-metadata.ts` as `THEME_PROPERTY_VOCABULARY`):
`Background`, `Text`, `Border`, `Hover Background`, `Hover Border`, `Hover Text`, `Cursor`, `Selection`, `Gutter Background`, `Gutter Text`, `Highlight`, `Marker`, `Track`, `Thumb`, `Width`, `Size`, `Font`, `Font Size`, `Bold`, `Italic`, `Underline`, `Strikethrough`, `Casing`, `Accent`.

*One word per concept (F5)*: `Text` is the only foreground-colour property — `Foreground` is deliberately absent (`terminalFg` → "Terminal **Text**"). `Font Size` is only for typography `sizePx`; `Size` is only for non-font pixel dimensions (e.g. `iconPx` → "Icon Size") and `Width` for `scrollbarPx` ("Scrollbar Width"). The convention guard treats the vocabulary as the closed set; these usage rules keep the same concept named the same way.

**Label rule**: `<Context> <Property>`, Title Case; `<Property>` ∈ vocabulary; `<Context>` non-empty and names the area/thing (e.g. "Editor", "Terminal", "Confirm Button", "Side Panel", "Files & Folders", "Search Match", "Editor Font"). Bare ambiguous labels (`Size`, `Background` alone) are rejected: every label must have a context prefix.

**Description rule**: one sentence, present tense, ≥ 20 chars, names the concrete UI element and (where relevant) the state; MUST NOT match `/(the )?["“]?.+["”]? colour token/i` (self-referential) and MUST NOT equal `mechanicalCopy(key)` for that key.

**Guard** (`theme-copy.test.ts`, extended): for every editable token, assert label matches `^([A-Z][\w&]*(?: [A-Za-z&]+)*) (<vocab-alternation>)$` with a non-empty context, and description passes the rule. Fails naming the offending token(s).

**Example rewrites**: `typography.editor.sizePx` label "Size"→**"Editor Font Size"**; `terminalFg` "Terminal text"→**"Terminal Text"**; `accentText` "Text on highlight"→**"Highlighted Option Text"**, desc *"The text of a menu or dropdown option while it is hovered or selected."*; `surface` "Panel surface"→**"Panel Surface"**; `sidebarBg` "Sidebar background"→**"Side Panel Background"** (now the Sidebar/Projects pane AND the Files & Folders pane).

## §4 — Surface consolidation (US6, FR-023–026)

| Token | Action | CSS repoint |
|---|---|---|
| `menuSurface` | **Removed** from `theme.ts`, `TOKEN_PARENT`, copy, metadata | every `var(--throng-colour-menuSurface…)` → `var(--throng-colour-surfaceActive)` (context menu `theme.css:1051`, select picker `:129`, lang menu `editor.css:156`, prefs menu `preferences.css:758`, `tokens.css:26/31`) |
| `dialogSurface` | **Removed** | every `var(--throng-colour-dialogSurface…)` → `var(--throng-colour-surface)` (modal `:1110`, app-closing `:1136`, close-table th `:1201`, notice `:1814`, `find-bar.css:14`, `terminal.css:77`, `preferences.css:508/1039`, `tokens.css:34`) |
| Files & Folders pane `.pane--explorer` (`panes.css:17`) | Repoint | `background: var(--throng-colour-surface)` → `var(--throng-colour-sidebarBg)` (Side Panel Background — same as `.pane--sidebar`) |
| All `.ctl` fields (`preferences.css:352-363` `.ctl--select/.ctl__input/.ctl__textarea`, incl. theme dropdown `themes-tab.tsx` `.ctl--select`, colour hex `.ctl__colour-hex`) | Repoint | `background: var(--bg)` → `var(--throng-colour-inputSurface)` (Field Surface) |
| `surface` | Keep, relabel "Panel Surface" | now workspace panel-boxes + dialogs only (explorer left) |
| `surfaceActive` (Active Surface), `hoverSurface`, `inputSurface` (Field Surface), `menuItemHoverSurface` (Menu Highlight) | Keep | `TOKEN_PARENT` for `inputSurface`/`hoverSurface` stays `surface`; `menuSurface`/`dialogSurface` removed from `TOKEN_PARENT` |

## §5 — Button model (US7, FR-027–030)

**Removed** (`theme.ts`): `buttonBg`, `buttonText`, `buttonHoverBg`, `buttonHoverText`.

**Added — 18 tokens** (`colours.*`), each type a set of six:
```
confirmButtonBg  confirmButtonHoverBg  confirmButtonBorder  confirmButtonHoverBorder  confirmButtonText  confirmButtonHoverText
cancelButtonBg   cancelButtonHoverBg   cancelButtonBorder   cancelButtonHoverBorder   cancelButtonText   cancelButtonHoverText
destroyButtonBg  destroyButtonHoverBg  destroyButtonBorder  destroyButtonHoverBorder  destroyButtonText  destroyButtonHoverText
```
Group: `General · Buttons · {Confirm,Cancel,Destroy}`. CSS vars `--throng-colour-<token>`; `theme.css` `--btn-*` retired in favour of per-type vars.

**Button classification** (from the UI audit — each text `<button>` maps to exactly one type):
- **Confirm** (safe primary): `.modal__confirm` (confirm-dialog last non-danger), `name-dialog` primary, `capture-modal__btn--primary`, `panel-type-form__confirm`, project-form submit, folder-browse confirm, "Leave running" (app-close), find-bar action confirms.
- **Cancel** (safe dismiss): confirm-dialog non-last plain buttons, `name-dialog`/`capture-modal` Cancel, `project-settings` Close, `panel-type-form__clear`, project-form cancel.
- **Destroy** (destructive confirm): `.modal__confirm--danger`, "Terminate all" (app-close), any delete/reset/discard confirm.

**Exclusion**: icon-only buttons (`IconButton`, window controls, toolbar/row affordances) MUST NOT use any button-type token — they keep `hoverSurface`. Guard asserts both directions (every text dialog/form button resolves to one type; no `IconButton` CSS references a button-type var).

## §6 — Migration (`migrateTheme(raw)`, FR-031/032)

Pure function in `theme-ops.ts`, applied on load of any user theme and to seed bundled-theme values. **Idempotent** (if the 18 button tokens already present and legacy keys absent → return unchanged).

**Order matters (F1)**: take a snapshot `src` of the ORIGINAL raw `colours` first; **derive from `src`**, and only drop the removed keys **after** deriving — otherwise Cancel (which reads the legacy `button*` values) would derive from already-deleted keys and silently fall back.

**Steps** on a raw theme's `colours`:
1. **Snapshot** `src = {...colours}` (pre-mutation).
2. **Seed the 18 button tokens** (only if absent), by derivation **from `src`**:

| New token(s) | Derived from `src` |
|---|---|
| `confirmButtonBg`, `confirmButtonBorder`, `confirmButtonHoverBg`, `confirmButtonHoverBorder` | `accent` |
| `confirmButtonText`, `confirmButtonHoverText` | `accentText` |
| `destroyButtonBg`, `destroyButtonBorder`, `destroyButtonHoverBg`, `destroyButtonHoverBorder` | `danger` |
| `destroyButtonText`, `destroyButtonHoverText` | `dangerText` |
| `cancelButtonBg`, `cancelButtonHoverBg` | legacy `buttonBg` / `buttonHoverBg` (fallback `surface` / `surfaceActive`) |
| `cancelButtonText`, `cancelButtonHoverText` | legacy `buttonText` / `buttonHoverText` (fallback `text`) |
| `cancelButtonBorder`, `cancelButtonHoverBorder` | `border` |

3. **Drop removed keys**: `menuSurface`, `dialogSurface`, `buttonBg`, `buttonText`, `buttonHoverBg`, `buttonHoverText`.
4. Everything else untouched → **lossless** for surviving tokens (SC-004'). When legacy `button*` keys are present, Cancel takes their exact values, NOT the fallbacks.

The 15 bundled themes in `theme.ts`/defaults are updated at source **through the same derivation**, then hand-tunable, so bundled and migrated user themes agree on shape. `THRONG_THEME` (the canonical) gains the 18 tokens explicitly; `assertEveryKeyDescribed`/`default-themes.test.ts` verify all 15 populate them.

## §7 — Windows (US9, FR-033/034)

- **`windowTitle(middle: string): string`** (new `common/window-title.ts`) → `` `${middle} — throng` ``. Every OS `setTitle` and in-app titlebar identity routes through it, so **every composed title ends with ` — throng`**. The `[ADMIN]` marker is folded into the middle *before* the suffix — `windowTitle(admin ? `${mid} [ADMIN]` : mid)` → `<mid> [ADMIN] — throng` — never appended after, so the suffix is last even when elevated (CI runs elevated).
  - Main: `windowTitle(project · context [+ ' [ADMIN]'])`. Preferences: `windowTitle('Preferences')`. Sub-workspace: `windowTitle(`${name} · ${tabs} tabs · ${panels} panels`)`; pre-content `windowTitle('Sub-workspace')`.
- **Preferences minimise**: `WindowControls` gains `showMinimise?: boolean` (default `true`); `TitleBar` threads it; `preferences-app.tsx` passes `false`. `preferences-window.ts` `BrowserWindow` gets `minimizable: false`. Main/Sub-workspace unchanged.

## §8 — Bug A: stranded hover (US10, FR-035)

Mechanism (to confirm via systematic-debugging): CSS `:hover` on the Files & Folders root persists because the cog "Themes" item overlays it, clicking opens Preferences without pointer movement, and focus leaves. Fix: gate hover-background rules so they do not paint while the **main window lacks focus or a child window/menu is open**. Approach: renderer sets `data-window-blurred` on `<body>` on window `blur`/child-open and clears it on `focus` + first `pointermove`; hover CSS becomes `:hover:not(...)` under `body:not([data-window-blurred])`. Applies app-wide (rule d "no hover unless genuinely hovering"), verified by E2E on the reported path.

## §9 — Bug B: colour picker clamp (US11, FR-036)

Extract the context-menu positioner (`context-menu.tsx:313-324`) into `clampToViewport(anchorRect, size, viewport): {left, top}` (both-axis flip + clamp, measured pre-paint). `context-menu.tsx` uses the extracted helper (no behaviour change — regression-guarded). `colour-picker.tsx` replaces its vertical-only flip with the helper so the panel always fits on screen.

## §10 — Usage guard (US8, FR-022) & invariants

- **Usage guard** (unit/contract): a manifest lists, per token, its consumer evidence — a CSS var grep over `packages/ui/src/renderer/**/*.css` (+ the documented TS consumers: `terminal-panel.tsx` for `terminal*`, `highlight-style.ts` for `syntax*`/`editorFg`) — and asserts every token has ≥1 consumer AND appears in ≥1 assertion test file. Missing either → fail, naming the token. Removed tokens (`menuSurface`/`dialogSurface`/legacy buttons) must have **zero** consumers (proves the repoint is complete).
- **Invariants asserted**: (1) every descriptor area ∈ `THEME_AREA_GROUPS`; (2) the 18 button tokens exist, grouped under `General · Buttons · <Type>`, and the 6 removed tokens are gone from `THRONG_THEME`, all 15 bundled themes, and all CSS; (3) `migrateTheme` is idempotent and lossless; (4) every `.ctl` field CSS resolves to `inputSurface`; (5) menu cards → `surfaceActive`, dialog cards → `surface`, `.pane--explorer` → `sidebarBg`; (6) each button type's CSS uses only its six tokens; no `IconButton` uses a button-type token; (7) labels/descriptions pass the convention guard; (8) each window title ends ` — throng`; Preferences has no minimise affordance.
