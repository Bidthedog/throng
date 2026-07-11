# Feature Specification: Shipped Defaults

**Feature Branch**: `010-shipped-defaults`

**Created**: 2026-07-10

**Status**: Draft

**Input**: User description: "Provide the authoritative, immutable, versioned source of the application's defaults — themes, application settings, and key bindings — distributed with the build and held separately from the user's writable configuration, plus the API that every restore-to-default operation reads from: restore all built-in themes (resetting edited built-ins and recreating deleted ones while leaving custom themes untouched), reset a single key binding, reset a single setting, and reset everything. Infrastructure only — no user interface; later features build the buttons."

## Overview

This feature is **infrastructure**. It ships **no user interface** and changes no existing
button, dialog, or preference control. It establishes the single authoritative record of what the
application's defaults *are*, distributed with the build and held apart from the user's writable
configuration, and it exposes the operations that every "restore to default" action reads from.

Today the application has no such record. Defaults exist only as literal values embedded in the
program, and the restore paths that consume them are incomplete. As a result:

- The theme editor's "restore defaults" control does not fully work.
- A built-in theme the user deletes is gone for good.
- There is no way to reset a single key binding to its shipped value.
- A user who edits a built-in theme can never get the original back.

This feature closes those gaps at the foundation. Two sibling features consume the API it defines
but are **out of scope here**: `014-theme-editor` builds the "Restore All Themes to Default" control
on top of the restore-all-themes operation, and `015-preferences-and-settings` builds the per-binding
and per-setting reset controls on top of the single-item reset operations. This specification designs
the API for those two consumers but does not build their controls.

## Clarifications

### Session 2026-07-10

The five open decisions were resolved authoritatively by the human. They are encoded below and every
contradicting assumption in the original draft has been corrected in place (not layered over).

- Q: What is the unit of a single-setting reset? → A: **A leaf value addressed by its full dotted
  path** (e.g. `editor.autoSave`, `confirmations.destroyTab`), matching the existing one-descriptor-
  per-configurable-key model. Resetting one leaf restores only that leaf and leaves every sibling
  untouched. This is the shape `015-preferences-and-settings` will call. (FR-011.)
- Q: How is a built-in theme distinguished from a custom one — by an origin flag or by name? → A:
  **Purely by name. Do NOT add an origin flag.** A theme is built-in **if and only if its name appears
  in the shipped-defaults record**; any theme whose name is not in that record is custom. The
  overwrite/rename hazards this raised are eliminated by a **name-reservation constraint**, not by a
  tag: **built-in theme names are reserved** — the theme editor's "Save As" refuses any name held by a
  built-in theme, so a custom theme named `Dracula` cannot exist. Names are reserved from the **shipped
  record**, not from the themes currently present in user config, so a built-in name stays reserved
  even after the user deletes that built-in (otherwise: delete `Dracula`, Save-As a custom `Dracula`,
  Restore-All destroys it). There is **no in-place rename** — "Save As" clones to a new name and leaves
  the original intact — so the rename hazard is also unreachable. The reservation is enforced at the
  point of creation by `014-theme-editor`; **this feature's loader/restore API MUST NOT assume it
  silently** — it states the dependency and relies on it. (FR-006/007/007a.)
- Q: Is restore-all-themes atomic per-theme or across the whole set? → A: **Whole-operation,
  all-or-nothing.** It is a single reset of every shipped theme to its shipped values; it either fully
  succeeds or leaves configuration exactly as it was. Partial failure must be impossible in normal
  operation; the realistic cause of failure is a **locked file** (this is Windows). Implementation:
  **stage all writes, and on any failure discard the staging and leave the previous configuration
  untouched, reporting which file could not be written and why.** The rollback path — including a
  locked-file case — MUST be tested. (FR-012/012a.)
