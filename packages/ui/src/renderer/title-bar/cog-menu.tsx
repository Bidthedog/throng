import { useRef, type ReactElement } from 'react';

import { Icon } from '../common/icon.js';
import { useContextMenu } from '../context-menu-provider.js';
import { cogMenuItems } from './cog-menu-items.js';

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

export function CogMenu(): ReactElement {
  const { openMenu, isOpen } = useContextMenu();
  const wasOpen = useRef(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const open = (): void => {
    const r = btnRef.current?.getBoundingClientRect();
    // 033 US5 (T062b) — the items live in `cog-menu-items.ts` so the unit table can drive them.
    // All five are Application, so this menu has one section and draws no divider.
    const items = cogMenuItems({
      openPreferences: (tab) => window.throng?.openPreferences?.(tab),
      openLogs: () => void window.throng?.diagnostics?.openLogs?.(),
      openAbout: () => window.throng?.about?.open?.(),
    });
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
