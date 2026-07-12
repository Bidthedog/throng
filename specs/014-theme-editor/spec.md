# Feature Specification: Theme Editor — Restore & Create Controls

**Feature Branch**: `014-theme-editor`

**Created**: 2026-07-11

**Status**: Clarified — all open clarifications resolved (see Clarifications → Session 2026-07-11); ready for `/speckit-plan`

**Depends on**: feature 010 (shipped-defaults), whose non-UI restore API this feature builds controls on top of — specifically its **restore-all-built-in-themes** operation (reset edited built-ins, recreate deleted built-ins, leave custom themes untouched; all-or-nothing atomic) and its reserved built-in-theme-name set. Builds on the existing **Themes editor** shipped by feature 007 (colour/size/icon pickers, font-family pill editor, button-style tokens, per-token icon overrides, JSON⇄UI toggle, immediate-apply, select / rename / delete). **Relates to** feature 009 (theme-content), which added theme tokens (e.g. `editorGutterBg` / `editorGutterFg`, the `dismiss` icon) that this editor must expose, and feature 015 (preferences-and-settings), which owns the cross-cutting global "reset everything".

**Input**: Reconstructed feature. Feature 010 designed the authoritative shipped-defaults record and the restore API but shipped **no UI**; its spec states that "`014-theme-editor` builds the 'Restore All Themes to Default' control on top of the restore-all-themes operation." Today the Themes editor's restore path does not fully work, a deleted built-in theme is gone for good, and there is no way to create a custom theme. This feature adds the theme-editor controls that complete those flows on top of feature 010's now-correct API.

---

## Clarifications

### Session 2026-07-12 (post-implementation UX review)

- Q: Should the theme picker be a row list (one row per theme, per-row action icons) or a dropdown? → A: **A single dropdown**, with **one set of action icons that act on the currently selected theme** — the row list consumed far too much vertical space. This **supersedes** the row-list decision recorded on 2026-07-11. A deleted built-in is **still individually recoverable**: it stays in the dropdown marked `"<name> (deleted)"`, and selecting it targets the toolbar, which then offers **Recreate** (it has no file, so it cannot be *activated*). Selecting a present theme activates it, exactly as before (select = activate).
- Q: The three preference editors appeared to share one scrollbar — scrolling deep into Settings left you mid-way down Themes. → A: Each editor MUST keep its **own scroll position**, restored when the user switches back to it.
- Q: Should a theme action announce success in a banner ("X restored to its default")? → A: **No.** A successful restore / clone / rename / delete is immediately visible in the editor itself, so a success banner is noise. Only **failures** are surfaced (a restore that silently did nothing must never look like it worked).
- Q: Should a deleted built-in remain in the picker so it can be recreated individually? → A: **No** — it is **removed from the list entirely**, and the **only** way to bring it back is "Restore all themes to default". This **supersedes** the deleted/restorable-entry decision recorded on 2026-07-11 (and its dropdown restatement earlier today): there is no per-theme recreate control. The name stays **reserved** while deleted, so a new theme still cannot take it.
- Q: How should "Restore All" be distinguished from the per-theme actions? → A: It acts on **every built-in**, not on the selection, so it MUST be **visually separated** from the selection-scoped actions (a separator) and MUST carry a **different icon** from the per-theme restore, so the two never read as the same action.

### Session 2026-07-11

