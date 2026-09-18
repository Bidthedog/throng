import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { runPathFormsContract, type PathFormsGitFixture } from '@throng/core/testing';
import { WindowsPathForms } from '@throng/platform-windows';

/**
 * 045 FR-012, FR-025 — `contracts/platform-ports.md` §1.
 *
 * The shared suite proves the relationships any implementation must have. The cases below prove the
 * Windows SPELLINGS, which the shared suite deliberately omits so a future macOS or Linux
 * implementation can pass it without the suite being rewritten (Principle II).
 */

/*
 * 045 T203 / T210 — the third round's four members (platform-ports.md §6.1; FR-151 – FR-153).
 *
 * ══ AN INJECTED GIT INSTALL, NOT THE ONE ON THIS MACHINE ══
 *
 * The Git root is a temp folder holding the `etc/fstab` Git for Windows ships — `/tmp` mapped to the
 * user's temp folder (`usertemp`). That makes every case here independent of whether, and where, Git
 * is installed; the real install is T207's, at the integration layer.
 *
 * ══ THE CONSTRUCTOR SHAPE IS ASSUMED ══
 *
 * data-model §15.2: `WindowsPathForms` "gains a constructor collaborator — the Git install root, from
 * shell detection". Its exact shape is T204's. This file assumes `new WindowsPathForms({ gitRoot })`,
 * with `gitRoot: null` meaning "Git for Windows is not installed"; if T204 chooses another shape it
 * changes `withGit` / `withoutGit` below and nothing else.
 */
const SHIPPED_FSTAB = [
  '# For a description of the file format, see the Users Guide',
  '# https://cygwin.com/cygwin-ug-net/using.html#mount-table',
  '',
  '# DO NOT REMOVE NEXT LINE. It remove cygdrive prefix from path',
  'none / cygdrive binary,posix=0,noacl,user 0 0',
  'none /tmp usertemp binary,posix=0,noacl 0 0',
  '',
].join('\n');

type Ctor = new (options?: { gitRoot: string | null }) => WindowsPathForms;
const withGit = (root: string): WindowsPathForms => new (WindowsPathForms as unknown as Ctor)({ gitRoot: root });
const withoutGit = (): WindowsPathForms => new (WindowsPathForms as unknown as Ctor)({ gitRoot: null });

let gitRoot: string;
let tempRoot: string;

