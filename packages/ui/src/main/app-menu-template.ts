/**
 * The native application menu's template, per platform (020 FR-003; 070 FR-027, contracts/app-lifecycle-macos.md,
 * research R17). Pure — Electron's types only — so every platform's menu is unit-tested on any host.
 *
 * Windows and Linux keep the single Help → About throng item: throng draws its own title bar there, and the menu
 * carries nothing else.
 *
 * macOS shows a menu bar whatever an app does, so throng gives it the app menu, Edit, Window and Help:
 *  - throng's own command (Settings…) shows its chord but does not register it (`registerAccelerator: false`), so the
 *    keystroke reaches throng's binding layer and a rebinding moves it;
 *  - what macOS owns registers: Hide (Cmd+H), Hide Others (Cmd+Option+H), Quit (Cmd+Q), Minimise (Cmd+M);
 *  - the Edit items are roles with Electron's own accelerators, registered. macOS delivers Cmd+C, Cmd+V, Cmd+X, Cmd+A
 *    and Cmd+Z to a text field only through a registered Edit menu; without one they do nothing in any input, which
 *    is FR-027's "so system text commands work". The renderer still sees each keystroke first, so a throng binding
 *    on one of them (the File Explorer's Cmd+C) acts and stops it there.
 * This is a NATIVE OS menu, exempt from the themeable-icon rule (constitution).
 */
import type { MenuItemConstructorOptions } from 'electron';
import { splitStrokes, type OsName } from '@throng/core';

export interface AppMenuHandlers {
  readonly onAbout: () => void;
  /** Settings… — opens Preferences at its Settings tab (070 FR-027). */
  readonly onSettings: () => void;
  /** `app.settings`'s first chord as a binding token, shown beside Settings…; undefined when unbound. */
  readonly settingsChord?: string;
  /** Install and Uninstall 'throng' command (FR-024a). Absent where the platform cannot install it. */
  readonly commandLine?: { readonly onInstall: () => void; readonly onUninstall: () => void };
}

/** What the app menu shows that can change while throng runs. */
export interface AppMenuInputs {
  readonly os: OsName;
  /** `app.settings`'s first chord as a binding token; undefined when unbound. */
  readonly settingsChord: string | undefined;
  /** Whether the platform can install the `throng` command (the Install and Uninstall items). */
  readonly commandLine: boolean;
}

/**
 * Calls `install` only when the menu would look different (070 FR-027). Every config write broadcasts a payload, and
 * rebuilding the native menu on each one closes a menu the user has open on macOS. Windows and Linux draw a Help-only
 * menu that shows no chord, so a rebinding there changes nothing.
 */
export function appMenuRebuilder(install: (inputs: AppMenuInputs) => void): (inputs: AppMenuInputs) => void {
  let last: string | undefined;
  return (inputs) => {
    const key = JSON.stringify(
      inputs.os === 'macos' ? [inputs.os, inputs.settingsChord ?? null, inputs.commandLine] : [inputs.os],
    );
    if (key === last) return;
    last = key;
    install(inputs);
  };
}

const SEPARATOR: MenuItemConstructorOptions = { type: 'separator' };

/** A binding token's key as Electron's accelerator names it. */
const ACCELERATOR_KEY: Readonly<Record<string, string>> = {
  '+': 'Plus',
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc',
};

const ACCELERATOR_MODIFIER: Readonly<Record<string, string>> = {
  Ctrl: 'Control',
  Shift: 'Shift',
  Alt: 'Alt',
  Meta: 'Command',
};

/**
 * A single-stroke binding token as an Electron accelerator (`Meta+,` → `Command+,`), or undefined for a multi-key
 * chord, which a native menu item cannot show.
 */
export function tokenToAccelerator(token: string): string | undefined {
  const strokes = splitStrokes(token);
  if (!strokes || strokes.length !== 1) return undefined;
  const stroke = strokes[0] as string;
  const key = stroke === '+' || stroke.endsWith('++') ? '+' : stroke.slice(stroke.lastIndexOf('+') + 1);
  const mods = stroke.slice(0, stroke.length - key.length).split('+').filter(Boolean);
  return [...mods.map((m) => ACCELERATOR_MODIFIER[m] ?? m), ACCELERATOR_KEY[key] ?? (key.length === 1 ? key.toUpperCase() : key)].join('+');
}

function helpMenu(h: AppMenuHandlers): MenuItemConstructorOptions {
  return { label: 'Help', role: 'help', submenu: [{ label: 'About throng', click: () => h.onAbout() }] };
}

function macosAppMenu(h: AppMenuHandlers): MenuItemConstructorOptions {
  const accelerator = h.settingsChord === undefined ? undefined : tokenToAccelerator(h.settingsChord);
  const commandLine: MenuItemConstructorOptions[] = h.commandLine
    ? [
        { label: "Install 'throng' command", click: () => h.commandLine?.onInstall() },
        { label: "Uninstall 'throng' command", click: () => h.commandLine?.onUninstall() },
        SEPARATOR,
      ]
    : [];
  return {
    label: 'throng',
    submenu: [
      { label: 'About throng', click: () => h.onAbout() },
      SEPARATOR,
      {
        label: 'Settings…',
        click: () => h.onSettings(),
        ...(accelerator === undefined ? {} : { accelerator, registerAccelerator: false }),
      },
      SEPARATOR,
      ...commandLine,
      { label: 'Hide throng', role: 'hide', accelerator: 'Command+H' },
      { label: 'Hide Others', role: 'hideOthers', accelerator: 'Command+Alt+H' },
      { label: 'Show All', role: 'unhide' },
      SEPARATOR,
      { label: 'Quit throng', role: 'quit', accelerator: 'Command+Q' },
    ],
  };
}

const MACOS_EDIT_MENU: MenuItemConstructorOptions = {
  label: 'Edit',
  // No `editMenu` role on the menu itself: that role builds Electron's own Edit menu and would ignore this submenu.
  submenu: [{ role: 'undo' }, { role: 'redo' }, SEPARATOR, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
};

/** `role: 'window'` makes it the app's Windows menu, so macOS lists the windows and Cmd+` cycles them. */
const MACOS_WINDOW_MENU: MenuItemConstructorOptions = {
  label: 'Window',
  role: 'window',
  submenu: [{ role: 'minimize', accelerator: 'Command+M' }, { role: 'zoom' }, SEPARATOR, { role: 'front' }],
};

export function appMenuTemplate(os: OsName, h: AppMenuHandlers): MenuItemConstructorOptions[] {
  if (os !== 'macos') return [helpMenu(h)];
  return [macosAppMenu(h), MACOS_EDIT_MENU, MACOS_WINDOW_MENU, helpMenu(h)];
}
