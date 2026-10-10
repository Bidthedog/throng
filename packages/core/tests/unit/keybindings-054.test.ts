/**
 * 054 T051, T061 — three new commands (data-model.md "Keybindings", contracts/menus-commands-controls-054.md
 * "Commands"):
 *
 * - `markdown.collapseAllInside` / `markdown.expandAllInside` (FR-013): Markdown surfaces only, unbound.
 * - `panel.toggleMaximise` (FR-071a): `Alt+Shift+Enter`, every panel, window-handled so a focused
 *   terminal never receives it — the Principle IV recorded exception of constitution v5.10.0.
 */
import { describe, expect, it } from 'vitest';
import {
  COMMAND_SCOPES,
  DEFAULT_KEYBINDINGS,
  WINDOW_HANDLED_ACTIONS,
  chordCollisions,
  resolveAction,
  twoStrokeTerminalViolations,
  type ActionId,
  type DispatchScope,
} from '../../src/config/keybindings.js';
import { KEYBINDINGS_METADATA } from '../../src/config/keybindings-metadata.js';

const scopesOf = (action: ActionId): DispatchScope[] => [...COMMAND_SCOPES[action]].sort();
const described = (action: string): boolean => KEYBINDINGS_METADATA.some((d) => d.key === action);

describe('Collapse / Expand All Inside This Section (FR-013)', () => {
  it.each(['markdown.collapseAllInside', 'markdown.expandAllInside'] as ActionId[])(
    '%s is scoped to Markdown editors and previews, ships unbound, and is described',
    (action) => {
      expect(scopesOf(action)).toEqual(['editor', 'preview']);
      expect(DEFAULT_KEYBINDINGS.bindings[action]).toEqual([]);
      expect(described(action)).toBe(true);
    },
  );
});

describe('Maximise / Restore Panel (FR-071, FR-071a)', () => {
  it('ships Alt+Shift+Enter, written in the canonical token order Shift+Alt+Enter', () => {
    expect(DEFAULT_KEYBINDINGS.bindings['panel.toggleMaximise']).toEqual(['Shift+Alt+Enter']);
  });

  it('is live in every panel, a terminal and an editor included', () => {
    const scopes = COMMAND_SCOPES['panel.toggleMaximise'];
    expect(scopes.has('terminal')).toBe(true);
    expect(scopes.has('editor')).toBe(true);
    expect(scopes.has('preview')).toBe(true);
  });

  it('is window-handled, so the dispatcher captures it ahead of xterm', () => {
    expect(WINDOW_HANDLED_ACTIONS.has('panel.toggleMaximise')).toBe(true);
  });

  it('resolves Alt+Shift+Enter in a terminal and an editor, and leaves Shift+Enter and Ctrl+Enter alone there', () => {
    for (const scope of ['terminal', 'editor'] as DispatchScope[]) {
      expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'Enter', alt: true, shift: true }, scope)).toBe(
        'panel.toggleMaximise',
      );
      expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'Enter', shift: true }, scope)).not.toBe('panel.toggleMaximise');
      expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'Enter', ctrl: true }, scope)).not.toBe('panel.toggleMaximise');
    }
  });

  it('is described', () => {
    expect(described('panel.toggleMaximise')).toBe(true);
  });
});

describe('the shipped set stays collision-free (046 FR-021)', () => {
  it('has no chord collision', () => {
    expect(chordCollisions(DEFAULT_KEYBINDINGS.bindings, COMMAND_SCOPES)).toEqual([]);
  });

  it('has no terminal two-stroke violation', () => {
    expect(twoStrokeTerminalViolations(DEFAULT_KEYBINDINGS.bindings, COMMAND_SCOPES)).toEqual([]);
  });
});
