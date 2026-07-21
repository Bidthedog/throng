import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveTerminalViewState,
  takeTerminalViewState,
  clearTerminalViewState,
  type TerminalViewState,
} from '../../src/renderer/terminal/terminal-view-state.js';

const state = (offsetFromBottom: number): TerminalViewState => ({
  offsetFromBottom,
  selection: { start: { x: 1, y: 3 }, end: { x: 5, y: 3 } },
});

describe('terminal view-state store (#144 follow-up)', () => {
  beforeEach(() => {
    clearTerminalViewState('t1');
    clearTerminalViewState('t2');
  });

  it('carries a saved scroll offset + selection across an unmount → remount', () => {
    saveTerminalViewState('t1', state(12));
    expect(takeTerminalViewState('t1')).toEqual(state(12));
  });

  it('consumes the saved state so it restores only once', () => {
    saveTerminalViewState('t1', state(3));
    expect(takeTerminalViewState('t1')).toBeDefined();
    expect(takeTerminalViewState('t1')).toBeUndefined();
  });

  it('keeps per-panel state independent', () => {
    saveTerminalViewState('t1', state(1));
    saveTerminalViewState('t2', state(2));
    expect(takeTerminalViewState('t2')?.offsetFromBottom).toBe(2);
    expect(takeTerminalViewState('t1')?.offsetFromBottom).toBe(1);
  });

  it('clears saved state when the terminal is destroyed for good', () => {
    saveTerminalViewState('t1', state(9));
    clearTerminalViewState('t1');
    expect(takeTerminalViewState('t1')).toBeUndefined();
  });

  it('allows a saved state with no selection', () => {
    saveTerminalViewState('t1', { offsetFromBottom: 0 });
    expect(takeTerminalViewState('t1')).toEqual({ offsetFromBottom: 0 });
  });
});
