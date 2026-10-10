/**
 * 054 T018 — `textFileRewrite`, the decode → transform → encode path shared by Replace All and the task
 * toggle (043 R9, 054 FR-029).
 *
 * Layer: integration — byte-exact round-trips and OS error mapping need a real disk. The BOM + CRLF
 * case and the not-UTF-8 refusal are already pinned through the toggle in task-toggle.integration.test.ts.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { textFileRewrite } from '../../src/main/text-file-rewrite.js';

const fs = new NodeFileSystem(async () => {});
const anywhere = { allowed: () => true, isOpen: () => false };
const upper = (text: string) => ({ next: text.toUpperCase(), value: 'v' });

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'throng-rewrite-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('textFileRewrite', () => {
  it('keeps every line ending of a file that mixes them', async () => {
    const path = join(dir, 'mixed.txt');
    await writeFile(path, 'a\r\nb\nc\rd');
    expect(await textFileRewrite(fs, path, anywhere, upper)).toMatchObject({ kind: 'written', value: 'v' });
    expect(await readFile(path, 'utf8')).toBe('A\r\nB\nC\rD');
  });

  it('writes nothing when the transform declines', async () => {
    const path = join(dir, 'same.txt');
    await writeFile(path, 'x');
    expect(await textFileRewrite(fs, path, anywhere, () => ({ next: null, value: 7 }))).toEqual({
      kind: 'unchanged',
      value: 7,
    });
  });

  it('refuses binary, missing and out-of-tree files without writing', async () => {
    const bin = join(dir, 'bin.dat');
    await writeFile(bin, Buffer.from([0x61, 0x00, 0x62]));
    expect(await textFileRewrite(fs, bin, anywhere, upper)).toEqual({ kind: 'failed', reason: 'binary' });
    expect(await textFileRewrite(fs, join(dir, 'gone.txt'), anywhere, upper)).toEqual({
      kind: 'failed',
      reason: 'missing',
    });
    const text = join(dir, 't.txt');
    await writeFile(text, 'x');
    expect(await textFileRewrite(fs, text, { ...anywhere, allowed: () => false }, upper)).toEqual({
      kind: 'failed',
      reason: 'outOfTree',
    });
    expect(await readFile(text, 'utf8')).toBe('x');
  });

  it('writes nothing when a document opened on the file meanwhile', async () => {
    const path = join(dir, 'opened.txt');
    await writeFile(path, 'x');
    expect(await textFileRewrite(fs, path, { ...anywhere, isOpen: () => true }, upper)).toEqual({ kind: 'becameOpen' });
    expect(await readFile(path, 'utf8')).toBe('x');
  });
});
