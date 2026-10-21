import { describe, expect, it } from 'vitest';
import { isTerminalReport } from '../../src/terminal/attention-scan.js';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

describe('isTerminalReport — bytes xterm sends by itself, which are not the user typing', () => {
  it.each([
    ['a device attributes reply', `${ESC}[?1;2c`],
    ['a secondary device attributes reply', `${ESC}[>0;276;0c`],
    ['a cursor position report', `${ESC}[24;80R`],
    ['a status report', `${ESC}[0n`],
    ['a kitty keyboard flags reply', `${ESC}[?0u`],
    ['a focus-in report', `${ESC}[I`],
    ['a focus-out report', `${ESC}[O`],
    ['an SGR mouse report', `${ESC}[<0;10;5M`],
    ['an SGR mouse release', `${ESC}[<0;10;5m`],
    ['a mode report', `${ESC}[?2004;1$y`],
    ['an OSC colour reply ended by BEL', `${ESC}]10;rgb:ffff/ffff/ffff${BEL}`],
    ['an OSC reply ended by ST', `${ESC}]11;rgb:0000/0000/0000${ESC}\\`],
    ['a DCS reply', `${ESC}P1$r0m${ESC}\\`],
    ['several reports in one write', `${ESC}[I${ESC}[?1;2c${ESC}[24;80R`],
  ])('%s', (_name, data) => {
    expect(isTerminalReport(data)).toBe(true);
  });

  it.each([
    ['typed text', 'ls\r'],
    ['a single key', 'a'],
    ['an arrow key', `${ESC}[A`],
    ['a modified arrow key', `${ESC}[1;5C`],
    ['a function key', `${ESC}[15~`],
    ['an Alt chord', `${ESC}x`],
    ['a report mixed with typing', `${ESC}[I` + 'x'],
    ['an empty write', ''],
    ['a bare escape', ESC],
  ])('%s is user input', (_name, data) => {
    expect(isTerminalReport(data)).toBe(false);
  });
});
