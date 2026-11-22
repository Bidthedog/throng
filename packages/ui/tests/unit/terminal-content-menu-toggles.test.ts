import { describe, expect, it, vi } from 'vitest';
import { terminalContentMenu, type TerminalContentMenuArgs } from '../../src/renderer/terminal/terminal-content-menu.js';

/**
 * 076 FR-005 (constitution VI, "Every panel action is reachable") — each status-bar toggle is also a checkable
 * item in the terminal's content menu, in View & state, so hiding the status bar strands none of them.
 */
const noop = (): void => {};
function args(over: Partial<TerminalContentMenuArgs> = {}): TerminalContentMenuArgs {
  return {
    selection: '',
    startFailure: false,
    actions: { copySelection: noop, paste: noop, redraw: noop, tryAgain: noop, copyDetails: noop, clearPanelType: noop },
    ...over,
  };
}

const ICONS = ['rememberCommand', 'rememberDirectory', 'terminalNotifications'] as const;

function toggles(on: [boolean, boolean, boolean], chord?: string) {
  const flips = [vi.fn(), vi.fn(), vi.fn()];
  const labels = ['Remember the last running command', 'Reopen in the last directory', 'Terminal notifications'];
  return {
    flips,
    list: labels.map((label, i) => ({ label, icon: ICONS[i]!, on: on[i]!, chord: i === 2 ? chord : undefined, toggle: flips[i]! })),
  };
}

describe('the terminal content menu’s toggle items (076 FR-005)', () => {
  it('lists the three, checked as the panel holds them, after Refresh / redraw in View & state', () => {
    const t = toggles([true, false, true], 'Ctrl+Alt+I');
    const items = terminalContentMenu(args({ toggles: t.list }));
    const labels = items.map((i) => i.label);
    const redraw = labels.indexOf('Refresh / redraw terminal');
    expect(labels.slice(redraw + 1, redraw + 4)).toEqual([
      'Remember the last running command',
      'Reopen in the last directory',
      'Terminal notifications',
    ]);
    const rows = items.slice(redraw + 1, redraw + 4);
    expect(rows.map((r) => r.checked)).toEqual([true, false, true]);
    expect(rows.map((r) => r.section)).toEqual(['viewState', 'viewState', 'viewState']);
    expect(rows.map((r) => r.testId)).toEqual([
      'menu-item-Remember the last running command',
      'menu-item-Reopen in the last directory',
      'menu-item-Terminal notifications',
    ]);
    expect(rows[2]!.shortcut).toBe('Ctrl+Alt+I');
  });

  // Maintainer, 2026-11-22: "these menu options need icons. Use the same icons as are used in the terminal status bar,
  // including those that are crossed out if they are disabled."
  it('draws each with its status-bar icon, as a setting toggle that is struck through while off', () => {
    const t = toggles([true, false, true]);
    const rows = terminalContentMenu(args({ toggles: t.list })).filter((i) => i.checked !== undefined);
    expect(rows.map((r) => r.icon)).toEqual([...ICONS]);
    expect(rows.map((r) => r.settingToggle)).toEqual([true, true, true]);
  });

  it('runs the same flip the toggle runs', () => {
    const t = toggles([false, false, false]);
    const items = terminalContentMenu(args({ toggles: t.list }));
    items.find((i) => i.label === 'Reopen in the last directory')!.onClick!();
    expect(t.flips[1]).toHaveBeenCalledTimes(1);
    expect(t.flips[0]).not.toHaveBeenCalled();
  });

  it('keeps them while a start failure is live, ahead of its three commands', () => {
    const t = toggles([false, false, false]);
    const labels = terminalContentMenu(args({ toggles: t.list, startFailure: true })).map((i) => i.label);
    expect(labels).toContain('Terminal notifications');
    expect(labels.indexOf('Terminal notifications')).toBeLessThan(labels.indexOf('Try again'));
  });
});
