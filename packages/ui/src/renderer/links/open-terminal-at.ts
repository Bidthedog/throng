/**
 * 033 US3 (FR-031, FR-033, FR-033a; contract §A.2) — open a new terminal panel of `flavour` in the active tab,
 * started at `startDirectory`. Open In ▸ Terminal performs this, from the File Explorer and, since 081 FR-050,
 * from the Link menu over a local file or folder.
 *
 * `startDirectory` is a REQUEST: main hands it to `resolveStartDirectory`, which refuses a path outside the
 * project root and substitutes the root (FR-032).
 *
 * FR-033a / SC-015 — the keystroke after the click must reach the shell. `focusPanel` fails here because the
 * panel's terminal view has not mounted yet; `requestPanelFocus` parks the request until it registers
 * (issue 144). `terminal-panel.tsx` registers its focus callback after `useTerminal`, which keeps that true.
 */
import type { FlavourOption, TerminalPanelConfig } from '@throng/core';
import { focusPanel, requestPanelFocus } from '../workspace/panel-focus.js';
import type { useWorkspace } from '../state/workspace-store.js';

/** The workspace slice the launch uses. */
export type TerminalLaunchWorkspace = Pick<
  ReturnType<typeof useWorkspace>,
  'layout' | 'addPanel' | 'setPanelType' | 'setActivePanel'
>;

export function openTerminalAt(ws: TerminalLaunchWorkspace, startDirectory: string, flavour: FlavourOption): void {
  const activeTabId = ws.layout?.activeTabId;
  if (!activeTabId) return;
  const config: TerminalPanelConfig = {
    flavourId: flavour.value,
    flavourLabel: flavour.label,
    shellArguments: flavour.defaultShellArguments,
    startDirectory,
  };
  const newId = ws.addPanel(activeTabId);
  ws.setPanelType(newId, 'terminal', config);
  window.throng?.panel?.notifyTyped?.(newId, 'terminal', config);
  ws.setActivePanel(activeTabId, newId);
  if (!focusPanel(newId)) requestPanelFocus(newId);
}
