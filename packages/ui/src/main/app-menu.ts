/**
 * app-menu — the native application menu (020 FR-003; 070 FR-027).
 *
 * The bootstrap removed Electron's auto-generated menu bar (`Menu.setApplicationMenu(null)`) because throng draws its
 * own full-width title bar. Feature 020 reintroduced one command, Help → About throng, and that is still all Windows
 * and Linux carry. macOS always shows a menu bar, so there throng gives it the app, Edit, Window and Help menus. The
 * template, and why each item registers its chord or does not, is in `app-menu-template.ts`.
 */
import { Menu } from 'electron';
import type { OsName } from '@throng/core';
import { appMenuTemplate, type AppMenuHandlers } from './app-menu-template.js';

export type { AppMenuHandlers } from './app-menu-template.js';

/** Build the application menu for `os`; the caller wires each handler (About, Settings…, the throng command). */
export function buildAppMenu(os: OsName, handlers: AppMenuHandlers): Menu {
  return Menu.buildFromTemplate(appMenuTemplate(os, handlers));
}
