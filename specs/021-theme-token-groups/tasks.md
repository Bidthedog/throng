# Tasks: Theme token grouping, naming conventions & consolidation

**Feature**: `021-theme-token-groups` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

**Discipline**: Test-first (constitution Principle V, NON-NEGOTIABLE). Every behaviour change lands a
failing test first, run and confirmed red *for the right reason*, then the implementation makes it
green. Grouping and search are pure `@throng/core` functions → unit layer; the rendered headings and
live section-search → one E2E pass.

**Test layers in this repo**: `vitest` `unit` (node env, resolves `@throng/*` to TS source — no build);
Playwright-Electron `e2e` (needs `npm run build`). There is no jsdom/component layer, so UI-visible
behaviour is proven in E2E; the logic beneath it is proven in unit.

---

## Phase 1: Setup

- [x] T001 Confirm the green baseline before touching code: `npm run lint`, `npm run typecheck`,
  `npm run test:unit` all pass (recorded: unit 1199 pass, lint/typecheck clean). No new dependencies.

## Phase 2: Foundational

No foundational/blocking tasks. US4 (search) and US1/US2 (grouping) are independent core changes; US3
is a regression guarantee proven within the US1/US4 phases. Proceed straight to the stories.

---

## Phase 3: User Story 4 — Search by section name (Priority: P2)

**Goal**: A query matching a section name returns every field in that section (both tabs), unioned with
name matches, sub-groups included. **Independent test**: type a group name that no field's own name
contains and get the whole section back.

- [x] T002 [US4] RED: extend `packages/core/tests/unit/settings-search.test.ts` — add group-bearing
  `SearchableField`s and assert: (a) `fieldHaystack` includes `group` lowercased (incl. an
  `Editor · Syntax` field containing `editor · syntax`); (b) `filterFields('editor', …)` returns every
  field whose group is `Editor` or `Editor · Syntax` even when its name/description/value lack "editor",
  de-duplicated; (c) a field with `group` undefined behaves exactly as today (no throw, group adds
  nothing). Keep the existing group-less `THEME`/`HOVER`/`GLOBS` cases green.
- [x] T003 [US4] Run `npm run test:unit -- settings-search` and confirm the new assertions fail for the
  right reason (group not yet in the haystack), the pre-existing ones still pass.
- [x] T004 [US4] Implement in `packages/core/src/config/settings-search.ts`: add `group?: string` to
  `SearchableField` (optional — a group-less caller like the icon-pack row must still satisfy it) and
  include `${field.group ?? ''}` in `fieldHaystack`. `matchesQuery`/`filterFields` inherit it unchanged.
- [x] T005 [US4] Run `npm run test:unit -- settings-search` → green; run the full `npm run test:unit`
  to confirm no other unit suite regressed (both tabs' descriptors carry `group`, so both gain the
  behaviour with no renderer edit).

## Phase 4: User Stories 1 & 2 — Group by area + closed-set guard (Priority: P1 / P2)

**Goal (US1)**: tokens render under area headings, General first, Icons last, syntax under
`Editor · Syntax`. **Goal (US2)**: the completeness test fails if a token declares a group outside the
closed set. **US3** (name search still works) is asserted here as a non-regression. **Independent
test**: the theme registry groups every token into a closed, ordered area set; a bad group throws.

- [x] T006 [US1] RED: extend `packages/core/tests/unit/theme-metadata.test.ts` — assert
  `THEME_AREA_GROUPS` is the closed ordered set (General first, Icons last); every `THEME_METADATA`
  descriptor's area (part before `" · "`) ∈ `THEME_AREA_GROUPS`; iterating `THEME_METADATA` yields
  areas in `THEME_AREA_GROUPS` order with `Editor` before `Editor · Syntax`; spot assignments
  (`colours.editorGutterBg`→Editor, `colours.terminalFg`→Terminal, `colours.syntaxKeyword`→
  `Editor · Syntax`, `colours.surface`→General, `colours.searchMatch`→Search,
  `colours.railBg`→`Main panel / workspace`, `colours.sidebarBg`→`Projects / sidebar`,
  `colours.activePaneHighlight`→File Explorer, `typography.projectName.family`→`Projects / sidebar`,
  `typography.editor.family`→Editor, `typography.dialog.italic`→Preferences, `icons.terminal`→Icons);
  and **update the stale assertion** `descriptorForThemeToken('colours.appBg').group` from `'Colours'`
  to `'General'`.
