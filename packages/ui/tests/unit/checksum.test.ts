import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// @ts-expect-error — plain-JS build/CI script, imported for its pure hashing helpers.
import { sha256Hex, sha256OfFile } from '../../../../scripts/checksum.mjs';

/**
 * 020 FR-042/042a — the published checksum is the SHA-256 of the exact artifact bytes.
 */
describe('checksum (020 FR-042/042a)', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  it('sha256Hex matches the known vector for "abc"', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('sha256OfFile hashes the exact bytes on disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'throng-checksum-'));
    dirs.push(dir);
    const file = join(dir, 'artifact.bin');
    await writeFile(file, 'abc');
    expect(await sha256OfFile(file)).toBe(sha256Hex('abc'));
  });

  it('is deterministic — identical bytes give an identical digest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'throng-checksum-'));
    dirs.push(dir);
    const a = join(dir, 'a.bin');
    const b = join(dir, 'b.bin');
    await writeFile(a, 'the same bytes');
    await writeFile(b, 'the same bytes');
    expect(await sha256OfFile(a)).toBe(await sha256OfFile(b));
  });
});
