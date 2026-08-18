---
name: throng-renderer-ui
description: Use for the React renderer — panes, tabs, panels and the docking model, the sidebar, title bar, status bars, explorer tree, context menus, notifications, dialogs, theming and icon controls, focus and keyboard scope, and renderer state clients. Triggers include adding or changing any visible UI, "where does this component go", a context menu or menu item, a theme token or icon, drag/tear-off/sub-workspace behaviour, focus or z-order problems, and any change that must satisfy the themeable-icon-control or every-panel-action-has-a-menu-item rules.
---

# throng — React renderer and the docking workspace

React 18.3 + Vite 7, no CSS framework, `packages/ui/src/renderer/`. The renderer talks to Electron
main over preload-exposed IPC and to the daemon only through main.

## The docking model (Principle XI) — get the vocabulary right

- **Pane** — top level. Two by default: the stacked **Sidebar Pane** (Projects + Sub-workspaces
  panels, Sub-workspaces pinned to the bottom) and the **Workspace Pane** (the active project's tab
  group). Plus the File Explorer Pane.
- **Tab** — lives only in the Workspace Pane; each Tab is a split tree of Panels.
- **Panel** — tiled within a Tab, typed (terminal / editor / …) via `core/src/panel-type`. A Panel
  reattaches only to its original project; the main workspace never mixes projects.
- **Sub-workspace** — a torn-off Tab or Panel in its own window; these *may* mix projects. Windows
  form a focus/raise group with independent minimise; closing the main window closes them all.

Layout code: `renderer/workspace/`, `renderer/panes/`, `renderer/sidebar/`, `renderer/title-bar/`,
`renderer/statusbar/`, `renderer/panel-type/`, `renderer/subworkspace-app.tsx`. State clients and
stores: `renderer/state/` (`workspace-store.tsx`, `projects-store.tsx`, `subworkspaces-store.tsx`,
`bridge.ts`, the `*-client.ts` wrappers).

## Rules a UI change must satisfy

- **Themeable icon controls.** Every interactive control that performs an action is an icon from the
  active theme's icon set with a hover title naming the action — not a text label. Icon colours come
  from theme tokens; hardcoded CSS colours and inline SVG are forbidden. The narrow exception is
  dialog decision buttons (confirm / cancel / save-as), whose label *is* the consequence being
  consented to. Use `common/icon.tsx` and `common/icon-button.tsx`; the unit tests
  `icon-tokens-exist`, `icon-call-sites`, `css-variables-defined` and `button-token-exclusion`
  enforce this.
- **Every panel action has a menu item.** Discrete commands and state toggles must appear in the
  Panel's menu; a status bar control or chord is an accelerator over the menu, not a substitute.
  Continuous/navigational input (scroll, find-next, column-select) is exempt but still rebindable.
  The constitution enumerates the known pre-existing gaps — do not add to them.
- **Displayed numbers are digit-grouped** (constitution 4.5.0). Any number the UI renders goes
  through `formatGrouped` from `@throng/core`, and anything read back goes through `parseGrouped` —
  never `toLocaleString` at a call site, never a hand-rolled comma, and never a separator in a value
  that gets stored or crosses IPC. The two are exact inverses *for the active locale*, which is the
  point: a locale that groups with `.` turns `1.024` into a corrupted or rejected number otherwise.
- **Every UI change ships with passing coverage at the lowest layer that can prove it** (Principle
  V). For most renderer work that is a **component test** (`vitest --project component`, jsdom):
  what the component renders, its computed style, focus movement inside it, its keyboard handling,
  its aria attributes. Reach for E2E only when the assertion needs a real window — focus across
  windows, a native menu, OS drag-and-drop, z-order, a sub-workspace. Build or type-check evidence
  alone still does not make a UI change complete.
- Configuration added here must be exposed in the preferences editors — see
  `throng-config-preferences`.

## Things that bite in this renderer

- **Focus and blur.** throng closes menus on blur, so anything that steals focus breaks unrelated
  tests. A spec that opens the preferences window or drives a context menu must be listed in
  `packages/ui/tests/e2e/parallel-plan.json`.
- **react-arborist** drives the explorer tree; its rows re-render and shift under async updates.
  Selecting a row then clicking it again is a known miss-click hazard — assert on the selection
  state, not on coordinates.
- Auto-reveal of the active file can yank the explorer selection mid-test; seed and settle first.
- `common/clamp-to-viewport.ts`, `focus-trap.ts` and `use-hover-suppression.ts` exist because
  floating surfaces, modality and hover previews each had a real defect. Reuse them rather than
  re-deriving.
- Theme is applied through `renderer/theme/theme-provider.tsx` + `tokens.css`; `THRONG_THEME` forces
  one for a test.

## Verifying

`npm run typecheck` covers the renderer through the separate `tsconfig.renderer.json` pass — the
project-references build alone does not. Then the test at the layer that owes the assertion — a
component test for what the component renders and does, an E2E only where a real window is what is
under test. Never claim a UI change works on a type-check alone, and never reach past a component
test to an E2E for something the component test can see.

## Not yours

CodeMirror internals and document state → `throng-editor-documents`. xterm/terminal input →
`throng-terminal-pty`. Settings/keybindings/theme model and the preferences completeness gate →
`throng-config-preferences`. Harness and shard plans → `throng-e2e-harness`.
