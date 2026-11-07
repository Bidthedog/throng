import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMouseReportCoalescer, isMouseMotionReport, MOUSE_MOTION_WINDOW_MS } from '@throng/core';

// #544 — a stall must queue one motion report, not thousands, and nothing but motion may be thinned or reordered.

const motion = (x: number, y = 1) => `\x1b[<35;${x};${y}M`;
const press = '\x1b[<0;10;5M';
const release = '\x1b[<0;10;5m';

describe('isMouseMotionReport', () => {
  it.each([
    ['motion, no button', '\x1b[<35;71;61M', true],
    ['drag with the left button', '\x1b[<32;4;4M', true],
    ['motion with Ctrl', '\x1b[<51;4;4M', true],
    ['left press', press, false],
    ['left release', release, false],
    ['wheel up', '\x1b[<64;4;4M', false],
    ['two reports in one write', `${motion(1)}${motion(2)}`, false],
    ['a key', 'a', false],
    ['an arrow key', '\x1b[A', false],
  ])('%s → %s', (_name, data, expected) => {
    expect(isMouseMotionReport(data)).toBe(expected);
  });
});

describe('createMouseReportCoalescer', () => {
  let sent: string[];
  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const make = () => createMouseReportCoalescer((d) => sent.push(d));

  it('a burst of motion reports goes out as the first and the latest', () => {
    const c = make();
    for (let i = 1; i <= 2000; i++) c.write(motion(i));
    expect(sent).toEqual([motion(1)]);
    vi.advanceTimersByTime(MOUSE_MOTION_WINDOW_MS);
    expect(sent).toEqual([motion(1), motion(2000)]);
  });

  it('motion slower than the window passes through untouched', () => {
    const c = make();
    for (let i = 1; i <= 5; i++) {
      c.write(motion(i));
      vi.advanceTimersByTime(MOUSE_MOTION_WINDOW_MS * 2);
    }
    expect(sent).toEqual([1, 2, 3, 4, 5].map((i) => motion(i)));
  });

  it('a click sends the waiting motion report first, then itself, and is never delayed', () => {
    const c = make();
    c.write(motion(1));
    c.write(motion(2));
    c.write(motion(3));
    c.write(press);
    c.write(release);
    expect(sent).toEqual([motion(1), motion(3), press, release]);
    vi.advanceTimersByTime(MOUSE_MOTION_WINDOW_MS * 3);
    expect(sent).toEqual([motion(1), motion(3), press, release]);
  });

  it('keystrokes are never thinned', () => {
    const c = make();
    for (const ch of 'hello') c.write(ch);
    expect(sent.join('')).toBe('hello');
  });

  it('dispose drops a waiting report and sends nothing more', () => {
    const c = make();
    c.write(motion(1));
    c.write(motion(2));
    c.dispose();
    vi.advanceTimersByTime(MOUSE_MOTION_WINDOW_MS * 2);
    c.write('x');
    expect(sent).toEqual([motion(1)]);
  });

  it('a write refused at the end of the window is absorbed, and the next window still works', () => {
    let refuse = false;
    const c = createMouseReportCoalescer((d) => {
      if (refuse) throw new Error('ending');
      sent.push(d);
    });
    c.write(motion(1));
    c.write(motion(2));
    refuse = true;
    expect(() => vi.advanceTimersByTime(MOUSE_MOTION_WINDOW_MS)).not.toThrow();
    refuse = false;
    vi.advanceTimersByTime(MOUSE_MOTION_WINDOW_MS);
    c.write(motion(3));
    expect(sent).toEqual([motion(1), motion(3)]);
  });
});
