import { describe, expect, it } from 'vitest';
import { KEYBINDINGS_METADATA } from '../../src/config/keybindings-metadata.js';
import {
  COMMAND_SCOPES,
  SHIPPED_KEYBINDINGS_BY_PLATFORM,
  WINDOW_HANDLED_ACTIONS,
  type ActionId,
} from '../../src/config/keybindings.js';

/**
 * 076 FR-006 — each terminal status-bar toggle is a command in the Key Bindings editor, with no default chord.
 * Window-handled (research R6), so a chord a user binds is taken ahead of xterm and never reaches the shell.
 */
const COMMANDS: readonly [ActionId, string][] = [
  ['terminal.toggleRememberCommand', 'Remember the last running command'],
  ['terminal.toggleRememberDirectory', 'Reopen in the last directory'],
  ['terminal.toggleNotifications', 'Terminal notifications'],
];

describe('terminal toggle commands (076 FR-006)', () => {
  it.each(COMMANDS)('%s is described in the Terminal group with the toggle’s own label, unbound', (id, label) => {
    const matches = KEYBINDINGS_METADATA.filter((d) => d.key === id);
    expect(matches).toHaveLength(1);
    expect(matches[0].group).toBe('Terminal');
    expect(matches[0].label).toBe(label);
    expect(matches[0].description).toMatch(/Unbound by default\.$/);
  });

  it.each(COMMANDS)('%s ships with no chord on any platform', (id) => {
    for (const [platform, shipped] of Object.entries(SHIPPED_KEYBINDINGS_BY_PLATFORM)) {
      expect(shipped?.bindings[id], `${platform} ${id}`).toEqual([]);
    }
  });

  it.each(COMMANDS)('%s is live in a terminal only, and window-handled', (id) => {
    expect([...COMMAND_SCOPES[id]]).toEqual(['terminal']);
    expect(WINDOW_HANDLED_ACTIONS.has(id)).toBe(true);
  });
});
