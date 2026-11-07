import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultLayout, type AttentionFlagEntry, type AttentionLedgerEntry, type Tab, type WorkspaceLoadResult } from '@throng/core';
import { ATTENTION_FLAG_LIST_METHOD } from '@throng/ipc-contract';
import { AttentionFlagIpcService } from '../../src/attention-flag-service.js';
import { livePanelIds, type LivePanelSources } from '../../src/live-panels.js';
import { RpcRouter } from '../../src/rpc-router.js';
import { makeHarness, type AttentionHarness } from './attention-harness.js';

/*
 * #541 — a mark stranded by a destroyed panel does not come back. Before the fix, a panel destroyed by a
 * route that never told main (a Tab destroy, a sub-workspace) left its manual flag in the daemon's store
 * and its terminal mark in the ledger, and every reconnecting main restored them onto a panel no layout
 * holds — a mark nothing can clear. The daemon holds every saved layout, so it is the one place that
 * can tell a stranded entry from a live one when main reads them back.
 */

const tab = (id: string, ...panelIds: string[]): Tab => ({
  id,
  title: id,
  root:
    panelIds.length === 1
      ? { type: 'panel', id: panelIds[0]!, originProjectId: 'A', title: panelIds[0]! }
      : {
          type: 'split',
          orientation: 'row',
          sizes: panelIds.map(() => 1 / panelIds.length),
          children: panelIds.map((p) => ({ type: 'panel' as const, id: p, originProjectId: 'A', title: p })),
        },
});

function sources(opts: {
  projects?: Record<string, WorkspaceLoadResult>;
  subs?: Tab[][];
  corruptSub?: boolean;
}): LivePanelSources {
  const projects = opts.projects ?? {};
  return {
    projectIds: () => Object.keys(projects),
    layout: (id) => projects[id]!,
    subWorkspaces: (onCorrupt) => {
      if (opts.corruptSub) onCorrupt();
      return (opts.subs ?? []).map((tabs) => ({ tabs }));
    },
  };
}
const restored = (projectId: string, tabs: Tab[]): WorkspaceLoadResult => ({
  layout: { ...createDefaultLayout(projectId, { tab: 'x', panel: 'x' }), tabs, activeTabId: tabs[0]!.id },
  restored: true,
});

describe('livePanelIds', () => {
  it('lists every panel of every saved layout and sub-workspace', () => {
    const ids = livePanelIds(
      sources({ projects: { A: restored('A', [tab('t1', 'p1', 'p2')]), B: restored('B', [tab('t2', 'p3')]) }, subs: [[tab('s', 's1')]] }),
    );
    expect([...(ids ?? [])].sort()).toEqual(['p1', 'p2', 'p3', 's1']);
  });

  it('counts a never-saved project as holding nothing, rather than its default layout’s fresh ids', () => {
    const missing: WorkspaceLoadResult = { ...restored('A', [tab('t1', 'fresh')]), restored: false, reason: 'missing' };
    expect([...(livePanelIds(sources({ projects: { A: missing } })) ?? ['?'])]).toEqual([]);
  });

  it('answers “not known” when a layout or a sub-workspace cannot be read', () => {
    const corrupt: WorkspaceLoadResult = { ...restored('A', [tab('t1', 'x')]), restored: false, reason: 'corrupt' };
    expect(livePanelIds(sources({ projects: { A: corrupt } }))).toBeNull();
    expect(livePanelIds(sources({ projects: { B: restored('B', [tab('t', 'p')]) }, corruptSub: true }))).toBeNull();
  });
});

function flagStore(initial: AttentionFlagEntry[]) {
  const rows = new Map(initial.map((f) => [f.panelId, f]));
  return {
    list: () => [...rows.values()],
    set: (f: AttentionFlagEntry) => void rows.set(f.panelId, f),
    clear: (panelId: string) => void rows.delete(panelId),
    rows,
  };
}
const flag = (panelId: string): AttentionFlagEntry => ({
  panelId,
  projectId: 'A',
  panelTitle: panelId,
  tabTitle: '',
  projectName: 'A',
  raisedAt: 1,
});
async function listFlags(store: ReturnType<typeof flagStore>, live: () => ReadonlySet<string> | null): Promise<string[]> {
  const router = new RpcRouter();
  new AttentionFlagIpcService(store, live).register(router);
  const res = (await router.handle({ jsonrpc: '2.0', id: 1, method: ATTENTION_FLAG_LIST_METHOD, params: {} })) as {
    result: { flags: AttentionFlagEntry[] };
  };
  return res.result.flags.map((f) => f.panelId);
}

describe('attention.flagList (FR-128)', () => {
  it('serves a stored flag only for a panel a saved layout still holds, and deletes the stranded rest', async () => {
    const store = flagStore([flag('live'), flag('gone')]);
    expect(await listFlags(store, () => new Set(['live']))).toEqual(['live']);
    expect([...store.rows.keys()], 'the stranded flag must not come back on the next read either').toEqual(['live']);
  });

  it('prunes nothing when the daemon cannot say which panels exist', async () => {
    const store = flagStore([flag('live'), flag('gone')]);
    expect(await listFlags(store, () => null)).toEqual(['live', 'gone']);
    expect(store.rows.size).toBe(2);
  });
});

describe('terminal.attentionLedger (FR-038, FR-091)', () => {
  const live: AttentionHarness[] = [];
  afterEach(async () => {
    for (const h of live.splice(0)) await h.stop();
  });
  const entry = (panelId: string): AttentionLedgerEntry => ({
    panelId,
    projectId: 'A',
    kind: 'attention',
    reason: { signal: 'bell', detail: null },
    raisedAt: 1,
    whileDetached: false,
  });

  it('serves an entry only for a panel a saved layout still holds, and forgets the stranded rest', async () => {
    let known: ReadonlySet<string> | null = new Set(['live']);
    const h = makeHarness({ livePanels: () => known });
    live.push(h);
    await h.rpc('terminal.attentionSync', { entries: [entry('live'), entry('gone')] });

    expect((await h.rpc('terminal.attentionLedger')).result.entries.map((e: AttentionLedgerEntry) => e.panelId)).toEqual(['live']);
    known = null;
    expect(
      (await h.rpc('terminal.attentionLedger')).result.entries.map((e: AttentionLedgerEntry) => e.panelId),
      'forgotten, not merely hidden',
    ).toEqual(['live']);
  });

  it('prunes nothing when the daemon cannot say which panels exist', async () => {
    const h = makeHarness({ livePanels: () => null });
    live.push(h);
    await h.rpc('terminal.attentionSync', { entries: [entry('live'), entry('gone')] });
    expect((await h.rpc('terminal.attentionLedger')).result.entries.map((e: AttentionLedgerEntry) => e.panelId)).toEqual(['live', 'gone']);
  });
});
