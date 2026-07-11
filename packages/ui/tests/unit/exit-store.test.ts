import { describe, it, expect, beforeEach } from 'vitest';
import {
  setPanelExit,
  getPanelExit,
  clearPanelExit,
  dismissPanelExit,
  getVisiblePanelExit,
  isPanelExitDismissed,
} from '../../src/renderer/terminal/exit-store.js';

// 011 US1: the terminal exit notice can be DISMISSED independently of clearing the
// form. Dismissing hides the notice without clearing the underlying exit record or
// touching the form draft; a fresh exit re-shows the notice (recurrence, FR-003).

const P = 'panel-exit-test';

describe('exit-store dismiss decoupling (011 US1)', () => {
  beforeEach(() => clearPanelExit(P));

  it('a set exit is visible until dismissed', () => {
    setPanelExit(P, { message: 'boom' });
    expect(getVisiblePanelExit(P)?.message).toBe('boom');
    dismissPanelExit(P);
    expect(getVisiblePanelExit(P)).toBeUndefined();
    // The underlying record is NOT cleared — dismissal only hides it.
    expect(getPanelExit(P)?.message).toBe('boom');
    expect(isPanelExitDismissed(P)).toBe(true);
  });

  it('a fresh exit re-shows the notice after a prior dismissal (recurrence)', () => {
    setPanelExit(P, { message: 'first' });
    dismissPanelExit(P);
    expect(getVisiblePanelExit(P)).toBeUndefined();

    setPanelExit(P, { message: 'second' });
    expect(getVisiblePanelExit(P)?.message).toBe('second');
    expect(isPanelExitDismissed(P)).toBe(false);
  });

  it('clearing the exit removes both the record and the dismissed flag', () => {
    setPanelExit(P, { message: 'x' });
    dismissPanelExit(P);
    clearPanelExit(P);
    expect(getPanelExit(P)).toBeUndefined();
    expect(getVisiblePanelExit(P)).toBeUndefined();
    expect(isPanelExitDismissed(P)).toBe(false);
  });
});
