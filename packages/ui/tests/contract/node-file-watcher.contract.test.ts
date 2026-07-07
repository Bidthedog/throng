/**
 * Contract test for the UI-main {@link NodeFileWatcher} (T029 / IFileWatcher).
 * Runs the shared IFileWatcher contract suite against a real temp directory.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFileWatcherContract } from '@throng/core/testing';
import { NodeFileWatcher } from '../../src/main/node-file-watcher.js';

runFileWatcherContract('NodeFileWatcher', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'throng-watch-'));
  return {
    watcher: new NodeFileWatcher(40),
    dir,
    async touch(file: string) {
      writeFileSync(join(dir, file), `// ${Date.now()}`, 'utf8');
    },
    async cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
});
