import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LinkResolutionRequest } from '@throng/core';
import { registerLinkIpc, type LinkIpcMain, type LinkIpcService } from '../../src/main/link-ipc.js';

/**
 * 045 I1–I6 (`contracts/settings-and-environment.md` §3) — the `throng:links:*` wire.
 *
 * Driven through the handlers `registerLinkIpc` actually registers, on a fake `ipcMain`, over a fake
 * service that records what reached it — the `preview-ipc.contract.test.ts` pattern. What is pinned
 * here is the WIRE: which channels exist, of which KIND, what each handler forwards, and that a
 * renderer's own claims about a path or a project root cannot get through. The behaviour behind the
 * wire is `file-link-resolver.integration.test.ts`'s.
 *
 * I6 — nothing here is broadcast — is pinned by the ABSENCE of `on`/`send` registrations, and is
 * worth asserting rather than assuming: every one of these answers a question one window asked, and
 * a broadcast would hand one window's resolved paths to every other.
 */

const source = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

type Listener = (event: unknown, payload: unknown) => unknown;

function fakeIpc(): LinkIpcMain & { handles: Map<string, Listener>; ons: Map<string, Listener> } {
  const handles = new Map<string, Listener>();
  const ons = new Map<string, Listener>();
  return {
    handles,
    ons,
    handle: (channel, listener) => void handles.set(channel, listener as Listener),
    on: (channel, listener) => void ons.set(channel, listener as Listener),
  };
}

function fakeService() {
  const seen: { op: string; request: LinkResolutionRequest }[] = [];
  const service: LinkIpcService = {
    resolve: async (request) => {
      seen.push({ op: 'resolve', request });
      return { ok: true, link: { path: 'D:\\p\\a.txt', kind: 'file', inProject: true, executable: false, preview: 'none' } };
    },
    revealInFileManager: async (request) => {
      seen.push({ op: 'reveal', request });
      return { ok: true };
    },
    openWithDefaultProgram: async (request) => {
      seen.push({ op: 'open', request });
      return { ok: false, reason: 'gone', path: 'D:\\p\\a.txt' };
    },
  };
  return { service, seen };
}

const event = (id: number) => ({ sender: { id } });

const REQUEST: LinkResolutionRequest = {
  text: 'src/foo.ts',
  kind: 'detectedPath',
  baseDirectory: 'D:\\p\\packages\\core',
  panelId: 'p1',
};

describe('throng:links:* \u2014 the three channels exist, and all three are invoke', () => {
  it('registers exactly resolve, reveal and open', () => {
    const ipc = fakeIpc();
    registerLinkIpc(ipc, fakeService().service);
    expect([...ipc.handles.keys()].sort()).toEqual([
      'throng:links:open',
      'throng:links:resolve',
      'throng:links:reveal',
    ]);
  });

  it('I6: registers NO fire-and-forget channel and no broadcast', () => {
    const ipc = fakeIpc();
    registerLinkIpc(ipc, fakeService().service);
    expect([...ipc.ons.keys()]).toEqual([]);
  });
});

describe('throng:links:* \u2014 what each handler forwards, and what it answers', () => {
  it('resolve forwards the request and returns the resolution', async () => {
    const ipc = fakeIpc();
    const { service, seen } = fakeService();
    registerLinkIpc(ipc, service);
    const answer = await ipc.handles.get('throng:links:resolve')!(event(1), REQUEST);
    expect(seen).toEqual([{ op: 'resolve', request: REQUEST }]);
    expect(answer).toEqual({
      ok: true,
      link: { path: 'D:\\p\\a.txt', kind: 'file', inProject: true, executable: false, preview: 'none' },
    });
  });

  it('reveal and open forward the request and return the outcome', async () => {
    const ipc = fakeIpc();
    const { service, seen } = fakeService();
    registerLinkIpc(ipc, service);
    await expect(ipc.handles.get('throng:links:reveal')!(event(1), REQUEST)).resolves.toEqual({ ok: true });
    await expect(ipc.handles.get('throng:links:open')!(event(1), REQUEST)).resolves.toEqual({
      ok: false,
      reason: 'gone',
      path: 'D:\\p\\a.txt',
    });
    expect(seen.map((s) => s.op)).toEqual(['reveal', 'open']);
  });

  it('a non-link comes back as a VALUE, not as a rejection across the bridge', async () => {
    const ipc = fakeIpc();
    registerLinkIpc(ipc, {
      resolve: async () => ({ ok: false }),
      revealInFileManager: async () => ({ ok: true }),
      openWithDefaultProgram: async () => ({ ok: true }),
    });
    await expect(ipc.handles.get('throng:links:resolve')!(event(1), REQUEST)).resolves.toEqual({ ok: false });
  });

  it('a service that throws answers a value too \u2014 a rejection would surface as an opaque bridge error', async () => {
    const ipc = fakeIpc();
    registerLinkIpc(ipc, {
      resolve: async () => {
        throw new Error('boom');
      },
      revealInFileManager: async () => {
        throw new Error('boom');
      },
      openWithDefaultProgram: async () => {
        throw new Error('boom');
      },
    });
    await expect(ipc.handles.get('throng:links:resolve')!(event(1), REQUEST)).resolves.toEqual({ ok: false });
    const outcome = await ipc.handles.get('throng:links:reveal')!(event(1), REQUEST);
    expect(outcome).toMatchObject({ ok: false, reason: 'refused' });
  });
});

