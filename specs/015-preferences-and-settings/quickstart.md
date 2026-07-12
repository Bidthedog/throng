# Quickstart — Validating Granular Reset Controls

How to prove this feature works end to end. Run from the repository root.

## Prerequisites

```bash
npm install          # workspace deps (once)
npm run build        # @throng/core must be built for the UI to resolve it
```

## The gates (all must be green)

```bash
npm run lint             # ESLint — zero errors (constitution v3.13.0)
npm run typecheck        # tsc --noEmit
npm run test:unit        # includes the new overridden-test predicate
npm run test:integration # includes the three new IPC handlers + the locked-file path
npm run test:contract
npm run test:e2e         # includes the updated preferences-reset suite
```

To run only this feature's E2E while iterating:

```bash
npx playwright test packages/ui/tests/e2e/preferences-reset.e2e.ts
```

## Manual validation

```bash
npm start                # launch the app, then open Preferences (the cog)
```

### US1 — reset one key binding (P1)

1. Go to **Key Bindings**. Note that no row shows a reset icon: nothing is overridden yet.
2. Rebind two or three actions (e.g. `search.find`, `terminal.scrollToTop`).
3. **Expect**: a reset icon (`retry` glyph, hover title naming the action) appears on **exactly** those rows — it is the "modified" cue.
4. Click the reset icon on one of them.
5. **Expect**: that row's chords snap back to the shipped binding **immediately, with no confirmation**; its reset icon **disappears**; the other rebound rows are untouched and still show theirs. The new binding is live at once — no restart.

For an action that ships with **multiple** chords, confirm the **full** shipped set is restored, not one chord.

### US2 — reset one setting (P1)

1. Go to **Settings**. Change two settings under the same section.
2. **Expect**: a reset icon appears on each changed row only.
3. Reset one of them.
4. **Expect**: only that leaf returns to its shipped value; its sibling keeps your value and keeps its icon. The change hot-applies immediately.

### US3 — Reset All Preferences (P2)

1. Customise a setting, a binding, and (in **Themes**) a built-in theme's colour. Create a **custom theme** and select it. Open a project or two and rearrange the layout.
2. Click **Reset All Preferences** in the toolbar (the `restoreAll` glyph — visually distinct from the per-tab reset beside it).
3. **Expect** the confirmation to state **both** halves: what will be reset (settings, key bindings, built-in themes) **and** what will survive (projects, window layout, workspace state, custom themes).
4. Confirm.
5. **Expect**: settings, bindings and the edited built-in theme all return to shipped values in one go; **your custom theme still exists** but is no longer active (the active-theme *setting* was reset like any other); **your projects and layout are exactly as they were**.

### Atomicity (SC-004, SC-012)

Make `settings.json` read-only (or hold it open in an exclusive lock) and invoke **Reset All Preferences**.

**Expect**: the operation fails **as a whole**. A dismissable notice names the operation and states that **nothing was changed** — and indeed *no* file changed, not even the ones that were writable. That is feature 010's rollback, made visible.

### The four scopes are distinguishable (SC-008)

Hover each control and confirm the titles say exactly what each does, with no two performing the same write:

| Control | Scope |
|---|---|
| Row reset icon | one setting leaf / one action |
| **Reset to Defaults** (per-tab) | the current editor — Settings or Key Bindings only; **hidden on Themes** (feature 014 restores themes per-row) |
| **Reset All Preferences** | settings + bindings + built-in themes, atomically |
| **Revert All Preferences** | undoes *this session's* edits (back to how the window opened) — not a defaults reset |

### Theming (SC-006, SC-014)

Switch through several bundled themes and confirm **every** icon in the preferences window re-skins — including the UI⇄JSON toggle, the settings-search clear, and the chord-pill remove. No hard-coded graphic should remain.

## Idempotence

Reset an item that is already at its shipped value, and invoke **Reset All Preferences** on a pristine config. Both are no-ops that report success and change nothing.

## References

- Contract: [contracts/reset-ipc.md](./contracts/reset-ipc.md)
- Entities and the overridden-test: [data-model.md](./data-model.md)
- Decisions: [research.md](./research.md)

---

## Amendment 2026-07-12 — the row affordances (FR-015 – FR-018)

### The gutter never moves the control (SC-016)

1. Open **Preferences → Settings**. Look at the empty column between each label and its control.
2. Change any setting. A reset icon appears **in that column, to the left of the control**.
3. **The control must not move.** If the input shifts sideways as the icon appears, FR-015 is
   broken — that is precisely the failure this amendment exists to fix.

### Reset and revert are different actions (SC-017)

The case to test is the one that makes them different — an override that was already there when
you opened the window.

1. Close Preferences. Edit `settings.json` by hand: set `editor.autoSaveDebounceMs` to `900`.
2. Open **Preferences → Settings** and find *Auto-save debounce*. It shows `900`, and it offers a
   **reset** (it is overridden) but **no revert** (it has not changed this session).
3. Type `1500`. Now it offers **both**.
4. Click **revert**. It must return to **900** — the value you opened the window with. If it goes
   to the shipped default instead, the two predicates have been collapsed and your override has
   been silently destroyed.
5. Now click **reset**. It goes to the shipped default — and a **revert** appears, because that is
   a change from where the session started. Click it: you get your `900` back. A mis-clicked reset
   is undoable.

### Clear (SC-018, SC-020)

- **Key Bindings**: every action offers a **clear** — unbound is a valid state for all of them.
  Clear one; the row reads *unbound* and the clear affordance goes (clearing an empty value would
  be a no-op). **Reset** then restores the **full** shipped chord set, not just one chord.
- **Themes → Fonts**: the font stack offers a **clear** even though it ships populated. Clear it;
  every pill goes, the add box remains usable, and the app falls back to its fallback family. Add
  a family back and the clear affordance returns.
- A setting that is *required* offers **no** clear at all. `appearance.theme` is the one to check:
  it must not be emptiable.

### The Key Bindings typeahead (SC-019)

Open **Preferences → Key Bindings**. There is now a search box, as on Settings. It narrows by
action name, by description **and by chord** — type `Ctrl+` and you find the actions bound to it,
which is how you actually answer "what is this key already doing?".
