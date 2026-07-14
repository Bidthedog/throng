import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ContextMenu, type MenuItem } from './workspace/context-menu.js';
import { useAppSettings } from './config/config-store.js';

/** Options for a menu that is folding a bespoke implementation into this one (018 / FR-013). */
export interface OpenMenuOptions {
  /**
   * Override the menu root's test identifier (default `context-menu`).
   *
   * The cog menu is asserted as `cog-menu` by the title-bar suite, and the Key Bindings menu as
   * `binding-context-menu`. Preserving their identifiers is what lets those menus be REBUILT on this
   * one without a test migration — and a unification that forces a test migration is a unification
   * people quietly decline to do (FR-053).
   */
  testId?: string;
}

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
  testId?: string;
}

interface ContextMenuController {
  /** Open a context menu at a screen position, replacing any menu already open. */
  openMenu(x: number, y: number, items: MenuItem[], options?: OpenMenuOptions): void;
  closeMenu(): void;
  /**
   * Is a menu on screen right now?
   *
   * A control that OPENS a menu needs this to TOGGLE. The provider closes the open menu on any window
   * `pointerdown`, which fires before the opener's own click — so an opener that simply calls
   * `openMenu` on click closes the menu and immediately reopens it, and can never close its own menu.
   * The cog lost exactly that when it moved onto the shared menu.
   */
  isOpen: boolean;
}

const Ctx = createContext<ContextMenuController | null>(null);

/**
 * App-wide context-menu host (FR-036/037). Exactly ONE menu can be open at a time
 * anywhere in the app — opening a new one replaces the previous — and clicking
 * anywhere outside (or Escape) closes it. Components call `useContextMenu()`
 * rather than rendering their own ContextMenu.
 */
export function ContextMenuProvider({ children }: { children: ReactNode }): ReactElement {
  const settings = useAppSettings();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const openMenu = useCallback(
    (x: number, y: number, items: MenuItem[], options?: OpenMenuOptions) => {
      setMenu({ x, y, items, testId: options?.testId });
    },
    [],
  );
  const closeMenu = useCallback(() => setMenu(null), []);
  const value = useMemo<ContextMenuController>(
    () => ({ openMenu, closeMenu, isOpen: menu !== null }),
    [openMenu, closeMenu, menu],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          testId={menu.testId}
          onClose={closeMenu}
          submenuDelayMs={settings.behaviour.submenuHoverMs}
        />
      ) : null}
    </Ctx.Provider>
  );
}

export function useContextMenu(): ContextMenuController {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useContextMenu must be used within a ContextMenuProvider');
  return ctx;
}
