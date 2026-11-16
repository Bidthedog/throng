import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ICON_SET } from '@throng/core';
import { IconSetService } from '../../src/main/icon-set-service.js';

/**
 * Spec 069 T019 / T031 — the icon set service against a real temp directory.
 *
 * Layer: integration — the behaviour under test is what a real folder of files becomes (listing,
 * reading, copying, never overwriting), which no in-memory fake of `fs` can show.
 */

const GOOD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 1h22"/></svg>';
const OTHER = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2h20"/></svg>';

let root: string;
let dir: string;

/** A stand-in for the OS trash: the item moves to `<root>/trash`, so a test can see it went there and was not destroyed. */
async function trash(path: string): Promise<void> {
  const bin = join(root, 'trash');
  mkdirSync(bin, { recursive: true });
  await fsp.rename(path, join(bin, basename(path)));
}

function make(eol: '\n' | '\r\n' = '\n', readme = 'one\ntwo\n'): IconSetService {
  return new IconSetService({ dir, fs: fsp, eol, readme, trash });
}

function put(set: string, file: string, content: string): void {
  mkdirSync(join(dir, set), { recursive: true });
  writeFileSync(join(dir, set, file), content, 'utf8');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'throng-icon-sets-'));
  dir = join(root, 'icon-packs');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('listing and loading (FR-016, FR-027, FR-037)', () => {
  it('lists user folders and skips .bak and .bak.<n> folders', async () => {
    put('mine', 'save.svg', GOOD);
    put('old.bak', 'save.svg', GOOD);
    put('old.bak.2', 'save.svg', GOOD);
    put('other.bak.x', 'save.svg', GOOD);
    const svc = make();
    await svc.init();
    expect(svc.list().map((s) => s.name)).toEqual(['mine', 'other.bak.x']);
  });

  it('treats a backup folder as a backup in any case: not listed, and counted (FR-037)', async () => {
    put('mine', 'save.svg', GOOD);
    put('Old.BAK', 'save.svg', GOOD);
    const svc = make();
    await svc.init();
    expect(svc.list().map((s) => s.name)).toEqual(['mine']);
    expect(await svc.countBackups()).toBe(1);
  });

  it('treats <key>.svg for a known key as an override and other files as unrecognised', async () => {
    put('mine', 'save.svg', GOOD);
    put('mine', 'notakey.svg', GOOD);
    put('mine', 'notes.txt', 'hi');
    const svc = make();
    await svc.init();
    const set = svc.list()[0];
    expect(Object.keys(set.overrides)).toEqual(['save']);
    expect(set.overrides.save).toContain('<path');
    expect(set.unrecognised.sort()).toEqual(['notakey.svg', 'notes.txt']);
    expect(set.error).toBeUndefined();
  });

  // Alone in its folder: a case-insensitive filesystem (Windows) cannot hold Save.svg beside save.svg.
  it('treats a key file named in the wrong case as unrecognised', async () => {
    put('mine', 'Save.svg', GOOD);
    const svc = make();
    await svc.init();
    const set = svc.list()[0];
    expect(set.overrides).toEqual({});
    expect(set.unrecognised).toEqual(['Save.svg']);
  });

  // T039 (converge G2): the default set's name is never a user set, in any case.
  it('never lists a folder named throng, in any case, and gives it no path (FR-021, FR-025)', async () => {
    put('throng', 'save.svg', GOOD);
    put('Throng', 'save.svg', GOOD);
    put('mine', 'save.svg', GOOD);
    const svc = make();
    await svc.init();
    expect(svc.list().map((s) => s.name)).toEqual(['mine']);
    expect(svc.pathOf('throng')).toBeUndefined();
    expect(svc.pathOf('Throng')).toBeUndefined();
    expect(await svc.override('throng', 'save', true)).toMatchObject({ ok: false, reason: 'unknown-set' });
  });

  it('records a per-key failure for a file that is not an SVG, and keeps the other keys', async () => {
    put('mine', 'save.svg', 'this is not svg');
    put('mine', 'add.svg', GOOD);
    const svc = make();
    await svc.init();
    const set = svc.list()[0];
    expect(Object.keys(set.overrides)).toEqual(['add']);
    expect(set.failures.save).toMatch(/svg/i);
  });

  it('records a per-key failure for an unreadable file', async () => {
    mkdirSync(join(dir, 'mine', 'save.svg'), { recursive: true }); // a directory named like an icon
    const svc = make();
    await svc.init();
    const set = svc.list()[0];
    expect(set.overrides.save).toBeUndefined();
    expect(set.failures.save).toBeTruthy();
  });

  it('loads a save.svg holding <text>, <image> and <foreignObject> with none of them in its markup (FR-005)', async () => {
    put(
      'mine',
      'save.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 1h22"/>' +
        '<text x="1" y="1">S</text><image href="a.png"/><foreignObject><div>x</div></foreignObject></svg>',
    );
    const svc = make();
    await svc.init();
    const markup = svc.list()[0].overrides.save ?? '';
    expect(markup).toContain('<path');
    expect(markup).not.toMatch(/<text|<image|<foreignobject/i);
  });

  it('serves no sets when the sets directory is absent', async () => {
    const svc = make();
    await svc.init();
    expect(svc.list()).toEqual([]);
  });

  it('lists a set that cannot be read, with the reason (FR-016)', async () => {
    put('mine', 'save.svg', GOOD);
    const svc = make();
    const failing = { ...fsp, readdir: (async (path: string, opts?: unknown) => {
      if (path === join(dir, 'mine')) throw new Error('EACCES: permission denied');
      return (fsp.readdir as (p: string, o?: unknown) => Promise<unknown>)(path, opts);
    }) as typeof fsp.readdir } as typeof fsp;
    const unreadable = new IconSetService({ dir, fs: failing, eol: '\n', readme: 'x', trash });
    await svc.init();
    await unreadable.init();
    const set = unreadable.list().find((s) => s.name === 'mine');
    expect(set?.error).toContain('permission denied');
    expect(set?.overrides).toEqual({});
  });
});

