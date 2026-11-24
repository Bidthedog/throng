# Manual test plan: Preferences grouping and ranked search (079)

Spec: `specs/079-preferences-grouping-and-search/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Key Bindings search puts the best match first | signed off | 1454b96fe053 | 2026-11-24 | |
| MT-02 | Settings and Themes search rank rows and sections | signed off | 1454b96fe053 | 2026-11-24 | |
| MT-03 | Themes tab nests Syntax, Buttons, File Icons and Callouts | signed off | 1454b96fe053 | 2026-11-24 | |

## MT-01: Key Bindings search puts the best match first

Covers: FR-001, FR-002, FR-004, FR-005, SC-001
Paths: `packages/core/src/config/settings-search.ts`, `packages/ui/src/renderer/preferences/keybindings-tab.tsx`

### Steps
1. Open Preferences (cog menu → **Preferences**) and choose the **Key Bindings** tab.
2. Type `go to line`. **Go To Line** is the first row of the first section.
3. Clear the search with the **×**. Type `line`. The rows whose name *starts* with "Line" come before
   **Go To Line**, and all of them come before any row that matches only in its description.
4. Clear the search and type `zoom in`. **Zoom in** is listed. A binding that holds only "zoom" or only
   "in" is not listed.
5. Clear the search. Every section is back, in its usual order.

### Negative cases
- Typing `zoom zzzz` lists nothing and shows the no-match message. Before this change it listed every zoom binding.
- The search still waits until you stop typing before it filters, and the **×** clears it straight away.

## MT-02: Settings and Themes search rank rows and sections

Covers: FR-003, FR-007, FR-008, FR-009, FR-010, FR-011, SC-002, SC-004
Paths: `packages/core/src/config/settings-search.ts`, `packages/ui/src/renderer/preferences/settings-tab.tsx`, `packages/ui/src/renderer/preferences/themes-tab.tsx`, `packages/ui/src/renderer/preferences/group-descriptors.ts`

### Steps
1. In Preferences → **Settings**, type the full name of a setting, for example `Tab hover-activate delay`. Its section is
   listed first, and that setting is the first row under its own heading.
2. Clear the search and type `terminal`. The Terminal section is listed first. Inside it, rows whose
   *name* contains "terminal" come before rows that only mention it in a description.
3. Clear the search and type `clear remembered`. The Terminal section shows the control that clears the
   remembered startup commands and shell arguments.
4. Switch to **Themes** and type `editor background`. The Editor section is first, and **Editor
   background** is its first row.
5. Clear the search on both tabs. Each tab lists everything in its usual order, as it does on master.

### Negative cases
- A row is never shown under a different section from the one it belongs to.
- A section whose rows all fail to match is hidden, as before.

## MT-03: Themes tab nests Syntax, Buttons, File Icons and Callouts

Covers: FR-013, FR-014, FR-015, FR-016, SC-005, SC-006
Paths: `packages/core/src/config/theme-metadata.ts`, `packages/ui/src/renderer/preferences/themes-tab.tsx`, `packages/ui/src/renderer/preferences/subsection.tsx`

### Steps
1. Open Preferences → **Themes** with the search empty.
2. Expand **Editor**. Its own colours come first, then a **Syntax** subgroup holding the ten syntax
   colours. There is no separate "Editor · Syntax" section.
3. Expand **General**. Its own settings come first, then a **Buttons** subgroup. Inside Buttons are the
   button font and icon-button background, then **Confirm**, **Cancel** and **Destroy** subsections in
   that order.
4. Expand **File Explorer**. A **File Icons** subgroup holds the file icon colours.
5. Expand **Markdown preview**. A **Callouts** subgroup holds the callout colours.
6. Fold and unfold **Buttons** and then **Confirm**. Each folds on its own, without folding its parent.
7. Type `syntax` in the search. The whole Syntax subgroup is listed under Editor.

### Negative cases
- No section heading contains `·`.
- Changing a colour in any of these blocks still applies at once, as before.
