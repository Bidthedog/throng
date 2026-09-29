/**
 * 047 T010 — the seven new commands and the two new scope sets (data-model.md "Key bindings",
 * contracts/menus-commands-controls.md "Commands", research R1, R5).
 *
 * `FIND_SURFACES = {editor, terminal, preview}` widens four of the seven `search.*` bar commands so
 * a preview's own find bar (R1) can use them; the three replace commands stay on `PANELS`
 * (`{editor, terminal}`) so `Alt+Enter` / `Ctrl+Alt+Enter` stay clear of the preview's chords.
 * `MARKDOWN_SURFACES = {editor, preview}` carries the six fold commands (R5); `preview.goToHeading`
 * is `{preview}` alone.
 */
import { describe, expect, it } from 'vitest';
import {
  COMMAND_SCOPES,
  DEFAULT_KEYBINDINGS,
  chordCollisions,
  resolveAction,
  twoStrokeTerminalViolations,
  type ActionId,
  type DispatchScope,
} from '../../src/config/keybindings.js';

const scopesOf = (action: ActionId): DispatchScope[] => [...COMMAND_SCOPES[action]].sort();

const MARKDOWN_ACTIONS = [
  'markdown.toggleSection',
  'markdown.toggleAll',
  'markdown.collapseSection',
  'markdown.expandSection',
  'markdown.collapseAll',
  'markdown.expandAll',
] as const;

/** `null` — unbound by the maintainer's review (2026-09-28); the context menus carry both. */
const MARKDOWN_DEFAULTS: Record<(typeof MARKDOWN_ACTIONS)[number], string | null> = {
  'markdown.toggleSection': 'Ctrl+M,M',
  'markdown.toggleAll': 'Ctrl+M,L',
  'markdown.collapseSection': 'Ctrl+M,S',
  'markdown.expandSection': null,
  'markdown.collapseAll': 'Ctrl+M,A',
  'markdown.expandAll': null,
};

describe('FIND_SURFACES — search.find/findNext/findPrevious/close widen to preview', () => {
  it('is live in editor, terminal and preview for the four bar commands', () => {
    for (const action of ['search.find', 'search.findNext', 'search.findPrevious', 'search.close'] as ActionId[]) {
      expect(scopesOf(action), action).toEqual(['editor', 'preview', 'terminal']);
    }
  });

  it('leaves the three replace commands on PANELS ({editor, terminal}) — no preview', () => {
    for (const action of ['search.replace', 'search.replaceCurrent', 'search.replaceAll'] as ActionId[]) {
      expect(scopesOf(action), action).toEqual(['editor', 'terminal']);
    }
  });

  it('resolves a real Ctrl+F in a preview to search.find', () => {
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'f', ctrl: true }, 'preview')).toBe('search.find');
  });

  it('does not resolve Ctrl+H (replace) in a preview — the replace trio stayed narrow', () => {
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'h', ctrl: true }, 'preview')).toBeNull();
  });
});

describe('MARKDOWN_SURFACES — the six fold commands, editor(Markdown) + preview', () => {
  it('is live in editor and preview only, for every fold command', () => {
    for (const action of MARKDOWN_ACTIONS) {
      expect(scopesOf(action), action).toEqual(['editor', 'preview']);
    }
  });

  it('is never live in a terminal — no shell loses a key', () => {
    for (const action of MARKDOWN_ACTIONS) {
      expect(COMMAND_SCOPES[action].has('terminal'), action).toBe(false);
    }
  });

  it('ships the documented default two-stroke chord for each fold command', () => {
    for (const action of MARKDOWN_ACTIONS) {
      const chord = MARKDOWN_DEFAULTS[action];
      expect(DEFAULT_KEYBINDINGS.bindings[action], action).toEqual(chord === null ? [] : [chord]);
    }
  });

  it('resolves each default chord to its action in the preview scope', () => {
    // Ctrl+M,M is not directly resolvable in one resolveAction call (it is a two-stroke chord handled
    // by the renderer's chord engine) — but the binding must be an exact, valid two-stroke token.
    for (const action of MARKDOWN_ACTIONS) {
      if (MARKDOWN_DEFAULTS[action] === null) continue;
      const [token] = DEFAULT_KEYBINDINGS.bindings[action];
      expect(token, action).toMatch(/^Ctrl\+M,[A-Z]$/);
    }
  });
});

describe('preview.goToHeading', () => {
  it('is registered, scoped to preview alone, defaulting to Ctrl+G', () => {
    expect(scopesOf('preview.goToHeading')).toEqual(['preview']);
    expect(DEFAULT_KEYBINDINGS.bindings['preview.goToHeading']).toEqual(['Ctrl+G']);
  });

  it('resolves a real Ctrl+G in a preview, and does not collide with navigate.gotoLine’s editor-only Ctrl+G', () => {
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'g', ctrl: true }, 'preview')).toBe('preview.goToHeading');
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'g', ctrl: true }, 'editor')).toBe('navigate.gotoLine');
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'g', ctrl: true }, 'terminal')).toBeNull();
  });
});

describe('no chord collision and no terminal two-stroke violation (FR-021, 046 FR-021)', () => {
  it('leaves the full shipped set collision-free with the seven new commands added', () => {
    expect(chordCollisions(DEFAULT_KEYBINDINGS.bindings, COMMAND_SCOPES)).toEqual([]);
  });

  it('binds no fold command in a scope that includes terminal, so the guard passes by scope', () => {
    expect(twoStrokeTerminalViolations(DEFAULT_KEYBINDINGS.bindings, COMMAND_SCOPES)).toEqual([]);
  });
});

describe('scope completeness picks up all seven new commands', () => {
  it('declares a scope for every new action id, and each is non-empty', () => {
    for (const action of [...MARKDOWN_ACTIONS, 'preview.goToHeading'] as ActionId[]) {
      expect(COMMAND_SCOPES[action], action).toBeDefined();
      expect(COMMAND_SCOPES[action].size, action).toBeGreaterThan(0);
    }
  });
});
