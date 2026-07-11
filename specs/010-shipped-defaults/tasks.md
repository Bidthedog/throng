# Tasks: Shipped Defaults

**Feature**: `010-shipped-defaults` | **Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md)

**Tests**: TDD is mandatory (executed via the Superpowers bridge). Each implementation task is preceded
by its failing test task. No E2E — this feature ships no UI (Constitution V scopes E2E to UI changes).

**Layout**: pure logic in `packages/core/src/config/shipped-defaults.ts`; I/O in
`packages/ui/src/main/shipped-defaults-service.ts` + `packages/ui/src/main/config-store.ts`; build-time
materialisation in `scripts/`. Test layers: `unit` (`packages/*/tests/unit`), `integration`
(`packages/ui/tests/integration`), `contract` (`packages/*/tests/contract`).

---

## Phase 1: Setup

- [x] T001 [P] Create `packages/core/src/config/shipped-defaults.ts` with types (`ShippedDefaults`, `ThemeUpgradePlan`), the `SHIPPED_DEFAULTS_VERSION` constant, and stubbed signatures for `buildShippedDefaults`, `reservedThemeNames`, `isReservedThemeName`, `resetBindingValue`, `resetSettingValue`, `fillMissingThemeProps`, `planThemeUpgrade`, `serializeShippedDefaults`; export them from `packages/core/src/index.ts`.

**Checkpoint**: `@throng/core` compiles and the new symbols are importable (stubs may throw).

---

## Phase 2: Foundational (blocking prerequisites for US2–US6)

- [x] T002 [P] Write failing integration tests for the transactional writer in `packages/ui/tests/integration/config-store-atomic.test.ts`: (a) all files written on success; (b) a stage-phase failure writes nothing; (c) a commit-phase failure rolls back already-committed files to their prior bytes (present-before restored, absent-before deleted) and reports `failedPath` — simulate the unwritable target by pre-creating the target path as a **directory**.
- [x] T003 Implement `writeFilesAtomic(files: {path;content}[]): Promise<WriteAllResult>` in `packages/ui/src/main/config-store.ts` (snapshot → stage temps → commit renames → rollback on first failure) to green T002.
- [x] T004 Create the `ShippedDefaultsService` skeleton in `packages/ui/src/main/shipped-defaults-service.ts` — `constructor(store: FileConfigStore, shipped: ShippedDefaults)` plus stubbed `seed/upgrade/restoreAllThemes/resetBinding/resetSetting/resetEverything/readAppliedVersion`; add a `ShippedDefaultsService` token to `packages/ui/src/main/tokens.ts`.
- [x] T005 Bind `ShippedDefaults` (from `buildShippedDefaults()`) and `ShippedDefaultsService` in `packages/ui/src/main/composition-root.ts`.

**Checkpoint**: transactional write is green; the service and its DI wiring compile.

---

## Phase 3: User Story 1 — Authoritative record exists (Priority: P1)

**Goal**: a single, immutable, versioned record generated from the definitions.
**Independent test**: load the record; confirm it contains every built-in theme, full settings, full
key bindings, a version, and deep-equals the definitions.

- [x] T006 [P] [US1] Write the failing fidelity contract test in `packages/core/tests/contract/shipped-defaults-fidelity.contract.test.ts`: `buildShippedDefaults()` `.themes` deep-equals `{ ...ALL_DEFAULT_THEMES, throng: { ...THRONG_THEME, iconPack:'throng' } }`, `.settings` deep-equals `DEFAULT_APP_SETTINGS`, `.keybindings` deep-equals `DEFAULT_KEYBINDINGS`, `.version === SHIPPED_DEFAULTS_VERSION`; the returned object and nested maps are frozen; `serializeShippedDefaults()` round-trips (`JSON.parse` deep-equals the record).
- [x] T007 [US1] Implement `buildShippedDefaults` (deep-frozen), `reservedThemeNames`, `isReservedThemeName`, and `serializeShippedDefaults` in `packages/core/src/config/shipped-defaults.ts` to green T006. Assemble `throng` by wrapping `THRONG_THEME` with `iconPack:'throng'` (do NOT edit `theme.ts`).
- [x] T008 [P] [US1] Create `scripts/generate-shipped-defaults.mjs` (imports built `@throng/core`, writes `serializeShippedDefaults()` to `packages/ui/dist/main/shipped-defaults.json`) and add a `generate:defaults` npm script, chaining it into `build` in `package.json` (after `tsc -b`).

