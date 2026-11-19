import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionSignal } from '@throng/core';
import {
  TerminalAttention,
  defaultAttentionConfig,
  mergeAttentionConfig,
  type AttentionSubject,
} from '../../src/terminal-attention.js';
import type { TerminalEvents } from '../../src/terminal-events.js';
import { BEL, config, makeHarness } from './attention-harness.js';

/*
 * 076 FR-021 – FR-023, research R3 — a panel whose notifications are off (ignored) has its signals dropped where the daemon publishes, so a
 * signal raised with no window open (057 FR-066) obeys it too.
 *
 * Layer: unit — `TerminalAttention` over a stub events sink; the rate limiter's timers run on a fake clock.
 */

class Sink {
  sinkCount = 1;
  readonly published: AttentionSignal[] = [];
  publishAttention(sig: AttentionSignal): void {
    this.published.push(sig);
  }
}

const P1: AttentionSubject = { panelId: 'p1', projectId: 'proj' };
const P2: AttentionSubject = { panelId: 'p2', projectId: 'proj' };

function make(stored: Record<string, boolean | undefined>, sink = new Sink()) {
  const attention = new TerminalAttention(sink as unknown as TerminalEvents, {
    storedNotifications: (subject) => stored[subject.panelId],
  });
  return { attention, sink };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the producer config carries notifyByDefault (076 FR-025)', () => {
  it('ships on and reads only a boolean, keeping the held value otherwise', () => {
    expect(defaultAttentionConfig().notifyByDefault).toBe(true);
    const off = mergeAttentionConfig(defaultAttentionConfig(), { notifyByDefault: false });
    expect(off.notifyByDefault).toBe(false);
    expect(mergeAttentionConfig(off, { notifyByDefault: 'yes' }).notifyByDefault).toBe(false);
    expect(mergeAttentionConfig(off, {}).notifyByDefault).toBe(false);
  });
});

describe('the publish gate (076 FR-021)', () => {
  it('drops a signal from a panel whose own notifications are off, and publishes its neighbour’s', () => {
    const { attention, sink } = make({ p1: false, p2: true });
    attention.raise(P1, 'bell', 'attention', null);
    attention.raise(P2, 'bell', 'attention', null);
    expect(sink.published.map((s) => s.panelId)).toEqual(['p2']);
  });

  it('resolves a panel holding no value to notifyByDefault, read-side (Clarifications Q4)', () => {
    const { attention, sink } = make({ p1: undefined, p2: true });
    attention.setConfig({ notifyByDefault: false });
    attention.raise(P1, 'processExited', 'failed', 'exit 3');
    attention.raise(P2, 'processExited', 'failed', 'exit 3');
    expect(sink.published.map((s) => s.panelId)).toEqual(['p2']);
    attention.setConfig({ notifyByDefault: true });
    attention.raise(P1, 'bell', 'attention', null);
    expect(sink.published.map((s) => s.panelId)).toEqual(['p2', 'p1']);
  });

  it('records nothing in the ledger for an ignored panel while no window is open (057 FR-066)', () => {
    const sink = new Sink();
    sink.sinkCount = 0;
    const { attention } = make({ p1: false, p2: true }, sink);
    attention.raise(P1, 'bell', 'attention', null);
    attention.raise(P2, 'bell', 'attention', null);
    expect(attention.readLedger().map((e) => e.panelId)).toEqual(['p2']);
  });

  it('drops a signal waiting in a rate window once its panel is ignored, and never replays it (FR-023)', async () => {
    const stored: Record<string, boolean | undefined> = { p1: true };
    const { attention, sink } = make(stored);
    attention.raise(P1, 'notification', 'attention', 'first');
    attention.raise(P1, 'notification', 'attention', 'second'); // held for the window's end
    stored.p1 = false;
    await vi.advanceTimersByTimeAsync(300);
    stored.p1 = true;
    await vi.advanceTimersByTimeAsync(600);
    expect(sink.published.map((s) => s.detail)).toEqual(['first']);
  });

  it('omits from the ledger read an entry whose panel is ignored now', () => {
    const sink = new Sink();
    sink.sinkCount = 0;
    const stored: Record<string, boolean | undefined> = { p1: true };
    const { attention } = make(stored, sink);
    attention.raise(P1, 'bell', 'attention', null);
    stored.p1 = false;
    expect(attention.readLedger()).toEqual([]);
  });

  it('falls back to the preference, and logs, when the stored value cannot be read (Principle XIII)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sink = new Sink();
    const attention = new TerminalAttention(sink as unknown as TerminalEvents, {
      storedNotifications: () => {
        throw new Error('layout unreadable');
      },
    });
    attention.raise(P1, 'bell', 'attention', null);
    expect(sink.published).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('ignoredOf (076 FR-022, research R5)', () => {
  it('returns the subset of panels that resolve to ignored under the current config', () => {
    const { attention } = make({ p1: false, p2: true, p3: undefined });
    const panels = ['p1', 'p2', 'p3'].map((panelId) => ({ panelId, projectId: 'proj' }));
    expect(attention.ignoredOf(panels)).toEqual(['p1']);
    attention.setConfig({ notifyByDefault: false });
    expect(attention.ignoredOf(panels)).toEqual(['p1', 'p3']);
  });
});

/*
 * Through the real TerminalService and RPC router: the method is registered, validates its params, and the
 * service wires `storedNotifications` into the producer it owns.
 */
describe('terminal.attentionIgnored and the wired gate (076 contracts/attention-ignore.md)', () => {
  it('answers which of the given panels are ignored, and rejects malformed params with -32602', async () => {
    const h = makeHarness({ storedNotifications: (s) => (s.panelId === 'p1' ? false : undefined) });
    try {
      const ok = await h.rpc('terminal.attentionIgnored', {
        panels: [
          { panelId: 'p1', projectId: 'proj' },
          { panelId: 'p2', projectId: 'proj' },
        ],
      });
      expect(ok.result).toEqual({ ignored: ['p1'] });
      await h.rpc('terminal.attentionConfig', config({ notifyByDefault: false }));
      const all = await h.rpc('terminal.attentionIgnored', { panels: [{ panelId: 'p2', projectId: 'proj' }] });
      expect(all.result).toEqual({ ignored: ['p2'] });
      const bad = await h.rpc('terminal.attentionIgnored', { panels: 'p1' });
      expect(bad.error?.code).toBe(-32602);
    } finally {
      await h.stop();
    }
  });

  it('publishes nothing for a running terminal whose panel is ignored', async () => {
    const h = makeHarness({ storedNotifications: (s) => s.panelId !== 'p1' });
    try {
      await h.attach('p1');
      await h.attach('p2');
      h.host.emit(BEL, 1000);
      h.host.emit(BEL, 1001);
      expect(h.signals.map((s) => s.panelId)).toEqual(['p2']);
    } finally {
      await h.stop();
    }
  });
});