describe('create (FR-024)', () => {
  it('makes an empty folder when copying from the default set', async () => {
    const svc = make();
    await svc.init();
    expect(await svc.create('fresh', 'throng')).toEqual({ ok: true });
    expect(existsSync(join(dir, 'fresh'))).toBe(true);
    expect(svc.list().map((s) => s.name)).toEqual(['fresh']);
    expect(svc.list()[0].overrides).toEqual({});
  });

  it('copies only the <IconKey>.svg files when copying from a user set', async () => {
    put('src', 'save.svg', GOOD);
    put('src', 'add.svg', OTHER);
    put('src', 'notes.txt', 'keep out');
    put('src', 'notakey.svg', GOOD);
    const svc = make();
    await svc.init();
    expect(await svc.create('copy', 'src')).toEqual({ ok: true });
    expect(readFileSync(join(dir, 'copy', 'save.svg'), 'utf8')).toBe(GOOD);
    expect(readFileSync(join(dir, 'copy', 'add.svg'), 'utf8')).toBe(OTHER);
    expect(existsSync(join(dir, 'copy', 'notes.txt'))).toBe(false);
    expect(existsSync(join(dir, 'copy', 'notakey.svg'))).toBe(false);
    expect(Object.keys(svc.list().find((s) => s.name === 'copy')!.overrides).sort()).toEqual(['add', 'save']);
  });

  it('copies only the readable overrides: an unreadable file in the source does not fail the copy', async () => {
    mkdirSync(join(dir, 'src', 'save.svg'), { recursive: true }); // a directory named like an icon
    put('src', 'add.svg', OTHER);
    const svc = make();
    await svc.init();
    expect(Object.keys(svc.list()[0].failures)).toEqual(['save']);
    expect(await svc.create('copy', 'src')).toEqual({ ok: true });
    expect(readFileSync(join(dir, 'copy', 'add.svg'), 'utf8')).toBe(OTHER);
    expect(existsSync(join(dir, 'copy', 'save.svg'))).toBe(false);
  });

  // A link named like an icon that points at a folder reaches copyFile, which each OS refuses in its own words —
  // EISDIR on Linux, ENOTSUP on macOS (070) — and either way the copy goes on without it.
  it('copies the rest when an icon-named link points at a folder', async (ctx) => {
    mkdirSync(join(dir, 'elsewhere'), { recursive: true });
    put('src', 'add.svg', OTHER);
    try {
      symlinkSync(join(dir, 'elsewhere'), join(dir, 'src', 'save.svg'), 'dir');
    } catch {
      ctx.skip(); // Windows without the privilege to make links
    }
    const svc = make();
    await svc.init();
    expect(await svc.create('copy', 'src')).toEqual({ ok: true });
    expect(readFileSync(join(dir, 'copy', 'add.svg'), 'utf8')).toBe(OTHER);
    expect(existsSync(join(dir, 'copy', 'save.svg'))).toBe(false);
  });

  // T038 (converge G1): the copy follows the folder as it is now, as the grid's Overridden marks do.
  it('copies a present override that failed to load, so the copy is marked as its source is (FR-024, FR-027)', async () => {
    put('src', 'save.svg', 'not an svg');
    const svc = make();
    await svc.init();
    expect(Object.keys(svc.list()[0].failures)).toEqual(['save']);
    expect(await svc.create('copy', 'src')).toEqual({ ok: true });
    expect(readFileSync(join(dir, 'copy', 'save.svg'), 'utf8')).toBe('not an svg');
  });

  it('skips a file deleted outside throng since the source was loaded, and copies the rest', async () => {
    put('src', 'save.svg', GOOD);
    put('src', 'add.svg', OTHER);
    const svc = make();
    await svc.init();
    rmSync(join(dir, 'src', 'save.svg'));
    expect(await svc.create('copy', 'src')).toEqual({ ok: true });
    expect(existsSync(join(dir, 'copy', 'save.svg'))).toBe(false);
    expect(readFileSync(join(dir, 'copy', 'add.svg'), 'utf8')).toBe(OTHER);
  });

  it('removes the half-made folder when a copy fails, so the retry is not refused as exists', async () => {
    put('src', 'save.svg', GOOD);
    put('src', 'add.svg', OTHER);
    let calls = 0;
    const flaky = {
      ...fsp,
      copyFile: async (...args: Parameters<typeof fsp.copyFile>) => {
        if (++calls === 2) throw new Error('disk full');
        return fsp.copyFile(...args);
      },
    } as typeof fsp;
    const svc = new IconSetService({ dir, fs: flaky, eol: '\n', readme: 'x', trash });
    await svc.init();
    expect(await svc.create('copy', 'src')).toMatchObject({ ok: false, reason: 'io' });
    expect(existsSync(join(dir, 'copy'))).toBe(false);
    expect(svc.list().map((s) => s.name)).toEqual(['src']);
    expect(await svc.create('copy', 'src')).toEqual({ ok: true });
  });

  it('refuses an existing name and an unlisted source, and never takes a path', async () => {
    put('src', 'save.svg', GOOD);
    const svc = make();
    await svc.init();
    expect(await svc.create('src', 'throng')).toMatchObject({ ok: false, reason: 'exists' });
    expect(await svc.create('x', 'nope')).toMatchObject({ ok: false, reason: 'source-unavailable' });
    expect(await svc.create('../escape', 'throng')).toMatchObject({ ok: false, reason: 'invalid-name' });
    expect(await svc.create('a/b', 'throng')).toMatchObject({ ok: false, reason: 'invalid-name' });
    expect(existsSync(join(root, 'escape'))).toBe(false);
  });
});