- Q: At what granularity can themes be restored to their shipped values? → A: Restore-all built-in themes (010 FR-008) **plus per-theme** reset-to-shipped for a single selected built-in (completing 007's restore); **per-token** restore out of scope (not backed by 010's API).
- Q: Does feature 014 own custom-theme creation ("Save As"/duplicate), and how does it reconcile with 007's in-place rename? → A: Creation is via a new **Clone** control only — there is **no separate "New Theme"** function and **no "Save As"** (edits apply live as values change, so "Save As" is meaningless). Clone duplicates the currently selected theme and opens a **modal name dialog** whose field is prefilled with `<source name> - Clone`, with the word "Clone" pre-selected so the user can type over it. **Rename** also moves from 007's in-place edit to the **same modal name dialog**. The reserved built-in-name set is enforced in both dialogs.
- Q: Does "Restore All Themes to Default" require an explicit confirmation dialog? → A: **Yes** — it is destructive to the user's edits to built-in themes, so it confirms first. The dialog's decision buttons remain text-labelled (constitution v3.12.0 dialog exception), with colours still from theme tokens.
- Q: How does a user recreate a single **deleted** built-in theme, given a deleted theme is no longer in the list? → A: Deleted built-ins **remain visible in the theme list in a "deleted/restorable" state** (e.g. greyed) carrying a per-row **recreate** control; single-theme recreate therefore has a discoverable home and Restore All is not the only recovery path.
- Q: Do the single-theme actions require a confirmation dialog (as Restore All does)? → A: **Per-theme restore-to-shipped confirms** (it is destructive to that built-in's edits, consistent with Restore All); **recreate of a deleted built-in does not confirm** (it is purely additive — nothing is lost).

### Session 2026-07-11 (provenance)

- Q: Is there a verbatim original prompt for this feature? → A: **No.** The `014-theme-editor` branch was created on 2026-07-10 as a bare placeholder during the decomposition of the workspace/editor family into features 008–015; specs were authored only for 008–011. This specification was reconstructed from feature 010's explicit carve-outs — 010 states 014 "builds the 'Restore All Themes to Default' control on top of the restore-all-themes operation", assigns custom-theme creation and built-in-name reservation to 014 (010 FR-007a and its name-reservation clarification: "enforced at the point of creation by `014-theme-editor`"), and from GitHub issue #35 which lists 014 as "theme editor 'Restore All'". The headline controls are fixed by that source; finer decisions are surfaced below.

### Open questions

_All three open questions (restore granularity, creation ownership & rename model, restore-all confirmation) were resolved on 2026-07-11 — see Session 2026-07-11 above._

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Restore all built-in themes to their shipped state (Priority: P1)

A user has edited several built-in themes and deleted one they didn't like. They now want the bundled themes back exactly as shipped — without losing the custom themes they created. They invoke "Restore All Themes to Default"; every built-in returns to its shipped values, the deleted built-in reappears, and their custom themes are untouched. If the operation cannot complete (e.g. the config file is locked), nothing is half-applied.

**Why this priority**: This is the control feature 010 was built to enable and the headline gap issue #35 names ("the theme editor's 'restore defaults' doesn't fully work; a deleted built-in theme is gone for good"). It is independently valuable and testable on its own.

**Independent Test**: Edit two built-in themes and delete a third, create one custom theme, then invoke Restore All; assert all built-ins match their shipped values, the deleted built-in is recreated, the custom theme is unchanged, and a locked-file scenario leaves everything as it was (atomic).

**Acceptance Scenarios**:

1. **Given** built-in themes have been edited and one has been deleted, **When** the user invokes Restore All Themes to Default and confirms in the confirmation dialog, **Then** every built-in theme returns to its shipped values and the deleted built-in is recreated.
2. **Given** the user has custom themes, **When** Restore All completes, **Then** the custom themes are left exactly as they were — never modified, never removed.
3. **Given** the configuration is temporarily unwritable (locked file), **When** Restore All is attempted, **Then** the operation fails as a whole with a clear message and no theme is partially changed (all-or-nothing, per feature 010).
4. **Given** Restore All has completed, **When** the user views the theme list, **Then** the restored/recreated themes are immediately reflected (hot-applied) with clear success feedback.

---

### User Story 2 - Restore a single built-in theme to its shipped values (Priority: P2)

A user has tweaked one built-in theme and wants just that one back to how it shipped, leaving their edits to other built-ins and all custom themes alone.

**Why this priority**: It is the finer-grained counterpart to US1 and completes feature 007's per-theme restore (which "doesn't fully work" today), but the all-at-once Restore All already covers the principal recovery need, so it ranks below US1. (In scope per the granularity clarification.)

**Independent Test**: Edit two built-in themes, restore exactly one of them to shipped, and confirm that one matches its shipped values while the other's edits and all custom themes are untouched.

**Acceptance Scenarios**:

1. **Given** a built-in theme has been edited, **When** the user restores that single theme to its shipped values, **Then** only that theme changes and every other theme (built-in and custom) is untouched.
2. **Given** a built-in theme has been deleted, **When** the user views the theme list, **Then** that built-in still appears in a visually distinguished "deleted/restorable" state carrying a recreate control; **When** the user invokes that recreate control, **Then** the built-in reappears at its shipped values without affecting other themes.
3. **Given** a single-theme restore, **When** it completes, **Then** the change is hot-applied and clearly indicated.

---

### User Story 3 - Create a custom theme (Priority: P2)

A user wants a theme of their own. They select a theme close to what they want and invoke **Clone**; a modal name dialog opens prefilled with `<source name> - Clone` (the word "Clone" pre-selected), they type a name and confirm, and a new custom theme — a copy of the source — appears, editable with the existing pickers. They can later rename it through the same modal dialog. They are prevented from taking a name reserved for a built-in theme, even a built-in they have deleted.

**Why this priority**: It closes a real gap (feature 007 shipped no way to create a theme) and is what makes the Themes editor a full editor, but the restore controls address the more urgent data-loss gap, so creation ranks after US1.

**Independent Test**: Select a theme and Clone it, confirm the name dialog is prefilled `<source> - Clone` with "Clone" pre-selected, accept a new name, edit a token, and confirm it appears as a custom theme; attempt to name it (via Clone or rename) after a built-in (including a deleted built-in) and confirm the name is refused.

**Acceptance Scenarios**:

1. **Given** the Themes editor with a theme selected, **When** the user invokes Clone, **Then** a modal name dialog opens with the field prefilled `<source name> - Clone` and the word "Clone" pre-selected for overtype.
2. **Given** the Clone name dialog, **When** the user confirms a valid name, **Then** a new custom theme (a copy of the source) appears, editable with the existing pickers, and selectable.
3. **Given** the Clone or rename dialog, **When** the chosen name is one reserved for a built-in theme (including a built-in that has been deleted), or is empty/whitespace, or duplicates another custom theme's name, **Then** the name is refused with a clear message (per feature 010's reserved-name set).
4. **Given** a custom theme has been created, **When** Restore All Themes to Default is later invoked, **Then** the custom theme is left untouched (US1 scenario 2).

