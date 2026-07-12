# Phase 0 — Research: Granular Reset Controls

No `NEEDS CLARIFICATION` markers entered this phase: the spec carries 22 recorded clarifications, and the sixth session re-verified every claim it makes about feature 014 against the **merged** tree. This document records the decisions that shape the implementation, each grounded in code that exists today.

---

## D1 — Consume feature 010's reset API; write no reset logic

**Decision**: `ShippedDefaultsService.resetBinding(action)`, `.resetSetting(path)` and `.resetEverything()` are used as-is. This feature adds **no** reset logic, no defaults record, and no atomicity handling.

**Rationale**: All three already exist (`packages/ui/src/main/shipped-defaults-service.ts:97, :108, :87`), delegate to the pure `resetBindingValue` / `resetSettingValue` in `@throng/core`, and write through `FileConfigStore.writeFilesAtomic` (stage → rename → rollback). They are already covered by integration tests. Re-implementing any of it would violate FR-010 and Principle VIII (DRY).

The **per-tab** reset (FR-011) has no matching operation on the service, so two **thin** ones are added — `resetSettings()` and `resetKeybindings()` — each writing one document sourced from the shipped record through the same `writeFilesAtomic` path. This is precisely the shape feature 014 used when it needed `restoreTheme(name)`, and it is not "re-implementing reset logic": the values come from feature 010's record and the atomicity is feature 010's.

