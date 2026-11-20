import { describe, expect, it } from 'vitest';
import {
  TERMINAL_PANEL_TOGGLES,
  resolveTerminalToggles,
} from '../../src/terminal/panel-toggles.js';
import { settingToggleTitle } from '../../src/config/setting-toggle.js';
import { ICON_KEYS } from '../../src/icons/icon-keys.js';
import { DEFAULT_ICON_SET } from '../../src/icons/default-icon-set.generated.js';
import { COMMAND_SCOPES } from '../../src/config/keybindings.js';

const DEFAULTS = { rememberCommand: false, rememberDirectory: true, runAsAdmin: false, notifications: true };

describe('the terminal panel toggles (076 FR-001 – FR-003)', () => {
  it('lists the three toggles in FR-001’s order, each with its command, icon and label', () => {
    expect(TERMINAL_PANEL_TOGGLES.map((t) => [t.id, t.command, t.icon, t.label])).toEqual([
      ['rememberCommand', 'terminal.toggleRememberCommand', 'rememberCommand', 'Remember the last running command'],
      ['rememberDirectory', 'terminal.toggleRememberDirectory', 'rememberDirectory', 'Reopen in the last directory'],
      [
        'notifications',
        'terminal.toggleNotifications',
        'terminalNotifications',
        'Terminal notifications',
      ],
    ]);
    expect(Object.isFrozen(TERMINAL_PANEL_TOGGLES)).toBe(true);
    for (const t of TERMINAL_PANEL_TOGGLES) {
      expect(ICON_KEYS).toContain(t.icon);
      expect(COMMAND_SCOPES[t.command], t.command).toBeDefined();
    }
  });

  it('shows the panel’s own value where it holds one (039 FR-005)', () => {
    expect(
      resolveTerminalToggles(
        { rememberCommand: true, rememberDirectory: false, notifications: true },
        DEFAULTS,
      ),
    ).toEqual({ rememberCommand: true, rememberDirectory: false, notifications: true });
  });

  it('resolves an absent or non-boolean value to the preference, read-side (039 FR-005a, Clarifications Q4)', () => {
    expect(resolveTerminalToggles({}, DEFAULTS)).toEqual({
      rememberCommand: false,
      rememberDirectory: true,
      notifications: true,
    });
    expect(
      resolveTerminalToggles(
        { rememberCommand: 'yes', notifications: 1 } as unknown as Record<string, unknown>,
        { ...DEFAULTS, rememberCommand: true, notifications: false },
      ),
    ).toEqual({ rememberCommand: true, rememberDirectory: true, notifications: false });
    expect(resolveTerminalToggles(undefined, DEFAULTS).notifications).toBe(true);
  });

  it('names each toggle and its state, with the chord when one is bound (FR-002)', () => {
    expect(settingToggleTitle('Remember the last running command', true)).toBe('Remember the last running command: enabled');
    expect(settingToggleTitle('Terminal notifications', false)).toBe('Terminal notifications: disabled');
    expect(settingToggleTitle('Reopen in the last directory', true, 'Ctrl+Alt+D')).toBe(
      'Reopen in the last directory: enabled (Ctrl+Alt+D)',
    );
  });

  it('ships each toggle’s glyph without a line through it: the off state draws the line (FR-002)', () => {
    // Lucide's slash is the path "m2 2 20 20"; bell-off carried it, which struck the bell through while ON.
    for (const t of TERMINAL_PANEL_TOGGLES) expect(DEFAULT_ICON_SET[t.icon], t.icon).not.toMatch(/m2 2 20 20/i);
  });
});
