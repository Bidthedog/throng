/**
 * 032 T030a — FR-009's SECOND half, which nothing asserted (for the product path).
 *
 * FR-009 has two clauses and only one was covered. "A write completed by replacing the target file
 * MUST tolerate transient sharing violations with a bounded retry" is exercised wherever a write
 * lands under contention. "...and MUST report a definite outcome once the retries are spent" was
 * asserted nowhere for the application's own store — T030 covers only the TEST helper.
 *
 * That is the more important half. A write that gives up must say so; the failure mode it guards
 * against is `{ok: true}` for a write that never reached disk, which is #75 exactly: the renderer
 * published it, the UI showed the new value, and the edit was gone.
 *
 * ══ HOW THE FAILURE IS FORCED ══
 *
 * A DIRECTORY is placed where the file should be. `rename` over a directory fails with EPERM on
 * Windows and EISDIR/ENOTDIR elsewhere, and it fails PERMANENTLY — which is what makes the test
 * deterministic. Holding a real file handle would reproduce the transient case, but transiently, so
 * the assertion would depend on winning a race against the operating system.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileConfigStore } from '../../src/main/config-store.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function rootWithSettingsAsDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-retry-exhaustion-'));
  tempDirs.push(root);
  // The user's own report that produced #265: a folder called `settings.json`.
  mkdirSync(join(root, 'settings.json'), { recursive: true });
  return root;
}

describe('FR-009 — a definite outcome once the retries are spent', () => {
  it('reports failure rather than claiming success', async () => {
    const store = new FileConfigStore(rootWithSettingsAsDirectory());
    const outcome = await store.write({ kind: 'settings' }, { appearance: { theme: 'Matrix' } });

    expect(outcome.ok).toBe(false);
  });

  it('names the file the user knows, and says it is a folder (FR-010a/FR-010b)', async () => {
    const store = new FileConfigStore(rootWithSettingsAsDirectory());
    const outcome = await store.write({ kind: 'settings' }, {});
    if (outcome.ok) throw new Error('expected the write to fail');

    // The destination, never the `.tmp` staging file the user has never seen.
    expect(outcome.error).toContain('settings.json');
    expect(outcome.error).not.toContain('.tmp');
    // ACCURATE, not merely plausible: EPERM alone would have produced "is open in another program",
    // sending the user to look for a program that does not exist.
    expect(outcome.error).toContain('folder');
  });

  it('keeps the raw system error in `detail` for the log and for Copy (FR-010c)', async () => {
    const store = new FileConfigStore(rootWithSettingsAsDirectory());
    const outcome = await store.write({ kind: 'settings' }, {});
    if (outcome.ok) throw new Error('expected the write to fail');

    // What a bug report is reconstructed from. It simply is not the sentence.
    expect(outcome.detail).toBeTruthy();
    expect(outcome.detail).not.toBe(outcome.error);
  });

  it('leaves no staging file behind when it gives up', async () => {
    // A failed write that litters `.tmp` files would fill the config root over time, and the next
    // reader would have to guess which of them was real.
    const root = rootWithSettingsAsDirectory();
    const store = new FileConfigStore(root);
    await store.write({ kind: 'settings' }, {});

    const strays = readdirSync(root).filter((name) => name.includes('.tmp'));
    expect(strays).toEqual([]);
  });

  it('does not hang: the retry is BOUNDED', async () => {
    // The other half of "bounded". A permanently failing target must surface as a failure, not as a
    // write that never settles — a caller awaiting it would wedge, and the symptom would be
    // "preferences stopped saving" with nothing in the log.
    const store = new FileConfigStore(rootWithSettingsAsDirectory());

    const started = Date.now();
    const outcome = await store.write({ kind: 'settings' }, {});
    const elapsed = Date.now() - started;

    expect(outcome.ok).toBe(false);
    // The product's budget is 1000 ms; a generous ceiling catches an unbounded loop without
    // policing machine load. (EPERM on a directory is retried; other platforms fail at once.)
    expect(elapsed, `the write took ${elapsed} ms to give up`).toBeLessThan(5_000);
  });

  it('a later write to a DIFFERENT document still succeeds', async () => {
    // A failed write must not wedge the store. The per-path chain uses `then(op, op)` precisely so
    // a rejected predecessor does not strand the queue behind it.
    const root = rootWithSettingsAsDirectory();
    const store = new FileConfigStore(root);

    const failed = await store.write({ kind: 'settings' }, {});
    const succeeded = await store.write({ kind: 'keybindings' }, { version: 1, bindings: {} });

    expect(failed.ok).toBe(false);
    expect(succeeded).toEqual({ ok: true });
    expect(existsSync(join(root, 'keybindings.json'))).toBe(true);
  });

  it('a later write to the SAME document still gets an answer', async () => {
    const store = new FileConfigStore(rootWithSettingsAsDirectory());
    await store.write({ kind: 'settings' }, {});
    const second = await store.write({ kind: 'settings' }, {});
    expect(second.ok).toBe(false); // still failing, but ANSWERING — not hung
  });
});

describe('the same store writes normally when the target is a file', () => {
  it('succeeds and leaves no staging file', async () => {
    // The control. Without it, every assertion above would also pass against a store that failed
    // unconditionally.
    const root = mkdtempSync(join(tmpdir(), 'throng-retry-exhaustion-ok-'));
    tempDirs.push(root);
    writeFileSync(join(root, 'settings.json'), '{}\n', 'utf8');
    const store = new FileConfigStore(root);

    expect(await store.write({ kind: 'settings' }, { appearance: { theme: 'Matrix' } })).toEqual({
      ok: true,
    });
    expect(readdirSync(root).filter((n) => n.includes('.tmp'))).toEqual([]);
  });
});