- Q: How do first-run seeding, application upgrade, and versioning interact? → A: **An application
  upgrade NEVER overwrites a value already in the user's configuration** — not for custom themes and
  not for built-in themes. (1) **First run**: seed themes, settings and key bindings from the shipped
  artifacts (the one authoritative source; the source literals must not be a second one). (2)
  **Upgrade**: two purely-additive operations only — (i) **add newly-shipped themes** absent from user
  config, and (ii) **materialise newly-added properties**: for every theme already in user config that
  lacks a property newly added to the theme shape, **write the shipped default into the user's file**
  (rather than relying on a load-time fallback). For a **built-in** theme that value is its own shipped
  value; for a **custom** theme, which has no shipped counterpart, the value is taken from the base
  `throng` default theme. **Nothing else changes** — an upgrade never alters a value the user already
  has, even on an unmodified built-in theme. Adopting new shipped *values* is the user's deliberate
  choice, made via "Restore All Themes to Default". (3) **Version marker**: record the defaults version
  in user config; its purpose is to drive step (2) — deciding which additive migrations to run. On
  mismatch, **no transformation of existing user values is attempted, ever**: detect, migrate
  additively, record the new version. No speculative transformation machinery. (FR-013/014/015/015a.)
- Q: Coordination with `009-theme-content`, which adds two editor-gutter colour tokens? → A:
  **Complementary, not conflicting.** At *load* time a theme missing the new tokens falls back to
  defaults (009 handles that). This feature's *upgrade* step is what **writes** the new tokens into the
  user's theme files (the additive property-materialisation above). Because the artifacts are
  **generated from the theme definitions** (FR-004), 009's recoloured Bash/SUBNET/Cyberpunk palettes
  and its new tokens flow through **without this feature editing anything**. (FR-004/015a.)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An authoritative, immutable record of defaults exists (Priority: P1)

The application carries a single, authoritative, read-only record of every default it ships with —
every built-in theme, every application setting, and every key binding — as artifacts distributed
with the build and held separately from the user's writable configuration. Every restore operation in
this feature reads from this one record; no restore reads defaults from anywhere else. The record is
generated from the application's own theme, settings, and key-binding definitions, so when a
definition changes the record changes with it, without anyone hand-copying values.

**Why this priority**: This record is the foundation the entire feature stands on. None of the
restore operations can be correct or trustworthy unless there is exactly one authoritative,
build-distributed source for what the defaults are. It is independently valuable and testable even
before any restore operation is wired up.

**Independent Test**: Load the shipped-defaults record and confirm it contains every built-in theme,
the complete set of application settings, and the complete set of key bindings; confirm it is held
separately from the user's writable configuration and is not mutated by ordinary use; and confirm that
changing a theme/setting/binding definition is reflected in the record with no separate manual edit.

**Acceptance Scenarios**:

1. **Given** a fresh application build, **When** the shipped-defaults record is loaded, **Then** it
   contains every built-in theme (including `throng`), the full application-settings defaults, and the
   full key-binding defaults.
2. **Given** the shipped-defaults record, **When** any restore operation runs, **Then** the values it
   restores come from this record and from no other source.
3. **Given** a change to a built-in theme's definition (for example a palette rewrite or an added
   colour token), **When** the build is produced, **Then** the shipped-defaults record reflects that
   change automatically, with no hand-copied duplicate to maintain.
4. **Given** the user edits their writable configuration, **When** that configuration is changed,
   **Then** the shipped-defaults record is unaffected (it is immutable and held separately).
5. **Given** the shipped-defaults record, **When** it is inspected, **Then** it carries a version
   stamp identifying the defaults it represents.

---

### User Story 2 - Restore all built-in themes (Priority: P1)

Acting on the user's behalf, the application can restore every built-in theme in one operation: any
built-in theme the user has edited is returned to its shipped values, and any built-in theme the user
has deleted is recreated from the shipped record. Themes the user created themselves are left exactly
as they are — never modified, never removed. This is the operation the `014-theme-editor` "Restore All
Themes to Default" control will call.

**Why this priority**: This is the headline capability. It is what makes a deleted built-in
recoverable and an edited built-in restorable — the two most visible gaps today — and it is a direct
dependency of a scheduled sibling feature.

