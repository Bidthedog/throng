import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveCandidate } from '@throng/core';
import { runPathFormsContract, runTrashRestoreContract, skipUnlessLinux } from '@throng/core/testing';
import { LinuxPathForms, LinuxTrash, parseTrashInfo } from '@throng/platform-linux';

/** Layer: contract. The trash is a layout on real disks, and the restore is a real rename out of it. */
const UID = 1234;

describe('parseTrashInfo (freedesktop trash spec)', () => {
  const info = (body: string): string => `[Trash Info]\n${body}\n`;

  it('reads an absolute path, percent-decoded', () => {
    expect(parseTrashInfo(info('Path=/p/a%20b.txt\nDeletionDate=2026-11-02T10:00:00'), null)).toMatchObject({
      originalPath: '/p/a b.txt',
    });
  });

  it('resolves a volume trash path against its top directory', () => {
    expect(parseTrashInfo(info('Path=sub/x.txt'), '/data')?.originalPath).toBe('/data/sub/x.txt');
    expect(parseTrashInfo(info('Path=sub/x.txt'), null)).toBeNull();
  });

  it('refuses what is not a trash record, rather than guessing', () => {
    expect(parseTrashInfo('Path=/p/x', null)).toBeNull();
    expect(parseTrashInfo(info('DeletionDate=2026-11-02T10:00:00'), null)).toBeNull();
    expect(parseTrashInfo(info('Path=%ZZ'), null)).toBeNull();
  });
});

describe.skipIf(skipUnlessLinux('restores through POSIX renames'))('LinuxTrash.restore (062 FR-024)', () => {
  let base: string;
  let home: string;
  let project: string;

  /** What `gio trash` leaves behind. */
  const trash = (trashDir: string, name: string, original: string, date: string, content = 'x'): void => {
    mkdirSync(join(trashDir, 'info'), { recursive: true });
    mkdirSync(join(trashDir, 'files'), { recursive: true });
    writeFileSync(join(trashDir, 'files', name), content);
    writeFileSync(join(trashDir, 'info', `${name}.trashinfo`), `[Trash Info]\nPath=${encodeURI(original)}\nDeletionDate=${date}\n`);
  };
  const subject = (): LinuxTrash => new LinuxTrash({ env: {}, home: () => home, uid: UID });

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'throng-trash-'));
    home = join(base, 'home');
    project = join(base, 'project');
    mkdirSync(home);
    mkdirSync(project);
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  const homeTrash = (): string => join(home, '.local', 'share', 'Trash');

  it('meets the shared contract', async () => {
    await runTrashRestoreContract({
      make: subject,
      trashed: () => {
        const path = join(project, 'contract.txt');
        trash(homeTrash(), 'contract.txt', path, '2026-11-02T10:00:00');
        return path;
      },
      neverTrashed: () => join(project, 'never.txt'),
      occupied: () => {
        const path = join(project, 'occupied.txt');
        trash(homeTrash(), 'occupied.txt', path, '2026-11-02T10:00:00');
        writeFileSync(path, 'new');
        return path;
      },
      exists: existsSync,
    });
  });

  it('restores from the home trash, and clears its record', async () => {
    const path = join(project, 'a b.txt');
    trash(homeTrash(), 'a b.txt', path, '2026-11-02T10:00:00', 'hello');
    await subject().restore(path, Date.parse('2026-11-02T10:00:01'));
    expect(readFileSync(path, 'utf8')).toBe('hello');
    expect(existsSync(join(homeTrash(), 'info', 'a b.txt.trashinfo'))).toBe(false);
  });

  it('restores from a volume trash, where a file on another filesystem goes', async () => {
    const path = join(project, 'v.txt');
    trash(join(project, `.Trash-${UID}`), 'v.txt', path, '2026-11-02T10:00:00', 'volume');
    await subject().restore(path, Date.parse('2026-11-02T10:00:01'));
    expect(readFileSync(path, 'utf8')).toBe('volume');
  });

  it('takes the deletion closest at or before the one asked about', async () => {
    const path = join(project, 'twice.txt');
    trash(homeTrash(), 'twice.txt', path, '2026-11-02T10:00:00', 'first');
    trash(homeTrash(), 'twice.2.txt', path, '2026-11-02T11:00:00', 'second');
    await subject().restore(path, Date.parse('2026-11-02T10:30:00'));
    expect(readFileSync(path, 'utf8')).toBe('first');
  });

  it('restores a file from a project opened through a symlink to another folder', async () => {
    const realProject = join(base, 'real-project');
    mkdirSync(realProject);
    const linked = join(base, 'linked');
    symlinkSync(realProject, linked);
    trash(join(realProject, `.Trash-${UID}`), 's.txt', join(realProject, 's.txt'), '2026-11-02T10:00:00', 'through');
    await subject().restore(join(linked, 's.txt'), Date.parse('2026-11-02T10:00:01'));
    expect(readFileSync(join(realProject, 's.txt'), 'utf8')).toBe('through');
  });

  it('keeps case-variant names apart (FR-020)', async () => {
    const upper = join(project, 'README.md');
    trash(homeTrash(), 'README.md', upper, '2026-11-02T10:00:00', 'upper');
    await expect(subject().restore(join(project, 'readme.md'), Date.now())).rejects.toThrow(/no longer in the Trash/);
    expect(existsSync(join(project, 'readme.md'))).toBe(false);
  });
});

