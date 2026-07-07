import { describe, it, expect } from 'vitest';
import { isBusy, shouldCloseOnOwnerClose, attachDecision } from '@throng/core';

describe('terminal idle/busy lifecycle (FR-015a/b, research D12)', () => {
  it('is busy when a non-shell descendant process lives', () => {
    expect(isBusy([4321])).toBe(true);
    expect(isBusy([4321, 9999])).toBe(true);
  });

  it('is idle when the shell has no descendants', () => {
    expect(isBusy([])).toBe(false);
  });

  it('keeps a busy terminal but closes an idle one on project/app close', () => {
    // busy → keep running in the background (survives the close)
    expect(shouldCloseOnOwnerClose([1234])).toBe(false);
    // idle → close (cold-respawn on reopen)
    expect(shouldCloseOnOwnerClose([])).toBe(true);
  });

  it('reattaches when the daemon still holds the session, else cold-starts', () => {
    expect(attachDecision(true)).toBe('reattach');
    expect(attachDecision(false)).toBe('cold-start');
  });
});
