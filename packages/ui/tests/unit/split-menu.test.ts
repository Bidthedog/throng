/**
 * 048 T012 — the shared Split menu builder (R3, contracts/menus-commands-controls.md "The Split item").
 *
 * One builder feeds every surface (header menu, four content menus, the placeholder's menu and the
 * panel's + button), so the four items, their order and their chord display cannot drift apart.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS, type Keybindings } from '@throng/core';
import { splitMenuItems, splitSubmenu } from '../../src/renderer/workspace/split-menu.js';

const DIRECTIONS = ['down', 'up', 'right', 'left'] as const;

function withBinding(action: string, tokens: string[]): Keybindings {
  return { ...DEFAULT_KEYBINDINGS, bindings: { ...DEFAULT_KEYBINDINGS.bindings, [action]: tokens } } as Keybindings;
}

describe('splitMenuItems', () => {
  it('lists Split Down, Split Up, Split Right, Split Left in that order (FR-010)', () => {
    const items = splitMenuItems('p1', DEFAULT_KEYBINDINGS, vi.fn());
    expect(items.map((i) => i.label)).toEqual(['Split Down', 'Split Up', 'Split Right', 'Split Left']);
    for (const item of items) expect(item.section).toBe('create');
  });

  it("shows each command's current chord (FR-010)", () => {
    const items = splitMenuItems('p1', DEFAULT_KEYBINDINGS, vi.fn());
    expect(items.map((i) => i.shortcut)).toEqual([
      'Ctrl+Shift+Alt+End,ArrowDown',
      'Ctrl+Shift+Alt+End,ArrowUp',
      'Ctrl+Shift+Alt+End,ArrowRight',
      'Ctrl+Shift+Alt+End,ArrowLeft',
    ]);
  });

  it('shows a rebound chord and only that one (US2 scenario 3)', () => {
    const kb = withBinding('panel.splitRight', ['Ctrl+K,ArrowRight']);
    const items = splitMenuItems('p1', kb, vi.fn());
    expect(items[2]?.shortcut).toBe('Ctrl+K,ArrowRight');
  });

  it('runs the chosen direction on the named panel', () => {
    const run = vi.fn();
    const items = splitMenuItems('panel-7', DEFAULT_KEYBINDINGS, run);
    DIRECTIONS.forEach((dir, i) => {
      items[i]?.onClick?.();
      expect(run).toHaveBeenLastCalledWith('panel-7', dir);
    });
    expect(run).toHaveBeenCalledTimes(4);
  });
});

describe('splitSubmenu', () => {
  it('is one "Split" row in Create whose children are the four items', () => {
    const row = splitSubmenu('p1', DEFAULT_KEYBINDINGS, vi.fn());
    expect(row.label).toBe('Split');
    expect(row.section).toBe('create');
    expect(row.onClick).toBeUndefined();
    expect(row.submenu?.map((i) => i.label)).toEqual(['Split Down', 'Split Up', 'Split Right', 'Split Left']);
    expect(row.submenu?.map((i) => i.section)).toEqual(['create', 'create', 'create', 'create']);
  });

  it('carries the same chords as the + menu', () => {
    const kb = withBinding('panel.splitLeft', ['Ctrl+K,ArrowLeft']);
    const flat = splitMenuItems('p1', kb, vi.fn()).map((i) => i.shortcut);
    const nested = splitSubmenu('p1', kb, vi.fn()).submenu?.map((i) => i.shortcut);
    expect(nested).toEqual(flat);
  });
});
