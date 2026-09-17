import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SHIPPED_PREVIEW_PROVIDERS,
  rewritePaths,
  serialiseHistory,
  type NavigationHistory,
  type PersistedHistory,
} from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { NavigationHistoryService } from '../../src/main/navigation-history-service.js';
import { PreviewService } from '../../src/main/preview-service.js';
import { createInAppMoveCallbacks, type InAppMoveCallbacks } from '../../src/main/in-app-moves.js';
import type { MovePair } from '../../src/main/files-service.js';
import { lateListener, liveSettings, manualWatcher, recordingPush, recordingWindows } from './helpers/preview-harness.js';

/**
 * Review of fix batch B, I-1 (IMPORTANT) — an in-app move onto a path that already has a preview keeps the
 * moved run on its OLD path (FR-012; the item 3 ruling). Main's run did; nothing else did.
 *
 * The same move callback then rewrote EVERY navigation history — the held-back run's included — and sent
 * `throng:files:moved`, from which every window rewrote that preview's `config.filePath` and
 * `config.history`. The layout therefore persisted the destination, and the next launch attached the run
 * there beside the one already on it: two previews of one file.
 *
 * So this composes the REAL callback order (`createInAppMoveCallbacks`: coordinator, previews, histories,
 * broadcast) and replays everything main sends onto a layout config exactly as the two renderer syncs apply
 * it (`HistoryMirrorSync`, `PreviewPathSync`) — then checks what would be persisted.
 */

const fs = new NodeFileSystem(async () => {});

let root: string;
let recoveryDir: string;
let coord: EditorCoordinator;
let previews: PreviewService;
let history: NavigationHistoryService;
let callbacks: InAppMoveCallbacks;
let push: ReturnType<typeof recordingPush>;

/** Everything main sent every window, in order. */
type WireMessage =
  | { kind: 'files:moved'; moves: readonly MovePair[] }
  | { kind: 'history:changed'; panelId: string; history: NavigationHistory | null }
  | { kind: 'preview:pathChanged'; panelId: string; filePath: string };
let wire: WireMessage[];

const VIEWER = 7;

function meta(panelId: string, absPath: string): DocMeta {
  return {
    panelId,
    windowId: String(VIEWER),
    ownerKind: 'project',
    ownerProjectId: 'P',
    ownerRoot: root,
    allProjectRoots: [root],
    tabId: 't1',
    absPath,
    encoding: 'utf8',
    hasBom: false,
    lineEnding: 'lf',
  };
}

async function attach(panelId: string, filePath: string): Promise<void> {
  const res = await previews.attach(VIEWER, { panelId, projectId: 'P', filePath });
  if (!res.ok) throw new Error(`attach refused: ${res.reason}`);
}

/** A preview panel's persisted config, as a window's layout would hold it. */
interface PreviewConfig {
  filePath: string;
  history?: PersistedHistory;
}

/**
 * Replay the wire onto configs as the renderer does: `files:moved` rewrites `filePath` (PreviewPathSync, a
 * one-entry history through the reducer) and `history` (HistoryMirrorSync); `pathChanged` sets `filePath`;
 * `history:changed` writes `history`.
 */
function replay(configs: Record<string, PreviewConfig>, messages: readonly WireMessage[]): void {
  for (const msg of messages) {
    if (msg.kind === 'files:moved') {
      for (const config of Object.values(configs)) {
        const single: NavigationHistory = { entries: [{ filePath: config.filePath }], index: 0 };
        config.filePath = rewritePaths(single, msg.moves).entries[0]!.filePath;
        if (config.history) {
          const h: NavigationHistory = { entries: config.history.entries, index: config.history.index };
          config.history = serialiseHistory(rewritePaths(h, msg.moves));
        }
      }
    } else if (msg.kind === 'preview:pathChanged') {
      const config = configs[msg.panelId];
      if (config) config.filePath = msg.filePath;
    } else {
      const config = configs[msg.panelId];
      if (config && msg.history) config.history = serialiseHistory(msg.history);
    }
  }
}

/** A config per preview, persisted as the layout stood before the move. */
function persistedBeforeMove(...panelIds: string[]): Record<string, PreviewConfig> {
  const configs: Record<string, PreviewConfig> = {};
  for (const id of panelIds) {
    const h = history.get(id)!;
    configs[id] = { filePath: previews.run(id)!.filePath, history: serialiseHistory(h) };
  }
  return configs;
}

