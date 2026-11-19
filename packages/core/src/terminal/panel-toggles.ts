/**
 * 076 — the terminal status bar's per-panel toggles, declared ONCE (research R1).
 *
 * The status bar, the content menu, the key-binding dispatch and the setup form all show the same three settings in
 * the same order with the same names. One frozen table makes FR-001's order and FR-002's naming a single fact, so
 * no consumer can restate either and drift.
 *
 * Each row's `id` is also the `TerminalPanelConfig` key it stores. Resolution is read-side (039 FR-005a): a panel's
 * own boolean wins, anything else takes the global preference, and nothing is written back (039 FR-006).
 */
import type { ActionId } from '../config/keybindings.js';
import type { IconKey } from '../icons/icon-keys.js';
import type { TerminalPanelDefaults } from '../panel-type/descriptor.js';

/** The three per-panel settings, by the `TerminalPanelConfig` key each one stores. */
export type TerminalToggleId = 'rememberCommand' | 'rememberDirectory' | 'notifications';

export interface TerminalPanelToggle {
  readonly id: TerminalToggleId;
  /** The command that flips it on the focused terminal (FR-006). Unbound by default. */
  readonly command: ActionId;
  /** The icon the status-bar toggle draws (FR-002). */
  readonly icon: IconKey;
  /** The setting's name: the toggle's title, the menu item's label and the setup form's checkbox. */
  readonly label: string;
}

/** FR-001's order: Remember command, Reopen directory, Terminal notifications. */
export const TERMINAL_PANEL_TOGGLES: readonly TerminalPanelToggle[] = Object.freeze([
  Object.freeze({
    id: 'rememberCommand',
    command: 'terminal.toggleRememberCommand',
    icon: 'rememberCommand',
    label: 'Remember the last running command',
  } as const),
  Object.freeze({
    id: 'rememberDirectory',
    command: 'terminal.toggleRememberDirectory',
    icon: 'rememberDirectory',
    label: 'Reopen in the last directory',
  } as const),
  Object.freeze({
    id: 'notifications',
    command: 'terminal.toggleNotifications',
    icon: 'terminalNotifications',
    label: 'Terminal notifications',
  } as const),
]);

export type TerminalToggleValues = Record<TerminalToggleId, boolean>;

/** Each toggle's effective value: the panel's own boolean, else the preference (FR-003). */
export function resolveTerminalToggles(
  config: Readonly<Record<string, unknown>> | undefined,
  defaults: TerminalPanelDefaults,
): TerminalToggleValues {
  const pick = (id: TerminalToggleId): boolean => {
    const own = config?.[id];
    return typeof own === 'boolean' ? own : defaults[id];
  };
  return {
    rememberCommand: pick('rememberCommand'),
    rememberDirectory: pick('rememberDirectory'),
    notifications: pick('notifications'),
  };
}
