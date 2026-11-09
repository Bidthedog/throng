import { describe, expect, it, vi } from 'vitest';
import type { TerminalOutputNotification } from '@throng/ipc-contract';
import { subscribeTerminalOutput } from '../../src/renderer/terminal/output-router.js';

function bridge() {
  let listener: ((e: TerminalOutputNotification) => void) | null = null;
  const off = vi.fn(() => {
    listener = null;
  });
  const onOutput = vi.fn((cb: (e: TerminalOutputNotification) => void) => {
    listener = cb;
    return off;
  });
  return { onOutput, off, emit: (e: TerminalOutputNotification) => listener?.(e) };
}

const d = (panelId: string, data: string): TerminalOutputNotification => ({ panelId, sessionId: 1, data, end: data.length });

describe('subscribeTerminalOutput (061 FR-007, FR-008)', () => {
  it('registers one listener however many views there are', () => {
    const b = bridge();
    subscribeTerminalOutput(b, 'a', vi.fn());
    subscribeTerminalOutput(b, 'a', vi.fn());
    subscribeTerminalOutput(b, 'b', vi.fn());
    expect(b.onOutput).toHaveBeenCalledTimes(1);
  });

  it('delivers only to the views of that terminal, in order', () => {
    const b = bridge();
    const a: string[] = [];
    const other = vi.fn();
    subscribeTerminalOutput(b, 'a', (e) => a.push(e.data));
    subscribeTerminalOutput(b, 'b', other);

    b.emit(d('a', '1'));
    b.emit(d('a', '2'));

    expect(a).toEqual(['1', '2']);
    expect(other).not.toHaveBeenCalled();
  });

  it('delivers to every view of a terminal shown twice', () => {
    const b = bridge();
    const first = vi.fn();
    const second = vi.fn();
    subscribeTerminalOutput(b, 'a', first);
    subscribeTerminalOutput(b, 'a', second);
    b.emit(d('a', 'x'));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops delivering to a view that left, and releases the listener with the last view', () => {
    const b = bridge();
    const first = vi.fn();
    const leaveFirst = subscribeTerminalOutput(b, 'a', first);
    const leaveSecond = subscribeTerminalOutput(b, 'b', vi.fn());

    leaveFirst();
    b.emit(d('a', 'x'));
    expect(first).not.toHaveBeenCalled();
    expect(b.off).not.toHaveBeenCalled();

    leaveSecond();
    expect(b.off).toHaveBeenCalledTimes(1);
  });

  it('registers afresh after the last view left', () => {
    const b = bridge();
    subscribeTerminalOutput(b, 'a', vi.fn())();
    subscribeTerminalOutput(b, 'a', vi.fn());
    expect(b.onOutput).toHaveBeenCalledTimes(2);
  });
});
