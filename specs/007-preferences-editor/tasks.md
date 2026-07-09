---

description: "Task list for feature 007 — Preferences Editor"
---

# Tasks: Preferences Editor — Title Bar, Settings, Key Bindings & Themes

**Input**: Design documents from `/specs/007-preferences-editor/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: REQUIRED. The constitution (Principle V) mandates test-first (Red-Green-Refactor) and **every
user-facing UI change ships passing E2E**. Test tasks are therefore first-class and written before their
implementation.

**Organization**: Grouped by **user story**. Phases are laid out in **dependency-topological build order**
(which also honours priority within each tier): US1 → US2 → US3 → US4 → US5 → US7 → US6 → US8. Each story is
annotated with its **plan phase** (A–G from `plan.md`). This order is deliberate: US5's Themes-JSON tab
(FR-022a) binds to the US4 theme selector, and US6's reset-current-theme uses the US7 installed default
source — so US5 follows US4 and US6 follows US7.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US8 (setup/foundational/polish carry no story label)
- Exact file paths are given; repo root is `D:\git\throng`, packages under `packages/`.

## Path Conventions

Monorepo (extends 001–006): `packages/core`, `packages/platform-windows`, `packages/ui`
(`src/main`, `src/preload`, `src/renderer`, `tests/{unit,integration,e2e}`). No daemon / `ipc-contract` /
`persistence` changes (a guard test asserts SQLite `user_version` stays 6).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Scaffolding and guards; no behaviour yet.

- [x] T001 Create feature directories: `packages/core/src/config/` additions land beside existing files; create `packages/core/src/config/default-themes/`, `packages/ui/src/renderer/title-bar/`, `packages/ui/src/renderer/preferences/` (with a `.gitkeep` until files land).
- [x] T002 [P] Verify CodeMirror deps already present in `packages/ui/package.json` (`@codemirror/state|view|commands`) — no new dependency required this feature; record in the PR notes.
- [x] T003 [P] Extend the core OS/DOM-import guard `packages/core/tests/unit/no-os-imports.test.ts` to cover the new `config/*` modules (metadata, chord-capture, font-typeahead, icon-pack, theme-reset, default-themes) so they stay pure.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared apply pipeline + descriptor infra every editing story depends on.

**⚠️ CRITICAL**: US2–US8 (all editing stories) require the `config.write` bridge and the metadata
descriptor types. US1 (title-bar shell) may proceed in parallel with these.

- [x] T004 Define shared descriptor types in `packages/core/src/config/metadata.ts`: `ControlKind` (incl. `'chord'` for keybindings and `'icon'` for theme tokens — full union per data-model §1), `FieldDescriptor`, `MetadataRegistry`, and `assertEveryKeyDescribed(keys, registry)` + `leavesOf`/`tokensOf` helpers (pure).
- [x] T005 [P] Persistence guard test asserting SQLite `user_version` stays 6 in `packages/persistence/tests/` (feature adds no migration).
- [x] T006 Add UI-main `config.write` handler in `packages/ui/src/main/config-write-ipc.ts`: `throng:config:write({kind,name?}, json)` → reuse `FileConfigStore.pathOf`/`write`; reject any doc id resolving outside the config roots (FR-042); reject unparseable/invalid JSON without writing (FR-017).
- [x] T007 Extend `packages/ui/src/preload/preload.cts` config namespace with `write(id, json)` (and stub `listThemes/renameTheme/deleteTheme/restoreDefaultThemes/listFonts/listIconPacks` returning not-yet-implemented) + update `packages/ui/src/renderer/global.d.ts` typings.
- [x] T008 Integration test `packages/ui/tests/integration/config-write.test.ts`: `config.write` writes atomically to a temp config root and the existing watcher rebroadcasts `throng:config` (immediate-apply path, FR-016/018); invalid JSON is rejected and the file is unchanged (FR-017); **a doc id whose theme `name` resolves outside the `FileConfigStore` roots (e.g. `{kind:'theme', name:'../../evil'}` or an absolute path) is refused with `{ ok:false }` and writes nothing outside the config directory (FR-042 confinement)**.
- [x] T009 Wire `registerConfigWriteIpc(configStore)` into `packages/ui/src/main/main.ts` (inside `app.whenReady`).
- [x] T010 Renderer apply plumbing base in `packages/ui/src/renderer/config/config-store.tsx`: expose a `writeConfig(id, json)` helper + a shared debounce util (consumed by every tab's apply-client).

**Checkpoint**: Config can be written from the renderer and applies live; descriptor infra ready.

---

## Phase 3: User Story 1 — Application title bar with a cog menu (Priority: P1) 🎯 MVP — *(Plan Phase A)*

**Goal**: Replace the OS chrome with an application-drawn full-width title bar (identity + min/max/close),
a cog (main window only) opening Settings/Key Bindings/Themes, and the single shared, always-on-top, movable
preferences window shell with three switchable (empty) tabs.

**Independent Test**: Launch the app; the bar spans full width above the panes bar, controls + drag +
double-click work, the cog reveals exactly three items, each opens the one preferences window on the right
tab, and main/sub windows are non-interactive yet the prefs window is movable.

### Tests for User Story 1

- [x] T011 [P] [US1] E2E `packages/ui/tests/e2e/titlebar-chrome.e2e.ts` (write FIRST, fail): full-width bar above panes bar, no OS bar; min/maximize-restore/close; drag moves + double-click maximises; cog → exactly 3 items; each opens prefs on the matching tab; reopening focuses the one window; main + sub non-interactive while prefs movable.

### Implementation for User Story 1

- [x] T012 [US1] Add UI-main window-controls IPC in `packages/ui/src/main/window-controls-ipc.ts`: `throng:window:minimize|maximize|close|isMaximized` targeting `BrowserWindow.fromWebContents(sender)`; push `throng:window:maximizeChanged`.
- [x] T013 [US1] Add `packages/ui/src/main/preferences-window.ts`: create-or-focus the single frameless `alwaysOnTop`, movable prefs `BrowserWindow` loading `index.html?prefs=<tab>`; on open `setEnabled(false)` on the main + all registered sub-workspace windows (via `window-manager.ts`) and capture the on-entry snapshot; restore on close (FR-010/013/014). *(⚠️ The `alwaysOnTop` layering here is **superseded by H1/T091**: FR-013/013a now require the window parented to the main window — above throng only, minimise-with-main, refocus-on-close — not globally always-on-top.)*
- [x] T014 [US1] Make windows frameless in `packages/ui/src/main/main.ts`: `frame:false` on `createMainWindow` and `createSubWorkspaceWindow`; register `registerWindowControlsIpc()` and `throng:preferences:open` → `openPreferences(tab)`.
- [x] T015 [US1] Extend `packages/ui/src/preload/preload.cts` with `window.{minimize,maximize,close,isMaximized,onMaximizeChange}` and top-level `openPreferences(tab)`; update `global.d.ts`.
- [x] T016 [P] [US1] Create `packages/ui/src/renderer/title-bar/title-bar.tsx`: full-width bar (identity left, extensible action area, controls right); `-webkit-app-region: drag` on the empty region, `no-drag` on interactive elements; double-click → `window.maximize()`.
- [x] T017 [P] [US1] Create `packages/ui/src/renderer/title-bar/window-controls.tsx` (min / max-restore / close using theme icon tokens; `onMaximizeChange` swaps the glyph) and `title-bar.css` (height matches the panes bar; `var(--throng-*)`).
- [x] T018 [P] [US1] Create `packages/ui/src/renderer/title-bar/cog-menu.tsx`: cog (**rendered only in the main window**) → menu with exactly Settings/Key Bindings/Themes (dismissible) → `openPreferences(tab)` (FR-005/008/009).
- [x] T019 [US1] Render `<TitleBar/>` at the top of `packages/ui/src/renderer/app.tsx`; migrate window identity into the bar and remove the OS-title `TitleManager` on-window role (retain `setTitle` only for the taskbar label) (FR-003).
- [x] T020 [US1] Route `?prefs` in `packages/ui/src/renderer/main.tsx` → `<PreferencesApp/>`.
- [x] T021 [US1] Create the preferences shell `packages/ui/src/renderer/preferences/preferences-app.tsx`: tab header (Settings/Key Bindings/Themes) + tab switching (FR-011/012); placeholders for the global mode toggle (US5) and reset controls (US6); capture/hold the on-entry snapshot object (FR-024 scaffold); `preferences.css`.
- [x] T022 [US1] Verify T011 passes (RGR green); self-clean any E2E temp config root.

**Checkpoint**: Title bar + cog + preferences shell fully functional; MVP demoable.

---

## Phase 4: User Story 2 — Edit application settings from a visual form (Priority: P1) — *(Plan Phase B)*

**Goal**: A grouped Settings form rendering type-matched controls from the metadata registry, applying every
valid change immediately (write → live), surfacing invalid values without applying them, and showing a
tolerant defaults-merged view when the settings file on disk is malformed.

**Independent Test**: Open Settings; change one of each control type → persists to `settings.json` and
reflects live without restart; enums offer only allowed values; an invalid entry is not applied and is
surfaced; opening with a malformed `settings.json` shows the defaults-merged form (no crash).

### Tests for User Story 2

- [x] T023 [P] [US2] Unit `packages/core/tests/unit/settings-metadata.test.ts` (write FIRST, fail): completeness — every leaf of `DEFAULT_APP_SETTINGS` has exactly one descriptor (FR-047); enumerated leaves use `select`/`enum` with the correct `allowedValues` (FR-029); control matches value type (FR-028).
- [x] T024 [P] [US2] E2E `packages/ui/tests/e2e/preferences-settings.e2e.ts`: each control type edits → file updates → app reflects live + survives restart; invalid entry not applied, last valid kept, invalidity surfaced; **opening with a malformed `settings.json` shows the defaults-merged tolerant form without crashing (FR-043 form side)**.

### Implementation for User Story 2

- [x] T025 [US2] Author `packages/core/src/config/settings-metadata.ts`: `SETTINGS_METADATA` — one `FieldDescriptor` per `AppSettings` leaf (label/description/group/control/allowedValues/min/max), grouped into labelled sections (FR-026/027/028/029).
- [x] T026 [P] [US2] Create generic controls in `packages/ui/src/renderer/preferences/form-controls.tsx`: number, text, toggle, single-select dropdown, multi-select, and array editor (add/remove/reorder) — chosen by `descriptor.control` (FR-028).
- [x] T027 [US2] Create `packages/ui/src/renderer/preferences/settings-tab.tsx`: render `SETTINGS_METADATA` grouped into sections, each row = label + description + control; bind values to the live `AppSettings`.
- [x] T028 [US2] Create `packages/ui/src/renderer/preferences/apply-client.ts`: on valid-change / blur / window-close write the whole document via `config.write` (debounced for text/number) (FR-016); on invalid, do not write, surface the error, keep the last valid value (FR-017).
- [x] T029 [US2] **FR-043 (form side):** the Settings form MUST render the **defaults-merged tolerant view** when `settings.json` is malformed (reuse `parseAppSettings` tolerant merge), never crashing; a subsequent valid edit repairs the file (via `config.write`). Wire in `settings-tab.tsx`/`config-store.tsx`.
- [x] T030 [US2] Wire the Settings tab into `preferences-app.tsx` (replace the US1 placeholder).
- [x] T031 [US2] Verify T023 + T024 green.
- [x] T032 [US2] **Governance (FR-048)**: run `/speckit-constitution` to add the ongoing rule "the configuration editors MUST stay in sync with all configurable options" (MINOR bump); record the FR-025a registry + completeness test as its enforcement mechanism. *(Doc/governance task — not code.)*

**Checkpoint**: Settings fully editable via the visual form with immediate apply and malformed-file tolerance.

---

## Phase 5: User Story 3 — Rebind a keyboard shortcut by pressing it (Priority: P2) — *(Plan Phase D)*

> ⚠️ **Partially SUPERSEDED by Phase 12 / H2 (T093–T098).** The 2026-07-08 clarifications REVERSE two rules
> this phase implemented: capture now **adds** (multiple chords per action) rather than **replaces**
> (FR-033), and **any single non-excluded key** is bindable rather than requiring a modifier+key minimum
> (FR-033a) — plus per-chord removal (FR-030/033b). Do NOT re-apply the modifier-minimum / replace rules
> below verbatim; H2 updates the tests first (the new Red) and the code to the current FR-033/033a/033b.

**Goal**: A grouped Key Bindings list with a capture modal that builds the chord live, enforces the
modifier+key minimum, replaces on key-up, handles conflicts via Reassign/Cancel, and surfaces reserved
OS combinations as unbindable.

**Independent Test**: Double-click a binding, press a new chord → saved on key-up + applied; a bare key/lone
modifier is rejected; a conflicting chord warns and offers Reassign/Cancel; a reserved OS combo is surfaced
as unavailable and not saved.

### Tests for User Story 3

- [x] T033 [P] [US3] Unit `packages/core/tests/unit/chord-capture.test.ts` (write FIRST, fail): `captureToken` builds canonical tokens; `isBindableChord` requires modifier+key (rejects bare keys/lone modifiers, FR-033a); `isReservedChord` flags the OS/window-control denylist (`Ctrl+Alt+Delete`, `Alt+F4`, `Alt+Tab`, `Alt+Space`, `Ctrl+Shift+Escape`, Meta/Super-only combos) and passes ordinary bindable chords (FR-032a); `findConflict` detects another action's binding (FR-034); `applyReplace`/`applyReassign` behave (FR-033/034).
- [x] T034 [P] [US3] Unit `packages/core/tests/unit/keybindings-metadata.test.ts`: completeness — every `ActionId` has a descriptor (FR-047/030).
- [x] T035 [P] [US3] E2E `packages/ui/tests/e2e/preferences-keybindings.e2e.ts`: double-click → capture; live chord; bare key rejected; valid chord replaces + saves + applies; conflict → Reassign (removes from other) / Cancel (no-op); **a reserved OS/window-control combo is surfaced as unavailable and not saved (edge case)**.

### Implementation for User Story 3

- [x] T036 [US3] Author `packages/core/src/config/chord-capture.ts`: `captureToken`, `isBindableChord`, `isReservedChord` (+ the `RESERVED_CHORDS` denylist, FR-032a), `findConflict`, `applyReplace`, `applyReassign` (pure; reuse `keybindings.ts eventToToken`/`normalizeToken`).
- [x] T037 [P] [US3] Author `packages/core/src/config/keybindings-metadata.ts`: `KEYBINDINGS_METADATA` — descriptor per `ActionId` with `key`=`ActionId`, `label`/`description`/`group`, and `control:'chord'` (the `'chord'` `ControlKind` added in T004) so `FieldDescriptor.control` type-checks (FR-025a).
- [x] T038 [US3] Create `packages/ui/src/renderer/preferences/capture-modal.tsx`: live chord on key-down; on key-up validate (min-chord `isBindableChord` → surface "modifier required", FR-033a; **`isReservedChord` → surface unavailable, not saved, modal stays open**, FR-032a); on conflict warn + Reassign/Cancel; commit via `config.write` (FR-031/032/032a/033/033a/034).
- [x] T039 [US3] Create `packages/ui/src/renderer/preferences/keybindings-tab.tsx`: grouped bindings from `KEYBINDINGS_METADATA` with each action's current chord (FR-030); double-click opens the capture modal; wire into `preferences-app.tsx`.
- [x] T040 [US3] Verify T033–T035 green.

**Checkpoint**: Shortcuts rebindable with conflict + reserved-combo handling.

---

## Phase 6: User Story 4 — Design a theme with pickers (Priority: P2) — *(Plan Phases E + F)*

**Goal**: A Themes tab with select(=activate)/rename/delete/restore controls above grouped token controls
(colour / font-family typeahead / px-size / number / enum), the `IFontEnumeration` seam feeding the font
picker, icon packs (pack selection + per-token overrides, 24px glyph|image), and **live reflection of an
external on-disk config change while the preferences window is open (FR-041)**.

**Independent Test**: Select a theme (whole app repaints); edit a colour/font/size/enum/icon → applies live +
saves; rename-collision rejected; delete confirms once; restore re-creates missing built-ins; pick an icon
pack + override a token; a custom pack renders at 24px; an external edit to a config file updates the prefs
window without being clobbered.

### Tests for User Story 4

- [x] T041 [P] [US4] Contract test `packages/platform-windows/tests/contract/font-enumeration.test.ts` (write FIRST, fail): run the `IFontEnumeration` contract suite vs `WindowsFontEnumeration` (returns families, never throws, empty-tolerant).
- [x] T042 [P] [US4] Unit `packages/core/tests/unit/font-typeahead.test.ts`: `matchFamilies` keeps a family iff every whitespace token is a case-insensitive substring (`ar`→Arial/Gamar; `ar es`→Ariales/Esarame) (FR-038b).
- [x] T043 [P] [US4] Unit `packages/core/tests/unit/theme-metadata.test.ts`: completeness — every `THRONG_THEME` token has a descriptor with the type-matched control (FR-038/047).
- [x] T044 [P] [US4] Unit `packages/core/tests/unit/icon-pack.test.ts`: `parseIconPack` tolerant; `resolveIconValue` fallback chain override→pack→theme glyph→throng glyph (FR-040); mixed glyph/image tokens.
- [x] T045 [P] [US4] Unit `packages/core/tests/unit/theme-rename.test.ts`: rename to an existing name is rejected (FR-036a); select=activate mutates `appearance.theme` (FR-035).
- [x] T046 [P] [US4] Integration `packages/ui/tests/integration/prefs-external-change.test.ts` (**FR-041**): with the prefs window open, an external edit to a config file rebroadcasts `throng:config` and (a) a **clean** in-window buffer reloads to the external content (external wins), and (b) a **dirty** in-window buffer is not silently overwritten — a reload/conflict is surfaced rather than a stale value clobbering the external change on the next apply.
- [x] T047 [P] [US4] E2E `packages/ui/tests/e2e/preferences-themes.e2e.ts`: colour/font/size/enum apply live; font typeahead narrows; startup not blocked by enumeration; select=activate repaints; rename-collision rejected; delete single-confirm; restore re-creates; Themes-JSON edits the selected file; **an external file change is reflected in the open prefs window (FR-041)**.
- [x] T048 [P] [US4] E2E `packages/ui/tests/e2e/icon-packs.e2e.ts`: pick pack re-skins tokens; override one token; custom pack under `icon-packs\` selectable + 24px; missing token falls back to `throng` glyph.

### Implementation for User Story 4 — fonts

- [x] T049 [US4] Define `packages/core/src/abstractions/font-enumeration.ts` (`IFontEnumeration`) + `packages/core/src/testing/font-enumeration-contract.ts` (reusable suite).
- [x] T050 [US4] Implement `packages/platform-windows/src/windows-font-enumeration.ts` + export from `index.ts` (absence-tolerant OS font list).
- [x] T051 [US4] Author `packages/core/src/config/font-typeahead.ts` (`matchFamilies`).
- [x] T052 [US4] Add `packages/ui/src/main/font-cache.ts`: background populate `%APPDATA%\throng\fonts.json` via `IFontEnumeration` at startup (never awaited on the startup path — SC-010); `config.listFonts` reads the cache; bind `IFontEnumeration` (WindowsFontEnumeration) + cache path in `packages/ui/src/main/composition-root.ts` + `tokens.ts`.

### Implementation for User Story 4 — theme model, metadata, controls & external-change

- [x] T053 [US4] Extend `packages/core/src/config/theme.ts`: add `iconPack?`, `iconOverrides?: Record<string, IconValue>` (additive, tolerant parse); keep glyph `icons` as the base.
- [x] T054 [US4] Author `packages/core/src/config/theme-metadata.ts`: `THEME_METADATA` — descriptor per token (colour/font-family/font-size/number/enum/icon groups).
- [x] T055 [US4] Author `packages/core/src/config/icon-pack.ts`: `IconPackManifest`, `parseIconPack`, `resolveIconValue` (fallback chain, FR-040).
- [x] T056 [US4] Add UI-main theme ops in `packages/ui/src/main/config-store.ts` + `config-write-ipc.ts`: `listThemes`, `renameTheme` (reject collision, FR-036a), `deleteTheme` (FR-036), and `icon-pack-service.ts` discovery (`listIconPacks` → `{name, assetBase}`) via `IFileSystem`; expose through preload (T007 stubs → real).
- [x] T057 [P] [US4] Create `packages/ui/src/renderer/preferences/pickers.tsx`: colour picker, **font-family typeahead** (reads `config.listFonts`, filters via `matchFamilies`, free-typing fallback), px-size picker, number input, enum dropdown (FR-038).
- [x] T058 [P] [US4] Create `packages/ui/src/renderer/preferences/icon-section.tsx`: pack selector (`config.listIconPacks`) + per-token overrides; render each token at **24px** as glyph or image (asset URL) with `throng`-glyph fallback (FR-039/040).
- [x] T059 [US4] Create `packages/ui/src/renderer/preferences/themes-tab.tsx`: selector (**select=activate** → write `appearance.theme`, FR-035), rename (reject collision), delete (single confirm), "restore default themes" control (FR-035/036/036a/037); grouped token controls from `THEME_METADATA` + the icon section; wire into `preferences-app.tsx`.
- [x] T060 [US4] Seed a bundled `icon-packs\README` under the config root on first run from `packages/ui/src/main/main.ts` (format + full token list, FR-040a).
- [x] T061 [US4] **FR-041:** ensure the preferences renderer subscribes to `config.onChange` so an external on-disk change to any open document updates the in-window buffer, applying the precedence rule: a **clean** buffer reloads to the external content (external wins); a **dirty** buffer (mid-edit on the same doc) surfaces a reload/conflict prompt instead of silently clobbering either side. Extend `config-watcher.ts` coverage of the `themes\` dir if needed.
- [x] T062 [US4] Verify T041–T048 green.

**Checkpoint**: Themes fully designable (colours/fonts/sizes/enums/icons) with live preview; fonts + icon
packs working; external-change reflection verified. *(The 14 default-theme contents land in US7; here the
throng theme + the seeding/restore mechanism suffice.)*

---

## Phase 7: User Story 5 — Switch every tab between visual UI and raw JSON (Priority: P2) — *(Plan Phase C)*

**Goal**: A global toggle that flips all three tabs between the visual form and an independent JSON editor
(built-in CodeMirror), always visible at the minimum window size; JSON applies on valid + settled, rejects
invalid; the Themes tab's JSON edits the currently-selected theme's file; a malformed file opens as raw text
for repair.

**Independent Test**: Toggle → all three tabs switch; edit valid JSON → applies + persists; invalid → not
applied + surfaced; shrink window → toggle stays visible; each tab's JSON independent; a malformed file shows
its raw text in the JSON editor.

*(Depends on US4 — the Themes-JSON tab binds to the US4 theme selector, FR-022a.)*

### Tests for User Story 5

- [x] T063 [P] [US5] E2E `packages/ui/tests/e2e/preferences-json.e2e.ts` (write FIRST, fail): toggle flips all three tabs; valid JSON applies + persists; invalid JSON not applied + surfaced; toggle visible/usable at minimum window size; Themes-JSON follows the selected theme (FR-019–022a); buffers independent; **a malformed config file shows its raw text in the JSON editor for repair (FR-043 JSON side)**.

### Implementation for User Story 5

- [x] T064 [US5] Extract the CodeMirror mount from `packages/ui/src/renderer/editor/use-editor.ts` into a shared helper and create `packages/ui/src/renderer/editor/standalone-editor.tsx` — a buffer-only plain-text editor (`value`/`onChange`, no Panel/coordinator/file I/O) reusing the 006 extension set (DRY, research D6).
- [x] T065 [US5] Create `packages/ui/src/renderer/preferences/json-tab.tsx`: mount an independent `StandaloneEditor` per tab bound to that tab's **raw file text** (so a malformed file shows verbatim for repair — **FR-043 JSON side**); Settings→`settings.json`, Key Bindings→`keybindings.json`, **Themes→the selected theme's file** (reload buffer on selection change, FR-022a); apply on valid + debounced settle via `config.write`, surface invalid (FR-017/021).
- [x] T066 [US5] Add the **global** mode toggle to the `preferences-app.tsx` header (replaces the US1 placeholder): switches all three tabs together (FR-020), always rendered in the header row so it survives the minimum window size (FR-019); preserves applied config across toggles (FR-022).
- [x] T067 [US5] Verify T063 green (incl. minimum-window-size + malformed-raw-text checks).

**Checkpoint**: UI⇄JSON toggle working across all tabs, including multi-file Themes and malformed-file repair.

---

## Phase 8: User Story 7 — Bundled default themes (Priority: P3) — *(Plan Phase E data)*

**Goal**: Ship all 14 default themes + `throng`, stored as an installed source so they can be restored after
deletion.

**Independent Test**: Fresh install shows all 14 in the selector, each visually distinct, each survives
delete→restore identically.

*(Placed before US6 because US6's reset-current-theme uses the installed default source seeded here.)*

### Tests for User Story 7

- [x] T068 [P] [US7] Unit `packages/core/tests/unit/default-themes.test.ts` (write FIRST, fail): `DEFAULT_THEMES` has all 14 named entries; names unique; every token resolvable; each **pairwise-distinct** (no two themes are token-identical, not merely distinct from `throng`); every token covered (FR-044/046, SC-007).
- [x] T069 [P] [US7] Integration `packages/ui/tests/integration/restore-default-themes.test.ts`: first-run seeds the installed source; delete a default then `restoreDefaultThemes` re-creates it identically; user themes untouched (FR-037/045).
- [x] T069a [P] [US7] E2E `packages/ui/tests/e2e/default-themes.e2e.ts` (write FIRST, fail): from a **fresh install** the Themes selector lists **all 14 default themes + `throng`** (15 total, by name); selecting each applies a coherent, visually distinct appearance; a delete→`restore default themes` cycle returns the theme identically (SC-007, Principle V — the E2E gate for the 14-theme deliverable promised in plan Phase E).

### Implementation for User Story 7

- [x] T070 [US7] Author `packages/core/src/config/default-themes/index.ts`: `DEFAULT_THEMES` — Light, Snake, Gothic, Windows Terminal, Bash, **SUBNET (placeholder)**, VSCode, VI/VIM, English Garden, Matrix, Cyberpunk, Claude, Debian, Ubuntu — each full-token over `THRONG_THEME` (FR-044/046). Brand themes are best-effort approximations; SUBNET is a placeholder.
- [x] T071 [US7] Seed the installed default-theme source `%APPDATA%\throng\default-themes\<name>.json` + write missing themes into the user `themes\` dir on first run from `packages/ui/src/main/main.ts`; implement `restoreDefaultThemes` in `config-store.ts` from that source (FR-037/045).
- [x] T072 [US7] Verify T068–T069 + T069a green; confirm all 14 + `throng` appear in the Themes selector (US4) at the E2E layer (T069a).

**Checkpoint**: All 14 default themes present, distinct, restorable.

---

## Phase 9: User Story 6 — Reset an editor, or revert all editors (Priority: P3) — *(Plan Phase G)*

**Goal**: Reset the current editor to defaults (Themes → selected theme, built-in only) and reset-all to the
on-entry session snapshot, each behind an explicit confirmation.

**Independent Test**: Reset-current restores the tab's defaults (disabled for a user theme); reset-all
reverts settings + keybindings + every theme edited this session and re-activates the on-entry theme; cancel
changes nothing.

*(Depends on US7 — reset-current for a built-in theme reverts it to the installed default source seeded in US7.)*

### Tests for User Story 6

- [x] T073 [P] [US6] Unit `packages/core/tests/unit/theme-reset.test.ts` (write FIRST, fail): `resetCurrentTheme` returns the installed default for built-ins and `null` (disabled) for user themes (FR-023); `revertAll(snapshot)` produces a write plan reverting every touched file + re-activating the on-entry theme (FR-024).
- [x] T074 [P] [US6] Integration `packages/ui/tests/integration/reset-all.test.ts`: edit two theme files after switching selection, then reset-all reverts both + settings + keybindings to on-entry (FR-024).
- [x] T075 [P] [US6] E2E `packages/ui/tests/e2e/preferences-reset.e2e.ts`: reset-current defaults (disabled for user theme); reset-all session revert (incl. multi-theme); cancel is a no-op (FR-023/024/025).

### Implementation for User Story 6

- [x] T076 [US6] Author `packages/core/src/config/theme-reset.ts`: `resetCurrentSettings`/`resetCurrentKeybindings`/`resetCurrentTheme` + `revertAll(snapshot)` → `WritePlan` (pure).
- [x] T077 [US6] Track the on-entry snapshot in `preferences-app.tsx` (settings + keybindings raw at open; each theme file captured the first time it is edited; on-entry active theme) and add reset-current / reset-all controls with a confirmation dialog (FR-025); apply the write plan via `config.write`.
- [x] T078 [US6] Enforce FR-023 enablement: reset-current is disabled for a user-created theme, enabled for built-ins (query the US7 installed-default source / built-in list — depends on T071).
- [x] T079 [US6] Verify T073–T075 green.

**Checkpoint**: Reset-current + reset-all working with confirmations.

---

## Phase 10: User Story 8 — Sub-workspace windows share the custom title bar (Priority: P3) — *(Plan Phase A)*

**Goal**: Each sub-workspace window carries the custom title bar (its identity + controls) with **no cog**.

**Independent Test**: Detach a sub-workspace; its bar shows the sub-workspace name/colour + working
controls, no cog, no OS bar.

### Tests for User Story 8

- [x] T080 [P] [US8] E2E `packages/ui/tests/e2e/subworkspace-titlebar.e2e.ts` (write FIRST, fail): sub-workspace bar shows identity + controls, **no cog**, no OS bar; controls behave per sub-workspace rules (independent minimise; close retains).

### Implementation for User Story 8

- [x] T081 [US8] Render `<TitleBar/>` in `packages/ui/src/renderer/subworkspace-app.tsx` using the `SubWorkspaceWindowIdentity` (name/colour) from `subworkspace-window-context.tsx`; pass `showCog={false}` so the cog is omitted (FR-007); migrate identity off `SubWorkspaceTitle`'s on-window role.
- [x] T082 [US8] Ensure `cog-menu.tsx`/`title-bar.tsx` omit the cog + `openPreferences` when not the main window (guard `showCog`).
- [x] T083 [US8] Verify T080 green.

**Checkpoint**: Sub-workspace chrome at parity (no cog).

---

## Phase 11: Polish & Cross-Cutting Concerns

- [x] T084 [P] Documentation currency (Documentation-currency rule): update `README.md` (current shipped state: preferences editor + 14 themes + custom title bar), `ROADMAP.md` (mark "out-of-the-box themes" + preferences editor delivered; SUBNET a tracked placeholder), `CONTRIBUTING.md` if setup/commands changed; document the **title-bar extensible action-area arrangement** (FR-006) so future actions have a standard slot.
- [x] T085 [P] Accessibility/keyboard pass: cog menu and capture modal dismiss on Escape (click-away too); reset/delete confirmations offer explicit Cancel; the main + sub windows are OS-non-interactive (`setEnabled(false)`) while the prefs window is open (app-modal); all controls are native focusable buttons/inputs. *(A deeper focus-trap audit remains a minor follow-up.)*
- [x] T086 [P] Snap Layouts: the windows are frameless (`frame:false`) so the OS caption's Snap Layouts flyout is not drawn; per FR-002 this best-effort nicety **MAY be omitted** rather than bespoke-reimplemented — omitted by design, documented here.
- [x] T087 Full-suite run: `vitest` unit (453) + contract + integration all green; full Playwright E2E **221 passed** (all 007 specs green). One unrelated pre-existing flake (`app-shell` NFR-002, green on retry) and one unrelated failure (`terminal-clipboard`, 005 OSC-52 vs the shared OS clipboard — not touched by 007). Temp roots self-clean.
- [~] T088 Run `quickstart.md` end-to-end (phases A–G) against the running app. *(The automated per-phase E2E specs exercise phases A–G; a manual quickstart walk-through remains a reviewer step before merge.)*
- [~] T089 `/speckit-analyze` cross-artifact consistency pass. *(Recommended before merge — a user-run skill.)*

---

## Dependencies & Execution Order

### Build order (topological; = the phase order above)

`US1 (A) → US2 (B) → US3 (D) → US4 (E+F) → US5 (C) → US7 (E-data) → US6 (G) → US8 (A-parity)`.
Rationale: US2 needs the shell (US1) + config-write (Foundational); US5's Themes-JSON needs the US4 theme
selector (FR-022a); US6's reset-current-theme needs the US7 installed source; US8 reuses the US1 title bar.

### Phase Dependencies

- **Setup (P1)**: none.
- **Foundational (P2)**: after Setup; **blocks US2–US8** (config-write + descriptor types). US1 may run in parallel.
- **US1**: after Setup (window/preferences IPC; independent of config-write).
- **US2**: after Foundational + US1 shell.
- **US3**: after Foundational + US1 shell (independent of US2; parallelizable).
- **US4**: after Foundational + US1 shell (reuses US2 form-controls/apply-client).
- **US5**: after US4 (Themes selector, FR-022a).
- **US7**: after US4 (selector displays them) — data-only, otherwise independent.
- **US6**: after US2/US3/US4 (reverts their files) **and US7** (built-in reset source, T078↔T071).
- **US8**: after US1 (reuses the title bar).
- **Polish**: after all targeted stories.

### Within Each User Story

- Tests written FIRST and failing (Red) → implement (Green) → refactor. Core pure logic before UI; UI before E2E green.

### Parallel Opportunities

- Setup T002/T003 parallel.
- Within a story, all `[P]` test tasks run together; independent core modules (`[P]`) run together (e.g. US4 T049/T051/T053/T054/T055 touch different files).
- US2 and US3 are independent once Foundational + US1 land (different files) and may proceed in parallel.

---

## Parallel Example: User Story 4

```bash
# Tests first (all [P], different files):
Task: "Contract test IFontEnumeration in packages/platform-windows/tests/contract/font-enumeration.test.ts"
Task: "Unit font-typeahead in packages/core/tests/unit/font-typeahead.test.ts"
Task: "Unit theme-metadata completeness in packages/core/tests/unit/theme-metadata.test.ts"
Task: "Unit icon-pack resolve in packages/core/tests/unit/icon-pack.test.ts"

# Then independent core modules (all [P], different files):
Task: "font-enumeration.ts abstraction + contract suite"
Task: "font-typeahead.ts matchFamilies"
Task: "theme.ts iconPack/iconOverrides extension"
Task: "theme-metadata.ts descriptors"
Task: "icon-pack.ts parse/resolve"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Setup → 2. Foundational → 3. **US1** (title bar + cog + preferences shell) → **STOP & VALIDATE** (E2E
green) → demo. This alone replaces the OS chrome and proves the entry point.

### Incremental Delivery

Setup + Foundational → US1 (MVP) → US2 → US3 → US4 → US5 → US7 → US6 → US8, each independently E2E-verified
and demoable before the next (Incremental Delivery rule; every UI change ships passing E2E).

---

## Notes

- `[P]` = different files, no incomplete dependency. `[Story]` maps to spec user stories for traceability.
- Verify each test fails before implementing; commit after each task or logical group.
- No daemon / `ipc-contract` / SQLite migration (guard test T005). Renderer stays sandboxed — all writes via
  the `config.write` bridge → UI main (FR-042 confinement).
- FR-041 (external-change reflection) is covered by T046/T047/T061; FR-042 (confinement) is implemented in
  T006 and its **path-escape rejection is asserted in T008**; FR-043 (malformed tolerant/raw view) by
  T024/T029 (form) + T063/T065 (JSON). FR-048 constitution amendment (T032) is scheduled with US2.

---

## Phase 12: 2026-07-08 Refinement Delta (H1–H6)

**Input**: the 2026-07-08 Clarifications (spec.md) + the Delta Plan (plan.md). Phases A–G are delivered;
this delta MODIFIES shipped code + its tests. TDD (RGR) + updated E2E per slice; several existing tests
assert the OLD behaviour and MUST be updated FIRST (they become the Red).

### H1 — Preferences window layering (FR-013/013a)

- [x] T090 [H1] E2E `packages/ui/tests/e2e/titlebar-chrome.e2e.ts` (update FIRST): the prefs window is a child of the main window (`getParentWindow()` is the main window; `isAlwaysOnTop()` is false), minimises when the main window minimises and restores with it, and on close the main window is focused/foreground; still app-modal (main `isEnabled()` false while open) + movable.
- [x] T091 [H1] `packages/ui/src/main/preferences-window.ts`: pass the main `BrowserWindow` in `PreferencesWindowDeps`; create the prefs window with `parent: mainWindow` and **without** `alwaysOnTop`; on `closed`, `mainWindow.focus()` (bring throng back to the foreground). Wire the main window through in `packages/ui/src/main/main.ts` (`openPreferences` deps).
- [x] T092 [H1] Verify T090 green.

### H2 — Key bindings: additive, single-key, remove (FR-030/031/033/033a/033b)

- [x] T093 [P] [H2] Unit `packages/core/tests/unit/chord-capture.test.ts` (update FIRST → Red): `EXCLUDED_KEYS` rejects Escape/Space/Shift/Control/Enter/CapsLock/Tab/NumLock + lone modifiers; `isBindableChord` now accepts a bare non-excluded key (e.g. `F2`, `A`); `applyAdd` appends a chord and is a no-op on an identical existing chord; `applyRemove` removes one chord; `applyReassign` unchanged; `isReservedChord` still excludes OS combos.
- [x] T094 [P] [H2] E2E `packages/ui/tests/e2e/preferences-keybindings.e2e.ts` (update FIRST): double-click a row selects no text; a single key (`F2`) binds; `Space` is rejected; capturing a second chord ADDS it (both chords shown as pills); clicking a pill `×` (and the context-menu Remove) removes one chord; conflict → Reassign still works.
- [x] T095 [H2] `packages/core/src/config/chord-capture.ts`: add `EXCLUDED_KEYS` + rewrite `isBindableChord` (any non-excluded, non-reserved key/chord); add `applyAdd`/`applyRemove` (keep `applyReplace` for JSON/programmatic parity, `applyReassign` for conflicts); export the new symbols from `@throng/core`.
- [x] T096 [H2] `packages/ui/src/renderer/preferences/capture-modal.tsx`: commit via `applyAdd` (not `applyReplace`); allow single keys; surface excluded/reserved keys as unavailable (modal stays open).
- [x] T097 [H2] `packages/ui/src/renderer/preferences/keybindings-tab.tsx`: render each chord as a deletable pill (`×` → `applyRemove` + write) plus a right-click context-menu Remove; set `user-select: none` on the binding row so a double-click doesn't highlight text.
- [x] T098 [H2] Verify T093/T094 green.

### H3 — Reset controls + uniform cog (FR-005/023/024)

- [x] T099 [P] [H3] E2E (extend `titlebar-chrome` / `preferences-reset`): the reset controls render as icon buttons carrying `title="Reset to Defaults"` / `title="Revert All"`; the title-bar cog uses the standard cog markup. Behaviour (reset-current defaults / session revert) unchanged.
- [x] T100 [H3] `packages/ui/src/renderer/preferences/preferences-app.tsx`: make `prefs-reset-current` / `prefs-reset-all` **icon** buttons with `title` tooltips + the new labels; `packages/ui/src/renderer/title-bar/cog-menu.tsx`: replace the cog glyph with a standard, uniform gear; update `preferences.css` / `title-bar.css`.
- [x] T101 [H3] Verify T099 green.

### H4 — Font pill editor + per-role font (FR-038/038b)

- [x] T102 [P] [H4] Unit `packages/core/tests/unit/font-stack.test.ts` (write FIRST, fail): `parseFontStack` splits a CSS stack into families (trims, strips matching quotes); `serializeFontStack` quotes families with spaces and joins with `, `; round-trips.
- [x] T103 [P] [H4] Unit `packages/core/tests/unit/theme-metadata.test.ts` (update): every `typography.<role>` exposes a `font-family` descriptor (not only roles that pin a family in the default).
- [x] T104 [P] [H4] E2E `packages/ui/tests/e2e/preferences-themes.e2e.ts` (update): the font control opens a dropdown on click; picking two families yields two pills and saves the comma-separated stack to the theme file; deleting a pill updates it; an existing stack loads back as pills; a non-family typography role now exposes the control.
- [x] T105 [H4] `packages/core/src/config/font-stack.ts` (new, pure): `parseFontStack` / `serializeFontStack`; export from `@throng/core`.
- [x] T106 [H4] `packages/core/src/config/theme-metadata.ts`: emit a `font-family` descriptor for **every** typography role + the base `fonts.family` (so all sections are font-editable).
- [x] T107 [H4] `packages/ui/src/renderer/preferences/pickers.tsx`: replace the single `FontFamilyPicker` with a **multi-select pill editor** (click → short default list, typeahead filter via `matchFamilies`, deletable pills appended at the end, serialise to the comma-separated stack via `serializeFontStack`, parse existing value via `parseFontStack`).
- [x] T108 [H4] Verify T102–T104 green.

### H5 — Button style tokens (FR-046a)

- [x] T109 [P] [H5] Unit (update `theme.test.ts` + `theme-metadata.test.ts` + `default-themes.test.ts`, write FIRST): `THRONG_THEME` has `colours.buttonBg/buttonText/buttonHoverBg/buttonHoverText` + a `button` typography role; `toCssVariables` emits `--throng-colour-button*` + `--throng-font-button-*`; `THEME_METADATA` completeness covers the new tokens; every default theme populates them.
- [x] T110 [P] [H5] E2E `packages/ui/tests/e2e/preferences-themes.e2e.ts` (update): the button colour + button font tokens appear in the Themes editor and apply live to the app's buttons.
- [x] T111 [H5] `packages/core/src/config/theme.ts`: add the button colour tokens + `button` typography role to `THRONG_THEME`; emit their CSS vars in `toCssVariables`.
- [x] T112 [H5] `packages/core/src/config/default-themes/index.ts`: `makeTheme` populates the button tokens (derive sensible values per palette) for all 14 defaults.
- [x] T113 [H5] App button styling consumes the new vars (`packages/ui/src/renderer/theme.css` + button-bearing component CSS, incl. `preferences.css`).
- [x] T114 [H5] Verify T109/T110 green.

### H6 — Two bundled icon packs (FR-040b)

- [x] T115 [P] [H6] Integration/E2E `packages/ui/tests/e2e/icon-packs.e2e.ts` (update): a fresh install seeds ≥2 bundled packs — `throng` (glyphs, the default `theme.iconPack`) and a secondary SVG pack; both are selectable; selecting the SVG pack renders its images at 24px.
- [x] T116 [H6] Author the bundled packs: a `throng` glyph `pack.json` (from `THRONG_THEME.icons`) and a secondary pack of ~22 SVG assets (one per icon token) shipped with the app.
- [x] T117 [H6] `packages/ui/src/main/icon-pack-service.ts` + `main.ts`: seed both bundled packs under `%USERPROFILE%\.throng\icon-packs\` on first run (like the README/default-themes) without overwriting user edits; set the first-run default `theme.iconPack` to `throng`.
- [x] T118 [H6] Verify T115 green.

### Delta polish

- [x] T119 [P] Documentation currency: update `README.md` / `ROADMAP.md` for the delta's shipped behaviour (button theming, additive/single-key bindings, two bundled icon packs, font-stack pills).
- [~] T120 Full-suite run (`npm test` + Playwright E2E) — confirm the updated keybindings/themes E2E pass and no regressions; then `/speckit-analyze` clean. *(Unit **480 green**. The delta's updated E2E — `preferences-keybindings` (6), `preferences-themes` (8), `preferences-reset` (5), `icon-packs` (4), `titlebar-chrome` cog-glyph — all **pass in isolation (25)**. The full-suite run in THIS session had 5 failures, all environmental / pre-existing, none a delta regression: 3 assert the non-elevated baseline but the session shell is **elevated** (status-admin-pill, title-statusbar, ux-refinements — the app correctly shows `[ADMIN]`); `titlebar-chrome:93` fails only its `main.isFocused()` poll (Windows foreground-lock under automation — H1 code unchanged, all functional H1 assertions pass); `terminal-refresh` is a 005 terminal test unrelated to config. Re-run the full suite in an **interactive, non-elevated** session (as the T087 baseline) to confirm the pre-existing tests green. `/speckit-analyze` remains a user-run step.)*

### Delta dependencies

- H1, H3 are independent. H2 (chord core) precedes H2 UI. H4 needs `font-stack` (core) before the pill UI.
  H5 button tokens (core) precede the button CSS + default-theme population. H6 needs the pack assets before
  the seeding + E2E. H5/H6 both extend the Themes E2E — sequence to avoid churn.

---

## Phase 13: 2026-07-09 Settings Typeahead Search (I1)

**Goal**: FR-049 — a debounced typeahead with an inline reset (×) at the top of the Settings section,
matching a setting when **any** typed word appears in its name, description, or current value.

**Independent test**: Open Settings, type one remembered word from a setting's label, description, or
current value; only matching settings (and their groups) remain. Add a second, unrelated word and the
results *widen*. Click the × and the full list returns.

### I1 — Settings typeahead search (FR-049)

- [x] T121 [P] [I1] Unit `packages/core/tests/unit/settings-search.test.ts` (write FIRST, fail): `searchTokens` splits/lowercases/drops blanks; `fieldHaystack` covers key + label + description + rendered value (arrays flattened, booleans rendered, null/undefined tolerated); `matchesQuery` matches on label / description / value, is case-insensitive + partial, matches when **ANY** token matches (OR), is false when none match, and is true for a blank query; `filterFields` returns all for a blank query, narrows in registry order, narrows by value, and returns `[]` on no match.
- [x] T122 [I1] `packages/core/src/config/settings-search.ts` (new, pure): `SearchableField`, `searchTokens`, `fieldHaystack`, `matchesQuery`, `filterFields(query, fields, valueOf)`. OR semantics (contrast `matchFamilies`' AND, FR-038b). Export from `@throng/core`.
- [x] T123 [P] [I1] E2E `packages/ui/tests/e2e/preferences-settings.e2e.ts` (update, write FIRST): the search box renders **above** the first group; a **name** word, a **description** word and a **value** word each filter correctly; two words **widen** (OR); non-matching groups are unmounted; a no-match query shows `settings-search-empty`.
- [x] T124 [P] [I1] E2E (same file): the filter is **debounced** — typed text lands in the field in the same task while the unmatched row is provably still rendered, then disappears once the debounce quiets; the reset (×) is absent when empty, clears the query + restores every row on click, and hides itself again.
- [x] T125 [I1] `packages/ui/src/renderer/preferences/settings-tab.tsx`: search field + inline reset button at the top of the form; split `query` (instant, controlled input) from `applied` (debounced via the existing `debounce` helper — DRY, no second implementation); filter `SETTINGS_METADATA` through `filterFields` with `getAtPath` as `valueOf`; drop empty groups; render the empty state. `preferences.css`: `.settings-search*` styling from the theme tokens.
- [x] T126 [I1] Verify T121/T123/T124 green; **mutation-check** the debounce assertion (apply the filter synchronously → T124 must fail) so the test is not vacuous.

### Delta dependencies

- T122 (core matcher) precedes T125 (the UI consumes it). T121/T123/T124 are written before their
  implementation (RGR). The slice is additive — no other slice depends on it, and it does not alter the
  FR-047 completeness test (an empty query shows every setting).

---

## Phase 14: Convergence

**Input**: `/speckit-converge` assessment of the codebase against spec.md, plan.md, tasks.md and the
constitution (2026-07-09). Phases 1–13 are delivered; the items below are the remaining gaps between the
artifacts' stated intent and the code as it currently stands.

- [x] T127 **CRITICAL** — Reconcile `README.md` and `ROADMAP.md` with the shipped Settings typeahead search: the README "Preferences editor" bullet and the ROADMAP "Settings, Preferences & Theme Editors" entry enumerate every other editor affordance but omit the debounced search field and its inline reset (×). Per Constitution *Documentation currency* (NON-NEGOTIABLE — "a PR MUST NOT be merged while any of these documents disagrees with the shipped behaviour") and FR-049 (missing). *(Done: both entries now describe the search; the README bullet also records the FR-041 reload/keep-editing choice.)*
- [x] T128 Surface an external on-disk change to a **dirty** JSON buffer instead of silently ignoring it: `packages/ui/src/renderer/preferences/json-tab.tsx` currently reloads only a **clean** buffer (`dirtyRef.current === false`) and takes no action at all when the buffer is dirty — no conflict indicator and no way to adopt the external content. Add a reload/conflict affordance letting the user **reload** (adopt the external document) or **keep editing** (their next apply overwrites), per FR-041 and the spec Edge Case "Simultaneous external edit" (partial). *(Done: `json-conflict` banner with Reload / Keep-editing. Reload calls `apply.cancel()` so the abandoned edit's pending debounced write cannot fire and clobber the adopted document; a successful apply clears the conflict — the "keep editing, your next apply overwrites" branch.)*
- [x] T129 [P] Add the missing FR-041 dirty-buffer coverage (write FIRST → Red): extend `packages/ui/tests/e2e/preferences-json.e2e.ts` with an external edit landing while the JSON buffer is dirty → the conflict/reload affordance is surfaced; reload adopts the external text; keep-editing preserves the user's buffer and the next apply wins. Note `packages/ui/tests/integration/prefs-external-change.test.ts:16` explicitly defers this case to US5, and no US5 test ever claimed it — the requirement fell between the two stories. Per FR-041 / Constitution V (missing). *(Done: 2 E2E tests, Red before implementation. An incomplete document is used as the dirty state because it never applies — the standalone editor has no bracket auto-closing, so the buffer stays invalid and therefore dirty. **Mutation-checked**: making the dirty branch also `setText(raw)` fails both tests, so the no-clobber assertion is not vacuous.)*
- [x] T130 Record or explicitly justify the branch's untraced UI changes, each of which ships passing E2E but traces to no FR or task: (a) app-wide text-selection disable in `packages/ui/src/renderer/theme.css` (a superset of FR-031's row-scoped rule), (b) drag-ghost + New Tab (+) theme-following in `packages/ui/src/main/ghost-window.ts` / `main.ts`, (c) the `--surface` / `--surface-active` theme aliases in `theme.css`. Either capture them as requirements (a `/speckit-clarify` session on this feature) or note them in the PR as out-of-feature fixes so a reviewer can tell them from 007's scope. Per spec/plan/tasks scope (unrequested). *(Done: recorded in the PR description under "Out-of-feature fixes carried on this branch". (a) generalises FR-031; (b) and (c) are theme-fidelity defects found while validating 007's chrome — (c) repairs six preferences surfaces and the cog menu, which are 007's own.)*

### Convergence dependencies

- T129 (Red) precedes T128 (Green) — RGR per Constitution V. T127 and T130 are documentation-only and
  independent of both, and of each other.
- Already tracked, not re-appended: **T088** (manual quickstart walk-through), **T089** (`/speckit-analyze`,
  user-run) and **T120** (full-suite run in a non-elevated session) remain `[~]` and are unchanged by this
  convergence pass.
