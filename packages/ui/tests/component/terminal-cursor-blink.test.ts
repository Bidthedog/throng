import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachCursorBlink } from '../../src/renderer/terminal/cursor-blink.js';

/**
 * A terminal's cursor blinks from a timer that runs only while the terminal has focus.
 *
 * Layer: component. xterm's DOM renderer blinks with an infinite CSS animation, which keeps the renderer
 * producing a frame for every frame the display offers; that cost is measured by hand and recorded in the
 * commit. Focus, the timer, the attribute and the stylesheet are all a DOM can see.
 *
 * ANTI-VACUITY CONTROL: stop restarting on a render of the cursor's row and "restarts" fails; start the
 * timer without waiting for focus and "no timer" fails.
 */

const OFF = 'data-cursor-off';

function fakeTerminal() {
  const element = document.createElement('div');
  const rows = document.createElement('div');
  rows.className = 'xterm-rows';
  const textarea = document.createElement('textarea');
  element.append(rows, textarea);
  document.body.append(element);
  let render: ((e: { start: number; end: number }) => void) | undefined;
  const disposeRender = vi.fn();
  const term = {
    element,
    textarea,
    options: { theme: { cursor: '#abcdef' } as { cursor?: string } },
    buffer: { active: { cursorY: 5 } },
    onRender: (cb: (e: { start: number; end: number }) => void) => {
      render = cb;
      return { dispose: disposeRender };
    },
  };
  return { term, rows, textarea, disposeRender, fireRender: (start: number, end: number) => render?.({ start, end }) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('attachCursorBlink', () => {
  it('runs no timer until the terminal has focus, and none after it loses it', () => {
    const t = fakeTerminal();
    attachCursorBlink(t.term);
    expect(vi.getTimerCount()).toBe(0);
    t.textarea.focus();
    expect(vi.getTimerCount()).toBe(1);
    t.textarea.blur();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts blinking at once when it is attached to a terminal already focused', () => {
    const t = fakeTerminal();
    t.textarea.focus();
    attachCursorBlink(t.term);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('turns the cursor off and on every half second, as xterm does', () => {
    const t = fakeTerminal();
    attachCursorBlink(t.term);
    t.textarea.focus();
    expect(t.rows).not.toHaveAttribute(OFF);
    vi.advanceTimersByTime(500);
    expect(t.rows).toHaveAttribute(OFF);
    vi.advanceTimersByTime(500);
    expect(t.rows).not.toHaveAttribute(OFF);
  });

  it('leaves the cursor showing when focus goes during the off half', () => {
    const t = fakeTerminal();
    attachCursorBlink(t.term);
    t.textarea.focus();
    vi.advanceTimersByTime(500);
    t.textarea.blur();
    expect(t.rows).not.toHaveAttribute(OFF);
  });

  it('restarts with the cursor showing when the cursor row renders, so it is solid while typing', () => {
    const t = fakeTerminal();
    attachCursorBlink(t.term);
    t.textarea.focus();
    vi.advanceTimersByTime(500);
    t.fireRender(5, 5);
    expect(t.rows).not.toHaveAttribute(OFF);
    vi.advanceTimersByTime(499);
    expect(t.rows).not.toHaveAttribute(OFF);
    vi.advanceTimersByTime(1);
    expect(t.rows).toHaveAttribute(OFF);
  });

  it('does not restart for a render that misses the cursor row', () => {
    const t = fakeTerminal();
    attachCursorBlink(t.term);
    t.textarea.focus();
    vi.advanceTimersByTime(500);
    t.fireRender(0, 4);
    expect(t.rows).toHaveAttribute(OFF);
  });

  it('gives the off half the theme cursor colour, read when it turns off', () => {
    const t = fakeTerminal();
    attachCursorBlink(t.term);
    t.textarea.focus();
    t.term.options.theme = { cursor: '#123456' };
    vi.advanceTimersByTime(500);
    expect(t.rows.style.getPropertyValue('--throng-terminal-cursor')).toBe('#123456');
  });

  it('releases everything when disposed', () => {
    const t = fakeTerminal();
    const dispose = attachCursorBlink(t.term);
    t.textarea.focus();
    vi.advanceTimersByTime(500);
    dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(t.disposeRender).toHaveBeenCalledOnce();
    expect(t.rows).not.toHaveAttribute(OFF);
    t.textarea.blur();
    t.textarea.focus();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('turns off xterm’s animation and draws the off half for every cursor style', () => {
    const css = readFileSync(join(process.cwd(), 'packages/ui/src/renderer/terminal/terminal.css'), 'utf8');
    expect(css).toMatch(/\.xterm-cursor-blink \{\s*animation: none !important;/);
    expect(css).toMatch(/\[data-cursor-off\] \.xterm-cursor-blink\.xterm-cursor-block \{\s*background-color: inherit !important;\s*color: var\(--throng-terminal-cursor, inherit\) !important;/);
    expect(css).toMatch(/\[data-cursor-off\] \.xterm-cursor-blink\.xterm-cursor-underline \{\s*border-bottom-style: hidden !important;/);
    expect(css).toMatch(/\[data-cursor-off\] \.xterm-cursor-blink\.xterm-cursor-bar \{\s*box-shadow: none !important;/);
  });
});
