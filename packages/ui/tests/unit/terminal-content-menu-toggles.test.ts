import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS, type Panel } from '@throng/core';
import { terminalContentMenu } from '../../src/renderer/terminal/terminal-content-menu.js';
import { panelHeaderMenu, type PanelHeaderMenuArgs } from '../../src/renderer/workspace/panel-header-menu.js';

/**
 * 076 FR-005 (constitution VI, "Every panel action is reachable") — each status-bar toggle is also a checkable
 * item in a menu, so hiding the status bar strands none of them. The v1 review (#732) moved them from the terminal's
 * body menu to its TITLE menu: each is a setting of the panel, not something done to the text under the pointer. The
 * body menu keeps Copy, Paste and Find.
 */
const noop = (): void => {};
const TERMINAL: Panel = { type: 'panel', id: 'p1', originProjectId: 'proj', title: 'bash', kind: 'terminal' };

function title(over: Partial<PanelHeaderMenuArgs> = {}) {
  return panelHeaderMenu({
    panel: TERMINAL,
    panelVerb: 'Destroy',
    keybindings: DEFAULT_KEYBINDINGS,
    otherTabs: [],
    editor: null,
    panelFailure: false,
    detach: null,
    actions: new Proxy({} as PanelHeaderMenuArgs['actions'], { get: () => noop }),
    ...over,
  });
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

describe('the terminal title menu’s toggle items (076 FR-005, v1 review #732)', () => {
  it('lists the three first, checked as the panel holds them, in View & state, each with its chord', () => {
    const t = toggles([true, false, true], 'Ctrl+Alt+I');
    const items = title({ terminalToggles: t.list });
    const rows = items.slice(0, 3);
    expect(rows.map((r) => r.label)).toEqual([
      'Remember the last running command',
      'Reopen in the last directory',
      'Terminal notifications',
    ]);
    expect(rows.map((r) => r.checked)).toEqual([true, false, true]);
    expect(rows.map((r) => r.section)).toEqual(['viewState', 'viewState', 'viewState']);
    expect(rows.map((r) => r.testId)).toEqual([
      'menu-item-Remember the last running command',
      'menu-item-Reopen in the last directory',
      'menu-item-Terminal notifications',
    ]);
    expect(rows[2]!.shortcut).toBe('Ctrl+Alt+I');
    // Their own group, ahead of the panel-level rows: a divider separates them from Split.
    expect(new Set(rows.map((r) => r.group)).size).toBe(1);
    expect(items[3]!.group).not.toBe(rows[0]!.group);
  });

  // Maintainer, 2026-11-22: "these menu options need icons. Use the same icons as are used in the terminal status bar,
  // including those that are crossed out if they are disabled."
  it('draws each with its status-bar icon, as a setting toggle that is struck through while off', () => {
    const t = toggles([true, false, true]);
    const rows = title({ terminalToggles: t.list }).filter((i) => i.checked !== undefined);
    expect(rows.map((r) => r.icon)).toEqual([...ICONS]);
    expect(rows.map((r) => r.settingToggle)).toEqual([true, true, true]);
  });

  it('runs the same flip the toggle runs', () => {
    const t = toggles([false, false, false]);
    title({ terminalToggles: t.list }).find((i) => i.label === 'Reopen in the last directory')!.onClick!();
    expect(t.flips[1]).toHaveBeenCalledTimes(1);
    expect(t.flips[0]).not.toHaveBeenCalled();
  });

  it('keeps them while a start failure is live, ahead of its three commands', () => {
    const t = toggles([false, false, false]);
    const labels = title({ terminalToggles: t.list, panelFailure: true }).map((i) => i.label);
    expect(labels).toContain('Terminal notifications');
    expect(labels).toContain('Try again');
    expect(labels.indexOf('Terminal notifications')).toBeLessThan(labels.indexOf('Try again'));
  });
});

describe('the terminal body menu (v1 review #732)', () => {
  it('is Copy, Paste and Find, with Find’s chord, and runs Find', () => {
    const find = vi.fn();
    const items = terminalContentMenu({ selection: 'ls', findChord: 'Ctrl+F', actions: { copySelection: noop, paste: noop, find } });
    expect(items.map((i) => i.label)).toEqual(['Copy', 'Paste', 'Find']);
    const row = items.find((i) => i.label === 'Find')!;
    expect(row).toMatchObject({ icon: 'search', section: 'content', shortcut: 'Ctrl+F' });
    row.onClick!();
    expect(find).toHaveBeenCalledTimes(1);
  });
});
