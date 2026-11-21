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
import { SharedFileWatcher } from '../../src/main/shared-file-watcher.js';
import { skipUnlessLinux } from '@throng/core/testing';

/** How long a report may take: the watcher's 30 ms debounce, with room for a loaded CI runner. */
const REPORT_BOUND_MS = 3000;

describe.skipIf(skipUnlessLinux('the per-directory watch is the strategy only Linux uses (#585); macOS watches natively'))('per-directory recursive watch (#585)', () => {
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
    // #696 — the removal is noticed, said once (the whole folder is gone), and the wait begins.
    await reportedPath(join(root, '.'));
    const whole = (): number => reported.filter((p) => p === join(root, '.')).length;
    const saidGone = whole();
    mkdirSync(root);
    // The watch re-armed and said the whole folder is news: a SECOND report, after the one for its going.
    const started = Date.now();
    while (whole() <= saidGone) {
      if (Date.now() - started > REPORT_BOUND_MS) throw new Error('the recreated root was never reported');
      await new Promise((r) => setTimeout(r, 20));
    }

    const file = join(root, 'after-return.txt');
    writeFileSync(file, 'x');
    await reportedPath(file);
  });
});

/*
 * 062 FR-051 (#274 ruling, the maintainer 2026-11-21 09:04: "Ignored folders should not be indexed (unless they are
 * unignored by the user)"). The per-directory watch read and watched EVERY folder under a project root, node_modules
 * and .git included, though nothing in throng shows or indexes them by default. A watch told what its reader ignores
 * no longer descends into it; a reader that needs a folder inside an ignored one still sees it changing.
 */
