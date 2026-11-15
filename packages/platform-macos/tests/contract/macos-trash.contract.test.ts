import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runTrashRestoreContract, skipUnlessMacos } from '@throng/core/testing';
import { MacosTrash } from '../../src/macos-trash.js';

/**
 * Layer: contract. Only the real Trash shows where `trashItemAtURL` puts an item and that it can be moved back
 * (070 FR-022, R6). Hosted runners grant broad privacy access, so the protected-Trash refusal is the unit test's.
 */
describe.skipIf(skipUnlessMacos('drives the real macOS Trash through NSFileManager'))('MacosTrash meets the shared contract', () => {
  const trash = new MacosTrash();
  let dir = '';
  let trashedPath = '';
  let occupiedPath = '';

  beforeAll(async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'throng-trash-')));
    trashedPath = join(dir, 'gone.txt');
    occupiedPath = join(dir, 'taken.txt');
    writeFileSync(trashedPath, 'restore me');
    writeFileSync(occupiedPath, 'old');
    await trash.trash(trashedPath);
    await trash.trash(occupiedPath);
    writeFileSync(occupiedPath, 'new');
  }, 30_000);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('restores an item to its original path, refuses one never trashed, and never replaces what is there', { timeout: 30_000 }, async () => {
    expect(existsSync(trashedPath)).toBe(false);
    await runTrashRestoreContract({
      make: () => trash,
      trashed: () => trashedPath,
      neverTrashed: () => join(dir, 'never.txt'),
      occupied: () => occupiedPath,
      exists: existsSync,
    });
  });

  it('trashes several items asked for together in one run, failing only the one that is missing', { timeout: 30_000 }, async () => {
    const a = join(dir, 'batch a.txt');
    const b = join(dir, "batch b's.txt");
    writeFileSync(a, 'a');
    writeFileSync(b, 'b');
    const outcomes = await Promise.allSettled([a, join(dir, 'missing.txt'), b].map((p) => trash.trash(p)));
    expect(outcomes.map((o) => o.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect(existsSync(a) || existsSync(b)).toBe(false);
    await trash.restore(b, Date.now());
    expect(existsSync(b)).toBe(true);
  });
});
