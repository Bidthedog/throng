# Feature Specification: Preferences & Settings — Granular Reset Controls

**Feature Branch**: `015-preferences-and-settings`

**Created**: 2026-07-11

**Status**: Implemented, then **amended 2026-07-12** — FR-015 – FR-018 (row affordance placement, the per-item revert/clear actions, and the Key Bindings typeahead) were added after review of the running feature, from issues **#51** and **#52**. Six further items from the same review were deferred: see Out of Scope → *Deferred from the 2026-07-12 preferences backlog*.

**Depends on**:

- Feature **010 (shipped-defaults)**, whose non-UI reset API this feature builds controls on top of — specifically **reset a single key binding** to its shipped binding(s), **reset a single setting** (a leaf value addressed by its full dotted path), and **reset everything** (atomic, all-or-nothing across settings, key bindings and themes).
- Feature **014 (theme-editor)**, which **MUST merge first**. It owns the themes surface (per-theme restore/recreate, clone, rename, themes-only "Restore All Themes to Default") and — critically — it establishes the shared plumbing and primitives this feature consumes rather than duplicates: the **shipped-defaults IPC seam** into the preferences window, the shared **themeable icon-button**, and the **single-theme restore** operation. (014 also introduces a modal confirmation dialog for the themes surface; 015 does **not** consume it — see FR-006 and issue #48.) See Clarifications → boundary with feature 014.
- The existing **Settings** and **Key Bindings** editors shipped by feature 007 (typeahead settings search; additive multi-chord bindings with deletable pills; immediate-apply).

This feature owns the per-item resets and the cross-cutting global reset; feature 014 owns everything themes-shaped.

**Input**: Reconstructed feature. Feature 010 designed the authoritative shipped-defaults record and the single-item reset API but shipped **no UI**; its spec states that "`015-preferences-and-settings` builds the per-binding and per-setting reset controls on top of the single-item reset operations." Today there is no way to reset one key binding to its shipped value, and no way to reset a single setting leaf. This feature adds those per-item reset affordances, and wires a correct atomic global "reset everything", on top of feature 010's API.

---

## Clarifications

### Session 2026-07-11 (provenance)

- Q: Is there a verbatim original prompt for this feature? → A: **No.** The `015-preferences-and-settings` branch was created on 2026-07-10 as a bare placeholder during the decomposition of the workspace/editor family into features 008–015; specs were authored only for 008–011. This specification was reconstructed from feature 010's explicit carve-out — 010 states 015 "builds the per-binding and per-setting reset controls on top of the single-item reset operations" (reset-single-binding; reset-single-setting as a leaf by dotted path, 010 FR-011; reset-everything, atomic) — and from the granular-reset gap now tracked as GitHub issue **#43** (issue #35 was feature 010's *foundation* issue — "Shipped defaults & restore foundation" — and is closed; the gap this feature closes is #43). The headline controls are fixed by that source; finer decisions are surfaced below. The broader preferences window and its Settings / Key Bindings editors already shipped in feature 007; this feature is the granular-reset delta, not a re-specification.

### Session 2026-07-11 (clarification)

- Q: Where does the cross-cutting "reset everything" live, given feature 014 owns a themes-only restore? → A: **Feature 015 owns it.** A single global reset control (later renamed **"Reset All Preferences"**) calls feature 010's atomic reset-everything across settings, key bindings and themes. Feature 014 retains a distinct, narrower themes-only "Restore All Themes to Default". Because both read the same feature-010 record, they can never disagree.
- Q: Does a **single-item** reset (one binding, one setting) require confirmation? → A: **No — applied immediately, with no confirmation**, consistent with feature 007's immediate-apply model (single item, low blast radius, re-editable). Only the global reset-everything confirms.
- Q: When is a per-item reset affordance **shown**? → A: **Only when the item is overridden** (its current value differs from its shipped value), so the control doubles as the "modified" cue. Every item that has a shipped default remains resettable whenever it is overridden, satisfying completeness (FR-008).
- Q: Feature 007 already ships a per-tab **"Reset to Defaults"** (which reverts the whole current editor to defaults compiled into the app rather than to feature 010's authoritative record) and a **"Revert All"** (which undoes every change made since the preferences window was opened — a session undo, not a defaults reset). What happens to them? → A: **"Revert All" is left untouched** — it is a session undo, a genuinely different concept from resetting to shipped defaults. The per-tab **"Reset to Defaults" is re-pointed at feature 010's authoritative record**, so the app has exactly one notion of "shipped". The new global reset (later named **"Reset All Preferences"**) is added alongside them, giving four distinct scopes: one item, one editor, everything, and session-undo.
- Q: Where does the global reset control (now **"Reset All Preferences"**) live? → A: **In the preferences toolbar**, as a themeable icon beside the existing mode-toggle / reset-current / revert-all affordances. It is therefore reachable from every tab and needs no new surface. *(Its confirmation surface is the window's existing inline strip — briefly re-answered as feature 014's modal dialog in the boundary session, then settled back to the inline strip on 2026-07-12 when notice-surface unification was deferred to issue #48.)*

### Session 2026-07-11 (boundary with feature 014)

Feature **014 (theme-editor) is fully implemented on its branch but not yet merged**. It builds shared plumbing and shared UI primitives that this feature would otherwise duplicate, so the boundary was settled before planning:

- Q: 015's per-tab "Reset to Defaults" (FR-011), re-pointed at feature 010's record, would on the Themes tab perform exactly the same write as feature 014's per-theme restore — two controls, one behaviour. How is the duplicate resolved? → A: **The per-tab reset is dropped from the Themes tab.** FR-011 applies to the **Settings and Key Bindings tabs only**; on the Themes tab the control is hidden, because feature 014 provides a restore-to-shipped affordance on every built-in theme row.
- Q: Feature 014 built a shared **modal** confirmation dialog; feature 007's preferences window has an **inline** confirmation strip. The window must not confirm destructive actions two different ways — which model wins? → A: ~~Feature 014's shared modal dialog; the inline strip is retired.~~ **SUPERSEDED** by the 2026-07-12 session below: unifying the notice surfaces is **deferred** to a dedicated follow-up (issue #48). 015 reuses the **existing inline strip** for its confirmations and notices, and both models coexist until that refactor lands.
- Q: Must 014 land before 015? → A: **Yes.** 014 defines the shipped-defaults IPC seam, the shared themeable icon-button primitive and the single-theme restore operation that 015 depends on (its modal confirmation dialog stays on the themes surface — 015 does not adopt it, see issue #48); ~~it has also already migrated the shared preferences-reset E2E suite~~ — **that claim proved false**; see the post-merge verification session below, and migrating that suite is 015's own work (FR-014). **014 merges first; 015 is then planned and built on top of it.** This upgrades 014 from "relates to" to a hard **dependency**.

### Session 2026-07-11 (planning readiness)

- Q: Does the reset affordance need a new theme icon token? → A: **No.** Every reset affordance (per-item, per-tab, global) reuses the **existing restore icon token**, exactly as feature 014 already does for its three restore controls; the hover title carries the scope. Additionally, the preferences toolbar's two **hard-coded inline icon graphics** (which pre-date constitution v3.12.0) MUST be migrated onto theme tokens, so every icon in the window is themeable.
- Q: What is the "clear feedback" on a per-item reset, given there is no confirmation? → A: **The row itself is the feedback**: the setting value or the binding's chords visibly change to the shipped value, and the reset affordance disappears because the item is no longer overridden. No toast, banner or flash is added.
- Q: Where is a **failed** reset surfaced (locked/unwritable configuration)? → A: In an **inline, dismissable notice in the preferences window** — settled on 2026-07-12 as the window's existing inline strip rather than a new surface modelled on feature 011 (see issue #48). The message names the failed operation and states explicitly that **nothing was changed** — which for the global reset is the user-visible proof of feature 010's all-or-nothing guarantee.
- Q: What counts as "overridden" for a **key binding**, whose value is a set of chords? → A: A binding is overridden **iff its set of normalized chords differs from the shipped set** — chord **order and capitalisation are irrelevant**. A binding that fires on exactly the shipped chords is never flagged as modified, so no reset is ever offered that would produce no visible change.
- Q: After a global reset, does the **active-theme selection** also return to the shipped default? → A: **Yes.** The active theme is a setting like any other, so Reset All Preferences restores it to the shipped default theme. Custom theme **files are preserved** (FR-005a); they are simply no longer selected, and the user can re-select one immediately.

### Session 2026-07-12 (contradictions & modes)

- Q: Retiring the inline confirmation strip would also remove the confirmation used by feature 007's per-tab reset and "Revert All", contradicting FR-012's "functionally unchanged". Which way? → A: **Neither — the unification is deferred.** The app today has three notice surfaces (007's inline strip, 014's modal dialog, 011's dismissable error panels); consolidating them is its own piece of work, tracked as **issue #48 ("Refactor inline and dialog error and confirmation notices into toastr", milestone v1.0.0)**. For 015, the **existing inline strip is reused** for the global reset's confirmation and for failure notices. Feature 014's modal dialog stays as-is on the themes surface. The two models coexist until #48 lands, so SC-011 no longer claims a single confirmation model.
- Q: An action that ships with **no key binding** — is it "overridden" once the user binds it? → A: **Yes.** "Ships unbound" means an **empty shipped chord set**, which is a shipped value like any other: binding the action makes it overridden, the reset affordance appears, and resetting **clears the binding back to unbound**. The "not resettable" carve-out applies only to entries **absent from feature 010's record entirely** (e.g. unknown keys a user hand-added in JSON).
- Q: How do the reset controls behave in the preferences window's **JSON editing mode**? → A: The **per-item resets are UI-mode only** — they are row affordances, and in JSON mode the user edits the raw document, where deleting a key *is* the reset. The **toolbar controls** (per-tab reset, Revert All Preferences, Reset All Preferences) remain available in **both** modes, and a reset performed while JSON mode is active MUST refresh the visible document to the reset content, since the file is rewritten underneath the editor.

### Session 2026-07-12 (naming & the limits of "all")

- Q: The global control resets settings, key bindings and built-in themes — but **not** the project list, window layout or workspace state, which the app also persists. Should that limit be pinned down? → A: **Yes — state it in the confirmation.** The confirmation MUST name both what **is** reset (settings, key bindings, built-in themes) and what **survives** (projects, window layout, workspace state, and custom themes), so the destructive action is truthful in both directions and the survival of projects/layout is directly testable.
- Q: Given that limit, is "Reset all configuration" the right name? → A: **No — it is renamed "Reset All Preferences"**, which is what it actually resets. The same correction applies to **every other control whose scope is all preferences**: feature 007's "Revert All" becomes **"Revert All Preferences"** (a **label-only** change; its session-undo semantics are unchanged, per FR-012). Controls with a *narrower* scope keep their narrower names, and their hover titles MUST name that scope explicitly (e.g. the per-tab reset names the editor it applies to).

### Session 2026-07-12 (post-merge verification)

Features **014 and 013 have now merged to master**, so every claim this spec made about 014's code was re-verified against the merged tree. `resetEverything` / `resetBinding` / `resetSetting` remain **unexposed to the renderer** (no IPC channel, no preload entry, no typing), so 015's core work is intact. Four decisions followed:

- Q: The testid `prefs-reset-all` is **already taken by the session-undo control**. What id does the new global reset get? → A: **Rename for clarity.** The session undo becomes **`prefs-revert-all`** (matching its "Revert All Preferences" label) and the global reset takes **`prefs-reset-preferences`**. The existing E2E assertions that reference the old id are updated. No id may name a scope its control does not have.
- Q: FR-009a said "reuse the existing **restore** token", but 014 ships **two** — `retry` (restore one) and `restoreAll` (restore all). Which goes where? → A: **Inherit 014's one-vs-all distinction**: the **per-item and per-tab** resets use **`retry`**; the **global** "Reset All Preferences" uses **`restoreAll`**. The two toolbar reset controls must remain tellable apart at a glance.
- Q: SC-014 claims "every icon in the preferences window is themeable", but there are more hard-coded graphics than FR-009b lists. How far does the migration go? → A: **The whole window.** Every hard-coded icon graphic — the toolbar's two reset icons, the settings-search **clear** icon, and the chord-pill **remove** glyph — is migrated onto theme tokens, **and the UI⇄JSON mode toggle is converted from text (`{ }` / `UI`) to themeable glyphs** as well.
- Q: The mode toggle has no suitable existing token. How many new tokens does this feature add? → A: **Exactly two** — one for the JSON-editing mode and one for the visual-editing mode — each with its human-readable copy so the token-completeness test (constitution v3.11.0) still passes on every bundled theme. The chord-pill remove reuses the existing **destroy** token and the search-clear reuses **dismiss**. This **supersedes FR-009a's earlier "no new tokens"**.

**Corrections forced by the merged code:**

- The claim that "**014 has already migrated the shared preferences-reset E2E suite**" is **false** — that suite has not been touched since feature 007, and four of its assertions contradict this feature (it asserts the per-tab reset is *disabled* on the Themes tab rather than hidden; it asserts the literal titles "Reset to Defaults" and "Revert All"; and it asserts each toolbar button contains exactly one inline `<svg>`). Updating those assertions is **015's work** (FR-014).
- **014 pre-empted part of FR-011**: the per-tab reset's *Themes* branch already restores from feature 010's record. What remains for 015 is hiding that control on the Themes tab and re-pointing its **Settings** and **Key Bindings** branches, which still resolve defaults from the editor-compiled set (FR-011a).
- **No action currently ships unbound** (013's 13 new actions all have default chords), so FR-004b's empty-shipped-chord-set rule is presently **hypothetical** — it stays as a correctness rule and is covered by unit tests against a synthetic shipped record rather than a live action.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reset a single key binding to its shipped default (Priority: P1)

A user has rebound an action and later wants just that one action back to how it shipped — without disturbing every other binding they've customised. From the Key Bindings editor they reset that single action, and its chord set returns to the shipped binding(s) while every other binding is left alone.

**Why this priority**: This is the specific gap issue **#43** names first — there is no way to reset a single key binding to its shipped value. It is independently valuable and testable, and is the most-requested of the per-item resets.

**Independent Test**: Rebind several actions, reset exactly one of them, and confirm that action's chords match the shipped binding(s) while every other rebinding is untouched.

**Acceptance Scenarios**:

1. **Given** an action whose key binding has been customised, **When** the user resets that single binding, **Then** its chord set returns to the shipped binding(s) and no other action's binding changes.
2. **Given** an action already at its shipped binding, **When** the user resets it, **Then** the operation is a no-op with no visible change (idempotent).
3. **Given** a binding is reset, **When** the change is applied, **Then** it is hot-applied (the new/old binding takes effect immediately) with clear feedback, and **no confirmation is required**.
4. **Given** an action that ships with multiple chords, **When** it is reset, **Then** the **full** shipped chord set is restored, not a single chord.
5. **Given** an action at its shipped binding, **When** the user views the Key Bindings editor, **Then** that row shows **no** reset affordance; **When** the user rebinds it, **Then** the reset affordance appears on that row, marking it as modified.

---

### User Story 2 - Reset a single setting to its shipped default (Priority: P1)

A user has changed a setting and wants only that one setting back to its shipped value, leaving every sibling setting — including others under the same section — exactly as they are. From the Settings editor they reset that single setting leaf, addressed by its full path, and only that leaf changes.

**Why this priority**: It is the settings counterpart to US1 and closes the same class of gap (no way to reset one setting today). It is independently valuable and testable.

**Independent Test**: Change several settings under the same section, reset exactly one leaf, and confirm only that leaf returns to its shipped value while every sibling leaf keeps the user's value.

**Acceptance Scenarios**:

1. **Given** a setting leaf whose value has been changed, **When** the user resets that single setting, **Then** only that leaf returns to its shipped value and every sibling leaf is untouched.
2. **Given** a leaf already at its shipped value, **When** the user resets it, **Then** it is a no-op with no visible change (idempotent).
3. **Given** a setting is reset, **When** the change applies, **Then** it is hot-applied immediately and clearly indicated, and **no confirmation is required**.
4. **Given** a nested setting addressed by a dotted path, **When** it is reset, **Then** exactly that leaf is restored and no parent or sibling structure is rewritten (per feature 010's leaf model).
5. **Given** a setting leaf at its shipped value, **When** the user views the Settings editor, **Then** that row shows **no** reset affordance; **When** the user changes it, **Then** the reset affordance appears on that row, marking it as modified.

---

### User Story 3 - Reset all preferences to shipped defaults (Priority: P2)

A user wants to start over — return settings, key bindings and themes to exactly how they shipped — in one action, with a clear warning first because it discards all their customisations at once. They invoke "Reset All Preferences", see plainly what will be reset *and* what will survive (their projects, layout and custom themes), confirm, and their preferences return to shipped defaults atomically; if it can't complete, nothing is half-reset.

**Why this priority**: It is the app's first correct, atomic, all-kinds reset to *shipped* defaults, and it is what makes the per-tab "Reset to Defaults" trustworthy by putting both on feature 010's record. The per-item resets address the more common day-to-day need, so it ranks below them.

**Independent Test**: Customise settings, bindings and (via the Themes editor) a built-in theme, invoke Reset All Preferences and confirm; assert all three kinds return to shipped defaults together, and that a locked-file scenario leaves everything unchanged (atomic).

**Acceptance Scenarios**:

1. **Given** customised settings, key bindings and themes, **When** the user invokes Reset All Preferences and confirms, **Then** all three return to their shipped defaults in one atomic operation.
2. **Given** the configuration is temporarily unwritable (locked file), **When** Reset All Preferences is attempted, **Then** it fails as a whole with a clear message and nothing is partially reset (all-or-nothing, per feature 010).
3. **Given** Reset All Preferences is invoked, **When** the user is shown the confirmation, **Then** it states **both** what will be reset (settings, key bindings, built-in themes) **and** what will survive (projects, window layout, workspace state, custom themes), before anything changes.
4. **Given** Reset All Preferences completes, **When** the user views the editors, **Then** the reset state is hot-applied and reflected immediately with truthful success feedback.
5. **Given** the user is on any preferences tab, **When** they look at the preferences toolbar, **Then** the Reset All Preferences control is present and reachable without switching tabs.
6. **Given** the user has created a custom theme, **When** Reset All Preferences completes, **Then** the custom theme is **still present and unmodified** — only shipped (built-in) themes are restored.
7. **Given** the user has open projects and a customised window layout, **When** Reset All Preferences completes, **Then** their **projects and layout are unchanged** — only preferences were reset (FR-005b).

---

### Edge Cases

- What happens when a per-item reset is invoked on an item with no shipped default? The affordance is not offered for entries **absent from feature 010's record entirely** (e.g. an unknown key a user hand-added in JSON). Note this is *not* the same as an action that **ships unbound** — that action has an empty shipped chord set, so it is overridden once bound and resetting returns it to unbound (FR-004b).
- What happens to the affordance's "modified" indication after a reset? Once an item matches its shipped value it is no longer modified, so its reset affordance disappears from that row (the affordance *is* the modified indication).
- What happens when Reset All Preferences is invoked but nothing has been customised? It is effectively a no-op that still reports success (idempotent).
- What happens to a user's **projects, window layout and workspace state** during Reset All Preferences? Nothing — they are outside feature 010's record and are never touched (FR-005b). The confirmation says so explicitly, so the user is not left fearing the loss of work that is not at risk.
- What happens when the active theme is a customised built-in during Reset All Preferences? Themes are reset via the same feature-010 record feature 014 uses, so the active theme hot-applies to its shipped values and the user is never stranded on a theme that no longer exists.
- What happens when a single-setting reset targets a leaf that a newer app version no longer ships? The reset clears the user override for that leaf; a leaf with no shipped counterpart is handled per feature 010's additive-upgrade rules, not rewritten here.
- What happens when the config file is locked during a *single-item* reset? The reset fails cleanly, an inline dismissable error names the failure and says nothing was changed (FR-006a), and the item is left as it was — still overridden, so its reset affordance remains available to retry. Only the one item is affected.
- What happens when a user **reorders** an action's chords (e.g. in JSON mode) without changing which chords they are? The binding is **not** overridden (FR-004b), so no reset affordance appears — the binding fires exactly as shipped.
- What happens if the user invokes a **toolbar reset while JSON mode is active**? The reset applies, and the JSON editor follows feature 007's existing external-change rules (FR-013b): a **clean** buffer refreshes to the reset content, so the user never edits on top of a stale document; a **dirty** buffer surfaces the existing reload prompt rather than silently discarding unsaved work.
- What happens to a user's **custom theme** when they invoke Reset All Preferences while it is active? The theme file survives untouched (FR-005a), but the active-theme *setting* is reset like any other, so the shipped default theme becomes active and the user can re-select their custom theme immediately.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Per-binding reset

- **FR-001**: The Key Bindings editor MUST provide a **per-action reset** affordance that restores a single action's key binding to its **full shipped chord set** via feature 010's reset-single-binding operation, affecting no other action.
- **FR-002**: A per-binding reset MUST be **idempotent** (a no-op when the action already matches its shipped binding), MUST be **hot-applied**, and MUST apply **immediately without a confirmation step**. Its feedback is the **row's own state change** (FR-004c): the chords become the shipped chords and the reset affordance disappears.

#### Per-setting reset

- **FR-003**: The Settings editor MUST provide a **per-setting reset** affordance that restores a single setting **leaf**, addressed by its full dotted path, to its shipped value via feature 010's reset-single-setting operation, leaving every sibling leaf untouched (per feature 010 FR-011).
- **FR-004**: A per-setting reset MUST be **idempotent**, **hot-applied**, and applied **immediately without a confirmation step**, and MUST restore exactly the one leaf without rewriting any parent or sibling structure. Its feedback is the **row's own state change** (FR-004c).

#### Affordance visibility & the "overridden" test

- **FR-004a**: A per-item reset affordance MUST be shown on a row **only while that item is overridden** — its current value differs from its shipped value — so the affordance doubles as the row's **"modified" indication**. It MUST appear as soon as an item is overridden and disappear as soon as it matches its shipped value again (including immediately after a reset). Because affordances therefore come and go as the user edits, **where** they are rendered is itself a requirement — see **FR-015**. Reset is one of up to three per-item actions — see **FR-016**.
- **FR-004b**: The **overridden test** MUST compare against feature 010's shipped record. For a **setting leaf**, it is a value comparison at the leaf's dotted path. For a **key binding**, it MUST compare the **set of normalized chords**, ignoring chord **order and capitalisation** — a binding that fires on exactly the shipped chords MUST NOT be reported as overridden (so no reset is ever offered that would produce no visible change). An action that **ships unbound** has an **empty shipped chord set**, which is a shipped value like any other: binding it makes the action overridden, and resetting it **clears the binding back to unbound**.
- **FR-004c**: The feedback for a per-item reset IS the row's state change: the value or chords become the shipped value and the reset affordance disappears. The feature MUST NOT add a toast, banner or highlight animation for a **successful** per-item reset (failures are surfaced per FR-006a).

#### Global reset

- **FR-005**: The preferences window MUST provide a single global **"Reset All Preferences"** control that invokes feature 010's atomic **reset-everything** across settings, key bindings and themes. It MUST live in the **preferences toolbar** beside the existing always-visible affordances, so it is reachable from every tab without switching tabs. It MUST be named for what it actually resets — **preferences**, not "all configuration" — because the app's other persisted state (projects, window layout, workspace state) is **not** touched (FR-005b).
- **FR-005a**: Reset All MUST restore settings, key bindings and every **built-in** theme to their shipped values. **Custom (user-created) themes MUST NOT be modified or removed** — consistent with feature 014, and with feature 010's reset-everything, which rewrites only shipped theme names. The **active-theme selection is itself a setting** and IS therefore reset: a user sitting on a custom theme is returned to the shipped default theme, with their custom theme still present and re-selectable.
- **FR-005b**: Reset All Preferences MUST **NOT** touch the app's other persisted state — the **project list, window layout and workspace state** — nor **custom themes** (FR-005a). Its blast radius is exactly the three configuration kinds in feature 010's record.
- **FR-006**: Reset All Preferences MUST require an explicit **confirmation** before anything changes, and MUST be **all-or-nothing**: if it cannot complete (locked/unwritable file), it fails as a whole with a clear message and nothing is partially reset (delegating atomicity to feature 010). The confirmation MUST state **both sides of the blast radius** — what **is** reset (settings, key bindings, built-in themes) and what **survives** (projects, window layout, workspace state, custom themes) — so the destructive action is truthful in both directions. It MUST reuse the preferences window's **existing inline confirmation strip** (the same surface the per-tab reset and Revert All Preferences already use). Unifying the app's notice surfaces — the inline strip, feature 014's modal dialog and feature 011's error panels — is **deferred to issue #48** and is explicitly **out of scope** here.
- **FR-006a**: A reset that **cannot be written** (locked or unwritable configuration) MUST be surfaced as a **dismissable notice in the preferences window's inline notice strip**. The message MUST name the failed operation and state that **nothing was changed** — for the global reset this is the user-visible proof of feature 010's all-or-nothing guarantee. A failed reset MUST NOT fail silently.
- **FR-007**: Reset All Preferences MUST **hot-apply** its result across all three configuration kinds and show truthful feedback. On **success** the confirmation closes and every open editor immediately reflects the shipped values (the visible state change IS the success feedback — no toast or banner is added, consistent with FR-004c); on **failure** the notice of FR-006a is shown. Feedback MUST NOT claim success unless the write actually succeeded. Because it and feature 014's themes-only restore both read the same feature-010 record, they MUST never produce conflicting theme values.

#### Completeness, theming & controls

- **FR-008**: Every configurable **setting leaf** and every **key binding** that has a shipped default MUST be individually resettable through these controls, backed by the configuration-editor **completeness test** (constitution v3.11.0), so no resettable item is left without a reset path.
- **FR-009**: The per-item reset affordances (per-binding, per-setting) MUST be **themeable icons carrying a hover title**, taking their icon and colours from theme tokens, per constitution v3.12.0, and MUST be built from feature **014's shared themeable icon-button primitive** rather than a new one. The sole exception is the **decision buttons in the confirmation strip**, which may be text-labelled (their colours still derive from theme tokens).
- **FR-009a**: The reset affordances MUST reuse feature 014's **existing** restore tokens, inheriting its one-vs-all distinction: the **per-item** and **per-tab** resets use the **restore-one** token (`retry`), and the **global** "Reset All Preferences" uses the **restore-all** token (`restoreAll`). Hover titles carry the precise scope. No new token is introduced for any reset.
- **FR-009b**: **Every hard-coded icon graphic in the preferences window** (all of which pre-date constitution v3.12.0) MUST be migrated onto theme tokens — the toolbar's two reset icons, the settings-search **clear** icon, and the chord-pill **remove** glyph — reusing existing tokens where they fit (`destroy` for the chord-pill remove, `dismiss` for the search clear). After this feature no icon in the window is hard-coded.
- **FR-009c**: The **UI⇄JSON mode toggle**, today a text control (`{ }` / `UI`), MUST also become a **themeable glyph**, and so must the **array editor's reorder controls** (today hard-coded `↑` / `↓`). This requires **four new theme tokens** — JSON-editing mode, visual-editing mode, move-up and move-down — each shipped with its **human-readable copy**, so the token-completeness test (constitution v3.11.0) still passes on every bundled theme. Every other affordance reuses an existing token (`retry`, `restoreAll`, `destroy`, `dismiss`, `add`).

  *(Amended 2026-07-12: **five**, not four. FR-016's per-item **revert** needs a token of its own — it sits in the same gutter as reset (`retry`) and clear (`destroy`), so a shared glyph would make the row lie about what the click does. Clear reuses `destroy`; only revert is new.)*

  *(Amended during implementation: the count was originally "exactly two". A guard that scans **every** component in the preferences window — rather than only the files this feature happened to edit — found hard-coded glyphs in the array editor and the font-family pill editor that the narrower reading had missed. The requirement was always "the whole window"; the token count was a consequence of it, so the count moved rather than the requirement.)*
- **FR-010**: This feature MUST consume feature 010's reset API **through feature 014's existing shipped-defaults IPC seam**, extending that seam with the reset-single-binding, reset-single-setting and reset-everything operations. It MUST NOT re-implement the shipped-defaults record, the reset logic, the atomicity guarantees, feature 014's icon-button primitive, its modal confirmation dialog, or its single-theme restore; it provides only the controls and feedback on top.
#### Relationship to feature 007's existing controls

- **FR-011**: Feature 007's per-tab **"Reset to Defaults"** control (which reverts the whole current editor) MUST be **re-pointed at feature 010's authoritative shipped-defaults record**, so the application holds exactly **one** notion of "shipped" rather than a second set of defaults compiled into the editor. It MUST apply to the **Settings and Key Bindings tabs only** and MUST be **hidden on the Themes tab** (today it is merely *disabled* there for custom themes), because feature 014 already offers a restore-to-shipped affordance on every built-in theme row — a per-tab reset there would be a second control performing an identical write. **Feature 014 already re-pointed this control's Themes branch at feature 010's record**; what remains for 015 is hiding it on Themes and re-pointing its **Settings** and **Key Bindings** branches, which still resolve defaults from the editor-compiled set.
- **FR-011b**: The per-tab reset MUST perform its restore **in the main process, from feature 010's record, through the same atomic write path** as every other reset — mirroring how feature 014 added its thin single-theme restore. The renderer MUST NOT compute a defaults document and write it back (that is precisely the drift FR-011a exists to end).
- **FR-011a**: The second, editor-compiled set of defaults that currently backs the per-tab reset MUST be **retired** in favour of feature 010's record, including the built-in-theme test it uses to enable/disable itself. No code path may resolve a "default" from anywhere other than feature 010's shipped record (see SC-009).
- **FR-012**: Feature 007's **"Revert All"** control MUST be left **functionally unchanged** — it remains a **session undo** (restoring every editor to its state when the preferences window was opened), a different concept from resetting to shipped defaults, and it MUST NOT be conflated with the global reset of FR-005. It IS **renamed "Revert All Preferences"** (a **label-only** change), so that every control whose scope is *all preferences* says so.
- **FR-012a**: **Naming rule.** Every control whose scope is **all preferences** MUST say so in its name ("Reset All Preferences", "Revert All Preferences"). Controls with a **narrower** scope MUST NOT claim breadth they do not have: the per-tab reset keeps its narrower name and its hover title MUST name the editor it applies to (e.g. reset the Settings editor / the Key Bindings editor). No control may be named for state it does not touch — in particular, nothing is named "configuration", since projects, layout and workspace state are never reset (FR-005b).
- **FR-012b**: **The naming rule extends to test identifiers.** The session undo currently owns the identifier `prefs-reset-all`, which names a scope it does not have. It MUST be renamed **`prefs-revert-all`**, and the new global reset MUST take **`prefs-reset-preferences`**. No identifier may name a scope its control lacks.
- **FR-013**: After this feature, the preferences window MUST offer a clearly distinguishable matrix of **scopes** (how much is affected) and **actions** (what the affected values become). Labels and hover titles MUST make **both** unambiguous:

  | Scope | Reset — to the shipped default | Revert — to the value on entry | Clear — to empty |
  |---|---|---|---|
  | **One item** | FR-001 / FR-003 | FR-016 | FR-016 / FR-016a |
  | **One editor** (Settings, Key Bindings) | FR-011 | — | — |
  | **All preferences** | FR-005 | FR-012 | — |

  The two columns answer different questions and MUST never be conflated: *reset* asks "what does Throng ship?", *revert* asks "what did I start this session with?". **No two controls may perform the same write** (the Themes tab's restore affordances remain feature 014's).
- **FR-013a**: In the preferences window's **JSON editing mode**, the **per-item reset affordances MUST NOT be shown** — they are row affordances, and in JSON mode the user edits the raw document directly (where removing a key is itself the reset). The **toolbar controls** (per-tab reset, Revert All Preferences, Reset All Preferences) MUST remain available in **both** modes.
- **FR-013b**: A reset invoked while JSON mode is active rewrites the underlying file, so the JSON editor MUST NOT be left showing stale text. It MUST follow the **existing external-change rules already shipped by feature 007**: when the buffer is **clean**, the visible document refreshes to the reset content; when the buffer is **dirty** (unsaved edits), the editor MUST NOT silently overwrite the user's work — it surfaces the existing external-change reload prompt, exactly as it does for any other out-of-band file change. A reset is an external change like any other; this feature introduces no second rule for it.
- **FR-014**: The existing **preferences-reset E2E suite** MUST be brought in line with this feature. Its current assertions contradict it — they assert the per-tab reset is *disabled* on the Themes tab (FR-011 hides it), assert the literal titles "Reset to Defaults" / "Revert All" (FR-012/FR-012a rename), assert each toolbar button contains exactly one inline `<svg>` (FR-009b/FR-009c tokenise them), and reference the old `prefs-reset-all` identifier (FR-012b). Updating that suite is **this feature's work**: contrary to an earlier assumption, feature 014 never touched it.

#### Row affordances — placement and the full action set

*(Added after the first implementation, from review of the running feature — issues **#51** and **#52**. These revise unmerged code rather than following it: see Assumptions.)*

- **FR-015**: **The row's control MUST NOT move.** An affordance becoming applicable or inapplicable MUST NOT shift the control horizontally — the value the user is reading, or the input they are reaching for, must not slide out from under them at the exact moment they change something.

  This is satisfied by rendering **all three** affordances **at all times**, to the **RIGHT of the control**, each **disabled and greyed** while it does not apply. Nothing appears or disappears, so nothing can shift, and the layout is identical on every row of the form.

  Two lesser benefits follow, and they are why this beats the alternative: every action is **discoverable** — a user learns that a revert exists *before* they need it, rather than only after they have already changed something — and no row carries a reserved-but-empty gutter.

  *(Amended 2026-07-12 — issue **#65**, superseding the placement in issue #51. The first implementation rendered the affordances **after** the control and let them come and go, which moved the control; the second put them in a **fixed-width gutter before** it. Both were mechanisms for the same requirement, which has not changed: **the control must not move.** Showing all three, always, is simply a better mechanism than hiding them — it holds the layout still *and* makes the actions discoverable, which reserving empty space never did. The three-action model of FR-016 is untouched.)*

- **FR-015a**: A disabled affordance MUST remain **legible as an affordance** — greyed, not invisible — and MUST carry a hover title explaining **why** it does not currently apply, so the row teaches its own semantics. It MUST take its disabled colour from a **theme token** like every other state (constitution v3.12.0).
- **FR-016**: Each row MUST offer up to **three** per-item actions, mirroring at row granularity the scopes the toolbar already offers globally (FR-013):
  - **Reset** — restore the item's **shipped default** (FR-001 / FR-003). Shown only while the item is **overridden** (FR-004a).
  - **Revert** — restore the item to the value it held **when the preferences window was opened**. This is the per-item form of feature 007's session undo (FR-012) and MUST NOT be conflated with a reset: an item that was *already* overridden on entry, edited, and then reverted returns to **that override** — not to the shipped default. Shown only while the item differs from its on-entry value.
  - **Clear** — **empty** the item's value, where empty is a legitimate value (FR-016a). For a **key binding** this means *remove every binding for this action*: unbound is a valid state for **every** action, so bindings are always clearable, whether or not they ship with chords.

  Each action MUST be its own affordance with its own hover title naming its scope, and MUST follow FR-009's icon rules (a theme token, rendered through feature 014's shared icon-button).
- **FR-016a**: **Clearability MUST be declared, not inferred.** Whether a value may be emptied is a property of the **field**, not of the value it currently holds — a required setting must never become emptiable into an invalid state merely because it happens to be a string today. Field descriptors MUST therefore carry an explicit **clearable** declaration, and the clear affordance MUST appear only where it is declared (plus key bindings, clearable by definition per FR-016).

  A field qualifies when **empty is a valid value for it**: the configuration parser accepts the empty value, and a defined **runtime fallback** supplies behaviour in its absence. A field whose *shipped default* is already empty is the clearest such case (`explorer.excludeGlobs` ships as "exclude nothing"), but it is **not** the only one — the theme's font stack ships **populated** and is still legitimately emptiable, falling back to the app's fallback family (FR-018). The test is the value's validity when empty, never the shape of its default.

  A clearable declaration MUST NOT be able to lie: the completeness test MUST assert that every field declaring it **round-trips an empty value through the tolerant parser without error**. Clearing writes that empty value through the **same atomic path as any other edit** — it is an edit, not a reset.
- **FR-017**: The **Key Bindings editor MUST provide the same typeahead search as the Settings editor**, narrowing the visible actions to those matching any typed word across **action name, description and current chords**. It MUST reuse feature 007's existing shared filter and the same themeable clear affordance (FR-009b) rather than introduce a second implementation of either. The action list is already ~50 entries — 13 of them added by feature 013, with seven more due in feature 016 — and cannot be scanned without one.
- **FR-018**: The theme's **font-family stack MUST be emptiable in full**. The clear action of FR-016 empties it in one step; removing the last remaining family by hand MUST also be permitted; and once empty the editor MUST still offer its add control so a family can be put back. An empty stack is a **valid value** that falls back to the app's fallback family — precisely the "empty default plus fallback" shape FR-016a describes.

#### Row and pill layout *(added 2026-07-12 — issue #65)*

- **FR-019**: **A row's contents MUST NOT overflow or squash when the window is narrow.** Both of the window's repeating multi-value controls fail this today, and for the same reason — they lay their items out on a single unwrapping line:
  - **Key-binding chords** MUST **wrap** onto further lines rather than compressing.
  - **Theme font-family pills** MUST **wrap** rather than squashing their labels (they become unreadable past roughly three families).

  The preferences window is explicitly resizable down to a small size (FR-019 of feature 007 keeps the toolbar affordances alive at minimum size), so "it looks fine maximised" is not a defence.
- **FR-019a**: A key binding MUST render as **one** box containing **both** the chord and its remove control — not a box nested inside a box. The current double border is visual noise that makes a row of three chords read as six objects.
- **FR-019b**: Rows MUST carry **horizontal padding**, and a row's value MUST be **vertically centred** within it (the *unbound* placeholder currently is not). Without the padding, a row-hover highlight runs edge-to-edge and reads as a rendering fault whenever the hover colour differs from the panel behind it.
- **FR-020**: The colour control's **swatch field** MUST take its background, border and font from **theme tokens** like every other control in the window (constitution v3.12.0 / Principle X, and the "no icon or colour is hard-coded" claim of SC-006/SC-014, which this control has been quietly violating).

  Its **popup** MUST NOT be claimed as themed: it is a native `<input type="color">`, and the dialog Chromium renders for it cannot be styled by any means available to the app. Making it themeable requires **replacing the native control with a custom picker**, which is out of scope here and tracked as **issue #64**. This feature themes the half that can be themed and says plainly that the other half is not.
- **FR-021**: The **Themes editor MUST provide the same typeahead** as the Settings and Key Bindings editors (FR-017), narrowing its token rows by **label, description and current value**, and reusing the same shared filter rather than a third implementation. It has by far the most rows of the three tabs — several hundred — so it is the tab that needs it most, and was the only one without it.

### Key Entities

- **Per-item affordance gutter**: the fixed-width column left of every row's control that holds its per-item actions, so the control never moves as they appear and disappear (FR-015).
- **Per-item revert control**: the per-row session undo — restores one item to its on-entry value, which may itself be an override (FR-016). The row-scoped counterpart of "Revert All Preferences".
- **Per-item clear control**: the per-row empty — removes every chord from a key binding, or empties a value declared clearable (FR-016 / FR-016a).
- **Per-binding reset control**: the per-action affordance that restores one action's full shipped chord set (feature 010 reset-single-binding).
- **Per-setting reset control**: the per-leaf affordance that restores one setting leaf by its dotted path (feature 010 reset-single-setting), siblings untouched.
- **Global reset control ("Reset All Preferences")**: the single action calling feature 010's atomic reset-everything across settings, bindings and built-in themes, behind an inline confirmation that names both what is reset and what survives. Projects, window layout, workspace state and custom themes are never touched (FR-005b).
- **Overridden-item indication**: the "modified" state (item differs from its shipped value). It governs when a per-item reset affordance is shown — the affordance *is* the indication (FR-004a).
- **Shipped default**: the authoritative shipped value (from feature 010) that each reset restores; an item without one is not resettable.
- **Session undo ("Revert All Preferences")**: feature 007's existing control restoring every editor to its on-entry state. Distinct from every reset above; semantics retained unchanged, label corrected (FR-012).

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can reset exactly one key binding to its full shipped chord set without altering any other binding in 100% of trials.
- **SC-002**: A user can reset exactly one setting leaf to its shipped value with every sibling leaf unchanged in 100% of trials.
- **SC-003**: Single-item resets are idempotent (a no-op when already at the shipped value) and hot-applied.
- **SC-004**: Reset All Preferences returns settings, key bindings and built-in themes to shipped defaults in one atomic operation, and a locked-file scenario leaves 100% of preferences unchanged.
- **SC-005**: Every setting leaf and key binding that has a shipped default is individually resettable (completeness test passes).
- **SC-006**: Every reset affordance renders through the shared themeable icon-button with a hover title naming its action, and takes its glyph and colours from theme tokens on every bundled theme — no affordance carries a hardcoded colour or inline graphic (only the confirmation strip's decision buttons are text-labelled, per the constitution's dialog-decision exception).
- **SC-007**: After a reset, the affected editor reflects the shipped value immediately, and the item's "modified" indication clears (its reset affordance disappears).
- **SC-008**: A user can reach the global reset from any preferences tab without switching tabs, and can tell the four scopes apart — one item, one editor, all preferences, session undo — from their labels and hover titles alone. No control is named for state it does not touch (FR-012a).
- **SC-009**: The application exposes exactly **one** notion of "shipped default": the per-tab reset and the global reset both restore values identical to feature 010's record in 100% of trials, and no code path resolves a default from anywhere else.
- **SC-010**: Reset All Preferences leaves 100% of **custom** themes intact while restoring every built-in theme.
- **SC-015**: Reset All Preferences leaves 100% of **projects, window layout and workspace state** intact, and its confirmation states both what is reset and what survives before the user commits.
- **SC-011**: No control duplicates another control's write, and the reset affordances use **one** themeable icon-button primitive (feature 014's). *(This feature deliberately does **not** unify the app's confirmation/notice surfaces — the inline strip and feature 014's modal dialog coexist until issue #48.)*
- **SC-012**: A reset that cannot be written never fails silently: 100% of write failures produce a dismissable message that names the operation and states nothing was changed — and the configuration is indeed unchanged.
- **SC-013**: A binding whose chords have merely been reordered or recapitalised is never reported as modified, so no reset affordance is offered that would produce no visible change.
- **SC-016**: A row's control **never moves**. All three affordances are present on every row at all times, right of the control, greyed and disabled while inapplicable — so an item becoming overridden, changed or empty changes **no** row's geometry, in 100% of trials. Every action is visible before it is needed, not only after.
- **SC-021**: At the preferences window's **minimum size**, no row's contents overflow or squash: key-binding chords wrap onto further lines, and a font stack of six families wraps rather than compressing its labels into illegibility.
- **SC-022**: A key binding renders as **one** box (chord + remove), not two nested boxes; rows carry horizontal padding, so a hover highlight never runs edge-to-edge; and *unbound* is vertically centred like every other row value.
- **SC-023**: The colour control's **swatch** takes its background, border and font from theme tokens on every bundled theme — no hard-coded colour survives in the preferences window. The native **popup** is documented as un-themeable and tracked (#64), not claimed as done.
- **SC-024**: All **three** editor tabs narrow their rows as the user types, through the **same** shared filter — one implementation in the codebase, not three.
- **SC-017**: A user can, on a single row, reset an item to its shipped default, revert it to the value the window opened with, and — where the value is clearable — empty it, and can tell the three apart from their icons and hover titles alone. Reverting an item that was **already overridden on entry** returns it to that override, not to the shipped default.
- **SC-018**: Every key binding can be cleared to unbound in one action, and every field **declared** clearable can be emptied; no field that is not declared clearable offers a clear affordance, in 100% of trials.
- **SC-019**: The Key Bindings editor narrows to matching actions as the user types — matching on action name, description and chords — through the **same** filter the Settings editor uses (one implementation in the codebase, not two).
- **SC-020**: The theme's font-family stack can be emptied entirely and re-populated, and an empty stack renders through the fallback family without error.
- **SC-014**: Every icon in the preferences window is themeable — **no** hard-coded icon graphic remains in **any** preferences component (asserted by a guard that discovers the components rather than listing them), and the UI⇄JSON toggle renders a themeable glyph. The feature adds **five** new theme tokens — the two editing-mode glyphs, the two reorder arrows, and the per-item **revert** glyph (FR-009c) — each with copy, and the token-completeness test passes on all bundled themes. The three row actions render as three **distinct** tokens, so no two of them can be mistaken for each other.

---

## Assumptions

- **No verbatim original prompt existed for feature 015.** This specification was reconstructed from feature 010's explicit carve-out (per-binding and per-setting reset controls on top of its single-item reset API) and issue #35. See Clarifications → provenance.
- Feature **010** provides the authoritative shipped-defaults record and the reset API (reset-single-binding; reset-single-setting leaf by dotted path; atomic reset-everything); 015 builds controls on top and does not re-implement it. `Depends on: 010-shipped-defaults`.
- The **Settings and Key Bindings editors already exist** (feature 007) with settings typeahead search, additive multi-chord bindings with deletable pills, and immediate-apply; this feature is the granular-reset delta, not a re-specification of those editors or the preferences window.
- **What feature 007 actually shipped** (corrected during clarification — the earlier "coarse reset all" description was imprecise): a per-tab **"Reset to Defaults"** that reverts the whole current editor using defaults compiled into the app rather than feature 010's record, and a **"Revert All"** that is a **session undo** (restore every editor to its on-entry state), not a defaults reset. 015 re-points the former at feature 010's record (FR-011), leaves the latter alone (FR-012), and adds the per-item resets and the global reset.
- **"Reset everything" belongs here (015)**, as a single atomic call to feature 010's reset-everything across all three configuration kinds, rather than split across surfaces — splitting it (themes in 014, settings/bindings here) would fracture feature 010's all-or-nothing/rollback guarantee. Feature **014** retains a separate, narrower **themes-only** "Restore All Themes to Default"; because both read the same feature-010 record, they never disagree.
- Single-item resets are **low-blast-radius and re-editable**, which is why they apply immediately with no per-item confirmation, consistent with feature 007's model; only the global reset confirms.
- Feature 010's reset operations **exist but are unreachable from any UI today** (they run only at startup for seeding/upgrade), so exposing them to the preferences window is part of this feature's work — done by **extending feature 014's existing shipped-defaults IPC seam**, not by building a second one.
- **Features 014 and 013 are now merged to master** (verified 2026-07-12). 014 is the source of the shared icon-button, the shipped-defaults IPC seam, the `retry`/`restoreAll` tokens and the single-theme restore that 015 consumes (plus a modal confirmation dialog that 015 does not adopt — issue #48). Verification confirms feature 010's `resetEverything` / `resetBinding` / `resetSetting` are **still unreachable from the renderer** — no IPC channel, no preload entry, no typing — so exposing them remains this feature's central work.
- **The preferences-reset E2E suite has NOT been migrated** (an earlier assumption said 014 had done so; it had not). Four of its assertions contradict this feature, so updating it is 015's work (FR-014).
- **No action currently ships unbound.** Feature 013 added 13 new key-binding actions, all with default chords, so FR-004b's empty-shipped-chord-set rule is presently a correctness rule with no live instance — it is covered by unit tests against a synthetic shipped record.
- **Notice surfaces are deliberately left inconsistent for now.** 015 reuses the preferences window's existing inline strip for both its confirmation and its failure notices (FR-006/FR-006a) rather than unifying it with feature 014's modal dialog or feature 011's error panels. Unification is its own piece of work, tracked as **issue #48** (milestone v1.0.0), and doing it here would mean reworking already-implemented feature 014 code mid-flight.
- **This feature adds four new theme tokens** — the JSON-mode and visual-mode glyphs for the UI⇄JSON toggle, and the array editor's move-up / move-down arrows (FR-009c) — each shipped with its human-readable copy so the token-completeness test still passes on all 14 bundled themes. Every reset affordance reuses feature 014's existing `retry` / `restoreAll` tokens (FR-009a), and the window's other hard-coded icons migrate onto existing tokens (`destroy`, `dismiss`, `add` — FR-009b).
- **The row affordance model was widened after the first implementation** (issues **#51**, **#52**, 2026-07-12). 015 first shipped a single per-item **reset** icon rendered *after* the control. Using the running feature established two things the spec had not said: the control must not **move** as affordances come and go, so they belong in a fixed gutter to the **left** (FR-015); and reset alone is not the whole model — a row also needs **revert** (session undo) and, where the value permits it, **clear** (FR-016). Both are folded into this feature rather than filed behind it, because they revise code that is still in an **unmerged** PR: deferring them would mean rewriting the same CSS, JSX and E2E assertions a second time and shipping a preferences window already known to be wrong. The Key Bindings typeahead (FR-017) rides along for the same reason — it is a parity gap in the same window, and the filter it needs already exists in core.
- **The shipped-defaults record version is bumped.** New icon tokens enter the record, and the additive upgrade is gated on that version, so without a bump an existing installation's theme files would never materialise them — the on-disk record drifting from the shipped one, which is exactly the drift SC-009 exists to end.

## Out of Scope

- Feature **010's** non-UI shipped-defaults record, reset logic, and atomicity/rollback guarantees — consumed here, not built.
- **The entire themes surface, which belongs to feature 014**: the themes-only "Restore All Themes to Default", per-theme restore, recreating deleted built-ins, clone/rename/delete of themes — plus its **modal confirmation dialog**, which stays on the themes surface and which 015 neither modifies nor adopts (FR-006, issue #48). 015 **consumes** 014's shared themeable icon-button and its shipped-defaults IPC seam, and builds neither. It owns settings/bindings resets and the cross-cutting global reset only.
- The **base** Settings / Key Bindings editors and the preferences window already shipped by feature 007 (search, pill editing, immediate-apply, JSON⇄UI).
- The **"Enhanced project list"** and file-explorer search roadmap items — unrelated to configuration reset despite the feature's broad name.
- **Unifying the app's confirmation / error / notice surfaces** — feature 007's inline strip, feature 014's modal dialog and feature 011's dismissable error panels — into a single toast-based system. Deferred to **issue #48** (milestone v1.0.0). 015 reuses the existing inline strip as-is.
- **Per-key reset affordances inside the JSON editor.** Per-item resets are UI-mode only (FR-013a).
- **Full app-wide keyboard-only accessibility** (issue #26).

### Deferred from the 2026-07-12 preferences backlog

Raised alongside the changes this feature absorbed (FR-015 – FR-018), and deliberately **not** taken here. None of them blocks feature 016:

- **Slider controls for numeric values, and thousands separators in the displayed (never the stored) value** — issue **#53**. A genuine new control type across both Settings and Themes; it also extends the control vocabulary that feature 016's FR-022a currently calls exhaustive, so whichever of the two lands second must amend that sentence.
- **Making icon packs render app-wide** — issue **#54**. Today only the Preferences → Themes → Icons grid resolves packs at all; everywhere else ignores them, so selecting `throng-svg` changes almost nothing. A real defect, but an icon-rendering one, not a reset one.
- **A single `throng-svg` set with an overridable colour** (rather than black/white variants) — issue **#55**, blocked by #54.
- **Bringing the cog menu and the Key Bindings editor's bespoke context menu onto the shared context-menu provider**, so both inherit the live theme — issue **#56**. The same defect class as this feature's icon-token migration, but a context-menu-architecture fix; fixing the whole class in one PR beats fixing half of it here.
- **Panel and tab header tooltips showing the title being hovered rather than a list of instructions** — issue **#57**.
- **Exposing the per-project hidden-paths list in the Settings editor** — issue **#58**. The data and its plumbing already exist; what does not is any way to *see* or *un-hide* an entry. Surfacing it would introduce the Settings editor's **first project-scoped row**, and with it the questions of how project scope is presented, how it cascades over the global value, and what "reset to default" means for it. That deserves its own spec.

### Deferred from the 2026-07-12 review of the running feature

Three further items, all **app-wide theme architecture** rather than preferences-window work. The line is deliberate: this feature's blast radius is one window, and each of these changes surfaces across the explorer, the menus, the editor and every scrollable pane. Each needs new tokens, shipped values in all 14 bundled themes, copy entries, and the token-completeness test — which is a feature, not a task.

- **`panelSurface` is one token doing five unrelated jobs** — issue **#62**. It backs the Files & Folders pane, dropdown backgrounds, the key-binding row hover, search-box backgrounds and (inconsistently) some buttons. These surfaces are only *coincidentally* the same colour in the bundled themes; they are not the same **thing**, so a theme author who sets it to a good pane colour cannot then fix the hover. The distinct roles need their own tokens. *(This feature fixes the row **padding** that made the problem visible — FR-019b — but not the token, which is not its to fix.)*
- **Scrollbars are unthemed app-wide** — issue **#63**. Every scrollable surface renders the default Chromium scrollbar; the only scrollbar CSS in the app is in `terminal.css`, and that exists for layout, not colour.
- **The colour picker's native popup cannot be themed** — issue **#64**. Making it themeable means replacing `<input type="color">` with a custom picker. This feature themes the **swatch** (FR-020) and states plainly that the popup is not themed, rather than quietly claiming a window that is "fully themeable" when one dialog in it is not.