beforeAll(() => {
  // A space in the folder name on purpose: `C:\Program Files\Git` is where Git usually lives.
  tempRoot = mkdtempSync(path.join(os.tmpdir(), 'throng-git-root-'));
  gitRoot = path.join(tempRoot, 'Program Files', 'Git');
  mkdirSync(path.join(gitRoot, 'etc'), { recursive: true });
  mkdirSync(path.join(gitRoot, 'usr', 'bin'), { recursive: true });
  writeFileSync(path.join(gitRoot, 'etc', 'fstab'), SHIPPED_FSTAB);
});

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('WindowsPathForms', () => {
  it('satisfies the shared IPathForms contract (PF1\u2013PF19, PF12 prime)', () => {
    // PF1 – PF19 and PF12′ since the third round (T203 / T210), over an injected Git install.
    const fixture: PathFormsGitFixture = { gitRoot, withGitRoot: withGit, withoutGit };
    expect(() => runPathFormsContract(() => withGit(gitRoot), fixture)).not.toThrow();
  });

  it('the pre-existing contract still holds for a subject built with no arguments (PF1\u2013PF12)', () => {
    // Pinned separately so the third round's red cannot hide a regression in the first round's cases:
    // `runPathFormsContract` throws at its FIRST violation, and the new members come last.
    const s = new WindowsPathForms();
    expect(s.fromDriveForm('/d/git/x.ts')).toBe('D:\\git\\x.ts');
    expect(s.fromFileUrl('file://localhost/D:/x')).toBe(s.fromFileUrl('file:///D:/x'));
  });

  describe('T203 \u2014 Git Bash\u2019s mount table (FR-151)', () => {
    type MountTable = { fromMountTable(p: string): string | null };
    const mt = (s: WindowsPathForms) => s as unknown as MountTable;

    it('/usr/bin/bash.exe is under the Git root', () => {
      expect(mt(withGit(gitRoot)).fromMountTable('/usr/bin/bash.exe')).toBe(`${gitRoot}\\usr\\bin\\bash.exe`);
    });

    it('/bin/x is Git\u2019s /usr/bin mapping', () => {
      expect(mt(withGit(gitRoot)).fromMountTable('/bin/x')).toBe(`${gitRoot}\\usr\\bin\\x`);
    });

    it('/etc/hosts is under the Git root', () => {
      expect(mt(withGit(gitRoot)).fromMountTable('/etc/hosts')).toBe(`${gitRoot}\\etc\\hosts`);
    });

    it('/tmp is the user\u2019s temp folder, as the shipped fstab says (usertemp)', () => {
      expect(mt(withGit(gitRoot)).fromMountTable('/tmp')).toBe(os.tmpdir());
      expect(mt(withGit(gitRoot)).fromMountTable('/tmp/a/b.txt')).toBe(`${os.tmpdir()}\\a\\b.txt`);
    });

    it('/c/x and /mnt/c/x are null \u2014 they are fromDriveForm\u2019s', () => {
      expect(mt(withGit(gitRoot)).fromMountTable('/c/x')).toBeNull();
      expect(mt(withGit(gitRoot)).fromMountTable('/mnt/c/x')).toBeNull();
    });

    it('with no Git install, every input is null', () => {
      for (const p of ['/usr/bin/bash.exe', '/bin/x', '/etc/hosts', '/tmp', '/']) {
        expect(mt(withoutGit()).fromMountTable(p), p).toBeNull();
      }
    });

    it('junk is null, never a throw', () => {
      for (const p of ['', 'x', 'C:\\x', '\\\\s\\h', 'file:///usr/bin', '//', `/a${String.fromCharCode(0)}b`]) {
        expect(() => mt(withGit(gitRoot)).fromMountTable(p), JSON.stringify(p)).not.toThrow();
      }
      expect(mt(withGit(gitRoot)).fromMountTable('')).toBeNull();
      expect(mt(withGit(gitRoot)).fromMountTable('x')).toBeNull();
    });
  });

  describe('T203 \u2014 drive qualification (FR-152)', () => {
    type Qualify = { qualifyRooted(p: string, anchor: string): string | null };
    const q = () => new WindowsPathForms() as unknown as Qualify;

    it('\\tmp and /tmp against a base on D: are D:\\tmp', () => {
      expect(q().qualifyRooted('\\tmp', 'D:\\work\\project')).toBe('D:\\tmp');
      expect(q().qualifyRooted('/tmp', 'D:\\work\\project')).toBe('D:\\tmp');
      expect(q().qualifyRooted('/tmp/a/b.txt', 'D:/work')).toBe('D:\\tmp\\a\\b.txt');
    });

    it('a UNC anchor lends its \\\\server\\share', () => {
      expect(q().qualifyRooted('/tmp', '\\\\fileserver\\home\\project')).toBe('\\\\fileserver\\home\\tmp');
    });

    it('no base \u2014 an empty or relative anchor \u2014 is null', () => {
      expect(q().qualifyRooted('\\tmp', '')).toBeNull();
      expect(q().qualifyRooted('\\tmp', 'work\\project')).toBeNull();
    });

    it('junk is null, never a throw', () => {
      for (const p of ['', 'x', ':', `\\a${String.fromCharCode(0)}b`, 'x'.repeat(40_000)]) {
        expect(() => q().qualifyRooted(p, 'D:\\work'), JSON.stringify(p.slice(0, 20))).not.toThrow();
        expect(() => q().qualifyRooted('\\tmp', p), JSON.stringify(p.slice(0, 20))).not.toThrow();
      }
    });
  });

  describe('T210 \u2014 POSIX spellings inside file: URIs (FR-153)', () => {
    type FileUrlForms = {
      fileUrlLocalPath(url: string): string | null;
      loopbackFromFileUrl(url: string): string | null;
    };
    const f = () => new WindowsPathForms() as unknown as FileUrlForms;

    it('fileUrlLocalPath hands back a non-drive-qualified path as written, decoded', () => {
      expect(f().fileUrlLocalPath('file:///c/Windows/win.ini')).toBe('/c/Windows/win.ini');
      expect(f().fileUrlLocalPath('file:///mnt/c/Windows/win.ini')).toBe('/mnt/c/Windows/win.ini');
      expect(f().fileUrlLocalPath('file:///usr/bin/bash.exe')).toBe('/usr/bin/bash.exe');
      expect(f().fileUrlLocalPath('file://localhost/C$/Windows/win.ini')).toBe('/C$/Windows/win.ini');
      expect(f().fileUrlLocalPath('file:///d/test%201/test.md')).toBe('/d/test 1/test.md');
    });

    it('fileUrlLocalPath is null for a drive-qualified path, a hosted URI and another scheme', () => {
      expect(f().fileUrlLocalPath('file:///C:/Windows/win.ini')).toBeNull();
      expect(f().fileUrlLocalPath('file://localhost/D:/x')).toBeNull();
      expect(f().fileUrlLocalPath('file://server/share/x')).toBeNull();
      expect(f().fileUrlLocalPath('https://x/y')).toBeNull();
    });

    it('loopbackFromFileUrl names the loopback share for a localhost URI whose first segment is not a drive', () => {
      expect(f().loopbackFromFileUrl('file://localhost/C$/Windows/win.ini')).toBe('\\\\localhost\\C$\\Windows\\win.ini');
    });

    it('loopbackFromFileUrl is null for a drive segment, a hostless URI and another host', () => {
      expect(f().loopbackFromFileUrl('file://localhost/D:/x')).toBeNull();
      expect(f().loopbackFromFileUrl('file:///C$/x')).toBeNull();
      expect(f().loopbackFromFileUrl('file://server/C$/x')).toBeNull();
    });

    it('both are total over junk', () => {
      for (const u of ['', 'file://', 'file:///D:/%ZZ', 'file://localhost/%ZZ', `file:///a${String.fromCharCode(0)}b`]) {
        expect(() => f().fileUrlLocalPath(u), JSON.stringify(u)).not.toThrow();
        expect(() => f().loopbackFromFileUrl(u), JSON.stringify(u)).not.toThrow();
      }
    });
  });

  describe('the Git Bash and WSL drive forms', () => {
    const subject = new WindowsPathForms();

    it('maps /d/x to the drive, upper-cased', () => {
      expect(subject.fromDriveForm('/d/x')).toBe('D:\\x');
      expect(subject.fromDriveForm('/d/git/throng/x.ts')).toBe('D:\\git\\throng\\x.ts');
    });

    it('maps the WSL form the same way', () => {
      expect(subject.fromDriveForm('/mnt/d/x')).toBe('D:\\x');
    });

    it('maps a bare drive form to the drive root', () => {
      expect(subject.fromDriveForm('/d')).toBe('D:\\');
      expect(subject.fromDriveForm('/d/')).toBe('D:\\');
    });

    it('refuses anything that is not a drive form', () => {
      expect(subject.fromDriveForm('/etc/hosts')).toBeNull();
      expect(subject.fromDriveForm('/mnt/hosts')).toBeNull();
      expect(subject.fromDriveForm('C:\\x')).toBeNull();
      expect(subject.fromDriveForm('')).toBeNull();
    });
  });

  describe('file: URIs', () => {
    const subject = new WindowsPathForms();

    it('a hostless URI becomes a local path, percent-decoded', () => {
      expect(subject.fromFileUrl('file:///D:/a%20b/c.txt')).toBe('D:\\a b\\c.txt');
      expect(subject.fromFileUrl('file:///C:/Users/dev')).toBe('C:\\Users\\dev');
    });

    it('a URI with a host becomes the UNC location', () => {
      expect(subject.fromFileUrl('file://server/share/x.txt')).toBe('\\\\server\\share\\x.txt');
    });

    it('localhost is the same as no host', () => {
      expect(subject.fromFileUrl('file://localhost/D:/x')).toBe('D:\\x');
    });

    it('refuses every other scheme', () => {
      expect(subject.fromFileUrl('http://x/y')).toBeNull();
      expect(subject.fromFileUrl('javascript:0')).toBeNull();
      expect(subject.fromFileUrl('')).toBeNull();
    });
  });

  describe('mixed separators', () => {
    const subject = new WindowsPathForms();

    it('an answer is spelled with backslashes whatever the input used', () => {
      expect(subject.fromDriveForm('/d/a/b/c.ts')).not.toContain('/');
      expect(subject.fromFileUrl('file:///D:/a/b/c.ts')).not.toContain('/');
    });

    it('a home form accepts either separator and answers in the platform\u2019s own', () => {
      const home = subject.homeDirectory();
      expect(subject.fromHomeForm('~/a/b')).toBe(`${home}\\a\\b`);
      expect(subject.fromHomeForm('~\\a\\b')).toBe(`${home}\\a\\b`);
    });
  });

  describe('the home folder', () => {
    it('is the real one, taken from the OS rather than from an environment guess', () => {
      const home = new WindowsPathForms().homeDirectory();
      expect(home).toMatch(/^[A-Za-z]:\\/);
      expect(home.length).toBeGreaterThan(3);
    });
  });
});
