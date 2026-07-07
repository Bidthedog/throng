import { describe, it, expect } from 'vitest';
import { TerminalOutputGate } from '../../src/renderer/terminal/output-gate.js';

// Bug: `useTerminal` subscribes to live PTY output BEFORE `attach()` resolves, and
// the replayed scrollback only arrives with that resolution — on a SEPARATE socket
// from the live-output stream. On a reattach/mirror to an already-running, actively
// producing session, a live chunk can arrive before the scrollback and, written
// straight to xterm, lands ABOVE the older backlog (visible corruption). The gate
// buffers live output until scrollback is applied, then flushes in arrival order.
describe('TerminalOutputGate (scrollback-before-live-output ordering)', () => {
  it('buffers live chunks that arrive before scrollback, then flushes them after it in order', () => {
    const gate = new TerminalOutputGate();
    const writes: string[] = [];

    // Live output arrives DURING the attach window (before scrollback resolves).
    for (const chunk of ['live-A', 'live-B']) {
      if (gate.accept(chunk)) writes.push(chunk); // would write immediately (the bug)
    }
    // Nothing written yet — the gate held them back.
    expect(writes).toEqual([]);

    // attach() resolves: scrollback is applied first, then the buffered chunks.
    writes.push('SCROLLBACK');
    for (const chunk of gate.release()) writes.push(chunk);

    expect(writes).toEqual(['SCROLLBACK', 'live-A', 'live-B']);
  });

  it('passes chunks straight through once open (cold start: empty scrollback)', () => {
    const gate = new TerminalOutputGate();
    gate.release(); // scrollback applied (nothing buffered)
    expect(gate.isOpen).toBe(true);
    expect(gate.accept('live')).toBe(true); // write now, no buffering
  });

  it('release is idempotent and never replays already-flushed chunks', () => {
    const gate = new TerminalOutputGate();
    gate.accept('x');
    expect(gate.release()).toEqual(['x']);
    expect(gate.release()).toEqual([]); // a second resolution is a no-op
    expect(gate.accept('y')).toBe(true); // and the gate stays open
  });
});