**Independent Test**: With a mix of edited built-in themes, deleted built-in themes, and user-created
themes on disk, run restore-all-themes and confirm every built-in is present and byte-for-byte equal
to its shipped values, every user-created theme is untouched, and no extra themes were introduced.

**Acceptance Scenarios**:

1. **Given** a built-in theme the user has edited, **When** restore-all-themes runs, **Then** that
   theme is returned exactly to its shipped values.
2. **Given** a built-in theme the user has deleted, **When** restore-all-themes runs, **Then** that
   theme is recreated from the shipped record and is present again.
3. **Given** one or more user-created (custom) themes, **When** restore-all-themes runs, **Then** every
   custom theme is left exactly as it was — neither modified nor removed.
4. **Given** all built-in themes are already present and unmodified, **When** restore-all-themes runs,
   **Then** the result is the same as before (the operation is safe to repeat and converges).
5. **Given** a built-in theme file that is currently corrupt or unreadable on disk, **When**
   restore-all-themes runs, **Then** that theme is restored to its shipped values.

---

### User Story 3 - Reset a single key binding (Priority: P2)

Acting on the user's behalf, the application can reset one action's key binding back to the binding(s)
it ships with, leaving every other action's bindings untouched. This is the operation the
`015-preferences-and-settings` per-binding reset control will call.

**Why this priority**: It removes a concrete gap (there is no way to reset one binding today) and
unblocks a sibling feature, but it affects a narrower surface than the theme restore, so it ranks
below the P1 stories.

**Independent Test**: Change several actions' bindings, reset exactly one of them, and confirm that
action's bindings equal the shipped defaults while every other action's bindings are unchanged.

**Acceptance Scenarios**:

1. **Given** an action whose binding the user has changed, **When** that single action is reset,
   **Then** its binding tokens equal the shipped defaults for that action.
2. **Given** several actions with changed bindings, **When** exactly one action is reset, **Then**
   only that action changes and all other actions keep their current bindings.
3. **Given** a request to reset a binding for an action with no shipped default, **When** the reset is
   attempted, **Then** the operation reports that there is no shipped default and changes nothing.

---

### User Story 4 - Reset a single setting (Priority: P2)

Acting on the user's behalf, the application can reset one application setting back to its shipped
value, leaving every other setting untouched.

**Why this priority**: Same rationale as User Story 3 — it closes a real gap and supports the settings
consumer, at a narrower surface than the P1 theme work.

**Independent Test**: Change several settings, reset exactly one of them by its path, and confirm that
setting equals its shipped value while every other setting is unchanged.

**Acceptance Scenarios**:

1. **Given** a setting the user has changed, **When** that single setting is reset, **Then** its value
   equals the shipped default for that setting.
2. **Given** several changed settings, **When** exactly one is reset, **Then** only that setting
   changes and all others keep their current values.
3. **Given** a request to reset a setting path that has no shipped default, **When** the reset is
   attempted, **Then** the operation reports that there is no shipped default and changes nothing.

---

### User Story 5 - Reset everything (Priority: P3)

The existing preferences-level "reset everything" path is re-sourced from the shipped-defaults record,
so that a full reset of themes, settings, and key bindings draws from the same authoritative artifacts
as the targeted restores.

**Why this priority**: A reset-everything path already exists; this story makes it consistent with the
new authoritative source rather than adding a new capability, so it is the lowest priority.

**Independent Test**: With themes, settings, and bindings all modified, run reset-everything and
confirm all three return to the shipped defaults, and confirm the values applied are the same ones the
targeted restores would apply.

**Acceptance Scenarios**:

1. **Given** modified settings, key bindings, and built-in themes, **When** reset-everything runs,
   **Then** settings, key bindings, and built-in themes all return to their shipped values.
2. **Given** reset-everything and the targeted restores, **When** both are compared, **Then** they
   draw the same default values from the same shipped-defaults record.

---

### User Story 6 - Seed on first run, grow additively on upgrade (Priority: P2)

