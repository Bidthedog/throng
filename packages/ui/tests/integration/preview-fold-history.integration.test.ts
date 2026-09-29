import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SHIPPED_PREVIEW_PROVIDERS, initialFold, type FoldState, type PreviewNavigateRequest } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { PreviewService } from '../../src/main/preview-service.js';
import { NavigationHistoryService } from '../../src/main/navigation-history-service.js';
import { lateListener, liveSettings, manualWatcher, recordingPush, recordingWindows } from './helpers/preview-harness.js';

/**
 * T047 (047 US3, R3, FR-041d) — the per-history-entry fold snapshot: `Map<panelId, Map<entryIndex,
 * {filePath, fold}>>`, held by `PreviewService`, written when a run LEAVES an entry (`moveRun`'s one
 * call site for both a followed link and a history step) and consulted only when Back/Forward returns
 * to it — never part of `NavigationHistoryService`'s own entries, so never in `Panel.config.history`
 * (044 FR-109 unchanged). A run that re-pairs on the way back takes the document's live state instead;
 * the snapshot is purged wholesale with the panel, never pruned per entry.
 */

const fs = new NodeFileSystem(async () => {});

const VIEWER = 7;

let root: string;
let recoveryDir: string;
let coord: EditorCoordinator;
let previews: PreviewService;
let history: NavigationHistoryService;

function meta(panelId: string, absPath: string): DocMeta {
  return {
    panelId, windowId: String(VIEWER), ownerKind: 'project', ownerProjectId: 'P', ownerRoot: root,
    allProjectRoots: [root], tabId: 't1', absPath, encoding: 'utf8', hasBom: false, lineEnding: 'lf',
  };
}

async function file(name: string, text = '# x\n'): Promise<string> {
  const path = join(root, name);
  await writeFile(path, text);
  return path;
}

async function attach(panelId: string, filePath: string) {
  const res = await previews.attach(VIEWER, { panelId, projectId: 'P', filePath });
  if (!res.ok) throw new Error(`attach refused: ${res.reason}`);
  return res.update;
}

const link = (panelId: string, absPath: string) =>
  previews.navigate(VIEWER, { panelId, target: { absPath }, intent: { kind: 'link' } });

const step = (panelId: string, absPath: string, index: number) => {
  const req: PreviewNavigateRequest = { panelId, target: { absPath }, intent: { kind: 'history', index } };
  return previews.navigate(VIEWER, req);
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-fold-history-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-fold-history-rec-'));
  const relay = lateListener();
  const service = new EditorService(fs, () => liveSettings().current);
  coord = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10_000,
    relaySync: () => {},
    persistUndoHistory: () => false,
    documentLifecycle: relay,
  });
  history = new NavigationHistoryService({ cap: () => 50, broadcastChanged: () => {} });
  previews = new PreviewService({
    documents: coord,
    reader: service,
    fs,
    fileWatcher: manualWatcher(),
    settings: liveSettings().get,
    registry: SHIPPED_PREVIEW_PROVIDERS,
    projectRoot: async (id) => (id === 'P' ? root : undefined),
    push: recordingPush(),
    windows: recordingWindows(),
    history,
    foldRekey: {
      reparent: (panelId, key, parented) => coord.reparentFold(panelId, key, parented),
      forget: (key) => coord.forgetFold(key),
      read: (key) => coord.readFold(key),
      restore: (key, state) => coord.setFoldState(key, state, -1),
    },
  });
  relay.bind(previews);
});

