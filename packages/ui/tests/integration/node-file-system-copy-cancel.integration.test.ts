import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFileSystem } from '../../src/main/node-file-system.js';

/**
 * `copyFileCancellable` — the seam that lets Cancel land INSIDE a large file (050 R5, T010).
 *
 * `copy` is one `fs.cp` with no way to stop it. This streams, and an abort removes the partial
 * destination before rejecting, so a cancelled paste never leaves a half-written item behind.
 */

let dir: string;
const noTrash = async (): Promise<void> => {};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'throng-copy-cancel-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

/** Several megabytes of non-repeating-ish bytes, so a truncated copy cannot pass for a full one. */
function payload(megabytes: number): Buffer {
  const buf = Buffer.alloc(megabytes * 1024 * 1024);
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 31 + (i >> 8)) & 0xff;
  return buf;
}

describe('NodeFileSystem.copyFileCancellable (050 R5)', () => {
  it('copies the bytes exactly', async () => {
    const src = join(dir, 'src.bin');
    const dest = join(dir, 'dest.bin');
    const bytes = payload(3);
    await writeFile(src, bytes);
    await new NodeFileSystem(noTrash).copyFileCancellable(src, dest, new AbortController().signal);
    expect((await readFile(dest)).equals(bytes)).toBe(true);
  });

  it('an abort mid-copy rejects with an abort error and leaves NO file at dest', async () => {
    const src = join(dir, 'big.bin');
    const dest = join(dir, 'big-copy.bin');
    await writeFile(src, payload(8));
    const controller = new AbortController();
    // The read is wrapped so the abort fires from the first chunk — mid-copy by construction,
    // not by a race against how fast the disk happens to be.
    const fs = new NodeFileSystem(noTrash, undefined, (path) => {
      const stream = createReadStream(path, { highWaterMark: 64 * 1024 });
      stream.once('data', () => controller.abort());
      return stream;
    });
    const copying = fs.copyFileCancellable(src, dest, controller.signal);
    await expect(copying).rejects.toMatchObject({ name: 'AbortError' });
    expect(await fs.exists(dest)).toBe(false);
    expect(await fs.exists(src)).toBe(true);
  });

  it('an already-aborted signal copies nothing', async () => {
    const src = join(dir, 'a.txt');
    const dest = join(dir, 'b.txt');
    await writeFile(src, 'hello');
    const controller = new AbortController();
    controller.abort();
    const fs = new NodeFileSystem(noTrash);
    await expect(fs.copyFileCancellable(src, dest, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(await fs.exists(dest)).toBe(false);
  });
});