On first run the application seeds the user's configuration — themes, settings and key bindings —
from the shipped-defaults record. On a later application upgrade the configuration grows **additively
only**: newly-shipped themes are added, and properties newly added to the theme shape are written into
existing theme files that lack them, but **no value the user already has is ever changed**. A version
marker in the user's configuration records which defaults have been applied and drives which additive
migrations run.

**Why this priority**: This makes the shipped-defaults record the single source for seeding (removing
the second source that embedded literals represent today) and guarantees the upgrade-never-overwrites
promise the user relies on. It is foundational to trusting the record, ranking with the other P2 work.

**Independent Test**: Seed a fresh configuration and confirm it equals the shipped artifacts exactly.
Then simulate an upgrade whose record adds a theme and a new theme property; confirm the new theme
appears, the new property is written into both a pre-existing built-in and a pre-existing custom theme,
and every value the user already had is byte-for-byte unchanged. Run the upgrade twice and confirm the
second run changes nothing.

**Acceptance Scenarios**:

1. **Given** an empty (first-run) configuration, **When** the application seeds it, **Then** the
   themes, settings and key bindings on disk equal the shipped-defaults record exactly.
2. **Given** an existing configuration and an upgrade whose record adds a new theme, **When** the
   upgrade runs, **Then** the new theme is added and every existing theme, setting and binding is
   unchanged.
3. **Given** an existing built-in theme and an existing custom theme, both missing a property newly
   added to the theme shape, **When** the upgrade runs, **Then** the property is written into both —
   the built-in from its own shipped value, the custom from the base `throng` default — and no other
   value in either theme changes.
4. **Given** an unmodified built-in theme whose shipped *values* changed in the upgrade, **When** the
   upgrade runs, **Then** the user's copy is **not** updated to the new values (that is reserved to
   "Restore All Themes to Default").
5. **Given** an upgrade has run, **When** it runs a second time, **Then** nothing changes (idempotent),
   and the recorded defaults version matches the current build.

---

### Edge Cases

- **Interrupted restore**: if applying a restore fails partway (for example a write error on one of
  several theme files), the operation leaves the prior configuration intact rather than a half-applied
  mixture (FR-012).
- **Corrupt shipped record**: the shipped-defaults record is an immutable build artifact; if it cannot
  be loaded the restore operations report failure and make no changes rather than fabricating values.
- **Locked theme file during restore-all**: if any target theme file cannot be written (on Windows a
  file lock is the realistic cause), the whole operation is discarded and the previous configuration is
  left untouched, and the operation reports which file could not be written and why (FR-012/012a).
- **Custom theme named like a built-in — cannot occur**: built-in theme names are reserved (from the
  shipped record, not from what is currently present in user config), so a custom theme can never hold
  a built-in's name; restore-all therefore never touches a custom theme (FR-007a). The loader/restore
  API states this dependency rather than assuming it silently.
- **Renamed built-in — cannot occur**: there is no in-place rename; "Save As" clones to a new name and
  leaves the original intact (FR-007a), so a built-in's name is never orphaned by a rename.
- **Application upgrade**: an upgrade only (a) adds newly-shipped themes absent from user config and
  (b) writes a newly-added property's shipped default into an existing theme file that lacks it; it
  **never** changes a value the user already has, on any theme (FR-015a).
- **Version mismatch**: when the recorded applied-defaults version differs from the current build's
  shipped-defaults version, the additive upgrade migrations are run and the new version is recorded; no
  existing user value is transformed by this detection (FR-013/014/015a).
- **Repeat restore / repeat upgrade (idempotence)**: running any restore, or the upgrade step, twice
  converges on the same result as running it once.
- **Reset of an unknown key/action**: resetting a setting path or action with no shipped default is a
  no-op that reports "no shipped default" rather than inventing or deleting a value (FR-016).

## Requirements *(mandatory)*

### Functional Requirements

**Authoritative shipped-defaults record**

- **FR-001**: The application MUST carry an authoritative record of its shipped defaults covering
  **built-in themes, application settings, and key bindings**, distributed with the application build.
