import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { runDirectoryLockContract } from '@throng/core/testing';
import { WindowsDirectoryLock } from '@throng/platform-windows';

describe('WindowsDirectoryLock', () => {
  it('satisfies the IDirectoryLock contract over real temp directories', () => {
    let counter = 0;
    runDirectoryLockContract({
      make: () => new WindowsDirectoryLock(),
      makeDir: () => mkdtempSync(join(tmpdir(), 'throng-lock-')),
      nonExistentPath: () => join(tmpdir(), `throng-lock-missing-${Date.now()}-${counter++}`),
      tryDelete: (dir) => {
        // Retry briefly: a held lock keeps failing, while a just-released dir
        // becomes deletable once the OS finishes releasing the handle (a few ms
        // after the holder process exits).
        try {
          rmSync(dir, { recursive: true, maxRetries: 12, retryDelay: 60 });
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
