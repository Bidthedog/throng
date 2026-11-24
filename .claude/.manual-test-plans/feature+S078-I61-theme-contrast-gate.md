# Manual test plan: 078 theme contrast gate

Spec: `specs/078-theme-contrast-gate/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Readable text on accent and danger fills | signed off | c23ae5c4a3c7 | 2026-11-24 | |
| MT-02 | WCAG AA mark beside the Themes picker | signed off | c23ae5c4a3c7 | 2026-11-24 | |

## MT-01: Readable text on accent and danger fills

Covers: FR-004, FR-004a, FR-005, FR-005a, FR-005b, FR-005c, FR-006, SC-002, SC-003, #716
Paths: `packages/core/src/config/default-themes/index.ts`, `packages/core/src/config/shipped-defaults.ts`, `packages/core/src/config/theme-quality.ts`

### Steps
1. Start the branch build on your usual config (the one beta2 last ran). Open Preferences → Themes and select **VSCode**.
2. In the main window, right-click a file in the File Explorer and hover a menu row. The highlighted row's text is white on the blue and reads clearly.
3. Hover the rail of a collapsed side pane. The rail turns blue and its title and icons are white.
4. Open the Notifications panel with at least one notice pending (or collapse the right side pane to see its rail count). The count pill reads white on blue.
5. In Preferences → Themes, choose **Restore** (the circular-arrow button). The confirmation's **Restore** button text is white on blue.
6. Repeat steps 2–5 with **English Garden**: the text on the moss green is near-black and reads clearly.
7. Repeat steps 2–5 with **Debian**: the accent is now pink, the count pill stands out from the dark panel, and its text is black.
8. Repeat steps 2–5 with **Gothic** (pale text on the oxblood) and **VI-VIM** (black on the moss green).
9. On **Matrix**, **VI-VIM** and **Gothic**, select a few lines of code in an editor: every token stays readable on the selection, which is darker and closer to the editor background than in beta2.
10. Select **SUBNET**. Clone it, then choose **Delete** on the clone. The confirmation's **Delete** button text is dark blue on the orange and reads clearly. Cancel.
11. Select **throng**, **Light** and **Claude** in turn and hover a menu row in each. Nothing looks different from beta2.

### Negative cases
- The accent colour itself (the blue in VSCode, the moss green in English Garden, the oxblood in Gothic, the moss in VI-VIM) is the same as in beta2. Only the text on it changes. Debian is the exception: its accent turns pink, and the Delete button keeps its crimson.
- A theme you edited yourself that changed the text-on-accent colour keeps your colour after the update.

## MT-02: WCAG AA mark beside the Themes picker

Covers: FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, SC-004, SC-005, SC-006
Paths: `packages/ui/src/renderer/preferences/themes-tab.tsx`, `packages/ui/src/renderer/preferences/theme-conformance.ts`, `packages/ui/src/renderer/preferences/preferences.css`, `packages/core/src/icons/default-set/wcagConformant.svg`, `packages/core/src/config/theme-quality.ts`

### Steps
1. Open Preferences → Themes and open the theme list. Every theme shows its name alone, with nothing after it.
2. Select **throng**. A shield-with-a-tick icon sits just right of the picker. Hovering it shows "Meets WCAG AA contrast".
3. Select **Light**, **SUBNET** and **Matrix**. The shield is there for each and reads clearly against the background.
4. Clone **throng** as "Contrast test". The shield shows.
5. On "Contrast test", set **Text** (under General) to the same colour as the **App Background**. The shield disappears and nothing takes its place. Choose **Revert** on the row: the shield comes back.
6. Switch the icon set to one of your own with a `wcagConformant.svg` override, if you have one. The shield shows your icon.

### Negative cases
- No warning, red colour or crossed-out mark appears for a failing theme of your own.
- Selecting a theme from the list still activates it straight away.
