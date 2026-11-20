/**
 * An icon control whose pressed state is an on/off setting (constitution, Action controls › Setting toggles; 076
 * FR-002, 073 FR-007a). The ONE place that gives such a control its look (`setting-toggle.css`) and its name: the
 * setting and its state, then the bound chord — "Wrap cells: enabled". The title and the accessible name are the same
 * string, and the icon ships plain: the off state's line is drawn by the class, never by the glyph.
 *
 * A surface passes its own layout class (`className`) for padding and flex; the colours are never its to choose.
 */
import type { ReactElement } from 'react';
import { settingToggleTitle, type IconKey } from '@throng/core';
import { IconButton } from './icon-button.js';
import './setting-toggle.css';

export interface SettingToggleButtonProps {
  token: IconKey;
  /** The setting's name, as the preference and the menu item name it ("Wrap cells"). */
  label: string;
  on: boolean;
  /** The bound chord of the command that flips it, when there is one. */
  chord?: string | undefined;
  onToggle: () => void;
  testId: string;
  /** The surface's own layout class, beside `setting-toggle`. */
  className: string;
}

export function SettingToggleButton({ token, label, on, chord, onToggle, testId, className }: SettingToggleButtonProps): ReactElement {
  const name = settingToggleTitle(label, on, chord);
  return (
    <IconButton
      token={token}
      className={`${className} setting-toggle`}
      testId={testId}
      title={name}
      ariaLabel={name}
      ariaPressed={on}
      onClick={() => onToggle()}
    />
  );
}
