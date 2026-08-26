# Contract: the three new settings

**Feature**: 040 | **Surface**: user settings JSON + the visual Settings editor

A setting is a public interface. Its key, type, default and group are what a user's `settings.json`
and every future migration depend on, so they are pinned here rather than left to the implementation.

---

## `editor.statusBar.showCursorPosition`

| Property | Value |
|---|---|
| Type | `boolean` |
| Default | `true` |
| Group / Subgroup | `Editor` / `Status Bar` |
| Control | toggle |
| Governs | the caret **line** and **column** readouts, and nothing else |

- `false` removes line and column and **leaves the counts** (FR-030, US3 scenario 3).
- Overridden by `editor.showStatusBar = false`, which hides the whole bar (FR-033).

## `editor.statusBar.showCounts`

| Property | Value |
|---|---|
| Type | `boolean` |
| Default | `true` |
| Group / Subgroup | `Editor` / `Status Bar` |
| Control | toggle |
| Governs | selected characters, total characters and total words — **as one** |

- `false` removes **all three** counts and leaves line and column (FR-031, US3 scenario 4).
- There are deliberately **two** toggles for five figures, not five (FR-032). A per-figure toggle set
  is a combinatorial surface nobody asked for.

## `editor.showGutter`

| Property | Value |
|---|---|
| Type | `boolean` |
| Default | `true` |
| Group / Subgroup | `Editor` / *(none — it is not a status-bar setting)* |
| Control | toggle |
| Governs | the line-number gutter in **every** editor surface |

- `false` draws no gutter and the text begins at the panel's left padding (FR-041).
- Applies to **both** call sites — editor panels **and** the standalone editor used by the
  preferences and theme editors (FR-042). One setting, two readers; if only one reads it the two
  surfaces disagree and the bug is invisible until someone opens preferences.
- Takes effect on already-open editors with **no reopen and no restart** (FR-043), and restores with
  **the same line still at the top of the viewport** and the selection unchanged (FR-044 — the
  document position, never the pixel offset, because hiding the gutter re-wraps a wrapped document).
- Hiding the gutter does **not** make the gutter theme tokens inert (FR-045) — 009 FR-010 – FR-014
  still govern them and they remain editable in the Themes editor.

---

## Existing setting — metadata only

### `editor.showStatusBar`

**Key, type, default and control are unchanged.** Two metadata changes only:

1. **Description rewritten** (FR-034). It must name the language control, the wrap toggle, the caret
   position and the character/word counts, and state that hiding the bar hides all of them whatever
   the individual settings say. The current text — *"(language, word-wrap toggle)"* — is an inventory,
   and an inventory is wrong the moment the bar gains anything.
2. **Gains `subgroup: 'Status Bar'`** (FR-037).

**All user-facing copy says "status bar", never "status strip"** (FR-034a), so the prose agrees with
the key name and the group name the user is looking at.

---

## Invariants across all four

- **No key is renamed and no default changes** (FR-039). A key rename silently resets every existing
  `settings.json`, which is a data-loss bug wearing a refactor's clothes.
- **Every key has a descriptor** in the metadata registry (FR-050) — Principle X, enforced by the
  completeness test (007 FR-047), which fails the build for a key without one.
- **Every key is reachable from the visual Settings editor** (FR-053), not only by hand-editing JSON.
- **Every key does something observable** (FR-052), so #108's forthcoming "no inert settings" guard
  has nothing new to find.
- **A pre-existing `settings.json` loads with every value intact** (FR-051).