---

### Edge Cases

- What happens when Restore All is invoked but no built-in has been edited or deleted? It is effectively a no-op that still reports success (idempotent); custom themes remain untouched.
- What happens when the currently *active* theme is a built-in being restored, or is the deleted built-in being recreated? The active theme updates in place (hot-applied) to its shipped values; the user is never left on a theme that no longer exists.
- What happens when the currently active theme is a *custom* theme during Restore All? It stays active and unchanged.
- What happens when a new theme token (e.g. feature 009's gutter tokens) exists that a shipped theme now defines? Restore flows the shipped value through from feature 010's record without this feature transforming anything; the editor exposes the new token (completeness).
- What happens when the user tries to delete the last remaining theme, or the active theme? Deletion follows the existing 007 rules; a deleted built-in stays in the list as a "deleted/restorable" row, and both its per-row recreate and Restore All can bring it back, so no built-in is ever permanently lost.
- What happens when creation is attempted with an empty or whitespace name, or a name already used by another custom theme? It is refused with a clear message, consistent with the reserved-name handling.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Restore controls

- **FR-001**: The Themes editor MUST provide a **"Restore All Themes to Default"** control that invokes feature 010's restore-all-built-in-themes operation: reset every edited built-in to its shipped values and recreate every deleted built-in, while leaving all custom themes untouched.
- **FR-002**: Restore All MUST be **all-or-nothing**: if it cannot complete (e.g. a locked or unwritable configuration file), it MUST fail as a whole with a clear message and leave every theme unchanged (delegating atomicity/rollback to feature 010).
- **FR-003**: Restore All MUST **hot-apply** its result — the theme list and the active theme reflect the restored/recreated themes immediately. It MUST surface a **failure** clearly; it MUST NOT raise a **success** banner (the result is self-evident in the editor, so announcing it is noise).
- **FR-004**: Restore All MUST present an explicit **confirmation dialog** before proceeding, because it is destructive to the user's edits to built-in themes. The dialog's decision buttons may be text-labelled (constitution v3.12.0 dialog exception), with colours still derived from theme tokens.
- **FR-005**: The editor MUST provide **per-theme restore-to-shipped** for a single selected built-in, changing only that theme, without affecting any other theme. Because it is destructive to that built-in's edits, per-theme restore-to-shipped MUST present a **confirmation dialog** before proceeding (same pattern as FR-004). It is backed by a **thin single-theme restore operation** that writes the one theme's shipped value using feature 010's shipped-defaults record and its atomic write primitive (feature 010 shipped restore-all but not a single-theme restore); this operation MUST delegate to those 010 primitives and MUST NOT re-implement the record or the atomicity (see FR-011). **Per-token** restore is out of scope (not backed by feature 010's API).
- **FR-005a**: A **deleted built-in theme MUST NOT be listed** in the theme picker — it disappears like any other deleted theme. The **only** way to bring it back is **Restore All Themes to Default** (FR-001), which recreates every deleted built-in; there is **no per-theme recreate control**. Its name nevertheless remains **reserved** while it is deleted, so no new theme may take it (FR-007). Custom themes, once deleted, are not recoverable at all (they have no shipped record).

