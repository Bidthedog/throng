/**
 * REPRO #482 — one changed file makes the project file index re-list the WHOLE project.
 *
 * ══ WHAT THE USER SEES ══
 *
 * A project with steady file activity under its root (an agent's hook appending to a log once a
 * second, a build writing output) keeps throng's main process at 60–140% of a core, in bursts of
 * ~18,000–33,000 filesystem operations per second. Typing lags, and `projects.setActive` times out.
 * Measured churn was ~12 events/s, so the cost is in what each change TRIGGERS, not in how many
 * changes there are.
 *
 * ══ WHAT SHOULD HAPPEN ══
 *
 * A changed file costs work proportional to the change: the folder it is in is re-read, and nothing
 * else. This test counts the filesystem calls the index makes while one file is appended to at a
 * steady cadence slower than the index's quiet period — the shape of the reporter's churn — and
 * compares them with the number of changes.
 *
 * Layer: integration — the cost comes from the REAL watcher's coalescing interacting with the index's
 * quiet-period reconcile; a fake watcher would have to re-implement the very timing under test.
 */
import { appendFile, mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { IFileSystem } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { NodeFileWatcher } from '../../src/main/node-file-watcher.js';
import { ProjectFileIndexService, type FileIndexUpdate } from '../../src/main/project-file-index.js';

/** Folders in the fixture project — enough that a whole-project re-list is unmistakable. */
const FOLDERS = 40;
/** How many times the one file is appended to. */
const CHANGES = 3;
/**
 * The index's quiet period here, and a cadence just slower than it.
 *
 * Production runs 750 ms against the reporter's ~1 s churn; both are scaled down by the same factor
 * so the test runs in about two seconds while keeping "a change arrives after the quiet period has
 * elapsed", which is the condition the reporter's churn meets.
 */
const QUIET_MS = 200;
const CADENCE_MS = 400;

/** An IFileSystem that counts every call made through it — the reporter's "fs-ops". */
function counting(inner: IFileSystem): { fs: IFileSystem; calls: () => number } {
  let calls = 0;
  const fs = new Proxy(inner, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        calls += 1;
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { fs, calls: () => calls };
}

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let root: string | null = null;
let service: ProjectFileIndexService | null = null;

afterEach(async () => {
  service?.dispose();
  service = null;
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  root = null;
});

describe('#482 — a changed file costs work proportional to the change', () => {
  it('appending to one file re-reads its folder, not every folder in the project', async () => {
    root = await mkdtemp(join(tmpdir(), 'throng-482-index-'));
    for (let i = 0; i < FOLDERS; i += 1) {
      const dir = join(root, `folder-${String(i).padStart(2, '0')}`);
      await mkdir(dir);
      await writeFile(join(dir, 'a.txt'), 'a');
      await writeFile(join(dir, 'b.txt'), 'b');
    }
    await mkdir(join(root, 'work'));
    const churn = join(root, 'work', 'churn.txt');
    await writeFile(churn, 'start\n');

    const { fs, calls } = counting(new NodeFileSystem(async () => {}));
    const sent: FileIndexUpdate[] = [];
    service = new ProjectFileIndexService(
      fs,
      new NodeFileWatcher(150),
      () => [],
      () => [],
      (_id, payload) => sent.push(payload),
      { quietMs: QUIET_MS, reconcileMaxWaitMs: 10_000 },
    );
    service.subscribe(1, root);

    const readyBy = Date.now() + 10_000;
    while (!sent.some((p) => p.status === 'ready' && p.paths)) {
      if (Date.now() > readyBy) throw new Error('the initial walk never completed');
      await pause(20);
    }
    // Let the watch settle past anything the fixture's own writes queued.
    await pause(QUIET_MS + 400);

    const before = calls();
    for (let i = 0; i < CHANGES; i += 1) {
      await appendFile(churn, `line ${i}\n`);
      await pause(CADENCE_MS);
    }
    await pause(QUIET_MS + 400); // the trailing work of the last change
    const spent = calls() - before;

    // Generous: a re-read of `work/` per change, plus a probe or two, is proportional.
    const budget = CHANGES * 3;
    expect(
      spent,
      `${CHANGES} appends to work/churn.txt cost ${spent} filesystem calls in a ${FOLDERS + 2}-folder ` +
        `project (budget ${budget}) — about ${Math.round(spent / CHANGES)} per change, i.e. the whole ` +
        `project is re-listed every time one file changes`,
    ).toBeLessThanOrEqual(budget);
  }, 20_000);
});

/**
 * With the reconcile no longer run after every change, the targeted rescan is what keeps the index
 * true for structural changes. Each case pushes the reconcile out of reach (a minute's quiet period
 * and ceiling), so a pass can only come from the rescan.
 */
describe('#482 — the targeted rescan alone keeps the index current', () => {
  let sent: FileIndexUpdate[];
  let calls: () => number;

  async function open(build: (root: string) => Promise<void>, globs: string[] = []): Promise<string> {
    root = await mkdtemp(join(tmpdir(), 'throng-482-rescan-'));
    await build(root);
    const counted = counting(new NodeFileSystem(async () => {}));
    calls = counted.calls;
    sent = [];
    service = new ProjectFileIndexService(
      counted.fs,
      new NodeFileWatcher(150),
      () => globs,
      () => [],
      (_id, payload) => sent.push(payload),
      { quietMs: 60_000, reconcileMaxWaitMs: 60_000 },
    );
    service.subscribe(1, root);
    await until('the initial walk', () => sent.some((p) => p.status === 'ready' && p.paths));
    await pause(400);
    return root;
  }

  /** The set subscriber 1 believes in, rebuilt from what it was sent. */
  function view(): string[] {
    const set = new Set<string>();
    for (const p of sent) {
      if (p.paths) {
        set.clear();
        for (const x of p.paths) set.add(x);
      }
      for (const x of p.removed ?? []) set.delete(x);
      for (const x of p.added ?? []) set.add(x);
    }
    return [...set].sort();
  }

  async function until(what: string, probe: () => unknown, budgetMs = 3000): Promise<void> {
    const by = Date.now() + budgetMs;
    while (!probe()) {
      if (Date.now() > by) throw new Error(`timed out: ${what}; the index holds ${JSON.stringify(view())}`);
      await pause(20);
    }
  }

  it('a folder created with files in it appears, files and all', async () => {
    const r = await open(async (dir) => {
      await mkdir(join(dir, 'src'));
      await writeFile(join(dir, 'src', 'main.ts'), '');
    });
    await mkdir(join(r, 'src', 'feature', 'deep'), { recursive: true });
    await writeFile(join(r, 'src', 'feature', 'a.ts'), '');
    await writeFile(join(r, 'src', 'feature', 'deep', 'b.ts'), '');
    await until('the new folder to be indexed', () => view().includes('src/feature/deep/b.ts'));
    expect(view()).toEqual(['src/feature/a.ts', 'src/feature/deep/b.ts', 'src/main.ts']);
  });

  it('a folder deleted with files in it disappears, files and all', async () => {
    const r = await open(async (dir) => {
      await mkdir(join(dir, 'old', 'nested'), { recursive: true });
      await writeFile(join(dir, 'old', 'a.ts'), '');
      await writeFile(join(dir, 'old', 'nested', 'b.ts'), '');
      await writeFile(join(dir, 'keep.ts'), '');
    });
    await rm(join(r, 'old'), { recursive: true, force: true });
    await until('the deleted folder to leave the index', () => !view().some((p) => p.startsWith('old/')));
    expect(view()).toEqual(['keep.ts']);
  });

  it('a folder renamed moves its files to the new name', async () => {
    const r = await open(async (dir) => {
      await mkdir(join(dir, 'before', 'inner'), { recursive: true });
      await writeFile(join(dir, 'before', 'inner', 'x.ts'), '');
    });
    await rename(join(r, 'before'), join(r, 'after'));
    await until('the rename to reach the index', () => view().includes('after/inner/x.ts'));
    await until('the old name to leave the index', () => !view().includes('before/inner/x.ts'));
    expect(view()).toEqual(['after/inner/x.ts']);
  });

  it('churn inside an excluded folder costs no filesystem calls at all (cause 5)', async () => {
    const r = await open(
      async (dir) => {
        await mkdir(join(dir, 'node_modules', 'foo'), { recursive: true });
        await writeFile(join(dir, 'index.ts'), '');
      },
      ['**/node_modules'],
    );
    const before = calls();
    for (let i = 0; i < 3; i += 1) {
      await writeFile(join(r, 'node_modules', 'foo', `f${i}.js`), String(i));
      await pause(250);
    }
    await pause(400);
    expect(calls() - before, 'a change under node_modules/foo was listed').toBe(0);
    expect(view()).toEqual(['index.ts']);
  });
});
