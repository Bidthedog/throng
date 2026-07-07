import { describe, it, expect } from 'vitest';
import { resolveShellFile, type ShellProbe, type ShellResolver } from '@throng/core';

/** In-memory resolver: `disk` is the set of existing paths; `path` maps exe→resolved
 *  PATH hit; `registry` maps key→dir. `join` uses a simple backslash join. */
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
    join: (dir, sub) => `${dir}\\${sub}`,
  };
}

describe('resolveShellFile (FR-024 — ordered well-known → PATH → registry)', () => {
  const probes: ShellProbe[] = [
    { kind: 'path', value: 'C:\\Program Files\\Git\\bin\\bash.exe' },
    { kind: 'onPath', exe: 'bash.exe' },
    { kind: 'registry', key: 'HKLM\\SOFTWARE\\GitForWindows', append: 'bin\\bash.exe' },
  ];

  it('returns the well-known path when it exists (first probe wins)', () => {
    const r = fakeResolver({
      disk: ['C:\\Program Files\\Git\\bin\\bash.exe', 'D:\\alt\\bash.exe'],
      path: { 'bash.exe': 'D:\\alt\\bash.exe' },
      registry: { 'HKLM\\SOFTWARE\\GitForWindows': 'E:\\git' },
    });
    expect(resolveShellFile(probes, r)).toBe('C:\\Program Files\\Git\\bin\\bash.exe');
  });

  it('falls back to the PATH hit when the well-known path is absent', () => {
    const r = fakeResolver({ disk: ['D:\\alt\\bash.exe'], path: { 'bash.exe': 'D:\\alt\\bash.exe' } });
    expect(resolveShellFile(probes, r)).toBe('D:\\alt\\bash.exe');
  });

  it('falls back to the registry install path (joined + existing) when path & PATH miss', () => {
    const r = fakeResolver({
      disk: ['E:\\git\\bin\\bash.exe'],
      registry: { 'HKLM\\SOFTWARE\\GitForWindows': 'E:\\git' },
    });
    expect(resolveShellFile(probes, r)).toBe('E:\\git\\bin\\bash.exe');
  });

  it('ignores a registry value whose joined executable does not exist (no false positive)', () => {
    const r = fakeResolver({ registry: { 'HKLM\\SOFTWARE\\GitForWindows': 'E:\\ghost' } });
    expect(resolveShellFile(probes, r)).toBeNull();
  });

  it('returns null when no probe resolves', () => {
    expect(resolveShellFile(probes, fakeResolver({}))).toBeNull();
  });
});