- **FR-002**: The shipped-defaults record MUST be **immutable** — not modifiable through ordinary use
  of the application — and MUST be held **separately from the user's writable configuration**, so that
  editing the user's configuration never alters the record and vice versa.
- **FR-003**: The shipped-defaults record MUST be the **single authoritative source** for every
  restore-to-default operation in this feature; no restore operation MAY source default values from
  anywhere else.
- **FR-004**: The shipped-defaults record MUST be **generated from the application's own theme,
  settings, and key-binding definitions** rather than hand-copied, so that a change to a definition
  (including a concurrent rewrite of theme palettes and the addition of theme colour tokens) flows
  through to the record automatically without a separate manual edit. A verification MUST detect
  divergence between the definitions and the record.
- **FR-005**: The shipped-defaults record MUST carry a **version stamp** identifying the set of
  defaults it represents.

**Identity of built-in vs custom themes**

- **FR-006**: The system MUST be able to **distinguish a built-in theme from a user-created (custom)
  theme**, and MUST retain the knowledge of which built-in themes exist even when the user's
  configuration no longer contains them (for example because the user deleted one).
- **FR-007**: A theme MUST be considered **built-in if and only if its name appears in the shipped-
  defaults theme record**; any theme whose name is not in that record MUST be considered custom. (This
  makes the shipped record the durable memory of which built-ins exist.) The system MUST NOT add an
  origin flag to themes; identity is name-based.
- **FR-007a**: The name-based identity of FR-007 is only safe while **built-in theme names are
  reserved**. This feature MUST expose the set of reserved (built-in) names — derived from the shipped
  record, independent of which themes are currently present in the user's configuration — so that theme
  creation ("Save As" in `014-theme-editor`) can refuse a name held by any built-in, **even a built-in
  the user has deleted**. This feature's loader and restore API MUST rely on the reservation being
  enforced (it is enforced at creation time by `014-theme-editor`) and MUST NOT assume it silently;
  the dependency is stated. There is no in-place theme rename in the product (rename is clone-via-Save-
  As), so a built-in name is never orphaned.

**Restore operations (the API)**

- **FR-008**: The system MUST provide a **restore-all-built-in-themes** operation that, in one action:
  (a) resets every built-in theme to its shipped values, including built-in themes the user has
  edited; and (b) recreates any built-in theme the user has deleted. It MUST leave every custom theme
  untouched — neither modified nor removed — and MUST NOT introduce any theme not in the shipped
  record.
- **FR-009**: The system MUST provide a **reset-single-key-binding** operation that restores one
  action's shipped binding token(s), leaving every other action's bindings unchanged.
- **FR-010**: The system MUST provide a **reset-single-setting** operation that restores one
  application setting to its shipped value, leaving every other setting unchanged.
- **FR-011**: A single application setting for the purpose of FR-010 MUST be a **leaf value addressed
  by its full path** within the settings document; resetting one leaf MUST NOT affect any sibling
  leaf.
- **FR-012**: Every restore operation MUST be **atomic as a whole**: it MUST either fully succeed or
  leave the previous configuration intact, never a partially-applied mixture — including the multi-
  file restore-all-themes operation.
- **FR-012a**: The restore-all-themes operation MUST achieve FR-012 by **staging all writes and, on any
  failure, discarding the staging and leaving the previous configuration untouched**, then reporting
  **which** file could not be written and **why**. The realistic failure is a locked file on Windows;
  the rollback path (including a locked-file case) MUST be covered by tests.
- **FR-013**: When the version stamp of the current build's shipped-defaults record differs from the
  version last applied to the user's configuration, the additive upgrade migrations (FR-015a) MUST be
  run and the new version recorded. No existing user value MUST be transformed by this detection.
- **FR-014**: The version last applied to the user's configuration MUST be **recorded in the user's
  configuration** so a later application version can detect defaults applied by an earlier one. Its
  purpose is to decide which additive upgrade migrations (FR-015a) to run. This feature MUST record and
  expose that version; it MUST NOT build speculative machinery to transform existing user values.
