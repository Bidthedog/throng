# Phase 0 Research: Shipped Defaults

All Technical Context unknowns are resolved below. No `NEEDS CLARIFICATION` remains.

## D1 — Where is the record materialised, and what is authoritative at runtime?

**Decision**: The authoritative record is an in-process, deep-frozen structure `buildShippedDefaults()`
in `@throng/core`, assembled from the existing definitions (`ALL_DEFAULT_THEMES`,
`DEFAULT_APP_SETTINGS`, `DEFAULT_KEYBINDINGS`) plus a `SHIPPED_DEFAULTS_VERSION` constant. It is
additionally materialised as a JSON artifact at build time by `scripts/generate-shipped-defaults.mjs`
for distribution and human inspection. **Runtime restore/seed/upgrade logic consumes the in-process
record**, not the JSON file.

**Rationale**:
- The spec fixes only that the record be immutable, versioned, distributed with the build, and held
  apart from user config. The in-process record satisfies all four: it is `Object.freeze`-frozen
  (immutable), carries a version constant (versioned), is bundled into the app (distributed with the
  build), and is code — never written under `configRoot` (separate from user config).
- Consuming the in-process record keeps the whole feature unit/integration-testable **without a build
  step**, and makes `009-theme-content`'s palette/token changes flow through automatically: the record
  is composed from the live definitions, so nothing is hand-copied and nothing goes stale.
- A committed JSON *snapshot* of values was rejected: it would go stale the moment 009 edits a palette
  and would create a cross-branch merge/regeneration burden — the opposite of "changes flow through
  without you having to edit them".

**Alternatives considered**:
- *Load a packaged JSON at runtime and fall back to `buildShippedDefaults()` on corruption*: rejected —
  the fallback makes the "corrupt record" failure mode unreachable and adds a fragile file dependency
  for data that is already reliably in-process.
- *Store the record only as committed JSON, no generator function*: rejected — violates
  generated-not-hand-copied and the divergence check.

**Consequence for the spec's "corrupt shipped record" edge case**: because the record is in-process
code, it cannot be missing or corrupt at runtime; this failure mode is therefore unreachable — a
strengthening, not a weakening. Reported to the coordinator.

## D2 — How is generated-not-hand-copied enforced (FR-004 / SC-007)?

**Decision**: A fidelity test asserts the record's contents deep-equal the live definitions —
`buildShippedDefaults().themes` equals `{ ...ALL_DEFAULT_THEMES, throng: { ...THRONG_THEME, iconPack:
'throng' } }`, `.settings` equals `DEFAULT_APP_SETTINGS`, `.keybindings` equals `DEFAULT_KEYBINDINGS`.
A second assertion checks the build generator's JSON output deep-equals `buildShippedDefaults()`.

**Rationale**: any hand-edit of the record that diverges from the definitions fails the test; 009's
changes to `default-themes/index.ts` flow into `ALL_DEFAULT_THEMES` and therefore into the record with
no edit here. The `throng` theme carries `iconPack: 'throng'` in the record (matching what startup
seeds today via `main.ts`), assembled by wrapping `THRONG_THEME` **without editing `theme.ts`**.

## D3 — Built-in vs custom identity and name reservation (FR-006/007/007a)

**Decision**: identity is purely name-based — a theme is built-in iff its name is a key of the record's
`themes`. The reserved-name set is `Object.keys(record.themes)`, derived from the record (independent of
what is currently present under `configRoot`), so a deleted built-in's name stays reserved. This feature
**exposes** `reservedThemeNames()` / `isReservedThemeName(name)`; it does **not** police theme creation
— `014-theme-editor` enforces the reservation at "Save As". There is no in-place rename (rename is
clone-via-Save-As), so a built-in name is never orphaned. The overwrite hazard is therefore unreachable.

**Rationale**: matches the human's authoritative answer (no origin flag). `core` already exposes
`isBuiltInTheme(name, ALL_DEFAULT_THEMES)`; the new helpers key off the record for a single source and
are asserted consistent with it by test.

## D4 — Atomic multi-file restore with rollback (FR-012/012a)

**Decision**: add a transactional `writeFilesAtomic(files: {path, content}[])` to `FileConfigStore`.
Algorithm (Windows-safe, snapshot + two-phase):
1. **Snapshot** each target's current bytes (or mark absent).
2. **Stage**: write each new `content` to a unique temp file. If any temp write throws → delete all
   temps and return `{ok:false, failedPath}` (nothing on disk touched).