#### Theme creation

- **FR-006**: The Themes editor MUST provide a **Clone** control as the sole way to create a custom theme: it duplicates the currently selected theme and opens a **modal name dialog** whose field is prefilled with `<source name> - Clone`, with the word "Clone" pre-selected so the user can immediately type over it. On confirmation a new custom theme is created (a copy of the source), editable with the existing pickers and selectable. There MUST be **no separate "New Theme"** action and **no "Save As"** action — because edits apply live as values change, a distinct save step is meaningless.
- **FR-007**: Theme creation MUST enforce feature 010's **reserved built-in-theme-name set**: a new theme MUST NOT take a name reserved for a built-in theme, **even one the user has deleted**, and MUST refuse such a name with a clear message.
- **FR-007a**: Name comparison — against both the reserved built-in set and the names already in use — MUST be **case-insensitive**, and MUST consider **every** present theme (built-in and custom), not only custom ones. A theme name becomes a **file name** (`themes/<name>.json`), and on the primary target (Windows) `Throng.json` and `throng.json` are the *same file*. A case-sensitive check would therefore let a new theme silently **overwrite a built-in** (e.g. a clone named "Throng"), and let a custom named "debian" be **clobbered** by a later restore writing `Debian.json` — both data loss. Names differing only by case MUST be treated as colliding.
- **FR-008**: **Rename** MUST move from feature 007's in-place edit to a **modal name dialog** — the same dialog pattern used by Clone (FR-006) — through which a custom theme is renamed. Both the Clone dialog and the rename dialog MUST enforce FR-007's reserved built-in-name set and MUST NOT allow a custom theme to occupy a reserved built-in name (including a deleted built-in) or a name already used by another custom theme.

#### Picker & layout

- **FR-012**: The theme picker MUST be a **single dropdown** listing the themes that are present, with **one set of action controls that act on the currently selected theme** — not a per-theme row list, which consumes too much vertical space. Selecting a theme activates it (select = activate); the dropdown's displayed value follows the **active** theme, so it never runs ahead of activation while the token editor below is still editing the previously-active theme. **Restore All**, which acts on every built-in rather than on the selection, MUST be **visually separated** from the selection-scoped controls and MUST carry a **different icon** from the per-theme restore.
- **FR-013**: Each preferences editor (Settings, Key Bindings, Themes) MUST keep its **own scroll position**, restored when the user switches back to that tab. The three editors share one scrolling element, so without this one tab's scroll offset is inherited by the next.

#### Completeness, theming & controls

- **FR-009**: Every editable **theme token** — including tokens added by feature 009 (e.g. `editorGutterBg` / `editorGutterFg`) and the `dismiss` icon token — MUST remain exposed and editable in the Themes editor, backed by the configuration-editor **completeness test** (constitution v3.11.0), so restore and creation never leave a shipped token unexposed.
- **FR-010**: Every interactive **action control** this feature adds (Restore All, per-theme restore, Clone, Rename, Delete) MUST be a **themeable icon carrying a hover title**, taking its icon and colours from theme tokens, per constitution v3.12.0. Restore All MUST use its **own icon token**, distinct from the per-theme restore's. The exceptions are text inside modal dialogs — the **decision buttons in the confirmation dialogs** (Restore All and per-theme restore) and the **name field / confirm button in the Clone and rename dialogs** — which may be text-labelled (their colours still derive from theme tokens).
- **FR-011**: This feature MUST consume feature 010's restore API and MUST NOT re-implement the shipped-defaults **record** or its **atomicity/rollback** guarantees; it provides the controls, the feedback, and — where feature 010 left an operation unbuilt — a **thin operation that delegates to those 010 primitives** (specifically the single-theme restore of FR-005, which writes `shipped.themes[name]` through feature 010's atomic write). It MUST NOT duplicate feature 010's record assembly or its transactional-write logic.

### Key Entities

