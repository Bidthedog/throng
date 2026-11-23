import { describe, expect, it } from 'vitest';
import type { PanelSnapshot } from '@throng/core';
import { PanelStateHandoff } from '../../src/main/panel-state-handoff.js';
import { registerPanelStateIpc, type PanelStateIpcMain } from '../../src/main/panel-state-handoff-ipc.js';

/**
 * Contract (049 T008): the `throng:panelState:*` surface of contracts/panel-state-handoff.md, driven
 * through the handlers `registerPanelStateIpc` actually registers, on a fake `ipcMain`, over the REAL
 * store — so the round trip a tear-off depends on is pinned on the wire: both channels are invokes, a
 * stash is claimed exactly once, and a malformed payload is a value, never a rejection.
 */

type Listener = (event: unknown, payload: unknown) => unknown;

function fakeIpc(): PanelStateIpcMain & { handles: Map<string, Listener> } {
  const handles = new Map<string, Listener>();
  return { handles, handle: (channel, listener) => void handles.set(channel, listener as Listener) };
}

const event = { sender: { id: 1 } };
const snap: PanelSnapshot = { panelId: 'p1', terminal: { offsetFromBottom: 12 } };

function setup(): { ipc: ReturnType<typeof fakeIpc>; store: PanelStateHandoff } {
  const ipc = fakeIpc();
  const store = new PanelStateHandoff();
  registerPanelStateIpc(ipc, store);
  return { ipc, store };
}

describe('throng:panelState:* (049 contracts/panel-state-handoff.md)', () => {
  it('registers exactly the two invoke channels', () => {
    const { ipc } = setup();
    expect([...ipc.handles.keys()].sort()).toEqual(['throng:panelState:claim', 'throng:panelState:stash']);
  });

  it('a stashed snapshot is claimed once, then gone', async () => {
    const { ipc } = setup();
    await ipc.handles.get('throng:panelState:stash')!(event, { snapshots: [snap] });
    expect(await ipc.handles.get('throng:panelState:claim')!(event, { panelIds: ['p1'] })).toEqual({ p1: snap });
    expect(await ipc.handles.get('throng:panelState:claim')!(event, { panelIds: ['p1'] })).toEqual({});
  });

  it('a destroyed panel is forgotten', async () => {
    const { ipc, store } = setup();
    await ipc.handles.get('throng:panelState:stash')!(event, { snapshots: [snap] });
    store.forget('p1');
    expect(await ipc.handles.get('throng:panelState:claim')!(event, { panelIds: ['p1'] })).toEqual({});
  });

  it('a malformed payload is answered, never thrown', async () => {
    const { ipc } = setup();
    for (const bad of [undefined, null, 7, { snapshots: 'x' }, { snapshots: [null] }]) {
      expect(await ipc.handles.get('throng:panelState:stash')!(event, bad)).toBeUndefined();
    }
    for (const bad of [undefined, null, { panelIds: 'p1' }, { panelIds: [3] }]) {
      expect(await ipc.handles.get('throng:panelState:claim')!(event, bad)).toEqual({});
    }
  });
});
