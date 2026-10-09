import { describe, expect, it } from 'vitest';
import { createWindowTitleScan, scanWindowTitle, type WindowTitleScan } from '@throng/core';

/**
 * 053 — the daemon follows a session's window title through its output, so a view re-attaching after the
 * replayed tail has lost the sequence (or on the alternate screen, with no tail at all) is still told it.
 */

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

const scanAll = (...chunks: string[]): WindowTitleScan =>
  chunks.reduce((scan, chunk) => scanWindowTitle(scan, chunk), createWindowTitleScan());

describe('scanWindowTitle', () => {
  it('reads OSC 0 and OSC 2, ended by BEL or ST', () => {
    expect(scanAll(`a${ESC}]0;one${BEL}b`).title).toBe('one');
    expect(scanAll(`${ESC}]2;two${ESC}\\`).title).toBe('two');
  });

  it('keeps the last title in a chunk', () => {
    expect(scanAll(`${ESC}]0;one${BEL}${ESC}]0;two${BEL}`).title).toBe('two');
  });

  it('an empty title clears it', () => {
    expect(scanAll(`${ESC}]0;one${BEL}`, `${ESC}]0;${BEL}`).title).toBe('');
  });

  it('follows a sequence split across chunks, at any point', () => {
    const whole = `x${ESC}]0;work on links${BEL}y`;
    for (let i = 1; i < whole.length; i += 1) {
      expect(scanAll(whole.slice(0, i), whole.slice(i)).title, `split at ${i}`).toBe('work on links');
    }
  });

  it('ignores other OSC sequences (OSC 9;9, OSC 8)', () => {
    expect(scanAll(`${ESC}]0;t${BEL}${ESC}]9;9;C:\\proj${BEL}${ESC}]8;;http://x${BEL}`).title).toBe('t');
  });

  it('does not carry an unterminated sequence forever', () => {
    const scan = scanAll(`${ESC}]0;${'z'.repeat(10_000)}`);
    expect(scan.carry.length).toBeLessThanOrEqual(1024);
    expect(scanWindowTitle(scan, `${BEL}${ESC}]0;next${BEL}`).title).toBe('next');
  });
});
