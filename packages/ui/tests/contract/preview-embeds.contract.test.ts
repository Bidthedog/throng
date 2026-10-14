/**
 * Contract (054): `throng:preview:readEmbeds` — the payload main accepts, what reaches the service, and the
 * preload and renderer typings that name the channel.
 *
 * Layer: contract — the IPC boundary's own validation, driven through the real registrar on a fake `ipcMain`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PreviewEmbedRead } from '@throng/core';
import { registerPreviewIpc, type PreviewIpcMain, type PreviewIpcService } from '../../src/main/preview-ipc.js';

type Listener = (event: unknown, payload: unknown) => unknown;

function wire(readEmbeds: (panelId: string, refs: readonly string[]) => Promise<{ results: PreviewEmbedRead[] }>): Listener {
  const handles = new Map<string, Listener>();
  const ipc: PreviewIpcMain = {
    handle: (channel, listener) => void handles.set(channel, listener as Listener),
    on: () => {},
  };
  registerPreviewIpc(ipc, { readEmbeds } as unknown as PreviewIpcService, { toggle: async () => ({ ok: false, reason: 'io' }) });
  return handles.get('throng:preview:readEmbeds') as Listener;
}

const event = { sender: { id: 1 } };

describe('throng:preview:readEmbeds', () => {
  it('forwards the panel and the string references, dropping anything else', async () => {
    const seen: { panelId: string; refs: readonly string[] }[] = [];
    const handler = wire(async (panelId, refs) => {
      seen.push({ panelId, refs });
      return { results: refs.map((ref) => ({ ref, ok: true, text: 'graph TD\n' })) };
    });
    const answer = await handler(event, { panelId: 'pv', refs: ['a.mmd', 7, '', 'x'.repeat(1025), 'b.mermaid'] });
    expect(seen).toEqual([{ panelId: 'pv', refs: ['a.mmd', 'b.mermaid'] }]);
    expect(answer).toEqual({
      results: [
        { ref: 'a.mmd', ok: true, text: 'graph TD\n' },
        { ref: 'b.mermaid', ok: true, text: 'graph TD\n' },
      ],
    });
  });

  it('passes at most 50 references', async () => {
    let count = 0;
    const handler = wire(async (_p, refs) => {
      count = refs.length;
      return { results: [] };
    });
    await handler(event, { panelId: 'pv', refs: Array.from({ length: 60 }, (_, i) => `d${i}.mmd`) });
    expect(count).toBe(50);
  });

  it.each([
    ['no panelId', { refs: ['a.mmd'] }],
    ['refs not an array', { panelId: 'pv', refs: 'a.mmd' }],
    ['no payload', undefined],
  ])('reads nothing for %s', async (_name, payload) => {
    let called = false;
    const handler = wire(async () => {
      called = true;
      return { results: [] };
    });
    expect(await handler(event, payload)).toEqual({ results: [] });
    expect(called).toBe(false);
  });

  it('a service that throws answers no results', async () => {
    const handler = wire(async () => {
      throw new Error('disk');
    });
    expect(await handler(event, { panelId: 'pv', refs: ['a.mmd'] })).toEqual({ results: [] });
  });

  it('is exposed by the preload and typed for the renderer', () => {
    const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    expect(read('../../src/preload/preload.cts')).toContain("ipcRenderer.invoke('throng:preview:readEmbeds'");
    expect(read('../../src/renderer/global.d.ts')).toMatch(/readEmbeds\?: \(panelId: string, refs: string\[\]\)/);
  });
});
