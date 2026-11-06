/**
 * The per-directory recursive watch Linux uses in place of Node's emulated `recursive: true` (#585).
 *
 * It keeps one watch per directory rather than one per file, so everything the recursive watch
 * used to see for free has to be followed explicitly: directories created after the watch began,
 * directories renamed or removed under it, and the root itself going away and coming back.
 *
 * Layer: integration — what is under test is how real inotify events for creates, renames and
 * removals map onto the watch tree; a mocked `fs.watch` would assert the mapping it was given.
 */
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Disposable } from '@throng/core';
import { NodeFileWatcher } from '../../src/main/node-file-watcher.js';

/** How long a report may take: the watcher's 30 ms debounce, with room for a loaded CI runner. */
const REPORT_BOUND_MS = 3000;

describe.runIf(process.platform !== 'win32')('per-directory recursive watch (#585)', () => {
  let root = '';
  let handle: Disposable | null = null;
  const reported: string[] = [];

  const start = (): void => {
    root = mkdtempSync(join(tmpdir(), 'throng-tree-watch-'));
  };

  const watch = (): void => {
    handle = new NodeFileWatcher(30, { recursiveStrategy: 'per-directory' }).watch(root, (path, batch) => {
      reported.push(...(batch?.paths ?? [path]));
    });
  };

  /** Resolves once `path` has been reported; fails past the bound. */
  const reportedPath = async (path: string): Promise<void> => {
    const started = Date.now();
    while (!reported.includes(path)) {
      if (Date.now() - started > REPORT_BOUND_MS) {
        throw new Error(`${path} was never reported; saw ${JSON.stringify(reported)}`);
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  afterEach(() => {
    handle?.dispose();
    handle = null;
    reported.length = 0;
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('reports a change in a directory that existed when the watch began, at any depth', async () => {
    start();
    mkdirSync(join(root, 'a', 'b'), { recursive: true });
    watch();
    const file = join(root, 'a', 'b', 'deep.txt');
    writeFileSync(file, 'x');
    await reportedPath(file);
  });

  it('follows a directory created afterwards, including what was put in it before its watch armed', async () => {
    start();
    watch();
    const created = join(root, 'new', 'nested');
    mkdirSync(created, { recursive: true });
    const early = join(created, 'early.txt');
    writeFileSync(early, 'x'); // races the watch on `nested` being armed
    await reportedPath(early);

    const later = join(created, 'later.txt');
    writeFileSync(later, 'x');
    await reportedPath(later);
  });

  it('follows a directory renamed within the tree to its new name', async () => {
    start();
    mkdirSync(join(root, 'before', 'inner'), { recursive: true });
    watch();
    renameSync(join(root, 'before'), join(root, 'after'));
    await reportedPath(join(root, 'after'));

    const file = join(root, 'after', 'inner', 'moved.txt');
    writeFileSync(file, 'x');
    await reportedPath(file);
  });

  it('reports a removed directory by its real path, never as a path inside itself', async () => {
    start();
    mkdirSync(join(root, 'gone'), { recursive: true });
    watch();
    rmSync(join(root, 'gone'), { recursive: true });
    await reportedPath(join(root, 'gone'));
    // Give the removed directory's own watch time to have said anything it was going to say.
    await new Promise((r) => setTimeout(r, 200));
    expect(reported).not.toContain(join(root, 'gone', 'gone'));
  });

  it('waits for a removed root and resumes when it is recreated', async () => {
    start();
    watch();
    rmSync(root, { recursive: true });
    await new Promise((r) => setTimeout(r, 200)); // the removal is noticed and the wait begins
    mkdirSync(root);
    await reportedPath(join(root, '.')); // the watch re-armed and said the whole folder is news

    const file = join(root, 'after-return.txt');
    writeFileSync(file, 'x');
    await reportedPath(file);
  });
});
