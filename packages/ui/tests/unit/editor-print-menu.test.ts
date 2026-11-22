/**
 * Print… on an editor panel's header menu (Principle VI: every panel action has a menu item): drawn on every
 * editor, enabled, showing `editor.print`'s chord, running the panel's print command — and never offered on a
 * terminal.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS, type Keybindings, type Panel } from '@throng/core';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';
import { panelHeaderMenu, type PanelHeaderMenuActions } from '../../src/renderer/workspace/panel-header-menu.js';

const noop = (): void => {};
const actions = (print: () => void): PanelHeaderMenuActions =>
  new Proxy({ print } as unknown as PanelHeaderMenuActions, {
    get: (target, key) => (key in target ? (target as unknown as Record<string, unknown>)[key as string] : noop),
  });

function printRow(kind: string, print = vi.fn(), keybindings: Keybindings = DEFAULT_KEYBINDINGS, filePath?: string): MenuAction | undefined {
  const panel: Panel = { type: 'panel', id: 'p1', originProjectId: 'proj', title: 'Panel', kind };
  return panelHeaderMenu({
    panel,
    panelVerb: 'Destroy',
    keybindings,
    otherTabs: [],
    editor: kind === 'editor' ? { dirty: false, hasFilePath: filePath !== undefined } : null,
    panelFailure: false,
    detach: null,
    actions: actions(print),
  }).find((i) => i.label === 'Print…');
}

describe('Print… on an editor', () => {
  it('is in the header menu, enabled, with editor.print\'s chord, and runs the command', () => {
    const print = vi.fn();
    const row = printRow('editor', print, DEFAULT_KEYBINDINGS, '/proj/a.ts');
    expect(row).toMatchObject({ section: 'navigate', shortcut: 'Ctrl+P', icon: 'print' });
    expect(row?.disabled).toBeFalsy();
    row!.onClick!();
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('is enabled for an untitled document too', () => {
    expect(printRow('editor')?.disabled).toBeFalsy();
  });

  it('shows the chord the user bound, not the preview\'s', () => {
    const keybindings = { ...DEFAULT_KEYBINDINGS, bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'editor.print': ['Ctrl+Shift+Alt+P'] } };
    expect(printRow('editor', vi.fn(), keybindings)?.shortcut).toBe('Ctrl+Shift+Alt+P');
  });

  it('is never offered on a terminal', () => {
    expect(printRow('terminal')).toBeUndefined();
  });
});
