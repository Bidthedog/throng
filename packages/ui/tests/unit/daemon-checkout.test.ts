import { describe, expect, it } from 'vitest';
import { checkoutOfDaemonEntry } from '../../src/main/daemon-lifecycle.js';

/** #533 — the checkout a foreign dev daemon belongs to, as the notice names it. */
describe('checkoutOfDaemonEntry', () => {
  it('is the folder holding packages/daemon/dist/main.js, whichever separator', () => {
    expect(checkoutOfDaemonEntry('D:\\git\\throng\\.claude\\worktrees\\S055\\packages\\daemon\\dist\\main.js')).toBe(
      'D:\\git\\throng\\.claude\\worktrees\\S055',
    );
    expect(checkoutOfDaemonEntry('D:/git/throng/packages/daemon/dist/main.js')).toBe('D:/git/throng');
  });

  it('is the entry itself when it is not laid out as a checkout', () => {
    expect(checkoutOfDaemonEntry('C:\\elsewhere\\main.js')).toBe('C:\\elsewhere\\main.js');
  });
});
