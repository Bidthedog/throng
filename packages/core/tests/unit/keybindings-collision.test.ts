/**
 * Chord collisions are SCOPE-AWARE (016, FR-017b1).
 *
 * Two commands clash iff their scope sets INTERSECT on a chord. `editor.cutLine` ({editor}) and
 * `file.cut` ({explorer}) therefore share `Ctrl+X` legitimately — that coexistence is the headline
 * proof the design works, and a flat uniqueness rule would forbid it.
 *
 * The check is ENUMERATED FROM THE REGISTRY, never from a hand-listed set of features: a hand list
 * silently stops covering the command added after it was written.
 */
import { describe, expect, it } from 'vitest';
import {
  COMMAND_SCOPES,
  DEFAULT_KEYBINDINGS,
  chordCollisions,
  type ActionId,
} from '../../src/config/keybindings.js';

describe('chordCollisions (FR-017b1)', () => {
  it('reports NOTHING for the shipped defaults — they are a legal set', () => {
    expect(chordCollisions(DEFAULT_KEYBINDINGS.bindings, COMMAND_SCOPES)).toEqual([]);
  });

  it('lets editor.cutLine and file.cut share Ctrl+X — disjoint scopes are not a clash', () => {
    const bindings = { 'editor.cutLine': ['Ctrl+X'], 'file.cut': ['Ctrl+X'] };
    const scopes = {
      'editor.cutLine': new Set(['editor'] as const),
      'file.cut': new Set(['explorer'] as const),
    } as unknown as typeof COMMAND_SCOPES;
    expect(chordCollisions(bindings, scopes)).toEqual([]);
  });

  it('reports a clash when the scope sets INTERSECT', () => {
    const bindings = { 'editor.cutLine': ['Ctrl+X'], 'editor.indentLines': ['Ctrl+X'] };
    const scopes = {
      'editor.cutLine': new Set(['editor'] as const),
      'editor.indentLines': new Set(['editor'] as const),
    } as unknown as typeof COMMAND_SCOPES;
    const clashes = chordCollisions(bindings, scopes);
    expect(clashes).toHaveLength(1);
    expect(clashes[0].token).toBe('Ctrl+X');
    expect([...clashes[0].actions].sort()).toEqual(['editor.cutLine', 'editor.indentLines']);
  });

  it('reports a clash on a PARTIAL scope overlap — one shared context is enough', () => {
    const bindings = { 'search.find': ['Ctrl+F'], 'editor.cutLine': ['Ctrl+F'] };
    const scopes = {
      'search.find': new Set(['editor', 'terminal'] as const),
      'editor.cutLine': new Set(['editor'] as const),
    } as unknown as typeof COMMAND_SCOPES;
    expect(chordCollisions(bindings, scopes)).toHaveLength(1);
  });

  it('compares chords case-insensitively, as resolution does', () => {
    const bindings = { 'editor.cutLine': ['Ctrl+x'], 'editor.indentLines': ['Ctrl+X'] };
    const scopes = {
      'editor.cutLine': new Set(['editor'] as const),
      'editor.indentLines': new Set(['editor'] as const),
    } as unknown as typeof COMMAND_SCOPES;
    expect(chordCollisions(bindings, scopes)).toHaveLength(1);
  });

  it('enumerates from the registry — every shipped command is covered, not a chosen few', () => {
    const covered = new Set(Object.keys(COMMAND_SCOPES));
    for (const action of Object.keys(DEFAULT_KEYBINDINGS.bindings) as ActionId[]) {
      expect(covered.has(action), `"${action}" is not enumerated by the collision check`).toBe(true);
    }
  });
});
