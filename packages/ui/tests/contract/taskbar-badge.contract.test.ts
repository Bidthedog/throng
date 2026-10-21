/**
 * ITaskbarBadge (057, FR-039, contracts/app-attention.md): the no-op and the recording fake both
 * satisfy the seam. The Electron implementation (`setOverlayIcon` per window) is exercised in the
 * attention E2E through the recording fake; a real overlay cannot be asserted from a unit process.
 */
import { describe, expect, it } from 'vitest';
import { NoTaskbarBadge, type ITaskbarBadge } from '@throng/core';
import { ElectronTaskbarBadge, windowsWithTaskbarButton } from '../../src/main/electron-taskbar-badge.js';
import { RecordingTaskbarBadge, type OsCall } from '../../src/main/recording-attention-os.js';

describe.each<[string, () => ITaskbarBadge]>([
  ['NoTaskbarBadge', () => new NoTaskbarBadge()],
  ['RecordingTaskbarBadge', () => new RecordingTaskbarBadge(() => undefined)],
])('%s satisfies ITaskbarBadge', (_name, make) => {
  it('sets, replaces and clears without throwing', () => {
    const b = make();
    expect(() => {
      b.set('data:image/png;base64,AAAA', '2 panels need you');
      b.set('data:image/png;base64,BBBB', '3 panels need you');
      b.clear();
      b.clear();
    }).not.toThrow();
  });
});

describe('windowsWithTaskbarButton (FR-039: only a window with its own taskbar button carries the badge)', () => {
  const win = (name: string, parent: unknown = null) => ({ name, getParentWindow: () => parent });

  it('excludes the hidden drag ghost', () => {
    const main = win('main');
    const ghost = win('ghost');
    expect(windowsWithTaskbarButton([main, ghost], (w) => w === ghost)).toEqual([main]);
  });

  it('excludes an owned (child) window, which has no taskbar button of its own', () => {
    const main = win('main');
    const prefs = win('prefs', main);
    expect(windowsWithTaskbarButton([main, prefs], () => false)).toEqual([main]);
  });

  it('keeps the main window and every sub-workspace window', () => {
    const all = [win('main'), win('sub-1'), win('sub-2')];
    expect(windowsWithTaskbarButton(all, () => false)).toEqual(all);
  });
});

describe('ElectronTaskbarBadge.reapply (FR-039: a window opened after the badge was set still carries it)', () => {
  const win = () => {
    const calls: Array<[unknown, string]> = [];
    return { calls, w: { isDestroyed: () => false, setOverlayIcon: (i: unknown, d: string) => calls.push([i, d]) } };
  };

  it('puts the current overlay on a window created after set()', () => {
    const badge = new ElectronTaskbarBadge(() => [], (u) => `img(${u})`);
    badge.set('data:x', '2 panels need you');
    const late = win();
    badge.reapply(late.w);
    expect(late.calls).toEqual([['img(data:x)', '2 panels need you']]);
  });

  it('does nothing when no badge is showing, or after clear()', () => {
    const badge = new ElectronTaskbarBadge(() => [], (u) => u);
    const w1 = win();
    badge.reapply(w1.w);
    badge.set('data:x', 'd');
    badge.clear();
    badge.reapply(w1.w);
    expect(w1.calls).toEqual([]);
  });
});

describe('RecordingTaskbarBadge', () => {
  it('records set with the image and description, then clear', () => {
    const calls: OsCall[] = [];
    const b = new RecordingTaskbarBadge((c) => calls.push(c));
    b.set('data:image/png;base64,AAAA', '1 panel needs you');
    b.clear();
    expect(calls).toEqual([
      { target: 'badge', op: 'set', image: 'data:image/png;base64,AAAA', description: '1 panel needs you' },
      { target: 'badge', op: 'clear' },
    ]);
  });

  it('records a clear only when a badge is showing', () => {
    const calls: OsCall[] = [];
    const b = new RecordingTaskbarBadge((c) => calls.push(c));
    b.clear();
    expect(calls).toEqual([]);
  });
});
