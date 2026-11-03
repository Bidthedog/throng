import { describe, expect, it } from 'vitest';
import { WATCH_LIMIT_REASON, watchFailureMessage } from '@throng/core';

describe('a project past the machine\'s watch limit (062 T029)', () => {
  it('says what is wrong and names the setting that resolves it', () => {
    const message = watchFailureMessage(WATCH_LIMIT_REASON);
    expect(message).toContain('fs.inotify.max_user_watches');
    expect(message).not.toMatch(/ENOSPC/);
  });

  it('keeps the sentence every other failure has always had', () => {
    expect(watchFailureMessage('EPERM')).toBe(
      'Live updates have stopped for this project. Reopen it to resume watching for changes.',
    );
  });
});
