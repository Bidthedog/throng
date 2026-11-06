/**
 * Contract test for the UI-main {@link NodeFileWatcher} (T029 / IFileWatcher).
 * Runs the shared IFileWatcher contract suite against a real temp directory.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFileWatcherContract } from '@throng/core/testing';
import { NodeFileWatcher, type RecursiveWatchStrategy } from '../../src/main/node-file-watcher.js';

/**
 * Both recursive strategies honour the contract (#585): `native` is what Windows and macOS run,
 * `per-directory` is what Linux runs. Each is exercised on the platforms that can host it — a
 * per-directory watch holds a handle on every folder, which Windows will not let a test delete.
 */
const strategies: RecursiveWatchStrategy[] =
  process.platform === 'win32' ? ['native'] : ['native', 'per-directory'];

for (const recursiveStrategy of strategies) {
  runFileWatcherContract(`NodeFileWatcher (${recursiveStrategy})`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'throng-watch-'));
    return {
      watcher: new NodeFileWatcher(40, { recursiveStrategy }),
      dir,
      async touch(file: string) {
        writeFileSync(join(dir, file), `// ${Date.now()}`, 'utf8');
      },
      async cleanup() {
        rmSync(dir, { recursive: true, force: true });
      },
    };
  });
}