- [x] T007 [US2] RED: in the same test file, assert (a) `assertThemeAreaGroups(THEME_METADATA)` does
  not throw and no descriptor carries the `"(unassigned)"` sentinel; (b)
  `assertThemeAreaGroups([{…valid descriptor…, group: 'Nonsense'}])` throws an `Error` naming the key
  and `Nonsense`; (c) **SC-003** — `descriptorForThemeToken('colours.somethingNobodyMapped')` gets the
  `"(unassigned)"` sentinel and `assertThemeAreaGroups` on it throws, naming that key (a new,
  unassigned token fails the build — no silent General default).
- [x] T008 [US1] Run `npm run test:unit -- theme-metadata` and confirm the new assertions fail for the
  right reason (symbols not yet exported; groups still type-based).
- [x] T009 [US1] Implement in `packages/core/src/config/theme-metadata.ts`: add the ordered
  `THEME_AREA_GROUPS` (General, Editor, Main panel / workspace, Sub-workspace, Terminal, File Explorer,
  Preferences, `Projects / sidebar`, Search, Icons); add `areaForToken(key): string | undefined` per
  [data-model.md](./data-model.md) §2 — **explicit-or-fail, no silent default**: icons/iconColour→Icons;
  typography role table (incl. `projectName`/`projectPath`→`Projects / sidebar`); `fonts.*`→General;
  `colours.syntax*`→`Editor · Syntax`; `colours.editor*`→Editor; `colours.terminal*`→Terminal;
  `colours.searchMatch*`→Search; the Main-panel / File-Explorer / Projects-sidebar table
  (`sidebarBg`→`Projects / sidebar`, `activePaneHighlight`→File Explorer); an explicit **General colour
  set** for the app-wide colours; anything else → `undefined`.
  Make `descriptorForThemeToken` set `group: areaForToken(key) ?? '(unassigned)'` (the sentinel is
  outside `THEME_AREA_GROUPS`, so an unplaced token fails the guard).
- [x] T010 [US1] In `packages/core/src/config/theme-metadata.ts`, make `buildThemeMetadata` return the
  descriptors **stably sorted** by `(index of area in THEME_AREA_GROUPS, group string, original index)`
  so rendered sections come out General-first / Icons-last with `Editor` before `Editor · Syntax` and
  intra-area token order preserved.
- [x] T011 [US2] In `packages/core/src/config/theme-metadata.ts`, add
  `assertThemeAreaGroups(registry)` — throws naming every descriptor whose area ∉ `THEME_AREA_GROUPS`.
- [x] T012 [US1] Export `THEME_AREA_GROUPS`, `areaForToken`, `assertThemeAreaGroups` from
  `packages/core/src/index.ts`.
- [x] T013 [US2] Wire the guard into `packages/core/tests/unit/theme-metadata.test.ts`: call
  `assertThemeAreaGroups(THEME_METADATA)` in the completeness describe-block so a future ungrouped or
  mis-grouped token fails the build (FR-009).
- [x] T014 [US1] Run `npm run test:unit -- theme-metadata` → green; then the full `npm run test:unit`
  to confirm the default-theme **byte guards** and every other suite stay green (FR-011/FR-012 — no
  theme value changed).

## Phase 5: E2E — rendered headings + live section-search (US1 + US4)

**Goal**: prove, in the real app, that tokens render under area headings and that section-name search
filters live in both tabs.

- [x] T015 [US1] RED/extend `packages/ui/tests/e2e/preferences-row-actions.e2e.ts` (Themes tab): assert
  the area headings render — `settings-group-General` visible and positioned above `settings-group-Icons`
  (General first / Icons last), and an `Editor · Syntax` section is present. Assert token rows still
  address by key (`theme-row-colours.syntaxKeyword`).
- [x] T016 [US4] RED/extend the Themes search test in the same file: `themes-search.fill('editor')`
  keeps `theme-row-colours.syntaxKeyword` visible (matched by its `Editor · Syntax` group though its
  name lacks "editor"), and a unique-name query (`gutter`) still finds its row (US3 non-regression).
