import { describe, it, expect } from 'vitest';
import {
  mergeFlavours,
  resolveDefaultParams,
  BUILTIN_FLAVOUR_DEFAULT_PARAMS,
  type DetectedShell,
  type TerminalSettings,
} from '@throng/core';

const DETECTED: DetectedShell[] = [
  { id: 'windows-powershell', label: 'Windows PowerShell', file: 'C:/pwsh5/powershell.exe', defaultArgs: [] },
  { id: 'cmd', label: 'Command Prompt', file: 'C:/Windows/System32/cmd.exe', defaultArgs: [] },
];

function settings(overrides: Partial<TerminalSettings> = {}): TerminalSettings {
  return { flavours: [], disabledBuiltins: [], defaultParams: {}, ...overrides };
}

describe('mergeFlavours (builtins ∩ installed − disabled ∪ user, dedupe user-wins)', () => {
  it('maps detected built-ins to flavours with their catalogue default params', () => {
    const merged = mergeFlavours(DETECTED, settings());
    expect(merged.map((f) => f.id).sort()).toEqual(['cmd', 'windows-powershell']);
    const cmd = merged.find((f) => f.id === 'cmd')!;
    expect(cmd.source).toBe('builtin');
    expect(cmd.defaultParams).toBe(BUILTIN_FLAVOUR_DEFAULT_PARAMS.cmd);
    expect(cmd.file).toBe('C:/Windows/System32/cmd.exe');
  });

  it('omits a built-in listed in disabledBuiltins', () => {
    const merged = mergeFlavours(DETECTED, settings({ disabledBuiltins: ['cmd'] }));
    expect(merged.map((f) => f.id)).not.toContain('cmd');
    expect(merged.map((f) => f.id)).toContain('windows-powershell');
  });

  it('includes user-defined flavours alongside built-ins', () => {
    const merged = mergeFlavours(
      DETECTED,
      settings({ flavours: [{ id: 'my-wsl', label: 'WSL', file: 'wsl.exe', args: ['-d', 'Ubuntu'], defaultParams: '' }] }),
    );
    const wsl = merged.find((f) => f.id === 'my-wsl')!;
    expect(wsl.source).toBe('user');
    expect(wsl.args).toEqual(['-d', 'Ubuntu']);
  });

  it('a user flavour with the same id as a built-in wins (dedupe, single entry)', () => {
    const merged = mergeFlavours(
      DETECTED,
      settings({ flavours: [{ id: 'cmd', label: 'My CMD', file: 'C:/custom/cmd.exe', args: [], defaultParams: '' }] }),
    );
    const cmds = merged.filter((f) => f.id === 'cmd');
    expect(cmds).toHaveLength(1);
    expect(cmds[0].source).toBe('user');
    expect(cmds[0].label).toBe('My CMD');
  });
});

describe('resolveDefaultParams', () => {
  it('uses the built-in catalogue default for a detected built-in', () => {
    expect(resolveDefaultParams('cmd', 'builtin', undefined, settings())).toBe(
      BUILTIN_FLAVOUR_DEFAULT_PARAMS.cmd,
    );
  });

  it('settings.defaultParams[id] overrides the catalogue default', () => {
    expect(
      resolveDefaultParams('cmd', 'builtin', undefined, settings({ defaultParams: { cmd: '/Q' } })),
    ).toBe('/Q');
  });

  it("uses a user flavour's own defaultParams when set", () => {
    const entry = { id: 'my-wsl', label: 'WSL', file: 'wsl.exe', defaultParams: '--cd ~' };
    expect(resolveDefaultParams('my-wsl', 'user', entry, settings())).toBe('--cd ~');
  });

  it('falls back to empty string for an unknown flavour with no default', () => {
    expect(resolveDefaultParams('mystery', 'user', undefined, settings())).toBe('');
  });
});
