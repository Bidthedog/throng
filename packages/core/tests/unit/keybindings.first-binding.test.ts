/**
 * US1 (#125) — the first bound chord for a command, which context menus render in brackets.
 */
import { describe, it, expect } from 'vitest';
import { firstBinding, type Keybindings } from '../../src/config/keybindings.js';

const kb = (bindings: Record<string, string[]>): Keybindings => ({ version: 1, bindings });

describe('firstBinding', () => {
  it('returns the first chord token for a bound command', () => {
    expect(firstBinding(kb({ 'file.copy': ['Ctrl+C', 'Ctrl+Insert'] }), 'file.copy')).toBe('Ctrl+C');
  });

  it('returns undefined for a command with no binding', () => {
    expect(firstBinding(kb({ 'file.copy': ['Ctrl+C'] }), 'file.rename')).toBeUndefined();
  });

  it('returns undefined when the binding list is empty', () => {
    expect(firstBinding(kb({ 'file.rename': [] }), 'file.rename')).toBeUndefined();
  });
});
