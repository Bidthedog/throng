/**
 * 080 FR-063, FR-070 — main asks a window to show the link prompt the moment the link is followed. A window whose
 * page has not yet subscribed (the Help window's toolbar page mounts after its guide view can take a click) would
 * drop that ask, and the prompt would never show. The preload holds an ask until the page subscribes.
 *
 * Layer: unit — the preload loaded over a mocked Electron, its `ipcRenderer` an event emitter.
 */
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const exposed: Record<string, unknown> = {};
const ipc = Object.assign(new EventEmitter(), { send: vi.fn(), invoke: vi.fn(), sendSync: vi.fn() });

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (key: string, api: unknown) => (exposed[key] = api) },
  ipcRenderer: ipc,
  webUtils: { getPathForFile: () => '' },
}));

type LinkPrompt = { onAsk: (cb: (r: { id: number; url: string }) => void) => () => void };
const linkPrompt = (): LinkPrompt => (exposed.throng as { linkPrompt: LinkPrompt }).linkPrompt;

describe('an ask that arrives before the page subscribes still shows (FR-063)', () => {
  beforeAll(async () => {
    // Vitest does not transform `.cts`: load the same source as a `.ts` copy.
    const dir = mkdtempSync(join(tmpdir(), 'throng-preload-'));
    const copy = join(dir, 'preload.ts');
    writeFileSync(copy, readFileSync(fileURLToPath(new URL('../../src/preload/preload.cts', import.meta.url)), 'utf8'));
    try {
      await import(/* @vite-ignore */ pathToFileURL(copy).href);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('delivers an early ask to the first subscriber, once', () => {
    ipc.emit('throng:linkPrompt:ask', {}, { id: 7, url: 'https://example.test/' });
    const first = vi.fn();
    const stop = linkPrompt().onAsk(first);
    expect(first).toHaveBeenCalledWith({ id: 7, url: 'https://example.test/' });
    stop();
    const second = vi.fn();
    linkPrompt().onAsk(second)();
    expect(second).not.toHaveBeenCalled();
  });

  it('delivers an ask straight to a page already subscribed', () => {
    const cb = vi.fn();
    const stop = linkPrompt().onAsk(cb);
    ipc.emit('throng:linkPrompt:ask', {}, { id: 8, url: 'https://example.test/b' });
    expect(cb).toHaveBeenCalledWith({ id: 8, url: 'https://example.test/b' });
    stop();
  });
});
