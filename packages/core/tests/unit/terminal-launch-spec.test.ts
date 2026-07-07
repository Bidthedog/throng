import { describe, it, expect } from 'vitest';
import { resolveLaunchSpec } from '@throng/core';

describe('resolveLaunchSpec (flavour + params + project root → file/args/cwd)', () => {
  it('sets cwd to the project root and file to the flavour executable', () => {
    const spec = resolveLaunchSpec({ file: 'cmd.exe', args: [] }, '/K', 'C:/proj');
    expect(spec).toEqual({ file: 'cmd.exe', args: ['/K'], cwd: 'C:/proj' });
  });

  it('appends params after the flavour base args', () => {
    const spec = resolveLaunchSpec({ file: 'wsl.exe', args: ['-d', 'Ubuntu'] }, '--cd ~', 'C:/p');
    expect(spec.args).toEqual(['-d', 'Ubuntu', '--cd', '~']);
  });

  it('uses just the base args when params are blank', () => {
    expect(resolveLaunchSpec({ file: 'pwsh.exe', args: ['-NoExit'] }, '   ', 'C:/p').args).toEqual([
      '-NoExit',
    ]);
  });

  it('honours double-quoted params as a single argument', () => {
    const spec = resolveLaunchSpec({ file: 'x.exe', args: [] }, '--title "My Shell" -x', 'C:/p');
    expect(spec.args).toEqual(['--title', 'My Shell', '-x']);
  });

  it('refuses a null project root (no active project edge)', () => {
    expect(() => resolveLaunchSpec({ file: 'cmd.exe', args: [] }, '', null)).toThrow(/project root/i);
  });
});
