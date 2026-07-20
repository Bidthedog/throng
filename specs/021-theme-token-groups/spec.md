# Feature Specification: Theme token grouping, naming conventions & consolidation

**Feature Branch**: `feature/S021-I84-theme-token-groups`

**Created**: 2026-07-18 · **Rewritten**: 2026-07-19 (scope expanded — see 2026-07-19 clarifications)

**Status**: Draft

**Input**: GitHub issue #84 — "[Enhancement] Group theme tokens by the area they colour" — plus an expanded refactor agreed on 2026-07-19: a theme-key **naming/description convention**, **surface consolidation**, a **three-type button model**, applying **Field Surface** to every field, a **window-title convention** with Preferences no longer minimisable, two behavioural **bug fixes** (stranded hover; clipped colour picker), and a **standing usage guard** that every token is used and tested. The area-grouping and section-search work (US1–US4) shipped first; this rewrite folds the follow-on refactor into the same feature (#84 / PR #135), which means the original "byte-identical / nothing renamed" contract (former FR-011/FR-012, SC-004/SC-006) is deliberately dropped and replaced by a migration. A further **follow-up defect pass (2026-07-20)** — US12–US15 / FR-037–FR-043 — fixes reset for inherit-based fields, wires up controls that did nothing (icon size in the Preferences chrome, scrollbar width app-wide **#130**, button typography on every button), makes the Preferences window **non-modal**, and stops sliders snapping back (**#131**). A **second review the same day** — FR-044–FR-053 — scopes the button-typography leak to text buttons, regroups/reorders the button editor, turns per-role Bold into a **weight slider**, trims editor typography, consolidates the active-pane highlight, spreads Pane Text to every pane, colours functions in legacy grammars, unifies dropdown theming, removes the **dialog** font role, and corrects the copy for tokens that only appear conditionally.

## Clarifications

### Session 2026-07-18

- Q: Which theme tokens should be regrouped by app area? → A: **All tokens except icons** are grouped by app area; **icon tokens form their own single area group ("Icons")**.
- Q: How should the set of area groups be defined and enforced? → A: A **fixed, closed named set**; the completeness test rejects any group name outside it.
- Q: How should a token used by more than one area be filed? → A: **Primary (dominant) area wins**, appearing once; **General** is reserved for genuinely application-wide tokens.
- Q: What should the completeness test assert about a token's group? → A: **Closed set + exactly one** — fail on zero, more than one, or an out-of-set name.
- Q: Should area groups support the Settings tab's "Parent · Child" sub-grouping for dense areas? → A: **Yes** — reuse it (e.g. `Editor · Syntax`).
- Q: May the closed set include areas beyond the issue's named list? → A: **Yes** — e.g. Projects / sidebar, Search.
- Q: How should groups be ordered? → A: **By app prominence** — General first; Icons last.
- Q: Should grouped search also match a **section (group) name**? → A: **Yes** — union with name matches, same case-insensitive substring rule.
- Q: Does a match on a parent area include its nested "Parent · Child" sub-groups? → A: **Yes**.
- Q: Themes tab only, or also Settings? → A: **Both**.
- Q: How is "exactly one group / adding a token forces declaring its area" enforced? → A: **Explicit per-token/prefix assignment** in the registry; unplaced tokens take a sentinel area outside the closed set so the guard fails and names them — no silent default.

### Session 2026-07-19 (refactor fold-in)

