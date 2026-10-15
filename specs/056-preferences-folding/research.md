# Research: Fold and Unfold Preferences Sections (056)

Every decision below was settled from the code; none needed outside research. Paths are repo-relative.

## R1 — Where fold state lives

- **Decision**: renderer `localStorage`, one key `throng.preferences.folds`, holding a JSON object with one
  array of folded heading keys per tab (`settings`, `keybindings`, `themes`). It is read once when a tab
  mounts and written on every user fold change.
- **Rationale**: FR-011 calls for hidden per-user UI state that survives restarts and is not a setting.
  `localStorage` is already throng's home for exactly that:
  - side-pane widths (`renderer/util/use-resize.ts`) and pane visibility (`panes/use-persisted-bool.ts`);
  - explorer tree expansion, which is itself persistent fold state (`explorer/use-explorer-data.ts:155`,
    recorded as precedent in spec 019).

  The Preferences window loads the same `index.html` from the same `file://` origin
  (`main/preferences-window.ts:190`), so its storage lives under Electron `userData` and survives
  restarts. E2E launches get their own `--user-data-dir` (`tests/e2e/harness.ts:251`), so fold state cannot
  leak between independently launched apps.
- **Alternatives rejected**:
  - **A `settings.json` internal key** (`SETTINGS_INTERNAL_KEYS`). Every fold click would go through the
    atomic config write path and the hot-reload watcher. It would also put UI state in a document the
    user edits by hand. FR-011 says it is not a setting.
  - **A daemon DB table**, like 046's `project_categories.minimised`. That table holds domain data owned
    by the daemon. Preferences folds are window chrome, and a daemon round trip per click buys nothing.
  - **A new main-process JSON file**, like `window-state.ts`. That needs new IPC and a new store for one
    key, where an established renderer mechanism already exists.
- **Constitution note**: the "Per-user local storage" rule requires persistent state in the user's profile
  with an owner key. `localStorage` sits in the per-OS-user `userData` profile but has no owner column. It
  has the same standing as the existing `localStorage` users, and the owner is implied by the per-OS-user
  profile directory. See plan Complexity Tracking.

## R2 — Hide, never unmount

- **Decision**: a folded heading keeps its contents mounted and sets the `hidden` attribute on the
  content container.