describe.skipIf(skipUnlessLinux('the per-directory watch is the strategy only Linux uses (#585); macOS watches natively'))('per-directory watch of an ignored folder (062 FR-051)', () => {
  let root = '';
  const handles: Disposable[] = [];
  const reported: string[] = [];
  const IGNORE_NODE_MODULES = (rel: string): boolean => rel === 'node_modules' || rel.endsWith('/node_modules');

  const reportedPath = async (list: string[], path: string): Promise<void> => {
    const started = Date.now();
    while (!list.includes(path)) {
      if (Date.now() - started > REPORT_BOUND_MS) throw new Error(`${path} was never reported; saw ${JSON.stringify(list)}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  afterEach(() => {
    for (const h of handles.splice(0)) h.dispose();
    reported.length = 0;
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('does not watch into an ignored folder that is there when the watch begins', async () => {
    root = mkdtempSync(join(tmpdir(), 'throng-tree-ignore-'));
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(root, 'src'));
    handles.push(
      new NodeFileWatcher(30, { recursiveStrategy: 'per-directory' }).watch(
        root,
        (p, batch) => reported.push(...(batch?.paths ?? [p])),
        { excluded: IGNORE_NODE_MODULES },
      ),
    );
    const ignored = join(root, 'node_modules', 'pkg', 'index.js');
    writeFileSync(ignored, 'x');
    // A sentinel after it: once the sentinel is reported, anything the ignored write raised has been too.
    const sentinel = join(root, 'src', 'sentinel.txt');
    writeFileSync(sentinel, 'x');
    await reportedPath(reported, sentinel);
    await new Promise((r) => setTimeout(r, 200));
    expect(reported).not.toContain(ignored);
  });

  it('does not walk into an ignored folder created after the watch began', async () => {
    root = mkdtempSync(join(tmpdir(), 'throng-tree-ignore-'));
    mkdirSync(join(root, 'src'));
    handles.push(
      new NodeFileWatcher(30, { recursiveStrategy: 'per-directory' }).watch(
        root,
        (p, batch) => reported.push(...(batch?.paths ?? [p])),
        { excluded: IGNORE_NODE_MODULES },
      ),
    );
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    await reportedPath(reported, join(root, 'node_modules')); // its parent's watch says it appeared
    await new Promise((r) => setTimeout(r, 200)); // time for a watch to have been armed inside it, were one
    const ignored = join(root, 'node_modules', 'pkg', 'later.js');
    writeFileSync(ignored, 'x');
    const sentinel = join(root, 'src', 'sentinel.txt');
    writeFileSync(sentinel, 'x');
    await reportedPath(reported, sentinel);
    await new Promise((r) => setTimeout(r, 200));
    expect(reported).not.toContain(ignored);
    expect(reported).not.toContain(join(root, 'node_modules', 'pkg'));
  });

  /** The real per-directory watcher behind a SharedFileWatcher, counting the watches it is asked to open. */
  const countingShared = (): { shared: SharedFileWatcher; opened: () => number } => {
    const inner = new NodeFileWatcher(30, { recursiveStrategy: 'per-directory' });
    let opened = 0;
    const counting = {
      watch: (...args: Parameters<NodeFileWatcher['watch']>) => {
        opened += 1;
        return inner.watch(...args);
      },
    };
    return { shared: new SharedFileWatcher(counting), opened: () => opened };
  };

  it('a project watch shared by two readers that both ignore a folder does not watch into it', async () => {
    root = mkdtempSync(join(tmpdir(), 'throng-tree-ignore-'));
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(root, 'src'));
    const { shared } = countingShared();
    // The tree and the file index, as main opens them on one root.
    handles.push(shared.watch(root, (p, batch) => reported.push(...(batch?.paths ?? [p])), { excluded: IGNORE_NODE_MODULES }));
    handles.push(shared.watch(root, () => {}, { excluded: IGNORE_NODE_MODULES }));
    const ignored = join(root, 'node_modules', 'pkg', 'index.js');
    writeFileSync(ignored, 'x');
    const sentinel = join(root, 'src', 'sentinel.txt');
    writeFileSync(sentinel, 'x');
    await reportedPath(reported, sentinel);
    await new Promise((r) => setTimeout(r, 200));
    expect(reported).not.toContain(ignored);
  });

  it('a reader that unignores the folder widens the ONE watch in place, and narrows it again on leaving (033 FR-069, #274)', async () => {
    root = mkdtempSync(join(tmpdir(), 'throng-tree-ignore-'));
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(root, 'src'));
    const { shared, opened } = countingShared();
    handles.push(shared.watch(root, (p, batch) => reported.push(...(batch?.paths ?? [p])), { excluded: IGNORE_NODE_MODULES }));
    // Quick Open's "show hidden": a reader of the same root that ignores nothing.
    const flipped = shared.watch(root, () => {}, { excluded: () => false });
    const inside = join(root, 'node_modules', 'pkg', 'shown.js');
    writeFileSync(inside, 'x');
    await reportedPath(reported, inside);
    expect(opened(), 'the flip opened a watch of its own').toBe(1);

    flipped.dispose(); // the toggle goes back
    reported.length = 0;
    const ignored = join(root, 'node_modules', 'pkg', 'ignored-again.js');
    writeFileSync(ignored, 'x');
    const sentinel = join(root, 'src', 'sentinel.txt');
    writeFileSync(sentinel, 'x');
    await reportedPath(reported, sentinel);
    await new Promise((r) => setTimeout(r, 200));
    expect(reported).not.toContain(ignored);
    expect(opened()).toBe(1);
  });

  it('still tells an editor on a file inside the ignored folder that its file changed', async () => {
    root = mkdtempSync(join(tmpdir(), 'throng-tree-ignore-'));
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    const file = join(root, 'node_modules', 'pkg', 'index.js');
    writeFileSync(file, 'one');
    const { shared, opened } = countingShared();
    // The project's watch, as the tree and the file index open it: node_modules ignored.
    handles.push(shared.watch(root, () => {}, { excluded: IGNORE_NODE_MODULES }));
    // An editor open on the file watches its folder, as EditorCoordinator does; it states no exclusions.
    const editorSaw: string[] = [];
    handles.push(shared.watch(join(root, 'node_modules', 'pkg'), (p, batch) => editorSaw.push(...(batch?.paths ?? [p]))));
    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(file, 'two');
    await reportedPath(editorSaw, file);
    expect(opened(), 'the editor is served by the project watch, widened to its folder').toBe(1);
  });
});

/*
 * 062 FR-051 on a NATIVE recursive watch (Windows, macOS). The OS cannot be told to leave a folder out, so its events
 * from inside one are dropped before coalescing: an install's burst costs no report, and cannot make a burst that also
 * touched a real file incomplete. Node's recursive watch on Linux is an emulation of the native one, which is enough
 * to prove the dropping; it is the same code on every platform.
 */
describe('native recursive watch of an ignored folder (062 FR-051)', () => {
  let root = '';
  let handle: Disposable | null = null;

  afterEach(() => {
    handle?.dispose();
    handle = null;
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('drops events from inside an ignored folder, and keeps a burst that touched a real file complete', async () => {
    root = mkdtempSync(join(tmpdir(), 'throng-native-ignore-'));
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(root, 'src'));
    const reports: { paths: readonly string[]; complete: boolean }[] = [];
    handle = new NodeFileWatcher(30, { recursiveStrategy: 'native', guardRoot: false }).watch(
      root,
      (p, batch) => reports.push({ paths: batch?.paths ?? [p], complete: batch?.complete ?? false }),
      { excluded: (rel) => rel === 'node_modules' },
    );
    await new Promise((r) => setTimeout(r, 300)); // the emulated recursive watch arms asynchronously
    for (let i = 0; i < 20; i += 1) writeFileSync(join(root, 'node_modules', 'pkg', `f${i}.js`), 'x');
    const real = join(root, 'src', 'real.ts');
    writeFileSync(real, 'x');
    const started = Date.now();
    while (!reports.some((r) => r.paths.includes(real))) {
      if (Date.now() - started > REPORT_BOUND_MS) throw new Error(`never reported; saw ${JSON.stringify(reports)}`);
      await new Promise((r) => setTimeout(r, 20));
    }
    await new Promise((r) => setTimeout(r, 200));
    const named = reports.flatMap((r) => r.paths);
    expect(named.filter((p) => p.includes(`${join('node_modules', 'pkg')}`))).toEqual([]);
    expect(reports.every((r) => r.complete)).toBe(true);
  });
});
