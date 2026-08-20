import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorRecovery } from '../../src/main/editor-recovery.js';

/**
 * Two snapshots of ONE document, overlapping (024 FR-042).
 *
 * ══ THE DEFECT THIS REPRODUCES ══
 *
 * `EditorRecovery.write` is atomic by writing a temp file and renaming it over the real one, and the
 * comment beside it is right about why: a crash-recovery file that a crash can destroy is not much
 * of a recovery file, and these writes land on a 400 ms debounce while the user types, so "the
 * process died mid-write" is the case the module exists for.
 *
 * The temp path, though, is FIXED per panel — `${target}.tmp`. So two writes for the same panel do
 * not serialise, they COLLIDE:
 *
 *   A: writeFile(p.tmp) …opens, truncates, writes
 *   B: writeFile(p.tmp) …opens the SAME file, truncates it under A
 *   A: rename(p.tmp, p)  …EPERM — B still holds the handle
 *   B: rename(p.tmp, p)  …ENOENT — A already renamed it away
 *
 * Both were seen for real during 035, in two different integration files, with two different error
 * codes: `ENOENT` in `editor-move.integration.test.ts` and `EPERM` in
 * `editor-file-deleted.integration.test.ts` during a full gate run. Neither test is about recovery;
 * both simply had a document dirty enough to snapshot while the machine was loaded. The first was
 * "fixed" by changing the TEST — which is what treating a production race as a test problem looks
 * like, and this file is the correction.
 *
 * ══ WHY THIS IS NOT A TEST-ONLY CONCERN ══
 *
 * The rejection is unhandled. `EditorCoordinator.snapshot` calls `this.recovery.write(...)` from a
 * debounce timer with no catch, so in the application this is an unhandled promise rejection on the
 * path that exists to protect unsaved work — and the snapshot it was making is simply lost. A user
 * typing quickly is exactly the case that produces two overlapping writes.
 */

let dir: string;
let recovery: EditorRecovery;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'throng-rec-race-'));
  recovery = new EditorRecovery(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const snapshot = (text: string, version: number) => ({ version, text });

describe('two overlapping snapshots of one document (FR-042)', () => {
  it('both settle, and neither rejects', async () => {
    /*
     * The reproduction. Fired without awaiting the first, which is what a debounce firing while an
     * earlier write is still in flight does — and what a loaded machine makes likely.
     */
    const writes = Promise.all([
      recovery.write('p1', snapshot('first', 1)),
      recovery.write('p1', snapshot('second', 2)),
    ]);

    await expect(writes).resolves.toBeDefined();
  });

  it('leaves a COMPLETE snapshot behind, never a half-written one', async () => {
    // The point of the rename. Whichever write lands last, what is on disk must be a whole document
    // — a recovery file that parses to nothing is worse than none, because it is trusted.
    await Promise.all([
      recovery.write('p1', snapshot('first', 1)),
      recovery.write('p1', snapshot('second', 2)),
    ]);

    const held = await recovery.list();
    expect(held).toHaveLength(1);
    expect(['first', 'second']).toContain(held[0]!.text);
  });

  it('leaves no .tmp file behind', async () => {
    /*
     * The other half of the collision: a temp that is orphaned because the write that owned it lost
     * the race. It accumulates in the recovery directory, and `list()` has to ignore it forever.
     */
    await Promise.all([
      recovery.write('p1', snapshot('first', 1)),
      recovery.write('p1', snapshot('second', 2)),
      recovery.write('p1', snapshot('third', 3)),
    ]);

    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('keeps DIFFERENT panels apart under the same pressure', async () => {
    // The control. A fix that serialised every write globally would pass the three above and make
    // an unrelated document wait behind this one; a fix that shared a temp across panels would
    // corrupt them into each other.
    await Promise.all([
      recovery.write('p1', snapshot('one', 1)),
      recovery.write('p2', snapshot('two', 1)),
      recovery.write('p3', snapshot('three', 1)),
    ]);

    const held = await recovery.list();
    expect(held.map((h) => h.panelId).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(held.find((h) => h.panelId === 'p2')?.text).toBe('two');
  });

  it('survives a burst, which is what typing actually produces', async () => {
    // Ten overlapping writes for one panel — a user holding a key down with a 400ms debounce behind
    // them. Every one must settle and the file must still parse.
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => recovery.write('p1', snapshot(`v${i}`, i))),
    );

    const held = await recovery.list();
    expect(held).toHaveLength(1);
    expect(held[0]!.text).toMatch(/^v\d$/);
    const raw = await readFile(join(dir, 'p1'), 'utf8');
    expect(() => JSON.parse(raw) as unknown).not.toThrow();
  });
});
