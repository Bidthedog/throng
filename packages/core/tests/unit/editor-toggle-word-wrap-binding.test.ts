import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYBINDINGS,
  resolveAction,
  COMMAND_SCOPES,
  isValidTwoStrokeToken,
  twoStrokeTerminalViolations,
} from '../../src/config/keybindings.js';
import { KEYBINDINGS_METADATA } from '../../src/config/keybindings-metadata.js';

/**
 * US1 / FR-003b (spec 024), RE-PINNED by 046 iterate round 1 (T097, FR-091/FR-092, FR-102 *changes*
 * row): `Ctrl+Alt+W` moves to the Ctrl+Shift+Alt navigation tier and is no longer free, so the
 * word-wrap toggle becomes the two-stroke chord `Ctrl+E W` — Constitution IV's reserved-prefix
 * exception for exactly this. Editor scope only; still does not reach a terminal.
 */
describe('editor.toggleWordWrap keybinding (024 US1, 046 FR-091/FR-092)', () => {
  it('is bound to the two-stroke chord Ctrl+E,W (re-pinned for FR-124)', () => {
    expect(DEFAULT_KEYBINDINGS.bindings['editor.toggleWordWrap']).toEqual(['Ctrl+E,W']);
  });

  it('is a valid two-stroke token — a modifier on the first stroke, bare on the second', () => {
    expect(isValidTwoStrokeToken('Ctrl+E,W')).toBe(true);
  });

  it('is live in the editor scope, not the terminal', () => {
    const scopes = COMMAND_SCOPES['editor.toggleWordWrap'];
    expect(scopes.has('editor')).toBe(true);
    expect(scopes.has('terminal')).toBe(false);
    expect(scopes.has('explorer')).toBe(false);
  });

  it('carries no terminal-scope violation (FR-092 forbids a two-stroke chord live in a terminal)', () => {
    const violation = twoStrokeTerminalViolations(DEFAULT_KEYBINDINGS.bindings).find(
      (v) => v.action === 'editor.toggleWordWrap',
    );
    expect(violation).toBeUndefined();
  });

  it('the first stroke alone does not resolve the command — a single keydown is not the whole chord', () => {
    const firstStroke = { key: 'E', ctrl: true };
    expect(resolveAction(DEFAULT_KEYBINDINGS, firstStroke, 'editor')).toBeNull();
    expect(resolveAction(DEFAULT_KEYBINDINGS, firstStroke, 'terminal')).toBeNull();
  });

  it('has a keybindings-metadata descriptor (completeness gate)', () => {
    const d = KEYBINDINGS_METADATA.find((m) => m.key === 'editor.toggleWordWrap');
    expect(d).toBeDefined();
    expect(d?.group).toBe('Editor');
  });
});