describe('override (FR-032, FR-033)', () => {
  it('writes DEFAULT_ICON_SET[key] to <set>/<key>.svg and serves it', async () => {
    put('mine', 'add.svg', GOOD);
    const svc = make();
    await svc.init();
    expect(await svc.override('mine', 'save', false)).toEqual({ ok: true });
    const text = readFileSync(join(dir, 'mine', 'save.svg'), 'utf8');
    expect(text).toBe(DEFAULT_ICON_SET.save);
    expect(text).not.toContain('\r');
    expect(svc.list()[0].overrides.save).toBeTruthy();
  });

  it('returns exists without replace, leaves the file, and overwrites with replace', async () => {
    put('mine', 'save.svg', GOOD);
    const svc = make();
    await svc.init();
    expect(await svc.override('mine', 'save', false)).toMatchObject({ ok: false, reason: 'exists' });
    expect(readFileSync(join(dir, 'mine', 'save.svg'), 'utf8')).toBe(GOOD);
    expect(await svc.override('mine', 'save', true)).toEqual({ ok: true });
    expect(readFileSync(join(dir, 'mine', 'save.svg'), 'utf8')).toBe(DEFAULT_ICON_SET.save);
  });

  it('refuses an unknown set and an unknown key', async () => {
    put('mine', 'save.svg', GOOD);
    const svc = make();
    await svc.init();
    expect(await svc.override('nope', 'save', false)).toMatchObject({ ok: false, reason: 'unknown-set' });
    expect(await svc.override('mine', '../x', false)).toMatchObject({ ok: false, reason: 'unknown-key' });
  });
});

