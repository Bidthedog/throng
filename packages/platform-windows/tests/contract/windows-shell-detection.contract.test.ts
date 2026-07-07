import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { runShellDetectionContract } from '@throng/core/testing';
import type { ShellResolver } from '@throng/core';
import { WindowsShellDetection } from '@throng/platform-windows';

describe('WindowsShellDetection', () => {
  it('satisfies the shared IShellDetection contract on this machine (no false positives)', async () => {
    await expect(
      runShellDetectionContract(() => new WindowsShellDetection(), { fileExists: existsSync }),
    ).resolves.toBeUndefined();
  });

  it('returns only shells whose executable actually exists', async () => {
    const shells = await new WindowsShellDetection().detectInstalledShells();
    for (const shell of shells) {
      expect(existsSync(shell.file)).toBe(true);
    }
  });

  it('detects Command Prompt, which is always present on Windows', async () => {
    const shells = await new WindowsShellDetection().detectInstalledShells();
    expect(shells.map((s) => s.id)).toContain('cmd');
  });
});

/** A fully in-memory ShellResolver so FR-024's ordered resolution can be exercised
 *  deterministically (independent of what is really installed on the runner). */
function fakeResolver(opts: {
  disk?: string[];
  path?: Record<string, string>;
  registry?: Record<string, string>;
}): ShellResolver {
  const disk = new Set(opts.disk ?? []);
  return {
    exists: (p) => disk.has(p),
    onPath: (exe) => opts.path?.[exe] ?? null,
    readRegistry: (key) => opts.registry?.[key] ?? null,
    join: (dir, sub) => path.join(dir, sub),
  };
}

describe('WindowsShellDetection — FR-024 non-default Git installs', () => {
  it('detects Git Bash from the Git-for-Windows registry key when not at a default path', async () => {
    const resolver = fakeResolver({
      disk: [path.join('E:\\git', 'bin\\bash.exe')], // only the registry-resolved exe exists
      registry: { 'HKLM\\SOFTWARE\\GitForWindows': 'E:\\git' },
    });
    const shells = await new WindowsShellDetection(resolver).detectInstalledShells();
    const git = shells.find((s) => s.id === 'git-bash');
    expect(git?.file).toBe(path.join('E:\\git', 'bin\\bash.exe'));
    // Nothing else resolves → no false positives.
    expect(shells.map((s) => s.id)).toEqual(['git-bash']);
  });

  it('detects Git Bash present only on PATH', async () => {
    const onPathBash = 'D:\\tools\\git\\bin\\bash.exe';
    const resolver = fakeResolver({ disk: [onPathBash], path: { 'bash.exe': onPathBash } });
    const shells = await new WindowsShellDetection(resolver).detectInstalledShells();
    expect(shells.find((s) => s.id === 'git-bash')?.file).toBe(onPathBash);
  });

  it('lists nothing when no probe resolves (no false positives)', async () => {
    const shells = await new WindowsShellDetection(fakeResolver({})).detectInstalledShells();
    expect(shells).toEqual([]);
  });
});
