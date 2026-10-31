import { afterEach, describe, expect, it } from 'vitest';
import type { AttentionLedgerEntry } from '@throng/core';
import { BEL, ESC, makeHarness, sleep, type AttentionHarness } from './attention-harness.js';

/*
 * 057 FR-066, FR-091 — the daemon's attention ledger across a detach.
 * Layer: unit — (moved down from integration: fake PTY host, no shell) the ledger lives in the real service and is filled by the same paths that publish to
 * a sink; what matters is what a reattaching main reads back, so it goes through the router as main does.
 */
const live: AttentionHarness[] = [];
async function harness(panels = ['p1']): Promise<AttentionHarness> {
  const h = makeHarness();
  live.push(h);
  for (const [i, p] of panels.entries()) await h.attach(p, i === 0 ? 'A' : 'B');
  return h;
}
afterEach(async () => {
  for (const h of live.splice(0)) await h.stop();
});

const entry = (panelId: string, overrides: Partial<AttentionLedgerEntry> = {}): AttentionLedgerEntry => ({
  panelId,
  projectId: 'A',
  kind: 'attention',
  reason: { signal: 'bell', detail: null },
  raisedAt: 1,
  whileDetached: false,
  ...overrides,
});

const ledger = async (h: AttentionHarness): Promise<AttentionLedgerEntry[]> =>
  (await h.rpc('terminal.attentionLedger')).result.entries;

describe('terminal attention ledger (057)', () => {
  it('attentionSync replaces the ledger', async () => {
    const h = await harness();
    expect((await h.rpc('terminal.attentionSync', { entries: [entry('x'), entry('y')] })).result).toEqual({ ok: true });
    expect((await ledger(h)).map((e) => e.panelId).sort()).toEqual(['x', 'y']);
    await h.rpc('terminal.attentionSync', { entries: [entry('z')] });
    expect((await ledger(h)).map((e) => e.panelId)).toEqual(['z']);
  });

  it('a bell, a notification and an unexpected non-zero exit while detached are stored, read once, then cleared of the flag', async () => {
    const h = await harness(['p1', 'p2', 'p3']);
    h.detachSink();
    h.host.emit(BEL, 1000);
    h.host.emit(`${ESC}]9;hello${BEL}`, 1001);
    h.host.fireExit({ code: 3 }, 1002);
    await sleep(50);
    expect(h.signals).toEqual([]);

    const first = await ledger(h);
    const byPanel = new Map(first.map((e) => [e.panelId, e]));
    expect(byPanel.get('p1')).toMatchObject({ projectId: 'A', kind: 'attention', reason: { signal: 'bell' }, whileDetached: true });
    expect(byPanel.get('p2')).toMatchObject({ reason: { signal: 'notification', detail: 'hello' }, whileDetached: true });
    expect(byPanel.get('p3')).toMatchObject({ kind: 'failed', reason: { signal: 'processExited', detail: '3' }, whileDetached: true });

    expect((await ledger(h)).every((e) => !e.whileDetached)).toBe(true);
  });

  it('an unread detached entry survives a sync; a read one does not', async () => {
    const h = await harness();
    h.detachSink();
    h.host.emit(BEL);
    await h.rpc('terminal.attentionSync', { entries: [] });
    expect((await ledger(h)).map((e) => e.panelId)).toEqual(['p1']);
    await h.rpc('terminal.attentionSync', { entries: [] });
    expect(await ledger(h)).toEqual([]);
  });

  it('with a sink attached nothing is written to the ledger', async () => {
    const h = await harness();
    h.host.emit(BEL);
    expect(h.signals).toHaveLength(1);
    expect(await ledger(h)).toEqual([]);
  });

  it('a repeat while detached keeps one entry per panel, Failed sticky', async () => {
    const h = await harness();
    h.detachSink();
    h.host.emit(`${ESC}]9;4;2;50${BEL}`);
    await sleep(300);
    h.host.emit(BEL);
    const entries = await ledger(h);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'failed', reason: { signal: 'bell' } });
  });

  it('terminal.kill drops the panel\'s entry (FR-066)', async () => {
    const h = await harness(['p1', 'p2']);
    await h.rpc('terminal.attentionSync', { entries: [entry('p1'), entry('p2')] });
    await h.rpc('terminal.kill', { panelId: 'p1' });
    expect((await ledger(h)).map((e) => e.panelId)).toEqual(['p2']);
  });

  it('killAll drops every entry whose terminal it ended', async () => {
    const h = await harness(['p1', 'p2']);
    await h.rpc('terminal.attentionSync', { entries: [entry('p1'), entry('p2'), entry('gone')] });
    await h.rpc('terminal.killAll', {});
    expect((await ledger(h)).map((e) => e.panelId)).toEqual(['gone']);
  });

  it('project delete drops the project\'s entries, with or without a running terminal', async () => {
    const h = await harness(['p1']);
    await h.rpc('terminal.attentionSync', {
      entries: [entry('p1'), entry('p2', { projectId: 'B' }), entry('p3', { projectId: 'B' })],
    });
    h.service.killForProject('B');
    expect((await ledger(h)).map((e) => e.panelId)).toEqual(['p1']);
  });

  it('caps at 1,000 entries, dropping the oldest (FR-091)', async () => {
    const h = await harness();
    const entries = Array.from({ length: 1100 }, (_, i) => entry(`panel-${i}`, { raisedAt: i }));
    await h.rpc('terminal.attentionSync', { entries });
    const read = await ledger(h);
    expect(read).toHaveLength(1000);
    expect(read.some((e) => e.panelId === 'panel-0')).toBe(false);
    expect(read.some((e) => e.panelId === 'panel-1099')).toBe(true);
  });
});
