/**
 * The native application menu, per platform (020 FR-003; 070 FR-027, contracts/app-lifecycle-macos.md, research R17).
 *
 * Windows and Linux keep today's Help-only menu. macOS gets the app menu, Edit, Window and Help. throng's own command
 * (Settings…) shows its chord without registering it, so the keystroke reaches throng's binding layer and a rebinding
 * moves it. What macOS itself owns (Hide, Hide Others, Quit, Minimise) registers, and so do the Edit roles: without a
 * registered Edit menu, macOS routes no Cmd+C, Cmd+V, Cmd+X, Cmd+A or Cmd+Z to a text field at all (FR-027's "so system
 * text commands work").
 */
import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { appMenuTemplate, tokenToAccelerator, type AppMenuHandlers } from '../../src/main/app-menu-template.js';

function handlers(overrides: Partial<AppMenuHandlers> = {}): AppMenuHandlers {
  return {
    onAbout: vi.fn(),
    onSettings: vi.fn(),
    settingsChord: 'Meta+,',
    commandLine: { onInstall: vi.fn(), onUninstall: vi.fn() },
    ...overrides,
  };
}

const items = (menu: MenuItemConstructorOptions): MenuItemConstructorOptions[] =>
  (menu.submenu as MenuItemConstructorOptions[]).filter((i) => i.type !== 'separator');

/** Every item, depth-first. */
function all(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return template.flatMap((m) => [m, ...(Array.isArray(m.submenu) ? all(m.submenu) : [])]);
}

/** The accelerators the system registers: those shown and not marked `registerAccelerator: false`. */
const registered = (template: MenuItemConstructorOptions[]): string[] =>
  all(template)
    .filter((i) => i.accelerator !== undefined && i.registerAccelerator !== false)
    .map((i) => String(i.accelerator));

describe('Windows and Linux keep the Help-only menu (020 FR-003, 070 FR-039)', () => {
  it.each(['windows', 'linux'] as const)('%s: Help → About throng, nothing else', (os) => {
    const h = handlers();
    const template = appMenuTemplate(os, h);
    expect(template.map((m) => m.label)).toEqual(['Help']);
    expect(template[0]?.role).toBe('help');
    const [about] = items(template[0] as MenuItemConstructorOptions);
    expect(about?.label).toBe('About throng');
    about?.click?.({} as never, undefined, {} as never);
    expect(h.onAbout).toHaveBeenCalledTimes(1);
    expect(registered(template)).toEqual([]);
  });
});

describe('the macOS menu bar (070 FR-027)', () => {
  const h = handlers();
  const template = appMenuTemplate('macos', h);
  const [app, edit, windowMenu, help] = template as [
    MenuItemConstructorOptions,
    MenuItemConstructorOptions,
    MenuItemConstructorOptions,
    MenuItemConstructorOptions,
  ];

  it('is throng, Edit, Window and Help, in that order', () => {
    expect(template.map((m) => m.label)).toEqual(['throng', 'Edit', 'Window', 'Help']);
    expect(edit.role).toBeUndefined();
    expect(windowMenu.role).toBe('window');
    expect(help.role).toBe('help');
  });

  it('carries About, Settings…, the throng command, Hide, Hide Others, Show All and Quit in the app menu', () => {
    expect(items(app).map((i) => i.label)).toEqual([
      'About throng',
      'Settings…',
      "Install 'throng' command",
      "Uninstall 'throng' command",
      'Hide throng',
      'Hide Others',
      'Show All',
      'Quit throng',
    ]);
    expect(items(app).map((i) => i.role)).toEqual([undefined, undefined, undefined, undefined, 'hide', 'hideOthers', 'unhide', 'quit']);
  });

  it('runs each of throng’s own items through its handler', () => {
    const byLabel = (label: string) => items(app).find((i) => i.label === label);
    byLabel('About throng')?.click?.({} as never, undefined, {} as never);
    byLabel('Settings…')?.click?.({} as never, undefined, {} as never);
    byLabel("Install 'throng' command")?.click?.({} as never, undefined, {} as never);
    byLabel("Uninstall 'throng' command")?.click?.({} as never, undefined, {} as never);
    expect(h.onAbout).toHaveBeenCalledTimes(1);
    expect(h.onSettings).toHaveBeenCalledTimes(1);
    expect(h.commandLine?.onInstall).toHaveBeenCalledTimes(1);
    expect(h.commandLine?.onUninstall).toHaveBeenCalledTimes(1);
  });

  it('shows Settings…’s chord from throng’s own binding without registering it, so a rebinding moves it', () => {
    const settings = items(app).find((i) => i.label === 'Settings…');
    expect(settings?.accelerator).toBe('Command+,');
    expect(settings?.registerAccelerator).toBe(false);
    const rebound = items(appMenuTemplate('macos', handlers({ settingsChord: 'Shift+Meta+P' }))[0] as MenuItemConstructorOptions);
    expect(rebound.find((i) => i.label === 'Settings…')?.accelerator).toBe('Shift+Command+P');
    const unbound = items(appMenuTemplate('macos', handlers({ settingsChord: undefined }))[0] as MenuItemConstructorOptions);
    expect(unbound.find((i) => i.label === 'Settings…')?.accelerator).toBeUndefined();
  });

  it('gives Edit the system text commands and Window the system window commands, as roles', () => {
    expect(items(edit).map((i) => i.role)).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
    expect(items(windowMenu).map((i) => i.role)).toEqual(['minimize', 'zoom', 'front']);
    expect(items(help).map((i) => i.label)).toEqual(['About throng']);
  });

  it('registers only what macOS owns — Cmd+H, Cmd+Option+H, Cmd+Q, Cmd+M — plus the Edit roles', () => {
    expect(registered(template).sort()).toEqual(
      ['Command+H', 'Command+Alt+H', 'Command+Q', 'Command+M'].sort(),
    );
    // The Edit roles carry Electron's own accelerators (none written here), which macOS registers.
    for (const item of items(edit)) {
      expect(item.accelerator, String(item.role)).toBeUndefined();
      expect(item.registerAccelerator, String(item.role)).not.toBe(false);
    }
  });

  it('leaves the throng command out where the platform cannot install it', () => {
    const without = appMenuTemplate('macos', handlers({ commandLine: undefined }));
    expect(items(without[0] as MenuItemConstructorOptions).map((i) => i.label)).not.toContain("Install 'throng' command");
  });
});

describe('tokenToAccelerator', () => {
  it('writes a single-stroke binding token as an Electron accelerator', () => {
    expect(tokenToAccelerator('Meta+,')).toBe('Command+,');
    expect(tokenToAccelerator('Ctrl+Shift+Alt+K')).toBe('Control+Shift+Alt+K');
    expect(tokenToAccelerator('Meta+ArrowUp')).toBe('Command+Up');
    expect(tokenToAccelerator('Alt+Meta++')).toBe('Alt+Command+Plus');
    expect(tokenToAccelerator('F11')).toBe('F11');
  });

  it('has no accelerator for a multi-key chord, which a native menu cannot show', () => {
    expect(tokenToAccelerator('Ctrl+M,M')).toBeUndefined();
  });
});
