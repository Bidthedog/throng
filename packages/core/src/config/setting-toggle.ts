/**
 * The title of a setting toggle (constitution, Development Workflow & Quality Gates › Action controls › Setting
 * toggles; 076 FR-002, 073 FR-007a).
 *
 * An icon control whose pressed state IS an on/off setting is named with the setting and its state, so a reader never
 * infers one from the glyph: "Wrap cells: enabled" or "Wrap cells: disabled", followed by the bound chord in
 * parentheses when there is one — "Remember the last running command: enabled (Ctrl+Alt+R)". The terminal's toggles, the
 * preview status bar's and Synchronise Scrolling all take their title and accessible name from here.
 */
export function settingToggleTitle(label: string, on: boolean, chord?: string): string {
  const base = `${label}: ${on ? 'enabled' : 'disabled'}`;
  return chord ? `${base} (${chord})` : base;
}