**Checkpoint**: record fidelity green; divergence from definitions fails the test (009's changes flow through).

---

## Phase 4: User Story 2 — Restore all built-in themes (Priority: P1)

**Goal**: reset edited built-ins, recreate deleted ones, leave custom themes untouched, atomically.
**Independent test**: mixed edited/deleted built-ins + custom themes → restore → all built-ins equal
shipped, customs byte-identical, none extra.

- [x] T009 [P] [US2] Write failing integration tests in `packages/ui/tests/integration/shipped-defaults-restore.test.ts` (real `FileConfigStore` over a temp `configRoot`): custom theme byte-identical after restore; a deleted built-in file is recreated; an edited built-in is reset to shipped values; whole-operation rollback when one built-in theme path is unwritable (pre-created as a directory) — every other theme file byte-identical, `failedPath` reported.
- [x] T010 [US2] Implement `ShippedDefaultsService.restoreAllThemes()` in `packages/ui/src/main/shipped-defaults-service.ts` (write every reserved theme via `writeFilesAtomic`; never enumerate/touch custom themes) to green T009.

**Checkpoint**: US2 green — the `014-theme-editor` control's backing API is complete.

---

## Phase 5: User Story 3 — Reset a single key binding (Priority: P2)

**Goal**: restore one action's shipped binding(s); others untouched; unknown action ⇒ no-default.
**Independent test**: change several bindings, reset one, assert only it changed.

- [x] T011 [P] [US3] Write failing unit tests for `resetBindingValue(current, action, d)` in `packages/core/tests/unit/shipped-defaults-reset.test.ts`: only the named action is restored; other actions untouched; `current` not mutated; unknown action ⇒ `null`.
- [x] T012 [US3] Implement `resetBindingValue` in `packages/core/src/config/shipped-defaults.ts`, then `ShippedDefaultsService.resetBinding(action)` (returns `{ok:false, reason:'no-default'}` on `null`; else one atomic keybindings write) with an integration case in `packages/ui/tests/integration/shipped-defaults-reset.test.ts`.

---

## Phase 6: User Story 4 — Reset a single setting (Priority: P2)

**Goal**: restore one setting leaf by dotted path; siblings untouched; unknown path ⇒ no-default.
**Independent test**: change several settings, reset one leaf by path, assert only it changed.

- [x] T013 [P] [US4] Write failing unit tests for `resetSettingValue(current, path, d)` in `packages/core/tests/unit/shipped-defaults-reset.test.ts`: a leaf (e.g. `editor.autoSave`, `confirmations.destroyTab`) is restored; siblings untouched; `current` not mutated; unknown path ⇒ `null`.
- [x] T014 [US4] Implement `resetSettingValue` in `packages/core/src/config/shipped-defaults.ts` (reuse `getAtPath`/`setAtPath` from `config/metadata.ts`; `null` when `getAtPath(shipped.settings, path)` is undefined), then `ShippedDefaultsService.resetSetting(path)` with an integration case in `packages/ui/tests/integration/shipped-defaults-reset.test.ts`.

---

## Phase 7: User Story 5 — Reset everything (Priority: P3)

**Goal**: settings + keybindings + all reserved themes restored from the same record, atomically.
**Independent test**: modify all three, reset-everything, assert all return to shipped values.

- [x] T015 [P] [US5] Write failing integration test in `packages/ui/tests/integration/shipped-defaults-reset.test.ts`: after `resetEverything()`, settings, keybindings, and every reserved theme equal the record; a custom theme remains present and byte-identical.
- [x] T016 [US5] Implement `ShippedDefaultsService.resetEverything()` (one `writeFilesAtomic` over settings + keybindings + all reserved themes) to green T015.

---

## Phase 8: User Story 6 — Seed on first run, grow additively on upgrade (Priority: P2)

**Goal**: first-run seed from the record; upgrade adds missing themes and materialises missing theme
properties without changing any existing value; version marker drives it; idempotent.
**Independent test**: seed a fresh root = shipped artifacts + marker; simulate an upgrade adding a theme
and a theme property; assert additive-only and idempotent.

- [x] T017 [P] [US6] Write failing unit tests in `packages/core/tests/unit/shipped-defaults-upgrade.test.ts`: `fillMissingThemeProps(user, source)` adds only absent keys (deep, across `colours`/`icons`/`typography`) and never overwrites a present key; `planThemeUpgrade` lists an absent reserved theme in `addThemes`, a present theme needing a fill in `fillThemes`, and yields empty lists on an already-complete config (idempotence).
- [x] T018 [US6] Implement `fillMissingThemeProps` and `planThemeUpgrade` in `packages/core/src/config/shipped-defaults.ts` to green T017.
- [x] T019 [P] [US6] Write failing integration tests in `packages/ui/tests/integration/shipped-defaults-seed-upgrade.test.ts`: first-run `seed()` writes settings + keybindings + all reserved themes byte-equal to the record and `defaults-state.json` = `{version:SHIPPED_DEFAULTS_VERSION}`; `upgrade()` adds a newly-shipped theme without touching existing values; `upgrade()` materialises a newly-added theme property into a pre-existing built-in (from its shipped value) AND a pre-existing custom theme (from the throng base) while leaving all other values byte-identical; a second `upgrade()` changes nothing; `readAppliedVersion()` reflects the marker.
- [x] T020 [US6] Implement `ShippedDefaultsService.seed()`, `upgrade()` (gated on the marker; uses `planThemeUpgrade`), `readAppliedVersion()`, and the `defaults-state.json` read/write (via `writeFilesAtomic`) to green T019.
- [x] T021 [US6] Wire startup in `packages/ui/src/main/main.ts`: replace the first-run `ensureDefaultConfig` + `if (firstRun) restoreDefaultThemes()` block so that firstRun ⇒ `service.seed()` and otherwise ⇒ `service.upgrade()` (gated on the marker), re-sourcing seeding from the record while preserving the `throng` `iconPack:'throng'` default. Run before the config watcher starts.

**Checkpoint**: US6 green — seeding and additive upgrade complete; upgrade never overwrites a user value.

---

## Phase 9: Polish & Cross-Cutting

- [x] T022 [P] Update `README.md` (config directory now includes `defaults-state.json`; note the shipped-defaults record and the restore/seed/upgrade behaviour) and `ROADMAP.md` (mark the shipped-defaults infrastructure delivered; note `014`/`015` will build the controls). Keep README a current-state snapshot (no feature-number narration).
- [x] T023 Run the full suite green with observed output — `npm run test:unit`, `npm run test:integration`, `npm run test:contract`, `npm run test:e2e` — and confirm: the editor-metadata completeness test still passes (no new configurable keys), and no UI/IPC/preferences surface was added (FR-019). Use verification-before-completion.

---

## Dependencies & Execution Order

- **Setup (T001)** → **Foundational (T002–T005)** → user stories.
- **US1 (T006–T008)** depends on T001; provides the record used by every later story and by T005.
- **US2 (T009–T010)**, **US5 (T015–T016)**, **US6 (T019–T021)** depend on Foundational (T003 writer, T004/T005 service+DI) and US1 (record).
- **US3 (T011–T012)**, **US4 (T013–T014)** depend on US1 (record) and the service skeleton (T004); their core functions are independent and parallelizable with each other.
- **US6 core (T017–T018)** is independent of the service; **US6 service (T019–T021)** depends on T018 + Foundational.
- **Polish (T022–T023)** last.

## Parallel Opportunities

- T006, T011, T013, T017 (test authorship in different files) can be drafted in parallel.
- Core pure functions for US3/US4/US6 (`resetBindingValue`, `resetSettingValue`, `fillMissingThemeProps`/`planThemeUpgrade`) are independent and may be implemented in parallel once US1 lands.
- T008 (generator script) is parallel to the US2+ service work.

## Implementation Strategy

- **MVP** = US1 + US2 (P1): the authoritative record plus restore-all-themes — the headline recover/
  reset capability and the `014` backing API. Ship-testable on its own.
- Then US3/US4 (P2, sibling-`015` API), US6 (P2, seeding/upgrade safety), US5 (P3, consistency).
- Every code-modifying task follows Red → Green → Refactor via the bridge; the locked-file rollback and
  the upgrade-idempotence tests are the highest-risk gates.
