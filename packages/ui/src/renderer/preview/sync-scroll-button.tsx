/**
 * The scroll-sync toggle on an editor's and a preview's status bar (044 FR-122, FR-122a, FR-122c;
 * contracts/menus-and-controls.md §7, §8, §10).
 *
 * One control for both bars, so the two cannot drift: token `syncScroll`, `aria-pressed` from the one global
 * setting, hover title *Synchronise Scrolling* with the bound chord appended when there is one, and a click
 * that runs whatever the bar hands in — always `toggleSyncScroll` in the end. It holds no state of its own
 * (no optimistic flip): the pressed state moves only when the window's config store does.
 *
 * NEVER DISABLED (FR-122a). The setting applies whether or not a preview can be opened right now, so a
 * switched-off provider or an already-open preview leaves this enabled beside a disabled or pressed preview
 * button. Where the bar draws it at all is the bar's decision.
 *
 * It is a setting toggle (073 FR-007a): the shared `setting-toggle` look, full-contrast when on and muted with a struck
 * line when off, titled "Synchronise Scrolling: enabled|disabled". It borrows the preview button's class for layout only.
 *
 * Principle VI: an accelerator over the four Synchronise Scrolling menu items, which stay reachable with the
 * bar hidden.
 */
import type { ReactElement } from 'react';
import { firstBinding } from '@throng/core';
import { SettingToggleButton } from '../common/setting-toggle-button.js';
import { useKeybindings } from '../config/config-store.js';

const LABEL = 'Synchronise Scrolling';

export interface SyncScrollButtonProps {
  testId: string;
  /** `editor.previews.syncScroll` as the window holds it now. */
  on: boolean;
  onToggle: () => void;
}

export function SyncScrollButton({ testId, on, onToggle }: SyncScrollButtonProps): ReactElement {
  const chord = firstBinding(useKeybindings(), 'preview.toggleSyncScroll');
  return (
    <SettingToggleButton
      token="syncScroll"
      label={LABEL}
      on={on}
      chord={chord}
      onToggle={onToggle}
      testId={testId}
      className="editor-status-strip__preview"
    />
  );
}
