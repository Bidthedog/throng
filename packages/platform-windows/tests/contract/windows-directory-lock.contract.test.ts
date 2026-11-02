import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { runDirectoryLockContract } from '@throng/core/testing';
import { WindowsDirectoryLock } from '@throng/platform-windows';

describe('WindowsDirectoryLock', () => {
  it('satisfies the IDirectoryLock contract over real temp directories', async () => {
    let counter = 0;
    await runDirectoryLockContract({
      make: () => new WindowsDirectoryLock(),
      makeDir: () => mkdtempSync(join(tmpdir(), 'throng-lock-')),
      nonExistentPath: () => join(tmpdir(), `throng-lock-missing-${Date.now()}-${counter++}`),
      tryDelete: (dir) => {
        // Retry briefly: a held lock keeps failing, and every refused delete pays the whole back-off,
        // so keep it short. A just-released dir needs no long retry: release() polls until the OS has
        // freed the directory (windows-directory-lock.ts).
        try {
          rmSync(dir, { recursive: true, maxRetries: 3, retryDelay: 25 });
          return true;
        } catch {
          return false;
        }
      },
      tryRename: (dir) => {
        try {
          renameSync(dir, `${dir}-renamed`);
          return true;
        } catch {
          return false;
        }
      },
      tryWriteInside: (dir) => {
        try {
          writeFileSync(join(dir, 'inside.txt'), 'ok');
          return true;
        } catch {
          return false;
        }
      },
      cleanup: (dir) => {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        rmSync(`${dir}-renamed`, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      },
    });
  });
});
