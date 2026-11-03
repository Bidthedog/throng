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
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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
  // Each failing write waits out the store's 1 s rename retry budget, so the failure is produced ONCE
  // and every read-only claim below is asserted against it. The "reports failure rather than claiming
  // success" claim is the `ok` check below.
  let root = '';
  let failed: Awaited<ReturnType<FileConfigStore['write']>>;
  let elapsed = 0;
  let strays: string[] = [];
  let different: Awaited<ReturnType<FileConfigStore['write']>>;
  let second: Awaited<ReturnType<FileConfigStore['write']>>;
  // The #265 diagnosis claims (formerly a separate file)read a SECOND failure,
  // a keybindings folder, produced concurrently so the file pays the 1 s budget once.
  let keybindingsFailure: Awaited<ReturnType<FileConfigStore['write']>>;

  beforeAll(async () => {
    root = rootWithSettingsAsDirectory();
    tempDirs.pop(); // owned by this group (afterAll), not by the per-test afterEach
    const store = new FileConfigStore(root);

    const keybindingsRoot = mkdtempSync(join(tmpdir(), 'throng-retry-exhaustion-kb-'));
    tempDirs.push(keybindingsRoot);
    mkdirSync(join(keybindingsRoot, 'keybindings.json'), { recursive: true });

    const settingsSequence = async (): Promise<void> => {
      const started = Date.now();
      failed = await store.write({ kind: 'settings' }, {});
      elapsed = Date.now() - started;
      strays = readdirSync(root).filter((name) => name.includes('.tmp'));
      // After the failure, on the same store: a different document, then the same one again.
      different = await store.write({ kind: 'keybindings' }, { version: 1, bindings: {} });
      second = await store.write({ kind: 'settings' }, {});
    };
    [, keybindingsFailure] = await Promise.all([
      settingsSequence(),
      new FileConfigStore(keybindingsRoot).write({ kind: 'keybindings' }, { version: 1, bindings: {} }),
    ]);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('says the target is a folder, names the file the user knows, never the staging file (FR-010a/FR-010b)', () => {
    if (failed.ok) throw new Error('expected the write to fail');

    // The destination, never the `.tmp` staging file the user has never seen.
    expect(failed.error, 'it names the document the user knows').toContain('settings.json');
    expect(failed.error, "throng's scratch file must never appear in a sentence").not.toContain('.tmp');
    // ACCURATE, not merely plausible: EPERM alone would have produced "is open in another program",
    // sending the user to look for a program that does not exist.
    expect(failed.error, 'it must say what is actually wrong').toMatch(/folder/i);
    expect(
      failed.error,
      'it must not assert a cause it cannot distinguish — the file is not open at all',
    ).not.toMatch(/open in another program/i);
  });

  it('names the keybindings document the user knows, never the staging file', () => {
    const error = keybindingsFailure.ok ? '' : keybindingsFailure.error;

    expect(error).toContain('keybindings.json');
    expect(error, "throng's scratch file must never appear in a sentence").not.toContain('.tmp');
  });

  it('carries no errno and no absolute path in the sentence — those belong in the copy', () => {
    // 029's rule for this surface. The sentence is for the user; the machinery is for the log.
    const error = failed.ok ? '' : failed.error;

    expect(error).not.toMatch(/EPERM|EACCES|EBUSY|ENOENT/);
    expect(error, 'no drive-letter path in the sentence').not.toMatch(/[A-Za-z]:\\/);
  });

  it('keeps the errno and the real staging path in `detail` for the log and for Copy (FR-010c)', () => {
    if (failed.ok) throw new Error('expected the write to fail');

    // What a bug report is reconstructed from. It simply is not the sentence.
    expect(failed.detail).toBeTruthy();
    expect(failed.detail).not.toBe(failed.error);
    expect(failed.detail, 'the errno survives for whoever debugs the write').toMatch(process.platform === 'win32' ? /EPERM|EACCES|EBUSY/ : /EISDIR/);
    expect(failed.detail, 'and so does the staging path').toContain('.tmp');
  });

  it('leaves no staging file behind when it gives up', () => {
    // A failed write that litters `.tmp` files would fill the config root over time, and the next
    // reader would have to guess which of them was real.
    expect(strays).toEqual([]);
  });

  it('does not hang: the retry is BOUNDED', () => {
    // The other half of "bounded". A permanently failing target must surface as a failure, not as a
    // write that never settles — a caller awaiting it would wedge, and the symptom would be
    // "preferences stopped saving" with nothing in the log.
    expect(failed.ok).toBe(false);
    // The product's budget is 1000 ms; a generous ceiling catches an unbounded loop without
    // policing machine load. (EPERM on a directory is retried; other platforms fail at once.)
    expect(elapsed, `the write took ${elapsed} ms to give up`).toBeLessThan(5_000);
  });

  it('a later write to a DIFFERENT document still succeeds', () => {
    // A failed write must not wedge the store. The per-path chain uses `then(op, op)` precisely so
    // a rejected predecessor does not strand the queue behind it.
    expect(failed.ok).toBe(false);
    expect(different).toEqual({ ok: true });
    expect(existsSync(join(root, 'keybindings.json'))).toBe(true);
  });

  it('a later write to the SAME document still gets an answer', () => {
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