- [x] T017 [US4] RED/extend `packages/ui/tests/e2e/preferences-settings.e2e.ts`: typing a settings
  **group name** (e.g. `Editor`) in `settings-search` returns settings in that group whose own names do
  not contain the word — **including its nested `Parent · Child` children** (`Editor · Indentation`,
  `Editor · Languages`), proving SC-007's nested case in the Settings tab too; a `zzzznothing` query
  still shows the empty state. (FR-017 data-immutability holds because search is read-only by
  construction — no settings/theme write occurs on a search. C2: earlier wording cited "byte guards",
  since withdrawn; the read-only argument stands on its own.)
- [x] T018 Build and run the touched specs: `npm run build` then
  `npx playwright test preferences-row-actions preferences-settings`; confirm green (fix code, not
  assertions, if a heading/order is wrong).

## Phase 6: Polish & Cross-Cutting

- [x] T019 [P] Reconcile docs (constitution v3.10.0): `grep -rin "theme" README.md docs/` for any
  description of the Themes editor. If one describes a flat token list, update it to the area-grouped
  presentation + section search; if none exists, record "nothing to reconcile" in the completion notes.
- [x] T020 Full green gate: `npm run lint`, `npm run typecheck`, `npm run test:unit` (and the E2E from
  T018) all pass; capture the numbers for the completion report.

---

---

# Fold-in refactor (US5–US11) — 2026-07-19

Everything below extends the shipped grouping. Same discipline: RED test at the owning layer → confirm
red for the right reason → implement → green. Layers: pure model/guards/migration → `vitest unit`;
rendered surfaces/buttons/fields/windows/hover/picker → Playwright E2E (needs `npm run build`).

*Note (F4)*: the shipped tasks T014/T017 mention "byte guards / no theme value changed" — that was the
021 byte-identical contract, **withdrawn** by the 2026-07-19 rewrite (FR-012 removed). Those `[x]` tasks
stay as historical record; the replacement guarantees are SC-004'/SC-006' non-drift (T026) — there is no
frozen-value byte guard in the suite to break.

*Note (tags)*: the inline `(F#/I#/U#/…)` markers below reference findings from the specific analyze pass
that prompted each edit; they are scoped to their own task line and are **not** globally unique across the
file — read each only against its own bullet.

## Phase 7: User Story 5 — Naming & description convention (Priority: P1)

**Goal**: every token label is `<Context> <Property>` (Property ∈ fixed vocabulary) and every description
names its UI element, non-self-referential. **Independent test**: the convention guard passes for the
whole registry and fails, naming the token, on a bare or self-referential entry.

- [x] T021 [US5] RED: extend `packages/core/tests/unit/theme-copy.test.ts` — assert (a) a
  `THEME_PROPERTY_VOCABULARY` export is a non-empty closed list; (b) `assertNamingConvention(THEME_METADATA)`
  does not throw; (c) a fabricated descriptor `{label:'Size',…}` (no context) and one with description
  `'The "X" colour token.'` each make it throw naming the token; (d) spot labels — `typography.editor.sizePx`
  → `'Editor Font Size'`, `colours.terminalFg` → `'Terminal Text'`, `colours.accentText` →
  `'Highlighted Option Text'`, `colours.surface` → `'Panel Surface'`, `colours.sidebarBg` →
  `'Side Panel Background'`.
- [x] T022 [US5] Run `npm run test:unit -- theme-copy` → confirm red for the right reason (symbols/labels
  not yet present).
- [x] T023 [US5] Implement in `packages/core/src/config/theme-metadata.ts`: `THEME_PROPERTY_VOCABULARY`
  (data-model §3) and `assertNamingConvention(registry)` (label shape + `<Property>` membership +
  non-empty context; description present-tense, ≥20 chars, not self-referential, ≠ `mechanicalCopy(key)`);
  export both from `packages/core/src/index.ts`.
- [x] T024 [US5] Rewrite `packages/core/src/config/theme-copy.ts` — every `{label, description}` to the
  convention (self-describing label, element-naming description), including the relabels in data-model §3.
  **(C1) `surface` and `surfaceActive` descriptions must name their NEW roles** — `surface` (Panel Surface)
  now also colours modal/dialog/notice cards; `surfaceActive` (Active Surface) now also colours menu/
  dropdown cards — so the description accurately names every element it paints post-consolidation.
- [x] T025 [US5] Wire `assertNamingConvention(THEME_METADATA)` into `theme-copy.test.ts`; **also add an
  SC-005 non-regression assertion (I1)**: after the renames, `filterFields`/`matchesQuery` still resolve
  every token by its **key** and by its **new label** (iterate the registry — no token becomes unreachable
  by search). Run `npm run test:unit -- theme-copy theme-metadata settings-search` → green.

