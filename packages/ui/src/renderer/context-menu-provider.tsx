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

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

interface ContextMenuController {
  /** Open a context menu at a screen position, replacing any menu already open. */
  openMenu(x: number, y: number, items: MenuItem[]): void;
  closeMenu(): void;
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
  const openMenu = useCallback((x: number, y: number, items: MenuItem[]) => {
    setMenu({ x, y, items });
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);
  const value = useMemo<ContextMenuController>(() => ({ openMenu, closeMenu }), [openMenu, closeMenu]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
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
