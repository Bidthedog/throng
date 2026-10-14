/**
 * Focus Mode in a panel's own status strip (054 FR-078, manual test change request 2026-10-12): while the
 * panel is the maximised one, its editor or preview status strip is painted in the panel's border colour and
 * names the mode — centred — and the way out. Replaces the window status bar's pill, which was not clear
 * enough at the edge of the window.
 */
import { useSyncExternalStore, type ReactElement } from 'react';
import { firstBinding } from '@throng/core';
import { useKeybindings } from '../config/config-store.js';
import { maximisedPanelOf, subscribeMaximise, tabOfMaximisePanel } from './maximise-store.js';

/** The class a status strip carries while its panel is in Focus Mode (`editor.css`). */
export const FOCUS_MODE_STRIP_CLASS = 'editor-status-strip--focus-mode';

/** Whether `panelId` is the maximised panel of its tab, re-rendering on every maximise change. */
export function usePanelInFocusMode(panelId: string): boolean {
  const read = (): boolean => {
    const tabId = tabOfMaximisePanel(panelId);
    return tabId !== null && maximisedPanelOf(tabId) === panelId;
  };
  return useSyncExternalStore(subscribeMaximise, read, read);
}

/** The centred label: drawn only while the strip's panel is in Focus Mode. */
export function FocusModeBadge({ panelId, active }: { panelId: string; active: boolean }): ReactElement | null {
  const keybindings = useKeybindings();
  if (!active) return null;
  const chord = firstBinding(keybindings, 'panel.toggleMaximise');
  const exit = chord ? `Esc or ${chord} to exit` : 'Esc to exit';
  return (
    <span className="editor-status-strip__focus-mode" data-testid={`focus-mode-badge-${panelId}`} role="status" title={`Focus Mode: ${exit}`}>
      Focus Mode <span className="editor-status-strip__focus-mode-hint">· {exit}</span>
    </span>
  );
}
