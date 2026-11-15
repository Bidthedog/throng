import { describe, expect, it } from 'vitest';
import { createAnonymiser, osNameFor } from '@throng/core';

/** 070 research R32: darwin was typed out of these, so a Mac would have run as Linux or Windows. */
const hash = (salt: string, value: string): string => {
  let h = 2166136261;
  for (const ch of `${salt}|${value}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0') + '00000000';
};

describe('osNameFor', () => {
  it('names each Node platform throng runs on, darwin as macOS', () => {
    expect(osNameFor('win32')).toBe('windows');
    expect(osNameFor('linux')).toBe('linux');
    expect(osNameFor('darwin')).toBe('macos');
  });

  it('refuses a platform throng has no rules for, rather than guessing one', () => {
    expect(() => osNameFor('freebsd')).toThrow(/freebsd/);
  });
});

describe('the anonymiser on macOS', () => {
  const anon = (): ReturnType<typeof createAnonymiser> => {
    const a = createAnonymiser({ salt: 's', os: 'macos', hash });
    a.register('home', '/Users/alice');
    a.register('projectRoot', '/Users/alice/work/secret-app', 'p-1');
    return a;
  };

  it('treats a path spelled in another case as the same path, as a default volume does', () => {
    expect(anon().apply('cd /users/ALICE/work/Secret-App/src')).toMatch(/^cd <project:p-1>\/<path-[0-9a-f]{8}>$/);
    expect(anon().apply('at /Users/alice/notes')).not.toMatch(/alice|notes/);
  });

  it('leaves Linux matching case-sensitive (FR-039): another spelling is some other path', () => {
    const linux = createAnonymiser({ salt: 's', os: 'linux', hash });
    linux.register('projectRoot', '/home/alice/secret-app', 'p-1');
    expect(linux.apply('cd /home/alice/secret-app/src')).toMatch(/^cd <project:p-1>\//);
    expect(linux.apply('cd /HOME/ALICE/Secret-App/src')).not.toContain('<project:p-1>');
  });
});
