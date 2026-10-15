import { describe, expect, it } from 'vitest';
import type { IPtyHost } from '@throng/core';
import { RESOURCES_ROSTER_METHOD } from '@throng/ipc-contract';
import { ResourceRosterService } from '../../src/resource-roster-service.js';
import { RpcRouter } from '../../src/rpc-router.js';

/**
 * Contract (055 T024, contracts/collector-protocol.md §1): `resources.roster` over the router, as UI
 * main's `DaemonClient.call` receives it — the method name, the result's exact shape, and a fake
 * host's entries arriving unchanged.
 */

const host = {
  rosterEntries: () => [{ handlePid: 11, osPid: 1100, conhostPid: 1200 }],
} as unknown as IPtyHost;

describe('resources.roster (055 contract §1)', () => {
  it('answers with the DaemonRoster shape, a host’s entries round-tripped', async () => {
    const router = new RpcRouter();
    new ResourceRosterService(
      { rosterTerminals: () => [{ panelId: 'n', projectId: 'p', host, handlePid: 11, scrollbackChars: 3, attached: [{ pid: 12, startedAt: 5 }] }] },
      { heldLocks: () => [{ projectId: 'p', path: 'C:/p', pid: 77 }] },
      () => 55,
    ).register(router);
    const res = (await router.handle({ jsonrpc: '2.0', id: 1, method: RESOURCES_ROSTER_METHOD, params: {} })) as {
      result: unknown;
    };
    expect(res.result).toEqual({
      daemonPid: process.pid,
      agentPid: 55,
      terminals: [{ panelId: 'n', projectId: 'p', osPid: 1100, conhostPid: 1200, attached: [{ pid: 12, startedAt: 5 }], scrollbackChars: 3 }],
      locks: [{ path: 'C:/p', projectId: 'p', pid: 77, panelIds: ['n'] }],
    });
  });
});
