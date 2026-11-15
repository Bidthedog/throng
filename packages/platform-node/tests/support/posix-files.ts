/**
 * Real files for the file-attribute and access-info contract suites (070 T030, T031), shared by Linux's and macOS's
 * test files. Each call makes a fresh file in one scratch folder; `cleanUp` removes the folder.
 */
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

/** An id no account or group has on a runner or a developer machine. */
export const UNUSED_ID = 2_147_483_000;

export function scratchFiles(): {
  plainFile(): Promise<string>;
  readOnlyFile(): Promise<string>;
  dotFile(): Promise<string>;
  missingPath(): string;
  ownStats(): Promise<{ uid: number; gid: number; mode: number }>;
  readonly userName: string;
  cleanUp(): void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'throng-attrs-'));
  let n = 0;
  const fresh = (name: string): string => {
    n += 1;
    const path = join(dir, `${name}${n}.txt`);
    writeFileSync(path, 'x');
    return path;
  };
  return {
    plainFile: async () => fresh('plain'),
    readOnlyFile: async () => {
      const path = fresh('locked');
      chmodSync(path, 0o444);
      return path;
    },
    dotFile: async () => fresh('.hidden'),
    missingPath: () => join(dir, 'missing.txt'),
    ownStats: async () => statSync(fresh('own')),
    userName: userInfo().username,
    cleanUp: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
