import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_HISTORY, SHIPPED_PREVIEW_PROVIDERS } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { PreviewService, type PreviewHistoryHooks } from '../../src/main/preview-service.js';
import { NavigationHistoryService } from '../../src/main/navigation-history-service.js';
import { lateListener, liveSettings, manualWatcher, recordingPush, recordingWindows } from './helpers/preview-harness.js';

/**
 * T032 (047 US2, R8) — `PreviewService.open`'s NEW standalone-branch reuse: `target.mode ===
 * 'lastActive'` with a live `reusePanelId` in the REQUESTING window moves that run in place instead of
 * placing a new panel (contracts/preview-ipc-047.md §1, FR-010–FR-016).
 *
 * Every OTHER branch of `open` — refusals, an already-open file, a pending reservation, a parented
 * placement (beside a local or a remote parent) — is untouched by this spec (FR-012): those suites stay
 * in `preview-service-open.integration.test.ts`. This file is only about the ONE branch that changed.
 */

const fs = new NodeFileSystem(async () => {});

const REQUESTER = 3;
const OTHER_WINDOW = 9;

let root: string;
let recoveryDir: string;
let push: ReturnType<typeof recordingPush>;
let windows: ReturnType<typeof recordingWindows>;
let settings: ReturnType<typeof liveSettings>;
let coord: EditorCoordinator;
let previews: PreviewService;
let history: { calls: Array<[string, ...unknown[]]> } & PreviewHistoryHooks;

function meta(panelId: string, absPath: string, windowId = REQUESTER): DocMeta {
  return {
    panelId, windowId: String(windowId), ownerKind: 'project', ownerProjectId: 'P', ownerRoot: root,
    allProjectRoots: [root], tabId: 't1', absPath, encoding: 'utf8', hasBom: false, lineEnding: 'lf',
  };
}

async function file(name: string, text = '# x\n'): Promise<string> {
  const path = join(root, name);
  await writeFile(path, text);
  return path;
}

const open = (
  absPath: string,
  target?: { mode: 'lastActive' | 'new'; reusePanelId: string | null },
  from = REQUESTER,
) => previews.open(from, { absPath, projectId: 'P', hasParentLocally: false, ...(target ? { target } : {}) });

async function attach(panelId: string, filePath: string, viewer = REQUESTER) {
  const res = await previews.attach(viewer, { panelId, projectId: 'P', filePath });
  if (!res.ok) throw new Error(`attach refused: ${res.reason}`);
  return res.update;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-preview-open-target-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-preview-open-target-rec-'));
  push = recordingPush();
  windows = recordingWindows(1);
  settings = liveSettings();
  const calls: Array<[string, ...unknown[]]> = [];
  history = {
    calls,
    attach: (panelId, kind, persisted) => {
      calls.push(['attach', panelId, kind, persisted]);
      return EMPTY_HISTORY;
    },
    get: () => undefined,
    rewriteCurrent: (panelId, filePath) => void calls.push(['rewriteCurrent', panelId, filePath]),
    purge: (panelId) => void calls.push(['purge', panelId]),
    recordOpen: (panelId, filePath) => void calls.push(['recordOpen', panelId, filePath]),
    moveTo: (panelId, index, filePath) => {
      calls.push(['moveTo', panelId, index, filePath]);
      return false;
    },
    setCurrentViewState: (panelId, viewState) => void calls.push(['setCurrentViewState', panelId, viewState]),
    recordJump: (panelId, leaving, arriving) => void calls.push(['recordJump', panelId, leaving, arriving]),
  };
  const relay = lateListener();
  const service = new EditorService(fs, settings.get);
  coord = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10_000,
    relaySync: () => {},
    persistUndoHistory: () => false,
    documentLifecycle: relay,
  });
  previews = new PreviewService({
    documents: coord,
    reader: service,
    fs,
    fileWatcher: manualWatcher(),
    settings: settings.get,
    registry: SHIPPED_PREVIEW_PROVIDERS,
    projectRoot: async (id) => (id === 'P' ? root : undefined),
    push,
    windows,
    history,
  });
  relay.bind(previews);
});

