# Manual test plan: Fold and unfold Preferences sections (056, #479)

Spec: `specs/056-preferences-folding/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Fold and unfold Settings sections by mouse | signed off | f60829332700 | 2026-10-15 | |
| MT-02 | Fold and unfold from the keyboard | signed off | f60829332700 | 2026-10-15 | |
| MT-03 | Search through folded sections | signed off | f60829332700 | 2026-10-15 | |
| MT-04 | Invalid entry in a folded section | signed off | f60829332700 | 2026-10-15 | |
| MT-05 | Key Bindings and Themes fold the same way | signed off | f85e92b552d9 | 2026-10-15 | |
| MT-06 | Expand All, Collapse All and remembered folds | signed off | f60829332700 | 2026-10-15 | |
| MT-07 | Sections start folded | signed off | f60829332700 | 2026-10-15 | |

## MT-01: Fold and unfold Settings sections by mouse

Covers: FR-001, FR-002, FR-003, FR-006, FR-012, FR-014, SC-001, SC-005
Paths: `packages/ui/src/renderer/preferences/fold-heading.tsx`, `packages/ui/src/renderer/preferences/subsection.tsx`, `packages/ui/src/renderer/preferences/settings-tab.tsx`, `packages/ui/src/renderer/preferences/preferences.css`

### Steps
1. Start throng, click the cog, choose **Settings**, and click **Expand All**. Every section is open; each
   heading shows a chevron pointing down and a count of its settings beside its name.
2. Click the **Editor** heading's name text. Its settings and subsections disappear, the heading stays, its
   chevron points right, and the count is unchanged.
3. Click **Editor** again. Everything returns in the same order.
4. Click the **Previews** subsection heading inside Editor. Only Previews (and its Markdown subsection) hides;
   the rest of Editor stays.
5. Fold **Editor**, then unfold it. **Previews** is still folded.
6. Fold every section except **Terminal**. Terminal's first setting is visible without scrolling.
7. Hover a heading. The tooltip reads "Fold section" (or "Unfold section" when folded); the heading
   highlights like other buttons in the window, in both a dark and a light theme.

### Negative cases
- Clicking a heading never changes any setting value.
- No heading count shows a thousands separator glitch, a blank, or "0" for a section that has settings.

## MT-02: Fold and unfold from the keyboard

Covers: FR-004, FR-005, SC-002
Paths: `packages/ui/src/renderer/preferences/fold-heading.tsx`, `packages/ui/src/renderer/preferences/preferences.css`

### Steps
1. In **Settings**, press Tab until a section heading shows a focus ring.
2. Press Enter. The section folds. Press Space. It unfolds.
3. Fold a section, then press Tab. Focus moves to the next heading or control, never into the folded rows.

### Negative cases
- Pressing Space on a focused heading does not scroll the window.

## MT-03: Search through folded sections

Covers: FR-006, FR-008, FR-009, SC-003, SC-004
Paths: `packages/ui/src/renderer/preferences/use-preference-folds.ts`, `packages/ui/src/renderer/preferences/settings-tab.tsx`, `packages/ui/src/renderer/preferences/group-descriptors.ts`

### Steps
1. Fold **Editor**. Type `wrap` in the search box. Editor reappears unfolded with its matching settings, and
   its count reads like `2 of 34`.
2. Clear the search with the clear icon. Editor is folded again; counts are plain totals.
3. Search `wrap` again, fold a matching section, clear the search, then search `wrap` once more. The section
   shows unfolded.
4. Type one character quickly into the search box while **Editor** is folded. Editor does not flash open
   before the results appear.

### Negative cases
- A section with no match disappears while searching, as it always has.
- Typing only spaces in the search box does not unfold anything or change the counts.

## MT-04: Invalid entry in a folded section

Covers: FR-007
Paths: `packages/ui/src/renderer/preferences/fold-heading.tsx`, `packages/ui/src/renderer/preferences/map-control.tsx`, `packages/ui/src/renderer/preferences/form-controls.tsx`

### Steps
1. In **Settings**, type an out-of-range value into a number setting so it turns red. Fold its section. The
   heading shows a warning marker; hovering it reads "Contains an invalid entry".
2. Unfold the section. Your invalid value is still in the field.
3. Correct the value, then fold the section. No warning marker.

### Negative cases
- Changing a setting to another valid value and folding shows no marker.

## MT-05: Key Bindings and Themes fold the same way

Covers: FR-001, FR-010, FR-013
Paths: `packages/ui/src/renderer/preferences/keybindings-tab.tsx`, `packages/ui/src/renderer/preferences/themes-tab.tsx`, `packages/ui/src/renderer/preferences/icon-section.tsx`

### Steps
1. Open **Key Bindings**. Fold and unfold a group by click and with Enter; its count is its number of bindings.
2. Search a binding name with its group folded. The group shows unfolded with the match.
3. Open **Themes**. Fold a token group and the **Icons** section; both behave like Settings.
4. Fold **Editor** on Themes, then switch to **Settings**. Settings' Editor is unaffected.

### Negative cases
- Folding on one tab never folds anything on another.

## MT-06: Expand All, Collapse All and remembered folds

Covers: FR-011, FR-011a, FR-011b, FR-012
Paths: `packages/ui/src/renderer/preferences/use-preference-folds.ts`, `packages/ui/src/renderer/preferences/preferences-folds.ts`, `packages/ui/src/renderer/preferences/fold-heading.tsx`, `packages/ui/src/renderer/preferences/settings-tab.tsx`, `packages/ui/src/renderer/preferences/keybindings-tab.tsx`, `packages/ui/src/renderer/preferences/themes-tab.tsx`

### Steps
1. Beside each tab's search box are two icons; hovering reads "Expand All Sections" and "Collapse All
   Sections".
2. On **Settings**, click **Collapse All**. Only section headings remain. Click **Expand All**. Everything opens.
3. Expand All on Settings, then fold one subsection. On Key Bindings, unfold one group. Close Preferences,
   quit and restart throng, reopen Preferences. Settings is still expanded with that one subsection folded,
   that Key Bindings group is still open, and Themes shows its sections folded.
4. Type in the search box. Both icons grey out; clear it and they are active again.

### Negative cases
- Expand All or Collapse All on one tab leaves the other two tabs as they were.

## MT-07: Sections start folded

Covers: FR-016, FR-017, FR-018, SC-006, FR-012, FR-011a
Paths: `packages/ui/src/renderer/preferences/use-preference-folds.ts`, `packages/ui/src/renderer/preferences/preferences-folds.ts`, `packages/ui/src/renderer/preferences/settings-tab.tsx`, `packages/ui/src/renderer/preferences/keybindings-tab.tsx`, `packages/ui/src/renderer/preferences/themes-tab.tsx`, `packages/ui/src/renderer/preferences/icon-section.tsx`

### Steps
1. Start throng with a fresh profile (or after clearing folds), open Preferences. **Settings** shows only its
   section headings, each folded with its count.
2. Switch to **Key Bindings**, then **Themes**. Each shows only folded section headings, the **Icons**
   section included.
3. On Settings, unfold **Editor**. Its settings and every subsection (Status Bar, Links, Previews and its
   Markdown subsection) are all open.
4. Unfold **Terminal**. Close Preferences, quit and restart throng, reopen Preferences. Editor and Terminal
   are still open; every other section is folded.

### Negative cases
- No subsection is folded on the first open of a section.
- Searching from the all-folded state shows matches as before; clearing the search returns to folded
  sections.
