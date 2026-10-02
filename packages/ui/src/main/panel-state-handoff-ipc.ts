/**
 * panel-state-handoff-ipc — the `throng:panelState:*` bridge onto {@link PanelStateHandoff} (049 R3,
 * contracts/panel-state-handoff.md).
 *
 * `navigation-history-ipc.ts`'s conventions: payloads are coerced rather than trusted, a malformed one
 * never reaches the store, nothing is thrown across the bridge, and Electron is not imported — `ipcMain` is
 * handed in, so the contract test drives the real handlers on a fake.
 *
 * Both channels are invokes: the sending window awaits its stash before it opens or notifies the
 * sub-workspace, and the receiving window awaits its claim before it mounts — that ordering is the whole
 * guarantee, and a fire-and-forget send could not give it.
 */
import type { PanelSnapshot } from '@throng/core';
import type { PanelStateHandoff } from './panel-state-handoff.js';

export interface PanelStateIpcMain {
  handle(channel: string, listener: (event: unknown, payload: unknown) => unknown): void;
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

export function registerPanelStateIpc(
  ipc: PanelStateIpcMain,
  store: Pick<PanelStateHandoff, 'stash' | 'claim'>,
): void {
  ipc.handle('throng:panelState:stash', (_event, payload): void => {
    const snapshots = record(payload).snapshots;
    if (!Array.isArray(snapshots)) return;
    try {
      store.stash(snapshots);
    } catch (err) {
      console.error('[panel-state-handoff-ipc] stash failed:', err);
    }
  });

  ipc.handle('throng:panelState:claim', (_event, payload): Record<string, PanelSnapshot> => {
    const ids = record(payload).panelIds;
    if (!Array.isArray(ids)) return {};
    const panelIds = ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
    try {
      return store.claim(panelIds);
    } catch (err) {
      console.error('[panel-state-handoff-ipc] claim failed:', err);
      return {};
    }
  });
}
