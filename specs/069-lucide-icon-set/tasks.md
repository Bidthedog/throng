# Tasks: One default icon set, drawn from Lucide

**Input**: Design documents from `specs/069-lucide-icon-set/`
**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/icon-sets-ipc.md](contracts/icon-sets-ipc.md)

**Tests**: Required. Constitution Principle V is non-negotiable: each change starts with a failing test
at the lowest layer that can show it (research R13).

**Organization**: Setup → the art gate → foundation → one phase per story → polish. The art gate
(Phase 2) is the one point where work stops for the maintainer (FR-031).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallel-safe — different files, no dependency on an unfinished task
- **[Story]**: US1–US5 from spec.md
- Paths are repository-relative

---

## Phase 1: Setup

**Purpose**: the key registry and everything the art review needs. No art enters the application.

- [x] T001 Write a failing unit test `packages/core/tests/unit/icon-keys.test.ts` asserting that `ICON_KEYS` equals today's `THRONG_THEME.icons` keys (110) minus `notifications`, plus `dragHandle`, `menuChecked` and `overrideIcon`; that each key is camelCase and unique; and that every key has a non-empty one-sentence `ICON_KEY_DESCRIPTIONS` entry (FR-011, FR-012). Then create `packages/core/src/icons/icon-keys.ts` (`ICON_KEYS` as an ordered `as const` tuple, `IconKey`, `ICON_KEY_DESCRIPTIONS`), moving the description text from the `icons.*` entries of `packages/core/src/config/theme-copy.ts` and writing descriptions for the three new keys, and export it from `packages/core/src/index.ts`.
- [x] T002 [P] Write `scripts/icon-review-page.mjs`. It takes `--lucide <unpacked lucide-static dir> --out <file.html>`, reads `packages/core/src/icons/default-set/SOURCES.json` and the descriptions (T001), and writes one self-contained HTML page. Per key it shows the key, `<key>.svg`, the description, the proposed art at 12, 16 and 24 px on a light and a dark background, its origin (Lucide name, or drawn for throng with the reason), and the keys sharing that art (FR-008). It flags each FR-009 pair side by side, and lists any `SOURCES.json` name missing from the Lucide package. Art drawn for throng is read from `specs/069-lucide-icon-set/review/drafts/<key>.svg`.
- [x] T003 [P] Write `scripts/vendor-lucide-icons.mjs <unpacked lucide-static dir>`. It refuses unless the package's `version` equals `SOURCES.json`'s `lucideVersion` (`1.66.0`). It copies `icons/<name>.svg` to `packages/core/src/icons/default-set/<key>.svg` for every `{lucide}` key, copies `specs/069-lucide-icon-set/review/drafts/<key>.svg` for every `{throng}` key, copies the package `LICENSE` to `packages/core/src/icons/default-set/LICENSE` after checking its first line is `ISC License` and that it carries the Feather MIT notice (research R1), and fails on any key left without a file (FR-004).
- [x] T004 Draft `packages/core/src/icons/default-set/SOURCES.json` (`{ "lucideVersion": "1.66.0", "keys": { "<key>": { "lucide": "<name>" } | { "throng": "<why Lucide has nothing fitting>" } } }`) for every `ICON_KEYS` entry. Different actions get different art (FR-008). Keys that share art for the same action are listed in `SOURCES.json`'s `sameAction` groups. Every FR-009 pair must be visibly distinct. Draw each `{throng}` key in Lucide's grid (24×24 viewBox, `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`, round caps and joins) at `specs/069-lucide-icon-set/review/drafts/<key>.svg` (FR-002).

---

## Phase 2: Art sign-off (FR-031) — gates the merge, not the build

- [x] T005 Run `scripts/icon-review-page.mjs` against `lucide-static@1.66.0` (unpacked outside the repository), publish the page as a private Artifact, and hand it to the maintainer. Revise `SOURCES.json` and the drafts per their feedback, regenerate and republish until they sign it off. Record the signed-off `SOURCES.json` commit SHA here. The maintainer moved this sign-off to after implementation (Clarifications, 2026-11-15): Phase 3 onwards builds with the proposed mapping, and an art change after review is a `SOURCES.json` or drawing edit plus `scripts/vendor-lucide-icons.mjs` and `npm run generate:icons`. **The PR does not leave draft before this is ticked.** Signed off by the maintainer on 2026-11-15 at `SOURCES.json` commit `f2e61f259e8d6de14f1badb23fbee513f65ba645`.

---

## Phase 3: Foundation (blocking)

