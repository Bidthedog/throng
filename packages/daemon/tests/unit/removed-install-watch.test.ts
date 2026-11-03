import { describe, expect, it } from 'vitest';
import { shouldExitForRemovedInstall } from '../../src/removed-install-watch.js';

describe('shouldExitForRemovedInstall (063 FR-013)', () => {
  const gone = { entryExists: false, clients: 0, liveSessions: 0 };

  it('ends a daemon whose files are gone and that nothing needs', () => {
    expect(shouldExitForRemovedInstall(gone)).toBe(true);
  });

  it.each([
    ['its files are still there, as after an upgrade', { ...gone, entryExists: true }],
    ['a window is still connected', { ...gone, clients: 1 }],
    ['a terminal is still running, because the shell is the user’s', { ...gone, liveSessions: 1 }],
  ])('keeps it while %s', (_label, state) => {
    expect(shouldExitForRemovedInstall(state)).toBe(false);
  });
});
