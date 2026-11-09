import { afterEach, describe, expect, it } from 'vitest';
import { RpcRouter } from '../../src/rpc-router.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { TerminalService } from '../../src/terminal-service.js';
import { FakeHost } from './attention-harness.js';

/** 061 FR-010, FR-011: every delivery says where it ends, and an attach says where its replay stops. */

const noopLock = { acquire: async () => ({ path: 'x' }), release: async () => {} };
const launch = { file: 'C:/cmd.exe', args: [], cwd: 'C:/proj' };
const live: TerminalService[] = [];

function make() {
  const host = new FakeHost();
  const events = new TerminalEvents();
  const frames: { method: string; params: { sessionId: number; data: string; end: number } }[] = [];
  events.addSink({ write: (frame) => frames.push(JSON.parse(frame)) });
  const service = new TerminalService(host, events, new TerminalLockManager(noopLock), { isElevated: () => false });
  live.push(service);
  const router = new RpcRouter();
  service.register(router);
  const attach = () =>
    router.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'terminal.attach',
      params: { panelId: 'p', projectId: 'q', launch, cols: 80, rows: 24 },
    }) as Promise<{ result: { sessionId: number; scrollback: string; replayEnd: number } }>;
  return { host, events, attach, outputs: () => frames.filter((f) => f.method === 'terminal.output').map((f) => f.params) };
}

afterEach(async () => {
  for (const s of live.splice(0)) await s.shutdown();
});

describe('output positions (061 FR-010, FR-011)', () => {
  it('numbers deliveries contiguously, under the attached session', async () => {
    const { host, events, attach, outputs } = make();
    const first = await attach();
    expect(first.result.replayEnd).toBe(0);
    host.emit('abc');
    host.emit('de');
    events.flush('p');
    expect(outputs()).toEqual([
      { panelId: 'p', sessionId: first.result.sessionId, data: 'abc', end: 3 },
      { panelId: 'p', sessionId: first.result.sessionId, data: 'de', end: 5 },
    ]);
  });

  it('reports the position its replay reaches', async () => {
    const { host, attach } = make();
    await attach();
    host.emit('abc\n');
    const again = await attach();
    expect(again.result.scrollback).toBe('abc\n');
    expect(again.result.replayEnd).toBe(4);
  });

  it('delivers whatever was waiting before taking its snapshot, so nothing straddles the replay', async () => {
    const { host, attach, outputs } = make();
    await attach();
    host.emit('abc\n');
    host.emit('de\n'); // waiting in a batch
    expect(outputs().map((o) => o.end)).toEqual([4]);

    const again = await attach();

    expect(outputs().map((o) => o.end)).toEqual([4, 7]);
    expect(again.result.replayEnd).toBe(7);
  });
});