async function inAppRename(from: string, to: string): Promise<void> {
  callbacks.started([from]);
  await rename(from, to);
  callbacks.moved([{ from, to }]);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-preview-collision-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-preview-collision-rec-'));
  wire = [];
  push = recordingPush();
  const settings = liveSettings();
  history = new NavigationHistoryService({
    cap: () => 10,
    broadcastChanged: (msg) => void wire.push({ kind: 'history:changed', panelId: msg.panelId, history: msg.history }),
  });
  const relay = lateListener();
  const service = new EditorService(fs, settings.get);
  coord = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10_000,
    relaySync: () => {},
    persistUndoHistory: () => false,
    documentLifecycle: relay,
    history,
  });
  previews = new PreviewService({
    documents: coord,
    reader: service,
    fs,
    fileWatcher: manualWatcher(),
    settings: settings.get,
    registry: SHIPPED_PREVIEW_PROVIDERS,
    projectRoot: async (id) => (id === 'P' ? root : undefined),
    push: {
      ...push,
      broadcastPathChanged: (payload) => {
        push.broadcastPathChanged(payload);
        wire.push({ kind: 'preview:pathChanged', ...payload });
      },
    },
    windows: recordingWindows(),
    history,
  });
  relay.bind(previews);
  callbacks = createInAppMoveCallbacks({
    coordinator: coord,
    previews,
    history,
    broadcastFilesMoved: (moves) => void wire.push({ kind: 'files:moved', moves }),
  });
});

afterEach(async () => {
  for (const id of ['ed1']) coord.destroy(id);
  for (const id of ['v1', 'v2', 'v3']) previews.destroyed(id);
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('a move onto a previewed path keeps the moved run on its old path — in main AND in what is persisted (I-1)', () => {
  it('standalone: the held-back run’s history and config.filePath still name its old path after the whole callback', async () => {
    const a = join(root, 'a.md'); // deleted: its preview says so
    const b = join(root, 'b.md');
    await writeFile(b, '# b\n');
    await attach('v1', a);
    await attach('v2', b);
    const configs = persistedBeforeMove('v1', 'v2');
    wire.length = 0;

    await inAppRename(b, a);
    replay(configs, wire);

    expect(previews.run('v2')?.filePath).toBe(b);
    expect(history.get('v2')).toEqual({ entries: [{ filePath: b }], index: 0 });
    expect(history.get('v1')).toEqual({ entries: [{ filePath: a }], index: 0 });
    // What a relaunch would restore from: one preview per file.
    expect(configs.v2).toEqual({ filePath: b, history: { v: 1, entries: [{ filePath: b }], index: 0 } });
    expect(configs.v1).toEqual({ filePath: a, history: { v: 1, entries: [{ filePath: a }], index: 0 } });
  });

  it('parented: the run its document left behind (repointed’s atTarget branch) keeps its old path too', async () => {
    const a = join(root, 'a.md');
    const b = join(root, 'b.md');
    await writeFile(b, '# b\n');
    expect((await coord.load({ ...meta('ed1', b), absPath: b })).ok).toBe(true);
    await attach('v1', a);
    await attach('v2', b); // parented to ed1
    const configs = persistedBeforeMove('v1', 'v2');
    wire.length = 0;

    await inAppRename(b, a);
    replay(configs, wire);

    expect(previews.run('v2')?.filePath).toBe(b);
    expect(history.get('v2')).toEqual({ entries: [{ filePath: b }], index: 0 });
    expect(configs.v2).toEqual({ filePath: b, history: { v: 1, entries: [{ filePath: b }], index: 0 } });
    expect(configs.v1?.filePath).toBe(a);
  });

  it('a move with no collision still carries every preview’s history and config.filePath along (control)', async () => {
    const c = join(root, 'c.md');
    const d = join(root, 'd.md');
    await writeFile(c, '# c\n');
    await attach('v3', c);
    const configs = persistedBeforeMove('v3');
    wire.length = 0;

    await inAppRename(c, d);
    replay(configs, wire);

    expect(previews.run('v3')?.filePath).toBe(d);
    expect(history.get('v3')).toEqual({ entries: [{ filePath: d }], index: 0 });
    expect(configs.v3).toEqual({ filePath: d, history: { v: 1, entries: [{ filePath: d }], index: 0 } });
  });
});