afterEach(async () => {
  for (const id of ['ed1', 'v1', 'v2']) {
    coord.destroy(id);
    previews.destroyed(id);
  }
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('the per-entry fold snapshot (047 FR-041d)', () => {
  it('a standalone run leaves an entry folded, navigates, and Back restores its panel: fold state', async () => {
    const a = await file('a.md');
    const b = await file('b.md');
    await attach('v1', a); // standalone: v1 -> panel:v1

    const key = previews.foldKeyFor('v1')!;
    expect(key).toBe('panel:v1');
    const folded: FoldState = { base: 'collapsed', flipped: ['deep'] };
    coord.setFoldState(key, folded, -1);

    const moved = await link('v1', b); // leaves entry 0 (a, folded) for a NEW entry 1 (b)
    expect(moved.kind).toBe('shown');
    // `panel:<id>` is ONE entry per RUN, not per file (R3): with nothing to reset it, it simply carries
    // over onto `b` until something changes it — which is exactly why the snapshot exists (below), not
    // a claim that `b` starts folded the way `a` was.
    expect(coord.foldStateFor(previews.foldKeyFor('v1')!, 'expanded')).toEqual(folded);
    // Something DOES then change it, while `b` is shown — proving Back restores `a`'s memory, not
    // whatever `panel:v1` happens to hold live when the step lands.
    const onB: FoldState = { base: 'expanded', flipped: ['shallow'] };
    coord.setFoldState(previews.foldKeyFor('v1')!, onB, -1);

    const back = await step('v1', a, 0); // Back onto entry 0
    expect(back.kind).toBe('shown');
    expect(previews.run('v1')?.filePath).toBe(a);
    // Restored exactly what was folded before the run left it — NOT `onB`.
    expect(coord.foldStateFor(previews.foldKeyFor('v1')!, 'expanded')).toEqual(folded);
  });

  it('the snapshot is purged with the panel, and never reaches Panel.config.history', async () => {
    const a = await file('a.md');
    const b = await file('b.md');
    await attach('v1', a);
    coord.setFoldState(previews.foldKeyFor('v1')!, { base: 'collapsed', flipped: [] }, -1);
    await link('v1', b);
    await step('v1', a, 0); // a snapshot for entry 0 now exists AND was just consulted

    // FR-109 (044, unchanged) — the persisted history carries only what it always did: no fold data.
    const persisted = history.get('v1');
    expect(persisted).toBeDefined();
    for (const entry of persisted!.entries) {
      // Only ever `filePath` and, optionally, `viewState` — a `NavigationEntry` has no field this
      // spec could have added one to, so this is really a type-level guarantee made concrete: the
      // per-entry fold snapshot lives entirely outside `NavigationHistoryService`'s own model.
      expect(Object.keys(entry).sort()).toEqual(Object.keys(entry).filter((k) => k === 'filePath' || k === 'viewState').sort());
    }

    coord.destroy('v1' /* no-op: v1 is a preview, not an editor — destroy affects nothing here */);
    previews.destroyed('v1');

    // Re-attaching a NEW panel id at the same path starts fresh: nothing survived the destroy under
    // v1's identity (the snapshot map is keyed by panelId, purged wholesale).
    await attach('v2', a);
    expect(coord.foldStateFor(previews.foldKeyFor('v2')!, 'expanded')).toEqual(initialFold('expanded'));
  });

  it("a run that RE-PAIRS on Back takes the document's live state, not the snapshot", async () => {
    const a = await file('a.md');
    const b = await file('b.md');
    await coord.load({ ...meta('ed1', a) }); // a has a document from the start
    await attach('v1', a); // v1 PARENTS to ed1 — its key is ed1's file: key, never a panel: one

    const docKey = coord.foldKeyForPanel('ed1')!;
    coord.setFoldState(docKey, { base: 'collapsed', flipped: ['x'] }, -1); // folded while parented

    await link('v1', b); // unbinds (b has no document): standalone now

    // Nobody folds anything on `b`; the document's `a` state moves on independently while v1 is away.
    coord.setFoldState(docKey, { base: 'expanded', flipped: ['y'] }, -1);

    const back = await step('v1', a, 0); // Back onto `a` — ed1 is STILL open, so v1 RE-PAIRS
    expect(back.kind).toBe('shown');
    expect(previews.foldKeyFor('v1')).toBe(docKey); // parented again: shares the document's key

    // The document's CURRENT state, not whatever v1 last saw before it left — because there is no
    // snapshot-vs-live race for a parented run: there is only ever one entry for the document.
    expect(coord.foldStateFor(docKey, 'expanded')).toEqual({ base: 'expanded', flipped: ['y'] });
  });
});
