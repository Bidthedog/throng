import { describe, it, expect } from 'vitest';
import {
  broadcastToWindows,
  senderWebContentsId,
  type BroadcastTarget,
} from '../../src/main/broadcast.js';

// Models the subset of a BrowserWindow the broadcaster touches. `send` throws when
// the window is destroyed, exactly as Electron does ("Object has been destroyed").
function fakeWindow(
  id: number,
  opts: { destroyed?: boolean; wcDestroyed?: boolean; idThrows?: boolean; sendThrows?: boolean } = {},
): BroadcastTarget & { sent: Array<{ channel: string; payload: unknown }> } {
  const sent: Array<{ channel: string; payload: unknown }> = [];
  return {
    sent,
    isDestroyed: () => opts.destroyed === true,
    webContents: {
      get id(): number {
        if (opts.idThrows) throw new Error('Object has been destroyed');
        return id;
      },
      isDestroyed: () => opts.wcDestroyed === true,
      send: (channel: string, payload: unknown) => {
        if (opts.destroyed || opts.wcDestroyed || opts.sendThrows) {
          throw new Error('Object has been destroyed');
        }
        sent.push({ channel, payload });
      },
    },
  };
}

describe('broadcastToWindows (guards destroyed windows)', () => {
  it('sends the payload on the channel to every live window', () => {
    const a = fakeWindow(1);
    const b = fakeWindow(2);
    broadcastToWindows([a, b], 'ch', { x: 1 });
    expect(a.sent).toEqual([{ channel: 'ch', payload: { x: 1 } }]);
    expect(b.sent).toEqual([{ channel: 'ch', payload: { x: 1 } }]);
  });

  it('skips a destroyed window (BrowserWindow.isDestroyed) without throwing', () => {
    const live = fakeWindow(1);
    const dead = fakeWindow(2, { destroyed: true });
    expect(() => broadcastToWindows([dead, live], 'ch', 'p')).not.toThrow();
    expect(live.sent).toHaveLength(1);
    expect(dead.sent).toHaveLength(0);
  });

  it('skips a window whose webContents is destroyed', () => {
    const live = fakeWindow(1);
    const dead = fakeWindow(2, { wcDestroyed: true });
    expect(() => broadcastToWindows([dead, live], 'ch', 'p')).not.toThrow();
    expect(live.sent).toHaveLength(1);
    expect(dead.sent).toHaveLength(0);
  });

  it('excludes the sender window by webContents id', () => {
    const sender = fakeWindow(1);
    const other = fakeWindow(2);
    broadcastToWindows([sender, other], 'ch', 'p', 1);
    expect(sender.sent).toHaveLength(0);
    expect(other.sent).toHaveLength(1);
  });

  it('does not throw and still delivers to others when one window is destroyed mid-send (race)', () => {
    const racing = fakeWindow(1, { sendThrows: true }); // reports live, but send throws
    const ok = fakeWindow(2);
    expect(() => broadcastToWindows([racing, ok], 'ch', 'p')).not.toThrow();
    expect(ok.sent).toHaveLength(1);
  });

  it('does not throw when a window webContents id getter throws (destroyed between check and read)', () => {
    const racing = fakeWindow(1, { idThrows: true });
    const ok = fakeWindow(2);
    expect(() => broadcastToWindows([racing, ok], 'ch', 'p', 99)).not.toThrow();
    expect(ok.sent).toHaveLength(1);
  });
});

describe('senderWebContentsId', () => {
  it('returns the id for a live sender', () => {
    expect(senderWebContentsId({ id: 7, isDestroyed: () => false })).toBe(7);
  });

  it('returns null for a destroyed sender', () => {
    expect(senderWebContentsId({ id: 7, isDestroyed: () => true })).toBeNull();
  });

  it('returns null when reading the sender throws', () => {
    expect(
      senderWebContentsId({
        get id(): number {
          throw new Error('Object has been destroyed');
        },
        isDestroyed: () => false,
      }),
    ).toBeNull();
  });
});
