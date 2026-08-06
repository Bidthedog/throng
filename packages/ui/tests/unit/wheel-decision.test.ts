import { describe, expect, it } from 'vitest';
import { decideWheel, MOUSE_REPORTING_MODES, createMouseReportingState } from '@throng/core';

/**
 * 028 (#187) — the mouse wheel is dead over a full-screen program.
 *
 * xterm scrolls the viewport on the NORMAL buffer. The alternate screen has no scrollback, so xterm
 * forwards wheel notches as arrow keys only when the program enables DEC private mode 1007
 * (alternate scroll). Claude Code does not, so the wheel reaches xterm, xterm has nothing to scroll
 * and no mandate to translate, and nothing happens at all — the reported bug.
 *
 * throng decides explicitly instead (FR-035/035a). This is the whole decision, kept pure so the
 * four cases are pinned without a DOM.
 */
describe('decideWheel', () => {
  it('zooms when the zoom modifier is held, whatever the buffer (FR-033)', () => {
    expect(decideWheel({ altBuffer: false, mouseReporting: false, ctrlKey: true })).toBe('zoom');
    expect(decideWheel({ altBuffer: true, mouseReporting: true, ctrlKey: true })).toBe('zoom');
  });

  it('gives the wheel to a program that claimed mouse reporting (FR-032)', () => {
    expect(decideWheel({ altBuffer: true, mouseReporting: true, ctrlKey: false })).toBe('program');
    expect(decideWheel({ altBuffer: false, mouseReporting: true, ctrlKey: false })).toBe('program');
  });

  it('translates to arrow keys on the alternate screen when the program has not claimed the mouse (FR-035)', () => {
    expect(decideWheel({ altBuffer: true, mouseReporting: false, ctrlKey: false })).toBe('arrows');
  });

  it('scrolls the viewport on the normal buffer (FR-030)', () => {
    expect(decideWheel({ altBuffer: false, mouseReporting: false, ctrlKey: false })).toBe('viewport');
  });

  it('never sends arrows on the normal buffer — a wheel must not type at a shell prompt (FR-035c)', () => {
    for (const mouseReporting of [true, false]) {
      for (const ctrlKey of [true, false]) {
        expect(decideWheel({ altBuffer: false, mouseReporting, ctrlKey })).not.toBe('arrows');
      }
    }
  });
});

describe('createMouseReportingState', () => {
  it('tracks each mouse-reporting mode being set and reset', () => {
    for (const mode of MOUSE_REPORTING_MODES) {
      const state = createMouseReportingState();
      expect(state.apply([mode], true)).toBe(true);
      expect(state.apply([mode], false)).toBe(false);
    }
  });

  it('ignores modes that are not mouse reporting', () => {
    const state = createMouseReportingState();
    expect(state.apply([9001], true)).toBe(false); // win32-input-mode
    expect(state.apply([25, 2004], true)).toBe(false); // cursor visibility, bracketed paste
  });

  it('stays on while any reporting mode remains set', () => {
    const state = createMouseReportingState();
    state.apply([1000], true);
    state.apply([1006], true);
    expect(state.apply([1006], false)).toBe(true); // 1000 is still live
    expect(state.apply([1000], false)).toBe(false);
  });

  it('handles a single sequence carrying several modes', () => {
    const state = createMouseReportingState();
    expect(state.apply([1002, 1006], true)).toBe(true);
    expect(state.isOn()).toBe(true);
  });

  it('a program disabling a mode it never set does not release the mouse', () => {
    const state = createMouseReportingState();
    state.apply([1002], true);
    expect(state.apply([1003], false)).toBe(true);
  });
});
