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

**§2a Typography role → area**: `editor`→Editor, `terminal`→Terminal, `paneTitle/tab/panel/paneText`→Main panel / workspace, `projectName/projectPath`→Projects / sidebar, `button`→**General · Buttons** (second review, §12). *(`dialog`→Preferences was removed with the role in the second review.)*

**§2b Explicit colour table**: `activePanelBorder`, `activePanelBorderInactive`, `railBg`→Main panel / workspace; `sidebarBg`→Projects / sidebar. *(`activePaneHighlight`→File Explorer was consolidated onto `activePanelBorder` in the second review, §12.)*

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

## §11 — Follow-up defects (2026-07-20, US12–US15 / FR-037–FR-043)

- **Reset for inherit-based fields (FR-037)**: `isThemeTokenOverridden(current, shipped, key)` — when `ownAtPath(shipped, key) === undefined`, return `ownAtPath(current, key) !== undefined` (the field's default is *inherit*; pinning any concrete value is an override) instead of `false`. The concrete-shipped branch (`!deepEqual`) is unchanged. Reset writes `getAtPath(shipped, key)` as before — `undefined` for an inherit field, which `setAtPath` folds into the leaf and JSON-persistence drops, returning it to inherit; `toCssVariables`' `??` fallbacks render the base value. This also fixes the optional colour tokens (`iconColour`, `menuItemHoverSurface`), which ship unset. Settings/keybindings predicates unchanged (a missing path there means "not a real key").
- **Sizes baseline (FR-038)**: `makeTheme` (default-themes/index.ts) now returns `sizes: { ...THRONG_THEME.sizes }`, so every bundled theme carries `iconPx: 16` / `scrollbarPx: 12` — a concrete Reset baseline. No appearance change (values are throng's own).
- **Icon size in the Preferences chrome (FR-039)**: `preferences.css` `.prefs-toolbtn--icon` no longer pins `font-size: 14px`; the glyph takes `--throng-size-icon` from the base `.icon` rule and the button box is `calc(var(--throng-size-icon) + 10px)` so it scales with the setting. `white-space: nowrap` kept for multi-char glyphs.
- **Scrollbar width app-wide (FR-040, #130)**: `theme.css` drops the global `* { scrollbar-color }` (it put Chromium in standard-overlay mode, which ignores `::-webkit-scrollbar { width }`). The app now styles scrollbars via the legacy webkit pseudo-elements everywhere — colours on `::-webkit-scrollbar-thumb`/`-track`, width on `::-webkit-scrollbar` — so classic bars occupy real width and the theme's px width applies to every surface. The terminal's `.xterm-viewport { scrollbar-color: auto }` becomes a defensive no-op (kept). Guard: `scrollbar-webkit-coverage.test.ts` fails on any real `scrollbar-color`; scrollbars E2E MEASURES an arbitrary surface's bar width.
- **Button typography app-wide (FR-041, base-only)**: `theme.css` adds one base rule — `button { font-family/size/weight/text-transform/font-style/text-decoration }` from the six `--throng-font-button-*` vars — so the whole `button` role reaches every button; `.icon` resets `text-transform/font-style/text-decoration` so glyphs are never mangled; the hard-coded `font-weight: 600` on `.modal__confirm` / submit is removed so the Bold toggle is uniform. Guard: `button-typography-coverage.test.ts`.
- **Non-modal Preferences (FR-042)**: `preferences-window.ts` no longer disables other windows on open (`setEnabled(false)` loop and `enableAllWindows()` removed); `parent` stays, so the window floats above main and minimises with it while every other window is interactive. The hover-suppression machinery is unchanged (main still blurs when the child takes focus, so the US10 gate still fires). `titlebar-chrome.e2e.ts` asserts `main.isEnabled() === true`.
- **Slider no snap-back (FR-043, #131)**: `form-controls.tsx` `NumberControl` — `commitDrag` no longer clears the local `dragging` value on release when it differs from `value`; it calls `onCommit(n)` and keeps SHOWING `n`. A sync effect keyed on `[value]` alone releases the hold (`setDragging(null)`) once the committed value round-trips back, so the thumb never renders the pre-commit `value` during the debounced write.

## §12 — Second review (2026-07-20, FR-044–FR-053)

- **Button-typography leak → text buttons only (FR-044)**: the base `button { … }` rule is REPLACED by a rule scoped to the text-only dialog buttons (`.modal__buttons button`, `.project-form__buttons button`, `.panel-type-form__actions button` / `__confirm` / `__clear`, `.capture-modal__btn`). `text-decoration` propagates to descendants and a child cannot cancel it, so a broad `button` rule underlined project names, the `(NT·NP)` count span, icon glyphs and picker rows; icon-bearing buttons (`folder-picker__browse`, `find-bar-btn`, IconButton, window/toolbar controls) are excluded. `.icon` resets `text-transform`/`font-style` only (decoration can't be reset — it's kept off icon-bearing elements instead). Guard: `button-typography-coverage.test.ts` (a text-button rule carries all six; NO bare `button` selector carries button-font tokens).
- **Editor grouping/order (FR-045)**: `TYPOGRAPHY_AREA.button` = `'General · Buttons'` (its own subsection); `buildThemeMetadata`'s tie-break uses `BUTTON_GROUP_ORDER` so `General · Buttons` < Confirm < Cancel < Destroy; the six colours per type reordered in `THRONG_THEME.colours` to BG, Border, Text, HoverBG, HoverBorder, HoverText (registry preserves key order).
- **Bold → weight slider (FR-046)**: `ThemeFontRole.bold?:boolean` → `weight?:number`; `toCssVariables` emits `--throng-font-<role>-weight = s.weight ?? baseWeight`; control `weight`→slider (100–900). `THRONG_THEME.typography` ships explicit `weight:600` on paneTitle/panel/projectName (keep-bold). `migrateThemeTypography` converts `bold:true→weights.bold`, `bold:false→weights.normal`. Copy: role field `weight` label "Weight".
- **Editor field set (FR-047)**: `EDITOR_FONT_FIELDS = [family, sizePx, weight]`; `fieldsForRole(editor)` returns it. `migrateThemeTypography` strips case/italic/underline/strikethrough from `typography.editor`.
- **Active-pane highlight consolidation (FR-048)**: `activePaneHighlight` REMOVED (colour count 68→67); the File Explorer's `.pane-explorer__body--active::after` uses `var(--active-pane-colour, var(--throng-colour-activePanelBorder))`; `file-explorer-pane.tsx` sets `--active-pane-colour` inline to the active project's colour while active (mirrors the panels' inline `outlineColor`). `migrateThemeColours` seeds `activePanelBorder` from `activePaneHighlight` then drops it. `COLOUR_AREA`/copy updated; non-drift fixture strips the removed token.
- **Pane Text everywhere + Panel Header (FR-049)**: `.project-list__empty` and `.subworkspace-list__empty` added to the paneText rule; `ROLE_CONTEXT.panel = 'Panel Header'`, `ROLE_SURFACE` clarified (paneText = body only, never a header).
- **Copy clarifications (FR-050)**: `dangerText` (hover-only), `accent` (project-overwritten), `success` (loaded dots + notices), plus the stale `scrollbarTrack`/`scrollbarThumb` copy corrected to app-wide (they were still labelled "Editor Scrollbar …" after #130 made all bars classic).
- **Function highlighting in legacy grammars (FR-051)**: new `editor/function-highlight.ts` — a `ViewPlugin` decoration overlay colouring function-position identifiers (calls + definitions), filtered through the syntax tree and a keyword-exclusion table, gated by a `functionHighlightCompartment` to the 8 function-bearing legacy StreamLanguage languages; first-class grammars never mount it. `highlight-style.ts:26` (`tags.function → syntaxFunction`) unchanged.
- **Dropdown consolidation (FR-052)**: the language picker's hover repointed from `hoverSurface` to `menuItemHoverSurface` + `accentText` (matching the context menu, native `<select>` popup and font typeahead), and its filter input from `appBg` to `inputSurface` (Field Surface). The button-leak fix (FR-044) already stopped button typography reaching the picker `<button>` rows.
- **Remove dialog role (FR-053)**: `dialog` removed from `TypographyRole`/`TYPOGRAPHY_ROLES`/`THRONG_THEME.typography` and `TYPOGRAPHY_AREA`; `.modal` and `.prefs-root` read the base `--throng-font-*` directly (no `--throng-font-dialog-*` anywhere); `migrateThemeTypography` drops `typography.dialog`; copy `ROLE_CONTEXT`/`ROLE_SURFACE` lose the dialog entries.