- **FR-015**: On **first run**, the user's configuration MUST be seeded — themes, settings and key
  bindings — from the shipped-defaults record, which MUST be the **single** authoritative source (the
  source literals MUST NOT be a second source). The **reset-everything** path MUST likewise be sourced
  from the same record.
- **FR-015a**: On **application upgrade**, the system MUST perform **only two purely-additive**
  operations and MUST NOT change any value already present in the user's configuration (custom or
  built-in): (a) **add newly-shipped themes** that are absent from the user's configuration; and (b)
  **materialise newly-added properties** — for every theme already present that lacks a property newly
  added to the theme shape, write the shipped default for that property **into the user's file**
  (rather than leaving it to a load-time fallback). For a **built-in** theme the written value is its
  own shipped value; for a **custom** theme (which has no shipped counterpart) the value is taken from
  the base `throng` default theme. Adopting new shipped *values* on an existing theme is reserved to
  the user's explicit "Restore All Themes to Default"; an upgrade MUST NOT do it. Both operations MUST
  be idempotent.
- **FR-016**: A reset request naming a setting path or action **with no shipped default** MUST make no
  change and MUST report that no shipped default exists, rather than inventing or deleting a value.

**API design for downstream consumers**

- **FR-017**: The restore operations MUST be designed as a **reusable, non-UI API** consumable by the
  application's main process on the user's behalf, suitable for the `014-theme-editor` "Restore All
  Themes to Default" control (via FR-008) and the `015-preferences-and-settings` per-binding and per-
  setting reset controls (via FR-009/FR-010), without either consumer needing its own copy of the
  defaults.

**Test coverage & boundary**

- **FR-018**: This feature MUST ship with **contract and integration tests** for the shipped-defaults
  record and every restore operation (restore-all-themes, reset-single-binding, reset-single-setting,
  reset-everything), including the atomicity, idempotence, custom-theme-preservation, deleted-built-in-
  recovery, and definition-to-record-fidelity behaviours above. It MUST add **no user interface** and
  therefore requires no end-to-end UI coverage of its own.
- **FR-019**: This feature MUST NOT add or change any button, dialog, or preferences control; MUST NOT
  change the theme editor; and MUST NOT change the key-bindings editor. Those surfaces belong to the
  sibling features that consume this API.

## Key Entities *(include if feature involves data)*

- **Shipped-defaults record**: the authoritative, immutable, versioned set of default artifacts
  distributed with the build. Comprises the default built-in themes (keyed by name, including
  `throng`), the default application settings, and the default key bindings. Generated from the
  application's definitions; held separately from the user's writable configuration; carries a version
  stamp.
- **Built-in theme**: a theme whose name appears in the shipped-defaults theme record. Recoverable and
  resettable via restore-all-themes even after the user has edited or deleted it.
- **Custom (user-created) theme**: a theme whose name does not appear in the shipped-defaults theme
  record. Never modified or removed by any restore operation.
- **Applied-defaults version marker**: a record, stored in the user's configuration, of the shipped-
  defaults version last applied. Enables a later application version to detect defaults applied by an
  earlier one.
- **Restore operation**: an atomic action that rewrites part of the user's configuration to shipped
  values sourced from the record — one of restore-all-themes, reset-single-binding, reset-single-
  setting, or reset-everything.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After restore-all-themes, **100% of built-in themes** are present and equal to their
  shipped values, whether they were previously edited, deleted, or corrupt on disk.
- **SC-002**: After restore-all-themes, **0 custom themes** are modified or removed, and **0** themes
  outside the shipped record are introduced.
- **SC-003**: A built-in theme the user deleted is **recoverable in a single restore operation** (no
  reinstall or manual file recreation required).
- **SC-004**: Resetting a single key binding changes **exactly one** action's bindings and **zero**
  other actions; resetting a single setting changes **exactly one** leaf and **zero** siblings.
