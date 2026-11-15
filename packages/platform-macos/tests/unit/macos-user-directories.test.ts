import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runUserDirectoriesContract, skipOnWindows } from '@throng/core/testing';
import { MacosUserDirectories } from '../../src/macos-user-directories.js';

const HOME = '/Users/dev';

describe('MacosUserDirectories (070 FR-014, research R5)', () => {
  const dirs = new MacosUserDirectories(() => HOME);

  it('passes the shared user-directories contract', () => {
    runUserDirectoriesContract(() => dirs);
  });

  it('keeps data in Application Support, apart for a dev run', () => {
    expect(dirs.dataDir(false)).toBe('/Users/dev/Library/Application Support/throng');
    expect(dirs.dataDir(true)).toBe('/Users/dev/Library/Application Support/throng-dev');
  });

  it('keeps settings in a folder of their own inside it', () => {
    expect(dirs.configRoot(false)).toBe('/Users/dev/Library/Application Support/throng/settings');
    expect(dirs.configRoot(true)).toBe('/Users/dev/Library/Application Support/throng-dev/settings');
  });

  it('puts logs in ~/Library/Logs, where Console.app looks', () => {
    expect(dirs.logDir(false)).toBe('/Users/dev/Library/Logs/throng');
    expect(dirs.logDir(true)).toBe('/Users/dev/Library/Logs/throng-dev');
  });

  it.skipIf(skipOnWindows('Windows has no POSIX owner-only mode for chmod to set'))('prepares a folder owner-only', () => {
    const base = mkdtempSync(join(tmpdir(), 'throng-macos-dirs-'));
    try {
      const dir = join(base, 'data');
      dirs.prepare(dir);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
