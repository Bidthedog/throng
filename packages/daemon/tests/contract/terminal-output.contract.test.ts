import { describe, expect, it } from 'vitest';
import { TERMINAL_OUTPUT_NOTIFICATION, type TerminalOutputNotification } from '@throng/ipc-contract';
import { TerminalEvents } from '../../src/terminal-events.js';

/**
 * Layer: contract — 061 contracts/terminal-output.md: the frame UI main parses off the events socket, and which
 * fields carry a delivery's session and position.
 */
describe('terminal.output (061 contract)', () => {
  it('carries the session and the position after its last character', () => {
    const events = new TerminalEvents();
    const frames: string[] = [];
    events.addSink({ write: (frame) => frames.push(frame) });

    events.publishOutput('p', 7, 'hello', 12);

    const expected: TerminalOutputNotification = { panelId: 'p', sessionId: 7, data: 'hello', end: 12 };
    expect(JSON.parse(frames[0]!)).toEqual({ jsonrpc: '2.0', method: TERMINAL_OUTPUT_NOTIFICATION, params: expected });
  });
});
