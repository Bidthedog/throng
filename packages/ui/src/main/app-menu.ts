/**
 * app-menu — the minimal native application menu (020, FR-003).
 *
 * The bootstrap removed Electron's auto-generated menu bar (`Menu.setApplicationMenu(null)`)
 * because throng draws its own full-width title bar and had no application commands. Feature 020
 * reintroduces exactly one command — **Help → About throng** — the spec-required entry point to the
 * About dialog (FR-003). This is a NATIVE OS menu, so it is exempt from the themeable-icon rule
 * (constitution): its item is a plain OS menu entry, not an in-window action control.
 *
 * The menu carries nothing else: keeping it to the single required item avoids reintroducing the
 * File/Edit/View/Window bar the app deliberately dropped.
 */
import { Menu, type MenuItemConstructorOptions } from 'electron';

/**
 * Build the application menu. `onAbout` is invoked when the user chooses
 * Help → About throng; the caller wires it to open the shared About window.
 */
export function buildAppMenu(onAbout: () => void): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Help',
      role: 'help',
      submenu: [
        {
          label: 'About throng',
          click: () => onAbout(),
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}
