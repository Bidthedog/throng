/**
 * The cog menu's items (033 US5, T062b — extracted from `cog-menu.tsx`'s inline `MENU_ITEMS.map`).
 *
 * Extracted so SC-010 can be asserted BELOW E2E: `packages/ui/tests/unit/menu-sections.test.ts`
 * drives every menu builder over a table of fixtures, and a menu that only exists inside a click
 * handler cannot be driven at all. Nothing about what the menu draws changed — no label, no icon,
 * no action, no test identifier (N6, FR-053).
 *
 * **The five preferences/diagnostic/about items are all `application`** — one section, no internal
 * divider. FR-052 originally asked for the preferences trio to be separated from the diagnostic and
 * About items, which FR-050 forbids: a divider is drawn only at a real section boundary, and there
 * is none here. Both FR-052 and US5 AS-5 were corrected on 2026-08-15; this is the corrected shape,
 * and it is deliberate rather than an omission.
 *
 * **046 iterate round 1 (FR-074, FR-107) RETIRED the `navigate` section US2 (FR-019) had added** —
 * Next/Previous Project and the two Focus rows drop out of this menu entirely; they keep their
 * chords (Ctrl+Shift+Alt+PageDown/PageUp/F/P), listed only in the Key Bindings editor's Focus &
 * Zoom group (constitution VI amendment: a shortcut may exist with no menu item). Round 1 replaced
 * it with a `viewState` Zoom row acting on the WINDOW zoom.
 *
 * **046 iterate round 2 (FR-113) REMOVES that Zoom row** — the maintainer's own words, mid-build:
 * "Remove the new 'Zoom' options from the menu." The cog is back to its single `application`
 * section, exactly as it was before round 1 touched it. Zoom stays reachable from the keyboard
 * (`zoom.in` / `zoom.out` / `zoom.reset`) and from the panel header's own Zoom submenu
 * (`panel.zoomIn` / `panel.zoomOut` / `panel.zoomReset`); it simply has no cog-menu mouse route.
 */
import type { Keybindings } from '@throng/core';
import type { MenuAction } from '../workspace/context-menu.js';
/*
 * IMPORTED, not re-declared (Principle VIII). The extraction from `cog-menu.tsx` first wrote
 * `'settings' | 'keybindings' | 'themes'` out again here, which made three copies of one union in
 * the renderer alone — this one, `preferences/preferences-app.tsx`'s, and the inline pair in
 * `renderer/global.d.ts`. A fourth lives in `main/preferences-window.ts`, on the far side of the
 * process boundary and out of this module's reach.
 *
 * The preferences app OWNS the set: it is what renders the tabs and what `isPreferencesTab` guards.
 * A type-only import is erased at build time, so nothing of that module reaches the title bar's
 * bundle — only the obligation that a fourth tab is added in one place, not two.
 */
import type { PreferencesTab } from '../preferences/preferences-app.js';

const PREFERENCES_ITEMS: readonly { tab: PreferencesTab; label: string; icon: string }[] = [
  { tab: 'settings', label: 'Settings', icon: 'settings' },
  { tab: 'keybindings', label: 'Key Bindings', icon: 'keybindings' },
  { tab: 'themes', label: 'Themes', icon: 'themes' },
] as const;

export interface CogMenuActions {
  openPreferences: (tab: PreferencesTab) => void;
  openLogs: () => void;
  openAbout: () => void;
  /**
   * The live keybindings. 046 iterate round 2 (FR-113) removed this builder's only reader of it (the
   * Zoom row's `controlTitle` hover text); kept on the interface rather than pulled, since
   * `cog-menu.tsx` and every fixture that builds `CogMenuActions` still supply one and removing the
   * field would be churn with no other benefit.
   */
  keybindings: Keybindings;
}

export function cogMenuItems(actions: CogMenuActions): MenuAction[] {
  const items: MenuAction[] = [
    ...PREFERENCES_ITEMS.map(
      (item): MenuAction => ({
        label: item.label,
        // The identifiers survive the rebuild. `cog-menu-settings` is how roughly ten preferences
        // suites reach the preferences window; renaming them would have made this unification a
        // ten-file test migration (FR-053).
        testId: `cog-menu-${item.tab}`,
        // 023 — each row now carries a glyph naming its DESTINATION (gear / keyboard / palette), so
        // the menu no longer reads as one gear beside three blank rows. They are distinct icons, not
        // the opening gear repeated, so each says which window it opens.
        icon: item.icon,
        section: 'application',
        onClick: () => actions.openPreferences(item.tab),
      }),
    ),
  ];
  // About throng (020, FR-003) — the discoverable entry point to the About window. It lives here,
  // not on a native menu bar: throng draws its own title bar (`frame: false`), so the native
  // application menu never appears on screen. Its circled-information glyph reads as "about".
  // #123 — the way a user reaches their diagnostics. It sits beside About deliberately: both are
  // things you go looking for when reporting a problem, and neither belongs in preferences.
  items.push({
    label: 'Open Logs Folder',
    testId: 'cog-menu-logs',
    icon: 'folderOpen',
    section: 'application',
    onClick: () => actions.openLogs(),
  });
  items.push({
    label: 'About throng',
    testId: 'cog-menu-about',
    icon: 'about',
    section: 'application',
    onClick: () => actions.openAbout(),
  });
  return items;
}