- **Rationale**: drafts and invalid flags are local `useState` inside each control
  (`form-controls.tsx:283-284, 471-474, 638-639`, `map-control.tsx:110`, `common/colour-picker.tsx:257`).
  Unmounting would discard an invalid entry, which FR-007 forbids ("unfolding shows the row exactly as it
  was left"). `hidden` also takes the rows out of the tab order and the accessibility tree, which is what
  FR-004 requires ("Rows inside a folded heading MUST NOT receive focus").
- **Alternatives rejected**: conditional rendering, which loses state; and lifting every draft into the
  tab, which means invasive changes to five control families.

## R3 — Detecting an invalid hidden row (FR-007)

- **Decision**:
  - The warning reads `[aria-invalid="true"]` inside the heading's content container.
  - It is evaluated when the heading folds, and kept current by a `MutationObserver` on that container,
    filtered to the `aria-invalid` attribute.
  - The observer runs only while the heading is folded.
  - Every control family that shows an invalid state MUST set `aria-invalid`. Today `NumberControl` does
    (`form-controls.tsx:434-436`). `TextControl`, `JsonArrayControl`, `MapControl` and `ColourField` are
    audited and given it where they lack it.
- **Rationale**: `aria-invalid` is already the one signal a parent can observe, and it is the correct
  accessibility semantics anyway. Threading an `onValidityChange` prop through four control families would
  duplicate state the DOM already carries.
- **Why the observer**: while a heading is folded the user cannot edit its rows, but a hot-reload can still
  clear a `TextControl` error (`form-controls.tsx:477-481`). The observer keeps the marker truthful. It is
  attribute-filtered and attached only to folded containers, so it does no work on the input path
  (Principle XII).

## R4 — Heading identity and the per-tab namespace

- **Decision**:
  - A heading key is `JSON.stringify([group])`, `JSON.stringify([group, subgroup])` or
    `JSON.stringify([group, subgroup, subsection])`.
  - The key is stored inside its tab's array, never derived from `data-testid`.
  - The Themes tab's hand-built Icons section uses the key `["Icons"]` in the `themes` namespace.
- **Rationale**: names contain spaces, `·`, `/` and `-`. The Themes tab borrows the Settings tab's
  `settings-group-` test-id prefix (`themes-tab.tsx:647-658`), so `settings-group-Editor` exists on both
  tabs. A JSON array cannot collide or be ambiguous, and the per-tab namespace keeps FR-010 true.
- **FR-011a falls out**: the store holds only *folded* keys. A key naming a vanished heading matches
  nothing and is ignored. A new heading has no key, so it opens unfolded. Stale keys are pruned on the next
  write for that tab.

## R5 — Counts (FR-006)

- **Decision**:
  - A pure helper `groupCounts(groups)` beside `groupDescriptors` in `preferences/group-descriptors.ts`
    returns the row count per heading key (a heading counts its descendants).
  - Each tab computes **totals** once from its unfiltered registry (`useMemo`) and **matches** from the
    filtered `groups` it already builds.
  - The label is `formatGrouped(total)` without a search, and `` `${formatGrouped(matches)} of ${formatGrouped(total)}` ``
    under an active search (constitution: displayed quantities are digit-grouped).
  - Icons section: total = `ICON_TOKENS.length + 2` (pack and colour rows); matches from its existing filter.
- **Rationale**: the counts fall out of structures that already exist, and the search is already debounced
  (150 ms). No new work runs per keystroke.

## R6 — Search interaction (FR-008, FR-009)

- **Decision**:
  - **While the debounced `applied` query is non-empty**: every rendered heading is unfolded, apart from
    toggles made during this search. Those toggles live in a transient `searchFolds` set, which resets
    whenever `applied` changes.
  - **When `applied` returns to `''`**: `searchFolds` is discarded and the persisted state renders again.
  - Persisted state is never written during a search.
- **Rationale**: the persisted set is never touched by a search, so "restore the pre-search state" needs no
  snapshot at all. The snapshot entity in the spec is satisfied by leaving the persisted set unchanged.

## R7 — The heading control and icons

- **Decision**:
  - One shared component, `FoldHeading`, renders `<hN><button aria-expanded aria-controls>`, containing:
    - the `chevron` icon, rotated when open (the 046 category-header precedent,
      `sidebar/projects-panel.tsx:1166`, `theme.css:552-567`);
    - the name, the count, and the warning marker.
  - The three tabs' copied `<section><h3>` markup and `IconSection` use it. `Subsection` uses it for `h4`/`h5`.
  - **Expand All / Collapse All** are `IconButton`s with the existing `expandAll` / `collapseAll` tokens
    (explorer toolbar precedent, `explorer/toolbar.tsx:56,66`). They sit beside each search box, with
    titles "Expand All Sections" and "Collapse All Sections", and are disabled while the search box has
    text.
  - **Warning marker**: a new icon token `warning` (⚠) coloured by the existing `warning` colour token. It
    carries a hover title and an accessible name, e.g. "Contains an invalid entry".
- **Rationale**:
  - A disclosure heading's label is its section name. This matches 046's category header and is not an
    action control with a text label.
  - The chevron and the marker come from theme icon tokens, and their colours from theme colour tokens
    (themeable-icon-control gate).
  - No warning icon exists today.
- **Adding `warning`** follows the 047 precedent:
  - add it to `THRONG_THEME.icons`, with copy in `theme-copy.ts`;
  - bump the shipped-defaults version with a rationale note;
  - update `EXPECTED_ICON_TOKEN_COUNT` (81 → 82) and the named lists in `default-themes.test.ts`;
  - optionally add an `SVG_SHAPES` entry.

## R8 — Test layers

- **Unit**: `groupCounts`; fold-key building and stale-key pruning; the store's read/merge/write, with
  corrupt-JSON tolerance.
- **Component (jsdom)**: everything else.
  - Fold and unfold by click, Enter and Space; `aria-expanded`; hidden rows unfocusable.
  - Counts, and "N of M" under search; search unfolds; clearing the search restores.
  - The warning marker appears and clears.
  - Expand All / Collapse All, and their disabled state under search.
  - Per-tab independence; persistence across a remount with the same `localStorage`; stale keys ignored.
  - In all three tab test files, plus the existing `settings-tab-subgroups.test.ts:114` "is not
    collapsible" case, rewritten to assert the opposite.
- **No E2E**: every assertion survives without a real window. `localStorage` persistence across restart
  is the browser's guarantee; our read and write paths are proven by a remount with the same storage.
  Existing E2E specs that locate rows in sections keep passing, because FR-012 leaves everything unfolded
  by default. *(Superseded for the E2E half by R10, Session 2026-10-15: FR-016 folds sections by default.)*
- **Integration**: none; nothing crosses a process boundary.

## R9 — Defaults and explicit choices (FR-016, FR-017; Session 2026-10-15)

- **Decision**:
  - The store records the user's **explicit choice per heading**: `key → true` (folded) or `false`
    (unfolded).
  - A heading with no entry takes its **default**: `true` for a section (a FoldKey of length 1, the Icons
    key included), and `false` for a subgroup or subsection.
  - Expand All writes `false` for every current key, and Collapse All writes `true`.
  - The shape moves to `v: 2` (data-model.md). A `v: 1` document (folded-only arrays, which only ever
    existed on this unmerged branch) is read as `key → true` for each listed key, so nothing breaks;
    the next write saves `v: 2`. *(Review 2026-10-15: migration dropped as dead code — v1 never shipped;
    a v1 document now reads as empty.)*
- **Rationale**: with folded as the default, a store of folded keys alone could never remember an opened
  section (FR-017). Explicit booleans keep FR-011a's prune unchanged: stale keys match nothing.
- **Alternatives rejected**: storing only the "opened sections" plus the "folded subsections". That is two
  lists encoding one boolean, with the meaning depending on the level.

## R10 — Keeping the E2E suite on open sections (FR-016 vs existing specs)

- **Decision**:
  - A test-only seam, `THRONG_PREFS_SECTIONS_OPEN=1`. Main passes it to the Preferences window as the
    query parameter `foldDefault=open`, beside the existing `prefs=<tab>`, in
    `main/preferences-window.ts`.
  - The renderer reads it through `sectionsOpenByDefault()` in `preferences-folds.ts`, which is
    uncached and read once per hook mount, and uses it as the section default. With no stored choice,
    every heading is then unfolded, exactly the pre-FR-016 behaviour that the existing specs were written
    against.
  - The E2E harness sets it in `harness.ts`'s app env, beside `THRONG_E2E_CLIPBOARD`.
  - Documented in `docs/environment.md`'s testing table. `docs-currency.test.ts` requires every `THRONG_*`
    variable to be documented.
- **Rationale**: about 20 E2E specs open Preferences on a fresh profile and drive rows inside sections,
  many through their own `openPrefs` helper. One seam at the harness keeps all of them unchanged, where
  the alternative is a per-spec "Expand All" edit to roughly 15 helpers. The precedent is exact:
  - `THRONG_AUTOSAVE_DEBOUNCE_MS` reaches the renderer through `rendererQuery` (`main.ts:440-464`);
  - `THRONG_E2E_CLIPBOARD` and `THRONG_TEST_SHELL_HISTORY` are harness-set test seams.

  Unset in every real run.
- **What still proves the real default**: component tests mount each tab with no stored state and no
  seam, and assert sections folded and subsections unfolded (FR-016). MT-07 covers it by hand. No E2E
  asserts the default, because the default needs no real window to prove.
- **Alternatives rejected**:
  - **Seeding `localStorage` before launch.** It lives in Chromium's LevelDB under the profile and cannot
    be written before the app starts.
  - **Clicking Expand All in each spec.** About 15 duplicated helpers, and every future spec has to
    remember it.