describe('reload reads every set again (FR-029, FR-041)', () => {
  it('editing files changes nothing until a reload, which picks up every set', async () => {
    put('mine', 'save.svg', GOOD);
    put('theirs', 'save.svg', GOOD);
    const svc = make();
    await svc.init();
    writeFileSync(join(dir, 'mine', 'save.svg'), OTHER, 'utf8');
    writeFileSync(join(dir, 'theirs', 'save.svg'), OTHER, 'utf8');
    expect(svc.list().find((s) => s.name === 'mine')!.overrides.save).toContain('M1 1h22');
    expect(await svc.reload()).toEqual({ ok: true });
    expect(svc.list().find((s) => s.name === 'mine')!.overrides.save).toContain('M2 2h20');
    expect(svc.list().find((s) => s.name === 'theirs')!.overrides.save).toContain('M2 2h20');
  });

  it('lists a folder made outside throng, and drops one removed outside it', async () => {
    put('mine', 'save.svg', GOOD);
    const svc = make();
    await svc.init();
    rmSync(join(dir, 'mine'), { recursive: true });
    put('handmade', 'add.svg', GOOD);
    await svc.rescan();
    expect(svc.list().map((s) => s.name)).toEqual(['handmade']);
  });
});

describe('rename (FR-042)', () => {
  it('renames the folder, keeps its files and lists it under the new name', async () => {
    put('mine', 'save.svg', GOOD);
    const svc = make();
    await svc.init();
    expect(await svc.rename('mine', 'ours')).toEqual({ ok: true });
    expect(existsSync(join(dir, 'mine'))).toBe(false);
    expect(readFileSync(join(dir, 'ours', 'save.svg'), 'utf8')).toBe(GOOD);
    expect(svc.list().map((s) => s.name)).toEqual(['ours']);
    expect(svc.pathOf('mine')).toBeUndefined();
  });

  it('renames to a change of case alone', async () => {
    put('mine', 'save.svg', GOOD);
    const svc = make();
    await svc.init();
    expect(await svc.rename('mine', 'Mine')).toEqual({ ok: true });
    expect(svc.list().map((s) => s.name)).toEqual(['Mine']);
  });

  it('refuses a name a folder already has, in any case, and leaves both folders alone', async () => {
    put('mine', 'save.svg', GOOD);
    put('Other', 'add.svg', OTHER);
    const svc = make();
    await svc.init();
    expect(await svc.rename('mine', 'other')).toMatchObject({ ok: false, reason: 'exists' });
    expect(readFileSync(join(dir, 'mine', 'save.svg'), 'utf8')).toBe(GOOD);
    expect(readFileSync(join(dir, 'Other', 'add.svg'), 'utf8')).toBe(OTHER);
  });

  // A case-sensitive volume (Linux, and a case-sensitive APFS volume on macOS: 070 FR-020) can hold `mine` and
  // `Mine` side by side. A case-only rename is a rename of the set ITSELF only when no OTHER folder has the name.
  it('refuses a change of case that another folder already has, where the volume can hold both', async (ctx) => {
    put('mine', 'save.svg', GOOD);
    try {
      mkdirSync(join(dir, 'Mine'));
    } catch {
      ctx.skip(); // a case-insensitive volume (Windows, macOS by default): `mine` already answers to `Mine`
    }
    if (readdirSync(dir).length < 2) ctx.skip();
    const svc = make();
    await svc.init();
    expect(await svc.rename('mine', 'Mine')).toMatchObject({ ok: false, reason: 'exists' });
    expect(readFileSync(join(dir, 'mine', 'save.svg'), 'utf8')).toBe(GOOD);
    expect(existsSync(join(dir, 'Mine'))).toBe(true);
  });

  it('refuses an unknown set, the default set\'s name and a path', async () => {
    put('mine', 'save.svg', GOOD);
    const svc = make();
    await svc.init();
    expect(await svc.rename('nope', 'x')).toMatchObject({ reason: 'unknown-set' });
    expect(await svc.rename('mine', 'Throng')).toMatchObject({ reason: 'invalid-name' });
    expect(await svc.rename('mine', '../escape')).toMatchObject({ reason: 'invalid-name' });
    expect(existsSync(join(dir, 'mine'))).toBe(true);
  });
});

