import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ExplorerWatcher } from '../../src/main/explorer-watcher.js';
import { NodeFileWatcher } from '../../src/main/node-file-watcher.js';

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

describe('ExplorerWatcher live-sync push (004 US2 T029)', () => {
  it('emits a change when a file is created under the watched root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'throng-watch-'));
    await mkdir(join(root, 'src'));
    const events: Array<{ relDir: string }> = [];
    const watcher = new ExplorerWatcher(new NodeFileWatcher(50), (e) => events.push(e));
    watcher.setRoot(root);
    try {
      await new Promise((r) => setTimeout(r, 150)); // let the recursive watch arm
      await writeFile(join(root, 'src', 'new.ts'), 'x');
      await waitFor(() => events.length > 0);
      expect(events.length).toBeGreaterThan(0);
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
      await new Promise((r) => setTimeout(r, 150)); // let the recursive watch arm
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