- **SC-005**: An interrupted or failed restore leaves the prior configuration **byte-for-byte intact**
  (no partial application observable).
- **SC-006**: Running any restore operation a second time produces the **same result** as the first
  (idempotent convergence).
- **SC-007**: A change to a theme/setting/binding **definition** appears in the shipped-defaults record
  with **no separate manual edit**, and a verification fails if the record and the definitions diverge.
- **SC-008**: Reset-everything and the targeted restores draw **identical default values** from the
  shipped-defaults record for the same keys.
- **SC-009**: The feature adds **zero** new user-interface controls (verifiable by inspection: no new
  button, dialog, or preference control, and no change to the theme or key-bindings editors).
- **SC-010**: Every restore operation and the shipped-defaults record are covered by **passing contract
  and integration tests**.
- **SC-011**: First-run seeding produces a configuration **exactly equal** to the shipped artifacts,
  and a version marker recording the current defaults version is present.
- **SC-012**: An upgrade adds every newly-shipped theme and writes every newly-added property into
  existing themes while leaving **100% of pre-existing user values byte-for-byte unchanged**; running
  the upgrade twice changes nothing on the second run.
- **SC-013**: A restore-all-themes blocked by a locked file leaves **every** theme file byte-for-byte
  intact and reports the offending file.

## Assumptions

- The user's writable configuration continues to live in the per-user throng configuration directory
  (settings, key bindings, and one file per theme), and the shipped-defaults record is held apart from
  it. The exact on-disk location and format in which the record is materialised is a **planning
  decision**; this specification fixes only that it is immutable, versioned, distributed with the
  build, and held separately from the user's configuration.
- "Generated from the definitions" means the record derives from the same theme, settings, and key-
  binding definitions the application already uses, so a concurrent rewrite of theme palettes and
  addition of colour tokens (feature `009-theme-content`) flows through to the record without this
  feature hand-editing those palettes.
- A single application setting is a leaf value addressed by its full path, consistent with the
  existing one-descriptor-per-configurable-key configuration model.
- The `throng` theme's default association with its bundled glyph icon set is preserved when the
  `throng` theme is seeded or restored from the record (so a restored `throng` looks as it does out of
  the box).
- **Custom-theme property materialisation on upgrade** (FR-015a): a custom theme has no shipped
  counterpart, so when a newly-added theme property must be materialised into it, the value is taken
  from the base `throng` default theme. **Flagged**: this is the only case where a custom theme file is
  written by this feature, and only to *add* an absent property — never to change an existing value.
- **Name-reservation dependency** (FR-007a): name-based built-in/custom identity is safe only because
  built-in theme names are reserved at creation time by `014-theme-editor`. This feature relies on that
  reservation and exposes the reserved-name set (from the shipped record) but does not itself police
  theme creation.
- The version marker's sole purpose is to drive the additive upgrade migrations (FR-015a); no logic
  that transforms an existing user value across versions is built (it is out of scope).

## Dependencies

- **Feature 009 (theme-content)** concurrently rewrites several built-in theme palettes and adds theme
  colour tokens. Because the shipped-defaults record is generated from the theme definitions
  (FR-004), those changes flow through without this feature editing the palettes; this feature reads
  the theme definitions, it does not rewrite them.
- **Feature 014 (theme-editor)** consumes the restore-all-themes operation (FR-008) for its "Restore
  All Themes to Default" control. That control is out of scope here.
- **Feature 015 (preferences-and-settings)** consumes the reset-single-binding and reset-single-setting
  operations (FR-009/FR-010) for its per-binding and per-setting reset controls. Those controls are
  out of scope here.

## Out of Scope

- Any user interface: buttons, dialogs, preference controls, and changes to the theme editor or key-
  bindings editor. Sibling features build those on top of this API.
- Migration logic that **transforms** a user's existing values from one defaults version to another.
  Only **additive** upgrade migration (add missing themes / materialise missing properties) plus
  version recording/detection is in scope; changing an existing user value is never done by an upgrade.
- Backup / export / import of user configuration.