- **Restore-all control**: the user-facing action that triggers feature 010's restore-all-built-in-themes (reset edited built-ins, recreate deleted built-ins, custom untouched, atomic).
- **Per-theme restore control**: the user-facing action that restores a single built-in theme to its shipped values, affecting no other theme.
- **Deleted-restorable row & recreate control**: a deleted built-in remains visible in the theme list in a distinguished "deleted/restorable" state carrying a per-row recreate control that restores just that built-in to its shipped values. Custom themes, once deleted, are not restorable.
- **Clone control**: the sole theme-creation action — it duplicates the selected theme and opens the name dialog to produce a custom theme, subject to the reserved built-in-name set from feature 010. No separate "New Theme" or "Save As".
- **Name dialog**: the modal dialog used by both Clone (prefilled `<source name> - Clone`, "Clone" pre-selected) and rename, which validates the entered name against the reserved built-in-name set and existing custom names.
- **Reserved built-in-name set**: the names owned by built-in themes (from feature 010) that a custom theme may never take, including deleted built-ins.
- **Theme token exposure**: the requirement that every shipped theme token is editable in the editor and covered by the completeness test.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After editing and deleting built-in themes, a single Restore All returns every built-in to its shipped values and recreates the deleted one in 100% of trials, with custom themes unchanged.
- **SC-002**: A Restore All that cannot complete (locked file) leaves 100% of themes unchanged (no partial application).
- **SC-003**: A user can restore exactly one built-in theme to its shipped values without altering any other theme.
- **SC-004**: A user can create a custom theme and is prevented, in 100% of attempts, from naming it after any built-in theme — including a deleted built-in.
- **SC-005**: Every shipped theme token is exposed and editable in the Themes editor (completeness test passes), including tokens introduced by feature 009.
- **SC-006**: All new action controls are themeable icons with hover titles legible on every bundled theme (only the confirmation dialog's decision buttons are text-labelled).
- **SC-007**: Restore and creation results are hot-applied and reflected in the UI immediately. Successes raise no banner (they are visible in the editor); a failure is always surfaced, so an operation that silently did nothing never looks like it worked.

---

## Assumptions

- **No verbatim original prompt existed for feature 014.** This specification was reconstructed from feature 010's explicit carve-outs (Restore All control; creation + name reservation assigned to 014) and issue #35. See Clarifications → provenance.
- Feature **010** provides the authoritative shipped-defaults record and the atomic restore API (restore-all-built-in-themes; reserved-name set); 014 builds controls on top and does not re-implement it. `Depends on: 010-shipped-defaults`.
- The **Themes editor already exists** (feature 007) with token pickers, JSON⇄UI toggle, immediate-apply, and select/rename/delete; this feature is a delta that adds restore and creation controls, not a re-specification of the editor.
- Feature **009** may add new theme tokens; feature 010's fidelity test flows them through, and this editor exposes them (completeness). 014 does not do 009's palette/content work.
- **Custom-theme creation belongs to 014**, not 007: feature 007 shipped no creation control, and feature 010 assigns creation and built-in-name reservation to 014 (FR-007a and the name-reservation clarification). Per clarification, creation is via a single **Clone** control (duplicate selected theme → modal name dialog); there is no "New Theme" or "Save As", and feature 007's in-place rename is replaced by the same modal name dialog.
- **"Reset everything"** — the cross-cutting global reset spanning settings, key bindings **and** themes — is owned by feature **015** (a single atomic call to feature 010's reset-everything), not by this feature. 014 provides only the **themes-only** restore controls. Because both read the same feature-010 shipped-defaults record, the themes-only restore and the global reset can never produce conflicting theme values.
- Restore All is **destructive to the user's edits to built-in themes** (not to custom themes), which is why it requires an explicit confirmation dialog (per clarification).

## Out of Scope

- Feature **010's** non-UI shipped-defaults record, restore logic, and atomicity/rollback guarantees — consumed here, not built.
- The **global "reset everything"** across settings + key bindings + themes — owned by feature **015**. This feature is themes-only.
- Feature **015's** per-binding and per-setting reset controls.
- Feature **009's** theme content work (distinct palettes, token copy, gutter theming, quality guards).
- The **base Themes editor** pickers, JSON⇄UI toggle, and immediate-apply already shipped by feature 007.
- **Per-token** restore-to-shipped (not backed by feature 010's API; confirmed out of scope per the granularity clarification).
- **Full app-wide keyboard-only accessibility** (issue #26).