afterEach(async () => {
  for (const id of ['ed1', 'v1', 'v2', 'v3']) {
    coord.destroy(id);
    previews.destroyed(id);
  }
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('open — target.mode "lastActive" reuses a live standalone run (047 US2, R8)', () => {
  it('moves the reused run to the new file, records history, and answers navigated', async () => {
    const a = await file('a.md');
    const b = await file('b.md');
    await attach('v1', a); // a standalone run, viewed by REQUESTER

    const res = await open(b, { mode: 'lastActive', reusePanelId: 'v1' });

    expect(res).toEqual({ kind: 'navigated', panelId: 'v1' });
    expect(previews.run('v1')?.filePath).toBe(b);
    // FR-103 — the move is a NEW history entry, not a step: `recordOpen`, not `moveTo`.
    expect(history.calls.some((c) => c[0] === 'recordOpen' && c[1] === 'v1' && c[2] === b)).toBe(true);
  });

  it('an already-previewed target is FOCUSED first — reuse never runs (FR-013)', async () => {
    const a = await file('a.md');
    const b = await file('b.md');
    await attach('v1', a);
    await attach('v2', b); // b is already previewed, elsewhere

    const res = await open(b, { mode: 'lastActive', reusePanelId: 'v1' });

    expect(res).toEqual({ kind: 'focused', panelId: 'v2' });
    expect(previews.run('v1')?.filePath).toBe(a); // v1 never moved
  });

  it('reusePanelId in ANOTHER window is ignored — a fresh placement, never an error', async () => {
    const a = await file('a.md');
    const b = await file('b.md');
    await attach('v1', a, OTHER_WINDOW); // viewed by a DIFFERENT window than the requester

    const res = await open(b, { mode: 'lastActive', reusePanelId: 'v1' });

    expect(res).toMatchObject({ kind: 'placeLocally', besidePanelId: null });
    expect(previews.run('v1')?.filePath).toBe(a); // untouched
  });

  it('a dead reusePanelId (no such run) is ignored — a fresh placement, never an error', async () => {
    const b = await file('b.md');

    const res = await open(b, { mode: 'lastActive', reusePanelId: 'v-gone' });

    expect(res).toMatchObject({ kind: 'placeLocally', besidePanelId: null });
  });

  it('target.mode "new" always places fresh, even with a reusable panel in scope', async () => {
    const a = await file('a.md');
    const b = await file('b.md');
    await attach('v1', a);

    const res = await open(b, { mode: 'new', reusePanelId: 'v1' });

    expect(res).toMatchObject({ kind: 'placeLocally', besidePanelId: null });
    expect(previews.run('v1')?.filePath).toBe(a);
  });

  it('no target at all behaves exactly as before this spec — a fresh placement', async () => {
    const a = await file('a.md');
    const b = await file('b.md');
    await attach('v1', a);

    const res = await open(b);

    expect(res).toMatchObject({ kind: 'placeLocally', besidePanelId: null });
    expect(previews.run('v1')?.filePath).toBe(a);
  });

  it('a PARENTED reuse unbinds: Back re-pairs it while the editor stays open, standalone once it closes (FR-016/016a)', async () => {
    // A REAL `NavigationHistoryService`, not the call-recording fake above: Back/Forward need an actual
    // entry list to move through, which the fake (whose `get` always answers `undefined`) cannot give.
    const realHistory = new NavigationHistoryService({ cap: () => 50, broadcastChanged: () => {} });
    const relay = lateListener();
    const service = new EditorService(fs, settings.get);
    const coord2 = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
      recoveryDebounceMs: 10_000,
      relaySync: () => {},
      persistUndoHistory: () => false,
      documentLifecycle: relay,
      history: realHistory,
    });
    const previews2 = new PreviewService({
      documents: coord2,
      reader: service,
      fs,
      fileWatcher: manualWatcher(),
      settings: settings.get,
      registry: SHIPPED_PREVIEW_PROVIDERS,
      projectRoot: async (id) => (id === 'P' ? root : undefined),
      push: recordingPush(),
      windows: recordingWindows(1),
      history: realHistory,
    });
    relay.bind(previews2);

    const a = await file('a.md');
    const b = await file('b.md');
    await coord2.load({ ...meta('ed1', a) });
    const attached = await previews2.attach(REQUESTER, { panelId: 'v1', projectId: 'P', filePath: a });
    if (!attached.ok) throw new Error('attach refused');
    expect(attached.update.parent).toEqual({ panelId: 'ed1', title: expect.any(String) }); // v1 parents to ed1

    const res = await previews2.open(REQUESTER, {
      absPath: b,
      projectId: 'P',
      hasParentLocally: false,
      target: { mode: 'lastActive', reusePanelId: 'v1' },
    });

    expect(res).toEqual({ kind: 'navigated', panelId: 'v1' });
    // FR-016 — the move UNBINDS it: it no longer follows ed1 (b has no document of its own), and it is
    // a NEW history entry (index 1) beside the original one (index 0, still `a`).
    expect(previews2.run('v1')?.filePath).toBe(b);
    let after = await previews2.refresh('v1');
    expect(after.update?.parent).toBeNull();

    // Back onto `a` — the editor (ed1) is STILL open on it, so the run RE-PAIRS (FR-016a): parenting is
    // derived from the registry at move time, never a bond stored on the panel.
    const back = await previews2.navigate(REQUESTER, {
      panelId: 'v1',
      target: { absPath: a },
      intent: { kind: 'history', index: 0 },
    });
    expect(back).toMatchObject({ kind: 'shown' });
    expect(previews2.run('v1')?.filePath).toBe(a);
    after = await previews2.refresh('v1');
    expect(after.update?.parent).toEqual({ panelId: 'ed1', title: expect.any(String) });

    // Forward to `b` again, THEN close ed1: nothing to re-pair with any more (FR-016a's other half).
    await previews2.navigate(REQUESTER, { panelId: 'v1', target: { absPath: b }, intent: { kind: 'history', index: 1 } });
    coord2.destroy('ed1');
    const back2 = await previews2.navigate(REQUESTER, {
      panelId: 'v1',
      target: { absPath: a },
      intent: { kind: 'history', index: 0 },
    });
    expect(back2).toMatchObject({ kind: 'shown' });
    after = await previews2.refresh('v1');
    expect(after.update?.parent).toBeNull(); // standalone: no editor left to pair with

    previews2.destroyed('v1');
    coord2.destroy('ed1'); // already gone; a second destroy is a no-op
  });

  it('a parented placement branch (steps 1–3) ignores `target` entirely — FR-012 unchanged', async () => {
    const a = await file('a.md');
    await coord.load({ ...meta('ed1', a) });

    const res = await open(a, { mode: 'lastActive', reusePanelId: 'v-nonexistent' }, REQUESTER);

    // beside the local parent, exactly as an ordinary `hasParentLocally: false` open beside a document
    // already does today — `target` plays no part until step 4.
    expect(res).toMatchObject({ kind: 'placedElsewhere' });
  });
});

