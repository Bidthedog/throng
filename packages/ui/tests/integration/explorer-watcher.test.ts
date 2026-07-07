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