- [x] T006 Run `scripts/vendor-lucide-icons.mjs` to write `packages/core/src/icons/default-set/*.svg` and `LICENSE`. Add a unit test `packages/core/tests/unit/default-icon-set.test.ts` that fails unless: every `ICON_KEYS` key has exactly one `default-set/<key>.svg` and `SOURCES.json` entry (FR-004); every file is unchanged by `sanitiseSvg`; none contains `<text`, `<image` or a colour literal in `fill`/`stroke` other than `none` or `currentColor` (FR-005, FR-006); and every viewBox is `0 0 24 24` (FR-007). It also fails when two keys share art without being in one of `SOURCES.json`'s `sameAction` groups, or when either member of an FR-009 pair has the same SVG content as the other (FR-008, FR-009). Let `packages/ui/tests/unit/no-inline-artwork.test.ts` allow `default-icon-set.generated.ts` by name, since its markup is resolved through keys.
- [x] T007 Write `scripts/generate-default-icon-set.mjs`, which emits `packages/core/src/icons/default-icon-set.generated.ts` (`DEFAULT_ICON_SET: Readonly<Record<IconKey, string>>` of sanitised markup, and `ICON_SETS_README` holding the text of `packages/core/src/icons/icon-sets-README.txt`, created here as a stub that T030 completes). Extend `default-icon-set.test.ts` so the checked-in module equals a fresh in-memory generation (research R2). Export both from `packages/core/src/index.ts`. Add a `generate:icons` npm script. The same test asserts that neither `electron-builder.yml` nor any package's `files` field ships `src/icons/default-set` (FR-021).
- [x] T008 Write a failing unit test `packages/core/tests/unit/resolve-icon.test.ts`, then create `packages/core/src/icons/resolve-icon.ts`: `resolveIcon(theme, sets, key)` returns the selected user set's markup for `key` when present, otherwise `DEFAULT_ICON_SET[key]`. Absent, `throng`, unknown or unavailable `iconPack` all mean the default set, and the function always returns drawable markup (FR-013, FR-015, FR-016). The test also shows that a set's override wins whatever `DEFAULT_ICON_SET` holds for that key, and that a key the set lacks, including one added later, takes the default's current art (FR-034). Define the `UserIconSetDto` shape from data-model *IconSetPayload* in core.
- [x] T009 Retire glyphs and overrides in core (supersedes 007 FR-039/FR-040, 017 FR-003, 009 FR-021): remove `icons`, `iconOverrides`, `IconValue` and `IconAsset` from `packages/core/src/config/theme.ts`, `THRONG_THEME` and `packages/core/src/config/default-themes/index.ts`; remove the `icons.*` descriptors from `theme-metadata.ts` and the `icons.*` copy from `theme-copy.ts` (moved by T001); make `migrateTheme` in `theme-ops.ts` drop `icons` and `iconOverrides` on read; delete `packages/core/src/config/icon-pack.ts`; repoint `notice/entry-look.ts` and the `panel-type.ts` `icon:` fields to `IconKey`; make creating or cloning a theme (the clone path in `theme-ops.ts` and `packages/ui/src/renderer/preferences/themes-tab.tsx`) produce a theme with no `iconPack`, so it starts on the default set, with a failing test first (FR-014). Update every core test asserting the retired behaviour (plan *Test impact*: core unit and contract), and run them narrowly. The workspace typecheck is red from T009 until T011 lands, so T009 to T011 are committed together.
- [x] T010 Main: replace `packages/ui/src/main/icon-pack-service.ts` with a minimal `packages/ui/src/main/icon-set-service.ts` that lists no sets yet. Delete `ensureBundledPacks` and `ensureReadme` (research R6's ordering trap). Change `ConfigPayload.iconPacks` to `iconSets: UserIconSetDto[]` in `packages/ui/src/main/config-watcher.ts`, and serve the cached sets on every re-read without re-reading set folders (FR-029). Update `main.ts`, `config-write-ipc.ts` (remove `listIconPacks`), `preload.cts` and `renderer/global.d.ts` (remove the stale `IconPackInfo` and `raster` DTOs). Update the ui unit and integration tests in plan *Test impact* that assert packs.
- [x] T011 Renderer: move `common/icon.tsx`, `common/icon-button.tsx`, `editor/markdown-fold.ts` and `preview/providers/markdown/fold-gutter.ts` onto `resolveIcon`, which always renders svg markup with no glyph branch, and replace `useIconPacks` with `useIconSets` in `config/config-store.tsx`. Update the ui component tests in plan *Test impact* that assert glyph rendering.

**Checkpoint**: every icon in the app draws from the default set; nothing references packs, glyph maps or overrides.

---

## Phase 4: User Story 1 — One icon set everywhere (P1) 🎯 MVP

**Goal**: every icon is Lucide-family line art, identical on Windows and Linux, in every theme.

**Independent Test**: open every icon-bearing surface on both OSes in a light and a dark theme; no icon is a font character.

- [x] T012 [US1] Extend `packages/ui/tests/unit/no-inline-artwork.test.ts` (or add `packages/ui/tests/unit/no-glyph-icons.test.ts`) so it fails on any JSX `<button>` or `IconButton`-less action control whose content is a lone non-alphanumeric glyph, and on `✓` menu-label prefixes (FR-010). Watch it fail against `projects-panel.tsx`, `subworkspaces-panel.tsx`, `panel-placeholder.tsx`, `content-menu.ts`, `category-menu.ts` and `notifications-menu.ts`.
- [x] T013 [US1] Bring those sites onto keys (research R3): grips → `dragHandle`; edit → `rename`; remove and delete → `destroy`; open → `detach`; panel close → `windowClose`, each as an `IconButton` with a hover title naming the action, in `packages/ui/src/renderer/panes/projects-panel.tsx`, `packages/ui/src/renderer/panes/subworkspaces-panel.tsx` and `packages/ui/src/renderer/workspace/panel-placeholder.tsx`. Update their component tests.
- [x] T014 [US1] Render the menu checked state through `menuChecked` in the context menu's icon slot (`packages/ui/src/renderer/workspace/context-menu.tsx`) instead of a `✓` label prefix in `content-menu.ts`, `category-menu.ts` and `notifications-menu.ts`, with a checked-state accessible name. Update the menu tests that assert `✓`.
- [x] T015 [US1] Make `packages/ui/tests/unit/icon-call-sites.test.ts` / `icon-tokens-exist.test.ts` assert, over `ICON_KEYS`, that every key has a render site and every render site names a key (FR-010, FR-011). Delete `core/tests/unit/icon-tokens-068.test.ts`'s assertion on `notifications`.

**Checkpoint**: US1 is complete; SC-001 and SC-002 are checkable by hand.

---

## Phase 5: User Story 2 — Every icon reviewed and described (P1)

**Goal**: Preferences → Themes → Icons shows each icon with its key, file name and description.

**Independent Test**: open the Icons section; every row has an icon, a key, `<key>.svg` and a description on hover.

- [x] T016 [US2] Write a failing component test `packages/ui/tests/component/icon-section.test.ts`: with the default set selected, the grid shows one read-only row per `ICON_KEYS` key carrying its icon, key, `<key>.svg` and its description as a hover title, with no override input, no Override this icon, no Open folder and no Reload (FR-012, FR-027, FR-028, FR-032).
- [x] T017 [US2] Rewrite the grid in `packages/ui/src/renderer/preferences/icon-section.tsx` (with `packages/ui/src/renderer/preferences/preferences.css`) to the read-only rows; remove `overrideIcon` and the "(default glyphs)" option from `packages/ui/src/renderer/preferences/themes-tab.tsx`. The picker's label reads "Icon set". Update `preferences-themes-tab`, `themes-tab-folding` and `themes-tab-subgroups` component tests.

**Checkpoint**: US2 is complete; the review of FR-031 continues in place through the manual test plan.

---

## Phase 6: User Story 4 — Create an icon set and override icons in it (P2)

**Goal**: the US4 journey end to end.

**Independent Test**: create a set, Override this icon on `save`, replace the file on disk, Reload this set, see it in the editor title bar.

- [x] T018 [P] [US4] Write a failing unit test `packages/core/tests/unit/icon-set-name.test.ts`, then `packages/core/src/icons/icon-set-name.ts`: `validateIconSetName(name, existing)` refuses empty, `throng`, any name equal to an existing set ignoring case, names ending `.bak` or `.bak.<n>`, Windows-reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`), characters `< > : " / \ | ? *` and control characters, and trailing dots or spaces, each with its own reason (FR-025).
- [x] T019 [US4] Write a failing integration test `packages/ui/tests/integration/icon-set-service.test.ts` on a real temp dir covering:
  - listing skips `.bak` and `.bak.<n>` folders (FR-037);
  - `<key>.svg` for a known key is an override; other files are unrecognised; an unreadable or sanitiser-rejected file is a per-key failure that falls back (FR-027);
  - a user `save.svg` containing `<text>`, `<image>` or `<foreignObject>` loads with none of them in its markup, so no user icon can draw a font character (FR-005);
  - a missing folder is an unavailable set with a reason (FR-016);
  - create from the default set makes an empty folder, and create from a user set copies only its `<IconKey>.svg` files (FR-024);
  - override writes `DEFAULT_ICON_SET[key]` and returns `exists` without `replace` (FR-032, FR-033);
  - reload re-reads one set, and editing files without reload changes nothing (FR-029).
- [x] T020 [US4] Implement `packages/ui/src/main/icon-set-service.ts` to pass T019, with `fs`, the logger and the sets directory injected (Principle IX). Log failures with `logExpected` / `logCaught` (XIII).
- [x] T021 [US4] Write a failing unit test `packages/ui/tests/unit/icon-sets-ipc.test.ts` for the handlers in `contracts/icon-sets-ipc.md`: `create`, `override`, `reload` and `openFolder` resolve paths in main from listed names only, refuse `throng` and unknown sets, and `openFolder` without a set opens the sets directory through `IShellIntegration.openFolder`. Then implement `packages/ui/src/main/icon-sets-ipc.ts`, register it in `main.ts`'s composition root, and bridge it in `packages/ui/src/preload/preload.cts` and `packages/ui/src/renderer/global.d.ts`.
- [x] T022 [US4] Extend `packages/ui/tests/component/icon-section.test.ts` (failing first): the picker lists `throng` and every user set, with unavailable sets disabled and showing their reason. With a user set selected it offers Copy, Open folder, Reload this set and the one-line hint (FR-029). Each row shows Overridden or Default, decided by file presence alone (FR-027), and offers Override this icon. An `exists` reply opens a Replace / Cancel prompt, and Cancel leaves the file (FR-033). Copy opens the name prompt with `validateIconSetName` and switches the theme to the new set (FR-024, FR-025). Unrecognised files are listed. Selecting a set triggers a reload.
- [x] T023 [US4] Implement T022 in `packages/ui/src/renderer/preferences/icon-section.tsx`, `packages/ui/src/renderer/preferences/themes-tab.tsx` and `packages/ui/src/renderer/preferences/name-dialog.tsx`, generalising `NameDialog` to take a `validate` function and keeping `validateThemeName` for themes. Every new control is an `IconButton` with a hover title: Copy (`copy`), Override this icon (`overrideIcon`), Reload this set (`refresh`), Open folder (`folderOpen`) (FR-030). The prompts keep text buttons.

**Checkpoint**: US4 is complete.

---

## Phase 7: User Story 3 — Upgrade to the new default set (P2)

**Goal**: alpha16 configs upgrade with nothing converted, nothing lost and nothing blank.

**Independent Test**: start from an alpha16 config root (spec US3) and check the folders, themes and notices.

- [x] T024 [US3] Write a failing unit test `packages/core/tests/unit/icon-set-upgrade.test.ts` for `planThemeIconSetUpgrade(theme)` in `packages/core/src/icons/icon-set-upgrade.ts`: it removes `icons`, `iconOverrides` and `iconPack` from built-in and user themes alike, and a second pass plans nothing (FR-017, FR-018, FR-020). Bump `SHIPPED_DEFAULTS_VERSION` to 34 in `packages/core/src/config/shipped-defaults.ts` with its history comment, compose the step into `ShippedDefaultsService.upgrade()` in `packages/ui/src/main/shipped-defaults-service.ts`, and update the tests asserting version 33 (`theme-icon-upgrade-067.test.ts`, the shipped-defaults fidelity contract).
- [x] T025 [US3] Write `scripts/generate-seeded-icon-history.mjs`. For each `v1.0.0-alpha*` tag it reads that tag's `theme.ts` icon map and `icon-pack-service.ts` seeding code (`git show`), runs the seeder against a temporary directory, and records the SHA-256 of every file written under `throng/` and `throng-svg/`, grouped per tag. It emits the frozen `packages/core/src/icons/seeded-icon-history.generated.ts` (research R6). A tag whose seeder cannot be reproduced is skipped and named in the file's header comment.
- [x] T026 [US3] Write a failing unit test, then `classifySeededFolder(name, files: {name, sha256}[])` and `backupName(name, taken)` in `packages/core/src/icons/icon-set-upgrade.ts`. A seeded folder is uncustomised only when its file-name set equals the set some single tag seeded and every hash matches that tag (data-model *SeededIconHistory*, FR-036). `backupName` returns `<name>.bak`, or `<name>.bak.<n>` for the first free `n` (FR-019).
- [x] T027 [US3] Write a failing integration test `packages/ui/tests/integration/icon-set-upgrade.test.ts` on a real temp config root covering:
  - a user pack becomes `<name>.bak` with byte-identical contents;
  - an edited `throng-svg` becomes `throng-svg.bak`, or `throng-svg.bak.2` when `.bak` is taken;
  - an unedited `throng` is deleted;
  - `README.md` is deleted;
  - a rename that fails (simulated) is logged and retried at the next start, while a set created after the first attempt is never touched (`pending` list);
  - `done` stops every later run (FR-019, FR-020, FR-036).

  Then implement `packages/ui/src/main/icon-set-upgrade.ts` with `<configRoot>/icon-sets-upgrade.json`, and call it from `main.ts` before `IconSetService` first lists sets.
- [x] T028 [P] [US3] Add the serialisable action `{ kind: 'openIconSetsFolder' }` with a failing test at each of its four places: `packages/core/src/notice/notification-entries.ts` (type and parser), `packages/ui/src/main/notifications-ipc.ts`, `packages/ui/src/renderer/notifications/use-notification-actions.ts` and `packages/ui/src/renderer/notifications/notifications-menu.ts` (research R7).
- [x] T029 [US3] Write the notice text in core (`iconSetBackupNoticeText(count)` in `packages/core/src/icons/icon-set-upgrade.ts`). It says the folders hold icons from before the upgrade, that nothing was converted, and to move what is wanted into a new set and then delete or move the backups. Write a failing component test `packages/ui/tests/component/icon-set-backup-notice.test.ts` (one sticky notice, `groupKey: 'icon-set-backups'`, an Open folder `IconButton` that calls `openFolder()`, nothing raised for a count of 0, and a dismissed notice raised again when the component mounts on the next start). Then implement `packages/ui/src/renderer/common/icon-set-backup-notice.tsx`, mount it in `packages/ui/src/renderer/app.tsx`, and add `throng:iconSets:backupsPresent` / `…:backupsReady` in `main.ts` with the pending-once handshake of the installed-version notice. Main removes the persisted panel entry for the group when no backup remains (FR-038).

**Checkpoint**: US3 is complete; SC-004 is checkable.

---

## Phase 8: User Story 5 — Licence recorded and a README for set authors (P3)

- [x] T030 [P] [US5] Write a failing unit test `packages/core/tests/unit/icon-sets-readme.test.ts` that parses the key list fenced in `packages/core/src/icons/icon-sets-README.txt` (lines `<key>.svg - <description>`) and fails unless it equals `ICON_KEYS` with `ICON_KEY_DESCRIPTIONS`, in order. It also fails on any Markdown heading or emphasis (FR-023, FR-035). Then write the README in plain text: creating a set, Override this icon and the replace prompt, replacing and removing files outside throng, Reload this set and restarting, how new and redrawn icons reach a set, and migrating a `.bak` folder by hand. Regenerate `default-icon-set.generated.ts`.
- [x] T031 [US5] Write a failing integration test in `packages/ui/tests/integration/icon-set-service.test.ts`: at startup `icon-packs/README.txt` is written when absent or different, with the OS line ending, UTF-8 and no BOM, and is left untouched when identical. Implement it in `packages/ui/src/main/icon-set-service.ts`.
- [x] T032 [P] [US5] Add a `VENDORED` list to `scripts/generate-licenses.mjs` (Lucide 1.66.0, ISC, https://lucide.dev, `licenseText` read from `packages/core/src/icons/default-set/LICENSE`) merged before sorting, and add an expandable licence text to the entry in `packages/ui/src/renderer/about/about-app.tsx`. Cover both with tests: a new `packages/ui/tests/unit/generate-licenses.test.ts`, and the About component test (FR-022).
- [x] T033 [P] [US5] Rewrite the icon section of `docs/preferences.md` under the `throng-docs` skill: the default set, the picker, Copy, Override this icon, Open folder, Reload this set, the file-per-key format, the fallback to the default set, backups after the upgrade, and a pointer to `README.txt`. Run `packages/ui/tests/unit/docs-currency.test.ts`.
- [x] T034 [P] [US5] Add `CHANGELOG.md` `## Unreleased` entries, each linking #127. Under `### Changed`: one default icon set, and icon sets customised by Override this icon. Under `### Removed`: the old packs, glyph maps and per-theme overrides, stating plainly that nothing was converted, that old folders were renamed `.bak`, how to migrate them, and that `README.txt` in the icon sets folder has the steps (FR-039).

---

## Phase 9: Polish & cross-cutting

- [x] T035 Replace `packages/ui/tests/e2e/icon-packs.e2e.ts` with `packages/ui/tests/e2e/icon-sets.e2e.ts` (`@extended @prefs`, its own app via `runOwnApp` with a seeded config root): create a set, Override this icon on `settings`, write a different `settings.svg` into the set folder from the test, press Reload this set, and assert the main window's title-bar cog draws it with no restart, in the theme's colour. Update `parallel-plan.json` and re-seed `e2e-budget.json` in the same commit, and update `icon-colour.e2e.ts`, `helpers/config-snapshot.ts`, `preferences-themes.e2e.ts`, `preferences-reset.e2e.ts` and `theme-fonts.e2e.ts` where they assert packs, glyphs or overrides.
- [x] T036 Sweep every user-visible "icon pack" string to "icon set" (Preferences labels, hover titles, notices) and remove what is left of the retired code: `git grep -n -i -E "icon ?pack|iconOverrides|IconValue|resolveIconAsset|throng-svg" -- packages scripts docs ':!*.generated.ts' ':!packages/core/src/icons/icon-set-upgrade.ts'` must show only the upgrade code, the `iconPack` JSON key and the tests that cover them.
- [x] T037 Run the quickstart's automated block and extend the branch's manual test plan by `planning-manual-tests` from spec.md's acceptance scenarios (US1 to US5), one group per surface area for the icon review (explorer, panels, panes, window controls, menus, find, Preferences, resource monitor, previews and editors, notifications), with `Covers:` naming the FR and SC ids. The size groups cover FR-007's legibility at 12 and 16 px, which no automated test can judge.

---

## Dependencies & execution order

- **Phase 1**: T001 first. T002 and T003 are [P] after T001, and T004 follows T001.
- **Phase 2 (T005)** blocks the merge, not the work after it.
- **Phase 3**: T006 → T007 → T008 → T009 → T010 → T011, in order, because each removes what the next depends on.
- **Stories**: US1 (Phase 4) and US2 (Phase 5) need Phase 3. US4 (Phase 6) needs T010 and T011. US3 (Phase 7) needs T009 and T010; T028 is independent. US5 (Phase 8) needs T007; T031 needs T020.
- **Polish**: after every story.
- **US4 and US3 land in the same PR.** Without US3's backups, T020 would list the old `pack.json` folders as sets.

## Parallel opportunities

- T002 ∥ T003 (different scripts).
- After Phase 3, three boundaries run side by side: **core** (T018, T024 to T026, T030), **main**
  (T019 to T021, T027, T031), and **renderer** (T012 to T017, T022, T023, T029). T028, T032, T033 and
  T034 touch disjoint files.

## Implementation strategy

MVP = Phases 1 to 4: the default set everywhere, behind the art gate. Then US2, US4 and US3, which keep
the upgrade path safe before anything is released, then US5 and the polish. Release only with US3 in, so
no alpha16 install upgrades without its backups.


## Phase 10: Convergence

- [x] T038 Copy every `<key>.svg` present in the source set's folder at copy time (read the directory, not the in-memory listing), failed-to-load files included and a file gone since the last load skipped, in `packages/ui/src/main/icon-set-service.ts` with an integration case in `packages/ui/tests/integration/icon-set-service.test.ts` per FR-024, FR-027, US4/AC3 (contradicts)
- [x] T039 Exclude a folder named `throng` (ignoring case) from the listed user sets and refuse it in `pathOf`, in `packages/ui/src/main/icon-set-service.ts` with an integration case, per contracts/icon-sets-ipc.md, FR-021, FR-025 (contradicts)
- [x] T040 Keep the new-set name dialog open until `create` resolves and show main's refusal on its name field in `packages/ui/src/renderer/preferences/icon-section.tsx`, and log the `unknown-key` and `source-unavailable` refusals with `logExpected` in `packages/ui/src/main/icon-sets-ipc.ts` and `icon-set-service.ts`, per FR-025, contracts/icon-sets-ipc.md (partial)
- [x] T041 Give the create control one name, "New set from this set", in its hover title (`icon-section.tsx`), `packages/core/src/icons/icon-sets-README.txt` (then `npm run generate:icons`) and `docs/preferences.md`, per SC-006, FR-023, FR-030 (partial)

## Phase 11: Convergence

- [x] T042 Log a rejected `iconSets.create` call with `logCaught`, close the prompt and report it, in `packages/ui/src/renderer/preferences/icon-section.tsx` `createSet`, so the name prompt never sits open with nothing said, per Constitution XIII (partial)
- [x] T043 Title the new-set prompt "New set from “<set>”" in `packages/ui/src/renderer/preferences/icon-section.tsx`, matching the control's name, per SC-006 (partial)

## Phase 12: Maintainer review

- [x] T044 Draw `minimisePanel` / `restorePanel`, turned to face the edge, on the side panes' hide and show controls and the Notifications and Sub-workspaces panels' minimise controls through `RotatedIcon` (`packages/ui/src/renderer/common/rotated-icon.tsx`, any angle) and `CollapseIcon` (`packages/ui/src/renderer/panes/collapse-icon.tsx`), retiring the pane chevron, per FR-040
- [x] T045 Read every set from disk before and after every icon-set action and broadcast the result, in `packages/ui/src/main/icon-sets-ipc.ts` and `IconSetService.rescan` (`packages/ui/src/main/icon-set-service.ts`); Reload takes no set (`packages/ui/tests/unit/icon-sets-ipc.test.ts`, `packages/ui/tests/integration/icon-set-service.test.ts`), per FR-041
- [x] T046 Rename and delete a user set (`IconSetService.rename` / `remove`, the `rename` and `remove` channels, `packages/ui/src/main/icon-set-themes.ts` carrying the themes along), with the Rename prompt and the Delete confirmation in `packages/ui/src/renderer/preferences/icon-section.tsx`, per FR-042, FR-043
- [x] T047 Reset an overridden icon (`IconSetService.resetIcon`, the `resetIcon` channel) from a hidden-when-unused slot on each row, per FR-044
- [x] T048 Let the folder Open folder shows come up above Preferences: `yieldFloatingWindows` in `packages/ui/src/main/floating-window-layering.ts`, called before the shell opens it (`packages/ui/tests/unit/floating-window-layering.test.ts`), per FR-045
- [x] T049 Move the Icon set row's messages to toasts, order the row picker-last with always-shown controls beside it, and mark user sets with an asterisk, in `icon-section.tsx` and `preferences.css` (`packages/ui/tests/component/icon-section.test.ts`), per FR-046 to FR-048
- [x] T050 Maximise Preferences by hand on Linux, where the window manager will not maximise a parented window: `packages/ui/src/main/window-maximise.ts` behind `window-controls-ipc.ts` (`packages/ui/tests/unit/window-maximise.test.ts`, the maximise case in `packages/ui/tests/e2e/preferences-window.e2e.ts`), per 007 FR-004

## Phase 13: Maintainer review (second)

- [x] T051 Keep every action control on the Themes tab on screen, disabled and greyed with a reason as its title when it cannot be used: the toolbar and search Clear in `packages/ui/src/renderer/preferences/themes-tab.tsx`, the icon colour Clear, Rename, Delete, Override and Reset in `packages/ui/src/renderer/preferences/icon-section.tsx`, the dimmed state in `preferences.css` (`packages/ui/tests/component/icon-section.test.ts`, `packages/ui/tests/component/preferences-themes-tab.test.ts`, the Revert check in `packages/ui/tests/e2e/preferences-fonts-and-sliders.e2e.ts`), per FR-049
- [x] T052 Put every notice's own button in the card's top-right control group: `notice__controls` in `packages/ui/src/renderer/common/notification.tsx`; Open folder, Restart, Install and Cancel moved from `body` to `controls` in `icon-set-backup-notice.tsx`, `installed-version-notice.tsx`, `command-line-notice.tsx` and `packages/ui/src/renderer/explorer/paste-progress-notice.tsx`; guarded by `packages/ui/tests/unit/toast-controls-guard.test.ts` (`packages/ui/tests/component/icon-set-backup-notice.test.ts`, `packages/ui/tests/component/paste-progress-notice.test.ts`), per FR-050 and constitution 6.8.0
- [x] T053 Space the controls of a toast and of a Notifications panel entry and give them the hover surface, in `packages/ui/src/renderer/theme.css` and `packages/ui/src/renderer/notifications/notifications.css` (`packages/ui/tests/unit/toast-controls-guard.test.ts`, `packages/ui/tests/unit/paste-progress-css.test.ts`), per FR-051
- [x] T054 Delay the pointer's reveal on notices by `notifications.hoverDelayMs` (`NOTICE_HOVER_DELAY_*` and the parse in `packages/core/src/notice/display-mode.ts`, the descriptor in `packages/core/src/config/settings-metadata.ts`), through `useHoverIntent` (`packages/ui/src/renderer/common/use-hover-intent.ts`) in `notifications-panel.tsx` and `common/notification.tsx`; documented in `docs/preferences.md` (`packages/core/tests/unit/notice/display-mode.test.ts`, `packages/ui/tests/component/use-hover-intent.test.ts`, `packages/ui/tests/component/notification-entry-layout.test.ts`, `packages/ui/tests/component/toast-size.test.ts`), per FR-052
- [x] T055 Lay out the project settings dialog in one button column with each section boxed and each global list on its own line, and open Preferences at the setting itself: `packages/ui/src/renderer/project-settings/`, the setting-key deep link in `packages/ui/src/renderer/preferences/settings-tab.tsx` (`packages/ui/tests/component/project-settings-dialog.test.ts`, `packages/ui/tests/component/preferences-section-deeplink.test.ts`), per FR-053 (#638)
- [x] T056 Give About, Preferences, the project settings dialog and the Resource Monitor one look: the shared `.icon-button`, `.section-heading` and `.field` in `packages/ui/src/renderer/theme.css`, the optional `iconButtonSurface` token (`packages/core/src/config/theme.ts`, `theme-metadata.ts`, `theme-copy.ts`), the windows on `--bg`, About's title bar and Close, the Monitor's buttons and headings, and the form-history row's icon controls (`packages/ui/tests/unit/secondary-window-styles.test.ts`, `packages/ui/tests/unit/resources/monitor-css.test.ts`, `packages/core/tests/unit/theme-metadata.test.ts`), per FR-054 (#639)
- [x] T057 Add the `deleteFile` key, vendored from Lucide 1.66.0 `trash-2` (`packages/core/src/icons/icon-keys.ts`, `default-set/SOURCES.json`, `default-set/deleteFile.svg`, `icon-sets-README.txt`, the generated set), and draw it on the File Explorer's Delete in `packages/ui/src/renderer/explorer/toolbar.tsx` and `context-menu-items.ts` (`packages/core/tests/unit/icon-keys.test.ts`, `packages/ui/tests/unit/menu-icon-tokens.test.ts`, `packages/ui/tests/component/explorer-toolbar.test.ts`), per FR-055
- [x] T058 Add the sixteen file and folder kinds Lucide draws (`packages/core/src/icons/icon-keys.ts`, `default-set/SOURCES.json`, the vendored art, `icon-sets-README.txt`), map names to them and draw folder kinds and the linked-folder badge in `packages/ui/src/renderer/explorer/tree-icons.ts` and `tree-node.tsx` (`packages/ui/tests/unit/tree-icons.test.ts`, `packages/ui/tests/component/tree-row-icons.test.ts`), per FR-056
- [x] T059 Draw an icon per common programming language with `scripts/draw-file-label-icons.mjs` into `specs/069-lucide-icon-set/review/drafts/`, vendor them as `throng` entries and map each language's extensions (`packages/ui/tests/unit/tree-icons.test.ts`, `packages/core/tests/unit/icon-keys.test.ts`), per FR-057
- [x] T060 Draw `fileMarkdown` as the Markdown mark with `scripts/draw-file-label-icons.mjs` and vendor it as a `throng` entry, per FR-058
- [x] T061 Add `explorer.popoverDelayMs` (`packages/core/src/config/app-settings.ts`, `settings-metadata.ts`, `docs/preferences.md`) and the row popover `packages/ui/src/renderer/explorer/path-popover.tsx`, opened from `tree-node.tsx` in place of the row's `title`, styled in `theme.css` and registered in `floating-surfaces.test.ts` (`packages/ui/tests/component/explorer-path-popover.test.ts`), per FR-059
- [x] T062 Add the optional `titleBarSurface` token (`packages/core/src/config/theme.ts`, `theme-copy.ts`, `theme-metadata.ts`) and paint `.title-bar` with it, defaulting to a tenth toward the text colour, in `packages/ui/src/renderer/title-bar/title-bar.css` (`packages/ui/tests/unit/secondary-window-styles.test.ts`), per FR-060
- [x] T063 Colour file icons by category: `packages/core/src/config/file-icon-colours.ts` (categories, key map, per-theme derivation), the seven optional tokens in `theme.ts`, `theme-copy.ts`, `theme-metadata.ts` and every bundled theme, the contrast check in `theme-quality.ts`, and `data-icon-category` on the tree, Find in Files and popover icons styled in `theme.css` (`packages/core/tests/unit/file-icon-colours.test.ts`, `packages/ui/tests/component/tree-row-icons.test.ts`, `packages/ui/tests/unit/secondary-window-styles.test.ts`), per FR-061
- [x] T064 Size the helper's icon to its 14px box, give it a 2px gap before and 6px after, raise it 4px, and let the Total cell clip with a margin so the raised helper is not cut off, in `packages/ui/src/renderer/theme.css` (`packages/ui/tests/unit/resources/monitor-css.test.ts`), per FR-062
- [x] T065 Draw `RowActions` on the Icon set and Icon colour rows from the on-entry and shipped themes the Themes tab passes in, replacing the lone icon colour Clear, in `packages/ui/src/renderer/preferences/icon-section.tsx` and `themes-tab.tsx` (`packages/ui/tests/component/icon-section.test.ts`), per FR-063
- [x] T066 Add the `other` category for the unknown `file` icon: `fileIconOther` in `file-icon-colours.ts` (a neutral grey at the categories' contrast), `theme.ts`, `theme-copy.ts` and `theme.css`, with `theme-quality.ts` re-measured (`packages/core/tests/unit/file-icon-colours.test.ts`, `default-themes.test.ts`, `theme-quality.test.ts`), per FR-064
- [x] T067 Put the panel type icon first in the header and Back / Forward after it, in DOM and in `order`, in `packages/ui/src/renderer/workspace/panel-placeholder.tsx` and `theme.css` (`packages/ui/tests/component/back-forward-buttons.test.ts`), per FR-065
- [x] T068 Count anything maximised as Focus Mode (`useTabInFocusMode` in `packages/ui/src/renderer/workspace/maximise-store.ts`, read by `panes/focus-mode-panes.tsx`), and name the diagram's control Enter / Exit Focus Mode in `preview/diagram/diagram-frame.tsx` and the icon key descriptions (`packages/ui/tests/component/focus-mode-panes.test.ts`, `preview-diagram-frame.test.ts`), per FR-066
- [x] T069 Put the File Manager item under a `Subsection` with its own fold key, as General's last subgroup, in `packages/ui/src/renderer/preferences/settings-tab.tsx` (`packages/ui/tests/component/preferences-app.test.ts`), per FR-067
- [x] T070 Regroup `packages/core/src/config/settings-metadata.ts` into General, one Editor and one Search heading with subgroups, and `docs/preferences.md` with it (`packages/core/tests/unit/settings-metadata.test.ts`, `settings-metadata-040.test.ts`, `packages/ui/tests/component/preferences-attention.test.ts`, `packages/ui/tests/e2e/navigation-remember.e2e.ts`), per FR-068
- [x] T071 Give `.about-licence-text` `cursor: default` in `packages/ui/src/renderer/about/about.css`, and drop the licence-text toggle and its block from `about-app.tsx` (`packages/ui/tests/component/about-app.test.ts`, `packages/ui/tests/unit/secondary-window-styles.test.ts`), per FR-069
- [x] T072 Move `SHIPPED_DEFAULTS_VERSION` to 35 in `packages/core/src/config/shipped-defaults.ts` so `fileIconOther` reaches every theme file (`packages/ui/tests/integration/shipped-defaults-seed-upgrade.test.ts`), guard theme leaves by version (`packages/core/tests/unit/theme-leaves-version.test.ts`, `packages/core/tests/fixtures/theme-leaves-by-version.json`), and amend the constitution to 6.9.0, per FR-070