**Alternatives considered**: A renderer-side "compute the new document and write it whole" path (how feature 007's per-tab reset works today). Rejected: the renderer would have to hold its own copy of the defaults, which is the second source of truth FR-011a exists to eliminate. Sourcing from the record **in main** keeps one authoritative answer.

---

## D2 — Extend feature 014's IPC seam rather than build a second one

**Decision**: Add `resetBinding` / `resetSetting` / `resetEverything` to the **existing** `ConfigManagementDeps.shippedDefaults` interface (`config-write-ipc.ts:96-100`) and register three channels alongside 014's `restoreAllThemes` / `restoreTheme`.

**Rationale**: The seam, its DI wiring (`main.ts` passes `shippedService`, built once in `composition-root.ts`) and its preload block already exist. Widening the interface is a few lines per layer and keeps one composition root (Principle IX). Verification confirmed the three operations are exposed **nowhere** today — no channel, no preload entry, no typing — so there is no partial implementation to reconcile.

**Alternatives considered**: A separate `reset-ipc.ts` module with its own registrar. Rejected as ceremonial indirection (YAGNI): it would duplicate the dependency wiring for the same service.

---

## D3 — The overridden-test is pure, lives in core, and compares chord **sets**

**Decision**: A new `packages/core/src/config/overridden.ts` exposes the predicate used by both tabs. A **setting leaf** is overridden iff `getAtPath(current, path)` differs (deep equality) from `getAtPath(shipped.settings, path)`. A **binding** is overridden iff its **normalized chord set** differs from the shipped set — chords lower-cased and compared as a set, so order and capitalisation are irrelevant.

**Rationale**: FR-004b. Chord order carries no behavioural meaning (a binding fires on any of its chords), so an order-sensitive comparison would mark a JSON-mode reorder as "modified" forever and offer a reset that changes nothing visible. Keeping the predicate pure and in core means it is unit-testable without Electron and shared by both tabs (DRY).

**An action that ships unbound** has an empty shipped chord set — a legitimate shipped value, not an absence — so binding it makes it overridden and resetting clears it back to unbound. Note `resetBindingValue` keys off `bindings[action] === undefined`, so an empty array behaves correctly. Verification found **no shipped-unbound action exists today** (feature 013's 13 new actions all carry default chords), so this is a correctness rule covered by unit tests against a synthetic record rather than a live instance.

**Alternatives considered**: Strict array equality (simpler, but produces the phantom-modified bug above); computing "modified" in each tab (duplicates the rule twice).

---

## D4 — Reset performance needs no optimisation

**Decision**: Run the overridden-test straight, per row, on every render. No memoisation, no precomputed index.

**Rationale**: ~30 setting leaves and ~34 binding actions, each a shallow comparison against a frozen record. This is nanoseconds against a React render that is already doing more work. Adding a cache would be speculative generality (YAGNI, Principle VIII) and would introduce a staleness bug class for no measurable gain.

---

## D5 — Reuse feature 014's `IconButton`; add exactly two theme tokens

**Decision**: Every new affordance renders through `IconButton` (`renderer/common/icon-button.tsx`), which resolves its glyph via `resolveIcon(theme, token)` and requires a hover title (mirrored to `aria-label`). Reset affordances reuse **`retry`** (↻, the restore-one glyph 014 already uses) for per-item and per-tab, and **`restoreAll`** (⎌) for the global reset. The settings-search clear reuses **`dismiss`**; the chord-pill remove reuses **`destroy`**.

Exactly **two new tokens** are added — `editJson` and `editVisual` — for the UI⇄JSON mode toggle, each with a `THEME_TOKEN_COPY` entry so the v3.11.0 completeness test stays green.

**Rationale**: Constitution v3.12.0 mandates themeable icons with hover titles and prohibits inline SVG. The v3.12.0 sync report explicitly recorded `preferences-app.tsx` and `settings-tab.tsx` as known violations to be *remediated by the next change that touches those controls* — this is that change. Reusing 014's tokens inherits its one-vs-all visual distinction, so the toolbar's two reset controls remain tellable apart. The toggle is the only control with no suitable existing token; `fileJson`/`fileCode` were rejected because they mean "a JSON/code **file**" in the explorer tree and re-skinning them would silently change the preferences toolbar.

**Alternatives considered**: A dedicated `reset` token (unnecessary — `retry` already means exactly this); leaving the toggle as text (rejected by the user: every action control should be a themeable glyph).

---

## D6 — Reuse the inline confirmation strip; do not unify the notice surfaces

**Decision**: The global reset confirms through the preferences window's **existing inline strip** (CSS class `prefs-confirm`, `data-testid="prefs-reset-confirm"`), and failures surface as a dismissable notice in that same strip. Feature 014's modal dialog stays on the themes surface, untouched.

**Rationale**: Retiring the inline strip would break the two feature-007 controls that depend on it, and converting 014's dialogs would mean reworking already-merged, already-tested code. The app's three notice surfaces (007's strip, 014's modal, 011's error panels) are a real inconsistency, but a cosmetic one — unifying them is its own piece of work, filed as **issue #48** (v1.0.0) and recorded as a tracked deferral in the plan's Complexity Tracking.

**Alternatives considered**: Adopting 014's modal here (would leave the strip alive anyway, serving the per-tab reset and Revert All — two models regardless, plus churn).

---

## D7 — Correct the misleading identifiers as part of the rename

**Decision**: The session undo, today `data-testid="prefs-reset-all"` titled "Revert All", becomes **`prefs-revert-all`** titled **"Revert All Preferences"**. The new global reset takes **`prefs-reset-preferences`** titled **"Reset All Preferences"**. The per-tab reset's hover title names the editor it applies to.

**Rationale**: FR-012a/FR-012b. `prefs-reset-all` currently names a scope its control does not have — it is a *session undo*, not a reset to shipped defaults — and the new control is the one that genuinely deserves that name. Leaving it would guarantee a permanent misreading. Three existing E2E assertions reference the old id and are updated.

---

## D8 — The existing E2E suite contradicts this feature and is ours to fix

**Decision**: `packages/ui/tests/e2e/preferences-reset.e2e.ts` is updated as part of this feature (FR-014).

**Rationale**: An earlier spec assumption held that feature 014 had already migrated this suite. **That was false** — verification found its last change was feature 007. Four of its current assertions actively contradict this feature: it asserts the per-tab reset is *disabled* on the Themes tab (we hide it), asserts the literal titles "Reset to Defaults" / "Revert All" (both renamed), asserts each toolbar button contains exactly one inline `<svg>` (both become token glyphs), and references `prefs-reset-all` (renamed). These are not incidental test churn — they are the old behaviour, and updating them *is* the Red step for several tasks.

---

## D9 — What "Reset All Preferences" does not touch

**Decision**: The operation resets settings, key bindings and built-in themes. Projects, window layout, workspace state and **custom themes** are untouched, and the confirmation says so explicitly.

**Rationale**: `resetEverything()` writes only `settings.json`, `keybindings.json` and `reservedThemeNames(...)` — so custom themes already survive by construction. The active-theme *selection* is a setting (`appearance.theme`), so it does reset: a user sitting on a custom theme lands back on the shipped default with their theme still on disk and re-selectable. Stating both halves in the confirmation makes the destructive action truthful in both directions and gives E2E something concrete to assert (SC-015).
