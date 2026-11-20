/**
 * 074 FR-072a, FR-092a — the per-frame Safe HTML preview sources main keeps for the request filter: registered by the
 * renderer over IPC, keyed by the window and the frame's `throng-html-<panelId>` name, normalised on the way in, and
 * read by the filter for a sub-frame request.
 *
 * Layer: unit — structural fakes for the IPC main and the session.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, SHIPPED_PREVIEW_PROVIDERS } from '@throng/core';
import { createFrameSources, frameNameFor, registerFrameSourcesIpc } from '../../src/main/frame-sources.js';
import { installRendererRequestFilter, type RequestFilterSession } from '../../src/main/renderer-request-filter.js';

type Sender = { id: number; once: (event: string, fn: () => void) => void; destroy: () => void };
function sender(id: number): Sender {
  const listeners: Array<() => void> = [];
  return { id, once: (_e, fn) => listeners.push(fn), destroy: () => listeners.forEach((fn) => fn()) };
}

function fakeIpc() {
  const handlers = new Map<string, (event: { sender: Sender }, payload: unknown) => void>();
  return {
    ipc: { on: (channel: string, fn: (event: { sender: Sender }, payload: unknown) => void) => void handlers.set(channel, fn) },
    send: (s: Sender, payload: unknown) => handlers.get('throng:preview:setFrameSources')?.({ sender: s }, payload),
  };
}

describe('frame sources registry', () => {
  it('names a panel frame and reads back what the window registered for it, normalised', () => {
    const reg = createFrameSources();
    const { ipc, send } = fakeIpc();
    registerFrameSourcesIpc(ipc, reg);
    const w = sender(7);
    send(w, { panelId: 'p1', origins: ['HTTPS://Fonts.gstatic.com/x', 'http://nope.com', 3] });
    expect(frameNameFor('p1')).toBe('throng-html-p1');
    expect(reg.sourcesFor(7, 'throng-html-p1')).toEqual(['https://fonts.gstatic.com']);
  });

  it('keeps windows and panels apart, and an unknown or foreign frame name has none', () => {
    const reg = createFrameSources();
    const { ipc, send } = fakeIpc();
    registerFrameSourcesIpc(ipc, reg);
    send(sender(7), { panelId: 'p1', origins: ['https://a.com'] });
    expect(reg.sourcesFor(8, 'throng-html-p1')).toEqual([]);
    expect(reg.sourcesFor(7, 'throng-html-p2')).toEqual([]);
    expect(reg.sourcesFor(7, 'some-frame')).toEqual([]);
    expect(reg.sourcesFor(7, undefined)).toEqual([]);
  });

  it('an empty list forgets the panel, and a destroyed window forgets all of its panels', () => {
    const reg = createFrameSources();
    const { ipc, send } = fakeIpc();
    registerFrameSourcesIpc(ipc, reg);
    const w = sender(7);
    send(w, { panelId: 'p1', origins: ['https://a.com'] });
    send(w, { panelId: 'p2', origins: ['https://b.com'] });
    send(w, { panelId: 'p1', origins: [] });
    expect(reg.sourcesFor(7, 'throng-html-p1')).toEqual([]);
    w.destroy();
    expect(reg.sourcesFor(7, 'throng-html-p2')).toEqual([]);
  });

  it('ignores a malformed payload', () => {
    const reg = createFrameSources();
    const { ipc, send } = fakeIpc();
    registerFrameSourcesIpc(ipc, reg);
    send(sender(7), { panelId: 42, origins: ['https://a.com'] });
    send(sender(7), null);
    send(sender(7), { panelId: 'p1', origins: 'https://a.com' });
    expect(reg.sourcesFor(7, 'throng-html-p1')).toEqual([]);
  });
});

describe('the request filter reads them for a sub-frame (FR-092a)', () => {
  function filterWith(reg: ReturnType<typeof createFrameSources>) {
    let listener: ((d: object, cb: (r: { cancel?: boolean }) => void) => void) | undefined;
    const session = { webRequest: { onBeforeRequest: (_f: unknown, l: typeof listener) => void (listener = l) } } as unknown as RequestFilterSession;
    installRendererRequestFilter(session, () => DEFAULT_APP_SETTINGS, SHIPPED_PREVIEW_PROVIDERS, 'D:/app/renderer', reg);
    return (d: object) => {
      let out: { cancel?: boolean } = {};
      listener?.(d, (r) => (out = r));
      return out;
    };
  }

  it("allows a font from the frame's safe source, and refuses it to another frame or the top document", () => {
    const reg = createFrameSources();
    const { ipc, send } = fakeIpc();
    registerFrameSourcesIpc(ipc, reg);
    send(sender(7), { panelId: 'p1', origins: ['https://fonts.gstatic.com'] });
    const filter = filterWith(reg);
    const font = { url: 'https://fonts.gstatic.com/s/a.woff2', resourceType: 'font', webContentsId: 7 };
    expect(filter({ ...font, frame: { name: 'throng-html-p1', parent: {} } })).toEqual({});
    expect(filter({ ...font, frame: { name: 'throng-html-p2', parent: {} } })).toEqual({ cancel: true });
    expect(filter({ ...font, frame: { name: '', parent: null } })).toEqual({ cancel: true });
    expect(filter({ ...font, webContentsId: 8, frame: { name: 'throng-html-p1', parent: {} } })).toEqual({ cancel: true });
  });
});
