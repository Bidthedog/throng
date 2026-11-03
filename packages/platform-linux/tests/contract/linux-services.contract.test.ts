import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, rmdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isLinuxHost,
  runDirectoryLockContract,
  runExecutableExtensionsContract,
  runPlatformInfoContract,
  runProcessMetricsContract,
  runRefusedUriSchemesContract,
  runShellDetectionContract,
  runUserDirectoriesContract,
  skipUnlessLinux,
} from '@throng/core/testing';
import {
  LinuxDirectoryLock,
  LinuxExecutableExtensions,
  LinuxFontEnumeration,
  LinuxGpuUsage,
  LinuxOrphanProcesses,
  LinuxPlatformInfo,
  LinuxProcessCwd,
  LinuxProcessMetrics,
  LinuxRefusedUriSchemes,
  LinuxShellDetection,
  LinuxUserDirectories,
  ensureOwnerOnlyDir,
  ipcDirectory,
  parseDrmFdinfo,
  parseStat,
} from '@throng/platform-linux';

/** Layer: contract. Each class meets the same shared suite as the Windows one, against the real `/proc`. */
const temp: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'throng-linux-'));
  temp.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tryIt = (fn: () => void): boolean => {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
};

describe.skipIf(skipUnlessLinux('these drive /proc and real Linux shells'))('Linux platform services (062 FR-006, FR-044)', () => {
  it('platform info', () => {
    runPlatformInfoContract(() => new LinuxPlatformInfo());
    expect(new LinuxPlatformInfo().osName()).toBe('linux');
  });

  it('shell detection reports only real files, with the login shell first', async () => {
    await runShellDetectionContract(() => new LinuxShellDetection(), { fileExists: existsSync });
    const dir = tempDir();
    for (const name of ['zsh', 'bash', 'rbash']) writeFileSync(join(dir, name), '#!/bin/sh\n', { mode: 0o755 });
    writeFileSync(join(dir, 'fish'), 'not executable', { mode: 0o644 });
    symlinkSync(join(dir, 'bash'), join(dir, 'sh'));
    const shells = await new LinuxShellDetection({
      readShellsFile: async () =>
        ['# comment', join(dir, 'bash'), join(dir, 'zsh'), join(dir, 'rbash'), join(dir, 'fish'), join(dir, 'sh'), '/nonexistent/ksh'].join('\n'),
      env: { SHELL: join(dir, 'zsh'), PATH: '' },
      passwdShell: () => undefined,
    }).detectInstalledShells();
    expect(shells.map((s) => s.id)).toEqual(['zsh', 'bash', 'sh']);
  });

  it('falls back to the account\'s shell when $SHELL is unset', async () => {
    const dir = tempDir();
    for (const name of ['zsh', 'bash']) writeFileSync(join(dir, name), '', { mode: 0o755 });
    const shells = await new LinuxShellDetection({
      readShellsFile: async () => [join(dir, 'bash'), join(dir, 'zsh')].join('\n'),
      env: { PATH: '' },
      passwdShell: () => join(dir, 'zsh'),
    }).detectInstalledShells();
    expect(shells[0]?.id).toBe('zsh');
  });

  it('process cwd reads the operating system, and a gone process is absent', async () => {
    const dir = tempDir();
    const child = spawn('sleep', ['30'], { cwd: dir, stdio: 'ignore' });
    try {
      await new Promise((resolve) => child.once('spawn', resolve));
      const cwds = await new LinuxProcessCwd().read([child.pid!, 0x7ffffff0]);
      expect(cwds.get(child.pid!)).toBe(dir);
      expect(cwds.has(0x7ffffff0)).toBe(false);
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('directory lock validates and records, and says it cannot hold a folder', async () => {
    await runDirectoryLockContract({
      make: () => new LinuxDirectoryLock(),
      makeDir: tempDir,
      nonExistentPath: () => join(tempDir(), 'missing'),
      tryDelete: (dir) =>
        tryIt(() => {
          rmdirSync(dir);
          mkdirSync(dir);
        }),
      tryRename: (dir) =>
        tryIt(() => {
          renameSync(dir, `${dir}.moved`);
          renameSync(`${dir}.moved`, dir);
        }),
      tryWriteInside: (dir) =>
        tryIt(() => {
          writeFileSync(join(dir, 'f'), 'x');
          rmSync(join(dir, 'f'));
        }),
      cleanup: (dir) => rmSync(dir, { recursive: true, force: true }),
      holdsAgainstRemoval: false,
    });
    expect(new LinuxDirectoryLock().heldPids()).toEqual([]);
  });

  it('executable extensions', () => {
    runExecutableExtensionsContract(() => new LinuxExecutableExtensions());
    expect(new LinuxExecutableExtensions().isExecutable('/p/run.SH')).toBe(true);
    expect(new LinuxExecutableExtensions().isExecutable('/p/notes.md')).toBe(false);
  });

  it('refused schemes', () => {
    runRefusedUriSchemesContract(() => new LinuxRefusedUriSchemes());
  });

  it('font enumeration answers with fontconfig\'s families, and an array whatever happens', async () => {
    const families = await new LinuxFontEnumeration().listInstalledFamilies();
    expect(Array.isArray(families)).toBe(true);
    expect(new Set(families).size).toBe(families.length);
  });

  it('the orphan sweep sees a Node process as node, whatever its thread is called (Node 24: MainThread)', async () => {
    const self = (await new LinuxOrphanProcesses().snapshot()).find((p) => p.pid === process.pid);
    expect(self?.name).toMatch(/^node/);
  });

  it('process metrics', async () => {
    await runProcessMetricsContract({
      make: () => new LinuxProcessMetrics(new LinuxGpuUsage(async () => [])),
      selfPid: process.pid,
    });
  });

  it('user directories', () => {
    runUserDirectoriesContract(() => new LinuxUserDirectories({ XDG_CONFIG_HOME: '/x/c', XDG_DATA_HOME: '/x/d' }));
  });
});

describe('Linux folders, pure rules (062 FR-013)', () => {
  it('follow XDG, with -dev variants, and ignore a relative value as the spec for XDG requires', () => {
    const d = new LinuxUserDirectories({ XDG_CONFIG_HOME: '/x/c', XDG_DATA_HOME: '/x/d' }, () => '/home/u');
    expect(d.configRoot(false)).toBe(join('/x/c', 'throng'));
    expect(d.configRoot(true)).toBe(join('/x/c', 'throng-dev'));
    expect(d.dataDir(false)).toBe(join('/x/d', 'throng'));
    const fallback = new LinuxUserDirectories({ XDG_CONFIG_HOME: 'relative' }, () => '/home/u');
    expect(fallback.configRoot(true)).toBe(join('/home/u', '.config', 'throng-dev'));
    expect(fallback.dataDir(true)).toBe(join('/home/u', '.local', 'share', 'throng-dev'));
  });

  it('put sockets in the session runtime folder, else a per-user one', () => {
    expect(ipcDirectory({ XDG_RUNTIME_DIR: '/run/user/9' }, 9)).toBe(join('/run/user/9', 'throng'));
    expect(ipcDirectory({}, 9)).toBe(join(tmpdir(), 'throng-9'));
  });
});

describe.skipIf(skipUnlessLinux('file modes are a POSIX fact'))('owner-only folders (062 FR-011, FR-013)', () => {
  it('are created private, and a loose one is tightened', () => {
    const dir = join(tempDir(), 'a');
    ensureOwnerOnlyDir(dir);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    mkdirSync(`${dir}-loose`, { mode: 0o755 });
    temp.push(`${dir}-loose`);
    ensureOwnerOnlyDir(`${dir}-loose`);
    expect(statSync(`${dir}-loose`).mode & 0o777).toBe(0o700);
  });

  it('refuse a folder that belongs to someone else', () => {
    const dir = tempDir();
    const notMe = (process.getuid?.() ?? 0) + 1;
    expect(() => ensureOwnerOnlyDir(dir, notMe)).toThrow(/another user/);
  });

  it('refuse a symlink, which could point anywhere', () => {
    const dir = tempDir();
    symlinkSync(tempDir(), join(dir, 'link'));
    expect(() => ensureOwnerOnlyDir(join(dir, 'link'))).toThrow(/not a folder/);
  });
});

describe('/proc parsing (062 FR-037)', () => {
  const units = { ticksPerSecond: 100, pageSize: 4096, bootTimeMs: 1_000_000 };

  it('counts fields from the last parenthesis, so a name holding spaces and brackets is safe', () => {
    const fields = ['S', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '50', '25', '13', '14', '15', '16', '17', '18', '700', '20', '33'];
    const row = parseStat(`4242 (we(ird) name) ${fields.join(' ')}`, units);
    expect(row).toMatchObject({ pid: 4242, ppid: 1, pgrp: 2, comm: 'we(ird) name', state: 'S', cpuTicks: 75, rssPages: 33 });
    expect(row?.startedAt).toBe(1_000_000 + 7000);
  });

  it('answers null for anything else', () => {
    expect(parseStat('garbage', units)).toBeNull();
  });

  it('reads DRM usage from fdinfo, and nothing from a descriptor that is not a GPU client', () => {
    expect(parseDrmFdinfo('pos:\t0\nflags:\t02\n')).toBeNull();
    expect(parseDrmFdinfo('drm-driver:\ti915\ndrm-client-id:\t7\ndrm-engine-render:\t100 ns\ndrm-engine-video:\t20 ns\n')).toEqual({
      client: '7',
      engineNs: 120,
    });
  });

  it('keeps isLinuxHost honest', () => {
    expect(isLinuxHost()).toBe(process.platform === 'linux');
  });
});
