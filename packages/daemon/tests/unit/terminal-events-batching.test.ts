import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TERMINAL_BATCH_INTERVAL_MS, TERMINAL_BATCH_MAX_CHARS, type AttentionSignal } from '@throng/core';
import { TerminalEvents } from '../../src/terminal-events.js';

interface Frame {
  method: string;
  params: { panelId: string; sessionId: number; data: string; end: number; lengths?: number[] };
}

let frames: Frame[];
let events: TerminalEvents;
let position: number;

const outputs = () => frames.filter((f) => f.method === 'terminal.output').map((f) => f.params);
const methods = () => frames.map((f) => f.method);

function chunk(data: string, panelId = 'p', sessionId = 1): void {
  position += data.length;
  events.publishOutput(panelId, sessionId, data, position);
}

beforeEach(() => {
  vi.useFakeTimers();
  frames = [];
  position = 0;
  events = new TerminalEvents();
  events.addSink({ write: (frame) => frames.push(JSON.parse(frame) as Frame) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('output batching (061 FR-020, FR-021, FR-025)', () => {
  it('sends the first chunk after a quiet spell at once, so an echo waits for nothing', () => {
    chunk('a');
    expect(outputs()).toEqual([{ panelId: 'p', sessionId: 1, data: 'a', end: 1 }]);
  });

  it('gathers what follows and sends it when the interval ends, even if the stream continues', () => {
    chunk('a');
    chunk('b');
    chunk('cc');
    expect(outputs()).toHaveLength(1);

    vi.advanceTimersByTime(TERMINAL_BATCH_INTERVAL_MS);

    expect(outputs()[1]).toEqual({ panelId: 'p', sessionId: 1, data: 'bcc', end: 4, lengths: [1, 2] });
  });

  it('omits lengths for a delivery of one chunk', () => {
    chunk('a');
    chunk('b');
    vi.advanceTimersByTime(TERMINAL_BATCH_INTERVAL_MS);
    expect(outputs()[1]).not.toHaveProperty('lengths');
  });

  it('holds a sustained stream to one delivery per interval', () => {
    for (let ms = 0; ms < 1000; ms += 1) {
      chunk('x');
      vi.advanceTimersByTime(1);
    }
    expect(outputs().length).toBeLessThanOrEqual(60);
  });

  it('delivers contiguous positions across batches', () => {
    for (let ms = 0; ms < 100; ms += 1) {
      chunk('xy');
      vi.advanceTimersByTime(1);
    }
    vi.advanceTimersByTime(TERMINAL_BATCH_INTERVAL_MS);
    let at = 0;
    for (const o of outputs()) {
      expect(o.end - o.data.length).toBe(at);
      at = o.end;
    }
    expect(at).toBe(200);
  });

  it('delivers a batch that reaches the size limit at once', () => {
    chunk('a');
    chunk('b'.repeat(TERMINAL_BATCH_MAX_CHARS));
    expect(outputs()).toHaveLength(2);
  });

  it('sends at once again after a quiet spell', () => {
    chunk('a');
    vi.advanceTimersByTime(TERMINAL_BATCH_INTERVAL_MS);
    chunk('b');
    expect(outputs()).toHaveLength(2);
  });

  it('batches each terminal on its own', () => {
    chunk('a', 'one');
    chunk('b', 'two');
    expect(outputs().map((o) => o.panelId)).toEqual(['one', 'two']);
  });

  it('never merges two sessions of one panel', () => {
    chunk('a', 'p', 1);
    chunk('b', 'p', 1);
    chunk('c', 'p', 2);
    expect(outputs().map((o) => o.sessionId)).toEqual([1, 1]);
    vi.advanceTimersByTime(TERMINAL_BATCH_INTERVAL_MS);
    expect(outputs().map((o) => o.sessionId)).toEqual([1, 1, 2]);
  });

  it('leaves no timer behind when idle', () => {
    chunk('a');
    chunk('b');
    vi.advanceTimersByTime(TERMINAL_BATCH_INTERVAL_MS);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('order across notifications (061 FR-024)', () => {
  const pending = (): void => {
    chunk('a');
    chunk('pending');
  };

  it('delivers pending output before an exit', () => {
    pending();
    events.publishExit('p', 0, undefined, false, 1);
    expect(methods()).toEqual(['terminal.output', 'terminal.output', 'terminal.exit']);
  });

  it('delivers pending output before a grid change', () => {
    pending();
    events.publishGrid('p', 80, 24);
    expect(methods().at(-1)).toBe('terminal.grid');
    expect(outputs().at(-1)?.data).toBe('pending');
  });

  it('delivers pending output before a working-directory or command change', () => {
    pending();
    events.publishCwd('p', '/x');
    expect(outputs().at(-1)?.data).toBe('pending');
    chunk('b');
    chunk('more');
    events.publishCommand('p', 'vim');
    expect(outputs().at(-1)?.data).toContain('more');
  });

  it('delivers pending output before an attention signal', () => {
    pending();
    events.publishAttention({ panelId: 'p' } as AttentionSignal);
    expect(methods().at(-1)).toBe('terminal.attention');
    expect(outputs().at(-1)?.data).toBe('pending');
  });

  it('leaves another terminal’s pending output alone', () => {
    chunk('a', 'other');
    chunk('held', 'other');
    events.publishExit('p', 0, undefined, false, 1);
    expect(outputs().map((o) => o.data)).toEqual(['a']);
  });

  it('flush on request sends what is pending and cancels its timer', () => {
    pending();
    events.flush('p');
    expect(outputs().at(-1)?.data).toBe('pending');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('forgetting a panel flushes it and starts it afresh', () => {
    pending();
    events.forgetPanel('p');
    expect(vi.getTimerCount()).toBe(0);
    frames.length = 0;
    chunk('next');
    expect(outputs()).toHaveLength(1);
  });
});
