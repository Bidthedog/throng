import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { EditorCoordinator, type DocMeta } from '../../src/main/editor-coordinator.js';
import { EditorService } from '../../src/main/editor-service.js';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { editDocument } from './helpers/edit-document.js';

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

/**
 * #305 — the write chain is released once it is done with.
 *
 * The chain that fixed the race above is a `Map<panelId, Promise>`, and its own comment says the
 * entry is dropped "once this write is the last one in it". It was not: the condition asked whether
 * `writeChains.get(panelId)` was `undefined`, which right after storing this write's promise is
 * never true. So the map kept one settled promise per panel for the life of the main process —
 * small, permanent, and exactly what the comment claimed to prevent.
 *
 * Reaching into the private field is deliberate. The leak has no observable behaviour to assert
 * through the public surface — that is what made it survive review — so the choice is between
 * testing the field and not testing it at all.
 */
function chainCount(r: EditorRecovery): number {
  return (r as unknown as { writeChains: Map<string, unknown> }).writeChains.size;
}

describe('the write chain does not outlive its writes (#305)', () => {
  it('releases a panel once its write settles', async () => {
    await recovery.write('p1', snapshot('one', 1));

    expect(chainCount(recovery), 'nothing is in flight, so nothing is held').toBe(0);
  });

  it('releases every panel after a burst across several of them', async () => {
    await Promise.all([
      recovery.write('p1', snapshot('a', 1)),
      recovery.write('p2', snapshot('b', 1)),
      recovery.write('p3', snapshot('c', 1)),
      recovery.write('p1', snapshot('d', 2)),
    ]);

    expect(chainCount(recovery)).toBe(0);
  });

  it('holds an entry only while a write is actually in flight', async () => {
    const inFlight = recovery.write('p1', snapshot('one', 1));
    expect(chainCount(recovery), 'held while it runs').toBe(1);

    await inFlight;
    expect(chainCount(recovery), 'released once it settles').toBe(0);
  });

  it('releases the chain even when the write FAILED', async () => {
    /*
     * The case that matters most: a failure must not wedge the panel. The chain is joined on
     * settle rather than on success precisely so the next write still runs, and the entry must be
     * let go on that path too — otherwise the one panel whose disk is misbehaving is also the one
     * that leaks.
     */
    /*
     * The directory is made UNCREATABLE rather than merely deleted: `writeOnce` calls `ensureDir()`
     * first, so a deleted directory is simply recreated and the write succeeds — a test written
     * that way would assert nothing while looking as though it asserted everything. Rooting the
     * recovery directory beneath a regular FILE cannot be resolved by creating it (ENOTDIR).
     */
    const blocker = join(dir, 'not-a-directory');
    await writeFile(blocker, 'this is a file', 'utf8');
    const doomed = new EditorRecovery(join(blocker, 'recovery'));

    await expect(doomed.write('p1', snapshot('one', 1))).rejects.toThrow();
    expect(chainCount(doomed), 'a failed write releases its chain too').toBe(0);
  });
});

/**
 * #305 — and a snapshot that cannot be written is REPORTED, not thrown into the void.
 *
 * `EditorCoordinator` fires snapshots and walks away — `void this.snapshot(doc)`, once from the
 * debounce timer and once when a file goes missing — so a rejection escaping `snapshot` is an
 * unhandled rejection in the Electron MAIN process. That is a disproportionate answer to a failed
 * snapshot: recovery is best-effort, the document it protects is still open and unharmed, and the
 * next keystroke schedules another attempt.
 *
 * This is the defect that reddened a full gate, out of a test that has nothing to do with recovery
 * (`editor-file-deleted`): its debounced snapshot fired after the temp directory had gone, every
 * one of its 524 tests passed, and the stage failed on the rejection alone. The file above
 * PREDICTED it in prose — "the rejection is unhandled … with no catch" — and nothing acted on it.
 */
describe('a snapshot that cannot be written (#305)', () => {
  it('is logged and dropped, rather than escaping as an unhandled rejection', async () => {
    const blocker = join(dir, 'blocker-file');
    await writeFile(blocker, 'not a directory', 'utf8');

    const root = await mkdtemp(join(tmpdir(), 'throng-rec-swallow-'));
    const fs = new NodeFileSystem(async () => {});
    const coordinator = new EditorCoordinator(
      new EditorService(fs, () => DEFAULT_APP_SETTINGS),
      new EditorRecovery(join(blocker, 'recovery')), // uncreatable: ENOTDIR, every time
      { recoveryDebounceMs: 1, relaySync: () => {}, persistUndoHistory: () => true },
    );

    const errors: unknown[][] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);

    try {
      const file = join(root, 'doc.txt');
      await writeFile(file, 'hello\n', 'utf8');
      const docMeta: DocMeta = {
        panelId: 'p1',
        windowId: 'w1',
        ownerKind: 'project',
        ownerProjectId: 'A',
        ownerRoot: root,
        allProjectRoots: [root],
        tabId: 't1',
        absPath: file,
        encoding: 'utf8',
        hasBom: false,
        lineEnding: 'lf',
      };
      coordinator.register(docMeta, 'hello\n');

      // Typing is what arms the debounce, and the debounce is what fires the snapshot.
      editDocument(coordinator, docMeta, 'hello world\n');

      // Long enough for the 1ms debounce to fire and its write to fail. If the rejection escaped,
      // vitest reports an unhandled error and fails this file's run — which is precisely how the
      // gate found it.
      await new Promise((r) => setTimeout(r, 150));

      expect(
        errors.some((a) => String(a[0]).includes('[editor-recovery]')),
        'the failure is reported, so it is not silently swallowed either',
      ).toBe(true);
    } finally {
      console.error = realError;
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
});
