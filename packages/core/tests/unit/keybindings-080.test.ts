/**
 * 080 FR-010 — Help: `help.open`, F1, live everywhere except a terminal, so a program running in a
 * terminal (mc, htop, nano) still receives F1 (US2 AC4). No Principle IV exception is needed: the chord
 * is never live where a shell is.
 */
import { describe, expect, it } from 'vitest';
import {
  COMMAND_SCOPES,
  DEFAULT_KEYBINDINGS,
  chordCollisions,
  resolveAction,
  type DispatchScope,
} from '../../src/config/keybindings.js';
import { KEYBINDINGS_METADATA } from '../../src/config/keybindings-metadata.js';

const F1 = { key: 'F1' };

describe('Help (080 FR-010)', () => {
  it('ships F1', () => {
    expect(DEFAULT_KEYBINDINGS.bindings['help.open']).toEqual(['F1']);
  });

  it('is live in every scope but a terminal', () => {
    expect([...COMMAND_SCOPES['help.open']].sort()).toEqual(
      ['editor', 'explorer', 'findInFiles', 'preview', 'projects'].sort(),
    );
  });

  it.each(['editor', 'explorer', 'findInFiles', 'preview', 'projects'] as DispatchScope[])(
    'F1 resolves to Help in %s',
    (scope) => {
      expect(resolveAction(DEFAULT_KEYBINDINGS, F1, scope)).toBe('help.open');
    },
  );

  it('leaves F1 to the program in a terminal', () => {
    expect(resolveAction(DEFAULT_KEYBINDINGS, F1, 'terminal')).toBeNull();
  });

  it('collides with no other default chord', () => {
    const clashes = chordCollisions(DEFAULT_KEYBINDINGS.bindings).filter((c) => JSON.stringify(c).includes('help.open'));
    expect(clashes).toEqual([]);
  });

  it('is described in the Application group as Help', () => {
    const row = KEYBINDINGS_METADATA.find((d) => d.key === 'help.open');
    expect(row?.group).toBe('Application');
    expect(row?.label).toBe('Help');
  });
});
