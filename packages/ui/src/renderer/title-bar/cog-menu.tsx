import { useRef, type ReactElement } from 'react';

import { Icon } from '../common/icon.js';
import { useContextMenu } from '../context-menu-provider.js';
import type { MenuItem } from '../workspace/context-menu.js';

/**
 * The cog action + its menu (007, FR-005/008/009). Rendered on the **main window only** (the parent
 * gates it with `showCog`). Clicking the cog opens a menu of exactly Settings / Key Bindings /
 * Themes (in that order); choosing one opens the single shared preferences window on that tab.
 *
 * 018 / FR-013 — REBUILT ON THE SHARED MENU. This used to be a bespoke re-implementation: its own
 * markup, its own click-away listener, its own Escape handler, no edge flip, no participation in the
 * single-menu-open invariant, and a GEAR DRAWN AS A HARD-CODED INLINE VECTOR — which the
 * constitution prohibits outright, and which is the whole of issue #56.
 *
 * The inline gear existed for a reason that is worth recording: the theme had no settings glyph, so
 * there was nothing to resolve. 018 adds the `settings` icon token, and the same token now serves the
 * project-settings options icon too. One token, two consumers, no inline artwork.
 *
 * What this component is now: a button that opens the shared menu. Flip/clamp, click-away, Escape,
 * keyboard navigation and the one-menu-at-a-time invariant all come for free, because they are the
 * shared menu's, and there is only one of it.
 */

const MENU_ITEMS = [
  { tab: 'settings', label: 'Settings' },
  { tab: 'keybindings', label: 'Key Bindings' },
  { tab: 'themes', label: 'Themes' },
] as const;

export function CogMenu(): ReactElement {
  const { openMenu, isOpen } = useContextMenu();
  const wasOpen = useRef(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const open = (): void => {
    const r = btnRef.current?.getBoundingClientRect();
    const items: MenuItem[] = MENU_ITEMS.map((item) => ({
      label: item.label,
      // The identifiers survive the rebuild. `cog-menu-settings` is how roughly ten preferences
      // suites reach the preferences window; renaming them would have made this unification a
      // ten-file test migration (FR-053).
      testId: `cog-menu-${item.tab}`,
      // No icon. These three are DESTINATIONS, not actions — and giving all of them the same gear
      // (the icon of the control that opened the menu) would say nothing at all. The shared menu
      // renders icons where an item has one; an item that means nothing by having one goes without.
      onClick: () => window.throng?.openPreferences?.(item.tab),
    }));
    // Anchor under the cog, as a drop-down should be. The shared menu flips and clamps from here, so
    // a cog near the right edge no longer pushes its menu off-screen — which the bespoke one did.
    openMenu(r?.left ?? 0, r?.bottom ?? 0, items, { testId: 'cog-menu' });
  };

  return (
    <div className="cog-menu">
      <button
        ref={btnRef}
        type="button"
        className="title-bar__action cog-menu__button"
        data-testid="title-bar-cog"
        title="Settings menu"
        aria-label="Settings menu"
        aria-haspopup="menu"
        // TOGGLE. The provider closes the open menu on any window `pointerdown` — which fires before
        // this click — so a plain `onClick={open}` closes the menu and instantly reopens it, and the
        // cog can never close its own menu. Remember whether one was open when the press began.
        onPointerDown={() => {
          wasOpen.current = isOpen;
        }}
        onClick={() => {
          if (!wasOpen.current) open();
        }}
      >
        <span data-testid="cog-glyph">
          <Icon token="settings" />
        </span>
      </button>
    </div>
  );
}