describe('throng:links:* \u2014 I1/I2: the request carries a LINK, never a path or a root', () => {
  it('forwards only text, kind, baseDirectory and panelId', async () => {
    const ipc = fakeIpc();
    const { service, seen } = fakeService();
    registerLinkIpc(ipc, service);
    await ipc.handles.get('throng:links:resolve')!(event(1), {
      ...REQUEST,
      // Everything a hostile or careless renderer might try to smuggle through.
      absPath: 'C:\\Windows\\System32\\config\\SAM',
      path: 'C:\\Windows',
      projectRoot: 'C:\\',
      inProject: true,
    });
    expect(Object.keys(seen[0].request).sort()).toEqual([
      'baseDirectory',
      'kind',
      'panelId',
      'text',
    ]);
  });

  it('a request with no panelId is refused rather than resolved against nothing', async () => {
    const ipc = fakeIpc();
    const { service, seen } = fakeService();
    registerLinkIpc(ipc, service);
    const answer = await ipc.handles.get('throng:links:resolve')!(event(1), { text: 'x', kind: 'detectedPath' });
    expect(answer).toEqual({ ok: false });
    expect(seen, 'nothing may reach the resolver without a panel to derive a root from').toEqual([]);
  });

  it('an unknown kind is refused \u2014 the two readings are not a free-text field', async () => {
    const ipc = fakeIpc();
    const { service, seen } = fakeService();
    registerLinkIpc(ipc, service);
    await ipc.handles.get('throng:links:resolve')!(event(1), { ...REQUEST, kind: 'whatever' });
    expect(seen).toEqual([]);
  });

  it('a non-string baseDirectory is dropped, not forwarded', async () => {
    const ipc = fakeIpc();
    const { service, seen } = fakeService();
    registerLinkIpc(ipc, service);
    await ipc.handles.get('throng:links:resolve')!(event(1), { ...REQUEST, baseDirectory: 42 });
    expect(seen[0].request.baseDirectory).toBeUndefined();
  });
});

describe('throng:links:* \u2014 preload parity for window.throng.links', () => {
  it('the preload invokes all three channels, and sends none', () => {
    const preload = source('../../src/preload/preload.cts');
    for (const channel of ['resolve', 'reveal', 'open']) {
      expect(preload).toContain(`ipcRenderer.invoke('throng:links:${channel}'`);
    }
    expect(preload).not.toContain("ipcRenderer.send('throng:links:");
    expect(preload).not.toContain("ipcRenderer.on('throng:links:");
  });

  it('the renderer declaration names the surface and all three members', () => {
    const globals = source('../../src/renderer/global.d.ts');
    expect(globals).toContain('links?: {');
    for (const member of ['resolve:', 'reveal:', 'open:']) {
      expect(globals).toContain(member);
    }
  });

  it('I5: the existing open-external channels are untouched, mechanism included', () => {
    // Both are `send`, not `invoke` — fire-and-forget, with main re-validating the scheme. Pinned
    // with the mechanism spelled out, because "untouched" is the requirement and a channel quietly
    // becoming an `invoke` would be a change to the policy 024 FR-019b set.
    const preload = source('../../src/preload/preload.cts');
    expect(preload).toContain("ipcRenderer.send('throng:openExternal'");
    expect(preload).toContain("ipcRenderer.send('throng:preview:openExternal'");
  });
});
