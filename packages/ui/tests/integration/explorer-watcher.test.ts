import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ExplorerWatcher } from '../../src/main/explorer-watcher.js';
import { NodeFileWatcher } from '../../src/main/node-file-watcher.js';
import { SharedFileWatcher } from '../../src/main/shared-file-watcher.js';
import { skipUnlessLinux } from '@throng/core/testing';
import type { IFileWatcher } from '@throng/core';

function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = (): void => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('timed out'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

/**
 * Prove the recursive watch is armed by waiting for a probe file's report, instead of sleeping for a guess.
 * The probe sits in the root itself, so it never names `src` or `docs`.
 */
async function armed(root: string, seen: () => number): Promise<void> {
  const probe = join(root, 'watch-armed.probe');
  const before = seen();
  for (let i = 0; i < 40 && seen() === before; i += 1) {
    await writeFile(probe, String(i));
    await new Promise((r) => setTimeout(r, 50));
  }
  await waitFor(() => seen() > before);
  await rm(probe, { force: true });
}

describe('ExplorerWatcher live-sync push (004 US2 T029)', () => {
  it('emits a change when a file is created under the watched root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'throng-watch-'));
    await mkdir(join(root, 'src'));
    const events: Array<{ relDir: string }> = [];
    const watcher = new ExplorerWatcher(new NodeFileWatcher(50), (e) => events.push(e));
    watcher.setRoot(root);
    try {
      await armed(root, () => events.length);
      await writeFile(join(root, 'src', 'new.ts'), 'x');
      const named = (): boolean =>
        events.some((e) => e.relDir === 'src' || (e as { relDirs?: string[] }).relDirs?.includes('src'));
      await waitFor(named);
      expect(named()).toBe(true);
    } finally {
      watcher.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('names every directory a burst touched, so the tree re-reads only those (#482)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'throng-watch-'));
    await mkdir(join(root, 'src'));
    await mkdir(join(root, 'docs'));
    const events: Array<{ relDir: string; relDirs?: string[] }> = [];
    const paths: Array<readonly string[] | null> = [];
    const watcher = new ExplorerWatcher(new NodeFileWatcher(50), (e, _root, relPaths) => {
      events.push(e);
      paths.push(relPaths);
    });
    watcher.setRoot(root);
    try {
      await armed(root, () => events.length);
      await writeFile(join(root, 'src', 'a.ts'), 'x');
      await writeFile(join(root, 'docs', 'b.md'), 'x');
      const named = (): Set<string> => new Set(events.flatMap((e) => e.relDirs ?? []));
      await waitFor(() => named().has('src') && named().has('docs'));
      expect(events.every((e) => e.relDirs !== undefined), 'a report could not name its directories').toBe(true);
      expect(paths.flatMap((p) => p ?? [])).toEqual(expect.arrayContaining(['src/a.ts', 'docs/b.md']));
    } finally {
      watcher.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('stops emitting after the root is cleared', async () => {
    const root = await mkdtemp(join(tmpdir(), 'throng-watch-'));
    const events: Array<{ relDir: string }> = [];
    const watcher = new ExplorerWatcher(new NodeFileWatcher(50), (e) => events.push(e));
    watcher.setRoot(root);
    await new Promise((r) => setTimeout(r, 150));
    watcher.setRoot(null);
    const before = events.length;
    await writeFile(join(root, 'after.ts'), 'x');
    await new Promise((r) => setTimeout(r, 400));
    try {
      expect(events.length).toBe(before);
    } finally {
      watcher.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});

/*
 * 062 FR-051 — editing an ignore list (the explorer's globs, a hidden set, search's lists) re-asks the project watch,
 * which widens or narrows in place. Linux's per-directory watch is the one that leaves a folder unwatched.
 */
describe.skipIf(skipUnlessLinux('the per-directory watch is the strategy only Linux uses (#585)'))(
  'ExplorerWatcher follows an edited ignore list (062 FR-051)',
  () => {
    it('stops and starts following a folder as the list changes, on the same watch', async () => {
      const root = await mkdtemp(join(tmpdir(), 'throng-explorer-rescope-'));
      await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
      const inner = new NodeFileWatcher(30, { recursiveStrategy: 'per-directory' });
      let opened = 0;
      const counting: IFileWatcher = {
        watch: (...args) => {
          opened += 1;
          return inner.watch(...args);
        },
      };
      let ignoring = true;
      const heard: string[] = [];
      const watcher = new ExplorerWatcher(
        new SharedFileWatcher(counting),
        (evt, _root, relPaths) => heard.push(...(relPaths ?? [evt.relDir])),
        undefined,
        () => (rel) => ignoring && rel === 'node_modules',
      );
      const until = async (what: string, ok: () => boolean): Promise<void> => {
        const started = Date.now();
        while (!ok()) {
          if (Date.now() - started > 5000) throw new Error(`timed out: ${what}; heard ${JSON.stringify(heard)}`);
          await new Promise((r) => setTimeout(r, 20));
        }
      };
      try {
        watcher.setRoot(root);
        await writeFile(join(root, 'node_modules', 'pkg', 'one.js'), 'x');
        await writeFile(join(root, 'kept.txt'), 'x');
        await until('the kept file', () => heard.includes('kept.txt'));
        await new Promise((r) => setTimeout(r, 200));
        expect(heard).not.toContain('node_modules/pkg/one.js');

        ignoring = false; // the user takes node_modules off the list
        watcher.rescope();
        await writeFile(join(root, 'node_modules', 'pkg', 'two.js'), 'x');
        await until('a change inside the unignored folder', () => heard.includes('node_modules/pkg/two.js'));

        ignoring = true; // and puts it back
        watcher.rescope();
        heard.length = 0;
        await writeFile(join(root, 'node_modules', 'pkg', 'three.js'), 'x');
        await writeFile(join(root, 'kept2.txt'), 'x');
        await until('the second kept file', () => heard.includes('kept2.txt'));
        await new Promise((r) => setTimeout(r, 200));
        expect(heard).not.toContain('node_modules/pkg/three.js');
        expect(opened, 'an edited list opened a second watch').toBe(1);
      } finally {
        watcher.dispose();
        await rm(root, { recursive: true, force: true });
      }
    }, 30_000);
  },
);
