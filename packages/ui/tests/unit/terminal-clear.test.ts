import { describe, it, expect } from 'vitest';
import {
  isScreenClear,
  shouldDropScrollback,
  RESIZE_REPAINT_WINDOW_MS,
} from '../../src/renderer/terminal/clear-detect.js';

// The real bytes ConPTY emits for `cls` (captured from node-pty + cmd.exe):
// hide-cursor, cursor-home, then a run of line-erases that repaint the viewport.
const CMD_CLS =
  '\x1b[25l\x1b[H\x1b[K\r\n' +
  'C:\\Users\\x>\x1b[K\r\n' +
  '\x1b[K\r\n'.repeat(22) +
  '\x1b[K\x1b[2;38H\x1b[?25h';

describe('isScreenClear (cls/clear scrollback detection)', () => {
  it('detects the cmd `cls` repaint (cursor-home + many line erases)', () => {
    expect(isScreenClear(CMD_CLS)).toBe(true);
  });

  it('detects a plain ED-2 clear (bash `clear`, etc.)', () => {
    expect(isScreenClear('\x1b[2J\x1b[H')).toBe(true);
  });

  it('detects a full RIS reset', () => {
    expect(isScreenClear('\x1bc')).toBe(true);
  });

  it('does not fire on ordinary output', () => {
    expect(isScreenClear('hello world\r\n')).toBe(false);
    expect(isScreenClear('C:\\Users\\x>\x1b[K')).toBe(false); // a single prompt-line erase
  });

  it('does not fire on a PSReadLine partial repaint (home + a few erases)', () => {
    // PowerShell repaints the prompt/input region constantly while scrolling — a
    // handful of erases, not a near-full-screen clear.
    expect(isScreenClear('\x1b[H' + '\x1b[K\r\n'.repeat(4), 24)).toBe(false);
  });

  it('does not fire when entering the alt screen (full-screen TUIs keep scrollback)', () => {
    expect(isScreenClear('\x1b[?1049h\x1b[H' + '\x1b[K'.repeat(20))).toBe(false);
  });
});

// Growing a terminal makes ConPTY repaint the whole (larger) viewport: cursor-home
// plus one line-erase per row — byte-for-byte the same SHAPE as a `cls`. So the
// scrollback-drop must be suppressed for a brief window right after a resize, or
// enlarging a Panel wipes all its content (regression: resize loses terminal text).
const RESIZE_REPAINT = '\x1b[H' + '\x1b[K\r\n'.repeat(40); // home + 40 erases (grow to 40 rows)

describe('shouldDropScrollback (do not treat a resize repaint as a clear)', () => {
  it('suppresses the scrollback drop during the post-resize repaint window', () => {
    // isScreenClear alone would call this a clear...
    expect(isScreenClear(RESIZE_REPAINT, 40)).toBe(true);
    // ...but right after a resize it is the resize repaint, so keep the scrollback.
    expect(shouldDropScrollback(RESIZE_REPAINT, 40, 0)).toBe(false);
    expect(shouldDropScrollback(RESIZE_REPAINT, 40, RESIZE_REPAINT_WINDOW_MS - 1)).toBe(false);
  });

  it('still drops scrollback for a real clear once the repaint window has passed', () => {
    expect(shouldDropScrollback(RESIZE_REPAINT, 40, RESIZE_REPAINT_WINDOW_MS)).toBe(true);
    expect(shouldDropScrollback(CMD_CLS, 24, 10_000)).toBe(true);
  });

  it('never drops scrollback on ordinary output, resize window or not', () => {
    expect(shouldDropScrollback('hello world\r\n', 24, 0)).toBe(false);
    expect(shouldDropScrollback('hello world\r\n', 24, 10_000)).toBe(false);
  });
});
