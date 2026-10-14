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

function fakeClipboard(): {
  clipboard: IClipboard;
  richCalls: Array<{ text: string; html: string }>;
  imageCalls: Array<{ png: Uint8Array; html: string }>;
} {
  const richCalls: Array<{ text: string; html: string }> = [];
  const imageCalls: Array<{ png: Uint8Array; html: string }> = [];
  const clipboard: IClipboard = {
    writeText: () => {},
    async writeRich(entry) {
      richCalls.push(entry);
    },
    async writeImage(entry) {
      imageCalls.push(entry);
    },
    readText: () => '',
  };
  return { clipboard, richCalls, imageCalls };
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

/** 054 — Copy Diagram as Image: a bounded base64 PNG data URI, and nothing else, reaches the clipboard. */
describe('throng:clipboard:writeImage payload validation', () => {
  const URI = 'data:image/png;base64,iVBORw0K';

  it('writes the decoded PNG with an <img> of the same URI, built in main', async () => {
    const { clipboard, imageCalls } = fakeClipboard();
    registerClipboardIpc(new ClipboardService(clipboard));

    await invoke('throng:clipboard:writeImage', { dataUri: URI });

    expect(imageCalls).toHaveLength(1);
    expect(Array.from(imageCalls[0]!.png)).toEqual(Array.from(Buffer.from('iVBORw0K', 'base64')));
    expect(imageCalls[0]!.html).toBe(`<img src="${URI}">`);
  });

  it.each([
    ['not a PNG', { dataUri: 'data:image/svg+xml;base64,PHN2Zz4=' }],
    ['markup smuggled into the URI', { dataUri: 'data:image/png;base64,AAAA"><script>' }],
    ['not a string', { dataUri: 42 }],
    ['no payload', null],
  ])('ignores %s, without throwing', async (_why, payload) => {
    const { clipboard, imageCalls } = fakeClipboard();
    registerClipboardIpc(new ClipboardService(clipboard));

    await expect(invoke('throng:clipboard:writeImage', payload)).resolves.toBeUndefined();

    expect(imageCalls).toEqual([]);
  });
});