3. **Commit**: `rename(temp → target)` for each target in turn. If a rename throws at target *k* →
   **rollback**: restore targets `0..k-1` from the snapshot (rewrite present-originals; delete those
   that were absent before), delete the remaining temps, and return `{ok:false, failedPath:k, error}`.
4. On full success return `{ok:true}`.

**Rationale**: `FileConfigStore.write` is best-effort and swallows errors, so it cannot drive a
rollback; the transactional method surfaces the first failure and reverses committed writes. Under the
realistic single-locked-file assumption, the failing file *k* was never committed, so rolling back the
other (unlocked) files succeeds and the prior configuration is left byte-for-byte intact.

**Test approach for a "locked/unwritable file"**: create the target theme path as a **directory**
(e.g. `themes/Matrix.json/`) so `rename(temp → target)` deterministically fails on Windows and Linux
alike, or hold an exclusive OS handle. Assert every other theme file is byte-identical to before and
the offending path is reported.

## D5 — Applied-defaults version marker: location and format (FR-013/014)

**Decision**: a dedicated file `<configRoot>/defaults-state.json` = `{ "version": <number> }`, managed
by `ShippedDefaultsService` via `writeFilesAtomic`. **Not** stored inside `settings.json`.

**Rationale**: keeps the marker out of the user-editable settings schema (so the editor-metadata
completeness test is unaffected and 015 need not surface it) and off the core `ConfigDocId` union
(`writeFilesAtomic` takes absolute paths, so no core abstraction change is required). It lives under
`configRoot`, satisfying "recorded in the user's configuration". The config watcher watches specific
documents (settings/keybindings/themes), so the extra file causes no rebroadcast noise (verified in D7).

## D6 — First-run seeding vs additive upgrade (FR-015/015a)

**Decision**:
- **First run** (`settings.json` absent, as detected today in `main.ts`): `service.seed()` writes
  settings + keybindings + every shipped theme + the version marker, all from the record, in one
  transaction.
- **Otherwise**, if the marker is absent or `!== SHIPPED_DEFAULTS_VERSION`: `service.upgrade()` runs
  two purely-additive operations and rewrites the marker:
  1. **add missing themes** — for each reserved name with no theme file, write the shipped theme;
  2. **materialise missing properties** — for each theme file present (built-in *and* custom), deep
     **fill only absent** keys (colours, icons, fonts, typography, ...) from its source; source is the
     shipped theme for a built-in, or the base `throng` default for a custom theme. A present key is
     never overwritten.
  Only themes whose filled form differs from their current form are rewritten (idempotence). Settings
  and key bindings are **not** rewritten on upgrade — new fields there are already merged in at read
  time by `parseAppSettings`/`parseKeybindings`, and rewriting could look like an overwrite; keeping
  upgrade theme-scoped matches FR-015a exactly and YAGNI.

**Rationale**: honours "an upgrade NEVER overwrites a value the user already has". Deep-fill-absent is
exactly "materialise newly-added properties without changing existing values". Idempotent because a
second run finds no absent keys and no missing themes.

## D7 — Interaction with the config watcher and existing 007 paths

**Findings**:
- `startConfigWatcher` (main.ts) watches the settings/keybindings/theme documents; a new
  `defaults-state.json` in the root is not among them, so writing the marker triggers no rebroadcast.
  Seeding/upgrade run **before** the watcher starts on the startup path, so no spurious mid-startup
  broadcast occurs.
- The existing `FileConfigStore.restoreDefaultThemes()` (007) and its `throng:config:restoreDefaultThemes`
  IPC remain **untouched** to avoid changing the current Themes-tab behaviour. The new API is additive;
  `014-theme-editor` will migrate that control to `ShippedDefaultsService.restoreAllThemes()` (which
  additionally resets *edited* built-ins). Recorded as a tracked follow-up, not done here (FR-019: no UI
  change in this feature).
- Startup seeding is re-sourced from the record; the pre-existing `ensureDefaultConfig` +
  `if (firstRun) restoreDefaultThemes()` block is replaced by `service.seed()` / `service.upgrade()`.

## D8 — Test layering

**Decision**: unit tests (core, pure) cover record fidelity, reserved names, reset-binding/setting
plans, deep-fill-absent, seed/upgrade/restore plan builders. Integration tests (UI main) drive
`ShippedDefaultsService` against a real `FileConfigStore` over a temp `configRoot` for: custom-theme
byte-identity, deleted-built-in recreation, edited-built-in reset, whole-operation rollback with a
locked/unwritable file, first-run seeding equality, upgrade-adds-theme, upgrade-materialises-property
(built-in + custom), upgrade idempotence, and version-marker read/write. A contract test asserts the
generated JSON equals the in-process record (fidelity). No E2E (no UI).