describe('delete (FR-043)', () => {
  it('moves the folder to the trash, files and all, and stops listing it', async () => {
    put('mine', 'save.svg', GOOD);
    const svc = make();
    await svc.init();
    expect(await svc.remove('mine')).toEqual({ ok: true });
    expect(existsSync(join(dir, 'mine'))).toBe(false);
    expect(readFileSync(join(root, 'trash', 'mine', 'save.svg'), 'utf8')).toBe(GOOD);
    expect(svc.list()).toEqual([]);
  });

  it('refuses an unknown set', async () => {
    const svc = make();
    await svc.init();
    expect(await svc.remove('nope')).toMatchObject({ ok: false, reason: 'unknown-set' });
  });

  it('reports a trash that fails as io, and keeps the set', async () => {
    put('mine', 'save.svg', GOOD);
    const svc = new IconSetService({ dir, fs: fsp, eol: '\n', readme: 'x', trash: async () => {
      throw new Error('no trash here');
    } });
    await svc.init();
    expect(await svc.remove('mine')).toMatchObject({ ok: false, reason: 'io', message: 'no trash here' });
    expect(svc.list().map((s) => s.name)).toEqual(['mine']);
  });
});

describe('reset an icon (FR-044)', () => {
  it('moves <key>.svg to the trash, so the key draws the default icon again', async () => {
    put('mine', 'save.svg', GOOD);
    put('mine', 'add.svg', OTHER);
    const svc = make();
    await svc.init();
    expect(await svc.resetIcon('mine', 'save')).toEqual({ ok: true });
    expect(existsSync(join(dir, 'mine', 'save.svg'))).toBe(false);
    expect(readFileSync(join(root, 'trash', 'save.svg'), 'utf8')).toBe(GOOD);
    expect(Object.keys(svc.list()[0].overrides)).toEqual(['add']);
  });

  it('refuses an unknown set and an unknown key', async () => {
    put('mine', 'save.svg', GOOD);
    const svc = make();
    await svc.init();
    expect(await svc.resetIcon('nope', 'save')).toMatchObject({ reason: 'unknown-set' });
    expect(await svc.resetIcon('mine', '../x')).toMatchObject({ reason: 'unknown-key' });
    expect(existsSync(join(dir, 'mine', 'save.svg'))).toBe(true);
  });
});

describe('README.txt at startup (FR-023, FR-035)', () => {
  const readmePath = (): string => join(dir, 'README.txt');

  it('writes it when absent, UTF-8 with no BOM and LF on Linux', async () => {
    await make('\n', 'café\nline two\n').init();
    const bytes = readFileSync(readmePath());
    expect(bytes.subarray(0, 3).toString('hex')).not.toBe('efbbbf');
    expect(bytes.toString('utf8')).toBe('café\nline two\n');
  });

  it('uses the OS line ending', async () => {
    await make('\r\n', 'a\nb\n').init();
    expect(readFileSync(readmePath(), 'utf8')).toBe('a\r\nb\r\n');
  });

  it('rewrites it when different, and leaves it untouched when identical', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(readmePath(), 'edited by hand', 'utf8');
    await make().init();
    expect(readFileSync(readmePath(), 'utf8')).toBe('one\ntwo\n');
    const before = (await fsp.stat(readmePath())).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));
    await make().init();
    expect((await fsp.stat(readmePath())).mtimeMs).toBe(before);
  });

  it('does not list README.txt or loose files as sets', async () => {
    const svc = make();
    await svc.init();
    expect(svc.list()).toEqual([]);
  });
});