describe('LinuxPathForms (062 FR-021, FR-022)', () => {
  const forms = new LinuxPathForms();

  it('has no drive form: /d/x is an ordinary path here', () => {
    expect(forms.fromDriveForm('/d/git/x.ts')).toBeNull();
    expect(forms.fromDriveForm('/mnt/d/git/x.ts')).toBeNull();
    expect(forms.qualifyRooted('/tmp', '/home')).toBe('/tmp');
    expect(forms.loopbackFromFileUrl('file://localhost/x')).toBeNull();
  });

  it('meets the shared contract, with no drive forms', () => {
    runPathFormsContract(() => new LinuxPathForms(), undefined, { hasDriveForms: false });
  });

  it('reads an absolute path as itself, with or without a project (the most common link there is)', () => {
    const candidate = { text: '/etc/hosts', start: 0, end: 10 };
    expect(resolveCandidate(candidate, { projectRoot: '/home/u/p', pathForms: forms })).toEqual(['/home/u/p/etc/hosts', '/etc/hosts']);
    expect(resolveCandidate(candidate, { projectRoot: null, pathForms: forms })).toEqual(['/etc/hosts']);
  });

  it('joins a relative path with the separator the base is spelled with', () => {
    const candidate = { text: 'src/a.ts', start: 0, end: 8 };
    expect(resolveCandidate(candidate, { baseDirectory: '/home/u/p/pkg', projectRoot: '/home/u/p', pathForms: forms })).toEqual([
      '/home/u/p/pkg/src/a.ts',
      '/home/u/p/src/a.ts',
    ]);
  });

  it('expands the home form', () => {
    expect(forms.fromHomeForm('~')).toBe(forms.homeDirectory());
    expect(forms.fromHomeForm('~/a/b')).toBe(`${forms.homeDirectory()}/a/b`);
    expect(forms.fromHomeForm('~other/a')).toBeNull();
    expect(forms.fromHomeForm('/a')).toBeNull();
  });

  it('reads file URLs, percent-decoding, and names a remote host', () => {
    expect(forms.fromFileUrl('file:///a/b%20c.txt')).toBe('/a/b c.txt');
    expect(forms.fromFileUrl('file://localhost/a/b.txt')).toBe('/a/b.txt');
    expect(forms.fromFileUrl('file://server/share/x')).toBe('//server/share/x');
    expect(forms.fromFileUrl('https://x')).toBeNull();
    expect(forms.fileUrlLocalPath('file://server/x')).toBeNull();
    expect(forms.fileUrlLocalPath('file:///a')).toBe('/a');
  });
});