- Q: This refactor renames/merges/removes keys and changes colours — where does it land? → A: **Fold into #84 / PR #135**, rewriting this spec. The original byte-identical / no-rename contract is dropped.
- Q: How self-describing should each token label be? → A: **Fully self-describing** — `<Context> <Property>` (e.g. "Editor Font Size", "Confirm Button Hover Background"), because search pulls rows out of their section heading.
- Q: The refactor references an "About throng" window. → A: It **exists on another branch** (#21 packaging) and works; it is **out of scope here**. Only the windows present in this branch (Main, Preferences, Sub-workspace) are retitled.
- Q: "Menu Surface" is superfluous. → A: **Remove `menuSurface`**; menu/dropdown cards use **`surfaceActive`** (Active Surface).
- Q: "Dialogue surface" is superfluous. → A: **Remove `dialogSurface`**; modal/notice/dialog cards use **`surface`** (Panel Surface).
- Q: "Panel surface" also colours the Files & Folders pane; it should match the projects panel. → A: The **Files & Folders pane** adopts the **projects/sidebar background** token (`sidebarBg`, relabelled to cover both); it stops using `surface`.
- Q: "Field Surface" doesn't colour all fields (theme dropdown, other preference fields). → A: **`inputSurface` (Field Surface) MUST colour every field**, including the Themes tab's theme dropdown and all `.ctl` inputs — replacing their current use of the app-background token.
- Q: "Text on Highlight" needs a precise meaning. → A: `accentText` = the **text of a menu/dropdown option while hovered or selected**; once buttons stop borrowing it, that is its only role. Relabel accordingly.
- Q: There are too many button colours. → A: Exactly **three text button types — Confirm (safe), Cancel (safe), Destroy (destructive confirm)** — each with **six** styles (Background, Hover Background, Border, Hover Border, Text, Hover Text) = **18 tokens**, grouped under `General · Buttons · <Type>`. They style **only text buttons on dialogs/forms**; **icon-only buttons never use them**. The four legacy button tokens are removed and buttons stop borrowing `accent`/`danger`/`border`.
- Q: The colour picker gets clipped near the screen edge. → A: It **MUST reuse the context-menu's viewport flip-and-clamp** positioning so it always opens fully on screen.
- Q: The Files & Folders root stays "hovered" when Themes is opened from the cog menu. → A: **Hover visuals MUST NOT persist** when the main window loses focus or a menu/child window opens; they show only while the pointer is genuinely over the element.
- Q: Window titles and chrome. → A: Every window title (OS + in-app) uses the **suffix form `<Name> — throng`** (was the prefix `throng — <Name>`); the **Preferences window is not minimisable** (no minimise control, non-minimizable at OS level) — Maximise/Restore and Close remain.
- Q: How to keep keys from sprawling again? → A: A **standing usage guard** — every token must have ≥1 live consumer AND ≥1 test asserting it is applied, and must obey the naming/description convention; violations fail the build.

### Session 2026-07-20 (follow-up defects)

- Q: The "Set to default value" affordance never enables for icon size, scrollbar width, or button typography. → A: The reset predicate wrongly treated a field the theme leaves **unset** as not resettable; such a field's default is *inherit*, so it is overridden once the user pins a value and Reset clears it back (FR-037). Bundled themes now also carry concrete size defaults (FR-038).
- Q: The icon-size control doesn't move the preferences window's own top action icons. → A: Those icons were pinned at 14px; they now honour the icon-size token (FR-039).
- Q: Scrollbar width affects no scrollbars (#130). → A: A global `scrollbar-color` forced overlay scrollbars that ignore the webkit width; the app now uses classic webkit bars app-wide so the width reaches every surface — modals, editors, terminals (FR-040).
- Q: Button font size / bold / casing / italic / underline / strikethrough apply to no buttons. → A: The shared `button` typography role now applies to **all** text buttons; primary buttons no longer hard-code weight; icon glyphs are shielded. **Base only** — the three types share one typography and differ by colour (no per-type typography overrides) — chosen to fix the bug without re-introducing key sprawl (FR-041).
- Q: The Preferences window should stay on top but let me use the main window while editing themes. → A: Make it **non-modal** — parented (stays above main) but no longer disabling other windows (FR-042). Supersedes 007's app-modal behaviour.
- Q: Preference sliders snap back to the old value on release (#131). → A: The displayed position followed the debounced write; it now holds the dropped value until the write lands — debounce the write, not the display (FR-043).

### Session 2026-07-20 (second review)

- Q: Button underline/italic/strikethrough leak onto project names, tab/panel counts, action icons and picker rows. → A: The base button typography was on the `button` element; `text-decoration` propagates unstoppably to descendants. Scope button typography to the **text-only dialog buttons** and never to the `button` element (FR-044).
- Q: Reorder/regroup buttons in the editor. → A: base button styles into a **General · Buttons** subsection above the type groups; type order **Confirm, Cancel, Destroy**; each type's colours ordered **BG, Border, Text, Hover BG, Hover Border, Hover Text** (FR-045).
- Q: "Danger Text", "Primary Accent", "Success Accent" seem to do nothing. → A: All three are LIVE but conditional/subtle (danger text = hover-only on Close/remove; accent = overwritten by the project colour at runtime, Principle I; success = loaded dots + success notices). Fix the DESCRIPTIONS, not the behaviour (FR-050).
- Q: Editor Bold makes text less bold when the base bold weight is low; make it a boldness slider. → A: Every role's Bold checkbox becomes an unset-by-default **weight slider** (100–900); roles that ship bold keep an explicit default weight so nothing changes at rest (FR-046).
- Q: Editor casing/italic/underline/strikethrough are irrelevant. → A: The editor role drops them — family, size, weight only (FR-047).
- Q: Function Name Text doesn't work (functions show as variables). → A: First-class grammars are correct; ~10 legacy StreamLanguage languages tag function names as variables. A decoration overlay colours function positions in those languages (FR-051).
- Q: Active Panel Border stays green; there needn't be a separate file-explorer highlight. → A: `activePaneHighlight` and `activePanelBorder` consolidate to ONE shared token used app-wide; while a project is open its colour paints the highlight everywhere (Principle I), the token is the fallback (FR-048).
- Q: Pane Title/Tab/Panel Bold behave oddly; Pane Text doesn't reach an empty sub-workspace pane; distinguish panel-header styling. → A: All panes share Pane Text (including the sidebar empty lists); the panel-header role is relabelled "Panel Header …" (FR-049); the Bold→weight change (FR-046) fixes the odd bold behaviour.
- Q: Dropdowns are themed inconsistently; controls use panel styling. → A: All dropdown/menu popups share ONE theming (menu card + Menu Highlight + text-on-highlight); closed controls/fields use Field Surface, never a pane/app background (FR-052).
- Q: Preferences/dialogs should just use the app font. → A: Remove the `dialog` typography role; the preferences window and modals inherit the base application font (FR-053).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find a token by the area it affects (Priority: P1) — SHIPPED

Tokens render under headings named for the **area of the application** each relates to (General first, Icons last, `Editor · Syntax` nesting), rather than as one flat `Colours` list.

**Acceptance**: Opening the Themes editor shows tokens under area headings in a deliberate order; a single-area token appears under that area only; a shared/app-wide token appears under its dominant area or General exactly once.

### User Story 2 - A new token must declare where it appears (Priority: P2) — SHIPPED

The completeness test fails, naming the token, if a token has no explicit area assignment (it takes a sentinel area outside the closed set).

### User Story 3 - Search finds a token regardless of its group (Priority: P3) — SHIPPED

Typeahead search finds a token by name fragment irrespective of its group; results span every matching group.

### User Story 4 - Search by section name (Priority: P2) — SHIPPED

Typing an area/section name returns every token in that section (including nested sub-groups), unioned with name matches, in both the Themes and Settings tabs.

---

### User Story 5 - Every token reads clearly and consistently (Priority: P1)

A user editing a theme sees, for every token, a **self-describing label** (`<Context> <Property>`, e.g. "Editor Font Size", "Terminal Text", "Confirm Button Hover Background") and a **one-sentence description** that names the concrete UI element it colours and when. Ambiguous bare labels ("Size") and self-referential descriptions ("the X colour token") no longer exist. The `<Property>` word comes from a single fixed vocabulary, so the same concept is named the same way everywhere.

**Why this priority**: The whole point of grouping is navigability; inconsistent, ambiguous names undo it. This is the convention the rest of the refactor is measured against.

**Independent Test**: For every editable token, assert the label matches `<Context> <Property>` with `<Property>` from the fixed vocabulary, and the description is non-empty, present-tense, and not derivable from the identifier. A violating token fails the build, named.

**Acceptance Scenarios**:

1. **Given** any editable token, **When** its label is rendered, **Then** it is self-describing and unambiguous read alone (as in a cross-group search result).
2. **Given** any editable token, **When** its description is read, **Then** it names the UI element it colours and agrees with the label; it is never self-referential.

---

### User Story 6 - One concept, one token — consolidated surfaces (Priority: P1)

Surface tokens are consolidated so each UI concept has exactly one home:

- `menuSurface` is **removed**; menu/dropdown cards use **Active Surface** (`surfaceActive`).
- `dialogSurface` is **removed**; modal/notice/dialog cards use **Panel Surface** (`surface`).
- The **Files & Folders** pane uses the **Side Panel Background** (formerly `sidebarBg`), the same token as the projects sidebar — not `surface`.
- **Field Surface** (`inputSurface`) colours **every** form field, including the theme dropdown and all `.ctl` inputs.

**Why this priority**: This is the concrete sprawl reduction the user asked for; it makes the "one concept → one token" rule real.

**Independent Test**: Assert no `menuSurface`/`dialogSurface` token or CSS var remains; menu cards resolve to `surfaceActive`, dialog cards to `surface`; the Files & Folders pane and the projects sidebar resolve to the same background token; every `.ctl` field resolves to `inputSurface`.

**Acceptance Scenarios**:

1. **Given** a theme, **When** a context menu / dropdown opens, **Then** its card is coloured by Active Surface.
2. **Given** a modal or notice, **When** it renders, **Then** its card is coloured by Panel Surface.
3. **Given** the Files & Folders pane and the projects sidebar, **When** both render, **Then** they share one background token.
4. **Given** the Preferences Themes tab, **When** the theme dropdown and other fields render, **Then** all are coloured by Field Surface.

---

### User Story 7 - Three button types cover every text button (Priority: P1)

Every **text** action button on a dialog or form is styled by exactly one of three types — **Confirm** (safe), **Cancel** (safe), **Destroy** (destructive confirm) — each exposing six styles (Background, Hover Background, Border, Hover Border, Text, Hover Text), 18 tokens total, grouped under `General · Buttons · <Type>`. Buttons no longer borrow `accent`, `danger`, `dangerText`, `accentText`, or `border`. Icon-only buttons are a separate concern and never use these tokens.

**Why this priority**: Buttons are the most visible controls on every dialog; today their colours come from five borrowed tokens with no border or danger-button token of their own. This makes them explicit and editable in one place.

**Independent Test**: Enumerate every text action button; assert each resolves to exactly one button type's six tokens and to nothing borrowed; assert no icon-only button resolves to any button-type token.

**Acceptance Scenarios**:

1. **Given** a form/dialog, **When** its confirm, cancel, and destructive buttons render, **Then** each uses only its type's tokens, in both rest and hover states.
2. **Given** an icon-only toolbar button, **When** it renders, **Then** it uses none of the three button types' tokens.
3. **Given** the Themes editor, **When** the user opens `General · Buttons`, **Then** the three types are grouped, each with its six styles.

---

### User Story 8 - Every token is used and tested (Priority: P2)

The completeness/quality guard is extended so that **every** token must resolve to at least one live consumer (a CSS variable actually referenced, or a documented TypeScript consumer such as the terminal→xterm tokens) **and** be covered by at least one test asserting it is applied. A token with no consumer, or no test, fails the build, named. This turns the one-off "review every key" audit into a standing rule.

**Independent Test**: Remove a token's only consumer (or its test) → the guard fails naming the token; restore it → the guard passes.

**Acceptance Scenarios**:

1. **Given** the full token set, **When** the guard runs, **Then** it passes only if every token has a live consumer and an assertion test.
2. **Given** a newly added token with no consumer or test, **When** the guard runs, **Then** it fails and names the token.

---

### User Story 9 - Consistent window titles; Preferences cannot be minimised (Priority: P2)

Every window's title (OS title bar and in-app titlebar) reads `<Name> — throng` (suffix), produced by one shared helper. The Preferences window offers only **Maximise/Restore** and **Close** — no minimise control, and it cannot be minimised via the OS/taskbar either.

**Independent Test**: Assert each window's composed title ends with ` — throng`; assert the Preferences titlebar renders no minimise control and its window is non-minimizable, while Main and Sub-workspace keep theirs.

**Acceptance Scenarios**:

1. **Given** Main, Preferences, and Sub-workspace, **When** their titles render, **Then** each is `<Name> — throng` (e.g. `Preferences — throng`).
2. **Given** the Preferences window, **When** its titlebar renders, **Then** there is no minimise control and the window cannot be minimised; Maximise/Restore and Close work.

---

### User Story 10 - Hover never lingers (Priority: P2, bug)

Opening the Themes editor from the cog menu's "Themes" item — which sits directly above the Files & Folders root in z-index — leaves the root row visibly "hovered" for as long as Preferences is open, because the menu closes without the pointer moving and focus leaves for Preferences. After this change, hover visuals are suppressed whenever the main window loses focus or a menu/child window opens, and reappear only on genuine pointer movement over an element.

**Independent Test**: Open Themes from the cog menu → assert the Files & Folders root is not in a hovered visual state while Preferences is open; move the pointer over it → hover appears.

**Acceptance Scenarios**:

1. **Given** the cog menu open over the Files & Folders root, **When** the user clicks "Themes", **Then** the root row shows no hover while Preferences is open.
2. **Given** any element left geometrically under the pointer after an overlay closes, **When** focus is elsewhere, **Then** it shows no hover visual until the pointer actually moves over it.

---

### User Story 11 - The colour picker always opens on screen (Priority: P2, bug)

A colour swatch opened near the right or bottom edge of the window currently clips its picker off-screen (it only flips vertically, never clamps horizontally). After this change the picker reuses the context-menu's flip-and-clamp positioning and always opens fully within the viewport.

**Independent Test**: Open a swatch near the right/bottom edge → assert the picker's bounding box is fully within the viewport.

**Acceptance Scenarios**:

1. **Given** a swatch near the right edge, **When** the picker opens, **Then** it flips/clamps to stay fully visible.
2. **Given** a swatch near the bottom edge, **When** the picker opens, **Then** it opens upward/clamped to stay fully visible.

---

### User Story 12 - Every editable field can be reset to its default (Priority: P1, bug) — follow-up 2026-07-20

Several theme controls showed a permanently-disabled "Set to default value" affordance: icon size and scrollbar width on any bundled theme, and every button typography field on every theme. The reset predicate treated a field the theme leaves **unset** (its default is *inherit*) as "not resettable" — conflating "the default is inherit" with "not a real field". After this change, a field whose shipped default is unset is **overridden once the user pins a concrete value**, and Reset returns it to inherit (clearing the leaf); fields with concrete defaults (icon size, scrollbar width — now carried by every bundled theme) reset to that concrete value.

**Independent Test**: On a bundled theme, change icon size and a button typography attribute → both Reset affordances enable → click each → the value returns to its default and the affordance disables.

**Acceptance Scenarios**:

1. **Given** a bundled theme with an edited icon size, **When** I open its row, **Then** Reset is enabled and restores the shipped size (16).
2. **Given** any theme with button *italic* toggled on, **When** I open its row, **Then** Reset is enabled and clears the override back to inherit.

---

### User Story 13 - Theme controls that did nothing now take effect (Priority: P1, bug) — follow-up 2026-07-20

Three theme controls were emitted as CSS variables but consumed by nothing (or overridden): **icon size** never reached the preferences toolbar's top action icons (pinned at 14px); **scrollbar width** reached no scrollbar but the terminal's (a global `scrollbar-color` put Chromium in overlay mode, which ignores the webkit width — #130); **button font/weight/casing/italic/underline/strikethrough** reached no button (each call site wired only family + weight). After this change all three apply everywhere they should.

**Independent Test**: Change icon size → the preferences toolbar icons resize. Change scrollbar width → scrollbars across the app (modals, editor, lists, terminal) resize. Set button casing to UPPER → every button label uppercases (icon glyphs do not).

**Acceptance Scenarios**:

1. **Given** a larger icon size, **When** applied, **Then** the preferences toolbar's top action icons grow with it.
2. **Given** a larger scrollbar width, **When** applied, **Then** an arbitrary scrollable surface shows a classic bar of that width (not a 0-width overlay).
3. **Given** button Bold / casing / italic / underline set, **When** applied, **Then** every text button reflects them and no icon glyph is mangled.

---

### User Story 14 - Edit a theme while using the app (Priority: P1) — follow-up 2026-07-20

The Preferences window was app-modal: opening it disabled every other window, so a theme could not be watched against a live, interactive application while being edited. After this change Preferences is **non-modal** — it floats above the main window (parented, so it stays on top) but the main window and sub-workspaces stay fully interactive, so theme edits can be previewed against real use.

**Independent Test**: Open Preferences → the main window is still enabled (interactive) and the Preferences window is parented above it; interacting with the main window does not hide Preferences.

**Acceptance Scenarios**:

1. **Given** Preferences is open, **When** I click into the main window, **Then** it responds and Preferences stays above it.
2. **Given** Preferences is open, **When** I read the window state, **Then** the main window reports enabled (non-modal).

---

### User Story 15 - Sliders don't snap back on release (Priority: P2, bug, #131) — follow-up 2026-07-20

Releasing a preference slider made the thumb briefly jump back to the previous value, then forward to the dropped one: the displayed position followed the **debounced write** rather than local UI state, so it rendered the stale value until the write round-tripped. After this change the thumb holds the dropped position immediately; only the value *write* is debounced, not the control's displayed position.

**Independent Test**: Drag a slider and release → the thumb stays at the dropped position with no visible revert; the value persists.

**Acceptance Scenarios**:

1. **Given** a slider dragged to a new value, **When** I release, **Then** the thumb stays where I dropped it and never shows the old value.

---

### Edge Cases

- **`surface` (former `panelSurface`, #62)** stays a known overload; after Files & Folders leaves it, it colours workspace panel-boxes and dialogs. Its overload resolution remains #62's problem.
- **A user theme saved before this change** loads through the migration (US-migration below): removed keys are dropped, new keys (the 18 button tokens especially) are seeded from the old→new mapping, so it keeps its appearance without manual editing. **Intended exception (M1)**: a theme that had customised `menuSurface`/`dialogSurface` to *differ* from `surfaceActive`/`surface` will now show menus at Active Surface and dialogs at Panel Surface — that visual convergence is the whole point of the consolidation (the user asked for these to be one colour), so migration deliberately folds in no compensating diff.
- **`accent` is overwritten at runtime** by the active project's colour. Any token that previously followed `accent` (e.g. the old confirm button hover) must be given an explicit button token so button appearance no longer tracks the project colour unless intended.
- **An icon-only button on a dialog** (e.g. a per-row remove) is not one of the three text button types and keeps its `hoverSurface`-based styling.

## Requirements *(mandatory)*

### Functional Requirements — grouping & search (SHIPPED; unchanged)

- **FR-001**: The Themes editor MUST present its tokens grouped by the **area of the application** each relates to, not by token type.
- **FR-002**: All **icon tokens** MUST be collected under a single **Icons** area group.
- **FR-003**: The area groups MUST be a **fixed, closed named set** enumerated in one place and enforced by the completeness test (required core: General, Editor, Main panel / workspace, Sub-workspace, Terminal, File Explorer, Preferences, Icons; plus Projects / sidebar and Search).
- **FR-003a**: A dense area MAY use the **"Parent · Child"** sub-grouping convention (e.g. `Editor · Syntax`); a token still belongs to exactly one group string.
- **FR-004**: Groups MUST render in a deliberate, stable order — **General first**, then by prominence, **Icons last**.
- **FR-005**: **General** MUST contain only genuinely application-wide tokens, by **explicit** assignment.
- **FR-006**: Every token MUST belong to **exactly one** group.
- **FR-007**: A token used across areas MUST be filed under its **primary area** once; only a token with no dominant area falls to General.
- **FR-008**: Group assignment MUST be **metadata on the token registry**.
- **FR-009**: The **completeness test** MUST fail the build if any token's derived area is unassigned/unrecognised or outside the fixed set.
- **FR-010**: The completeness-test failure MUST **name** the offending token.
- **FR-013**: Typeahead search MUST find a token by name regardless of its group.
- **FR-015**: Grouped search MUST also match **group (section) names**, returning all entries in a matched group (union with name matches, de-duplicated, case-insensitive substring).
- **FR-016**: A match on a **parent** area MUST include its nested **"Parent · Child"** sub-groups.
- **FR-017**: Group-name matching MUST apply to **both** Themes and Settings tabs; it changes search behaviour only, no data.

### Functional Requirements — naming & description convention

- **FR-018**: Every editable token MUST have a **self-describing label** of the form `<Context> <Property>` in Title Case, where `<Property>` is drawn from a **fixed vocabulary defined in one place**. Ambiguous bare labels (e.g. "Size") are disallowed.
- **FR-019**: Every editable token MUST have a **hand-written one-sentence description**, present tense, naming the concrete UI element(s) it colours and when it applies; descriptions MUST agree with the label and MUST NOT be self-referential.
- **FR-020**: The label + description conventions (FR-018/FR-019) MUST be enforced by an automated test that fails the build, naming any violating token.

### Functional Requirements — one concept, one token; usage guard

- **FR-021**: Each UI concept MUST be themed by **exactly one** token; tokens MUST NOT be borrowed across unrelated concepts. *Concrete enforcement*: the surface repoint assertions (FR-023–026), the button exclusion guard (FR-030), and the usage guard (FR-022) are the tests that make this real for the concepts this feature touches; FR-021 is otherwise a design principle, not a single blanket test.
- **FR-022**: The completeness test MUST be extended so every token resolves to **≥1 live consumer** (CSS var reference, or a documented TS consumer) **and** is covered by **≥1 test** asserting it is applied. A token failing either MUST fail the build, named.
- **FR-011** (revised): This feature MAY **add, remove, rename** tokens and **change colour values** where the conventions and consolidation require; all such changes MUST go through the migration (FR-031/FR-032). *(Supersedes the original "no add/remove/rename, no colour change" rule.)*
- **FR-012** (removed): The byte-identical-JSON requirement is **withdrawn** — superseded by FR-031/FR-032 migration.
- **FR-014** (revised): `surface` (former `panelSurface`, #62) is relabelled **"Panel Surface"** and stays in General; resolving its overload remains out of scope (#62).

### Functional Requirements — surface consolidation

- **FR-023**: `menuSurface` MUST be **removed**; every menu/dropdown card surface MUST use `surfaceActive` (Active Surface).
- **FR-024**: `dialogSurface` MUST be **removed**; every modal/notice/dialog card surface MUST use `surface` (Panel Surface).
- **FR-025**: The **File Explorer (Files & Folders) pane background** MUST use the **same token as the projects/sidebar panel** (`sidebarBg`, relabelled "Side Panel Background") and MUST NOT use `surface`.
- **FR-026**: **Field Surface** (`inputSurface`) MUST colour **all** form fields — every `.ctl` input/select/textarea including the Themes tab's theme dropdown — replacing their current use of the app-background token.

### Functional Requirements — button model

- **FR-027**: Every **text** action button on a dialog or form MUST be styled by exactly one of three types: **Confirm** (safe), **Cancel** (safe), **Destroy** (destructive confirm).
- **FR-028**: Each button type MUST expose **six** style tokens — Background, Hover Background, Border, Hover Border, Text, Hover Text (**18 total**) — grouped under `General · Buttons · <Type>`.
- **FR-029**: The legacy `buttonBg`/`buttonText`/`buttonHoverBg`/`buttonHoverText` tokens MUST be **removed**; buttons MUST NOT borrow `accent`, `danger`, `dangerText`, `accentText`, or `border`.
- **FR-030**: The three button types MUST apply **only** to text buttons; **icon-only buttons MUST NOT** use them (they keep `hoverSurface`). A test MUST enforce both directions.

### Functional Requirements — migration

- **FR-031**: Adding/removing/renaming tokens MUST be accompanied by a **migration** that normalises existing on-disk **user themes** to the new key set — dropping removed keys and seeding new keys (especially the 18 button tokens) from a defined **old→new mapping** — so a saved theme keeps its appearance without manual editing.
- **FR-032**: All **bundled themes** MUST be updated to the new key set at source, with button colours derived from each theme's prior intent (Confirm ← accent/accentText, Destroy ← danger/dangerText, Cancel ← legacy button bg/text).

### Functional Requirements — windows

- **FR-033**: Every application window's title (OS title **and** in-app titlebar) MUST use the suffix form `<Name> — throng`, produced by a single shared helper, such that the composed title **always ends with ` — throng`**. Any elevation marker is folded into `<Name>` *before* the suffix (e.g. `<project · context> [ADMIN] — throng`), so the suffix is genuinely last even for the elevated Main window (this matters because CI runs the app elevated). The one exact elevated form is `<project · context> [ADMIN] — throng` (single space each side of `[ADMIN]`). In this branch: Main (`<project · context> — throng`, or `<project · context> [ADMIN] — throng` when elevated), Preferences (`Preferences — throng`), Sub-workspace (`<name> · N tabs · N panels — throng`).
- **FR-034**: The **Preferences** window MUST NOT be minimisable — the minimise control MUST be absent from its titlebar **and** the window MUST be non-minimizable at the OS level; Maximise/Restore and Close remain. Main and Sub-workspace keep their minimise control.

### Functional Requirements — bug fixes

- **FR-035**: Hover visuals MUST NOT persist when the main window loses focus or a menu/child window opens; a hover state stranded by an overlay closing MUST NOT be shown. Hover visuals appear only while the pointer is genuinely over the element.
- **FR-036**: The colour picker MUST always open **fully within the viewport**, flipping and clamping on both axes, reusing the **shared viewport-positioning helper** also used by the context menu (extracted from the current context-menu logic).

### Functional Requirements — follow-up defects (2026-07-20)

- **FR-037**: The per-token **Reset** predicate MUST treat a theme field whose **shipped value is unset** as having an *inherit* default rather than "not resettable": such a field is **overridden** exactly when the current theme pins a concrete value, and Reset MUST return it to inherit by clearing the leaf. Fields with a concrete shipped default reset to that value. (This is specific to theme tokens, whose editable set is derived from the schema; the settings/keybindings predicates — where a missing path means "not a real key" — are unchanged.)
- **FR-038**: Every **bundled theme** MUST carry the non-colour **size** measurements (`sizes.iconPx`, `sizes.scrollbarPx`) with the same concrete defaults `throng` ships (16 / 12), so the per-token Reset has a concrete baseline on every theme. This changes no appearance (the values are throng's own).
- **FR-039**: The **icon size** token (`sizes.iconPx`) MUST size the **preferences window's own chrome icons** (the toolbar's top action icons), not only the main window's — no surface may pin a fixed icon size that the control cannot move.
- **FR-040** (#130): The theme's **scrollbar width** MUST apply to **every** scrollbar in the application (panes, modals, lists, editor, terminal). Because the standard `scrollbar-width` property cannot take a pixel measurement and the standard `scrollbar-color` property silences the `::-webkit-scrollbar` pseudo-elements that can, the application MUST style scrollbars via the **legacy webkit pseudo-elements app-wide** (classic non-overlay bars that occupy real layout width) and MUST NOT set a global `scrollbar-color`. A guard MUST fail the build on any real (non-`auto`) `scrollbar-color`.
- **FR-041**: The shared **button typography** role MUST apply to **all** text buttons — family, size, weight (the Bold toggle), casing, italic and under/strike — declared once so no button is left with only a subset. No text button may hard-code a font weight (which would defeat the Bold toggle). Icon-only buttons' **glyphs** MUST be shielded from casing/italic/decoration and sized from the icon-size token. (Base-only: the three button *types* share one typography and differ only by colour — no per-type typography overrides.)
- **FR-042**: The **Preferences** window MUST be **non-modal**: opening it MUST NOT disable any other window. It stays **parented** to the main window (so it floats above it and minimises/restores with it) while the main window and sub-workspaces remain interactive. *(Supersedes the app-modal `setEnabled(false)` behaviour of 007 FR-013/FR-014; FR-034's non-minimisable rule is unchanged.)*
- **FR-043** (#131): A slider's **displayed position** MUST reflect the pointer immediately and hold the dropped value until the committed write round-trips back; only the **value write** may be debounced. The control MUST NOT render the pre-commit value during the debounce window (no snap-back).

### Functional Requirements — second review (2026-07-20)

- **FR-044**: Button typography MUST apply to the **text-only** dialog/form buttons ONLY (via their specific selectors), never to the `button` element. (`text-decoration` propagates to descendants and cannot be cancelled by a child, so a broad `button` rule underlines project names, tab/panel counts, icon glyphs and picker rows. A guard MUST fail the build on button-font tokens set on a bare `button` selector.)
- **FR-045**: The Themes editor MUST render the base button typography as a **General · Buttons** subsection **above** the three type colour groups; the type groups MUST order **Confirm, Cancel, Destroy**; each type's six colours MUST order **Background, Border, Text, Hover Background, Hover Border, Hover Text**.
- **FR-046**: Each typography role's boldness MUST be an **unset-by-default numeric weight** (100–900), rendered as a slider — replacing the boolean `bold`. Unset tracks `fonts.weights.normal`. Roles that shipped bold (pane titles, panel titles, project names) MUST ship an explicit default weight so appearance is unchanged at rest. The migration MUST convert an existing `bold` boolean to the exact weight it resolved to.
- **FR-047**: The **editor** role MUST offer family, size and weight only — casing, italic, underline and strikethrough controls are removed (source text is not prose). The migration MUST strip those fields from an existing editor override.
- **FR-048**: The File Explorer's `activePaneHighlight` MUST be consolidated onto a **single** active-pane highlight token used by the File Explorer **and** the workspace panels. While a project is open the highlight MUST follow that project's colour in both (Principle I); the token is the no-project fallback. The migration MUST fold `activePaneHighlight` onto the survivor.
- **FR-049**: **Pane Text** MUST reach the body text of **every** pane and panel — including the sidebar's empty Projects and Sub-workspaces lists — and MUST NOT style a header. The workspace panel-**header** role MUST be relabelled **"Panel Header …"**, distinct from Pane Text and the sidebar "Pane Title".
- **FR-050**: The descriptions for **Danger Text** (hover-only on the Close / remove controls), **Primary Accent** (overwritten by the active project's colour at runtime) and **Success Accent** (loaded dots + success notices) MUST accurately state where and when each shows. (Behaviour unchanged — these were reported as "doing nothing" because they are conditional/subtle.)
- **FR-051**: **Function Name Text** (`syntaxFunction`) MUST colour function/method names in the legacy StreamLanguage languages (C#, Kotlin, Dart, Swift, Ruby, Lua, PowerShell, Shell) that tag them identically to variables — via a decoration overlay gated to those languages, leaving first-class grammars (JS/TS/Python/…) untouched.
- **FR-052**: All dropdown/menu **popups** MUST share one theming — the menu card surface, the Menu Highlight for the hovered row, and the text-on-highlight colour — regardless of dropdown type. Closed controls and fields (including a menu's own filter input) MUST use **Field Surface**, never a pane or application background.
- **FR-053**: The **`dialog` typography role MUST be removed**; the preferences window and all modals inherit the base application font (`--throng-font-*`). The migration MUST drop `typography.dialog`.

### Key Entities

- **Area group**: as FR-003 (unchanged), plus the nested `General · Buttons · {Confirm, Cancel, Destroy}` sub-groups.
- **Token → group assignment**: metadata on each token stating its single area group (unchanged), now covering the 18 button tokens under General · Buttons.
- **Token copy**: each token's hand-written `{label, description}` obeying the FR-018/FR-019 convention.
- **Button type**: one of Confirm / Cancel / Destroy, each a fixed set of six style tokens.
- **Surface token set** (post-consolidation): `surface` (Panel Surface), `surfaceActive` (Active Surface, also menu cards), `inputSurface` (Field Surface, all fields), `hoverSurface`, `menuItemHoverSurface` (Menu Highlight), Side Panel Background (shared by sidebar + Files & Folders). `menuSurface` and `dialogSurface` no longer exist.
- **Theme migration**: an old→new key mapping applied to user themes on load and to bundled themes at source.
- **Usage/quality guard**: the completeness test, extended to enforce closed-set grouping, naming/description convention, a live consumer per token, and a test per token.

## Success Criteria *(mandatory)*

- **SC-001**: A user can reach the token for a named part of the app in one step from the group headings (unchanged).
- **SC-002**: 100% of in-scope tokens are assigned exactly one closed-set group; the completeness test passes (unchanged).
- **SC-003**: Adding a token without a group assignment fails the completeness test 100% of the time, naming it (unchanged).
- **SC-005**: No token becomes unreachable by search after the label rewrites. Every token stays findable by its **(unchanged) token key** — which is always part of the search haystack — and by its **new label**; verified against the **renamed** registry, not only the pre-rename one. (A user searching an *old* label string is expected not to match it — the label changed; the guarantee is that no token is orphaned from search.)
- **SC-007**: Typing a section name returns 100% of that section's entries (incl. nested sub-groups) in both tabs (unchanged).
- **SC-004** (replaced): For every user theme, the **migration is lossless** — a theme saved before the change loads after it with every still-existing token's value preserved and every new token seeded per the mapping; no unintended colour drift.
- **SC-006** (replaced): The **only** colour-value changes are the deliberate consolidation/button derivations specified here; no other token changes value.
- **SC-008**: 100% of tokens have ≥1 live consumer and are **referenced within ≥1 test assertion**; the usage guard fails on any token lacking either, naming it. (What counts as "tested": the default-themes completeness assertion — every bundled theme populates every token — satisfies value-bearing tokens; behavioural tokens additionally carry applied-style E2E checks. "Present in a file with no assertion" does not count.)
- **SC-009**: 100% of text action buttons resolve to exactly one button type's six tokens and to nothing borrowed; 0% of icon-only buttons resolve to a button-type token.
- **SC-010**: 100% of form fields (incl. the theme dropdown) resolve to Field Surface.
- **SC-011**: 100% of windows' composed titles end with ` — throng`.
- **SC-012**: The Preferences window exposes no minimise affordance (UI absent, OS non-minimizable); Maximise/Restore and Close work.
- **SC-013**: After opening Themes from the cog menu, the Files & Folders root shows no hover visual while Preferences is open.
- **SC-014**: A colour picker opened at any window edge stays fully within the viewport.
- **SC-015**: **Automated** — 100% of token labels match `<Context> <Property>` with `<Property>` from the fixed vocabulary, and 100% of descriptions pass the machine-checkable rules (≥20 chars, not self-referential, ≠ mechanical copy) — enforced by the convention guard, build-failing. **Reviewed** — the human-judged qualities (present tense, names a *real* UI element) are confirmed by author + code-review, not claimed as automated; the guard cannot verify tense or element-existence.
- **SC-016** (FR-037/FR-038): On a bundled theme, both an icon-size edit and a button-typography edit make Reset **enabled**, and clicking it returns the value to its default (concrete 16/12 for sizes, inherit for typography) and disables Reset — 0% of these fields report a permanently-disabled Reset.
- **SC-017** (FR-039): Changing the icon size **visibly resizes the preferences toolbar's top action icons**; no icon in the chrome is pinned to a fixed size the control cannot move.
- **SC-018** (FR-040 / #130): An **arbitrary** scrollable surface shows a classic bar whose measured layout width equals the theme's scrollbar width (a 0-width overlay is a failure); the build fails on any real global `scrollbar-color`.
- **SC-019** (FR-041): 100% of text buttons reflect the button typography role's size/weight/casing/italic/decoration; 0% of icon glyphs are cased/underlined/italicised by it; no text button hard-codes a font weight.
- **SC-020** (FR-042): With Preferences open, the main window reports **enabled** (non-modal) and Preferences is parented above it.
- **SC-021** (FR-043 / #131): A slider dragged and released never renders the pre-commit value; the thumb holds the dropped position and the value persists.
- **SC-022** (FR-044): Setting button underline/italic/casing changes ONLY text-button labels; 0% of project names, tab/panel counts, icon glyphs or picker rows are affected. The build fails on button-font tokens set on a bare `button` selector.
- **SC-023** (FR-045): In the Themes editor the base button typography renders under "General · Buttons" above the type groups; type order is Confirm, Cancel, Destroy; each type's colours read BG, Border, Text, Hover BG, Hover Border, Hover Text.
- **SC-024** (FR-046/FR-047): Every role's weight is a 100–900 slider (no Bold checkbox); the editor exposes no casing/italic/underline/strikethrough control; a pre-existing `bold:true` migrates to the exact weight; the app looks unchanged at rest.
- **SC-025** (FR-048): One active-pane highlight token drives both the File Explorer and workspace panels; with a project open both follow the project colour; with none, both use the token.
- **SC-026** (FR-049): The sidebar's empty Projects and Sub-workspaces lists render in Pane Text; the panel-header role reads "Panel Header …" in the editor.
- **SC-027** (FR-051): A C# (and one other legacy-grammar) function name renders in `syntaxFunction`; a plain variable stays `syntaxVariable`; JS/TS function colouring is unchanged (no overlay).
- **SC-028** (FR-052): Every dropdown popup uses the same card/highlight/text-on-highlight; a menu's filter input uses Field Surface.
- **SC-029** (FR-053): No `dialog` role exists; changing the base font moves the preferences window and modals; `--throng-font-dialog-*` is read nowhere.

## Assumptions

- **The area-grouping and section-search work (US1–US4) already shipped** and is unchanged by this rewrite; the follow-on refactor is layered on top under the same feature/PR.
- **Grouping remains presentation, derived from the registry, not persisted.** Only token *values* are persisted; grouping/labels/descriptions are model metadata.
- **The "byte-identical / nothing renamed" contract is intentionally dropped.** Migration (FR-031/FR-032) is the replacement guarantee; user themes are normalised without manual edits.
- **"About throng" is out of scope** — it lives on the #21 packaging branch and already follows the convention; only Main, Preferences, and Sub-workspace are retitled here.
- **Icon-only buttons are out of the button-model scope** — the three text button types deliberately exclude them; they keep `hoverSurface`.
- **The exact old→new colour mapping and the fixed `<Property>` vocabulary are finalised in planning**, obeying: self-describing labels, one-concept-one-token, primary-area-wins, General-only-for-app-wide, and lossless migration.
- **The hover fix's precise mechanism** (focus-gated hover suppression vs. overlay-open suppression) is pinned during implementation via systematic debugging; FR-035 fixes the behaviour regardless of mechanism.
- **The existing completeness/quality test suite is the enforcement point** for the new guards (FR-020/FR-022) — extended, not replaced.
