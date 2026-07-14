import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';

const fs = new NodeFileSystem(async () => {});
const BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

function bytes(...parts: (string | Uint8Array)[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks = parts.map((p) => (typeof p === 'string' ? enc.encode(p) : p));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

let root: string;
let outside: string;
const settings = (over: Partial<AppSettings['editor']> = {}): (() => AppSettings) => {
  return () => ({ ...DEFAULT_APP_SETTINGS, editor: { ...DEFAULT_APP_SETTINGS.editor, ...over } });
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-editor-'));
  outside = await mkdtemp(join(tmpdir(), 'throng-outside-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('EditorService save round-trip (006, contracts/editor-service.md)', () => {
  it('preserves encoding/BOM/CRLF on an unchanged line after a single-line edit', async () => {
    const svc = new EditorService(fs, settings());
    const file = join(root, 'sub', 'doc.txt');
    await fs.mkdir(join(root, 'sub'));
    await writeFile(file, bytes(BOM, 'one\r\ntwo\r\nthree\r\n'));

    const loaded = await svc.load({ absPath: file, ownerRoot: root, ownerKind: 'project', allProjectRoots: [root] });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.hasBom).toBe(true);
    expect(loaded.lineEnding).toBe('crlf');
    expect(loaded.relativeFolder).toBe('sub');
    expect(loaded.text).toBe('one\ntwo\nthree\n');

    const edited = loaded.text.replace('two', 'TWO');
    const saved = await svc.save({
      absPath: file,
      text: edited,
      encoding: loaded.encoding,
      hasBom: loaded.hasBom,
      lineEnding: loaded.lineEnding,
      ownerKind: 'project',
      ownerRoot: root,
      allProjectRoots: [root],
    });
    expect(saved.ok).toBe(true);
    const raw = new Uint8Array(await readFile(file));
    expect([...raw]).toEqual([...bytes(BOM, 'one\r\nTWO\r\nthree\r\n')]);
  });

  it('refuses an out-of-tree save for a project-owned editor (never writes outside)', async () => {
    const svc = new EditorService(fs, settings());
    const target = join(outside, 'escape.txt');
    const result = await svc.save({
      absPath: target,
      text: 'nope',
      encoding: 'utf8',
      hasBom: false,
      lineEnding: 'lf',
      ownerKind: 'project',
      ownerRoot: root,
      allProjectRoots: [root],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('out-of-tree');
    expect(await fs.exists(target)).toBe(false); // nothing written outside
  });

  it('a sub-workspace-owned editor may save outside all projects but not inside one', async () => {
    const svc = new EditorService(fs, settings());
    const insideProject = join(root, 'x.txt');
    const outsideAll = join(outside, 'note.txt');

    const refused = await svc.save({
      absPath: insideProject,
      text: 'a',
      encoding: 'utf8',
      hasBom: false,
      lineEnding: 'lf',
      ownerKind: 'subworkspace',
      ownerRoot: null,
      allProjectRoots: [root],
    });
    expect(refused.ok).toBe(false);

    const allowed = await svc.save({
      absPath: outsideAll,
      text: 'a',
      encoding: 'utf8',
      hasBom: false,
      lineEnding: 'lf',
      ownerKind: 'subworkspace',
      ownerRoot: null,
      allProjectRoots: [root],
    });
    expect(allowed.ok).toBe(true);
    expect(await readFile(outsideAll, 'utf8')).toBe('a');
  });

  it('writes a new document with LF/no-BOM defaults', async () => {
    const svc = new EditorService(fs, settings());
    const file = join(root, 'new.txt');
    const saved = await svc.save({
      absPath: file,
      text: 'alpha\nbeta\n',
      encoding: 'utf8',
      hasBom: false,
      lineEnding: 'lf',
      ownerKind: 'project',
      ownerRoot: root,
      allProjectRoots: [root],
    });
    expect(saved.ok).toBe(true);
    expect([...new Uint8Array(await readFile(file))]).toEqual([...bytes('alpha\nbeta\n')]);
  });

  it('fails clearly and leaves the buffer unsaved when the target is invalid (missing dir)', async () => {
    const svc = new EditorService(fs, settings());
    const target = join(root, 'no-such-dir', 'doc.txt'); // parent does not exist
    const result = await svc.save({
      absPath: target,
      text: 'data',
      encoding: 'utf8',
      hasBom: false,
      lineEnding: 'lf',
      ownerKind: 'project',
      ownerRoot: root,
      allProjectRoots: [root],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('io');
    expect(await fs.exists(target)).toBe(false);
  });

  it('reports a too-large file instead of opening it (FR-062)', async () => {
    const svc = new EditorService(fs, settings({ maxOpenFileBytes: 8 }));
    const file = join(root, 'big.txt');
    await writeFile(file, 'this is definitely more than eight bytes');
    const loaded = await svc.load({ absPath: file, ownerRoot: root, ownerKind: 'project', allProjectRoots: [root] });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.reason).toBe('too-large');
  });

  it('reports a binary file as un-openable (never a corrupted buffer)', async () => {
    const svc = new EditorService(fs, settings());
    const file = join(root, 'bin.dat');
    await writeFile(file, Buffer.from([0x00, 0x01, 0x02, 0x00, 0x7f]));
    const loaded = await svc.load({ absPath: file, ownerRoot: root, ownerKind: 'project', allProjectRoots: [root] });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.reason).toBe('binary');
  });
});
