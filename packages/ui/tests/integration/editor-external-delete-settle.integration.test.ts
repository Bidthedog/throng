// Layer: integration — an outside delete and re-write is a claim about a real folder, its watch and the authority's reads.
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, type EditorSyncMsg } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { NodeFileWatcher } from '../../src/main/node-file-watcher.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { EXTERNAL_DELETE_SETTLE_MS } from '../../src/main/external-delete-settle.js';
import { watchStarted } from './helpers/watch-started.js';

/**
 * 081 US2, FR-013 / FR-013a / FR-014 — an outside delete waits a settle window before it is reported (#728).
 *
 * #728 candidate cause: "a file an agent deleted and rewrote within a second". The folder watch read the gap
 * between the delete and the write as a delete: `markDeleted` force-dirtied the buffer, relayed `deleted`, and the
 * tab-open scan and the panel banner reported a file that was back on disk a moment later. The settle window
 * (contracts/settle-window.md) holds the report until the path has stayed gone for `EXTERNAL_DELETE_SETTLE_MS`.
 */

const fs = new NodeFileSystem(async () => {});

let root: string;
let recoveryDir: string;
let coord: EditorCoordinator;
let synced: EditorSyncMsg[];

function meta(panelId: string, absPath: string): DocMeta {
  return {
    panelId, windowId: 'w1', ownerKind: 'project', ownerProjectId: 'A', ownerRoot: root,
    allProjectRoots: [root], tabId: 't1', absPath, encoding: 'utf8', hasBom: false, lineEnding: 'lf',
  };
}

async function until<T>(get: () => T | undefined, ms = 4000): Promise<T | undefined> {
  for (let i = 0; i < ms / 10; i++) {
    const v = get();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  return get();
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const deletedRelays = (): EditorSyncMsg[] => synced.filter((m) => m.panelId === 'p1' && m.deleted === true);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-settle-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-settle-rec-'));
  synced = [];
  const service = new EditorService(fs, () => DEFAULT_APP_SETTINGS);
  coord = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10,
    relaySync: (_from, msg) => synced.push(msg),
    persistUndoHistory: () => true,
    fileWatcher: new NodeFileWatcher(20),
  });
});

afterEach(async () => {
  coord.destroy('p1');
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('an outside delete waits the settle window (081 FR-013; #728 "deleted and rewritten within a second")', () => {
  it('a delete re-created within 200 ms is not reported, stays clean and reloads, 20 rounds out of 20 (SC-002)', async () => {
    const file = join(root, 'doc.txt');
    await writeFile(file, 'v0\n');
    await coord.load(meta('p1', file));
    await watchStarted();

    for (let round = 1; round <= 20; round++) {
      await rm(file, { force: true });
      await sleep(200); // `rm f; sleep 0.2; printf …` — inside the window
      await writeFile(file, `v${round}\n`);
      const reloaded = await until(() =>
        coord.getContent('p1')?.text === `v${round}\n` ? true : undefined,
      );
      expect(reloaded, `round ${round}: the panel shows the re-written file`).toBe(true);
      expect(deletedRelays(), `round ${round}: a rewrite was reported as a delete`).toEqual([]);
    }
    // The last round's window ends with nothing reported either.
    await sleep(EXTERNAL_DELETE_SETTLE_MS + 200);
    expect(deletedRelays()).toEqual([]);
    expect(coord.getContent('p1')).toMatchObject({ text: 'v20\n', dirty: false, fileMissing: false });
  });

  it('a delete not re-created is reported once, after the window', async () => {
    const file = join(root, 'doc.txt');
    await writeFile(file, 'x\n');
    await coord.load(meta('p1', file));
    await watchStarted();

    const removedAt = Date.now();
    await rm(file, { force: true });
    await sleep(EXTERNAL_DELETE_SETTLE_MS - 200);
    expect(deletedRelays(), 'reported before the settle window ended').toEqual([]);
    expect(coord.getContent('p1')).toMatchObject({ fileMissing: false, dirty: false });

    const relay = await until(() => deletedRelays()[0]);
    expect(relay, 'a delete that stays is still reported').toBeDefined();
    expect(Date.now() - removedAt).toBeGreaterThanOrEqual(EXTERNAL_DELETE_SETTLE_MS);
    await sleep(EXTERNAL_DELETE_SETTLE_MS + 200);
    expect(deletedRelays(), 'reported once').toHaveLength(1);
    expect(coord.getContent('p1')).toMatchObject({ fileMissing: true, dirty: true });
  });

  it('a busy folder does not push the report back: the window counts from the first failed read', async () => {
    const file = join(root, 'doc.txt');
    const noisy = join(root, 'noisy.log');
    await writeFile(file, 'x\n');
    await coord.load(meta('p1', file));
    await watchStarted();

    const removedAt = Date.now();
    await rm(file, { force: true });
    // Another file in the same folder changes every 100 ms for twice the window.
    for (let i = 0; i < (EXTERNAL_DELETE_SETTLE_MS * 2) / 100; i++) {
      await writeFile(noisy, `${i}\n`);
      await sleep(100);
    }
    const relay = deletedRelays()[0];
    expect(relay, 'still unreported after twice the window: the noise kept restarting the timer').toBeDefined();
    expect(Date.now() - removedAt).toBeGreaterThanOrEqual(EXTERNAL_DELETE_SETTLE_MS);
  });

  it('throng’s own move still needs no timer: the document follows at once and nothing is reported (FR-014)', async () => {
    const from = join(root, 'doc.txt');
    const to = join(root, 'moved.txt');
    await writeFile(from, 'body\n');
    await coord.load(meta('p1', from));
    await watchStarted();

    coord.beginMove([from]);
    await rename(from, to);
    coord.markMoved([{ from, to }]);
    expect(coord.getContent('p1'), 'the move is settled the moment the bracket closes').toMatchObject({ absPath: to, fileMissing: false });

    await sleep(EXTERNAL_DELETE_SETTLE_MS + 200);
    expect(deletedRelays()).toEqual([]);
    expect(coord.getContent('p1')).toMatchObject({ absPath: to, dirty: false, fileMissing: false });
  });
});
