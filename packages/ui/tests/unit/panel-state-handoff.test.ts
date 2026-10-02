import { describe, expect, it } from 'vitest';
import { MAX_PANEL_SNAPSHOT_BYTES, type PanelSnapshot } from '@throng/core';
import { PanelStateHandoff } from '../../src/main/panel-state-handoff.js';

/**
 * 049 T006 — the main-side store a panel's state waits in between the window that sends it and the window
 * that receives it (research R3; contracts/panel-state-handoff.md, main-side rules 1–4).
 */

const snap = (panelId: string, scrollAnchor = 10): PanelSnapshot => ({
  panelId,
  editor: { selection: { ranges: [{ anchor: 1, head: 4 }], main: 0 }, scrollAnchor },
});

describe('PanelStateHandoff', () => {
  it('keeps one entry per panel, and a later stash replaces an earlier one', () => {
    const h = new PanelStateHandoff();
    h.stash([snap('a', 1), snap('b')]);
    h.stash([snap('a', 2)]);
    expect(h.claim(['a', 'b'])).toEqual({ a: snap('a', 2), b: snap('b') });
  });

  it('claim returns what it has, deletes it, and leaves out ids it has none for', () => {
    const h = new PanelStateHandoff();
    h.stash([snap('a')]);
    expect(h.claim(['a', 'missing'])).toEqual({ a: snap('a') });
    expect(h.claim(['a'])).toEqual({});
  });

  it('drops an invalid snapshot without throwing, and keeps the valid ones beside it', () => {
    const h = new PanelStateHandoff();
    expect(() => h.stash([{ panelId: '' } as PanelSnapshot, 42 as unknown as PanelSnapshot, snap('ok')])).not.toThrow();
    expect(h.claim(['', 'ok'])).toEqual({ ok: snap('ok') });
  });

  it('drops a snapshot over the size cap', () => {
    const h = new PanelStateHandoff();
    const big: PanelSnapshot = { panelId: 'big', previewSelection: { from: 0, to: 1, text: 'x'.repeat(MAX_PANEL_SNAPSHOT_BYTES) } };
    h.stash([big]);
    expect(h.claim(['big'])).toEqual({});
  });

  it('forget deletes an entry', () => {
    const h = new PanelStateHandoff();
    h.stash([snap('a')]);
    h.forget('a');
    expect(h.claim(['a'])).toEqual({});
  });
});
