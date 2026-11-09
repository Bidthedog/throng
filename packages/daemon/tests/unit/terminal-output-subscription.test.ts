import { afterEach, describe, expect, it } from 'vitest';
import { RpcRouter } from '../../src/rpc-router.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { TerminalService } from '../../src/terminal-service.js';
import { FakeHost } from './attention-harness.js';

/**
 * 061 FR-001a, FR-002, FR-005, FR-005a, FR-062: frames are counted at the sink, the socket UI main reads, so what is
 * asserted is what crosses the process boundary.
 */

const noopLock = { acquire: async () => ({ path: 'x' }), release: async () => {} };
const launch = { file: 'C:/cmd.exe', args: [], cwd: 'C:/proj' };
const live: TerminalService[] = [];

function make() {
  const host = new FakeHost();
  const events = new TerminalEvents();
  const frames: { method: string; params: { data: string } }[] = [];
  const sink = { write: (frame: string) => frames.push(JSON.parse(frame)) };
  events.addSink(sink);
  const service = new TerminalService(host, events, new TerminalLockManager(noopLock), { isElevated: () => false });
  live.push(service);
  const router = new RpcRouter();
  service.register(router);
  const rpc = (method: string, params: object) =>
    router.handle({ jsonrpc: '2.0', id: 1, method, params }) as Promise<{ result: { scrollback: string } }>;
  return {
    host,
    events,
    sink,
    attach: (viewId: string) => rpc('terminal.attach', { panelId: 'p', projectId: 'q', viewId, launch, cols: 80, rows: 24 }),
    detach: (viewId: string) => rpc('terminal.detach', { panelId: 'p', viewId }),
    outputCount: () => frames.filter((f) => f.method === 'terminal.output').length,
    clear: () => {
      frames.length = 0;
    },
  };
}

afterEach(async () => {
  for (const s of live.splice(0)) await s.shutdown();
});

describe('output leaves the daemon only for a terminal being shown (061 FR-001a)', () => {
  it('publishes while a view is attached and stops when the last one detaches', async () => {
    const t = make();
    await t.attach('v1');
    t.host.emit('shown\n');
    expect(t.outputCount()).toBe(1);

    await t.detach('v1');
    t.host.emit('hidden\n');
    expect(t.outputCount()).toBe(1);
  });

  it('still records what no window is showing (FR-002)', async () => {
    const t = make();
    await t.attach('v1');
    await t.detach('v1');
    t.host.emit('while away\n');

    const back = await t.attach('v2');

    expect(back.result.scrollback).toBe('while away\n');
  });

  it('resumes as soon as a view attaches', async () => {
    const t = make();
    await t.attach('v1');
    await t.detach('v1');
    t.host.emit('away\n');
    await t.attach('v2');
    t.clear();
    t.host.emit('back\n');
    expect(t.outputCount()).toBe(1);
  });

  it('keeps publishing to a mirror after one view detaches (FR-005)', async () => {
    const t = make();
    await t.attach('v1');
    await t.attach('v2');
    await t.detach('v1');
    t.clear();
    t.host.emit('still mirrored\n');
    expect(t.outputCount()).toBe(1);
  });
});

describe('a reconnecting UI main (061 FR-005a)', () => {
  it('keeps output flowing for the views it says it is still routing', async () => {
    const t = make();
    await t.attach('v1');
    t.events.removeSink(t.sink); // the last events socket went: the daemon forgets views for the grid
    t.events.addSink(t.sink);
    t.events.subscribed([{ panelId: 'p', viewId: 'v1' }]);
    t.clear();

    t.host.emit('after the blip\n');

    expect(t.outputCount()).toBe(1);
  });

  it('stops output for views it no longer routes', async () => {
    const t = make();
    await t.attach('v1');
    t.events.subscribed([]);
    t.clear();

    t.host.emit('nobody left\n');

    expect(t.outputCount()).toBe(0);
  });
});
