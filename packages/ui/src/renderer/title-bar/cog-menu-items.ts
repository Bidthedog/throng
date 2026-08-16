/**
 * The cog menu's items (033 US5, T062b — extracted from `cog-menu.tsx`'s inline `MENU_ITEMS.map`).
 *
 * Extracted so SC-010 can be asserted BELOW E2E: `packages/ui/tests/unit/menu-sections.test.ts`
 * drives every menu builder over a table of fixtures, and a menu that only exists inside a click
 * handler cannot be driven at all. Nothing about what the menu draws changed — no label, no icon,
 * no action, no test identifier (N6, FR-053).
 *
 * **All five items are `application`, therefore ONE section and NO divider.** FR-052 originally
 * asked for the preferences trio to be separated from the diagnostic and About items, which FR-050
 * forbids: a divider is drawn only at a real section boundary, and there is none here. Both FR-052
 * and US5 AS-5 were corrected on 2026-08-15; this is the corrected shape, and it is deliberate
 * rather than an omission.
 */
import type { MenuAction } from '../workspace/context-menu.js';

/** The preferences window's tabs, in the order the cog offers them. */
export type PreferencesTab = 'settings' | 'keybindings' | 'themes';

const PREFERENCES_ITEMS: readonly { tab: PreferencesTab; label: string; icon: string }[] = [
  { tab: 'settings', label: 'Settings', icon: 'settings' },
  { tab: 'keybindings', label: 'Key Bindings', icon: 'keybindings' },
  { tab: 'themes', label: 'Themes', icon: 'themes' },
] as const;

export interface CogMenuActions {
  openPreferences: (tab: PreferencesTab) => void;
  openLogs: () => void;
  openAbout: () => void;
}

export function cogMenuItems(actions: CogMenuActions): MenuAction[] {
  const items: MenuAction[] = PREFERENCES_ITEMS.map((item) => ({
    label: item.label,
    // The identifiers survive the rebuild. `cog-menu-settings` is how roughly ten preferences
    // suites reach the preferences window; renaming them would have made this unification a
    // ten-file test migration (FR-053).
    testId: `cog-menu-${item.tab}`,
    // 023 — each row now carries a glyph naming its DESTINATION (gear / keyboard / palette), so the
    // menu no longer reads as one gear beside three blank rows. They are distinct icons, not the
    // opening gear repeated, so each says which window it opens.
    icon: item.icon,
    section: 'application',
    onClick: () => actions.openPreferences(item.tab),
  }));
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
