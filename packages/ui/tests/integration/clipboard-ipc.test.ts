/**
 * The `throng:clipboard:writeRich` payload validation (044, FR-035a).
 *
 * The renderer is not trusted: a compromised or buggy renderer, or simply a stale preload build
 * paired with a newer main, can send anything on this channel. `registerClipboardIpc` must never
 * forward a malformed payload to {@link ClipboardService}, and must never throw doing so — a bad
 * clipboard message is not worth taking the main process down over.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClipboardService } from '../../src/main/clipboard-service.js';
import type { IClipboard } from '@throng/core';

/** Capture what `registerClipboardIpc` wires onto ipcMain, so we can invoke it. */
const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
  },
}));

const { registerClipboardIpc } = await import('../../src/main/clipboard-ipc.js');

function fakeClipboard(): { clipboard: IClipboard; richCalls: Array<{ text: string; html: string }> } {
  const richCalls: Array<{ text: string; html: string }> = [];
  const clipboard: IClipboard = {
    writeText: () => {},
    async writeRich(entry) {
      richCalls.push(entry);
    },
    readText: () => '',
  };
  return { clipboard, richCalls };
}

/** Invoke a registered channel exactly as the preload bridge would. */
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`channel not registered: ${channel}`);
  return (await fn({}, ...args)) as T;
}

beforeEach(() => handlers.clear());

describe('throng:clipboard:writeRich payload validation', () => {
  it('passes a valid { text, html } payload straight through', async () => {
    const { clipboard, richCalls } = fakeClipboard();
    registerClipboardIpc(new ClipboardService(clipboard));

    await invoke('throng:clipboard:writeRich', { text: 'hi', html: '<p>hi</p>' });

    expect(richCalls).toEqual([{ text: 'hi', html: '<p>hi</p>' }]);
  });

  it('does not call ClipboardService, and does not throw, when html is not a string', async () => {
    const { clipboard, richCalls } = fakeClipboard();
    registerClipboardIpc(new ClipboardService(clipboard));

    await expect(invoke('throng:clipboard:writeRich', { text: 'hi', html: 42 })).resolves.toBeUndefined();

    expect(richCalls).toEqual([]);
  });

  it('does not call ClipboardService, and does not throw, when text is not a string', async () => {
    const { clipboard, richCalls } = fakeClipboard();
    registerClipboardIpc(new ClipboardService(clipboard));

    await expect(
      invoke('throng:clipboard:writeRich', { text: 42, html: '<p>hi</p>' }),
    ).resolves.toBeUndefined();

    expect(richCalls).toEqual([]);
  });

  it('does not call ClipboardService, and does not throw, for a null payload', async () => {
    const { clipboard, richCalls } = fakeClipboard();
    registerClipboardIpc(new ClipboardService(clipboard));

    await expect(invoke('throng:clipboard:writeRich', null)).resolves.toBeUndefined();

    expect(richCalls).toEqual([]);
  });
});
