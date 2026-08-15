import { describe, expect, it } from 'vitest';
import { withDocumentLock, withDocumentsLock } from '../../src/main/config-write-lock.js';

/**
 * 032 T010a/T010b (FR-002a, G11, G12) — the per-document lock.
 *
 * ══ WHAT THIS IS FOR ══
 *
 * Reading a document and writing it back is not atomic just because the WRITE is. `writeFilesAtomic`
 * makes the file replace all-or-nothing; it says nothing about the gap between reading a document and
 * writing the modified version, and that gap is where every bug in this feature lives.
 *
 * Verified before this file existed: `config-write-ipc.ts` had no chain, queue, mutex or lock, and
 * the only serialisation anywhere in the system was `writeChains` in `write-config.ts` — module-scoped
 * in a RENDERER, so it ordered one window's writes and nothing else. Two main-process
 * read-modify-write paths therefore interleaved as read-A, read-B, write-A, write-B, and B silently
 * dropped A's change.
 *
 * The lock is per DOCUMENT rather than global on purpose: a theme write has no reason to wait behind
 * a settings write, and a global lock would serialise the whole config subsystem to buy nothing.
 */
const SETTINGS = { kind: 'settings' } as const;
const KEYBINDINGS = { kind: 'keybindings' } as const;

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('withDocumentLock', () => {
  it('runs one critical section at a time for the same document', async () => {
    /*
     * The test the whole feature rests on. Both sections read a shared counter, await, then write it
     * back — the read-modify-write shape. Without the lock both read 0 and the result is 1; with it
     * the second reads what the first wrote and the result is 2.
     */
    let value = 0;
    const gate = deferred<void>();

    const first = withDocumentLock(SETTINGS, async () => {
      const read = value;
      await gate.promise; // hold the lock open across a real await point
      value = read + 1;
    });

    const second = withDocumentLock(SETTINGS, async () => {
      const read = value;
      await Promise.resolve();
      value = read + 1;
    });

    gate.resolve();
    await Promise.all([first, second]);

    expect(value, 'the second section must observe what the first wrote').toBe(2);
  });

  it('does NOT serialise across different documents', async () => {
    // A theme write waiting behind a settings write would be a global lock wearing a per-document
    // label, and would serialise the whole config subsystem to buy nothing.
    const started: string[] = [];
    const gate = deferred<void>();

    const settings = withDocumentLock(SETTINGS, async () => {
      started.push('settings');
      await gate.promise;
    });
    const keybindings = withDocumentLock(KEYBINDINGS, async () => {
      started.push('keybindings');
    });

    await keybindings;
    expect(started, 'keybindings must not wait for a settings write to finish').toEqual([
      'settings',
      'keybindings',
    ]);

    gate.resolve();
    await settings;
  });

  it('keys a theme lock by NAME, so two themes do not block each other', async () => {
    const started: string[] = [];
    const gate = deferred<void>();

    const matrix = withDocumentLock({ kind: 'theme', name: 'Matrix' }, async () => {
      started.push('Matrix');
      await gate.promise;
    });
    const gothic = withDocumentLock({ kind: 'theme', name: 'Gothic' }, async () => {
      started.push('Gothic');
    });

    await gothic;
    expect(started).toEqual(['Matrix', 'Gothic']);

    gate.resolve();
    await matrix;
  });

  it('releases the lock when a section THROWS, and the next section still runs', async () => {
    /*
     * A lock that is not released on failure is worse than no lock: the first error wedges every
     * later write to that document for the life of the process, and the symptom is "preferences
     * stopped saving" with nothing in the log.
     */
    const failed = withDocumentLock(SETTINGS, async () => {
      throw new Error('write failed');
    });
    await expect(failed).rejects.toThrow('write failed');

    const after = await withDocumentLock(SETTINGS, async () => 'ran');
    expect(after, 'a failed section must not wedge the document').toBe('ran');
  });

  it('propagates the section result to its own caller', async () => {
    const result = await withDocumentLock(SETTINGS, async () => ({ ok: true as const }));
    expect(result).toEqual({ ok: true });
  });

  it('a multi-document section excludes a single-document one that overlaps it', async () => {
    /*
     * `resetEverything` and `restoreAllThemes` span settings, key bindings and every theme as one
     * all-or-nothing operation. A single-document lock would leave the others unprotected for the
     * duration — atomic on disk and still racing every other writer, which is exactly the confusion
     * this feature removes.
     */
    const order: string[] = [];
    const gate = deferred<void>();

    const wide = withDocumentsLock([SETTINGS, KEYBINDINGS], async () => {
      order.push('wide:start');
      await gate.promise;
      order.push('wide:end');
    });

    // Overlaps on keybindings, so it must wait for the whole wide section, not just part of it.
    const narrow = withDocumentLock(KEYBINDINGS, async () => {
      order.push('narrow');
    });

    gate.resolve();
    await Promise.all([wide, narrow]);

    expect(order).toEqual(['wide:start', 'wide:end', 'narrow']);
  });

  it('a multi-document section does NOT block a document it does not name', async () => {
    const order: string[] = [];
    const gate = deferred<void>();

    const wide = withDocumentsLock([SETTINGS, KEYBINDINGS], async () => {
      order.push('wide:start');
      await gate.promise;
    });
    const unrelated = withDocumentLock({ kind: 'theme', name: 'Matrix' }, async () => {
      order.push('theme');
    });

    await unrelated;
    expect(order).toEqual(['wide:start', 'theme']);

    gate.resolve();
    await wide;
  });

  it('preserves FIFO order across many contenders', async () => {
    // Ordering is the property callers rely on to reason about "last write wins": the later CALL
    // must be the later WRITE, not whichever promise the scheduler happens to resume first.
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        withDocumentLock(SETTINGS, async () => {
          await Promise.resolve();
          order.push(n);
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });
});
