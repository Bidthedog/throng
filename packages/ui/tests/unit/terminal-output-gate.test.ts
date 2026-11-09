import { describe, it, expect, vi } from 'vitest';
import { TerminalOutputGate, type TerminalOutputDelivery } from '../../src/renderer/terminal/output-gate.js';

/** A delivery for session 1 holding `data`, ending at `end`. */
const d = (data: string, end: number, sessionId = 1, lengths?: number[]): TerminalOutputDelivery => ({
  panelId: 'p',
  sessionId,
  data,
  end,
  ...(lengths ? { lengths } : {}),
});

// Live output and the replay travel on different sockets, so a live delivery can arrive before the replay and written
// straight to xterm would land above the older backlog. The gate holds deliveries until the replay is applied, and each
// delivery's position decides whether the replay already contained it (061 FR-012).
describe('TerminalOutputGate (061 FR-012)', () => {
  it('holds deliveries until the replay is applied, then gives them in order', () => {
    const gate = new TerminalOutputGate();
    expect(gate.accept(d('A', 11))).toEqual([]);
    expect(gate.accept(d('B', 12))).toEqual([]);
    expect(gate.release(1, 10)).toEqual(['A', 'B']);
  });

  it('drops what the replay already contained, in every arrival order', () => {
    const gate = new TerminalOutputGate();
    gate.accept(d('in-replay', 9));
    gate.accept(d('after', 14));
    expect(gate.release(1, 9)).toEqual(['after']);
    expect(gate.accept(d('late-dupe', 9))).toEqual([]);
    expect(gate.accept(d('next', 18))).toEqual(['next']);
  });

  it('passes straight through once open', () => {
    const gate = new TerminalOutputGate();
    gate.release(1, 0);
    expect(gate.isOpen).toBe(true);
    expect(gate.accept(d('live', 4))).toEqual(['live']);
  });

  it('release is idempotent', () => {
    const gate = new TerminalOutputGate();
    gate.accept(d('x', 1));
    expect(gate.release(1, 0)).toEqual(['x']);
    expect(gate.release(1, 0)).toEqual([]);
  });

  it('ignores a delivery from another session of the same panel', () => {
    const gate = new TerminalOutputGate();
    gate.accept(d('old', 500, 1));
    expect(gate.release(2, 0)).toEqual([]);
    expect(gate.accept(d('older', 501, 1))).toEqual([]);
    expect(gate.accept(d('new', 3, 2))).toEqual(['new']);
  });

  it('gives a batch back as the chunks it was made of', () => {
    const gate = new TerminalOutputGate();
    gate.release(1, 0);
    expect(gate.accept(d('abcdef', 6, 1, [1, 2, 3]))).toEqual(['a', 'bc', 'def']);
  });

  it('reports a gap and still writes the delivery', () => {
    const onGap = vi.fn();
    const gate = new TerminalOutputGate(onGap);
    gate.release(1, 10);
    expect(gate.accept(d('later', 25))).toEqual(['later']);
    expect(onGap).toHaveBeenCalledWith(10, 20);
  });

  it('reports no gap for contiguous deliveries', () => {
    const onGap = vi.fn();
    const gate = new TerminalOutputGate(onGap);
    gate.release(1, 10);
    gate.accept(d('abc', 13));
    gate.accept(d('de', 15));
    expect(onGap).not.toHaveBeenCalled();
  });
});
