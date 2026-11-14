import { describe, expect, it } from 'vitest';
import { createAnonymiser, sensitive } from '@throng/core';

/**
 * 068 FR-034a to FR-034f — the diagnostic log carries no path, name or machine identity. The hash is
 * injected (core imports no Node builtin); this fake is deterministic and salt-sensitive.
 */
const hash = (salt: string, value: string): string => {
  let h = 2166136261;
  for (const ch of `${salt}|${value}`) {
    h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0') + '00000000';
};

function windows(salt = 'salt-a') {
  const anon = createAnonymiser({ salt, os: 'windows', hash });
  anon.register('home', 'C:\\Users\\alice');
  anon.register('user', 'alice');
  anon.register('host', 'WORKSTATION-7');
  anon.register('userData', 'C:\\Users\\alice\\AppData\\Roaming\\throng');
  anon.register('install', 'C:\\Program Files\\throng');
  anon.register('projectRoot', 'D:\\work\\secret-app', 'p-123');
  anon.register('projectName', 'Secret App', 'p-123');
  return anon;
}

describe('createAnonymiser', () => {
  it('turns a project root into its id plus a token for the remainder', () => {
    const out = windows().apply('open D:\\work\\secret-app\\src\\main.ts failed');
    expect(out).toMatch(/^open <project:p-123>\/<path-[0-9a-f]{8}> failed$/);
    expect(windows().apply('root D:\\work\\secret-app')).toBe('root <project:p-123>');
  });

  it('names a project by id and tokenises the home folder, user data, user and host', () => {
    const out = windows().apply(
      'Secret App in C:\\Users\\alice\\docs by alice on WORKSTATION-7 at C:\\Users\\alice\\AppData\\Roaming\\throng\\x.json',
    );
    expect(out).not.toMatch(/alice|WORKSTATION|Secret App|docs|x\.json/);
    expect(out).toContain('<project:p-123>');
    expect(out).toMatch(/<home-[0-9a-f]{8}>/);
    expect(out).toMatch(/<user-[0-9a-f]{8}>/);
    expect(out).toMatch(/<host-[0-9a-f]{8}>/);
    expect(out).toMatch(/<userdata-[0-9a-f]{8}>/);
  });

  it('keeps the relative file and line of an install-folder stack frame', () => {
    const out = windows().apply('at run (C:\\Program Files\\throng\\resources\\app\\main.js:10:5)');
    expect(out).toBe('at run (<install>\\resources\\app\\main.js:10:5)');
  });

  it('is stable for one salt and different for another', () => {
    const a = windows('one').apply('by alice');
    expect(windows('one').apply('by alice')).toBe(a);
    expect(windows('two').apply('by alice')).not.toBe(a);
  });

  it('matches Windows paths case-insensitively, with either separator and JSON-escaped', () => {
    const anon = windows();
    expect(anon.apply('c:/users/ALICE/x')).not.toMatch(/alice|users/i);
    expect(anon.apply('{"p":"C:\\\\Users\\\\alice\\\\x"}')).not.toMatch(/alice/i);
    expect(anon.apply('D:/WORK/Secret-App/a')).toContain('<project:p-123>');
  });

  it('tokenises unregistered paths of every shape', () => {
    const anon = createAnonymiser({ salt: 's', os: 'windows', hash });
    const cases = [
      'E:\\data\\other\\f.txt',
      'E:/data/other/f.txt',
      '{"p":"E:\\\\data\\\\other\\\\f.txt"}',
      '\\\\fileserver\\share\\dir\\f.txt',
      '\\\\?\\E:\\data\\other\\f.txt',
      '\\\\.\\pipe\\throng-daemon-abc',
      'file:///E:/data/other%20dir/f.txt',
      '~/notes/todo.md',
      'src/lib/thing.ts',
    ];
    for (const c of cases) {
      const out = anon.apply(`error at ${c} end`);
      expect(out, c).toMatch(/<path-[0-9a-f]{8}>/);
      expect(out, c).not.toMatch(/data|other|fileserver|pipe|notes|lib|thing|todo/);
    }
  });

  it('tokenises POSIX absolute paths and file URLs on Linux', () => {
    const anon = createAnonymiser({ salt: 's', os: 'linux', hash });
    expect(anon.apply('stat /var/lib/secret/db.sqlite')).toMatch(/^stat <path-[0-9a-f]{8}>$/);
    expect(anon.apply('url file:///srv/my%20dir/a.txt')).not.toMatch(/srv|dir/);
  });

  it('tokenises the quoted names of an errno message and user@host', () => {
    const anon = createAnonymiser({ salt: 's', os: 'linux', hash });
    const out = anon.apply("ENOENT: no such file or directory, open 'private name.txt'");
    expect(out).toMatch(/^ENOENT: no such file or directory, open '<path-[0-9a-f]{8}>'$/);
    expect(anon.apply('login bob@buildbox.local ok')).toMatch(
      /^login <user-[0-9a-f]{8}>@<host-[0-9a-f]{8}> ok$/,
    );
  });

  it('leaves severity words, UUIDs, numbers and field names alone', () => {
    const anon = windows();
    const line =
      'level=warn id=550e8400-e29b-41d4-a716-446655440000 count=42 pid=1234 took=12ms 2026-11-12T10:20:30.123Z';
    expect(anon.apply(line)).toBe(line);
  });

  it('leaves a short username inside another word alone', () => {
    const anon = createAnonymiser({ salt: 's', os: 'linux', hash });
    anon.register('user', 'dev');
    expect(anon.apply('device list')).toBe('device list');
    expect(anon.apply('user dev here')).toMatch(/^user <user-[0-9a-f]{8}> here$/);
  });

  /**
   * Review fix 1 — a path with spaces in it. An unregistered path continues through following
   * space-separated words until a word that ends in an extension (inclusive), a stop word of prose
   * (`and`, `because`, `failed` …), a `key=value`, or six words. Leaking is worse than eating prose.
   */
  describe('paths containing spaces', () => {
    const linux = () => createAnonymiser({ salt: 's', os: 'linux', hash });
    const win = () => createAnonymiser({ salt: 's', os: 'windows', hash });

    it('swallows every word of a spaced file name that ends in an extension', () => {
      const out = linux().apply('read /home/bob/notes/Acme Merger Plan.md failed');
      expect(out).toMatch(/^read <path-[0-9a-f]{8}> failed$/);
    });

    it('swallows a spaced folder name at the end of a field', () => {
      const out = linux().apply('cwd=/mnt/data/Project Phoenix');
      expect(out).toMatch(/^cwd=<path-[0-9a-f]{8}>$/);
    });

    it('swallows a Windows path with spaces in a folder and the file', () => {
      const out = win().apply('open D:\\Clients\\Acme Corp\\Board Minutes.docx now');
      expect(out).toMatch(/^open <path-[0-9a-f]{8}> now$/);
    });

    it('leaves prose after the path alone, and stops at key=value', () => {
      expect(linux().apply('Failed to open /home/bob/Acme Plan.md because it is locked')).toMatch(
        /^Failed to open <path-[0-9a-f]{8}> because it is locked$/,
      );
      expect(linux().apply('stat /srv/Big Folder code=2')).toMatch(/^stat <path-[0-9a-f]{8}> code=2$/);
    });

    it('takes the whole of a quoted path, whatever is inside it', () => {
      const out = linux().apply('open "/home/bob/my private notes/the plan for next year" and retry');
      expect(out).toMatch(/^open "<path-[0-9a-f]{8}>" and retry$/);
    });

    it('swallows the spaced remainder under a registered root', () => {
      const anon = windows();
      const out = anon.apply('read D:\\work\\secret-app\\My Quarterly Report.xlsx ok');
      expect(out).toMatch(/^read <project:p-123>\/<path-[0-9a-f]{8}> ok$/);
    });
  });

  /**
   * Review fix 2 — a caller that KNOWS a value is sensitive free text (a command line, a prompt)
   * wraps it with `sensitive()`; the anonymiser turns the span into `<kind-xxxxxxxx>` whatever is
   * inside it, even where nothing in it looks like a path.
   */
  describe('sensitive spans', () => {
    it('replaces the wrapped text with a stable kind token and keeps the text around it', () => {
      const anon = windows();
      const line = `[025:capture] panel=p1 value=${JSON.stringify('x')} ${sensitive('command', 'claude "draft the Acme layoff memo"')} end`;
      const out = anon.apply(line);
      expect(out).not.toMatch(/Acme|layoff|claude/);
      expect(out).toMatch(/ <command-[0-9a-f]{8}> end$/);
      expect(anon.apply(sensitive('command', 'same'))).toBe(anon.apply(sensitive('command', 'same')));
      expect(anon.apply(sensitive('command', 'a'))).not.toBe(anon.apply(sensitive('command', 'b')));
    });

    it('tokenises an unterminated span (a message cut by a size cap) to its end', () => {
      const open = sensitive('command', 'secret words').slice(0, -1);
      expect(windows().apply(`value=${open}`)).toMatch(/^value=<command-[0-9a-f]{8}>$/);
    });

    it('does not let input forge the anonymiser’s own markers', () => {
      const out = windows().apply('a \u0001999\u0002 b \u0001 0 \u0002 c');
      expect(out).not.toContain('\u0001');
      expect(out).not.toContain('\u0002');
    });
  });

  it('tokenises a value the caller knows is a name, stably and per salt', () => {
    const one = windows('one');
    expect(one.token('name', 'one.txt')).toMatch(/^<name-[0-9a-f]{8}>$/);
    expect(windows('one').token('name', 'ONE.txt')).toBe(one.token('name', 'one.txt'));
    expect(windows('two').token('name', 'one.txt')).not.toBe(one.token('name', 'one.txt'));
  });

  it('anonymises 1,000 typical lines in under a second', () => {
    const anon = windows();
    for (let i = 0; i < 20; i++) anon.register('projectRoot', `D:\\work\\proj${i}`, `p-${i}`);
    const line =
      '2026-11-12T10:20:30Z INFO [main] opened D:\\work\\proj7\\src\\a.ts for alice level=info count=3 at C:\\Program Files\\throng\\x.js:1:2';
    const start = performance.now();
    for (let i = 0; i < 1000; i++) anon.apply(line);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