## Phase 8: Foundational — token-model changes + migration (blocks US6/US7 render)

**Goal**: the final token set (remove `menuSurface`/`dialogSurface` + 4 legacy buttons; add 18 button
tokens), a lossless idempotent `migrateTheme`, all 15 bundled themes updated, buttons grouped under
`General · Buttons · <Type>`. **Independent test**: model tests show the new set; migration round-trips
losslessly and idempotently.

- [x] T026 RED: extend `packages/core/tests/unit/theme.test.ts` (and/or `default-themes.test.ts`) — assert
  `THRONG_THEME.colours` contains the 18 `{confirm,cancel,destroy}Button{Bg,HoverBg,Border,HoverBorder,Text,HoverText}`
  tokens and does NOT contain `menuSurface`, `dialogSurface`, `buttonBg`, `buttonText`, `buttonHoverBg`,
  `buttonHoverText`; assert all 15 bundled themes populate every current colour token (extend the existing
  completeness assertion); **and (SC-006', F2) assert non-drift** — every bundled-theme token *outside* the
  removed/button set keeps its exact pre-refactor value (snapshot the surviving colours and diff = 0), so
  the only colour changes are the deliberate button derivations. **(D1) Pin the exact count**: assert
  `THRONG_THEME.colours` has exactly the expected number of tokens (57 − 2 removed surfaces − 4 legacy
  buttons + 18 button tokens = **69**), so the set can't silently drift.
- [x] T027 RED: create `packages/core/tests/unit/theme-migration.test.ts` — assert `migrateTheme` (a) drops
  the 6 removed keys; (b) seeds the 18 button tokens by derivation (Confirm←accent/accentText,
  Destroy←danger/dangerText, Cancel←legacy button*/border with the §6 fallbacks) ONLY when absent; (c) is
  idempotent (`migrateTheme(migrateTheme(x))` deep-equals `migrateTheme(x)`); (d) is lossless (every
  surviving token keeps its exact value); **(e, F1) derive-before-drop** — given a legacy theme WITH
  `buttonBg`/`buttonText`/`buttonHoverBg`/`buttonHoverText`, the `cancelButton*` tokens equal those exact
  legacy values, NOT the `surface`/`surfaceActive`/`text` fallbacks (proves the snapshot precedes the drop).
- [x] T028 Run `npm run test:unit -- theme theme-migration default-themes` → confirm red for the right
  reason.
- [x] T029 Implement `packages/core/src/config/theme.ts`: remove `menuSurface`/`dialogSurface` and the 4
  legacy button tokens; add the 18 button tokens to the `Theme` type + `THRONG_THEME`; update `TOKEN_PARENT`
  (drop `menuSurface`/`dialogSurface`) and `OPTIONAL_THEME_COLOUR_TOKENS` if affected; update all 15
  bundled themes' colours via the §6 derivation (Confirm/Destroy/Cancel).
- [x] T030 Implement `migrateTheme` in `packages/core/src/config/theme-ops.ts` per contract
  `theme-migration.md`: **snapshot the original `colours` first, derive all button tokens from the
  snapshot, then drop the removed keys** (derive-before-drop, F1); export from `packages/core/src/index.ts`.
- [x] T031 Wire migration into the theme **load** path (`theme-ops.ts` load / `theme-reset.ts` restore) so
  any user theme read from disk is migrated before use; keep it idempotent.
- [x] T032 Update `packages/core/src/config/theme-metadata.ts` `areaForToken`: `colours.<type>Button*` →
  `General · Buttons · {Confirm|Cancel|Destroy}`; remove `menuSurface`/`dialogSurface`/legacy `button*`
  from the General colour set (data-model §2c); add convention copy for the 18 tokens in `theme-copy.ts`
  AND **delete the copy entries for the 6 removed tokens** (F3); add a guard (in `theme-copy.test.ts`)
  asserting every `THEME_TOKEN_COPY` key maps to a live `THRONG_THEME` token — no orphan copy.
- [x] T033 Run `npm run test:unit` (full) → green: token-set, migration, grouping, naming, copy, and the
  15-theme completeness all pass. **Add a group-name search assertion (G1)**: `filterFields` for `Buttons`
  (and `General`) surfaces all 18 nested `General · Buttons · <Type>` button rows, proving FR-016 nesting
  for the new sub-groups too.

## Phase 9: User Story 6 — Surface consolidation (render) (Priority: P1)

**Goal**: menu cards → Active Surface, dialog cards → Panel Surface, Files & Folders → Side Panel
Background, Field Surface on ALL fields. **Independent test**: computed styles resolve to the intended
tokens; no `menuSurface`/`dialogSurface` var remains.

- [x] T034 [US6] Repoint CSS per contract `surface-tokens.md`: replace every `--throng-colour-menuSurface`
  → `--throng-colour-surfaceActive` and `--throng-colour-dialogSurface` → `--throng-colour-surface` across
  `packages/ui/src/renderer/**/*.css` and `theme/tokens.css`; point `.pane--explorer` (`panes.css`) at
  `--throng-colour-sidebarBg`.
- [x] T035 [US6] Repoint all `.ctl` field surfaces (`preferences.css` `.ctl--select/.ctl__input/.ctl__textarea/.ctl__colour-hex`,
  theme dropdown) from `var(--bg)` → `var(--throng-colour-inputSurface)`.
- [x] T036 [US6] RED then green E2E `packages/ui/tests/e2e/theme-fields.e2e.ts` (extend or add): the theme
  dropdown and a settings field have `background-color` equal to the theme's `inputSurface`; a context menu
  card equals `surfaceActive`; a modal card equals `surface`; `.pane--explorer` equals `.pane--sidebar`
  background. **Also (E1, Principle V): assert renamed labels render** in the Themes editor — e.g. a row
  labelled `Editor Font Size` and one `Confirm Button Background` are visible — so the user-facing US5
  relabel has E2E evidence, not unit-only. Build first (`npm run build`).

## Phase 10: User Story 7 — Three-type button model (render) (Priority: P1)

**Goal**: every text dialog/form button uses only its type's six tokens; icon buttons use none.
**Independent test**: computed styles per type (rest+hover); grep guard for exclusion.

- [x] T037 [US7] Rewrite button CSS per contract `button-model.md`: retire `--btn-*`; map
  `confirm-dialog` classes (non-last→Cancel, `.modal__confirm`→Confirm, `.modal__confirm--danger`→Destroy)
  and every raw dialog/form `<button>` (project-form, name-dialog, capture-modal, panel-type-form,
  folder-browse, find-bar, app-close-prompt) to its type's six vars for bg/hover-bg/border/hover-border/
  text/hover-text; remove all borrowed `--accent`/`--danger`/`--throng-colour-accentText`/`--border` on
  themed text buttons.
- [x] T038 [US7] RED then green E2E `packages/ui/tests/e2e/theme-buttons.e2e.ts`: open a dialog with
  Confirm/Cancel/Destroy buttons; assert each button's rest + hover `background-color`/`color`/`border`
  equal its type's tokens; assert an `IconButton` uses none of the button-type vars.
- [x] T039 [US7] Add a static exclusion guard (unit/contract) that greps built CSS: no `IconButton`/window-
  control selector references a `*Button*` var; no retired `--btn-*` or borrowed token remains on a themed
  text button.

## Phase 11: User Story 8 — Standing usage guard (Priority: P2)

**Goal**: every token has ≥1 live consumer AND ≥1 assertion test; removed tokens have zero consumers.

- [x] T040 [US8] RED: create `packages/ui/tests/unit/theme-usage.test.ts` — layer pinned (U1): the ui
  package already has a `vitest unit` dir (`packages/ui/tests/unit/`, e.g. `surface-token-roles.test.ts`)
  that runs under the `unit` project, so the guard lives there and reads CSS from
  `packages/ui/src/renderer/**/*.css` via `fs`. Build the set of
  `--throng-colour-*` vars referenced across `packages/ui/src/renderer/**/*.css` plus the documented TS
  consumers (`terminal-panel.tsx` for `terminal*`, `highlight-style.ts` for `syntax*`/`editorFg`); assert
  every current token (a) has ≥1 consumer and (b) is **referenced inside a test assertion** (I2) — an
  `expect(...)` referencing the token key or its var, which the existing default-themes completeness
  assertion satisfies for value-bearing tokens; mere presence in a file without an assertion does NOT count.
  Assert `menuSurface`/`dialogSurface`/the 4 legacy button tokens have ZERO consumers.
- [x] T041 [US8] Make it green — fix any token the guard flags. **Preflight (U1)**: before turning the guard
  on, inventory currently-uncovered tokens (the 021 audit found *no consumer orphans*, so the consumer half
  is already satisfied; the assertion half is largely covered by the default-themes completeness assertion).
  Remediation may fan out to a handful of value-only tokens (e.g. `statusBarBg`, `unsavedDot`) that need an
  applied-style assertion added — budget for that. Then run `npm run test:unit -- theme-usage`.

## Phase 12: User Story 9 — Window titles + Preferences minimise (Priority: P2)

**Goal**: every window title ends ` — throng`; Preferences cannot minimise. **Independent test**: title
strings + Preferences chrome.

- [x] T042 [US9] RED: `packages/ui/tests/unit/window-title.test.ts` — `windowTitle('Preferences') ===
  'Preferences — throng'`; `windowTitle(x)` always ends ` — throng`; **and the exact elevated form (F1)**
  `windowTitle('MyProj · editor [ADMIN]') === 'MyProj · editor [ADMIN] — throng'` (single space each side
  of `[ADMIN]`, suffix last) — since CI runs elevated and FR-033 makes that spacing load-bearing.
- [x] T043 [US9] Implement `packages/ui/src/renderer/common/window-title.ts` (`windowTitle`); route Main
  (`app.tsx`), Sub-workspace (`subworkspace-app.tsx`), Preferences (`preferences-app.tsx`) OS `setTitle` +
  in-app identity through it; update main-process create-time titles (`main.ts:182/230`,
  `preferences-window.ts:80`) to the suffix form.
- [x] T044 [US9] Add `showMinimise?: boolean` (default true) to `window-controls.tsx`, thread through
  `title-bar.tsx`; pass `false` from `preferences-app.tsx`; set `minimizable:false` on the Preferences
  `BrowserWindow` (`preferences-window.ts`).
- [x] T045 [US9] RED then green E2E `packages/ui/tests/e2e/preferences-window.e2e.ts`, asserting **each
  separately (F5)**: (a) Preferences title === `Preferences — throng`; (b) the Preferences titlebar renders
  **no** `window-min` control (count 0); (c) the Preferences window is non-minimizable at the OS level
  (`BrowserWindow.isMinimizable() === false` via a main-process probe/IPC) — (b) and (c) are distinct
  assertions so a pass can't hide one half; (d) Main + Sub-workspace still render `window-min` and their
  titles **`endsWith(' — throng')`** (F1: not a fixed string — elevated Main folds `[ADMIN]` before the
  suffix, which must still be last; CI runs elevated). Build first.

## Phase 13: User Story 10 — Stranded hover (bug) (Priority: P2)

**Goal**: hover never lingers when the main window is blurred or an overlay opened. **Independent test**:
open Themes from the cog → root not hovered while Preferences open.

- [x] T046 [US10] Reproduce + pin the mechanism (systematic-debugging): confirm the Files & Folders root
  stays `:hover` after the cog "Themes" click opens Preferences; record the exact focus/overlay signal.
- [x] T047 [US10] RED: E2E `packages/ui/tests/e2e/hover-suppression.e2e.ts` — (a) the reported path: hover
  the root, open cog → Themes; assert the root row's hovered background is NOT applied while Preferences is
  open; **(b) the general case (F3, FR-035 scenario 2)**: hover any element, then open+dismiss a context
  menu over it (or blur the window) so the element is left geometrically under the pointer with the window
  unfocused — assert no element retains a hovered background until a real `pointermove` with the window
  focused restores it.
- [x] T048 [US10] Implement the hover gate: set `data-window-blurred` on `<body>` on window blur / child-
  window open, clear on focus + first `pointermove`; scope hover-background CSS under
  `body:not([data-window-blurred])`. Green.

## Phase 14: User Story 11 — Colour picker clamp (bug) (Priority: P2)

**Goal**: the colour picker always opens fully on-screen. **Independent test**: picker near an edge stays
within the viewport.

- [x] T049 [US11] Extract the context-menu positioner into a shared
  `packages/ui/src/renderer/common/clamp-to-viewport.ts` (`clampToViewport(anchorRect, size, viewport)`);
  refactor `workspace/context-menu.tsx` to use it (no behaviour change). **(I1) Regression guard**: add a
  unit test for `clampToViewport` (flips/clamps on both axes) and keep the existing context-menu E2E green;
  if no context-menu positioning E2E exists, add one asserting the menu stays on-screen near an edge.
- [x] T050 [US11] RED then green E2E `packages/ui/tests/e2e/colour-picker.e2e.ts`: open a swatch on a row
  near the right edge → the picker's bounding box is fully within the viewport; same near the bottom edge.
  Implement by replacing `colour-picker.tsx`'s vertical-only flip with `clampToViewport`.

## Phase 15: Polish & cross-cutting

- [x] T051 [P] Reconcile docs (constitution v4.0.0 documentation-currency; no ROADMAP obligation): update
  any README/`docs/` description of theme keys, the Themes editor, or window titles to match the new
  convention/consolidation. T019 already reconciled the *grouping presentation* — this task covers only the
  refactor deltas (renamed keys, consolidated surfaces, button types, suffix titles); record "nothing to
  reconcile" if none.
- [x] T052 Full green gate: `npm run lint`, `npm run typecheck`, `npm run test:unit`, and the touched E2E
  specs (`npm run build` then `npx playwright test`) all pass; capture the numbers for the report.

## Phase 16 — Follow-up defects (2026-07-20, US12–US15 / FR-037–FR-043)

A defect pass on the same feature/PR after the user's second review. Root-caused via systematic-debugging
(see data-model §11); each fix RED → green.

- [x] T053 [P] Reset for inherit-based fields (FR-037, US12): `isThemeTokenOverridden` (core) treats a
  shipped-unset leaf as "default = inherit" — overridden iff the current theme pins a concrete value; reset
  clears back to inherit. RED: `overridden.test.ts` cases (shipped-unset accent; `typography.button.italic`).
- [x] T054 [P] Sizes baseline (FR-038, US12): `makeTheme` emits `sizes: {...THRONG_THEME.sizes}` on every
  bundled theme. RED: `default-themes.test.ts` asserts every bundled theme carries `sizes.iconPx/scrollbarPx`.
- [x] T055 Icon size in Preferences chrome (FR-039, US13): `.prefs-toolbtn--icon` honours `--throng-size-icon`
  (unpin 14px; box scales). Guard: `button-typography-coverage.test.ts` sibling + `.icon` size via base rule.
- [x] T056 Scrollbar width app-wide (FR-040, US13, #130): drop global `scrollbar-color`; classic webkit bars
  carry colour + width everywhere. RED: `scrollbars.e2e.ts` measures an arbitrary surface's bar width; unit
  `scrollbar-webkit-coverage.test.ts` forbids any real `scrollbar-color`.
- [x] T057 Button typography app-wide (FR-041, US13, base-only): base `button {}` consumes all six font vars;
  `.icon` resets casing/italic/decoration; remove hard `font-weight:600`. Guard: `button-typography-coverage.test.ts`.
- [x] T058 Non-modal Preferences (FR-042, US14): remove `setEnabled(false)`/`enableAllWindows`; keep `parent`.
  RED: `titlebar-chrome.e2e.ts` asserts `main.isEnabled()===true` while prefs open.
- [x] T059 Slider no snap-back (FR-043, US15, #131): `NumberControl` holds the dropped value until the write
  round-trips (sync effect keyed on `[value]`). Existing `preferences-slider.e2e.ts` proves the persist path.
- [x] T060 [P] Docs: spec (US12–15, FR-037–043, SC-016–021, clarifications), data-model §11, quick-start
  (non-modal note). Full green gate re-run (unit 1311, integration+contract 401, touched E2E 21).

---

## Dependencies & order

- **Shipped**: Phases 1–6 (US1–US4). Refactor phases 7–15 build on them.
- Phase 7 (US5) sets the naming vocabulary the rest reuses → do first.
- **Phase 8 is the linchpin** (token-model + migration): Phases 9, 10, 11 depend on the final token set.
- Phases 12 (windows), 13 (hover), 14 (picker) are independent of the theme-token work and of each other.
- Phase 15 depends on everything.
- Within every story: RED → confirm red → implement → green, strictly.

## Parallel opportunities

- Phases 12/13/14 (windows, hover, picker) touch disjoint files and can be built in parallel once Phase 7
  is green.
- T051 (docs) is `[P]`.
- Phase 8 must complete before Phases 9–11 (they consume its token set).

## MVP scope

Phase 7 (naming) + Phase 8 (token model + migration) + Phases 9–10 (surfaces + buttons render) is the
core of the refactor. Phases 11–14 (usage guard, windows, two bug fixes) complete the user's list.