/** 054 T047 — a preview never moves to a file of another preview type (FR-007, FR-008). */
describe('one preview type per provider (054)', () => {
  it('a followed link to a file of another provider answers reroute and leaves the run where it was', async () => {
    const a = await file('a.md');
    const flow = await file('flow.mmd', 'graph TD; A-->B\n');
    await attach('v1', a);

    const res = await previews.navigate(REQUESTER, { panelId: 'v1', target: { absPath: flow }, intent: { kind: 'link' } });

    expect(res).toEqual({ kind: 'reroute' });
    expect(previews.run('v1')?.filePath).toBe(a);
  });

  it('a link to a file of the SAME provider still navigates in place (044 FR-090)', async () => {
    const a = await file('a.md');
    const b = await file('b.md');
    await attach('v1', a);

    const res = await previews.navigate(REQUESTER, { panelId: 'v1', target: { absPath: b }, intent: { kind: 'link' } });

    expect(res).toMatchObject({ kind: 'shown' });
    expect(previews.run('v1')?.filePath).toBe(b);
  });

  it('Last Active never reuses a run of another provider — a fresh placement instead', async () => {
    const a = await file('a.md');
    const flow = await file('flow.mmd', 'graph TD; A-->B\n');
    await attach('v1', a);

    const res = await open(flow, { mode: 'lastActive', reusePanelId: 'v1' });

    expect(res).toMatchObject({ kind: 'placeLocally' });
    expect(previews.run('v1')?.filePath).toBe(a);
  });

  it('a run records its provider id', async () => {
    const flow = await file('flow.mmd', 'graph TD; A-->B\n');
    await attach('v2', flow);
    expect(previews.run('v2')?.providerId).toBe('mermaid');
  });
});
